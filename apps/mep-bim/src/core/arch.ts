// Arquitetura e estrutura modeladas no app: paredes (com encontros em canto), portas e janelas
// nos vãos das paredes, lajes, pilares e vigas. Coordenadas do IFC (metros, Z para cima): o
// plano (x, y) é o da planta e z a cota. Cada elemento vira um ElementInfo e uma malha, como os
// do IFC, e entra nas plantas, cortes, 3D, quantitativos, visibilidade e exportação.
import type { CoordinateSystem } from "./math";
import { newGuid, type StoreyLevel } from "./points";
import type { BBox, ElementInfo, PropertyGroup, Vec3 } from "./types";

type P2 = [number, number];

export type ArchKind = "parede" | "porta" | "janela" | "laje" | "pilar" | "viga";

interface ArchBase {
  id: number;
  guid: string;
  kind: ArchKind;
  /** Pavimento (nome do IFC). */
  storey: string;
  /** Nome do tipo (ex.: "Alvenaria 15 cm"). */
  name: string;
}

export interface Wall extends ArchBase {
  kind: "parede";
  /** Eixo da parede em planta. */
  a: P2;
  b: P2;
  /** Cota da base (z) e altura (m). */
  base: number;
  height: number;
  thickness: number;
  /** Parede estrutural (concreto): vai para a disciplina de estrutura. */
  structural?: boolean;
}

export interface Opening extends ArchBase {
  kind: "porta" | "janela";
  /** GlobalId da parede hospedeira. */
  host: string;
  /** Distância do início da parede (a) ao centro do vão (m). */
  offset: number;
  width: number;
  height: number;
  /** Peitoril (m acima da base da parede); portas: 0. */
  sill: number;
  /** Portas: abre para o outro lado da parede. */
  flip?: boolean;
  /** Portas: dobradiça à direita (vista de quem empurra). */
  right?: boolean;
}

export interface Slab extends ArchBase {
  kind: "laje";
  outline: P2[];
  /** Cota do topo (z). */
  top: number;
  thickness: number;
}

export interface Column extends ArchBase {
  kind: "pilar";
  at: P2;
  base: number;
  height: number;
  /** Seção (m): largura ao longo da rotação e profundidade. */
  width: number;
  depth: number;
  /** Rotação em planta (rad). */
  rotation: number;
}

export interface Beam extends ArchBase {
  kind: "viga";
  a: P2;
  b: P2;
  /** Cota do topo (z). */
  top: number;
  width: number;
  height: number;
}

export type ArchElement = Wall | Opening | Slab | Column | Beam;

export const ARCH_LABEL: Record<ArchKind, string> = { parede: "Parede", porta: "Porta", janela: "Janela", laje: "Laje", pilar: "Pilar", viga: "Viga" };

// ---- Identificadores -------------------------------------------------------------------------

/** Faixa de ids da cena: −(950 000 + n), entre as caixas de passagem e os trechos (desenhos: −800 000…). */
const ARCH_BASE = 950_000;
const ARCH_MAX = 50_000;
let nextArchId = 1;
export function newArchId(): number {
  const id = nextArchId;
  nextArchId = (nextArchId % (ARCH_MAX - 1)) + 1;
  return id;
}
export const archElementId = (id: number) => -(ARCH_BASE + id);
/** Elemento de arquitetura/estrutura de um id da cena, ou null. */
export function archIdOf(sceneId: number): number | null {
  const n = -sceneId - ARCH_BASE;
  return n > 0 && n < ARCH_MAX ? n : null;
}

// ---- Geometria em planta ---------------------------------------------------------------------

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const len2 = (a: P2) => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => {
  const l = len2(a) || 1;
  return [a[0] / l, a[1] / l];
};
const left = (d: P2): P2 => [-d[1], d[0]];
const same = (a: P2, b: P2, tol = 0.005) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

/** Interseção das retas p + s·u e q + t·v (null se paralelas). */
function lineX(p: P2, u: P2, q: P2, v: P2): P2 | null {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-9) return null;
  const s = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
  return add(p, mul(u, s));
}

export const wallLength = (w: Pick<Wall, "a" | "b">) => len2(sub(w.b, w.a));

/** Cantos da parede em planta (lado esquerdo e direito de a→b), com os encontros em canto resolvidos. */
export interface WallFootprint {
  sl: P2;
  sr: P2;
  el: P2;
  er: P2;
}

/**
 * Encontros: ponta de parede sobre a ponta de outra parede do mesmo pavimento vira um canto em
 * esquadria (sem sobreposição nem fresta); ponta encostada no meio de outra parede termina na
 * face dela (encontro em T).
 */
export function wallFootprints(walls: Wall[]): Map<number, WallFootprint> {
  const out = new Map<number, WallFootprint>();
  for (const w of walls) {
    const d = unit(sub(w.b, w.a));
    const n = mul(left(d), w.thickness / 2);
    const fp: WallFootprint = { sl: add(w.a, n), sr: sub(w.a, n), el: add(w.b, n), er: sub(w.b, n) };
    const others = walls.filter((o) => o !== w && o.storey === w.storey && wallLength(o) > 1e-3);
    const L = wallLength(w);
    for (const end of ["a", "b"] as const) {
      const P = w[end];
      // Caminho que passa pela ponta: chega por `uin` e sai por `uout`.
      const joins = others.filter((o) => same(o.a, P) || same(o.b, P));
      if (joins.length === 1) {
        const o = joins[0];
        const od = unit(sub(o.b, o.a));
        const oAway: P2 = same(o.a, P) ? od : mul(od, -1);
        const uin = end === "b" ? d : mul(oAway, -1);
        const uout = end === "b" ? oAway : d;
        const tIn = end === "b" ? w.thickness : o.thickness;
        const tOut = end === "b" ? o.thickness : w.thickness;
        if (Math.abs(uin[0] * uout[1] - uin[1] * uout[0]) < 0.05) continue; // alinhadas: sem canto
        const corner = (side: 1 | -1) =>
          lineX(add(P, mul(left(uin), (side * tIn) / 2)), uin, add(P, mul(left(uout), (side * tOut) / 2)), uout);
        const cl = corner(1);
        const cr = corner(-1);
        // Lado esquerdo do caminho = lado esquerdo da parede (a→b) nos dois casos.
        const limit = 3 * Math.max(w.thickness, o.thickness);
        if (cl && cr && len2(sub(cl, P)) < limit && len2(sub(cr, P)) < limit) {
          if (end === "b") (fp.el = cl, fp.er = cr);
          else (fp.sl = cl, fp.sr = cr);
        }
        continue;
      }
      // Encontro em T: a ponta está sobre o eixo (miolo) de outra parede.
      for (const o of others) {
        const od = unit(sub(o.b, o.a));
        const s = dot(sub(P, o.a), od);
        const off = Math.abs(dot(sub(P, o.a), left(od)));
        if (s < 0.01 || s > wallLength(o) - 0.01 || off > o.thickness / 2 + 0.005) continue;
        const sin = Math.abs(d[0] * od[1] - d[1] * od[0]);
        if (sin < 0.2) continue;
        // Face da outra parede voltada para esta parede.
        const toward = end === "b" ? mul(d, -1) : d;
        const nf = mul(left(od), Math.sign(dot(toward, left(od))) || 1);
        const face = add(o.a, mul(nf, o.thickness / 2));
        const pl = lineX(end === "b" ? fp.sl : fp.el, d, face, od);
        const pr = lineX(end === "b" ? fp.sr : fp.er, d, face, od);
        if (pl && pr && len2(sub(pl, P)) < L) {
          if (end === "b") (fp.el = pl, fp.er = pr);
          else (fp.sl = pl, fp.sr = pr);
        }
        break;
      }
    }
    out.set(w.id, fp);
  }
  return out;
}

// ---- Malhas ------------------------------------------------------------------------------------

/** Triângulos em coordenadas do IFC (m). */
export interface TriMesh {
  positions: number[];
  indices: number[];
}

const emptyMesh = (): TriMesh => ({ positions: [], indices: [] });

/** Face plana (polígono convexo ou já triangulado em leque), vértices próprios. */
function face(m: TriMesh, pts: Vec3[]) {
  const base = m.positions.length / 3;
  for (const p of pts) m.positions.push(p[0], p[1], p[2]);
  for (let i = 1; i < pts.length - 1; i++) m.indices.push(base, base + i, base + i + 1);
}

/** Área com sinal (positiva = anti-horário). */
export function signedArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Triangulação por orelhas de um polígono simples anti-horário (índices do polígono). */
export function triangulate(poly: P2[]): [number, number, number][] {
  const idx = poly.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: P2, a: P2, b: P2, c: P2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const [a, b, c] = [poly[i0], poly[i1], poly[i2]];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(poly[j], a, b, c))) continue;
      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break; // polígono degenerado: o que sobrou vai em leque
  }
  for (let i = 1; i < idx.length - 1; i++) out.push([idx[0], idx[i], idx[i + 1]]);
  return out;
}

/** Prisma vertical de um polígono em planta, de z0 a z1. */
export function prism(m: TriMesh, polyIn: P2[], z0: number, z1: number) {
  if (polyIn.length < 3 || z1 - z0 < 1e-6) return;
  const poly = signedArea(polyIn) < 0 ? [...polyIn].reverse() : polyIn;
  const tris = triangulate(poly);
  const base = m.positions.length / 3;
  // Topo e base (vértices compartilhados entre os triângulos de cada tampa).
  for (const p of poly) m.positions.push(p[0], p[1], z1);
  for (const [a, b, c] of tris) m.indices.push(base + a, base + b, base + c);
  const base2 = m.positions.length / 3;
  for (const p of poly) m.positions.push(p[0], p[1], z0);
  for (const [a, b, c] of tris) m.indices.push(base2 + a, base2 + c, base2 + b);
  // Laterais.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    face(m, [
      [a[0], a[1], z0],
      [b[0], b[1], z0],
      [b[0], b[1], z1],
      [a[0], a[1], z1],
    ]);
  }
}

/** Caixa no referencial local (origem o, eixos X e Y em planta): x, y e z em intervalos. */
function localBox(m: TriMesh, o: P2, X: P2, Y: P2, [x0, x1]: P2, [y0, y1]: P2, [z0, z1]: P2) {
  const at = (x: number, y: number): P2 => add(o, add(mul(X, x), mul(Y, y)));
  prism(m, [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)], z0, z1);
}

/** Retângulo de um eixo a→b com largura w. */
function bar(a: P2, b: P2, w: number): P2[] {
  const n = mul(left(unit(sub(b, a))), w / 2);
  return [sub(a, n), sub(b, n), add(b, n), add(a, n)];
}

// ---- Montagem ----------------------------------------------------------------------------------

export interface ArchPiece {
  el: ArchElement;
  info: ElementInfo;
  /** Triângulos (IFC, m). */
  mesh: TriMesh;
  color: [number, number, number, number];
}

const COLORS: Record<ArchKind, [number, number, number, number]> = {
  parede: [0.86, 0.84, 0.8, 1],
  porta: [0.62, 0.45, 0.3, 1],
  janela: [0.55, 0.75, 0.92, 0.55],
  laje: [0.72, 0.72, 0.7, 1],
  pilar: [0.6, 0.6, 0.58, 1],
  viga: [0.66, 0.66, 0.63, 1],
};
const CONCRETE: [number, number, number, number] = [0.66, 0.66, 0.63, 1];

const IFC_TYPE: Record<ArchKind, string> = { parede: "IFCWALL", porta: "IFCDOOR", janela: "IFCWINDOW", laje: "IFCSLAB", pilar: "IFCCOLUMN", viga: "IFCBEAM" };
const FRAME = 0.05;

/** Vão de uma abertura ao longo da parede (início, fim) e alturas (base, topo), já limitado à parede. */
export function openingSpan(o: Opening, w: Wall): { s0: number; s1: number; z0: number; z1: number } {
  const L = wallLength(w);
  const half = Math.min(o.width, L) / 2;
  const c = Math.max(half, Math.min(L - half, o.offset));
  const z0 = w.base + Math.max(0, o.sill);
  return { s0: c - half, s1: c + half, z0, z1: Math.min(w.base + w.height, z0 + o.height) };
}

/** Malha da parede com os vãos das aberturas. */
function wallMesh(w: Wall, fp: WallFootprint, openings: Opening[]): TriMesh {
  const m = emptyMesh();
  const L = wallLength(w);
  if (L < 1e-3) return m;
  const d = unit(sub(w.b, w.a));
  const n = left(d);
  const s = (p: P2) => dot(sub(p, w.a), d);
  const lo = Math.max(s(fp.sl), s(fp.sr));
  const hi = Math.min(s(fp.el), s(fp.er));
  const spans = openings
    .map((o) => openingSpan(o, w))
    .map((v) => ({ ...v, s0: Math.max(v.s0, lo + 0.001), s1: Math.min(v.s1, hi - 0.001) }))
    .filter((v) => v.s1 - v.s0 > 0.01)
    .sort((a, b) => a.s0 - b.s0);
  // Vãos sobrepostos: fica o primeiro.
  const cuts: typeof spans = [];
  for (const v of spans) if (!cuts.length || v.s0 >= cuts[cuts.length - 1].s1) cuts.push(v);
  const z0 = w.base;
  const z1 = w.base + w.height;
  const L_ = (x: number): P2 => add(add(w.a, mul(d, x)), mul(n, w.thickness / 2));
  const R_ = (x: number): P2 => sub(add(w.a, mul(d, x)), mul(n, w.thickness / 2));
  /** Trecho cheio de x0 a x1 (as pontas da parede usam os cantos resolvidos). */
  const piece = (x0: number | "start", x1: number | "end", za: number, zb: number) => {
    const sl = x0 === "start" ? fp.sl : L_(x0);
    const sr = x0 === "start" ? fp.sr : R_(x0);
    const el = x1 === "end" ? fp.el : L_(x1);
    const er = x1 === "end" ? fp.er : R_(x1);
    prism(m, [sr, er, el, sl], za, zb);
  };
  let from: number | "start" = "start";
  for (const v of cuts) {
    piece(from, v.s0, z0, z1);
    if (v.z0 - z0 > 0.001) piece(v.s0, v.s1, z0, v.z0);
    if (z1 - v.z1 > 0.001) piece(v.s0, v.s1, v.z1, z1);
    from = v.s1;
  }
  piece(from, "end", z0, z1);
  return m;
}

/** Porta: batentes, travessa e a folha encostada no lado para onde abre (como no Revit). */
function doorMesh(o: Opening, w: Wall): { mesh: TriMesh; frame: { o: P2; X: P2; Y: P2; z: number } } {
  const m = emptyMesh();
  const v = openingSpan(o, w);
  const d = unit(sub(w.b, w.a));
  const side = o.flip ? -1 : 1;
  const Y = mul(left(d), side);
  const c = add(w.a, mul(d, (v.s0 + v.s1) / 2));
  const half = (v.s1 - v.s0) / 2;
  const t = w.thickness / 2;
  const h = v.z1 - v.z0;
  localBox(m, c, d, Y, [-half, -half + FRAME], [-t, t], [v.z0, v.z1]);
  localBox(m, c, d, Y, [half - FRAME, half], [-t, t], [v.z0, v.z1]);
  localBox(m, c, d, Y, [-half + FRAME, half - FRAME], [-t, t], [v.z1 - FRAME, v.z1]);
  localBox(m, c, d, Y, [-half + FRAME, half - FRAME], [t - 0.04, t], [v.z0, v.z0 + Math.max(0.1, h - FRAME)]);
  return { mesh: m, frame: { o: c, X: d, Y, z: v.z0 } };
}

/** Janela: caixilho em volta e vidro no meio da espessura. */
function windowMesh(o: Opening, w: Wall): TriMesh {
  const m = emptyMesh();
  const v = openingSpan(o, w);
  const d = unit(sub(w.b, w.a));
  const Y = left(d);
  const c = add(w.a, mul(d, (v.s0 + v.s1) / 2));
  const half = (v.s1 - v.s0) / 2;
  const t = Math.min(0.06, w.thickness / 2);
  localBox(m, c, d, Y, [-half, -half + FRAME], [-t, t], [v.z0, v.z1]);
  localBox(m, c, d, Y, [half - FRAME, half], [-t, t], [v.z0, v.z1]);
  localBox(m, c, d, Y, [-half + FRAME, half - FRAME], [-t, t], [v.z0, v.z0 + FRAME]);
  localBox(m, c, d, Y, [-half + FRAME, half - FRAME], [-t, t], [v.z1 - FRAME, v.z1]);
  localBox(m, c, d, Y, [-half + FRAME, half - FRAME], [-0.004, 0.004], [v.z0 + FRAME, v.z1 - FRAME]);
  return m;
}

/** Disciplina do elemento: estrutura (lajes, pilares, vigas, paredes estruturais) ou arquitetura. */
export const archDiscipline = (e: ArchElement): "estrutura" | "arquitetura" =>
  e.kind === "laje" || e.kind === "pilar" || e.kind === "viga" || (e.kind === "parede" && e.structural) ? "estrutura" : "arquitetura";

const cm = (m: number) => `${Math.round(m * 100)}`;

/** Elementos prontos para o app (malha, ElementInfo), com os vãos e encontros resolvidos. */
export function buildArch(els: ArchElement[], cs: CoordinateSystem): ArchPiece[] {
  const walls = els.filter((e): e is Wall => e.kind === "parede");
  const wallByGuid = new Map(walls.map((w) => [w.guid, w]));
  const openingsOf = new Map<string, Opening[]>();
  for (const e of els) if (e.kind === "porta" || e.kind === "janela") openingsOf.set(e.host, [...(openingsOf.get(e.host) ?? []), e]);
  const fps = wallFootprints(walls);
  const out: ArchPiece[] = [];
  for (const e of els) {
    let mesh: TriMesh;
    let length: number | null = null;
    let size: string | null = null;
    let frame: ElementInfo["frame"];
    let operation: string | null = null;
    let predefined: string | null = null;
    if (e.kind === "parede") {
      mesh = wallMesh(e, fps.get(e.id)!, openingsOf.get(e.guid) ?? []);
      length = wallLength(e);
      size = `e=${cm(e.thickness)} cm`;
      predefined = "STANDARD";
    } else if (e.kind === "porta" || e.kind === "janela") {
      const w = wallByGuid.get(e.host);
      if (!w) continue;
      size = `${cm(e.width)}x${cm(e.height)}`;
      if (e.kind === "porta") {
        const r = doorMesh(e, w);
        mesh = r.mesh;
        const o = cs.ifcToWorld([r.frame.o[0], r.frame.o[1], r.frame.z]);
        const px = cs.ifcToWorld([r.frame.o[0] + r.frame.X[0], r.frame.o[1] + r.frame.X[1], r.frame.z]);
        const py = cs.ifcToWorld([r.frame.o[0] + r.frame.Y[0], r.frame.o[1] + r.frame.Y[1], r.frame.z]);
        frame = { o, x: [px[0] - o[0], px[1] - o[1], px[2] - o[2]], y: [py[0] - o[0], py[1] - o[1], py[2] - o[2]] };
        operation = e.right ? "SINGLE_SWING_RIGHT" : "SINGLE_SWING_LEFT";
        predefined = "DOOR";
      } else {
        mesh = windowMesh(e, w);
        size += ` peitoril ${cm(e.sill)}`;
        predefined = "WINDOW";
      }
    } else if (e.kind === "laje") {
      mesh = emptyMesh();
      prism(mesh, e.outline, e.top - e.thickness, e.top);
      size = `h=${cm(e.thickness)} cm`;
      predefined = "FLOOR";
    } else if (e.kind === "pilar") {
      mesh = emptyMesh();
      const X: P2 = [Math.cos(e.rotation), Math.sin(e.rotation)];
      localBox(mesh, e.at, X, left(X), [-e.width / 2, e.width / 2], [-e.depth / 2, e.depth / 2], [e.base, e.base + e.height]);
      length = e.height;
      size = `${cm(e.width)}x${cm(e.depth)}`;
      predefined = "COLUMN";
    } else {
      const b = e as Beam;
      mesh = emptyMesh();
      if (wallLength(b) > 1e-3) prism(mesh, bar(b.a, b.b, b.width), b.top - b.height, b.top);
      length = wallLength(b);
      size = `${cm(b.width)}x${cm(b.height)}`;
      predefined = "BEAM";
    }
    const bbox = boundsOf(mesh, cs);
    const discipline = archDiscipline(e);
    out.push({
      el: e,
      mesh,
      color: e.kind === "parede" && e.structural ? CONCRETE : COLORS[e.kind],
      info: {
        expressID: archElementId(e.id),
        globalId: e.guid,
        ifcType: IFC_TYPE[e.kind],
        name: `${ARCH_LABEL[e.kind]} ${size ?? ""}`.trim(),
        objectType: e.name,
        predefinedType: predefined,
        storey: e.storey,
        systems: [],
        discipline,
        category: "construtivo",
        bbox,
        length,
        size,
        ...(frame ? { frame, operation } : {}),
      },
    });
  }
  return out;
}

function boundsOf(m: TriMesh, cs: CoordinateSystem): BBox | null {
  if (!m.positions.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    const p = cs.ifcToWorld([m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  return { min, max };
}

/** Malha na cena (Y para cima), com normais por face. */
export function worldMesh(p: ArchPiece, cs: CoordinateSystem) {
  const src = p.mesh.positions;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) positions.set(cs.ifcToWorld([src[i], src[i + 1], src[i + 2]]), i);
  const indices = Uint32Array.from(p.mesh.indices);
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const k of [a, b, c]) normals.set([nx / l, ny / l, nz / l], k);
  }
  return { expressID: p.info.expressID, positions, normals, indices, color: p.color };
}

// ---- Quantidades e propriedades ------------------------------------------------------------------

/** Área (m²) e volume (m³) do elemento, descontados os vãos das paredes. */
export function archQuantities(e: ArchElement, all: ArchElement[]): { area: number | null; volume: number | null } {
  if (e.kind === "parede") {
    const L = wallLength(e);
    const holes = all
      .filter((o): o is Opening => (o.kind === "porta" || o.kind === "janela") && o.host === e.guid)
      .reduce((s, o) => {
        const v = openingSpan(o, e);
        return s + (v.s1 - v.s0) * Math.max(0, v.z1 - v.z0);
      }, 0);
    const area = Math.max(0, L * e.height - holes);
    return { area, volume: area * e.thickness };
  }
  if (e.kind === "laje") {
    const a = Math.abs(signedArea(e.outline));
    return { area: a, volume: a * e.thickness };
  }
  if (e.kind === "pilar") return { area: e.width * e.depth, volume: e.width * e.depth * e.height };
  if (e.kind === "viga") return { area: null, volume: wallLength(e as Beam) * e.width * e.height };
  return { area: e.width * e.height, volume: null };
}

export function archProperties(e: ArchElement, all: ArchElement[]): PropertyGroup[] {
  const q = archQuantities(e, all);
  const r = (v: number, k = 3) => Math.round(v * 10 ** k) / 10 ** k;
  const dims: { name: string; value: number | string }[] = [];
  if (e.kind === "parede") dims.push({ name: "Comprimento (m)", value: r(wallLength(e)) }, { name: "Espessura (m)", value: e.thickness }, { name: "Altura (m)", value: e.height });
  else if (e.kind === "porta" || e.kind === "janela") dims.push({ name: "Largura (m)", value: e.width }, { name: "Altura (m)", value: e.height }, { name: "Peitoril (m)", value: e.sill });
  else if (e.kind === "laje") dims.push({ name: "Espessura (m)", value: e.thickness }, { name: "Perímetro (m)", value: r(e.outline.reduce((s, p, i) => s + len2(sub(e.outline[(i + 1) % e.outline.length], p)), 0)) });
  else if (e.kind === "pilar") dims.push({ name: "Seção (m)", value: `${e.width} x ${e.depth}` }, { name: "Altura (m)", value: e.height });
  else dims.push({ name: "Comprimento (m)", value: r(wallLength(e as Beam)) }, { name: "Seção (m)", value: `${e.width} x ${e.height}` });
  const qty: { name: string; value: number }[] = [];
  if (q.area != null) qty.push({ name: "Área (m²)", value: r(q.area, 2) });
  if (q.volume != null) qty.push({ name: "Volume (m³)", value: r(q.volume, 3) });
  return [
    { name: "Dimensões", kind: "propriedades", values: dims },
    ...(qty.length ? [{ name: "Quantidades", kind: "quantidades" as const, values: qty }] : []),
  ];
}

// ---- Criação ---------------------------------------------------------------------------------------

/** Cota (z do IFC) de um pavimento e do de cima (pelo menos 1,8 m acima; senão +3 m). */
export function storeyZ(levels: StoreyLevel[], storey: string, cs: CoordinateSystem): { z: number; next: number } {
  const zs = levels.map((l) => ({ name: l.name, z: cs.worldToIfc([0, l.level, 0])[2] })).sort((a, b) => a.z - b.z);
  const z = zs.find((l) => l.name === storey)?.z ?? 0;
  const next = zs.find((l) => l.z > z + 1.8)?.z ?? z + 3;
  return { z, next };
}

export function newArch<T extends ArchElement>(e: Omit<T, "id" | "guid">): T {
  return { ...e, id: newArchId(), guid: newGuid() } as T;
}

/** Parede mais próxima de um ponto em planta (até `tol` além da face), com a posição ao longo dela. */
export function wallAt(walls: Wall[], p: P2, tol = 0.3): { wall: Wall; offset: number; side: 1 | -1 } | null {
  let best: { wall: Wall; offset: number; side: 1 | -1; d: number } | null = null;
  for (const w of walls) {
    const L = wallLength(w);
    if (L < 1e-3) continue;
    const d = unit(sub(w.b, w.a));
    const s = dot(sub(p, w.a), d);
    if (s < 0 || s > L) continue;
    const off = dot(sub(p, w.a), left(d));
    const dist = Math.abs(off) - w.thickness / 2;
    if (dist > tol) continue;
    if (!best || dist < best.d) best = { wall: w, offset: s, side: off >= 0 ? 1 : -1, d: dist };
  }
  return best && { wall: best.wall, offset: best.offset, side: best.side };
}

/** Remove elementos e as aberturas das paredes removidas. */
export function removeArch(els: ArchElement[], ids: Set<number>): ArchElement[] {
  const gone = new Set(els.filter((e) => ids.has(e.id) && e.kind === "parede").map((e) => e.guid));
  return els.filter((e) => !ids.has(e.id) && !((e.kind === "porta" || e.kind === "janela") && gone.has(e.host)));
}

/**
 * Move um elemento em planta (as aberturas acompanham a parede). Porta ou janela movida sozinha
 * desliza ao longo da sua parede (a parte do deslocamento na direção da parede).
 */
export function moveArch(e: ArchElement, [dx, dy]: P2, all: ArchElement[] = []): ArchElement {
  const m = (p: P2): P2 => [p[0] + dx, p[1] + dy];
  if (e.kind === "parede") return { ...e, a: m(e.a), b: m(e.b) };
  if (e.kind === "viga") return { ...e, a: m(e.a), b: m(e.b) };
  if (e.kind === "laje") return { ...e, outline: e.outline.map(m) };
  if (e.kind === "pilar") return { ...e, at: m(e.at) };
  const w = all.find((x): x is Wall => x.kind === "parede" && x.guid === e.host);
  if (!w) return e;
  const d = unit(sub(w.b, w.a));
  return { ...e, offset: Math.max(e.width / 2, Math.min(wallLength(w) - e.width / 2, e.offset + dot([dx, dy], d))) };
}

/** Sobe/desce um elemento (dz em m). */
export function raiseArch(e: ArchElement, dz: number): ArchElement {
  if (!dz) return e;
  if (e.kind === "parede" || e.kind === "pilar") return { ...e, base: e.base + dz };
  if (e.kind === "laje" || e.kind === "viga") return { ...e, top: e.top + dz };
  return e;
}

/**
 * Cópias (ids e GlobalIds novos), deslocadas em planta e em altura; portas e janelas copiadas com
 * a parede vão para a parede nova, sem ela ficam na parede original.
 */
export function copyArch(src: ArchElement[], all: ArchElement[], d: P2, dz: number, storey: string | null): { added: ArchElement[]; ids: number[] } {
  const hostMap = new Map<string, string>();
  const added: ArchElement[] = [];
  const ctx = [...all];
  for (const e of src.filter((x) => x.kind === "parede")) {
    const c = { ...raiseArch(moveArch(e, d), dz), id: newArchId(), guid: newGuid(), ...(storey ? { storey } : {}) } as ArchElement;
    hostMap.set(e.guid, c.guid);
    added.push(c);
    ctx.push(c);
  }
  for (const e of src.filter((x) => x.kind !== "parede")) {
    const isOpening = e.kind === "porta" || e.kind === "janela";
    const host = isOpening ? hostMap.get(e.host) : undefined;
    const moved = isOpening ? (host ? { ...e, host } : moveArch(e, d, all)) : raiseArch(moveArch(e, d), dz);
    added.push({ ...moved, id: newArchId(), guid: newGuid(), ...(storey && !(isOpening && !host) ? { storey } : {}) } as ArchElement);
  }
  return { added, ids: added.map((e) => archElementId(e.id)) };
}

/** Pontos em planta do elemento (seleção por janela, ponto base de copiar/mover). */
export function archPlanPoints(e: ArchElement, all: ArchElement[]): P2[] {
  if (e.kind === "parede" || e.kind === "viga") return [e.a, e.b];
  if (e.kind === "laje") return e.outline;
  if (e.kind === "pilar") return [e.at];
  const w = all.find((x): x is Wall => x.kind === "parede" && x.guid === e.host);
  if (!w) return [];
  const d = unit(sub(w.b, w.a));
  return [add(w.a, mul(d, e.offset - e.width / 2)), add(w.a, mul(d, e.offset + e.width / 2))];
}

/** Leitura tolerante do arquivo de projeto. */
export function readArch(list: unknown): ArchElement[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is ArchElement => !!x && typeof x === "object" && typeof (x as ArchElement).kind === "string" && (x as ArchElement).kind in ARCH_LABEL)
    .map((x) => ({ ...x, id: newArchId(), guid: typeof x.guid === "string" ? x.guid : newGuid() }));
}

/** Para gravar: sem o id de sessão. */
export function writeArch(els: ArchElement[]): Omit<ArchElement, "id">[] {
  return els.map(({ id: _id, ...rest }) => rest);
}
