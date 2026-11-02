// Estilo dos elementos que vêm dos IFCs (arquitetura, estrutura e vínculos) nas plantas,
// nos cortes e no 3D: pilares mais escuros que as alvenarias, layout e equipamentos da
// arquitetura em cinza e vigas (projeção) em verde tracejado.
import type { ElementInfo } from "../types";
import type { P2 } from "./section";

/** Hachura das alvenarias e dos pilares cortados (pilar mais escuro). */
export const WALL_FILL = "#a6a6a6";
export const COLUMN_FILL = "#5a5a5a";
export const COLUMN_TYPES = new Set(["IFCCOLUMN", "IFCPILE"]);

/** Layout e equipamentos (mobiliário, louças, metais, eletrodomésticos…): sempre em cinza. */
export const LAYOUT_GRAY = "#8c8c8c";
const LAYOUT_TYPES = new Set([
  "IFCFURNISHINGELEMENT",
  "IFCFURNITURE",
  "IFCSYSTEMFURNITUREELEMENT",
  "IFCSANITARYTERMINAL",
  "IFCWASTETERMINAL",
  "IFCELECTRICAPPLIANCE",
  "IFCFLOWTERMINAL",
]);
/** Exceções: mantêm a cor da disciplina (são representados no projeto). */
const KEEP_COLOR = new Set(["IFCLIGHTFIXTURE", "IFCOUTLET", "IFCAIRTERMINAL"]);

export const isLayout = (ifcType: string) => LAYOUT_TYPES.has(ifcType) && !KEEP_COLOR.has(ifcType);

/** Cor no 3D (modo "por disciplina"): layout em cinza, pilares mais escuros. */
export function color3d(e: Pick<ElementInfo, "ifcType">, disciplineColor: string): string {
  if (isLayout(e.ifcType)) return "#a3a3a3";
  if (COLUMN_TYPES.has(e.ifcType)) return "#6b6b6b";
  return disciplineColor;
}

// ---- Vigas ---------------------------------------------------------------------------------

export const BEAM_COLOR = "#2f7a52";
export const BEAM_OPACITY = 0.5;

/** Envoltória convexa (cadeia monótona). */
export function convexHull(points: P2[]): P2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Retângulo de menor área que contém os pontos: centro, eixo longo (unitário), comprimento e largura. */
export function minAreaRect(points: P2[]): { center: P2; axis: P2; length: number; width: number; corners: P2[] } | null {
  const h = convexHull(points);
  if (h.length < 2) return null;
  let best: { area: number; u: P2; min: P2; max: P2 } | null = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const u: P2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const q of h) {
      const pu = q[0] * u[0] + q[1] * u[1];
      const pv = -q[0] * u[1] + q[1] * u[0];
      minU = Math.min(minU, pu);
      maxU = Math.max(maxU, pu);
      minV = Math.min(minV, pv);
      maxV = Math.max(maxV, pv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area - 1e-12) best = { area, u, min: [minU, minV], max: [maxU, maxV] };
  }
  if (!best) return null;
  const { u, min, max } = best;
  const at = (pu: number, pv: number): P2 => [pu * u[0] - pv * u[1], pu * u[1] + pv * u[0]];
  const corners = [at(min[0], min[1]), at(max[0], min[1]), at(max[0], max[1]), at(min[0], max[1])];
  const du = max[0] - min[0];
  const dv = max[1] - min[1];
  const center = at((min[0] + max[0]) / 2, (min[1] + max[1]) / 2);
  return du >= dv ? { center, axis: u, length: du, width: dv, corners } : { center, axis: [-u[1], u[0]], length: dv, width: du, corners };
}
