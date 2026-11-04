// Medições na planta, ampliações e cortes (coordenadas do desenho, em metros).
import type { P2 } from "./plan/section";

export type MeasureKind = "distancia" | "area" | "angulo";

export interface Measure {
  kind: MeasureKind;
  pts: P2[];
}

const d = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Comprimento total e de cada trecho de uma cadeia de pontos. */
export function chainLength(pts: P2[]): { total: number; parts: number[] } {
  const parts = pts.slice(1).map((p, i) => d(pts[i], p));
  return { total: parts.reduce((s, x) => s + x, 0), parts };
}

/** Área (sempre positiva) e perímetro de um polígono. */
export function polygonMeasure(pts: P2[]): { area: number; perimeter: number } {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  const perimeter = pts.length > 1 ? chainLength([...pts, pts[0]]).total : 0;
  return { area: Math.abs(a) / 2, perimeter };
}

/** Ângulo no vértice b, entre b→a e b→c (graus, 0–180). */
export function angleAt(a: P2, b: P2, c: P2): number {
  const u = [a[0] - b[0], a[1] - b[1]];
  const v = [c[0] - b[0], c[1] - b[1]];
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  if (lu < 1e-12 || lv < 1e-12) return 0;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

const br = (v: number, dec: number) => v.toFixed(dec).replace(".", ",");
export const fmtM = (v: number) => `${br(v, 3)} m`;
export const fmtM2 = (v: number) => `${br(v, 2)} m²`;
export const fmtDeg = (v: number) => `${br(v, 1)}°`;

/** Texto curto da medição (rótulo na planta e lista do painel). */
export function measureText(m: Measure): string {
  if (m.kind === "distancia") {
    const { total, parts } = chainLength(m.pts);
    if (parts.length === 1) {
      const [a, b] = m.pts;
      return `${fmtM(total)} (Δx ${br(Math.abs(b[0] - a[0]), 3)} · Δy ${br(Math.abs(b[1] - a[1]), 3)})`;
    }
    return `${fmtM(total)} em ${parts.length} trechos`;
  }
  if (m.kind === "area") {
    const { area, perimeter } = polygonMeasure(m.pts);
    return `${fmtM2(area)} · perímetro ${fmtM(perimeter)}`;
  }
  return m.pts.length >= 3 ? `${fmtDeg(angleAt(m.pts[0], m.pts[1], m.pts[2]))} (replemento ${fmtDeg(360 - angleAt(m.pts[0], m.pts[1], m.pts[2]))})` : "";
}

/** Ponto onde o rótulo da medição é escrito. */
export function labelPoint(m: Measure): P2 {
  if (m.kind === "angulo") return m.pts[1];
  if (m.kind === "area") {
    const n = m.pts.length;
    return [m.pts.reduce((s, p) => s + p[0], 0) / n, m.pts.reduce((s, p) => s + p[1], 0) / n];
  }
  const a = m.pts[m.pts.length - 2] ?? m.pts[0];
  const b = m.pts[m.pts.length - 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
