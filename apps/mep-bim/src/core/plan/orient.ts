// Rotação das plantas na tela e na folha: o eixo de maior extensão do edifício fica na
// horizontal (automática), sem rotação (norte do projeto) ou num ângulo escolhido. Só a
// exibição gira: o modelo, os pontos e as anotações continuam nas coordenadas do projeto.
import type { Prim } from "./drawing";
import type { P2 } from "./section";
import { wallEdges } from "./snap";
import type { SnapGeometry } from "../osnap";

/** Rotação da vista: "auto" (maior eixo na horizontal) ou graus (anti-horário; 0 = norte do projeto). */
export type ViewRotation = "auto" | number;

const DEG = Math.PI / 180;

/** Segmentos de referência: faces das paredes e da estrutura cortadas; sem elas, todas as linhas. */
function segments(prims: Prim[]): [P2, P2][] {
  const walls = wallEdges(prims, 0.5).map((e): [P2, P2] => [e.a, e.b]);
  if (walls.length >= 4) return walls;
  const out: [P2, P2][] = [];
  for (const p of prims) {
    if (p.t === "line") out.push([p.a, p.b]);
    else if (p.t === "poly") for (let i = 0; i + 1 < p.pts.length; i++) out.push([p.pts[i], p.pts[i + 1]]);
  }
  return out;
}

/**
 * Ângulo (rad, anti-horário) a aplicar ao desenho para que a direção dominante das paredes fique
 * na horizontal e a maior extensão do desenho também (0 quando não há o que alinhar).
 */
export function autoRotation(prims: Prim[]): number {
  const segs = segments(prims).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.3);
  if (!segs.length) return 0;
  // Histograma das direções (módulo 90°), em passos de 0,5°, pesado pelo comprimento.
  const BINS = 180;
  const hist = new Float64Array(BINS);
  for (const [a, b] of segs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
    t = ((t % 90) + 90) % 90;
    hist[Math.floor(t * 2) % BINS] += len;
  }
  let best = 0;
  let bestW = -1;
  for (let i = 0; i < BINS; i++) {
    const w = hist[(i + BINS - 1) % BINS] + hist[i] * 2 + hist[(i + 1) % BINS];
    if (w > bestW) (bestW = w), (best = i);
  }
  // Média ponderada perto do pico (direções no círculo de 90°).
  let sx = 0, sy = 0;
  const peak = (best + 0.5) / 2;
  for (const [a, b] of segs) {
    let t = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
    t = ((t % 90) + 90) % 90;
    let d = t - peak;
    if (d > 45) d -= 90;
    if (d < -45) d += 90;
    if (Math.abs(d) > 1.5) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    sx += Math.cos(t * 4 * DEG) * len;
    sy += Math.sin(t * 4 * DEG) * len;
  }
  const phi = (sx || sy ? Math.atan2(sy, sx) / 4 / DEG : peak) * DEG;
  // Das duas direções principais, a que deixa o desenho mais largo que alto.
  const extent = (ang: number) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [a, b] of segs)
      for (const p of [a, b]) {
        const x = c * p[0] - s * p[1], y = s * p[0] + c * p[1];
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    return x1 - x0 - (y1 - y0);
  };
  let ang = -phi;
  if (extent(ang) < extent(ang - Math.PI / 2)) ang -= Math.PI / 2;
  // Menor giro equivalente (girar 180° não muda o eixo horizontal).
  while (ang <= -Math.PI / 2) ang += Math.PI;
  while (ang > Math.PI / 2) ang -= Math.PI;
  return Math.abs(ang) < 1e-4 ? 0 : ang;
}

/** Ângulo (rad) da vista. */
export function viewAngle(rotation: ViewRotation | undefined | null, prims: Prim[]): number {
  if (rotation == null || rotation === "auto") return autoRotation(prims);
  return rotation * DEG;
}

/** Transformação de exibição: gira `angle` em torno de `origin` e leva a origem para (0, 0). */
export function displayTransform(origin: P2, angle: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const to = (p: P2): P2 => {
    const x = p[0] - origin[0], y = p[1] - origin[1];
    return [c * x - s * y, s * x + c * y];
  };
  const from = (q: P2): P2 => [c * q[0] + s * q[1] + origin[0], -s * q[0] + c * q[1] + origin[1]];
  const dir = (d: P2): P2 => [c * d[0] - s * d[1], s * d[0] + c * d[1]];
  return { to, from, dir, angle, origin };
}
export type DisplayTransform = ReturnType<typeof displayTransform>;

/** Ângulo de texto legível (entre −90° e 90°). */
function readable(a: number): number {
  let t = a;
  while (t > Math.PI / 2 + 1e-6) t -= Math.PI;
  while (t <= -Math.PI / 2 + 1e-6) t += Math.PI;
  return t;
}

/**
 * Primitivas na exibição. Textos horizontais continuam horizontais (nomes de ambientes,
 * etiquetas); textos inclinados (ao longo de tubos, cotas) giram junto e ficam legíveis.
 */
export function transformPrims(prims: Prim[], t: DisplayTransform): Prim[] {
  return prims.map((p) => {
    if (p.t === "line") return { ...p, a: t.to(p.a), b: t.to(p.b) };
    if (p.t === "poly") return { ...p, pts: p.pts.map(t.to) };
    if (p.t === "circle") return { ...p, c: t.to(p.c) };
    return { ...p, p: t.to(p.p), ...(p.angle ? { angle: readable(p.angle + t.angle) } : {}) };
  });
}

/** Geometria de encaixe na exibição (o encaixe e o ortogonal trabalham nos eixos da tela). */
export function transformSnapGeometry(g: SnapGeometry, t: DisplayTransform): SnapGeometry {
  return {
    segs: g.segs.map(([a, b]): [P2, P2] => [t.to(a), t.to(b)]),
    circles: g.circles.map((c) => ({ ...c, c: t.to(c.c), ...(c.a0 != null ? { a0: c.a0 + t.angle } : {}), ...(c.a1 != null ? { a1: c.a1 + t.angle } : {}) })),
    points: g.points.map(t.to),
    centers: g.centers.map(t.to),
    quads: g.quads.map(t.to),
  };
}
