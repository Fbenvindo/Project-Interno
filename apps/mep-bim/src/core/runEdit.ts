// Edição de redes já traçadas: desvio (sobe/desce para fugir de interferências) e
// movimento de um elemento junto com os que estão ligados a ele.
// Coordenadas da cena: metros, Y para cima.
import { COMPONENT_BY_ID } from "./library";
import { pointOBB, type PlacedPoint } from "./points";
import { closestOnSegment, distance, RUN_TYPE_BY_ID, type Run } from "./runs";
import type { Vec3 } from "./types";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scl(a, 1 / l) : [0, 0, 0];
};
const fmt = (v: number) => v.toFixed(2).replace(".", ",");

export const isFlexibleRun = (r: Run) => !!RUN_TYPE_BY_ID[r.typeId]?.flexible;

// ---- Desvio ----------------------------------------------------------------------------------

export interface OffsetSpec {
  /** Altura do desvio (m), sempre positiva. */
  height: number;
  /** Sobe (por cima do obstáculo) ou desce (por baixo). */
  up: boolean;
  /** Curvas de 90° (sobe na vertical) ou de 45° (sobe em diagonal). */
  angle: 90 | 45;
}

export type OffsetResult = { ok: true; vertices: Vec3[] } | { ok: false; reason: string };

/**
 * Desvio num segmento: entre os pontos A e B do segmento (parâmetros tA < tB), o trecho
 * sai da linha, sobe ou desce `height` e volta. Outros trechos ligados no meio do desvio
 * (derivações) impedem o desvio.
 */
export function applyOffset(run: Run, segIndex: number, tA: number, tB: number, spec: OffsetSpec, others: Run[] = []): OffsetResult {
  if (isFlexibleRun(run)) return { ok: false, reason: "Eletroduto flexível não precisa de desvio: ele faz curvas livres." };
  const v = run.vertices;
  const a = v[segIndex];
  const b = v[segIndex + 1];
  if (!a || !b) return { ok: false, reason: "Segmento inválido." };
  const seg = sub(b, a);
  const L = len(seg);
  const u = unit(seg);
  if (Math.abs(u[1]) > 0.2) return { ok: false, reason: "O desvio é feito em trechos horizontais (este segmento é vertical ou muito inclinado)." };
  let [t0, t1] = tA <= tB ? [tA, tB] : [tB, tA];
  t0 = Math.max(0, Math.min(1, t0));
  t1 = Math.max(0, Math.min(1, t1));
  const h = Math.abs(spec.height);
  if (h < 0.01) return { ok: false, reason: "Informe a altura do desvio." };
  const span = (t1 - t0) * L;
  const run45 = spec.angle === 45 ? h : 0;
  if (span < 2 * run45 + 0.05) return { ok: false, reason: `Os pontos estão muito próximos: o desvio de ${fmt(h)} m a ${spec.angle}° precisa de pelo menos ${fmt(2 * run45 + 0.05)} m entre eles.` };
  const S = add(a, scl(seg, t0));
  const E = add(a, scl(seg, t1));
  // Derivações (outros trechos que terminam no meio do desvio) não podem ficar para trás.
  for (const o of others) {
    if (o.id === run.id) continue;
    for (const end of [o.vertices[0], o.vertices[o.vertices.length - 1]]) {
      const { point, t } = closestOnSegment(end, a, b);
      if (distance(point, end) < 0.01 && t > t0 + 1e-6 && t < t1 - 1e-6) return { ok: false, reason: `Há uma derivação (trecho ${o.tag}) no meio do desvio: escolha outro intervalo.` };
    }
  }
  const dy: Vec3 = [0, spec.up ? h : -h, 0];
  const S2 = add(add(S, scl(u, run45)), dy);
  const E2 = add(add(E, scl(u, -run45)), dy);
  const out: Vec3[] = [...v.slice(0, segIndex + 1)];
  const push = (p: Vec3) => {
    if (!out.length || distance(out[out.length - 1], p) > 0.0005) out.push(p);
  };
  push(S);
  push(S2);
  push(E2);
  push(E);
  for (const p of v.slice(segIndex + 1)) push(p);
  return { ok: true, vertices: out };
}

// ---- Mover com os elementos ligados -------------------------------------------------------------

export interface MoveSelection {
  points: number[];
  segments: { runId: number; index: number }[];
}

export type MoveResult =
  | { ok: true; points: Map<number, Vec3>; runs: Map<number, Vec3[]>; movedPoints: number; movedRuns: number }
  | { ok: false; reason: string };

/**
 * Move a seleção por `d` e leva junto o que está ligado a ela:
 * - ponta de trecho num ponto locado (ou ponto locado na ponta de um trecho) movem juntos;
 * - trechos que se encontram num mesmo vértice movem juntos;
 * - o segmento vizinho de um vértice movido estica (se o movimento é na direção dele),
 *   acompanha por inteiro (se é vertical — subida/descida) ou, em trecho rígido, impede o
 *   movimento: a curva teria de mudar de ângulo. Flexível estica em qualquer direção.
 * Derivações (tês) no meio de um segmento só deslizam ao longo dele.
 */
export function moveNetwork(runs: Run[], points: PlacedPoint[], sel: MoveSelection, d: Vec3): MoveResult {
  if (len(d) < 1e-9) return { ok: false, reason: "Sem deslocamento." };
  const runById = new Map(runs.map((r) => [r.id, r]));
  const movedV = new Map<number, Set<number>>();
  const movedP = new Set<number>();
  const queue: ({ kind: "v"; runId: number; i: number } | { kind: "p"; id: number })[] = [];
  const isMoved = (runId: number, i: number) => movedV.get(runId)?.has(i) ?? false;
  const moveV = (runId: number, i: number) => {
    if (isMoved(runId, i)) return;
    if (!movedV.has(runId)) movedV.set(runId, new Set());
    movedV.get(runId)!.add(i);
    queue.push({ kind: "v", runId, i });
  };
  const moveP = (id: number) => {
    if (movedP.has(id)) return;
    movedP.add(id);
    queue.push({ kind: "p", id });
  };
  const inPoint = (p: Vec3, pt: PlacedPoint) => {
    const def = COMPONENT_BY_ID[pt.componentId];
    if (!def) return distance(p, pt.position) < 0.05;
    const o = pointOBB(pt, def);
    return o.axes.every((ax, k) => Math.abs(dot(sub(p, o.center), ax)) <= o.half[k] + 0.002);
  };
  const dU = unit(d);

  for (const s of sel.segments) {
    moveV(s.runId, s.index);
    moveV(s.runId, s.index + 1);
  }
  for (const id of sel.points) moveP(id);

  let guard = 0;
  while (queue.length) {
    if (++guard > 100000) return { ok: false, reason: "Rede grande demais para mover de uma vez." };
    const item = queue.shift()!;
    if (item.kind === "p") {
      const pt = points.find((q) => q.id === item.id);
      if (!pt) continue;
      // Trechos que saem deste ponto acompanham.
      for (const r of runs) {
        const last = r.vertices.length - 1;
        if (inPoint(r.vertices[0], pt)) moveV(r.id, 0);
        if (inPoint(r.vertices[last], pt)) moveV(r.id, last);
      }
      continue;
    }
    const r = runById.get(item.runId)!;
    const i = item.i;
    const p = r.vertices[i];
    const last = r.vertices.length - 1;
    // Mesmo vértice em outros trechos (continuação ou tê no vértice) e pontos locados na ponta.
    for (const o of runs) {
      if (o.id === r.id) continue;
      o.vertices.forEach((q, k) => {
        if ((k === 0 || k === o.vertices.length - 1 || i === 0 || i === last) && distance(q, p) < 0.005) moveV(o.id, k);
      });
    }
    if (i === 0 || i === last) for (const pt of points) if (inPoint(p, pt)) moveP(pt.id);
    // Segmentos vizinhos no próprio trecho.
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j > last || isMoved(r.id, j)) continue;
      const q = r.vertices[j];
      const seg = sub(q, p);
      const segLen = len(seg);
      if (segLen < 1e-6) {
        moveV(r.id, j);
        continue;
      }
      const u = unit(seg);
      const along = dot(d, u);
      const perp = len(sub(d, scl(u, along)));
      if (isFlexibleRun(r)) continue; // estica/curva livre
      if (perp < 1e-4) {
        if (segLen - along < 0.02) return { ok: false, reason: `Movimento cancelado: o segmento do trecho ${r.tag} ficaria sem comprimento.` };
        continue; // estica ou encurta na mesma direção
      }
      if (Math.abs(u[1]) > 0.999) {
        moveV(r.id, j); // subida/descida acompanha
        continue;
      }
      const ang = Math.round((Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(dU, u))))) * 180) / Math.PI);
      return {
        ok: false,
        reason: `Movimento cancelado: a curva do trecho ${r.tag} não permite mover nessa direção (o segmento vizinho teria de mudar de ângulo, ${ang}° em relação ao movimento). Mova na direção do segmento vizinho ou faça um desvio.`,
      };
    }
  }

  // Resultado e conferência das derivações no meio de segmentos (tês).
  const newRuns = new Map<number, Vec3[]>();
  for (const [runId, set] of movedV) {
    const r = runById.get(runId)!;
    newRuns.set(runId, r.vertices.map((v, k) => (set.has(k) ? add(v, d) : v)));
  }
  const after = (r: Run) => newRuns.get(r.id) ?? r.vertices;
  for (const a of runs) {
    for (const k of [0, a.vertices.length - 1]) {
      const end = a.vertices[k];
      for (const b of runs) {
        if (b.id === a.id) continue;
        for (let s = 0; s < b.vertices.length - 1; s++) {
          const { point, t } = closestOnSegment(end, b.vertices[s], b.vertices[s + 1]);
          if (t <= 1e-6 || t >= 1 - 1e-6 || distance(point, end) > 0.005) continue;
          // Era um tê: continua sobre o segmento depois do movimento?
          const e2 = after(a)[k];
          const bv = after(b);
          const c = closestOnSegment(e2, bv[s], bv[s + 1]);
          if (distance(c.point, e2) > 0.005 || c.t <= 0 || c.t >= 1) {
            return { ok: false, reason: `Movimento cancelado: a derivação do trecho ${a.tag} no trecho ${b.tag} sairia do lugar.` };
          }
        }
      }
    }
  }
  const newPoints = new Map<number, Vec3>();
  for (const id of movedP) {
    const pt = points.find((q) => q.id === id);
    if (pt) newPoints.set(id, add(pt.position, d));
  }
  return { ok: true, points: newPoints, runs: newRuns, movedPoints: newPoints.size, movedRuns: newRuns.size };
}
