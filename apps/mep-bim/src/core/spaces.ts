// Ambientes (IfcSpace): contorno em planta e distribuição de pontos dentro
// do ambiente (grade alinhada ao ambiente) ou ao longo do perímetro.
// Planta = coordenadas do projeto IFC (metros, X/Y); cotas na cena (Y).
import type { P2 } from "./plan/section";

export interface Space {
  expressID: number;
  globalId: string;
  /** Número / código (Name do IfcSpace). */
  number: string;
  /** Nome (LongName). */
  name: string;
  storey: string | null;
  /** Contorno em planta, anti-horário, em coordenadas do projeto (m). */
  polygon: P2[];
  /** Cota do piso e do topo do volume na cena (Y). */
  floorY: number;
  topY: number;
  /** Área do contorno (m²). */
  area: number;
}

export const spaceLabel = (s: Space) => [s.number, s.name].filter(Boolean).join(" ");

export function polygonArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function perimeter(poly: P2[]): number {
  return poly.reduce((s, p, i) => s + Math.hypot(poly[(i + 1) % poly.length][0] - p[0], poly[(i + 1) % poly.length][1] - p[1]), 0);
}

export function centroid(poly: P2[]): P2 {
  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-12) return poly[0] ?? [0, 0];
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function pointInPolygon([x, y]: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToEdges(p: P2, poly: P2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab: P2 = [b[0] - a[0], b[1] - a[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t)));
  }
  return best;
}

/** Garante sentido anti-horário. */
export function ccw(poly: P2[]): P2[] {
  return polygonArea(poly) < 0 ? [...poly].reverse() : poly;
}

/**
 * Referencial do ambiente: eixo U ao longo da maior aresta, V perpendicular.
 * Retorna o ângulo de U (rad, na planta) e os limites do contorno nesse referencial.
 */
export function spaceFrame(poly: P2[]) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) {
      best = l;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  // Normaliza para [−45°, 45°) mod 90°: grades simétricas ignoram o sentido.
  angle = angle - (Math.PI / 2) * Math.round(angle / (Math.PI / 2));
  const u: P2 = [Math.cos(angle), Math.sin(angle)];
  const v: P2 = [-u[1], u[0]];
  const proj = poly.map((p) => [p[0] * u[0] + p[1] * u[1], p[0] * v[0] + p[1] * v[1]]);
  return {
    angle,
    u,
    v,
    minU: Math.min(...proj.map((p) => p[0])),
    maxU: Math.max(...proj.map((p) => p[0])),
    minV: Math.min(...proj.map((p) => p[1])),
    maxV: Math.max(...proj.map((p) => p[1])),
  };
}

export type GridSpec =
  | { mode: "espacamento"; spacing: number }
  | { mode: "linhas"; rows: number; cols: number }
  | { mode: "quantidade"; count: number };

export interface GridResult {
  points: P2[];
  rows: number;
  cols: number;
  /** Espaçamentos reais entre pontos (m) ao longo de U e de V. */
  spacingU: number;
  spacingV: number;
  /** Ângulo da grade (rad, na planta). */
  angle: number;
}

/**
 * Grade alinhada ao ambiente: células iguais, ponto no centro de cada uma
 * (distância à parede = metade do espaçamento). Mantém só os pontos dentro
 * do contorno e a pelo menos `minWall` das paredes.
 */
export function gridInSpace(poly: P2[], spec: GridSpec, minWall = 0): GridResult {
  const f = spaceFrame(poly);
  const L = f.maxU - f.minU;
  const W = f.maxV - f.minV;
  let cols: number;
  let rows: number;
  if (spec.mode === "espacamento") {
    cols = Math.max(1, Math.ceil(L / spec.spacing - 1e-9));
    rows = Math.max(1, Math.ceil(W / spec.spacing - 1e-9));
  } else if (spec.mode === "linhas") {
    cols = Math.max(1, Math.floor(spec.cols));
    rows = Math.max(1, Math.floor(spec.rows));
  } else {
    const n = Math.max(1, Math.ceil(spec.count));
    cols = Math.max(1, Math.round(Math.sqrt((n * L) / Math.max(W, 1e-6))));
    rows = Math.max(1, Math.ceil(n / cols));
  }
  const points: P2[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = f.minU + ((i + 0.5) * L) / cols;
      const b = f.minV + ((j + 0.5) * W) / rows;
      const p: P2 = [a * f.u[0] + b * f.v[0], a * f.u[1] + b * f.v[1]];
      if (pointInPolygon(p, poly) && distanceToEdges(p, poly) >= minWall - 1e-9) points.push(p);
    }
  }
  return { points, rows, cols, spacingU: L / cols, spacingV: W / rows, angle: f.angle };
}

export interface PerimeterPoint {
  /** Ponto sobre o contorno. */
  point: P2;
  /** Normal para dentro do ambiente. */
  inward: P2;
  edge: number;
}

/**
 * Pontos ao longo do perímetro, aresta por aresta: o primeiro e o último a
 * `cornerOffset` dos cantos e os demais espaçados por no máximo `spacing`.
 * Arestas menores que 2 × cornerOffset recebem um ponto no meio, se couber.
 */
export function perimeterPoints(poly: P2[], spacing: number, cornerOffset = 0.3, minEdge = 0.5): PerimeterPoint[] {
  const p = ccw(poly);
  const out: PerimeterPoint[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < minEdge) continue;
    const d: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const inward: P2 = [-d[1], d[0]]; // à esquerda do sentido anti-horário
    const usable = len - 2 * cornerOffset;
    const at = (s: number): P2 => [a[0] + d[0] * s, a[1] + d[1] * s];
    if (usable <= 0) {
      out.push({ point: at(len / 2), inward, edge: i });
      continue;
    }
    const k = Math.max(1, Math.ceil(usable / spacing - 1e-9));
    for (let j = 0; j <= k; j++) out.push({ point: at(cornerOffset + (usable * j) / k), inward, edge: i });
  }
  return out;
}

export interface LumenInput {
  /** Iluminância média desejada (lx). */
  illuminance: number;
  area: number;
  /** Fluxo luminoso de cada luminária (lm). */
  flux: number;
  /** Fator de utilização (0–1). */
  utilization: number;
  /** Fator de manutenção (0–1). */
  maintenance: number;
}

/** Método dos lúmens: N = E · A / (Φ · Fu · Fm), arredondado para cima. */
export function lumenCount(i: LumenInput): number {
  const denom = i.flux * i.utilization * i.maintenance;
  if (denom <= 0) throw new Error("Fluxo, fator de utilização e fator de manutenção devem ser positivos.");
  return Math.max(1, Math.ceil((i.illuminance * i.area) / denom - 1e-9));
}

/** Iluminância média resultante com N luminárias. */
export function lumenIlluminance(n: number, i: Omit<LumenInput, "illuminance">): number {
  return (n * i.flux * i.utilization * i.maintenance) / i.area;
}

/** Ambiente que contém um ponto da cena (contorno em planta + faixa de altura). */
export function spaceAt(spaces: Space[], toPlan: (v: [number, number, number]) => P2, v: [number, number, number], tolerance = 0.3): Space | null {
  const p = toPlan(v);
  return spaces.find((s) => v[1] >= s.floorY - tolerance && v[1] <= s.topY + tolerance && pointInPolygon(p, s.polygon)) ?? null;
}
