import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import { formatNumber } from "../../../core/format";
import { COMPONENTS, COMPONENT_BY_ID, COMPONENT_GROUPS, MOUNTING_LABEL, type ComponentDef } from "../../../core/library";
import {
  CEILING_REF_LABEL,
  computePlacement,
  countForSpacing,
  DEFAULT_CEILING,
  elevationFor,
  gridPoints,
  sizeMeters,
  type CeilingMount,
  type CeilingRef,
  type Placement,
  type SurfaceHit,
} from "../../../core/placement";
import { floorLevelAt, makeCeilingResolver } from "./ceiling";
import { assemblySize, defaultAssembly, supportsAssembly, type DeviceAssembly } from "../../../core/devices";
import { AssemblyEditor } from "./AssemblyEditor";
import {
  defaultParams,
  heightLabel,
  newGuid,
  newPointId,
  nextTag,
  storeyAt,
  storeyForMounting,
  type PlacedPoint,
} from "../../../core/points";
import type { CoordinateSystem } from "../../../core/math";
import type { ElementInfo } from "../../../core/types";
import type { LoadedModel } from "../../../ifc/loadIfc";
import type { PreviewItem, Viewer } from "../viewer/Viewer";
import type { PointsStore } from "./usePointsStore";
import { useProjectFiles } from "./useProjectFiles";
import { AmbientesSection } from "./AmbientesSection";
import { spaceAt, spaceLabel } from "../../../core/spaces";

interface Props {
  model: LoadedModel;
  fileName: string | null;
  store: PointsStore;
  viewer: Viewer;
  elementById: Map<number, ElementInfo>;
  selection: number[];
  onSelect: (ids: number[], frame?: boolean) => void;
  systems: string[];
  /** Grupos da biblioteca exibidos (disciplina ativa); todos se omitido. */
  groups?: string[];
  /** Componente escolhido na faixa de ferramentas (n muda a cada clique). */
  preset?: { componentId: string; n: number } | null;
}

type Mode = "ponto" | "area" | "ambiente";
type AreaBy = "quantidade" | "espacamento";

const SNAP_OPTIONS = [0, 10, 50, 100, 250];
const MAX_AREA_POINTS = 400;
const FLOOR_TYPES = new Set(["IFCSLAB", "IFCCOVERING", "IFCROOF", "IFCRAMP", "IFCSTAIRFLIGHT"]);

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);

export function LocacaoPanel({ model, fileName, store, viewer, elementById, selection, onSelect, systems, groups, preset }: Props) {
  const [componentId, setComponentId] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const [ceiling, setCeiling] = useState<CeilingMount>(DEFAULT_CEILING);
  /** Tomadas e interruptores: caixa/condulete e módulos dos próximos pontos. */
  const [assembly, setAssembly] = useState<DeviceAssembly | null>(null);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [snapMm, setSnapMm] = useState(50);
  const [system, setSystem] = useState("");
  const [params, setParams] = useState<Record<string, string | number>>({});
  const [mode, setMode] = useState<Mode>("ponto");
  const [selectedSpaces, setSelectedSpaces] = useState<number[]>([]);
  const [areaBy, setAreaBy] = useState<AreaBy>("quantidade");
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [spacing, setSpacing] = useState(2.5);
  const [corner, setCorner] = useState<SurfaceHit | null>(null);
  const [moveId, setMoveId] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const def = componentId ? COMPONENT_BY_ID[componentId] : null;
  const points = store.points;
  const movingPoint = moveId != null ? points.find((p) => p.id === moveId) ?? null : null;
  const selectedPoints = useMemo(() => points.filter((p) => selection.includes(p.id)), [points, selection]);

  const selectComponent = (id: string | null) => {
    setComponentId(id);
    setCorner(null);
    setMoveId(null);
    if (!id) return;
    const d = COMPONENT_BY_ID[id];
    setHeight(d.defaultHeight);
    setSystem(d.system);
    setParams(defaultParams(d));
    setAssembly(defaultAssembly(d));
    setMode("ponto");
  };

  // Ferramenta escolhida na faixa superior: seleciona o componente e já ativa a locação.
  useEffect(() => {
    if (preset) selectComponent(preset.componentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.n]);

  // ---- Cálculo da posição ----------------------------------------------------
  const acceptFloor = useCallback((id: number) => FLOOR_TYPES.has(elementById.get(id)?.ifcType ?? ""), [elementById]);

  const resolveCeiling = useMemo(() => makeCeilingResolver(viewer, elementById, model.storeyLevels), [viewer, elementById, model.storeyLevels]);

  const place = useCallback(
    (d: ComponentDef, hit: SurfaceHit, h: number, rotation: number, snap: number, mount: CeilingMount = DEFAULT_CEILING, asm?: DeviceAssembly | null): Placement => {
      // Tomadas/interruptores: a profundidade é a da caixa embutida ou do condulete aparente.
      const a = asm !== undefined ? asm : live.current.assembly;
      if (a && supportsAssembly(d)) d = { ...d, size: assemblySize(a) };
      let floorLevel = 0;
      if (d.mounting === "parede") {
        const floor = viewer.floorBelow(hit.point, hit.normal, acceptFloor);
        const storey = storeyAt(hit.point[1], model.storeyLevels);
        floorLevel = floor ?? model.storeyLevels.find((s) => s.name === storey)?.level ?? 0;
      }
      if (d.mounting === "teto" && hit.normal[1] < -0.7) {
        // Forro, entreforro ou laje: o plano de referência vem do modelo ou da altura informada.
        const floorY = floorLevelAt(hit.point[1], model.storeyLevels);
        const y = resolveCeiling(d, mount, hit.point[0], hit.point[2], floorY);
        hit = { point: [hit.point[0], y, hit.point[2]], normal: [0, -1, 0] };
        if (mount.ref === "entreforro") h = 0;
      }
      return computePlacement(d, hit, { height: h, rotation, snap, floorLevel });
    },
    [viewer, acceptFloor, model.storeyLevels, resolveCeiling],
  );

  // Estado mais recente para os callbacks do visualizador (sem reinstalar o modo a cada mudança).
  const live = useRef({ assembly, ceiling, def, height, rotationDeg, snapMm, system, params, mode, areaBy, rows, cols, spacing, corner, movingPoint, points, selectedSpaces });
  live.current = { assembly, ceiling, def, height, rotationDeg, snapMm, system, params, mode, areaBy, rows, cols, spacing, corner, movingPoint, points, selectedSpaces };

  const gridFor = useCallback(
    (c: SurfaceHit, hit: SurfaceHit): Placement[] => {
      const L = live.current;
      const d = L.def!;
      const p1 = c.point;
      const p2: typeof p1 = [hit.point[0], p1[1], hit.point[2]];
      const r = L.areaBy === "quantidade" ? L.rows : countForSpacing(p2[2] - p1[2], L.spacing);
      const k = L.areaBy === "quantidade" ? L.cols : countForSpacing(p2[0] - p1[0], L.spacing);
      if (r * k > MAX_AREA_POINTS) return [];
      return gridPoints(p1, p2, r, k).map((gp) => place(d, { point: gp, normal: c.normal }, L.height, (L.rotationDeg * Math.PI) / 180, 0, L.ceiling));
    },
    [place],
  );

  const toPlan = (v: [number, number, number]): [number, number] => {
    const p = model.coordinates.worldToIfc(v);
    return [p[0], p[1]];
  };

  const buildPoints = (d: ComponentDef, placements: Placement[]): PlacedPoint[] => {
    const L = live.current;
    const all = [...L.points];
    const out: PlacedPoint[] = [];
    for (const pl of placements) {
      const room = spaceAt(model.spaces, toPlan, pl.position);
      const p: PlacedPoint = {
        id: newPointId(),
        guid: newGuid(),
        componentId: d.id,
        tag: nextTag(all, d.tagPrefix),
        position: pl.position,
        rotation: pl.rotation,
        height: d.mounting === "teto" && L.ceiling.ref === "entreforro" ? 0 : L.height,
        refLevel: pl.refLevel,
        ...(d.mounting === "teto" ? { ceiling: { ...L.ceiling } } : {}),
        ...(L.assembly && supportsAssembly(d) ? { assembly: { ...L.assembly, modules: [...L.assembly.modules] } } : {}),
        storey: storeyForMounting(d.mounting, pl.refLevel, model.storeyLevels),
        system: L.system.trim(),
        params: { ...L.params, ...(room ? { Ambiente: spaceLabel(room) } : {}) },
      };
      all.push(p);
      out.push(p);
    }
    return out;
  };

  const armed = def != null || movingPoint != null;

  useEffect(() => {
    if (!armed) {
      viewer.setPlacementHandler(null);
      setStatus("");
      return;
    }
    const preview = (d: ComponentDef, pl: Placement, asm?: DeviceAssembly | null): PreviewItem => ({
      shape: d.shape,
      size: sizeMeters(asm && supportsAssembly(d) ? { ...d, size: assemblySize(asm) } : d),
      position: pl.position,
      rotation: pl.rotation,
      ok: pl.ok,
      mesh: d.mesh,
    });

    viewer.setPlacementHandler({
      surface() {
        const L = live.current;
        return (L.movingPoint ? COMPONENT_BY_ID[L.movingPoint.componentId] : L.def!).mounting;
      },
      hover(hit) {
        const L = live.current;
        const mp = L.movingPoint;
        const d = mp ? COMPONENT_BY_ID[mp.componentId] : L.def!;
        if (!hit) {
          setStatus(instructions(d, L.mode, L.corner != null, mp != null));
          return [];
        }
        if (!mp && L.mode === "ambiente") {
          const room = spaceAt(model.spaces, toPlan, hit.point);
          setStatus(room ? `${spaceLabel(room)} — clique para ${L.selectedSpaces.includes(room.expressID) ? "desmarcar" : "marcar"}` : "Aponte para um ambiente");
          return [];
        }
        if (!mp && L.mode === "area" && L.corner) {
          const grid = gridFor(L.corner, hit);
          setStatus(grid.length ? `${grid.length} pontos · clique para confirmar a área · Esc cancela` : `Mais de ${MAX_AREA_POINTS} pontos: aumente o espaçamento.`);
          return grid.map((pl) => preview(d, pl, L.assembly));
        }
        const pl = mp
          ? place(d, hit, mp.height, mp.rotation, L.snapMm / 1000, mp.ceiling ?? L.ceiling, mp.assembly ?? null)
          : place(d, hit, L.height, (L.rotationDeg * Math.PI) / 180, L.snapMm / 1000, L.ceiling);
        if (!pl.ok) setStatus(pl.reason ?? "");
        else {
          const storey = storeyForMounting(d.mounting, pl.refLevel, model.storeyLevels);
          setStatus(`${mp ? `Mover ${mp.tag}` : d.label} · ${storey ?? "sem pavimento"} · ${instructions(d, L.mode, L.corner != null, mp != null)}`);
        }
        return [preview(d, pl, mp ? (mp.assembly ?? null) : L.assembly)];
      },
      click(hit) {
        if (!hit) return;
        const L = live.current;
        const mp = L.movingPoint;
        if (mp) {
          const d = COMPONENT_BY_ID[mp.componentId];
          const mount = mp.ceiling ?? L.ceiling;
          const pl = place(d, hit, mp.height, mp.rotation, L.snapMm / 1000, mount, mp.assembly ?? null);
          if (!pl.ok) return;
          store.update([mp.id], () => ({
            ...(d.mounting === "teto" ? { ceiling: mount, height: mount.ref === "entreforro" ? 0 : mp.height } : {}),
            position: pl.position,
            rotation: pl.rotation,
            refLevel: pl.refLevel,
            storey: storeyForMounting(d.mounting, pl.refLevel, model.storeyLevels),
          }));
          setMoveId(null);
          return;
        }
        const d = L.def!;
        if (L.mode === "ambiente") {
          const room = spaceAt(model.spaces, toPlan, hit.point);
          if (room) {
            setSelectedSpaces((cur) => (cur.includes(room.expressID) ? cur.filter((x) => x !== room.expressID) : [...cur, room.expressID]));
          }
          return;
        }
        if (L.mode === "area") {
          if (!L.corner) {
            const pl = place(d, hit, L.height, 0, L.snapMm / 1000, L.ceiling);
            if (!pl.ok) return;
            const snapped: SurfaceHit = { point: [pl.position[0], hit.point[1], pl.position[2]], normal: hit.normal };
            setCorner(snapped);
            return;
          }
          const grid = gridFor(L.corner, hit).filter((pl) => pl.ok);
          if (!grid.length) return;
          store.add(buildPoints(d, grid));
          setCorner(null);
          return;
        }
        const pl = place(d, hit, L.height, (L.rotationDeg * Math.PI) / 180, L.snapMm / 1000, L.ceiling);
        if (pl.ok) store.add(buildPoints(d, [pl]));
      },
    });
    return () => viewer.setPlacementHandler(null);
  }, [armed, viewer, place, gridFor, store.add, store.update, model.storeyLevels]);

  // Qualquer mudança de configuração atualiza a pré-visualização.
  useEffect(() => viewer.refreshPlacement());

  // ---- Arquivos ---------------------------------------------------------------
  const files = useProjectFiles(store, model, fileName, () => onSelect([]));
  const saveLocacao = files.save;

  // ---- Teclado ------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        if (live.current.corner) setCorner(null);
        else if (live.current.movingPoint) setMoveId(null);
        else setComponentId(null);
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveLocacao();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        store.redo();
      } else if (!mod && e.key.toLowerCase() === "r") {
        setRotationDeg((d) => (d + 90) % 360);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const ids = selection.filter((id) => id < 0);
        if (ids.length) {
          store.remove(ids);
          onSelect(selection.filter((id) => id >= 0));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, selection, onSelect, saveLocacao]);

  // ---- Resumo -------------------------------------------------------------------
  const summary = useMemo(() => {
    const map = new Map<string, PlacedPoint[]>();
    for (const p of points) map.set(p.componentId, [...(map.get(p.componentId) ?? []), p]);
    return COMPONENTS.filter((c) => map.has(c.id)).map((c) => ({ def: c, items: map.get(c.id)! }));
  }, [points]);

  const q = search.trim().toLowerCase();
  const filteredComponents = COMPONENTS.filter((c) => (!groups || groups.includes(c.group)) && (!q || `${c.label} ${c.group}`.toLowerCase().includes(q)));

  return (
    <div className="panel-body locacao">
      <div className="panel-head">
        <h2>Locação de pontos</h2>
        <div className="btn-row">
          <button className="btn" onClick={store.undo} disabled={!store.canUndo} title="Desfazer (Ctrl+Z)">
            ↶
          </button>
          <button className="btn" onClick={store.redo} disabled={!store.canRedo} title="Refazer (Ctrl+Y)">
            ↷
          </button>
        </div>
      </div>

      {selectedPoints.length > 0 && (
        <PointEditor
          points={selectedPoints}
          systems={systems}
          store={store}
          coordinates={model.coordinates}
          onMove={(id) => {
            setComponentId(null);
            setMoveId(id);
          }}
          onDelete={(ids) => {
            store.remove(ids);
            onSelect(selection.filter((id) => !ids.includes(id)));
          }}
        />
      )}

      <section className="lib">
        <div className="section-title">Biblioteca</div>
        <input className="search" type="search" placeholder="Buscar componente…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {COMPONENT_GROUPS.map((g) => {
          const items = filteredComponents.filter((c) => c.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="lib-group">
              <div className="lib-group-title">{g}</div>
              <div className="lib-grid">
                {items.map((c) => (
                  <button key={c.id} className={`lib-item ${componentId === c.id ? "on" : ""}`} onClick={() => selectComponent(componentId === c.id ? null : c.id)} title={`${c.label} · ${MOUNTING_LABEL[c.mounting]}`}>
                    <span className="swatch" style={{ background: DISCIPLINE_BY_ID[c.discipline].color }} />
                    <span className="grow">{c.label}</span>
                    {c.source && <span className="tag-revit">Revit</span>}
                    <span className="muted small">{c.mounting === "parede" ? `${c.defaultHeight}` : MOUNTING_LABEL[c.mounting].split(" ")[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {def && (
        <section className="card place-config">
          <h3>
            <span className="swatch" style={{ background: DISCIPLINE_BY_ID[def.discipline].color }} /> {def.label}
          </h3>
          <div className="muted small">
            Fixação em {MOUNTING_LABEL[def.mounting]} · {def.size.join("×")} mm · etiqueta {def.tagPrefix}n
          </div>
          {assembly && supportsAssembly(def) && (
            <div className="assembly-config">
              <div className="field-label">Montagem</div>
              <AssemblyEditor value={assembly} onChange={setAssembly} />
            </div>
          )}
          {def.mounting === "teto" && (
            <div className="ceiling-ref">
              <div className="field-label">Alinhamento no teto</div>
              <div className="segmented">
                {(Object.keys(CEILING_REF_LABEL) as CeilingRef[]).map((r) => (
                  <button
                    key={r}
                    className={ceiling.ref === r ? "on" : ""}
                    onClick={() => setCeiling({ ref: r, level: r === "entreforro" ? (ceiling.ref === "entreforro" ? ceiling.level : 2800) : ceiling.ref === "forro" ? ceiling.level : 2600 })}
                    title={CEILING_REF_LABEL[r]}
                  >
                    {r === "forro" ? "Forro" : r === "entreforro" ? "Entreforro" : "Laje"}
                  </button>
                ))}
              </div>
              <div className="muted small">
                {ceiling.ref === "forro" && "Rente ao forro do modelo (IfcCovering). Onde não houver forro, usa a altura abaixo."}
                {ceiling.ref === "entreforro" && "No espaço entre o forro e a laje: o fundo do item fica na altura informada."}
                {ceiling.ref === "laje" && "Encostado na face inferior da laje superior (IfcSlab)."}
              </div>
            </div>
          )}
          <div className="form-grid">
            {def.mounting === "teto" && ceiling.ref !== "laje" && (
              <label>
                {ceiling.ref === "forro" ? "Altura do forro (m)" : "Altura do fundo (m)"}
                <input
                  type="number"
                  step={0.05}
                  value={ceiling.level / 1000}
                  onChange={(e) => setCeiling({ ...ceiling, level: Math.round(Number(e.target.value) * 1000) })}
                  title="Acima do piso acabado do pavimento"
                />
              </label>
            )}
            {!(def.mounting === "teto" && ceiling.ref === "entreforro") && (
              <label>
                {heightLabel(def)} (mm)
                <input type="number" value={height} step={10} onChange={(e) => setHeight(Number(e.target.value))} />
              </label>
            )}
            <label>
              Sistema
              <input list="systems-list" value={system} onChange={(e) => setSystem(e.target.value)} />
            </label>
            <label>
              Arredondar posição
              <select value={snapMm} onChange={(e) => setSnapMm(Number(e.target.value))}>
                {SNAP_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s ? `${s} mm` : "livre"}
                  </option>
                ))}
              </select>
            </label>
            {def.mounting !== "parede" && (
              <label>
                Rotação (R)
                <select value={rotationDeg} onChange={(e) => setRotationDeg(Number(e.target.value))}>
                  {[0, 90, 180, 270].map((r) => (
                    <option key={r} value={r}>
                      {r}°
                    </option>
                  ))}
                </select>
              </label>
            )}
            {def.params.map((p) => (
              <label key={p.name}>
                {p.name}
                {p.unit ? ` (${p.unit})` : ""}
                <input
                  type={typeof p.default === "number" ? "number" : "text"}
                  value={params[p.name] ?? ""}
                  onChange={(e) => setParams({ ...params, [p.name]: typeof p.default === "number" ? Number(e.target.value) : e.target.value })}
                />
              </label>
            ))}
          </div>
          <datalist id="systems-list">
            {systems.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          <div className="segmented">
            <button className={mode === "ponto" ? "on" : ""} onClick={() => (setMode("ponto"), setCorner(null))}>
              Pontual
            </button>
            {def.mounting !== "parede" && (
              <button className={mode === "area" ? "on" : ""} onClick={() => setMode("area")}>
                Distribuir em área
              </button>
            )}
            {model.spaces.length > 0 && (
              <button className={mode === "ambiente" ? "on" : ""} onClick={() => (setMode("ambiente"), setCorner(null))}>
                Por ambiente
              </button>
            )}
          </div>
          {mode === "ambiente" && (
            <AmbientesSection
              model={model}
              viewer={viewer}
              def={def}
              height={height}
              ceiling={ceiling}
              resolveCeiling={resolveCeiling}
              rotationDeg={rotationDeg}
              params={params}
              selected={selectedSpaces}
              onSelectedChange={setSelectedSpaces}
              existing={points}
              onCreate={(items) => store.add(buildPoints(def, items.map((i) => i.placement)))}
            />
          )}
          {def.mounting !== "parede" && (
            <>
              {mode === "area" && (
                <div className="form-grid">
                  <label>
                    Distribuir por
                    <select value={areaBy} onChange={(e) => setAreaBy(e.target.value as AreaBy)}>
                      <option value="quantidade">Linhas × colunas</option>
                      <option value="espacamento">Espaçamento máximo</option>
                    </select>
                  </label>
                  {areaBy === "quantidade" ? (
                    <>
                      <label>
                        Linhas
                        <input type="number" min={1} value={rows} onChange={(e) => setRows(Math.max(1, Number(e.target.value)))} />
                      </label>
                      <label>
                        Colunas
                        <input type="number" min={1} value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value)))} />
                      </label>
                    </>
                  ) : (
                    <label>
                      Espaçamento máx. (m)
                      <input type="number" min={0.1} step={0.1} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} />
                    </label>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {armed && <div className="status place-status">{status || instructions(def ?? COMPONENT_BY_ID[movingPoint!.componentId], mode, corner != null, movingPoint != null)}</div>}

      <section>
        <div className="section-title">Pontos locados ({points.length})</div>
        {summary.length === 0 ? (
          <p className="muted small">Escolha um componente na biblioteca e clique no modelo para locar.</p>
        ) : (
          <table className="grid-table">
            <tbody>
              {summary.map(({ def: c, items }) => (
                <tr key={c.id} className="clickable" onClick={() => onSelect(items.map((p) => p.id), true)} title="Selecionar no modelo">
                  <td>
                    <span className="swatch" style={{ background: DISCIPLINE_BY_ID[c.discipline].color }} /> {c.label}
                    <div className="muted small">{items.map((p) => p.tag).join(", ")}</div>
                  </td>
                  <td className="num">{items.length} un</td>
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
        <button className="btn" onClick={() => void files.exportIfc()} disabled={store.isEmpty}>
          Exportar IFC
        </button>
      </div>
      {files.message && <div className="status small">{files.message}</div>}
      <p className="muted small">
        Atalhos: Esc encerra · R gira (teto e piso) · Delete exclui · Ctrl+Z / Ctrl+Y · Ctrl+S salva. Pontos aparecem também em Quantitativos e
        Interferências.
      </p>
    </div>
  );
}

function instructions(d: ComponentDef, mode: Mode, hasCorner: boolean, moving: boolean): string {
  if (moving) return "Clique no novo local · Esc cancela";
  if (mode === "ambiente") return "Marque os ambientes na lista ou clicando neles na planta";
  const where = d.mounting === "parede" ? "em uma parede" : d.mounting === "teto" ? "no teto/forro" : "no piso";
  if (d.mounting !== "parede" && mode === "area") return hasCorner ? "Clique no canto oposto da área" : `Clique no primeiro canto da área ${where}`;
  return `Clique ${where} para locar · Esc encerra`;
}

function PointEditor({
  points,
  systems,
  store,
  coordinates,
  onMove,
  onDelete,
}: {
  points: PlacedPoint[];
  systems: string[];
  store: PointsStore;
  coordinates: CoordinateSystem;
  onMove: (id: number) => void;
  onDelete: (ids: number[]) => void;
}) {
  const ids = points.map((p) => p.id);
  const single = points.length === 1 ? points[0] : null;
  const d = single ? COMPONENT_BY_ID[single.componentId] : null;
  const commonSystem = points.every((p) => p.system === points[0].system) ? points[0].system : "";
  const allHaveCircuit = points.every((p) => "Circuito" in p.params);
  const commonCircuit = allHaveCircuit && points.every((p) => p.params.Circuito === points[0].params.Circuito) ? String(points[0].params.Circuito ?? "") : "";

  return (
    <section className="card editor">
      <h3>{single ? `${single.tag} — ${d!.label}` : `${points.length} pontos selecionados`}</h3>
      {single && (
        <div className="muted small">
          {single.storey ?? "sem pavimento"} · fixação em {MOUNTING_LABEL[d!.mounting]}
        </div>
      )}
      <div className="form-grid">
        {single && (
          <label>
            Etiqueta
            <input value={single.tag} onChange={(e) => store.update(ids, () => ({ tag: e.target.value }), "tag")} />
          </label>
        )}
        <label>
          Sistema
          <input list="systems-list-edit" value={commonSystem} placeholder={commonSystem ? "" : "(vários)"} onChange={(e) => store.update(ids, () => ({ system: e.target.value }), "system")} />
        </label>
        {allHaveCircuit && (
          <label>
            Circuito
            <input
              disabled={points.some((p) => p.circuit)}
              title={points.some((p) => p.circuit) ? "Circuito gerenciado na aba Circuitos" : undefined}
              value={commonCircuit}
              placeholder={commonCircuit || points.length === 1 ? "" : "(vários)"}
              onChange={(e) => store.update(ids, (p) => ({ params: { ...p.params, Circuito: e.target.value } }), "circuito")}
            />
          </label>
        )}
        {single && d && (
          <label>
            {heightLabel(d)} (mm)
            <input
              type="number"
              step={10}
              value={single.height}
              onChange={(e) => {
                const h = Number(e.target.value);
                store.update(ids, (p) => ({ height: h, position: [p.position[0], elevationFor(d, p.refLevel, h), p.position[2]] }), "height");
              }}
            />
          </label>
        )}
        {single &&
          d?.params
            .filter((p) => p.name !== "Circuito")
            .map((p) => (
              <label key={p.name}>
                {p.name}
                {p.unit ? ` (${p.unit})` : ""}
                <input
                  type={typeof p.default === "number" ? "number" : "text"}
                  value={single.params[p.name] ?? ""}
                  onChange={(e) =>
                    store.update(
                      ids,
                      (pt) => ({ params: { ...pt.params, [p.name]: typeof p.default === "number" ? Number(e.target.value) : e.target.value } }),
                      `param:${p.name}`,
                    )
                  }
                />
              </label>
            ))}
      </div>
      <datalist id="systems-list-edit">
        {systems.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {single && d && (
        <div className="muted small">
          Coordenadas do projeto (X · Y · Z): {coordinates.worldToIfc(single.position).map((v) => formatNumber(v, 3)).join(" · ")} m
        </div>
      )}
      <div className="btn-row wrap">
        {single && (
          <button className="btn" onClick={() => onMove(single.id)}>
            Mover
          </button>
        )}
        {single && d && d.mounting !== "parede" && (
          <button className="btn" onClick={() => store.update(ids, (p) => ({ rotation: p.rotation + Math.PI / 2 }))}>
            Girar 90°
          </button>
        )}
        <button className="btn danger" onClick={() => onDelete(ids)}>
          Excluir{points.length > 1 ? ` (${points.length})` : ""}
        </button>
      </div>
    </section>
  );
}
