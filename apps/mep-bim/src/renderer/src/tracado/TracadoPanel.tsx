import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import { formatNumber } from "../../../core/format";
import { intersectRayPlane } from "../../../core/math";
import type { SurfaceHit } from "../../../core/placement";
import { newGuid, storeyAt } from "../../../core/points";
import {
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
import type { Vec3 } from "../../../core/types";
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

export function TracadoPanel({ model, fileName, store, viewer, selection, onSelect, systems }: Props) {
  const [typeId, setTypeId] = useState("eletroduto-pvc");
  const type = RUN_TYPE_BY_ID[typeId];
  const [sizeLabel, setSizeLabel] = useState(type.defaultSize);
  const size = type.sizes.find((s) => s.label === sizeLabel) ?? type.sizes[0];
  const [system, setSystem] = useState(type.system);
  const [circuit, setCircuit] = useState("");
  const [slope, setSlope] = useState(type.slopeFor?.(size) ?? 0);
  const [workElevation, setWorkElevation] = useState(2.8);
  const [ortho, setOrtho] = useState(true);
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
  const chooseSize = (label: string) => {
    setSizeLabel(label);
    const s = type.sizes.find((x) => x.label === label);
    if (s && type.slopeFor) setSlope(type.slopeFor(s));
  };

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

  // Estado mais recente para os callbacks do visualizador.
  const live = useRef({ type, size, system, circuit, slope, workElevation, ortho, draft, mode, destination, pickingDestination });
  live.current = { type, size, system, circuit, slope, workElevation, ortho, draft, mode, destination, pickingDestination };

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
        return { point: hit.point.map((v, i) => v + hit.normal[i] * off) as Vec3, snap: "superficie", label: "superfície" };
      }
      if (ctx.shift) {
        // Vertical: plano vertical pelo último vértice, voltado para a câmera.
        const n: Vec3 = [ctx.ray.direction[0], 0, ctx.ray.direction[2]];
        const p = intersectRayPlane(ctx.ray.origin, ctx.ray.direction, last, n);
        if (!p) return null;
        return { point: [last[0], last[1] + roundStep(p[1] - last[1]), last[2]], snap: "plano", label: "vertical" };
      }
      let p = intersectRayPlane(ctx.ray.origin, ctx.ray.direction, last, [0, 1, 0]);
      if (!p && hit) p = [hit.point[0], last[1], hit.point[2]];
      if (!p) return null;
      if (L.ortho) p = orthoSnap(last, p);
      return {
        point: [last[0] + roundStep(p[0] - last[0]), last[1], last[2] + roundStep(p[2] - last[2])],
        snap: "plano",
        label: "plano de trabalho",
      };
    },
    [objectCandidate],
  );

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
    const elevation = floorAt(L.destination.point[1]) + L.workElevation;
    return autoRoute(
      selectedPoints.map((p) => p.position),
      L.destination.point,
      elevation,
      routeMode,
    );
  }, [selectedPoints, floorAt, routeMode]);

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
          setStatus(`Início em ${c.label} · clique para começar`);
          return segPreview([c.point]);
        }
        const tail = c.snap === "ponto" || c.snap === "trecho" ? manhattanPath(last, c.point, last[1]) : [last, c.point];
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
          setDraft([c.point]);
          return;
        }
        if (c.snap === "ponto" || c.snap === "trecho") {
          finishRun([...L.draft, ...manhattanPath(last, c.point, last[1]).slice(1)]);
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
  }, [armed, viewer, nextCandidate, objectCandidate, finishRun, autoPaths]);

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
    const y = floorAt(last[1]) + live.current.workElevation;
    setDraft([...live.current.draft, [last[0], y, last[2]]]);
  }, [floorAt]);

  const files = useProjectFiles(store, model, fileName, () => onSelect([]));

  // ---- Teclado ------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const L = live.current;
      if (e.key === "Escape") {
        if (L.draft.length) setDraft([]);
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

      {selectedRuns.length > 0 && <RunEditor runs={selectedRuns} store={store} systems={systems} onDelete={() => (store.removeRuns(selectedRunIds), onSelect([]))} />}

      <section className="card">
        <div className="form-grid">
          <label>
            Tipo
            <select value={typeId} onChange={(e) => chooseType(e.target.value)}>
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {RUN_TYPES.filter((t) => t.group === g).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
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
          <label>
            Elevação de trabalho (m, acima do piso)
            <input type="number" step={0.05} value={workElevation} onChange={(e) => setWorkElevation(Number(e.target.value))} />
          </label>
          <label>
            Declividade (%)
            <input type="number" step={0.5} min={0} value={slope} onChange={(e) => setSlope(Math.max(0, Number(e.target.value)))} />
          </label>
        </div>
        <datalist id="systems-list-run">
          {systems.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <div className="muted small">
          <span className="swatch" style={{ background: DISCIPLINE_BY_ID[type.discipline].color }} /> {type.material}
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
            <label className="check-row">
              <input type="checkbox" checked={ortho} onChange={(e) => setOrtho(e.target.checked)} /> Ortogonal (trechos em X, Y ou vertical)
            </label>
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

      <div className="btn-row wrap">
        <button className="btn primary" onClick={files.save} disabled={store.isEmpty} title="Ctrl+S">
          Salvar projeto{store.dirty && !store.isEmpty ? " •" : ""}
        </button>
        <button className="btn" onClick={files.open}>
          Abrir projeto…
        </button>
        <button className="btn" onClick={files.exportIfc} disabled={store.isEmpty}>
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

function RunEditor({ runs, store, systems, onDelete }: { runs: Run[]; store: PointsStore; systems: string[]; onDelete: () => void }) {
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
