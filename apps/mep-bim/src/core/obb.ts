// Caixas orientadas (OBB) e teste exato caixa × triângulos (eixos separadores,
// Akenine-Möller), usado para refinar a triagem de interferências por AABB.
import type { BBox, Vec3 } from "./types";

export interface OBB {
  center: Vec3;
  /** Eixos unitários e ortogonais. */
  axes: [Vec3, Vec3, Vec3];
  /** Meias-dimensões ao longo de cada eixo (m). */
  half: Vec3;
}

export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Expande (valor positivo) ou encolhe (negativo) a caixa em todas as direções. */
export function inflate(obb: OBB, by: number): OBB {
  return { ...obb, half: obb.half.map((h) => Math.max(h + by, 1e-6)) as Vec3 };
}

export function obbToAabb(obb: OBB): BBox {
  const ext = [0, 1, 2].map((k) => obb.axes.reduce((s, ax, i) => s + Math.abs(ax[k]) * obb.half[i], 0));
  return {
    min: [obb.center[0] - ext[0], obb.center[1] - ext[1], obb.center[2] - ext[2]],
    max: [obb.center[0] + ext[0], obb.center[1] + ext[1], obb.center[2] + ext[2]],
  };
}

/** Triângulo (já nas coordenadas locais da caixa) × caixa centrada na origem. */
function triBoxOverlap(h: Vec3, v0: Vec3, v1: Vec3, v2: Vec3): boolean {
  // Normais das faces da caixa.
  for (let k = 0; k < 3; k++) {
    const mn = Math.min(v0[k], v1[k], v2[k]);
    const mx = Math.max(v0[k], v1[k], v2[k]);
    if (mn > h[k] || mx < -h[k]) return false;
  }
  // Normal do triângulo.
  const e0 = sub(v1, v0);
  const e1 = sub(v2, v1);
  const e2 = sub(v0, v2);
  const n = cross(e0, e1);
  const d = dot(n, v0);
  const rn = h[0] * Math.abs(n[0]) + h[1] * Math.abs(n[1]) + h[2] * Math.abs(n[2]);
  if (Math.abs(d) > rn) return false;
  // Produtos vetoriais dos eixos da caixa com as arestas.
  const units: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const u of units) {
    for (const e of [e0, e1, e2]) {
      const a = cross(u, e);
      if (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]) < 1e-12) continue;
      const p0 = dot(v0, a);
      const p1 = dot(v1, a);
      const p2 = dot(v2, a);
      const r = h[0] * Math.abs(a[0]) + h[1] * Math.abs(a[1]) + h[2] * Math.abs(a[2]);
      if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
    }
  }
  return true;
}

/** Verdadeiro se algum triângulo da malha intercepta a caixa orientada. */
export function obbIntersectsMesh(obb: OBB, mesh: TriangleMesh): boolean {
  const { positions: p, indices } = mesh;
  const [a0, a1, a2] = obb.axes;
  const c = obb.center;
  const local = (i: number): Vec3 => {
    const w: Vec3 = [p[i * 3] - c[0], p[i * 3 + 1] - c[1], p[i * 3 + 2] - c[2]];
    return [dot(w, a0), dot(w, a1), dot(w, a2)];
  };
  for (let t = 0; t < indices.length; t += 3) {
    if (triBoxOverlap(obb.half, local(indices[t]), local(indices[t + 1]), local(indices[t + 2]))) return true;
  }
  return false;
}

/** Malha triangulada de uma caixa orientada (para testar caixa × caixa). */
export function obbMesh(obb: OBB): TriangleMesh {
  const corners: number[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const v = [0, 1, 2].map((k) => obb.center[k] + obb.axes[0][k] * obb.half[0] * sx + obb.axes[1][k] * obb.half[1] * sy + obb.axes[2][k] * obb.half[2] * sz);
        corners.push(...v);
      }
  // Índice = sx*4 + sy*2 + sz (0 ou 1 em cada eixo)
  const faces = [
    [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
  ];
  const idx = faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { positions: new Float32Array(corners), indices: new Uint32Array(idx) };
}
