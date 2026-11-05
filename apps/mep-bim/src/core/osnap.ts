// Encaixe a objetos (como no CAD) e modo ortogonal, para os comandos de criar e modificar.
// Coordenadas 2D do desenho (metros).
import type { DraftEntity } from "./draft";
import type { Prim } from "./plan/drawing";
import type { P2 } from "./plan/section";

export type SnapMode = "fim" | "meio" | "centro" | "quadrante" | "intersecao" | "perpendicular" | "tangente" | "proximo" | "insercao";

export const SNAP_MODES: SnapMode[] = ["fim", "meio", "centro", "quadrante", "intersecao", "perpendicular", "tangente", "proximo", "insercao"];

export const SNAP_LABEL: Record<SnapMode, string> = {
  fim: "Ponto final",
  meio: "Ponto médio",
  centro: "Centro",
  quadrante: "Quadrante",
  intersecao: "Interseção",
  perpendicular: "Perpendicular",
  tangente: "Tangente",
  proximo: "Ao longo (mais próximo)",
  insercao: "Inserção (pontos e textos)",
};

export const DEFAULT_SNAPS: Record<SnapMode, boolean> = {
  fim: true,
  meio: true,
  centro: true,
  quadrante: true,
  intersecao: true,
  perpendicular: false,
  tangente: false,
  proximo: false,
  insercao: true,
};

export interface SnapCircle {
  c: P2;
  r: number;
  /** Arco: de a0 a a1, no sentido anti-horário (radianos). Ausente: círculo inteiro. */
  a0?: number;
  a1?: number;
}

export interface SnapGeometry {
  segs: [P2, P2][];
  circles: SnapCircle[];
  /** Pontos de inserção (pontos locados, textos). */
  points: P2[];
  /** Centros de formas sem círculo (elipses). */
  centers: P2[];
  /** Quadrantes de formas sem círculo (elipses). */
  quads: P2[];
}

export interface SnapResult {
  p: P2;
  kind: SnapMode;
}

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const TAU = 2 * Math.PI;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** O ângulo está dentro do arco (anti-horário de a0 a a1)? */
export function inArc(c: SnapCircle, ang: number): boolean {
  if (c.a0 == null || c.a1 == null) return true;
  const sweep = norm(c.a1 - c.a0) || TAU;
  return norm(ang - c.a0) <= sweep + 1e-9;
}

const onCircle = (c: SnapCircle, ang: number): P2 => [c.c[0] + c.r * Math.cos(ang), c.c[1] + c.r * Math.sin(ang)];

export function closestOnSeg(p: P2, a: P2, b: P2): { q: P2; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return { q: [a[0] + dx * t, a[1] + dy * t], t };
}

function segSeg(a: P2, b: P2, c: P2, d: P2): P2 | null {
  const r: P2 = [b[0] - a[0], b[1] - a[1]];
  const s: P2 = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-14) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

/** Interseções da reta infinita (p + t·dir) ou do segmento com um círculo. */
function lineCircle(a: P2, b: P2, c: SnapCircle, segment: boolean): P2[] {
  const d: P2 = [b[0] - a[0], b[1] - a[1]];
  const f: P2 = [a[0] - c.c[0], a[1] - c.c[1]];
  const A = d[0] * d[0] + d[1] * d[1];
  if (A < 1e-18) return [];
  const B = 2 * (f[0] * d[0] + f[1] * d[1]);
  const C = f[0] * f[0] + f[1] * f[1] - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const out: P2[] = [];
  for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) {
    if (segment && (t < -1e-9 || t > 1 + 1e-9)) continue;
    const q: P2 = [a[0] + d[0] * t, a[1] + d[1] * t];
    if (inArc(c, Math.atan2(q[1] - c.c[1], q[0] - c.c[0]))) out.push(q);
  }
  return out;
}

function circleCircle(a: SnapCircle, b: SnapCircle): P2[] {
  const d = dist(a.c, b.c);
  if (d < 1e-12 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return [];
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const ux = (b.c[0] - a.c[0]) / d;
  const uy = (b.c[1] - a.c[1]) / d;
  const m: P2 = [a.c[0] + ux * x, a.c[1] + uy * x];
  return [
    [m[0] - uy * h, m[1] + ux * h] as P2,
    [m[0] + uy * h, m[1] - ux * h] as P2,
  ].filter((q) => inArc(a, Math.atan2(q[1] - a.c[1], q[0] - a.c[0])) && inArc(b, Math.atan2(q[1] - b.c[1], q[0] - b.c[0])));
}

/** Distância de p ao círculo/arco (ao ponto mais próximo dele). */
function nearestOnCircle(p: P2, c: SnapCircle): P2 {
  const ang = Math.atan2(p[1] - c.c[1], p[0] - c.c[0]);
  if (inArc(c, ang)) return onCircle(c, ang);
  const e0 = onCircle(c, c.a0!);
  const e1 = onCircle(c, c.a1!);
  return dist(p, e0) <= dist(p, e1) ? e0 : e1;
}

/**
 * Melhor encaixe perto de p (dentro de `tol`). Os modos de ponto (final, médio, centro…)
 * têm prioridade; "ao longo" só vale quando nenhum deles está ao alcance. Perpendicular e
 * tangente precisam do ponto anterior do comando (`from`).
 */
export function findSnap(p: P2, g: SnapGeometry, modes: Partial<Record<SnapMode, boolean>>, tol: number, from?: P2 | null): SnapResult | null {
  let best: SnapResult | null = null;
  let bd = tol;
  const take = (q: P2, kind: SnapMode) => {
    const d = dist(p, q);
    if (d < bd) ((bd = d), (best = { p: q, kind }));
  };
  const near = (a: P2, b: P2) => dist(p, closestOnSeg(p, a, b).q) <= tol;
  const nearC = (c: SnapCircle) => dist(p, nearestOnCircle(p, c)) <= tol || dist(p, c.c) <= tol;
  const segs = g.segs.filter(([a, b]) => near(a, b));
  const circles = g.circles.filter(nearC);

  for (const [a, b] of segs) {
    if (modes.fim) (take(a, "fim"), take(b, "fim"));
    if (modes.meio) take(mid(a, b), "meio");
    if (modes.perpendicular && from) {
      const { q, t } = closestOnSeg(from, a, b);
      // Só o pé da perpendicular de verdade (dentro do segmento).
      if (t > 1e-6 && t < 1 - 1e-6) take(q, "perpendicular");
    }
  }
  for (const c of circles) {
    const arc = c.a0 != null && c.a1 != null;
    if (modes.centro) take(c.c, "centro");
    if (modes.fim && arc) (take(onCircle(c, c.a0!), "fim"), take(onCircle(c, c.a1!), "fim"));
    if (modes.meio && arc) take(onCircle(c, c.a0! + (norm(c.a1! - c.a0!) || TAU) / 2), "meio");
    if (modes.quadrante) for (let k = 0; k < 4; k++) if (inArc(c, (k * Math.PI) / 2)) take(onCircle(c, (k * Math.PI) / 2), "quadrante");
    if (modes.perpendicular && from && dist(from, c.c) > 1e-9) {
      const ang = Math.atan2(from[1] - c.c[1], from[0] - c.c[0]);
      for (const a of [ang, ang + Math.PI]) if (inArc(c, a)) take(onCircle(c, a), "perpendicular");
    }
    if (modes.tangente && from) {
      const d = dist(from, c.c);
      if (d > c.r + 1e-9) {
        const base = Math.atan2(from[1] - c.c[1], from[0] - c.c[0]);
        const off = Math.acos(c.r / d);
        for (const a of [base + off, base - off]) if (inArc(c, a)) take(onCircle(c, a), "tangente");
      }
    }
  }
  if (modes.centro) for (const q of g.centers) take(q, "centro");
  if (modes.quadrante) for (const q of g.quads) take(q, "quadrante");
  if (modes.insercao) for (const q of g.points) take(q, "insercao");
  if (modes.intersecao) {
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const q = segSeg(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
        if (q) take(q, "intersecao");
      }
      for (const c of circles) for (const q of lineCircle(segs[i][0], segs[i][1], c, true)) take(q, "intersecao");
    }
    for (let i = 0; i < circles.length; i++) for (let j = i + 1; j < circles.length; j++) for (const q of circleCircle(circles[i], circles[j])) take(q, "intersecao");
  }
  if (best || !modes.proximo) return best;
  // Ao longo: o ponto mais próximo sobre qualquer elemento.
  for (const [a, b] of segs) take(closestOnSeg(p, a, b).q, "proximo");
  for (const c of circles) take(nearestOnCircle(p, c), "proximo");
  return best;
}

/** Ortogonal: o ponto vai para a horizontal ou a vertical que passa pela âncora. */
export function orthoPoint(p: P2, anchor: P2): { p: P2; axis: "x" | "y" } {
  return Math.abs(p[0] - anchor[0]) >= Math.abs(p[1] - anchor[1]) ? { p: [p[0], anchor[1]], axis: "x" } : { p: [anchor[0], p[1]], axis: "y" };
}

/**
 * Encaixe com o ortogonal ligado: a direção fica presa ao eixo e o encaixe dá a posição ao
 * longo dele (alinhado ao ponto encaixado; "ao longo" acha onde o eixo cruza o elemento).
 */
export function orthoSnap(p: P2, anchor: P2, g: SnapGeometry, modes: Partial<Record<SnapMode, boolean>>, tol: number): { p: P2; snap: SnapResult | null } {
  const o = orthoPoint(p, anchor);
  const s = findSnap(p, g, { ...modes, proximo: false, perpendicular: false, tangente: false }, tol, anchor);
  if (s) return { p: o.axis === "x" ? [s.p[0], anchor[1]] : [anchor[0], s.p[1]], snap: s };
  if (modes.proximo) {
    // Onde a reta do eixo cruza um elemento perto do cursor.
    const far = 1e4;
    const a: P2 = o.axis === "x" ? [anchor[0] - far, anchor[1]] : [anchor[0], anchor[1] - far];
    const b: P2 = o.axis === "x" ? [anchor[0] + far, anchor[1]] : [anchor[0], anchor[1] + far];
    let best: P2 | null = null;
    let bd = tol;
    for (const [c, d] of g.segs) {
      const q = segSeg(a, b, c, d);
      if (q && dist(q, o.p) < bd) ((bd = dist(q, o.p)), (best = q));
    }
    for (const c of g.circles) for (const q of lineCircle(a, b, c, false)) if (dist(q, o.p) < bd) ((bd = dist(q, o.p)), (best = q));
    if (best) return { p: best, snap: { p: best, kind: "proximo" } };
  }
  return { p: o.p, snap: null };
}

/** Geometria de encaixe a partir das primitivas do desenho e das entidades de desenho. */
export function snapGeometry(prims: Prim[], drafts: DraftEntity[], extraPoints: P2[] = [], skipPrim?: (p: Prim) => boolean): SnapGeometry {
  const g: SnapGeometry = { segs: [], circles: [], points: [...extraPoints], centers: [], quads: [] };
  for (const p of prims) {
    if (skipPrim?.(p)) continue;
    if (p.t === "line") g.segs.push([p.a, p.b]);
    else if (p.t === "poly" && p.pts.length <= 400) {
      for (let i = 0; i + 1 < p.pts.length; i++) g.segs.push([p.pts[i], p.pts[i + 1]]);
      if (p.closed && p.pts.length > 2) g.segs.push([p.pts[p.pts.length - 1], p.pts[0]]);
    } else if (p.t === "circle") g.circles.push({ c: p.c, r: p.r });
  }
  for (const e of drafts) {
    switch (e.kind) {
      case "linha":
        g.segs.push([e.a, e.b]);
        break;
      case "arco":
        g.circles.push({ c: e.c, r: e.r, a0: e.a0, a1: e.a1 });
        break;
      case "circulo":
        g.circles.push({ c: e.c, r: e.r });
        break;
      case "elipse": {
        g.centers.push(e.c);
        const [c, s] = [Math.cos(e.rot), Math.sin(e.rot)];
        for (const [x, y] of [
          [e.rx, 0],
          [-e.rx, 0],
          [0, e.ry],
          [0, -e.ry],
        ])
          g.quads.push([e.c[0] + x * c - y * s, e.c[1] + x * s + y * c]);
        // Contorno (para "ao longo" e interseções).
        const n = 48;
        const pts = Array.from({ length: n }, (_, i): P2 => {
          const a = (TAU * i) / n;
          const x = e.rx * Math.cos(a);
          const y = e.ry * Math.sin(a);
          return [e.c[0] + x * c - y * s, e.c[1] + x * s + y * c];
        });
        for (let i = 0; i < n; i++) g.segs.push([pts[i], pts[(i + 1) % n]]);
        break;
      }
      case "poligono":
        for (let i = 0; i + 1 < e.pts.length; i++) g.segs.push([e.pts[i], e.pts[i + 1]]);
        if (e.closed && e.pts.length > 2) g.segs.push([e.pts[e.pts.length - 1], e.pts[0]]);
        break;
      case "texto":
        g.points.push(e.p);
        break;
      case "cota":
        g.points.push(e.a, e.b);
        break;
      case "cota-angular":
        g.centers.push(e.c);
        break;
      case "coordenada":
        g.points.push(e.p);
        break;
    }
  }
  return g;
}
