import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import { formatNumber } from "../../../core/format";
import { intersectRayPlane } from "../../../core/math";
import type { SurfaceHit } from "../../../core/placement";
import { newGuid, storeyAt } from "../../../core/points";
import {
  angleSnap,
  applySlope,
  autoRoute,
  closestOnSegment,
  distance,
  manhattanPath,
  newRunId,
  nextRunTag,
  orthoSnap,
  runFittings,
  runIdOfElement,
  runLength,
  runSegments,
  RUN_TYPES,
  RUN_TYPE_BY_ID,
  segmentElementId,
  simplify,
  type AutoRouteMode,
  type Run,
  type RunType,
} from "../../../core/runs";
import type { ElementInfo, Vec3 } from "../../../core/types";
import {
  BOX_REASON_LABEL,
  boxElementId,
  boxSizeLabel,
  conduitElevation,
  DEFAULT_INSTALL,
  INSTALL_LABEL,
  INSTALL_MODES,
  isApparent as isApparentMode,
  isConduitRun,
  isConduitType,
  applyInstall,
  pullBoxes,
  runFloorProbeY,
  typeAllowed,
  installSummary,
  wallOffset,
  type ConduitInstall,
  type InstallMode,
  type InstallSettings,
} from "../../../core/conduits";
import { makeSlabProbe } from "../locacao/ceiling";
import type { LoadedModel } from "../../../ifc/loadIfc";
import { useProjectFiles } from "../locacao/useProjectFiles";
import type { PointsStore } from "../locacao/usePointsStore";
import type { PointerContext, PreviewItem, Viewer } from "../viewer/Viewer";

interface Props {
  model: LoadedModel;
  fileName: string | null;
  store: PointsStore;
  viewer: Viewer;
  selection: number[];
  onSelect: (ids: number[], frame?: boolean) => void;
  systems: string[];
  /** Tipos de trecho da disciplina ativa; todos se omitido. */
  typeIds?: string[];
  /** Tipo escolhido na faixa de ferramentas (n muda a cada clique): já inicia o desenho. */
  preset?: { typeId: string; n: number } | null;
  elementById: Map<number, ElementInfo>;
  /** Abre o painel de medidas das instalações do empreendimento. */
  onConfigureInstalls?: () => void;
}

type Mode = "desenhar" | "ligar";

/** Destino ou ponto de encaixe: ponto locado, trecho existente, superfície ou plano de trabalho. */
interface Candidate {
  point: Vec3;
  snap: "ponto" | "trecho" | "superficie" | "plano";
  label: string;
}

const GROUPS = [...new Set(RUN_TYPES.map((t) => t.group))];
const STEP = 0.01; // arredondamento dos comprimentos: 10 mm
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
const roundStep = (v: number) => Math.round(v / STEP) * STEP;

export function TracadoPanel({ model, fileName, store, viewer, selection, onSelect, systems, typeIds, preset, elementById, onConfigureInstalls }: Props) {
  const [typeId, setTypeId] = useState(preset?.typeId ?? typeIds?.[0] ?? "eletroduto-pvc");
  const type = RUN_TYPE_BY_ID[typeId];
  const [sizeLabel, setSizeLabel] = useState(type.defaultSize);
  const size = type.sizes.find((s) => s.label === sizeLabel) ?? type.sizes[0];
  const [system, setSystem] = useState(type.system);
  const [circuit, setCircuit] = useState("");
  const [slope, setSlope] = useState(type.slopeFor?.(size) ?? 0);
  const [workElevation, setWorkElevation] = useState(2.8);
  const [ortho, setOrtho] = useState(true);
  const [install, setInstall] = useState<ConduitInstall>(DEFAULT_INSTALL);
  const conduit = isConduitType(type);
  const slabAt = useMemo(() => makeSlabProbe(viewer, elementById, model.storeyLevels), [viewer, elementById, model.storeyLevels]);
  const [mode, setMode] = useState<Mode>("desenhar");
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Vec3[]>([]);
  const [status, setStatus] = useState("");
  const [routeMode, setRouteMode] = useState<AutoRouteMode>("cadeia");
  const [destination, setDestination] = useState<Candidate | null>(null);
  const [pickingDestination, setPickingDestination] = useState(false);

  const chooseType = (id: string) => {
    const t = RUN_TYPE_BY_ID[id];
    const s = t.sizes.find((x) => x.label === t.defaultSize)!;
    setTypeId(id);
    setSizeLabel(t.defaultSize);
    setSystem(t.system);
    setSlope(t.slopeFor?.(s) ?? 0);
  };
  const chooseInstall = (next: ConduitInstall) => {
    setInstall(next);
    // Aparente exige eletroduto rígido.
    if (isConduitType(type) && !typeAllowed(type, next.mode)) chooseType(RUN_TYPES.find((t) => isConduitType(t) && typeAllowed(t, next.mode) && (!typeIds || typeIds.includes(t.id)))?.id ?? "eletroduto-pvc");
  };
  const chooseSize = (label: string) => {
    setSizeLabel(label);
    const s = type.sizes.find((x) => x.label === label);
    if (s && type.slopeFor) setSlope(type.slopeFor(s));
  };

  useEffect(() => {
    if (!preset) return;
    chooseType(preset.typeId);
    setMode("desenhar");
    setDraft([]);
    setDrawing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.n]);

  const pointById = useMemo(() => new Map(store.points.map((p) => [p.id, p])), [store.points]);
  const runById = useMemo(() => new Map(store.runs.map((r) => [r.id, r])), [store.runs]);
  const selectedPoints = useMemo(() => store.points.filter((p) => selection.includes(p.id)), [store.points, selection]);
  const selectedRunIds = useMemo(() => [...new Set(selection.map(runIdOfElement).filter((x): x is number => x != null))], [selection]);
  const selectedRuns = useMemo(() => store.runs.filter((r) => selectedRunIds.includes(r.id)), [store.runs, selectedRunIds]);

  /** Nível do piso (Y) do pavimento de uma cota. */
  const floorAt = useCallback(
    (y: number) => {
      const name = storeyAt(y, model.storeyLevels);
      return model.storeyLevels.find((s) => s.name === name)?.level ?? 0;
    },
    [model.storeyLevels],
  );

  /** Ponto locado ou trecho sob o cursor. */
  const objectCandidate = useCallback(
    (ctx: PointerContext): Candidate | null => {
      if (ctx.objectId == null) return null;
      const p = pointById.get(ctx.objectId);
      if (p) return { point: p.position, snap: "ponto", label: p.tag };
      const runId = runIdOfElement(ctx.objectId);
      const r = runId != null ? runById.get(runId) : undefined;
      if (r && ctx.objectPoint) {
        let best: Vec3 = r.vertices[0];
        for (const s of runSegments(r)) {
          const c = closestOnSegment(ctx.objectPoint, s.start, s.end).point;
          if (distance(c, ctx.objectPoint) < distance(best, ctx.objectPoint)) best = c;
        }
        return { point: best, snap: "trecho", label: r.tag };
      }
      return null;
    },
    [pointById, runById],
  );

  /** Cota (Y) do eletroduto horizontal em (x, z) para a instalação escolhida; null para outras redes. */
  const conduitY = useCallback(
    (x: number, z: number, floorY: number): number | null => {
      const L = live.current;
      if (!isConduitType(L.type)) return null;
      return conduitElevation(L.install, floorY, slabAt(x, z, floorY), L.size.width, L.settings);
    },
    [slabAt],
  );
  /** Instalação de parede (alvenaria, canaleta perimetral): ponto na face da parede deslocado pela medida do empreendimento. */
  const onWall = useCallback((hit: SurfaceHit | null): Vec3 | null => {
    const L = live.current;
    if (!hit || !isConduitType(L.type) || Math.abs(hit.normal[1]) > 0.3) return null;
    const off = wallOffset(L.install, L.size.width, L.settings);
    if (off == null) return null;
    return hit.point.map((v, i) => v + hit.normal[i] * off) as Vec3;
  }, []);

  // Estado mais recente para os callbacks do visualizador.
  const settings: InstallSettings = store.installSettings;
  const live = useRef({ type, size, system, circuit, slope, workElevation, ortho, draft, mode, destination, pickingDestination, install, settings });
  live.current = { type, size, system, circuit, slope, workElevation, ortho, draft, mode, destination, pickingDestination, install, settings };

  /** Próximo vértice a partir do cursor, com as restrições de desenho. */
  const nextCandidate = useCallback(
    (hit: SurfaceHit | null, ctx: PointerContext): Candidate | null => {
      const L = live.current;
      const obj = objectCandidate(ctx);
      if (obj) return obj;
      const last = L.draft[L.draft.length - 1];
      if (!last) {
        if (!hit) return null;
        const off = Math.max(L.size.width, L.size.height) / 2000;
        const p = onWall(hit) ?? (hit.point.map((v, i) => v + hit.normal[i] * off) as Vec3);
        // Eletroduto: começa já na cota da instalação (piso, laje ou aparente).
        const y = conduitY(p[0], p[2], floorAt(hit.point[1] - 0.1));
        if (y != null) return { point: [p[0], y, p[2]], snap: "superficie", label: INSTALL_LABEL[L.install.mode] };
        return { point: p, snap: "superficie", label: "superfície" };
      }
      if (ctx.shift) {
        // Vertical: plano vertical pelo último vértice, voltado para a câmera.
        const n: Vec3 = [ctx.ray.direction[0], 0, ctx.ray.direction[2]];
        const p = intersectRayPlane(ctx.ray.origin, ctx.ray.direction, last, n);
        if (!p) return null;
        return { point: [last[0], last[1] + roundStep(p[1] - last[1]), last[2]], snap: "plano", label: "vertical" };
      }
      // Instalação de parede: acompanha a face da parede, na mesma cota.
      const w = onWall(hit);
      if (w) return { point: [w[0], last[1], w[2]], snap: "superficie", label: INSTALL_LABEL[L.install.mode] };
      let p = intersectRayPlane(ctx.ray.origin, ctx.ray.direction, last, [0, 1, 0]);
      if (!p && hit) p = [hit.point[0], last[1], hit.point[2]];
      if (!p) return null;
      if (isConduitType(L.type)) {
        // Rígido: curvas de 45° e 90°; flexível: curvatura livre.
        if (!L.type.flexible) p = angleSnap(last, p, L.ortho ? 90 : 45);
      } else if (L.ortho) p = orthoSnap(last, p);
      return {
        point: [last[0] + roundStep(p[0] - last[0]), last[1], last[2] + roundStep(p[2] - last[2])],
        snap: "plano",
        label: "plano de trabalho",
      };
    },
    [objectCandidate, conduitY, floorAt, onWall],
  );

  /**
   * Primeiro vértice num ponto locado: o eletroduto sai do ponto e sobe (ou desce)
   * pela parede até a cota da instalação, e daí segue no plano horizontal.
   */
  const startAt = useCallback(
    (c: Candidate): Vec3[] => {
      if (c.snap !== "ponto") return [c.point];
      const y = conduitY(c.point[0], c.point[2], floorAt(c.point[1]));
      if (y == null || Math.abs(y - c.point[1]) < 0.01) return [c.point];
      return [c.point, [c.point[0], y, c.point[2]]];
    },
    [conduitY, floorAt],
  );

  /** Chegada a um ponto ou trecho: horizontal até a vertical do destino e desce/sobe até ele. */
  const arriveAt = useCallback((last: Vec3, target: Vec3): Vec3[] => {
    const L = live.current;
    if (isConduitType(L.type) && L.type.flexible) return simplify([last, [target[0], last[1], target[2]], target]);
    return manhattanPath(last, target, last[1]);
  }, []);

  const finishRun = useCallback(
    (vertices: Vec3[]) => {
      const L = live.current;
      const v = simplify(vertices);
      if (v.length < 2) return;
      const run: Run = {
        id: newRunId(),
        guid: newGuid(),
        typeId: L.type.id,
        tag: nextRunTag(store.runs, L.type.tagPrefix),
        size: L.size,
        system: L.system.trim(),
        slope: L.slope,
        vertices: L.slope ? applySlope(v, L.slope) : v,
        params: L.type.circuit && L.circuit.trim() ? { Circuito: L.circuit.trim() } : {},
        ...(isConduitType(L.type) ? { install: { ...L.install } } : {}),
      };
      store.addRuns([run]);
      setDraft([]);
    },
    [store],
  );

  /** Caminhos do traçado automático para os pontos selecionados. */
  const autoPaths = useCallback((): Vec3[][] => {
    const L = live.current;
    if (!L.destination || !selectedPoints.length) return [];
    const floorY = floorAt(L.destination.point[1]);
    const elevation = conduitY(L.destination.point[0], L.destination.point[2], floorY) ?? floorY + L.workElevation;
    return autoRoute(
      selectedPoints.map((p) => p.position),
      L.destination.point,
      elevation,
      routeMode,
    );
  }, [selectedPoints, floorAt, routeMode, conduitY]);

  const generateAuto = () => {
    const L = live.current;
    const paths = autoPaths();
    if (!paths.length) return;
    let all = [...store.runs];
    const created: Run[] = [];
    for (const path of paths) {
      const run: Run = {
        id: newRunId(),
        guid: newGuid(),
        typeId: L.type.id,
        tag: nextRunTag(all, L.type.tagPrefix),
        size: L.size,
        system: L.system.trim(),
        slope: L.slope,
        vertices: L.slope ? applySlope(path, L.slope) : path,
        params: L.type.circuit && L.circuit.trim() ? { Circuito: L.circuit.trim() } : {},
        ...(isConduitType(L.type) ? { install: { ...L.install } } : {}),
      };
      all = [...all, run];
      created.push(run);
    }
    store.addRuns(created);
    setStatus(`${created.length} trecho(s) gerado(s), ${formatNumber(created.reduce((s, r) => s + runLength(r), 0), 2)} m no total.`);
  };

  // ---- Modo de edição no visualizador ------------------------------------------------
  const armed = (mode === "desenhar" && drawing) || (mode === "ligar" && pickingDestination);

  useEffect(() => {
    if (!armed) {
      viewer.setPlacementHandler(null);
      return;
    }
    const segPreview = (path: Vec3[], ok = true): PreviewItem[] => {
      const L = live.current;
      const w = L.size.width / 1000;
      const h = L.size.height / 1000;
      const out: PreviewItem[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        out.push({ kind: "segmento", profile: L.type.profile, width: w, height: h, start: path[i], end: path[i + 1], ok });
      }
      for (const v of path) out.push({ kind: "no", profile: L.type.profile, width: w, height: h, position: v, ok });
      return out;
    };

    viewer.setPlacementHandler({
      surface: () => "teto",
      hover(hit, ctx) {
        const L = live.current;
        if (L.mode === "ligar") {
          if (L.pickingDestination) {
            const obj = objectCandidate(ctx);
            setStatus(obj ? `Destino: ${obj.label} — clique para escolher` : "Clique em um ponto locado (ex.: quadro) ou em um trecho existente");
            return obj ? segPreview([obj.point]) : [];
          }
          return [];
        }
        const c = nextCandidate(hit, ctx);
        const last = L.draft[L.draft.length - 1];
        if (!c) {
          setStatus(last ? "Mova o cursor sobre o plano de trabalho" : "Clique em um ponto locado, trecho ou superfície para começar");
          return segPreview(L.draft);
        }
        if (!last) {
          const start = startAt(c);
          setStatus(`Início em ${c.label}${start.length > 1 ? ` · ${start[1][1] > c.point[1] ? "sobe" : "desce"} até a cota ${INSTALL_LABEL[L.install.mode]}` : ""} · clique para começar`);
          return segPreview(start);
        }
        const tail = c.snap === "ponto" || c.snap === "trecho" ? arriveAt(last, c.point) : [last, c.point];
        const legLength = runLength({ vertices: tail } as Run);
        const totalLength = runLength({ vertices: [...L.draft, ...tail.slice(1)] } as Run);
        setStatus(
          `${c.snap === "ponto" || c.snap === "trecho" ? `Ligar a ${c.label} e finalizar` : c.label} · trecho ${formatNumber(legLength, 2)} m · total ${formatNumber(totalLength, 2)} m · Shift = vertical · Enter/duplo clique finaliza`,
        );
        return segPreview([...L.draft, ...tail.slice(1)]);
      },
      click(hit, ctx) {
        const L = live.current;
        if (L.mode === "ligar") {
          if (!L.pickingDestination) return;
          const obj = objectCandidate(ctx);
          if (obj) {
            setDestination(obj);
            setPickingDestination(false);
          }
          return;
        }
        const c = nextCandidate(hit, ctx);
        if (!c) return;
        const last = L.draft[L.draft.length - 1];
        if (!last) {
          setDraft(startAt(c));
          return;
        }
        if (c.snap === "ponto" || c.snap === "trecho") {
          finishRun([...L.draft, ...arriveAt(last, c.point).slice(1)]);
          return;
        }
        if (distance(last, c.point) > 0.001) setDraft([...L.draft, c.point]);
      },
      doubleClick() {
        const L = live.current;
        if (L.mode === "desenhar" && L.draft.length >= 2) finishRun(L.draft);
      },
    });
    return () => viewer.setPlacementHandler(null);
  }, [armed, viewer, nextCandidate, objectCandidate, finishRun, autoPaths, startAt, arriveAt]);

  // Qualquer mudança de configuração atualiza a pré-visualização.
  useEffect(() => viewer.refreshPlacement());

  // Traçado automático proposto, exibido enquanto há destino e pontos selecionados.
  useEffect(() => {
    if (mode !== "ligar") {
      viewer.setStaticPreview([]);
      return;
    }
    const w = size.width / 1000;
    const h = size.height / 1000;
    viewer.setStaticPreview(
      autoPaths().flatMap((path) => [
        ...path.slice(0, -1).map((v, i): PreviewItem => ({ kind: "segmento", profile: type.profile, width: w, height: h, start: v, end: path[i + 1], ok: true })),
        ...path.map((v): PreviewItem => ({ kind: "no", profile: type.profile, width: w, height: h, position: v, ok: true })),
      ]),
    );
  }, [viewer, mode, autoPaths, size, type, destination, workElevation]);
  useEffect(() => () => viewer.setStaticPreview([]), [viewer]);

  const goToWorkElevation = useCallback(() => {
    const last = live.current.draft[live.current.draft.length - 1];
    if (!last) return;
    const y = conduitY(last[0], last[2], floorAt(last[1] - 0.1)) ?? floorAt(last[1]) + live.current.workElevation;
    setDraft([...live.current.draft, [last[0], y, last[2]]]);
  }, [floorAt, conduitY]);

  const files = useProjectFiles(store, model, fileName, () => onSelect([]));

  // ---- Teclado ------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const L = live.current;
      if (e.key === "Escape") {
        // Esc encerra: o trecho em andamento (2+ vértices) é gravado; o app volta a Selecionar.
        if (L.draft.length >= 2) finishRun(L.draft);
        else if (L.draft.length) setDraft([]);
        else if (L.pickingDestination) setPickingDestination(false);
        else setDrawing(false);
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        files.save();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "Enter" && L.draft.length >= 2) finishRun(L.draft);
      else if (e.key === "Backspace" && L.draft.length) setDraft(L.draft.slice(0, -1));
      else if (e.key.toLowerCase() === "e" && !mod && L.draft.length) goToWorkElevation();
      else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        store.redo();
      } else if (e.key === "Delete" && selectedRunIds.length) {
        store.removeRuns(selectedRunIds);
        onSelect([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, files, finishRun, goToWorkElevation, selectedRunIds, onSelect]);

  // ---- Resumo -------------------------------------------------------------------------
  const summary = useMemo(() => {
    const fittings = runFittings(store.runs);
    const groups = new Map<string, { type: RunType; size: string; runs: Run[]; length: number; curvas: number; tes: number }>();
    for (const r of store.runs) {
      const key = `${r.typeId}|${r.size.label}`;
      const g = groups.get(key) ?? { type: RUN_TYPE_BY_ID[r.typeId], size: r.size.label, runs: [], length: 0, curvas: 0, tes: 0 };
      g.runs.push(r);
      g.length += runLength(r);
      groups.set(key, g);
    }
    for (const f of fittings) {
      const g = groups.get(`${f.typeId}|${f.size.label}`);
      if (g) g[f.kind === "curva" ? "curvas" : "tes"] += 1;
    }
    return [...groups.values()];
  }, [store.runs]);

  const boxes = useMemo(() => pullBoxes(store.runs, store.points), [store.runs, store.points]);
  /** Muda a instalação dos eletrodutos selecionados e os leva para a nova cota. */
  const reinstall = (runs: Run[], patch: Partial<ConduitInstall>) => {
    const changes = new Map(
      runs.filter(isConduitRun).map((r) => {
        const inst = { ...(r.install ?? DEFAULT_INSTALL), ...patch };
        const floorY = floorAt(runFloorProbeY(r));
        const mid = r.vertices[Math.floor(r.vertices.length / 2)];
        return [r.id, applyInstall(r, inst, { floorY, slabUnderside: slabAt(mid[0], mid[2], floorY), settings, points: store.points })];
      }),
    );
    store.updateRuns([...changes.keys()], (r) => changes.get(r.id)!);
  };
  /** Ajuste do arranjo de uma caixa: grava em todos os eletrodutos que passam por ela. */
  const setBoxInstall = (runIds: number[], patch: Partial<ConduitInstall>) =>
    store.updateRuns(runIds, (r) => ({ install: { ...(r.install ?? DEFAULT_INSTALL), ...patch } }), `box:${Object.keys(patch).join(",")}`);

  const runElementIds = (runs: Run[]) => runs.flatMap((r) => runSegments(r).map((s) => segmentElementId(r.id, s.index)));

  return (
    <div className="panel-body locacao">
      <div className="panel-head">
        <h2>Traçado</h2>
        <div className="btn-row">
          <button className="btn" onClick={store.undo} disabled={!store.canUndo} title="Desfazer (Ctrl+Z)">
            ↶
          </button>
          <button className="btn" onClick={store.redo} disabled={!store.canRedo} title="Refazer (Ctrl+Y)">
            ↷
          </button>
        </div>
      </div>

      {selectedRuns.length > 0 && (
        <RunEditor runs={selectedRuns} store={store} systems={systems} onDelete={() => (store.removeRuns(selectedRunIds), onSelect([]))} onReinstall={reinstall} />
      )}

      <section className="card">
        <div className="form-grid">
          <label>
            Tipo
            <select value={typeId} onChange={(e) => chooseType(e.target.value)}>
              {GROUPS.filter((g) => RUN_TYPES.some((t) => t.group === g && (!typeIds || typeIds.includes(t.id)))).map((g) => (
                <optgroup key={g} label={g}>
                  {RUN_TYPES.filter((t) => t.group === g && (!typeIds || typeIds.includes(t.id))).map((t) => (
                    <option key={t.id} value={t.id} disabled={!typeAllowed(t, install.mode)}>
                      {t.label}
                      {!typeAllowed(t, install.mode) ? " (só embutido)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Bitola
            <select value={size.label} onChange={(e) => chooseSize(e.target.value)}>
              {type.sizes.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                  {type.profile === "circular" && !s.label.startsWith("Ø") ? ` (Ø${s.width} mm)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sistema
            <input list="systems-list-run" value={system} onChange={(e) => setSystem(e.target.value)} />
          </label>
          {type.circuit && (
            <label>
              Circuito
              <input value={circuit} onChange={(e) => setCircuit(e.target.value)} placeholder="ex.: C3" />
            </label>
          )}
          {!conduit && (
            <label>
              Elevação de trabalho (m, acima do piso)
              <input type="number" step={0.05} value={workElevation} onChange={(e) => setWorkElevation(Number(e.target.value))} />
            </label>
          )}
          {!conduit && (
            <label>
              Declividade (%)
              <input type="number" step={0.5} min={0} value={slope} onChange={(e) => setSlope(Math.max(0, Number(e.target.value)))} />
            </label>
          )}
        </div>
        <datalist id="systems-list-run">
          {systems.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {conduit && <InstallChooser install={install} onChange={chooseInstall} settings={settings} onConfigure={onConfigureInstalls} />}
        <div className="muted small">
          <span className="swatch" style={{ background: DISCIPLINE_BY_ID[type.discipline].color }} /> {type.material}
          {conduit && (type.flexible ? " · flexível: curvatura livre, curva de 90° só na subida/descida" : " · rígido: curvas de 45° e 90°")}
          {type.slopeFor && ` · declividade padrão ${formatNumber(type.slopeFor(size), 1)}% (no sentido do desenho)`}
        </div>

        <div className="segmented">
          <button className={mode === "desenhar" ? "on" : ""} onClick={() => (setMode("desenhar"), setPickingDestination(false))}>
            Desenhar
          </button>
          <button className={mode === "ligar" ? "on" : ""} onClick={() => (setMode("ligar"), setDrawing(false), setDraft([]))}>
            Ligar pontos
          </button>
        </div>

        {mode === "desenhar" ? (
          <div className="mode-body">
            {!(conduit && type.flexible) && (
              <label className="check-row">
                <input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} />{" "}
                {conduit ? "Só 90° (desmarque para permitir curvas de 45°)" : "Ortogonal (trechos em X, Y ou vertical)"}
              </label>
            )}
            <div className="btn-row wrap">
              <button className={`btn ${drawing ? "" : "primary"}`} onClick={() => (setDrawing(!drawing), setDraft([]))}>
                {drawing ? "Parar de desenhar (Esc)" : "Desenhar trecho"}
              </button>
              {drawing && (
                <>
                  <button className="btn" onClick={goToWorkElevation} disabled={!draft.length} title="E">
                    ↕ Ir à elevação de trabalho
                  </button>
                  <button className="btn" onClick={() => setDraft(draft.slice(0, -1))} disabled={!draft.length} title="Backspace">
                    Desfazer vértice
                  </button>
                  <button className="btn" onClick={() => finishRun(draft)} disabled={draft.length < 2} title="Enter">
                    Finalizar
                  </button>
                </>
              )}
            </div>
            {conduit && (
              <p className="muted small">
                Saindo de um ponto locado (ex.: tomada a 30 cm), o eletroduto sobe ou desce pela parede até a cota {INSTALL_LABEL[install.mode]} e
                segue por ela; ao chegar em outro ponto, desce ou sobe até ele.
              </p>
            )}
            <p className="muted small">
              Comece num ponto locado, num trecho (gera tê) ou numa superfície. Os próximos cliques seguem no plano do último vértice; segure Shift
              para subir ou descer. Clicar num ponto ou trecho liga até ele e finaliza.
            </p>
          </div>
        ) : (
          <div className="mode-body">
            <div className="small">
              Origens: <b>{selectedPoints.length}</b> ponto(s) selecionado(s){" "}
              <span className="muted">(selecione na aba Locação, no modelo com Ctrl+clique ou na lista de pontos)</span>
            </div>
            <div className="btn-row wrap">
              <button className="btn" onClick={() => setPickingDestination(true)}>
                {destination ? `Destino: ${destination.label} (trocar)` : "Escolher destino no modelo"}
              </button>
              <select value={routeMode} onChange={(e) => setRouteMode(e.target.value as AutoRouteMode)}>
                <option value="cadeia">Em cadeia (ponto a ponto)</option>
                <option value="individual">Individual (cada ponto ao destino)</option>
              </select>
              <button className="btn primary" onClick={generateAuto} disabled={!destination || !selectedPoints.length}>
                Gerar traçado
              </button>
            </div>
            <p className="muted small">
              Os trechos sobem de cada ponto até a elevação de trabalho, seguem em X e depois em Y do projeto e descem até o destino. Confira as
              interferências depois.
            </p>
          </div>
        )}
      </section>

      {status && (drawing || mode === "ligar") && <div className="status place-status">{status}</div>}

      <section>
        <div className="section-title">Trechos ({store.runs.length})</div>
        {summary.length === 0 ? (
          <p className="muted small">Nenhum trecho ainda.</p>
        ) : (
          <table className="grid-table">
            <thead>
              <tr>
                <th>Tipo / bitola</th>
                <th className="num">Compr.</th>
                <th className="num">Curvas</th>
                <th className="num">Tês</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((g) => (
                <tr key={`${g.type.id}|${g.size}`} className="clickable" onClick={() => onSelect(runElementIds(g.runs), true)} title="Selecionar no modelo">
                  <td>
                    <span className="swatch" style={{ background: DISCIPLINE_BY_ID[g.type.discipline].color }} /> {g.type.label} {g.size}
                    <div className="muted small">{g.runs.map((r) => r.tag).join(", ")}</div>
                  </td>
                  <td className="num">{formatNumber(g.length, 2)} m</td>
                  <td className="num">{g.curvas}</td>
                  <td className="num">{g.tes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {boxes.length > 0 && (
        <section>
          <div className="section-title">Caixas de passagem ({boxes.length})</div>
          <p className="muted small">
            Calculadas pelas regras: até 15 m sem curva, 12 m com 1 curva, 9 m com 2 curvas e no máximo 2 curvas entre caixas; derivações e pontas livres
            também levam caixa.
          </p>
          <table className="grid-table boxes">
            <thead>
              <tr>
                <th>Caixa</th>
                <th>Tipo e medidas</th>
                <th>Arranjo</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => {
                const tubes = store.runs.filter((r) => b.runIds.includes(r.id));
                return (
                  <tr key={b.tag} className="clickable" onClick={() => onSelect([boxElementId(b.index)], true)} title={b.reasons.map((r) => BOX_REASON_LABEL[r]).join(", ")}>
                    <td>
                      <b>{b.tag}</b>
                      <div className="muted small">{tubes.map((r) => `${r.tag} ${r.size.label}`).join(", ")}</div>
                    </td>
                    <td>
                      {b.spec.count > 1 ? `${b.spec.count}× ` : ""}
                      {b.spec.label}
                      <div className="muted small">
                        {boxSizeLabel(b)} · mín. {Math.round(b.spec.required[0])}×{Math.round(b.spec.required[1])} mm
                      </div>
                      {b.spec.warning && <div className="warn-text small">{b.spec.warning}</div>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {b.spec.kind === "alvenaria" ? (
                        <span className="matrix">
                          <input
                            type="number"
                            min={1}
                            title="Tubos na horizontal"
                            value={b.install.matrix?.cols ?? b.runIds.length}
                            onChange={(e) => setBoxInstall(b.runIds, { matrix: { cols: Math.max(1, Number(e.target.value)), rows: b.install.matrix?.rows ?? 1 } })}
                          />
                          ×
                          <input
                            type="number"
                            min={1}
                            title="Tubos na vertical"
                            value={b.install.matrix?.rows ?? 1}
                            onChange={(e) => setBoxInstall(b.runIds, { matrix: { cols: b.install.matrix?.cols ?? b.runIds.length, rows: Math.max(1, Number(e.target.value)) } })}
                          />
                        </span>
                      ) : b.runIds.length > 1 && b.spec.kind !== "condulete" ? (
                        <select value={b.install.layout ?? "horizontal"} onChange={(e) => setBoxInstall(b.runIds, { layout: e.target.value as "horizontal" | "vertical" })}>
                          <option value="horizontal">horizontal</option>
                          <option value="vertical">vertical</option>
                        </select>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <div className="btn-row wrap">
        <button className="btn primary" onClick={files.save} disabled={store.isEmpty} title="Ctrl+S">
          Salvar projeto{store.dirty && !store.isEmpty ? " •" : ""}
        </button>
        <button className="btn" onClick={files.open}>
          Abrir projeto…
        </button>
        <button className="btn" onClick={() => void files.exportIfc()} disabled={store.isEmpty}>
          Exportar IFC
        </button>
      </div>
      {files.message && <div className="status small">{files.message}</div>}
      <p className="muted small">
        Atalhos: Enter finaliza · Backspace desfaz vértice · E vai à elevação de trabalho · Shift = vertical · Esc cancela · Delete exclui
        trechos selecionados.
      </p>
    </div>
  );
}

function RunEditor({
  runs,
  store,
  systems,
  onDelete,
  onReinstall,
}: {
  runs: Run[];
  store: PointsStore;
  systems: string[];
  onDelete: () => void;
  onReinstall: (runs: Run[], patch: Partial<ConduitInstall>) => void;
}) {
  const conduits = runs.every(isConduitRun);
  const modeOf = (r: Run) => r.install?.mode ?? "laje";
  const commonMode = runs.every((r) => modeOf(r) === modeOf(runs[0])) ? modeOf(runs[0]) : "";
  const ids = runs.map((r) => r.id);
  const single = runs.length === 1 ? runs[0] : null;
  const sameType = runs.every((r) => r.typeId === runs[0].typeId);
  const t = RUN_TYPE_BY_ID[runs[0].typeId];
  const commonSize = runs.every((r) => r.size.label === runs[0].size.label) ? runs[0].size.label : "";
  const commonSystem = runs.every((r) => r.system === runs[0].system) ? runs[0].system : "";
  const total = runs.reduce((s, r) => s + runLength(r), 0);
  const circuits = runs.every((r) => RUN_TYPE_BY_ID[r.typeId].circuit);
  const commonCircuit = runs.every((r) => r.params.Circuito === runs[0].params.Circuito) ? String(runs[0].params.Circuito ?? "") : "";

  return (
    <section className="card editor">
      <h3>{single ? `${single.tag} — ${t.label}` : `${runs.length} trechos selecionados`}</h3>
      <div className="muted small">
        Comprimento: {formatNumber(total, 2)} m{single?.slope ? ` · declividade ${formatNumber(single.slope, 1)}%` : ""}
      </div>
      <div className="form-grid">
        {conduits && (
          <label>
            Instalação
            <select value={commonMode} onChange={(e) => e.target.value && onReinstall(runs, { mode: e.target.value as InstallMode })}>
              {!commonMode && <option value="">(várias)</option>}
              {INSTALL_MODES.map((m) => (
                <option key={m} value={m}>
                  {INSTALL_LABEL[m].charAt(0).toUpperCase() + INSTALL_LABEL[m].slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}
        {single && (
          <label>
            Etiqueta
            <input value={single.tag} onChange={(e) => store.updateRuns(ids, () => ({ tag: e.target.value }), "tag")} />
          </label>
        )}
        {sameType && (
          <label>
            Bitola
            <select
              value={commonSize}
              onChange={(e) => {
                const s = t.sizes.find((x) => x.label === e.target.value);
                if (s) store.updateRuns(ids, () => ({ size: s }));
              }}
            >
              {!commonSize && <option value="">(várias)</option>}
              {t.sizes.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Sistema
          <input list="systems-list-run-edit" value={commonSystem} placeholder={commonSystem ? "" : "(vários)"} onChange={(e) => store.updateRuns(ids, () => ({ system: e.target.value }), "system")} />
        </label>
        {circuits && (
          <label>
            Circuito
            <input
              value={commonCircuit}
              placeholder={commonCircuit || single ? "" : "(vários)"}
              onChange={(e) => store.updateRuns(ids, (r) => ({ params: { ...r.params, Circuito: e.target.value } }), "circuito")}
            />
          </label>
        )}
      </div>
      <datalist id="systems-list-run-edit">
        {systems.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="btn-row wrap">
        <button className="btn danger" onClick={onDelete}>
          Excluir{runs.length > 1 ? ` (${runs.length})` : ""}
        </button>
      </div>
    </section>
  );
}

/** Forma de instalação do eletroduto (piso, parede ou teto), com as medidas do empreendimento. */
function InstallChooser({ install, onChange, settings, onConfigure }: { install: ConduitInstall; onChange: (i: ConduitInstall) => void; settings: InstallSettings; onConfigure?: () => void }) {
  const groups: [string, InstallMode[]][] = [
    ["Piso", ["piso", "canaleta"]],
    ["Parede", ["alvenaria", "alvenaria-aparente"]],
    ["Teto", ["entreforro", "laje-aparente", "laje"]],
  ];
  const short: Record<InstallMode, string> = {
    piso: "Embutido no piso",
    canaleta: "Canaleta",
    alvenaria: "Embutido na alvenaria",
    "alvenaria-aparente": "Aparente na alvenaria",
    entreforro: "Entreforro",
    "laje-aparente": "Aparente na laje",
    laje: "Embutido na laje",
  };
  return (
    <div className="install-chooser">
      <div className="field-label">Instalação</div>
      {groups.map(([g, modes]) => (
        <div key={g} className="install-row">
          <span className="install-zone">{g}</span>
          <div className="segmented small">
            {modes.map((m) => (
              <button key={m} className={install.mode === m ? "on" : ""} onClick={() => onChange({ ...install, mode: m })}>
                {short[m]}
              </button>
            ))}
          </div>
        </div>
      ))}
      {install.mode === "piso" && (
        <div className="options">
          <label>
            <input type="checkbox" checked={!!install.external} onChange={(e) => onChange({ ...install, external: e.target.checked })} /> Rede externa (caixas em
            alvenaria)
          </label>
          {!install.external && (
            <label title='Caixa de piso interno: só 4×4" com eletroduto até 1"'>
              Acima de 1":
              <select value={install.floorLarge ?? "alvenaria"} onChange={(e) => onChange({ ...install, floorLarge: e.target.value as "alvenaria" | "parede" })}>
                <option value="alvenaria">caixa em alvenaria</option>
                <option value="parede">caixa na parede (camada única)</option>
              </select>
            </label>
          )}
        </div>
      )}
      <div className="muted small">
        {installSummary(install.mode, settings)}.{" "}
        {isApparentMode(install.mode) ? "Só eletroduto rígido (PVC ou aço)." : "PVC/PEAD flexível permitido."}{" "}
        {(install.mode === "alvenaria" || install.mode === "alvenaria-aparente" || (install.mode === "canaleta" && settings.canaleta.local === "parede")) &&
          "Clique na face da parede: o traçado acompanha a parede."}{" "}
        {onConfigure && (
          <button className="link" onClick={onConfigure}>
            medidas do empreendimento…
          </button>
        )}
      </div>
    </div>
  );
}
