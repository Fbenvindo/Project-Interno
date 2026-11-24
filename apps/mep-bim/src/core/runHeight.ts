// Altura das redes (tubulações, eletrodutos, eletrocalhas, dutos): a cota da parte horizontal
// do trecho e a mudança dessa cota, só no trecho ou em toda a rede ligada a ele na mesma
// altura. As descidas até os pontos (vértices fora da parte horizontal) ficam onde estão e
// as ligações com trechos que não mudam ganham um trecho vertical, para não se soltarem.
import type { Run } from "./runs";
import type { Vec3 } from "./types";

const TOL = 0.02;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Segmentos horizontais (ou quase, até 10% de inclinação: redes com declividade). */
function horizontalSegments(run: Run): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < run.vertices.length - 1; i++) {
    const a = run.vertices[i];
    const b = run.vertices[i + 1];
    const h = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (h > 0.01 && Math.abs(b[1] - a[1]) / h < 0.1) out.push([i, i + 1]);
  }
  return out;
}

/** Cota (Y da cena) da parte horizontal do trecho: a do seu maior segmento horizontal. */
export function runLevel(run: Run): number | null {
  let best: { y: number; h: number } | null = null;
  for (const [i, j] of horizontalSegments(run)) {
    const a = run.vertices[i];
    const b = run.vertices[j];
    const h = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (!best || h > best.h) best = { y: (a[1] + b[1]) / 2, h };
  }
  return best?.y ?? null;
}

const distToSeg = (p: Vec3, a: Vec3, b: Vec3) => {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = l2
    ? Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * ab[0] +
            (p[1] - a[1]) * ab[1] +
            (p[2] - a[2]) * ab[2]) /
            l2,
        ),
      )
    : 0;
  return Math.hypot(
    p[0] - a[0] - ab[0] * t,
    p[1] - a[1] - ab[1] * t,
    p[2] - a[2] - ab[2] * t,
  );
};
/** O ponto toca algum segmento do trecho. */
const touches = (p: Vec3, run: Run) =>
  run.vertices.some(
    (v, i) =>
      i < run.vertices.length - 1 && distToSeg(p, v, run.vertices[i + 1]) < TOL,
  );
/** Dois trechos ligados (a ponta de um sobre o outro). */
export function runsConnected(a: Run, b: Run): boolean {
  const ends = (r: Run) => [r.vertices[0], r.vertices[r.vertices.length - 1]];
  return (
    ends(a).some((p) => touches(p, b)) || ends(b).some((p) => touches(p, a))
  );
}

/** Trechos da rede ligada ao trecho dado que estão na mesma altura (inclui o próprio). */
export function networkAtLevel(runs: Run[], startId: number): number[] {
  const start = runs.find((r) => r.id === startId);
  const y = start ? runLevel(start) : null;
  if (!start || y == null) return start ? [start.id] : [];
  const same = runs.filter((r) => {
    const l = runLevel(r);
    return l != null && Math.abs(l - y) < 0.05;
  });
  const seen = new Set([start.id]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const r of same)
      if (!seen.has(r.id) && runsConnected(cur, r))
        (seen.add(r.id), queue.push(r));
  }
  return [...seen];
}

/**
 * Muda a altura dos trechos `ids` em `delta` (m): a parte horizontal sobe ou desce. Pontas na
 * parte horizontal ligadas a trechos que não mudam ficam no lugar, com um trecho vertical até
 * a nova altura; trechos que não mudam e chegam no meio de um trecho alterado ganham o mesmo
 * trecho vertical na ponta. Devolve a lista completa de trechos atualizada.
 */
export function changeRunsHeight(
  runs: Run[],
  ids: number[],
  delta: number,
): Run[] {
  if (Math.abs(delta) < 1e-6) return runs;
  const set = new Set(ids);
  const changed = runs.filter((r) => set.has(r.id));
  const others = runs.filter((r) => !set.has(r.id));
  const out = new Map<number, Run>();

  for (const r of changed) {
    const moving = new Set<number>();
    for (const [i, j] of horizontalSegments(r)) (moving.add(i), moving.add(j));
    if (!moving.size) continue;
    let verts: Vec3[] = r.vertices.map((v, i) =>
      moving.has(i) ? [v[0], r4(v[1] + delta), v[2]] : v,
    );
    // Pontas ligadas a trechos que não mudam: ficam no lugar e sobem/descem na vertical.
    const last = r.vertices.length - 1;
    if (moving.has(0) && others.some((o) => touches(r.vertices[0], o)))
      verts = [r.vertices[0], ...verts];
    if (moving.has(last) && others.some((o) => touches(r.vertices[last], o)))
      verts = [...verts, r.vertices[last]];
    out.set(r.id, { ...r, vertices: verts });
  }
  // Trechos que não mudam e terminam no meio de um trecho alterado: acompanham com uma vertical.
  for (const o of others) {
    let verts = o.vertices;
    const n = verts.length - 1;
    const hit = (p: Vec3) =>
      changed.some(
        (c) =>
          touches(p, c) &&
          horizontalSegments(c).some(
            ([i, j]) => distToSeg(p, c.vertices[i], c.vertices[j]) < TOL,
          ),
      );
    if (hit(o.vertices[0]))
      verts = [
        [o.vertices[0][0], r4(o.vertices[0][1] + delta), o.vertices[0][2]],
        ...verts,
      ];
    if (hit(o.vertices[n]))
      verts = [
        ...verts,
        [o.vertices[n][0], r4(o.vertices[n][1] + delta), o.vertices[n][2]],
      ];
    if (verts !== o.vertices) out.set(o.id, { ...o, vertices: verts });
  }
  return runs.map((r) => out.get(r.id) ?? r);
}
