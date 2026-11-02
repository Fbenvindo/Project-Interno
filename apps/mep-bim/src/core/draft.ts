// Desenho 2D na planta (anotações): linhas, arcos, círculos, elipses, polígonos,
// textos, cotas e marcadores de coordenada. Coordenadas do projeto (IFC, m).
import type { Prim } from "./plan/drawing";
import type { P2 } from "./plan/section";

interface Base {
  /** Id na cena: faixa −800.000 (fora de pontos, trechos e caixas). */
  id: number;
  storey: string;
}

export type DraftEntity = Base &
  (
    | { kind: "linha"; a: P2; b: P2 }
    | { kind: "arco"; c: P2; r: number; a0: number; a1: number }
    | { kind: "circulo"; c: P2; r: number }
    | { kind: "elipse"; c: P2; rx: number; ry: number; rot: number }
    | { kind: "poligono"; pts: P2[]; closed: boolean; shape?: "quadrado" | "retangulo" | "triangulo" | "poligonal" }
    | { kind: "texto"; p: P2; text: string; size: number; rot: number }
    /** Cota linear: horizontal/vertical (ortogonal) ou alinhada (inclinada); `at` é um ponto da linha de cota. */
    | { kind: "cota"; mode: "horizontal" | "vertical" | "alinhada"; a: P2; b: P2; at: P2 }
    | { kind: "cota-angular"; c: P2; p1: P2; p2: P2; at: P2 }
    /** Marcador de coordenada: mostra X/Y do projeto ou E/N do mapa (texto calculado ao desenhar). */
    | { kind: "coordenada"; p: P2; at: P2; label: string }
  );

export type DraftKind = DraftEntity["kind"];

export const DRAFT_BASE = 800_000;
let draftSeq = 1;
export const newDraftId = () => -(DRAFT_BASE + draftSeq++);
export const isDraftId = (id: number) => id <= -DRAFT_BASE && id > -(DRAFT_BASE + 99_999);
/** Ao abrir um projeto: continua a numeração depois do maior id existente. */
export function syncDraftIds(list: DraftEntity[]) {
  for (const e of list) draftSeq = Math.max(draftSeq, -e.id - DRAFT_BASE + 1);
}

// ---- Geometria ---------------------------------------------------------------------------
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const scl = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
const norm = (a: P2): P2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
export const dist = (a: P2, b: P2) => len(sub(a, b));

/** Arco por três pontos (início, ponto no arco, fim); null se colineares. */
export function arcFrom3(p1: P2, p2: P2, p3: P2): { c: P2; r: number; a0: number; a1: number } | null {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
  if (Math.abs(d) < 1e-12) return null;
  const s1 = p1[0] ** 2 + p1[1] ** 2;
  const s2 = p2[0] ** 2 + p2[1] ** 2;
  const s3 = p3[0] ** 2 + p3[1] ** 2;
  const c: P2 = [(s1 * (p2[1] - p3[1]) + s2 * (p3[1] - p1[1]) + s3 * (p1[1] - p2[1])) / d, (s1 * (p3[0] - p2[0]) + s2 * (p1[0] - p3[0]) + s3 * (p2[0] - p1[0])) / d];
  const ang = (p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  let a0 = ang(p1);
  let a1 = ang(p3);
  const am = ang(p2);
  // Sentido anti-horário de a0 a a1 passando por am; senão inverte.
  const ccwHas = (from: number, to: number, x: number) => {
    const n = (v: number) => ((v - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return n(x) <= n(to);
  };
  if (!ccwHas(a0, a1, am)) [a0, a1] = [a1, a0];
  return { c, r: dist(c, p1), a0, a1 };
}

const arcPts = (c: P2, r: number, a0: number, a1: number, n = 48): P2[] => {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const k = Math.max(4, Math.ceil((n * sweep) / (2 * Math.PI)));
  return Array.from({ length: k + 1 }, (_, i) => {
    const a = a0 + (sweep * i) / k;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as P2;
  });
};

const ellipsePts = (c: P2, rx: number, ry: number, rot: number, n = 72): P2[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)] as P2;
  });

/** Quadrado a partir de um lado (a → b), para a esquerda do sentido do lado. */
export function squareFrom(a: P2, b: P2): P2[] {
  const v = sub(b, a);
  const n: P2 = [-v[1], v[0]];
  return [a, b, add(b, n), add(a, n)];
}

export const rectFrom = (a: P2, b: P2): P2[] => [a, [b[0], a[1]], b, [a[0], b[1]]];

/** Ângulo entre duas direções a partir do vértice (graus, 0..180). */
export function angleDeg(c: P2, p1: P2, p2: P2): number {
  const u = norm(sub(p1, c));
  const v = norm(sub(p2, c));
  return (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
}

const fmtLen = (m: number) => m.toFixed(2).replace(".", ",");

// ---- Desenho (primitivas da planta e da prancha) -------------------------------------------------

const COLOR = "#1f2937";
const PEN = 0.25;

/**
 * Primitivas de uma entidade. `scale` é o denominador da escala (50 = 1:50): textos e
 * marcas de cota são dimensionados em mm de papel.
 */
export function draftPrims(e: DraftEntity, scale: number): Prim[] {
  const m = scale / 1000; // metros de modelo por mm de papel
  const layer = e.kind === "cota" || e.kind === "cota-angular" ? "ANOT-COTAS" : e.kind === "texto" || e.kind === "coordenada" ? "ANOT-TEXTOS" : "ANOT-DESENHO";
  const base = { layer, color: COLOR, id: e.id };
  const line = (a: P2, b: P2, weight = PEN): Prim => ({ t: "line", a, b, weight, ...base });
  const text = (p: P2, s: string, angle = 0, anchor: "start" | "middle" | "end" = "middle", size = 2.5): Prim => ({ t: "text", p, text: s, height: size * m, anchor, angle, ...base });
  switch (e.kind) {
    case "linha":
      return [line(e.a, e.b)];
    case "arco":
      return [{ t: "poly", pts: arcPts(e.c, e.r, e.a0, e.a1), closed: false, weight: PEN, ...base }];
    case "circulo":
      return [{ t: "circle", c: e.c, r: e.r, weight: PEN, ...base }];
    case "elipse":
      return [{ t: "poly", pts: ellipsePts(e.c, e.rx, e.ry, e.rot), closed: true, weight: PEN, ...base }];
    case "poligono":
      return [{ t: "poly", pts: e.pts, closed: e.closed, weight: PEN, ...base }];
    case "texto":
      return [text(e.p, e.text, e.rot, "start", e.size)];
    case "coordenada": {
      const out: Prim[] = [line(e.p, e.at, 0.18), { t: "circle", c: e.p, r: 0.8 * m, weight: 0.18, ...base }];
      const lines = e.label.split("\n");
      lines.forEach((l, i) => out.push(text([e.at[0] + 1 * m, e.at[1] - i * 3.2 * m], l, 0, "start", 2.2)));
      out.push(line(e.at, [e.at[0] + Math.max(...lines.map((l) => l.length)) * 1.4 * m, e.at[1]], 0.18));
      return out;
    }
    case "cota": {
      // Direção da cota: horizontal/vertical (ortogonal) ou ao longo de a→b (alinhada).
      const dir: P2 = e.mode === "horizontal" ? [1, 0] : e.mode === "vertical" ? [0, 1] : norm(sub(e.b, e.a));
      const nrm: P2 = [-dir[1], dir[0]];
      const off = (e.at[0] - e.a[0]) * nrm[0] + (e.at[1] - e.a[1]) * nrm[1];
      const proj = (p: P2): P2 => {
        const along = (p[0] - e.a[0]) * dir[0] + (p[1] - e.a[1]) * dir[1];
        return add(e.a, add(scl(dir, along), scl(nrm, off)));
      };
      const da = proj(e.a);
      const db = proj(e.b);
      const value = Math.abs((e.b[0] - e.a[0]) * dir[0] + (e.b[1] - e.a[1]) * dir[1]);
      const ext = (p: P2, q: P2): Prim => {
        const v = sub(q, p);
        const l = len(v);
        const u = l > 1e-9 ? scl(v, 1 / l) : nrm;
        return line(add(p, scl(u, 1 * m)), add(q, scl(u, 1.5 * m)), 0.13);
      };
      const tick = (p: P2): Prim => line(add(p, scl(add(dir, nrm), -1.2 * m)), add(p, scl(add(dir, nrm), 1.2 * m)), 0.35);
      let angle = Math.atan2(dir[1], dir[0]);
      if (angle > Math.PI / 2 + 1e-6) angle -= Math.PI;
      if (angle <= -Math.PI / 2 + 1e-6) angle += Math.PI;
      const mid = scl(add(da, db), 0.5);
      const up: P2 = [-Math.sin(angle), Math.cos(angle)];
      return [ext(e.a, da), ext(e.b, db), line(da, db, 0.18), tick(da), tick(db), text(add(mid, scl(up, 1.8 * m)), fmtLen(value), angle, "middle", 2.5)];
    }
    case "cota-angular": {
      const r = dist(e.c, e.at);
      const a1 = Math.atan2(e.p1[1] - e.c[1], e.p1[0] - e.c[0]);
      const a2 = Math.atan2(e.p2[1] - e.c[1], e.p2[0] - e.c[0]);
      // Arco pelo lado menor (≤ 180°).
      let from = a1;
      let to = a2;
      let sweep = to - from;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      if (sweep < 0) [from, to] = [to, from];
      const pts = arcPts(e.c, r, from, from + Math.abs(sweep));
      const midA = from + Math.abs(sweep) / 2;
      const tp: P2 = [e.c[0] + (r + 3 * m) * Math.cos(midA), e.c[1] + (r + 3 * m) * Math.sin(midA)];
      const deg = angleDeg(e.c, e.p1, e.p2);
      return [
        line(e.c, add(e.c, scl(norm(sub(e.p1, e.c)), r + 1.5 * m)), 0.13),
        line(e.c, add(e.c, scl(norm(sub(e.p2, e.c)), r + 1.5 * m)), 0.13),
        { t: "poly", pts, closed: false, weight: 0.18, ...base },
        text(tp, `${deg.toFixed(1).replace(".", ",")}°`, 0, "middle", 2.5),
      ];
    }
  }
}

// ---- Seleção e encaixe ------------------------------------------------------------------------

function segDist(p: P2, a: P2, b: P2): number {
  const ab = sub(b, a);
  const l2 = ab[0] ** 2 + ab[1] ** 2;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
  return dist(p, add(a, scl(ab, t)));
}

/** Distância (m) do ponto à entidade desenhada. */
export function draftDistance(e: DraftEntity, p: P2, scale: number): number {
  let best = Infinity;
  for (const pr of draftPrims(e, scale)) {
    if (pr.t === "line") best = Math.min(best, segDist(p, pr.a, pr.b));
    else if (pr.t === "poly") {
      const n = pr.pts.length;
      for (let i = 0; i < (pr.closed ? n : n - 1); i++) best = Math.min(best, segDist(p, pr.pts[i], pr.pts[(i + 1) % n]));
    } else if (pr.t === "circle") best = Math.min(best, Math.abs(dist(p, pr.c) - pr.r));
    else best = Math.min(best, dist(p, pr.p) - pr.height * 0.8);
  }
  return Math.max(0, best);
}

/** Pontos de encaixe: extremidades, meios, centros e vértices. */
export function draftSnapPoints(e: DraftEntity): P2[] {
  switch (e.kind) {
    case "linha":
      return [e.a, e.b, scl(add(e.a, e.b), 0.5)];
    case "arco":
      return [e.c, [e.c[0] + e.r * Math.cos(e.a0), e.c[1] + e.r * Math.sin(e.a0)], [e.c[0] + e.r * Math.cos(e.a1), e.c[1] + e.r * Math.sin(e.a1)]];
    case "circulo":
      return [e.c, [e.c[0] + e.r, e.c[1]], [e.c[0] - e.r, e.c[1]], [e.c[0], e.c[1] + e.r], [e.c[0], e.c[1] - e.r]];
    case "elipse":
      return [e.c];
    case "poligono": {
      const mids = e.pts.slice(0, e.closed ? e.pts.length : e.pts.length - 1).map((p, i) => scl(add(p, e.pts[(i + 1) % e.pts.length]), 0.5));
      return [...e.pts, ...mids];
    }
    case "texto":
      return [e.p];
    case "cota":
      return [e.a, e.b];
    case "cota-angular":
      return [e.c];
    case "coordenada":
      return [e.p];
  }
}

/** Entidade deslocada (mover, copiar, colar). */
export function translateDraft(e: DraftEntity, d: P2): DraftEntity {
  const t = (p: P2): P2 => add(p, d);
  switch (e.kind) {
    case "linha":
      return { ...e, a: t(e.a), b: t(e.b) };
    case "arco":
    case "circulo":
    case "elipse":
      return { ...e, c: t(e.c) };
    case "poligono":
      return { ...e, pts: e.pts.map(t) };
    case "texto":
      return { ...e, p: t(e.p) };
    case "cota":
      return { ...e, a: t(e.a), b: t(e.b), at: t(e.at) };
    case "cota-angular":
      return { ...e, c: t(e.c), p1: t(e.p1), p2: t(e.p2), at: t(e.at) };
    case "coordenada":
      return { ...e, p: t(e.p), at: t(e.at) };
  }
}

/** Segmentos de uma entidade (para estender até ela e para conectar). */
export function draftSegments(e: DraftEntity): [P2, P2][] {
  if (e.kind === "linha") return [[e.a, e.b]];
  if (e.kind === "poligono") {
    const out: [P2, P2][] = [];
    for (let i = 0; i < (e.closed ? e.pts.length : e.pts.length - 1); i++) out.push([e.pts[i], e.pts[(i + 1) % e.pts.length]]);
    return out;
  }
  if (e.kind === "arco") {
    const p = arcPts(e.c, e.r, e.a0, e.a1);
    return p.slice(0, -1).map((q, i) => [q, p[i + 1]]);
  }
  if (e.kind === "circulo" || e.kind === "elipse") {
    const p = e.kind === "circulo" ? ellipsePts(e.c, e.r, e.r, 0) : ellipsePts(e.c, e.rx, e.ry, e.rot);
    return p.map((q, i) => [q, p[(i + 1) % p.length]]);
  }
  return [];
}

/** Interseção da reta (a→b, infinita) com o segmento [c, d]: parâmetro t na reta, ou null. */
export function lineSegmentHit(a: P2, b: P2, c: P2, d: P2): number | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const q = sub(c, a);
  const t = (q[0] * s[1] - q[1] * s[0]) / den;
  const u = (q[0] * r[1] - q[1] * r[0]) / den;
  return u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/**
 * Estende a linha até o limite: a extremidade mais próxima da interseção avança (ou recua)
 * até o primeiro segmento do limite. null se a reta não encontra o limite.
 */
export function extendLine(e: Extract<DraftEntity, { kind: "linha" }>, boundary: [P2, P2][]): Extract<DraftEntity, { kind: "linha" }> | null {
  const ts = boundary.map(([c, d]) => lineSegmentHit(e.a, e.b, c, d)).filter((t): t is number => t != null);
  // t > 1: além de b; t < 0: antes de a.
  const beyond = ts.filter((t) => t > 1 + 1e-9).sort((x, y) => x - y)[0];
  const before = ts.filter((t) => t < -1e-9).sort((x, y) => y - x)[0];
  if (beyond == null && before == null) return null;
  const at = (t: number): P2 => add(e.a, scl(sub(e.b, e.a), t));
  // Estende pela extremidade cujo alcance é menor.
  if (beyond != null && (before == null || beyond - 1 <= -before)) return { ...e, b: at(beyond) };
  return { ...e, a: at(before!) };
}

/**
 * Conectar: duas linhas → canto (concordância de raio zero: as duas vão até a interseção);
 * linhas e poligonais que se tocam nas pontas → uma poligonal única.
 */
export function connectEntities(list: DraftEntity[]): { remove: number[]; add: DraftEntity[] } | null {
  const lines = list.filter((e): e is Extract<DraftEntity, { kind: "linha" }> => e.kind === "linha");
  if (list.length === 2 && lines.length === 2) {
    const [l1, l2] = lines;
    const r = sub(l1.b, l1.a);
    const s = sub(l2.b, l2.a);
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) > 1e-12) {
      const q = sub(l2.a, l1.a);
      const t = (q[0] * s[1] - q[1] * s[0]) / den;
      const x = add(l1.a, scl(r, t));
      const near = (l: typeof l1): typeof l1 => (dist(l.a, x) < dist(l.b, x) ? { ...l, a: x } : { ...l, b: x });
      return { remove: [l1.id, l2.id], add: [near(l1), near(l2)] };
    }
  }
  // União de cadeias abertas que se tocam.
  const chains = list
    .map((e) => (e.kind === "linha" ? { id: e.id, pts: [e.a, e.b], storey: e.storey } : e.kind === "poligono" && !e.closed ? { id: e.id, pts: [...e.pts], storey: e.storey } : null))
    .filter((c): c is { id: number; pts: P2[]; storey: string } => c != null);
  if (chains.length < 2) return null;
  const tol = 1e-3;
  let cur = chains.shift()!;
  const used = [cur.id];
  let progress = true;
  while (progress && chains.length) {
    progress = false;
    for (let i = 0; i < chains.length; i++) {
      const c = chains[i];
      const [h, t] = [cur.pts[0], cur.pts[cur.pts.length - 1]];
      const [ch, ct] = [c.pts[0], c.pts[c.pts.length - 1]];
      let merged: P2[] | null = null;
      if (dist(t, ch) < tol) merged = [...cur.pts, ...c.pts.slice(1)];
      else if (dist(t, ct) < tol) merged = [...cur.pts, ...c.pts.slice(0, -1).reverse()];
      else if (dist(h, ct) < tol) merged = [...c.pts, ...cur.pts.slice(1)];
      else if (dist(h, ch) < tol) merged = [...c.pts.slice().reverse(), ...cur.pts.slice(1)];
      if (merged) {
        cur = { ...cur, pts: merged };
        used.push(c.id);
        chains.splice(i, 1);
        progress = true;
        break;
      }
    }
  }
  if (used.length < 2) return null;
  const closed = dist(cur.pts[0], cur.pts[cur.pts.length - 1]) < tol;
  const pts = closed ? cur.pts.slice(0, -1) : cur.pts;
  return { remove: used, add: [{ id: newDraftId(), storey: cur.storey, kind: "poligono", pts, closed, shape: "poligonal" }] };
}

export const DRAFT_LABEL: Record<DraftKind, string> = {
  linha: "Linha",
  arco: "Arco",
  circulo: "Círculo",
  elipse: "Elipse",
  poligono: "Polígono",
  texto: "Texto",
  cota: "Cota",
  "cota-angular": "Cota angular",
  coordenada: "Coordenada",
};
