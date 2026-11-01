// Encaixe na planta: faces de parede a partir do corte do modelo.
import type { Prim } from "./drawing";
import type { P2 } from "./section";

export interface WallEdge {
  a: P2;
  b: P2;
  /** Elemento IFC da parede. */
  id?: number;
}

/** Arestas das paredes/pilares cortados (contornos fechados das camadas *-CORTE). */
export function wallEdges(prims: Prim[], minLength = 0.25): WallEdge[] {
  const out: WallEdge[] = [];
  for (const p of prims) {
    if (p.t !== "poly" || !p.closed || !p.layer.endsWith("-CORTE")) continue;
    for (let i = 0; i < p.pts.length; i++) {
      const a = p.pts[i];
      const b = p.pts[(i + 1) % p.pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= minLength) out.push({ a, b, id: p.id });
    }
  }
  return out;
}

export interface WallSnap {
  /** Ponto sobre a face da parede. */
  point: P2;
  /** Normal unitária da face, voltada para o lado do cursor (para o ambiente). */
  normal: P2;
  distance: number;
  edge: WallEdge;
}

/** Face de parede mais próxima de `p`, dentro da tolerância (m). */
export function snapToWall(p: P2, edges: WallEdge[], tolerance: number): WallSnap | null {
  let best: WallSnap | null = null;
  for (const e of edges) {
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const l2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2));
    const q: P2 = [e.a[0] + dx * t, e.a[1] + dy * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d > tolerance || (best && d >= best.distance)) continue;
    const l = Math.sqrt(l2);
    let n: P2 = [-dy / l, dx / l];
    if ((p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] < 0) n = [-n[0], -n[1]];
    best = { point: q, normal: n, distance: d, edge: e };
  }
  return best;
}
