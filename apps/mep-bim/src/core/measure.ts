// Medições na planta, ampliações e cortes (coordenadas do desenho, em metros).
import type { P2 } from "./plan/section";
import type { Vec3 } from "./types";

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

// ---- Medições no 3D (cena: metros, Y para cima) ----------------------------------------------

export interface Measure3 {
  kind: MeasureKind;
  pts: Vec3[];
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function chainLength3(pts: Vec3[]): number {
  return pts.slice(1).reduce((s, p, i) => s + len3(sub3(p, pts[i])), 0);
}

/** Área de um polígono plano no espaço (inclinado ou vertical) e perímetro. */
export function polygonMeasure3(pts: Vec3[]): { area: number; perimeter: number } {
  let s: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const c = cross3(pts[i], pts[(i + 1) % pts.length]);
    s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
  }
  return { area: len3(s) / 2, perimeter: pts.length > 1 ? chainLength3([...pts, pts[0]]) : 0 };
}

export function angleAt3(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub3(a, b);
  const v = sub3(c, b);
  const lu = len3(u);
  const lv = len3(v);
  if (lu < 1e-12 || lv < 1e-12) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv)))) * 180) / Math.PI;
}

export function measure3Text(m: Measure3): string {
  if (m.kind === "distancia") {
    if (m.pts.length < 2) return "";
    const total = chainLength3(m.pts);
    if (m.pts.length === 2) {
      const d = sub3(m.pts[1], m.pts[0]);
      return `${fmtM(total)} (horizontal ${br(Math.hypot(d[0], d[2]), 3)} · vertical ${br(Math.abs(d[1]), 3)})`;
    }
    return `${fmtM(total)} em ${m.pts.length - 1} trechos`;
  }
  if (m.kind === "area") {
    if (m.pts.length < 3) return "";
    const { area, perimeter } = polygonMeasure3(m.pts);
    return `${fmtM2(area)} · perímetro ${fmtM(perimeter)}`;
  }
  if (m.pts.length < 3) return "";
  const a = angleAt3(m.pts[0], m.pts[1], m.pts[2]);
  return `${fmtDeg(a)} (replemento ${fmtDeg(360 - a)})`;
}

export function label3Point(m: Measure3): Vec3 {
  if (m.kind === "angulo") return m.pts[1] ?? m.pts[0];
  if (m.kind === "area") {
    const n = m.pts.length;
    return [0, 1, 2].map((k) => m.pts.reduce((s, p) => s + p[k], 0) / n) as Vec3;
  }
  const a = m.pts[m.pts.length - 2] ?? m.pts[0];
  const b = m.pts[m.pts.length - 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
