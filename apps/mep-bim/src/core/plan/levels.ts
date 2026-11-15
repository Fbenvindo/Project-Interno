// Níveis de referência das plantas de pavimento (faixa de visualização):
// - planta de piso: nível do piso da arquitetura (a laje do pavimento). Se o pavimento tem
//   lajes em níveis diferentes, cada nível vira uma planta (mesmo nome, com o nível);
// - planta de teto: face inferior da laje de teto (a laje acima do pavimento).
import type { StoreyLevel } from "../points";
import type { ElementInfo } from "../types";
import { parseFloorPlanId, rangeOf, type PlanType, type ViewDef } from "../views";

export interface PlanRange {
  type: PlanType;
  /** Nível base (Y da cena). */
  base: number;
  /** Abaixo do nível base (m). */
  below: number;
  /** Acima do nível base (m). */
  above: number;
}

const SLAB_TYPES = new Set(["IFCSLAB", "IFCSLABSTANDARDCASE", "IFCSLABELEMENTEDCASE"]);
const CEILING_TYPES = new Set([...SLAB_TYPES, "IFCROOF"]);
/** Área mínima (m²) de laje para definir um nível. */
const MIN_AREA = 4;
/** Lajes com topo até esta diferença (m) são o mesmo nível. */
const TOL = 0.05;

const footprint = (e: ElementInfo) => (e.bbox ? (e.bbox.max[0] - e.bbox.min[0]) * (e.bbox.max[2] - e.bbox.min[2]) : 0);

function levelOf(levels: StoreyLevel[], storey: string): { level: number; next: number } {
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  const i = sorted.findIndex((s) => s.name === storey);
  const level = i >= 0 ? sorted[i].level : 0;
  const next = i >= 0 && i < sorted.length - 1 ? sorted[i + 1].level : level + 3;
  return { level, next };
}

/** Agrupa valores próximos, somando o peso de cada grupo. */
function groups(items: { y: number; w: number }[]): { y: number; w: number }[] {
  const out: { y: number; w: number; s: number }[] = [];
  for (const it of [...items].sort((a, b) => a.y - b.y)) {
    const g = out[out.length - 1];
    if (g && it.y - g.y / g.w <= TOL * 2 && Math.abs(it.y - g.s) <= TOL) {
      g.y += it.y * it.w;
      g.w += it.w;
    } else out.push({ y: it.y * it.w, w: it.w, s: it.y });
  }
  return out.map((g) => ({ y: Math.round((g.y / g.w) * 1000) / 1000, w: g.w }));
}

/**
 * Níveis de piso do pavimento (Y da cena, de baixo para cima): o topo das lajes do pavimento
 * agrupado por nível. Sem lajes (ou um só nível), o nível do pavimento.
 */
export function floorSubLevels(elements: ElementInfo[], levels: StoreyLevel[], storey: string): number[] {
  const { level, next } = levelOf(levels, storey);
  const tops: { y: number; w: number }[] = [];
  for (const e of elements) {
    if (e.storey !== storey || !SLAB_TYPES.has(e.ifcType) || !e.bbox) continue;
    const top = e.bbox.max[1];
    const a = footprint(e);
    if (a < MIN_AREA || top < level - 1.2 || top > Math.min(next - 0.5, level + 1.8)) continue;
    tops.push({ y: top, w: a });
  }
  const g = groups(tops);
  if (g.length <= 1) return [level];
  return g.map((x) => x.y);
}

/** Face inferior da laje de teto do pavimento (Y da cena), a partir do nível de piso dado. */
export function ceilingBase(elements: ElementInfo[], levels: StoreyLevel[], storey: string, floor: number): number {
  const { level, next } = levelOf(levels, storey);
  const hi = Math.max(next, floor + 2.2) + 1.2;
  const bottoms: { y: number; w: number }[] = [];
  for (const e of elements) {
    if (!CEILING_TYPES.has(e.ifcType) || !e.bbox) continue;
    const bottom = e.bbox.min[1];
    const a = footprint(e);
    if (a < MIN_AREA || bottom < floor + 1.8 || bottom > hi) continue;
    bottoms.push({ y: bottom, w: a });
  }
  // A laje de maior área (somada por nível) é a de teto do pavimento.
  const g = groups(bottoms).sort((a, b) => b.w - a.w)[0];
  if (g) return g.y;
  return Number.isFinite(next) && next > level ? next - 0.12 : floor + 2.8;
}

/** Faixa de visualização de uma planta de pavimento (null para as demais vistas). */
export function planRangeOf(view: ViewDef, elements: ElementInfo[], levels: StoreyLevel[]): PlanRange | undefined {
  const p = parseFloorPlanId(view.id);
  if (!p) return undefined;
  const subs = floorSubLevels(elements, levels, p.storey);
  const floor = subs[Math.min(p.sub, subs.length - 1)];
  const r = rangeOf(view, p.type);
  return { type: p.type, base: p.type === "teto" ? ceilingBase(elements, levels, p.storey, floor) : floor, below: r.below, above: r.above };
}
