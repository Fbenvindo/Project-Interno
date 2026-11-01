// Traçado de tubulações, eletrodutos e eletrocalhas: tipos, geometria
// ortogonal, conexões (curvas e tês) e conversão para ElementInfo.
// Coordenadas da cena: metros, Y para cima.
import { getCategory } from "./disciplines";
import type { OBB } from "./obb";
import { COMPONENT_BY_ID } from "./library";
import { pointOBB, storeyAt, type PlacedPoint, type StoreyLevel } from "./points";
import type { BBox, Discipline, ElementInfo, PropertyGroup, Vec3 } from "./types";
import type { ConduitInstall } from "./conduits";

export type Profile = "circular" | "retangular";

export interface RunSize {
  label: string;
  /** mm; no perfil circular, largura = altura = diâmetro externo. */
  width: number;
  height: number;
}

export interface RunType {
  id: string;
  group: string;
  label: string;
  discipline: Discipline;
  profile: Profile;
  sizes: RunSize[];
  defaultSize: string;
  system: string;
  systemType: string;
  material: string;
  tagPrefix: string;
  segmentType: string;
  segmentPredefined: string;
  fittingType: string;
  bendPredefined: string;
  teePredefined: string;
  /** Declividade padrão (%) para redes por gravidade; 0 = sem declividade. */
  slopeFor?: (size: RunSize) => number;
  /** Tem parâmetro de circuito (elétrica). */
  circuit?: boolean;
  /** Eletroduto flexível (corrugado): curvatura livre, só embutido no piso ou na laje. */
  flexible?: boolean;
  /** Material do eletroduto, para o tipo de caixa de passagem. */
  conduitMaterial?: "pvc" | "pead" | "aco";
}

const circ = (labels: [string, number][]): RunSize[] => labels.map(([label, d]) => ({ label, width: d, height: d }));
const mm = (ds: number[]): RunSize[] => circ(ds.map((d) => [`Ø${d}`, d]));
const rect = (ds: [number, number][]): RunSize[] => ds.map(([w, h]) => ({ label: `${w}x${h}`, width: w, height: h }));

const CONDUIT = { segmentType: "IFCCABLECARRIERSEGMENT", segmentPredefined: "CONDUITSEGMENT", fittingType: "IFCCABLECARRIERFITTING", bendPredefined: "BEND", teePredefined: "TEE" };
const TRAY = { ...CONDUIT, segmentPredefined: "CABLETRAYSEGMENT" };
const PIPE = { segmentType: "IFCPIPESEGMENT", segmentPredefined: "RIGIDSEGMENT", fittingType: "IFCPIPEFITTING", bendPredefined: "BEND", teePredefined: "JUNCTION" };
const STEEL_INCH: [string, number][] = [
  ['3/4"', 26.7],
  ['1"', 33.4],
  ['1.1/4"', 42.2],
  ['1.1/2"', 48.3],
  ['2"', 60.3],
  ['2.1/2"', 73],
  ['3"', 88.9],
  ['4"', 114.3],
];

export const RUN_TYPES: RunType[] = [
  // Elétrica
  { id: "eletroduto-pvc", group: "Elétrica", label: "Eletroduto rígido de PVC", discipline: "eletrica", profile: "circular", sizes: mm([20, 25, 32, 40, 50, 60, 75, 85, 110]), defaultSize: "Ø25", system: "Tomadas", systemType: "ELECTRICAL", material: "PVC rígido", tagPrefix: "ELD", circuit: true, conduitMaterial: "pvc", ...CONDUIT },
  { id: "eletroduto-flexivel", group: "Elétrica", label: "Eletroduto flexível corrugado PVC", discipline: "eletrica", profile: "circular", sizes: mm([20, 25, 32]), defaultSize: "Ø25", system: "Tomadas", systemType: "ELECTRICAL", material: "PVC corrugado", tagPrefix: "ELD", circuit: true, flexible: true, conduitMaterial: "pvc", ...CONDUIT },
  { id: "eletroduto-pead", group: "Elétrica", label: "Eletroduto flexível corrugado PEAD", discipline: "eletrica", profile: "circular", sizes: mm([32, 40, 50, 63, 75, 90, 110]), defaultSize: "Ø40", system: "Distribuição", systemType: "ELECTRICAL", material: "PEAD corrugado", tagPrefix: "ELD", circuit: true, flexible: true, conduitMaterial: "pead", ...CONDUIT },
  { id: "eletroduto-aco", group: "Elétrica", label: "Eletroduto rígido de aço carbono", discipline: "eletrica", profile: "circular", sizes: circ(STEEL_INCH), defaultSize: '1"', system: "Distribuição", systemType: "ELECTRICAL", material: "Aço carbono galvanizado", tagPrefix: "ELD", circuit: true, conduitMaterial: "aco", ...CONDUIT },
  { id: "eletrocalha", group: "Elétrica", label: "Eletrocalha perfurada", discipline: "eletrica", profile: "retangular", sizes: rect([[50, 50], [100, 50], [100, 100], [150, 50], [150, 100], [200, 50], [200, 100], [300, 100], [400, 100], [500, 100]]), defaultSize: "200x100", system: "Distribuição", systemType: "ELECTRICAL", material: "Aço galvanizado", tagPrefix: "ELC", ...TRAY },
  { id: "eletroduto-dados", group: "Telecom", label: "Eletroduto de dados (PVC)", discipline: "telecom", profile: "circular", sizes: mm([20, 25, 32, 40, 50]), defaultSize: "Ø25", system: "Telecom - Dados", systemType: "COMMUNICATION", material: "PVC rígido", tagPrefix: "ELT", ...CONDUIT },
  // Hidráulica
  { id: "agua-fria", group: "Hidráulica", label: "Água fria — PVC soldável", discipline: "hidraulica", profile: "circular", sizes: mm([20, 25, 32, 40, 50, 60, 75, 85, 110]), defaultSize: "Ø25", system: "Água Fria", systemType: "DOMESTICCOLDWATER", material: "PVC soldável", tagPrefix: "AF", ...PIPE },
  { id: "agua-quente", group: "Hidráulica", label: "Água quente — CPVC", discipline: "hidraulica", profile: "circular", sizes: mm([15, 22, 28, 35, 42, 54]), defaultSize: "Ø22", system: "Água Quente", systemType: "DOMESTICHOTWATER", material: "CPVC", tagPrefix: "AQ", ...PIPE },
  // NBR 8160: declividade mínima de 2% para DN ≤ 75 e 1% para DN ≥ 100.
  { id: "esgoto", group: "Hidráulica", label: "Esgoto — PVC", discipline: "hidraulica", profile: "circular", sizes: mm([40, 50, 75, 100, 150]), defaultSize: "Ø100", system: "Esgoto", systemType: "SEWAGE", material: "PVC esgoto", tagPrefix: "ES", slopeFor: (s) => (s.width <= 75 ? 2 : 1), ...PIPE },
  { id: "pluvial", group: "Hidráulica", label: "Águas pluviais — PVC", discipline: "hidraulica", profile: "circular", sizes: mm([75, 100, 150, 200]), defaultSize: "Ø100", system: "Águas Pluviais", systemType: "STORMWATER", material: "PVC", tagPrefix: "AP", slopeFor: () => 0.5, ...PIPE },
  // Climatização (duto de ar)
  { id: "duto-retangular", group: "Climatização", label: "Duto retangular — chapa galvanizada", discipline: "hvac", profile: "retangular", sizes: rect([[200, 150], [250, 200], [300, 200], [400, 200], [400, 300], [500, 300], [600, 300], [600, 400], [800, 400], [1000, 500]]), defaultSize: "400x300", system: "Climatização - Insuflamento", systemType: "AIRCONDITIONING", material: "Chapa galvanizada", tagPrefix: "DT", segmentType: "IFCDUCTSEGMENT", segmentPredefined: "RIGIDSEGMENT", fittingType: "IFCDUCTFITTING", bendPredefined: "BEND", teePredefined: "JUNCTION" },
  // Incêndio e gás
  { id: "incendio-aco", group: "Incêndio e gás", label: "Incêndio — aço carbono", discipline: "incendio", profile: "circular", sizes: circ(STEEL_INCH.slice(1)), defaultSize: '2.1/2"', system: "Incêndio - Hidrantes", systemType: "FIREPROTECTION", material: "Aço carbono", tagPrefix: "INC", ...PIPE },
  { id: "gas-cobre", group: "Incêndio e gás", label: "Gás — cobre", discipline: "gas", profile: "circular", sizes: mm([15, 22, 28, 35]), defaultSize: "Ø22", system: "Gás", systemType: "GAS", material: "Cobre", tagPrefix: "GAS", ...PIPE },
];

export const RUN_TYPE_BY_ID: Record<string, RunType> = Object.fromEntries(RUN_TYPES.map((t) => [t.id, t]));

export interface Run {
  /** Número de série positivo e único na sessão. */
  id: number;
  guid: string;
  typeId: string;
  tag: string;
  size: RunSize;
  system: string;
  /** Declividade aplicada (%), informativa. */
  slope: number;
  /** Eixo do trecho (cena). */
  vertices: Vec3[];
  params: Record<string, string | number>;
  /** Circuito (uid) cujos condutores passam por este trecho. */
  circuit?: string | null;
  /** Eletrodutos: embutido no piso, na laje ou aparente no teto, e arranjo das caixas. */
  install?: ConduitInstall;
}

/**
 * Cota usada para achar o pavimento de um ponto do trecho: eletrodutos na laje ou
 * aparentes no teto pertencem ao pavimento de baixo; embutidos no piso, ao próprio piso.
 */
export function storeyProbeY(run: Pick<Run, "install">, y: number): number {
  const mode = run.install?.mode;
  if (mode === "laje" || mode === "aparente") return y - 0.4;
  if (mode === "piso") return y + 0.1;
  return y;
}

let runSerial = 1;
export function newRunId(): number {
  return runSerial++;
}

// ---- Identificadores na cena ----------------------------------------------------
// Pontos locados usam ids negativos pequenos; trechos usam a faixa ≤ −1.000.000.
const RUN_BASE = 1_000_000;
const FITTING_OFFSET = 500;

export const segmentElementId = (runId: number, i: number) => -(RUN_BASE + runId * 1000 + i);
export const fittingElementId = (runId: number, j: number) => -(RUN_BASE + runId * 1000 + FITTING_OFFSET + j);

/** Trecho dono de um id de elemento da cena, ou null. */
export function runIdOfElement(id: number): number | null {
  if (id > -RUN_BASE) return null;
  return Math.floor((-id - RUN_BASE) / 1000);
}

// ---- Geometria ---------------------------------------------------------------------
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};
export const distance = (a: Vec3, b: Vec3) => len(sub(a, b));

const EPS = 0.0005; // 0,5 mm

/**
 * Base do perfil de um segmento: X = largura (horizontal), Z = altura.
 * Em segmentos horizontais, a altura fica na vertical.
 */
export function segmentBasis(dir: Vec3): { x: Vec3; z: Vec3 } {
  const d = norm(dir);
  let x = cross(d, [0, 1, 0]);
  if (len(x) < 1e-6) x = [1, 0, 0];
  x = norm(x);
  return { x, z: cross(x, d) };
}

/** Remove vértices repetidos e intermediários colineares. */
export function simplify(vertices: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const v of vertices) {
    if (out.length && distance(out[out.length - 1], v) < EPS) continue;
    out.push(v);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const d1 = norm(sub(b, a));
      const d2 = norm(sub(c, b));
      if (dot(d1, d2) > 1 - 1e-6) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}

/** Restringe o próximo vértice ao eixo horizontal dominante (X ou Z), mantendo a cota. */
export function orthoSnap(prev: Vec3, candidate: Vec3): Vec3 {
  const dx = candidate[0] - prev[0];
  const dz = candidate[2] - prev[2];
  return Math.abs(dx) >= Math.abs(dz) ? [candidate[0], prev[1], prev[2]] : [prev[0], prev[1], candidate[2]];
}

/** Restringe a direção em planta a múltiplos de `stepDeg` (ex.: 45° para eletrodutos rígidos), mantendo a cota. */
export function angleSnap(prev: Vec3, candidate: Vec3, stepDeg = 45): Vec3 {
  const dx = candidate[0] - prev[0];
  const dz = candidate[2] - prev[2];
  const l = Math.hypot(dx, dz);
  if (l < 1e-9) return [prev[0], prev[1], prev[2]];
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dz, dx) / step) * step;
  const ux = Math.cos(a);
  const uz = Math.sin(a);
  const along = dx * ux + dz * uz;
  return [prev[0] + ux * along, prev[1], prev[2] + uz * along];
}

/**
 * Caminho ortogonal: sobe/desce até a elevação, anda em X e depois em Z
 * (ou o inverso) e desce/sobe até o destino.
 */
export function manhattanPath(from: Vec3, to: Vec3, elevation: number, firstAxis: "x" | "z" = "x"): Vec3[] {
  const a: Vec3 = [from[0], elevation, from[2]];
  const corner: Vec3 = firstAxis === "x" ? [to[0], elevation, from[2]] : [from[0], elevation, to[2]];
  const b: Vec3 = [to[0], elevation, to[2]];
  return simplify([from, a, corner, b, to]);
}

/** Aplica declividade (%) aos trechos horizontais, no sentido do primeiro para o último vértice. */
export function applySlope(vertices: Vec3[], slopePct: number): Vec3[] {
  if (!slopePct || vertices.length < 2) return vertices;
  let run = 0;
  return vertices.map((v, i) => {
    if (i > 0) {
      const p = vertices[i - 1];
      run += Math.hypot(v[0] - p[0], v[2] - p[2]);
    }
    return [v[0], v[1] - (slopePct / 100) * run, v[2]];
  });
}

export interface Segment {
  index: number;
  start: Vec3;
  end: Vec3;
  length: number;
}

export function runSegments(run: Run): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < run.vertices.length - 1; i++) {
    const start = run.vertices[i];
    const end = run.vertices[i + 1];
    out.push({ index: i, start, end, length: distance(start, end) });
  }
  return out;
}

export function runLength(run: Run): number {
  return runSegments(run).reduce((s, g) => s + g.length, 0);
}

/** Caixa envolvente do prisma do segmento (perfil × comprimento). */
export function segmentBBox(start: Vec3, end: Vec3, size: RunSize): BBox {
  const { x, z } = segmentBasis(sub(end, start));
  const hx = scale(x, size.width / 2000);
  const hz = scale(z, size.height / 2000);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of [start, end]) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = add(add(p, scale(hx, sx)), scale(hz, sz));
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], c[k]);
          max[k] = Math.max(max[k], c[k]);
        }
      }
    }
  }
  return { min, max };
}

/** Caixa orientada do prisma do segmento (cilindros aproximados pela caixa circunscrita). */
export function segmentOBB(start: Vec3, end: Vec3, size: RunSize): OBB {
  const d = sub(end, start);
  const l = len(d);
  const { x, z } = segmentBasis(d);
  return {
    center: scale(add(start, end), 0.5),
    axes: [x, norm(d), z],
    half: [size.width / 2000, l / 2, size.height / 2000],
  };
}

/** Ponto mais próximo de `p` sobre um segmento [a, b]. */
export function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
  return { point: add(a, scale(ab, t)), t };
}

export interface RunHit {
  runId: number;
  segmentIndex: number;
  point: Vec3;
  distance: number;
}

/** Trecho mais próximo de `p` (dentro da tolerância, em metros). */
export function nearestRun(p: Vec3, runs: Run[], tolerance: number, excludeRunId?: number): RunHit | null {
  let best: RunHit | null = null;
  for (const r of runs) {
    if (r.id === excludeRunId) continue;
    for (const s of runSegments(r)) {
      const { point } = closestOnSegment(p, s.start, s.end);
      const d = distance(p, point);
      if (d <= tolerance && (!best || d < best.distance)) best = { runId: r.id, segmentIndex: s.index, point, distance: d };
    }
  }
  return best;
}

// ---- Conexões -------------------------------------------------------------------------
export interface Fitting {
  runId: number;
  /** Índice da conexão dentro do trecho. */
  index: number;
  kind: "curva" | "te";
  position: Vec3;
  /** Ângulo da curva em graus (curvas). */
  angle: number;
  size: RunSize;
  typeId: string;
  system: string;
  label: string;
}

/**
 * Curvas em cada vértice interno com mudança de direção e tês onde a
 * extremidade de um trecho chega ao meio de outro do mesmo tipo de rede.
 */
export function runFittings(runs: Run[]): Fitting[] {
  const out: Fitting[] = [];
  const byId = new Map(runs.map((r) => [r.id, r]));
  for (const r of runs) {
    let j = 0;
    for (let i = 1; i < r.vertices.length - 1; i++) {
      const d1 = norm(sub(r.vertices[i], r.vertices[i - 1]));
      const d2 = norm(sub(r.vertices[i + 1], r.vertices[i]));
      const angle = (Math.acos(Math.min(1, Math.max(-1, dot(d1, d2)))) * 180) / Math.PI;
      if (angle < 1) continue;
      // Eletroduto flexível: curvatura livre; só leva curva na passagem vertical ↔ horizontal.
      if (RUN_TYPE_BY_ID[r.typeId].flexible && Math.abs(d1[1]) < 0.7 && Math.abs(d2[1]) < 0.7) continue;
      const rounded = Math.round(angle);
      out.push({
        runId: r.id,
        index: j++,
        kind: "curva",
        position: r.vertices[i],
        angle: rounded,
        size: r.size,
        typeId: r.typeId,
        system: r.system,
        label: `Curva ${rounded}°`,
      });
    }
    const type = RUN_TYPE_BY_ID[r.typeId];
    for (const end of [r.vertices[0], r.vertices[r.vertices.length - 1]]) {
      if (!end) continue;
      const hit = nearestRun(end, runs, 0.005, r.id);
      if (!hit) continue;
      const host = byId.get(hit.runId)!;
      const hostType = RUN_TYPE_BY_ID[host.typeId];
      // Só une redes do mesmo grupo (ex.: eletroduto em eletroduto).
      if (hostType.segmentType !== type.segmentType) continue;
      const isHostEnd = distance(hit.point, host.vertices[0]) < 0.005 || distance(hit.point, host.vertices[host.vertices.length - 1]) < 0.005;
      if (isHostEnd) continue; // ponta com ponta: emenda, não tê
      out.push({
        runId: r.id,
        index: j++,
        kind: "te",
        position: hit.point,
        angle: 90,
        size: host.size,
        typeId: host.typeId,
        system: host.system,
        label: "Tê",
      });
    }
  }
  return out;
}

// ---- Etiquetas e elementos ----------------------------------------------------------
export function nextRunTag(runs: Run[], prefix: string): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const r of runs) {
    const m = r.tag.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

/** Elementos (segmentos e conexões) para filtros, quantitativos e interferências. */
export function runElements(runs: Run[], levels: StoreyLevel[]): ElementInfo[] {
  const out: ElementInfo[] = [];
  for (const r of runs) {
    const t = RUN_TYPE_BY_ID[r.typeId];
    for (const s of runSegments(r)) {
      if (s.length < EPS) continue;
      out.push({
        expressID: segmentElementId(r.id, s.index),
        globalId: derivedGuid(r.guid, s.index),
        ifcType: t.segmentType,
        name: `${r.tag} - ${t.label} ${r.size.label}`,
        objectType: t.label,
        predefinedType: t.segmentPredefined,
        storey: storeyAt(storeyProbeY(r, Math.min(s.start[1], s.end[1])), levels),
        systems: r.system ? [r.system] : [],
        discipline: t.discipline,
        category: "segmento",
        bbox: segmentBBox(s.start, s.end, r.size),
        length: s.length,
        size: r.size.label,
        origin: "locacao",
        obb: segmentOBB(s.start, s.end, r.size),
      });
    }
  }
  for (const f of runFittings(runs)) {
    const t = RUN_TYPE_BY_ID[f.typeId];
    // Eletrodutos não têm tê: a derivação é feita numa caixa de passagem (ver conduits.ts).
    if (f.kind === "te" && t.segmentPredefined === "CONDUITSEGMENT") continue;
    const r = runs.find((x) => x.id === f.runId)!;
    const half = (Math.max(f.size.width, f.size.height) * 0.6) / 1000;
    out.push({
      expressID: fittingElementId(f.runId, f.index),
      globalId: derivedGuid(r.guid, FITTING_OFFSET + f.index),
      ifcType: t.fittingType,
      name: `${r.tag} - ${f.label} ${f.size.label}`,
      objectType: f.label,
      predefinedType: f.kind === "curva" ? t.bendPredefined : t.teePredefined,
      storey: storeyAt(storeyProbeY(r, f.position[1]), levels),
      systems: f.system ? [f.system] : [],
      discipline: t.discipline,
      category: getCategory(t.fittingType),
      bbox: { min: f.position.map((v) => v - half) as Vec3, max: f.position.map((v) => v + half) as Vec3 },
      length: null,
      size: f.size.label,
      origin: "locacao",
      obb: { center: f.position, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [half, half, half] },
    });
  }
  return out;
}

const INSTALL_TEXT = { piso: "Embutido no piso", laje: "Embutido na laje", aparente: "Aparente no teto" } as const;

export function runProperties(r: Run): PropertyGroup[] {
  const t = RUN_TYPE_BY_ID[r.typeId];
  const fittings = runFittings([r]);
  return [
    {
      name: "Traçado",
      kind: "propriedades",
      values: [
        { name: "Etiqueta", value: r.tag },
        { name: "Tipo", value: t.label },
        { name: "Bitola", value: r.size.label },
        { name: "Material", value: t.material },
        { name: "Sistema", value: r.system },
        ...(r.install ? [{ name: "Instalação", value: INSTALL_TEXT[r.install.mode] + (r.install.mode === "aparente" ? (r.install.apparentRef === "entreforro" ? " (entreforro)" : " (sob a laje)") : r.install.mode === "piso" && r.install.external ? " (área externa)" : "") }] : []),
        ...(t.flexible ? [{ name: "Eletroduto", value: "flexível (curvatura livre)" }] : t.conduitMaterial ? [{ name: "Eletroduto", value: "rígido (curvas de 45° e 90°)" }] : []),
        { name: "Comprimento total (m)", value: Math.round(runLength(r) * 100) / 100 },
        { name: "Segmentos", value: runSegments(r).length },
        { name: "Curvas", value: fittings.filter((f) => f.kind === "curva").length },
        ...(r.slope ? [{ name: "Declividade (%)", value: r.slope }] : []),
        ...Object.entries(r.params).map(([name, value]) => ({ name, value })),
      ],
    },
  ];
}

const GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** GlobalId estável derivado do GlobalId do trecho e de um índice (até 262.143). */
export function derivedGuid(base: string, n: number): string {
  const suffix = [Math.floor(n / 4096) % 64, Math.floor(n / 64) % 64, n % 64].map((i) => GUID_CHARS[i]).join("");
  // Troca o 4º caractere para não colidir com o GlobalId do próprio trecho.
  return base.slice(0, 3) + GUID_CHARS[(GUID_CHARS.indexOf(base[3]) + 1) % 64] + base.slice(4, 19) + suffix;
}

export type AutoRouteMode = "individual" | "cadeia";

/**
 * Caminhos ortogonais ligando cada origem ao destino na elevação dada.
 * - individual: cada origem vai direto ao destino (home-run);
 * - cadeia: liga o destino à origem mais próxima, esta à próxima mais próxima, e assim por diante.
 * Os caminhos vão no sentido origem → destino.
 */
export function autoRoute(sources: Vec3[], target: Vec3, elevation: number, mode: AutoRouteMode): Vec3[][] {
  if (mode === "individual") return sources.map((s) => manhattanPath(s, target, elevation));
  const remaining = [...sources];
  const paths: Vec3[][] = [];
  let current = target;
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (distance(remaining[i], current) < distance(remaining[best], current)) best = i;
    }
    const next = remaining.splice(best, 1)[0];
    paths.push(manhattanPath(next, current, elevation));
    current = next;
  }
  return paths;
}

/** Ids de elementos da cena (segmentos e conexões) de um trecho. */
export function runElementIds(run: Run, fittings: Fitting[]): number[] {
  return [
    ...runSegments(run).map((s) => segmentElementId(run.id, s.index)),
    ...fittings.filter((f) => f.runId === run.id).map((f) => fittingElementId(run.id, f.index)),
  ];
}

/**
 * Pares conectados que não devem ser tratados como interferência: o trecho
 * e o ponto onde ele começa ou termina, e trechos ligados entre si (tês e emendas).
 */
export function connectedPairs(runs: Run[], points: PlacedPoint[]): (a: number, b: number) => boolean {
  const fittings = runFittings(runs);
  const groups = new Map<number, number[]>(runs.map((r) => [r.id, runElementIds(r, fittings)]));
  const pairs = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const link = (as: number[], bs: number[]) => {
    for (const a of as) for (const b of bs) pairs.add(key(a, b));
  };
  const inside = (p: Vec3, pt: PlacedPoint) => {
    const o = pointOBB(pt, COMPONENT_BY_ID[pt.componentId]);
    return o.axes.every((ax, i) => Math.abs(dot(sub(p, o.center), ax)) <= o.half[i] + 0.002);
  };
  for (const r of runs) {
    const ends = [r.vertices[0], r.vertices[r.vertices.length - 1]].filter(Boolean);
    for (const pt of points) if (ends.some((e) => inside(e, pt))) link(groups.get(r.id)!, [pt.id]);
    for (const other of runs) {
      if (other.id === r.id) continue;
      if (ends.some((e) => nearestRun(e, [other], 0.005))) link(groups.get(r.id)!, groups.get(other.id)!);
    }
  }
  return (a, b) => pairs.has(key(a, b));
}
