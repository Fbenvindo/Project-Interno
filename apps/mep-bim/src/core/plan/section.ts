// Corte horizontal de malhas trianguladas: gera segmentos no plano de corte e
// os encadeia em contornos (fechados quando a malha é fechada).
// Entrada em coordenadas da cena (Y para cima); a conversão para a planta
// (coordenadas do projeto IFC) fica a cargo de quem chama.
import type { Vec3 } from "../types";

export type P2 = [number, number];

export interface CutSegment {
  a: Vec3;
  b: Vec3;
}

/** Segmentos da interseção da malha com o plano horizontal y = cutY. */
export function cutMesh(positions: Float32Array, indices: Uint32Array, cutY: number): CutSegment[] {
  const out: CutSegment[] = [];
  const v = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let t = 0; t < indices.length; t += 3) {
    const p = [v(indices[t]), v(indices[t + 1]), v(indices[t + 2])];
    // Vértice exatamente no plano conta como "acima", evitando pontos duplicados.
    const d = p.map((q) => (q[1] - cutY >= 0 ? Math.max(q[1] - cutY, 1e-12) : q[1] - cutY));
    const pts: Vec3[] = [];
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      if (d[k] > 0 !== d[j] > 0) {
        const s = d[k] / (d[k] - d[j]);
        pts.push([p[k][0] + (p[j][0] - p[k][0]) * s, cutY, p[k][2] + (p[j][2] - p[k][2]) * s]);
      }
    }
    if (pts.length === 2) out.push({ a: pts[0], b: pts[1] });
  }
  return out;
}

export interface Chain {
  points: P2[];
  closed: boolean;
}

/**
 * Encadeia segmentos 2D por extremidades coincidentes (tolerância em metros).
 * Retorna contornos fechados e cadeias abertas (malhas não fechadas).
 */
export function chainSegments(segments: [P2, P2][], tolerance = 1e-4): Chain[] {
  const key = (p: P2) => `${Math.round(p[0] / tolerance)}|${Math.round(p[1] / tolerance)}`;
  const adjacency = new Map<string, number[]>();
  const valid = segments.filter(([a, b]) => key(a) !== key(b));
  valid.forEach(([a, b], i) => {
    for (const k of [key(a), key(b)]) {
      const list = adjacency.get(k) ?? [];
      list.push(i);
      adjacency.set(k, list);
    }
  });
  const used = new Uint8Array(valid.length);
  const chains: Chain[] = [];

  const extend = (points: P2[], forward: boolean) => {
    for (;;) {
      const end = forward ? points[points.length - 1] : points[0];
      const next = (adjacency.get(key(end)) ?? []).find((i) => !used[i]);
      if (next == null) return;
      used[next] = 1;
      const [a, b] = valid[next];
      const other = key(a) === key(end) ? b : a;
      if (forward) points.push(other);
      else points.unshift(other);
    }
  };

  for (let i = 0; i < valid.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const points: P2[] = [valid[i][0], valid[i][1]];
    extend(points, true);
    extend(points, false);
    const closed = points.length > 3 && key(points[0]) === key(points[points.length - 1]);
    if (closed) points.pop();
    chains.push({ points: simplifyChain(points, closed), closed });
  }
  return chains;
}

/** Remove vértices colineares (comuns em malhas trianguladas). */
function simplifyChain(points: P2[], closed: boolean): P2[] {
  if (points.length < 3) return points;
  const out: P2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(cur);
      continue;
    }
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    const scale = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) * Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    if (scale > 0 && Math.abs(cross) / scale < 1e-6) continue;
    out.push(cur);
  }
  return out;
}

/** Área com sinal (positiva no sentido anti-horário). */
export function polygonArea(points: P2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
