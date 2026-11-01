import { useEffect, useMemo, useState } from "react";
import { formatNumber } from "../../../core/format";
import type { ComponentDef } from "../../../core/library";
import { computePlacement, sizeMeters, type CeilingMount, type Placement, type SurfaceHit } from "../../../core/placement";
import type { CeilingResolver } from "./ceiling";
import type { PlacedPoint } from "../../../core/points";
import type { P2 } from "../../../core/plan/section";
import { gridInSpace, lumenCount, lumenIlluminance, perimeterPoints, spaceLabel, type GridSpec, type Space } from "../../../core/spaces";
import type { Vec3 } from "../../../core/types";
import type { LoadedModel } from "../../../ifc/loadIfc";
import type { PreviewItem, Viewer } from "../viewer/Viewer";

export interface SpacePlacement {
  placement: Placement;
  space: Space;
}

interface Props {
  model: LoadedModel;
  viewer: Viewer;
  def: ComponentDef;
  height: number;
  /** Itens de teto: forro, entreforro ou laje. */
  ceiling: CeilingMount;
  resolveCeiling: CeilingResolver;
  rotationDeg: number;
  params: Record<string, string | number>;
  selected: number[];
  onSelectedChange: (ids: number[]) => void;
  existing: PlacedPoint[];
  onCreate: (items: SpacePlacement[]) => void;
}

type GridMode = "espacamento" | "linhas" | "quantidade" | "iluminancia";

const num = (v: string) => Number(v.replace(",", "."));

/** Distribuição de um componente nos ambientes selecionados (IfcSpace). */
export function AmbientesSection({ model, viewer, def, height, ceiling, resolveCeiling, rotationDeg, params, selected, onSelectedChange, existing, onCreate }: Props) {
  const isLight = def.params.some((p) => p.name === "Fluxo luminoso");
  const [gridMode, setGridMode] = useState<GridMode>(isLight ? "iluminancia" : "espacamento");
  const [spacing, setSpacing] = useState(def.mounting === "parede" ? 3 : 2.5);
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(3);
  const [count, setCount] = useState(4);
  const [minWall, setMinWall] = useState(0.3);
  const [corner, setCorner] = useState(0.3);
  const [lux, setLux] = useState(300);
  const [fu, setFu] = useState(0.6);
  const [fm, setFm] = useState(0.8);
  const [storeyFilter, setStoreyFilter] = useState<string>("");
  const flux = Number(params["Fluxo luminoso"]) || 0;
  const { coordinates: cs } = model;

  useEffect(() => {
    if (!isLight && gridMode === "iluminancia") setGridMode("espacamento");
  }, [isLight, gridMode]);

  const spaces = model.spaces.filter((s) => !storeyFilter || s.storey === storeyFilter);
  const storeys = [...new Set(model.spaces.map((s) => s.storey ?? ""))];
  const selectedSpaces = model.spaces.filter((s) => selected.includes(s.expressID));

  const planToWorld = (p: P2, y: number): Vec3 => cs.ifcToWorld([p[0], p[1], cs.worldToIfc([0, y, 0])[2]]);
  const planDirToWorld = (d: P2): Vec3 => {
    const a = planToWorld([0, 0], 0);
    const b = planToWorld(d, 0);
    return [b[0] - a[0], 0, b[2] - a[2]];
  };

  /** Proposta de pontos por ambiente, com os pontos já fixados nas superfícies reais. */
  const proposal = useMemo(() => {
    const items: SpacePlacement[] = [];
    const notes: { space: Space; count: number; skipped: number; extra?: string }[] = [];
    const duplicate = (pl: Placement) =>
      existing.some((p) => p.componentId === def.id && Math.hypot(p.position[0] - pl.position[0], p.position[1] - pl.position[1], p.position[2] - pl.position[2]) < 0.1);
    for (const s of selectedSpaces) {
      let made = 0;
      let skipped = 0;
      let extra: string | undefined;
      if (def.mounting === "parede") {
        const y = Math.min(s.floorY + height / 1000, s.topY - 0.05);
        for (const pp of perimeterPoints(s.polygon, spacing, corner)) {
          const inner: P2 = [pp.point[0] + pp.inward[0] * 0.15, pp.point[1] + pp.inward[1] * 0.15];
          const out = planDirToWorld([-pp.inward[0], -pp.inward[1]]);
          const hit = viewer.castRay(planToWorld(inner, y), out, 0.6, (n) => Math.abs(n[1]) < 0.35);
          if (!hit) {
            skipped++; // porta, janela ou vão: sem parede atrás do ponto
            continue;
          }
          const pl = computePlacement(def, hit, { height, rotation: 0, snap: 0, floorLevel: s.floorY });
          if (!pl.ok || duplicate(pl)) {
            skipped++;
            continue;
          }
          items.push({ placement: pl, space: s });
          made++;
        }
      } else {
        let spec: GridSpec;
        if (gridMode === "linhas") spec = { mode: "linhas", rows, cols };
        else if (gridMode === "quantidade") spec = { mode: "quantidade", count };
        else if (gridMode === "iluminancia" && flux > 0) {
          const n = lumenCount({ illuminance: lux, area: s.area, flux, utilization: fu, maintenance: fm });
          spec = { mode: "quantidade", count: n };
        } else spec = { mode: "espacamento", spacing };
        const grid = gridInSpace(s.polygon, spec, minWall);
        const rotation = grid.angle + (rotationDeg * Math.PI) / 180;
        const probeY = s.floorY + Math.min(1, (s.topY - s.floorY) / 2);
        const reach = s.topY - s.floorY + 0.5;
        for (const p of grid.points) {
          const origin = planToWorld(p, probeY);
          const up = def.mounting === "teto";
          let hit: SurfaceHit | null = null;
          if (up) {
            hit = { point: [origin[0], resolveCeiling(def, ceiling, origin[0], origin[2], s.floorY), origin[2]], normal: [0, -1, 0] };
          } else {
            hit = viewer.castRay(origin, [0, -1, 0], reach, (n) => n[1] > 0.7) ?? { point: planToWorld(p, s.floorY), normal: [0, 1, 0] };
          }
          const h = up && ceiling.ref === "entreforro" ? 0 : height;
          const pl = computePlacement(def, hit, { height: h, rotation, snap: 0, floorLevel: s.floorY });
          if (!pl.ok || duplicate(pl)) {
            skipped++;
            continue;
          }
          items.push({ placement: pl, space: s });
          made++;
        }
        if (isLight && flux > 0) {
          extra = `≈ ${formatNumber(lumenIlluminance(made, { area: s.area, flux, utilization: fu, maintenance: fm }), 0)} lx`;
        }
        if (made) extra = `${extra ? extra + " · " : ""}${grid.cols}×${grid.rows}, ${formatNumber(grid.spacingU, 2)} × ${formatNumber(grid.spacingV, 2)} m`;
      }
      notes.push({ space: s, count: made, skipped, extra });
    }
    return { items, notes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpaces.map((s) => s.expressID).join(","), def, height, ceiling, resolveCeiling, rotationDeg, gridMode, spacing, rows, cols, count, minWall, corner, lux, fu, fm, flux, existing, viewer]);

  // Pré-visualização e destaque dos ambientes.
  useEffect(() => {
    viewer.setStaticPreview(
      proposal.items.map(({ placement }): PreviewItem => ({ shape: def.shape, size: sizeMeters(def), position: placement.position, rotation: placement.rotation, ok: true, mesh: def.mesh })),
    );
    viewer.setSpaceOutlines(
      model.spaces.map((s) => ({ points: s.polygon.map((p) => planToWorld(p, s.floorY + 0.02)), selected: selected.includes(s.expressID) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal, selected, viewer, model.spaces]);
  useEffect(
    () => () => {
      viewer.setStaticPreview([]);
      viewer.setSpaceOutlines([]);
    },
    [viewer],
  );

  const toggle = (id: number) => onSelectedChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (!model.spaces.length) {
    return <p className="muted small">Este modelo não tem ambientes (IfcSpace). Exporte o IFC com os ambientes/rooms para usar esta opção.</p>;
  }

  return (
    <div className="mode-body">
      <div className="spaces-head">
        <span className="field-label">Ambientes</span>
        {storeys.length > 1 && (
          <select value={storeyFilter} onChange={(e) => setStoreyFilter(e.target.value)}>
            <option value="">Todos os pavimentos</option>
            {storeys.map((s) => (
              <option key={s} value={s}>
                {s || "(sem pavimento)"}
              </option>
            ))}
          </select>
        )}
        <button className="link" onClick={() => onSelectedChange(spaces.map((s) => s.expressID))}>
          todos
        </button>
        <button className="link" onClick={() => onSelectedChange([])}>
          nenhum
        </button>
      </div>
      <div className="spaces-list">
        {spaces.map((s) => (
          <label key={s.expressID} className="check-row">
            <input type="checkbox" checked={selected.includes(s.expressID)} onChange={() => toggle(s.expressID)} />
            <span className="grow">{spaceLabel(s)}</span>
            <span className="count">{formatNumber(s.area, 1)} m²</span>
          </label>
        ))}
      </div>
      <p className="muted small">Também é possível clicar no ambiente na planta (ou na vista 3D) para marcá-lo.</p>

      {def.mounting === "parede" ? (
        <div className="form-grid">
          <label>
            Espaçamento máx. no perímetro (m)
            <input type="number" step={0.5} min={0.5} value={spacing} onChange={(e) => setSpacing(Math.max(0.5, num(e.target.value)))} />
          </label>
          <label>
            Afastamento dos cantos (m)
            <input type="number" step={0.1} min={0} value={corner} onChange={(e) => setCorner(Math.max(0, num(e.target.value)))} />
          </label>
        </div>
      ) : (
        <div className="form-grid">
          <label>
            Distribuir por
            <select value={gridMode} onChange={(e) => setGridMode(e.target.value as GridMode)}>
              {isLight && <option value="iluminancia">Iluminância (método dos lúmens)</option>}
              <option value="espacamento">Espaçamento máximo</option>
              <option value="linhas">Linhas × colunas</option>
              <option value="quantidade">Quantidade por ambiente</option>
            </select>
          </label>
          {gridMode === "espacamento" && (
            <label>
              Espaçamento máx. (m)
              <input type="number" step={0.1} min={0.3} value={spacing} onChange={(e) => setSpacing(Math.max(0.3, num(e.target.value)))} />
            </label>
          )}
          {gridMode === "linhas" && (
            <>
              <label>
                Linhas
                <input type="number" min={1} value={rows} onChange={(e) => setRows(Math.max(1, num(e.target.value)))} />
              </label>
              <label>
                Colunas
                <input type="number" min={1} value={cols} onChange={(e) => setCols(Math.max(1, num(e.target.value)))} />
              </label>
            </>
          )}
          {gridMode === "quantidade" && (
            <label>
              Quantidade
              <input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, num(e.target.value)))} />
            </label>
          )}
          {gridMode === "iluminancia" && (
            <>
              <label>
                Iluminância (lx)
                <input type="number" step={50} min={1} value={lux} onChange={(e) => setLux(Math.max(1, num(e.target.value)))} />
              </label>
              <label>
                Fator de utilização
                <input type="number" step={0.05} min={0.05} max={1} value={fu} onChange={(e) => setFu(num(e.target.value))} />
              </label>
              <label>
                Fator de manutenção
                <input type="number" step={0.05} min={0.05} max={1} value={fm} onChange={(e) => setFm(num(e.target.value))} />
              </label>
            </>
          )}
          <label>
            Distância mín. à parede (m)
            <input type="number" step={0.1} min={0} value={minWall} onChange={(e) => setMinWall(Math.max(0, num(e.target.value)))} />
          </label>
        </div>
      )}
      {gridMode === "iluminancia" && def.mounting !== "parede" && (
        <p className="muted small">
          N = E · A / (Φ · Fu · Fm), com Φ = {formatNumber(flux, 0)} lm por luminária (parâmetro "Fluxo luminoso"). Use o fator de utilização
          da fotometria da luminária e a iluminância exigida para a atividade (ABNT NBR ISO/CIE 8995-1).
        </p>
      )}

      {proposal.notes.length > 0 && (
        <table className="grid-table">
          <tbody>
            {proposal.notes.map((n) => (
              <tr key={n.space.expressID}>
                <td>
                  {spaceLabel(n.space)}
                  {n.extra && <div className="muted small">{n.extra}</div>}
                </td>
                <td className="num">
                  {n.count} un
                  {n.skipped > 0 && <div className="muted small">{n.skipped} pulado(s)</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn primary block" disabled={!proposal.items.length} onClick={() => onCreate(proposal.items)}>
        Locar {proposal.items.length} ponto(s)
      </button>
      {def.mounting === "parede" && (
        <p className="muted small">Pontos sem parede atrás (portas, janelas, vãos) são pulados. Pontos já existentes no mesmo lugar não são duplicados.</p>
      )}
    </div>
  );
}
