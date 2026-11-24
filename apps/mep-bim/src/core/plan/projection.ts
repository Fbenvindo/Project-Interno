// Projeção vista de cima com linhas ocultas removidas: um mapa de alturas (o que está por cima
// em cada ponto da planta) a partir das faces voltadas para cima de todos os elementos em
// projeção; das arestas do contorno de cada elemento, fica só o que está no topo (o tampo da
// mesa esconde os pés e a estrutura; a mesa esconde a parte da cadeira que fica embaixo dela).
// Coordenadas da cena (Y para cima); a conversão para a planta fica com quem chama.
import type { Vec3 } from "../types";
import { topOutline, type CutSegment } from "./section";

export interface ProjMesh {
  id: number;
  positions: Float32Array;
  indices: ArrayLike<number>;
}

/** Arestas visíveis de cima, por elemento. `top`: nada acima desta cota conta (plano de corte). */
export function visibleTopEdges(meshes: ProjMesh[], top = Infinity): Map<number, CutSegment[]> {
  const out = new Map<number, CutSegment[]>();
  if (!meshes.length) return out;
  // Limites em planta (x, z da cena).
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], z = m.positions[i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  // Célula de 1,5 a 5 cm, limitada a ~4 milhões de células.
  const cell = Math.min(0.05, Math.max(0.015, Math.sqrt(((x1 - x0) * (z1 - z0)) / 4e6)));
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const H = new Float32Array(nx * nz).fill(-1e9);

  // Rasteriza as faces voltadas para cima (altura interpolada no centro de cada célula).
  for (const m of meshes) {
    const p = m.positions;
    const idx = m.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = p[a], ay = Math.min(p[a + 1], top), az = p[a + 2];
      const bx = p[b], by = Math.min(p[b + 1], top), bz = p[b + 2];
      const cx = p[c], cy = Math.min(p[c + 1], top), cz = p[c + 2];
      // Face (quase) vertical não cobre nada de cima.
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-10) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell));
      const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell));
      for (let j = j0; j <= j1; j++) {
        const z = z0 + j * cell;
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * cell;
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
          const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * ay + l2 * by + l3 * cy;
          const k = j * nx + i;
          if (y > H[k]) H[k] = y;
        }
      }
    }
  }
  // Altura do topo perto de um ponto (máximo das células vizinhas: a aresta fica na borda da face).
  const topAt = (x: number, z: number) => {
    const i = Math.round((x - x0) / cell);
    const j = Math.round((z - z0) / cell);
    let h = -1e9;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) h = Math.max(h, H[jj * nx + ii]);
      }
    return h;
  };
  const TOL = 0.025;
  for (const m of meshes) {
    const segs: CutSegment[] = [];
    for (const e of topOutline(m.positions, m.indices)) {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[2] - e.a[2]);
      if (len < 1e-4) continue;
      const n = Math.max(1, Math.ceil(len / (cell * 0.75)));
      let start: number | null = null;
      const at = (s: number): Vec3 => [e.a[0] + (e.b[0] - e.a[0]) * s, e.a[1] + (e.b[1] - e.a[1]) * s, e.a[2] + (e.b[2] - e.a[2]) * s];
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        const q = at(s);
        // Visível se não houver nada mais alto em volta (a própria face fica na mesma altura).
        const vis = Math.min(q[1], top) >= topAt(q[0], q[2]) - TOL;
        if (vis && start == null) start = s;
        if ((!vis || k === n) && start != null) {
          const end = vis ? s : (k - 1) / n;
          if (end > start) segs.push({ a: at(start), b: at(end) });
          start = null;
        }
      }
    }
    out.set(m.id, segs);
  }
  return out;
}
