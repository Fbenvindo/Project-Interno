// Regras de eletrodutos: forma de instalação (piso, laje ou aparente no teto),
// eletrodutos flexíveis × rígidos, caixas de passagem (comprimento e curvas entre
// caixas) e tipo e dimensão das caixas.
// Coordenadas da cena: metros, Y para cima.
import { storeyAt, type PlacedPoint, type StoreyLevel } from "./points";
import { closestOnSegment, derivedGuid, distance, RUN_TYPE_BY_ID, runSegments, storeyProbeY, type Run, type RunSize, type RunType } from "./runs";
import type { ElementInfo, PropertyGroup, Vec3 } from "./types";

// ---- Instalação ---------------------------------------------------------------------------

export type InstallMode = "piso" | "laje" | "aparente";

export interface ConduitInstall {
  mode: InstallMode;
  /** Aparente: encostado sob a laje ou no entreforro (altura informada no traçado). */
  apparentRef?: "laje" | "entreforro";
  /** Piso: rede externa (caixas em alvenaria). */
  external?: boolean;
  /** Caixas de teto e piso: tubos lado a lado na horizontal (padrão) ou na vertical. */
  layout?: "horizontal" | "vertical";
  /** Caixas em alvenaria: tubos por linha (horizontal) e por coluna (vertical). */
  matrix?: { cols: number; rows: number };
  /** Piso interno com tubos acima de 1": caixa em alvenaria (padrão) ou caixa na parede. */
  floorLarge?: "alvenaria" | "parede";
}

export const INSTALL_LABEL: Record<InstallMode, string> = {
  piso: "embutido no piso",
  laje: "embutido na laje",
  aparente: "aparente no teto",
};

export const DEFAULT_INSTALL: ConduitInstall = { mode: "laje", layout: "horizontal" };

/** Eletrodutos (segmentos de eletroduto, não eletrocalhas). */
export const isConduitType = (t: RunType) => t.segmentType === "IFCCABLECARRIERSEGMENT" && t.segmentPredefined === "CONDUITSEGMENT";
export const isConduitRun = (r: Run) => isConduitType(RUN_TYPE_BY_ID[r.typeId]);

/** Flexíveis (PVC/PEAD corrugado) só embutidos no piso ou na laje; aparente exige rígido. */
export function typeAllowed(t: RunType, mode: InstallMode): boolean {
  if (!isConduitType(t)) return true;
  return mode === "aparente" ? !t.flexible : true;
}

/** Afastamento do eixo em relação ao piso ou à face da laje, quando embutido (m). */
export const EMBED_DEPTH = 0.05;

/**
 * Cota (Y) do eixo do eletroduto horizontal conforme a instalação.
 * slabUnderside: face inferior da laje acima; floorY: piso acabado.
 */
export function conduitElevation(install: ConduitInstall, floorY: number, slabUnderside: number, sizeMm: number, entreforroHeight: number): number {
  if (install.mode === "piso") return floorY - EMBED_DEPTH;
  if (install.mode === "laje") return slabUnderside + EMBED_DEPTH;
  if (install.apparentRef === "entreforro") return floorY + entreforroHeight;
  return slabUnderside - sizeMm / 2000;
}

// ---- Bitolas ---------------------------------------------------------------------------------

/** Diâmetro nominal em polegadas (para os limites de 1" e 2"). */
const PVC_INCH: Record<number, number> = { 16: 3 / 8, 20: 0.5, 25: 0.75, 32: 1, 40: 1.25, 50: 1.5, 60: 2, 75: 2.5, 85: 3, 110: 4 };
export function nominalInches(size: RunSize): number {
  const m = size.label.match(/^(\d+)(?:\.(\d+)\/(\d+)|\/(\d+))?"$/);
  if (m) {
    if (m[4]) return Number(m[1]) / Number(m[4]); // 3/4"
    return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0); // 1.1/4"
  }
  return PVC_INCH[Math.round(size.width)] ?? size.width / 25.4;
}

// ---- Caixas de passagem: onde ---------------------------------------------------------------

export const MAX_STRAIGHT = 15; // m sem caixa
export const PER_CURVE = 3; // m a menos por curva de 90°
export const MAX_CURVES = 2;

/** Comprimento máximo entre caixas com `curves` curvas (equivalentes a 90°). */
export const maxLengthFor = (curves: number) => MAX_STRAIGHT - PER_CURVE * curves;

/** Ângulo de deflexão (graus) no vértice i. */
function deflection(v: Vec3[], i: number): number {
  const a = v[i - 1];
  const b = v[i];
  const c = v[i + 1];
  const d1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const d2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const l1 = Math.hypot(...d1);
  const l2 = Math.hypot(...d2);
  if (l1 < 1e-6 || l2 < 1e-6) return 0;
  const cos = (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (l1 * l2);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** Curvas equivalentes a 90° de uma mudança de direção (45° = 0,5). */
export const curveEquivalent = (deg: number) => (deg < 5 ? 0 : Math.round((deg / 90) * 4) / 4);

export interface BoxSite {
  position: Vec3;
  runId: number;
  /** Direção do trecho no local (para orientar a caixa). */
  dir: Vec3;
  reason: "comprimento" | "curvas" | "derivacao" | "extremidade";
}

/**
 * Locais das caixas de passagem de um trecho: a cada vez que o comprimento desde a
 * última caixa passaria do máximo para as curvas acumuladas (15 m, 12 m com 1 curva,
 * 9 m com 2), ou haveria uma 3ª curva. A caixa no vértice absorve a curva.
 * `fixed` são caixas obrigatórias no trecho (derivações); as pontas ligadas a pontos
 * locados já são caixas (tomadas, quadros…).
 */
export function boxSitesForRun(run: Run, fixed: Vec3[] = [], freeEnds: { start: boolean; end: boolean } = { start: false, end: false }): BoxSite[] {
  const v = run.vertices;
  const out: BoxSite[] = [];
  if (v.length < 2) return out;
  const dirOf = (a: Vec3, b: Vec3): Vec3 => {
    const l = distance(a, b) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
  };
  const push = (position: Vec3, dir: Vec3, reason: BoxSite["reason"]) => {
    if (out.some((o) => distance(o.position, position) < 0.05)) return;
    out.push({ position, runId: run.id, dir, reason });
  };
  if (freeEnds.start) push(v[0], dirOf(v[0], v[1]), "extremidade");
  let acc = 0;
  let curves = 0;
  const eps = 1e-6;
  for (const s of runSegments(run)) {
    const dir = dirOf(s.start, s.end);
    // Caixas obrigatórias ao longo deste segmento, em ordem.
    const stops = fixed
      .map((p) => ({ p, ...closestOnSegment(p, s.start, s.end) }))
      .filter((x) => distance(x.p, x.point) < 0.01 && x.t > 1e-4 && x.t < 1 - 1e-4)
      .sort((a, b) => a.t - b.t)
      .map((x) => x.t * s.length);
    let at = 0; // posição ao longo do segmento
    const pointAt = (d: number): Vec3 => [s.start[0] + dir[0] * d, s.start[1] + dir[1] * d, s.start[2] + dir[2] * d];
    const advance = (to: number) => {
      while (acc + (to - at) > maxLengthFor(curves) + eps) {
        const d = maxLengthFor(curves) - acc;
        if (d <= eps) {
          // Já no limite (por curvas acumuladas): caixa aqui.
          push(pointAt(at), dir, curves > 0 ? "curvas" : "comprimento");
          acc = 0;
          curves = 0;
          continue;
        }
        at += d;
        push(pointAt(at), dir, curves > 0 ? "curvas" : "comprimento");
        acc = 0;
        curves = 0;
      }
      acc += to - at;
      at = to;
    };
    for (const stop of stops) {
      advance(stop);
      push(pointAt(stop), dir, "derivacao");
      acc = 0;
      curves = 0;
    }
    advance(s.length);
    // Curva no fim do segmento (vértice interno).
    const i = s.index + 1;
    if (i < v.length - 1) {
      const eq = curveEquivalent(deflection(v, i));
      if (eq > 0) {
        // Caixa na curva quando a 3ª curva viria, ou quando o próximo segmento já
        // estouraria o limite com esta curva (melhor a caixa no canto do que no meio).
        const next = distance(v[i], v[i + 1]);
        if (curves + eq > MAX_CURVES + eps || acc + next > maxLengthFor(curves + eq) + eps) {
          push(v[i], dir, "curvas");
          acc = 0;
          curves = 0;
        } else curves += eq;
      }
    }
  }
  if (freeEnds.end) push(v[v.length - 1], dirOf(v[v.length - 2], v[v.length - 1]), "extremidade");
  return out;
}

/** Resumo de um trecho entre caixas, para conferência. */
export function longestStretch(run: Run, sites: BoxSite[]): { length: number; curves: number } {
  // Percorre o trecho cortando nas caixas; devolve o pior trecho (maior comprimento).
  const v = run.vertices;
  let best = { length: 0, curves: 0 };
  let acc = 0;
  let curves = 0;
  for (const s of runSegments(run)) {
    const cuts = sites
      .map((b) => ({ b, ...closestOnSegment(b.position, s.start, s.end) }))
      .filter((x) => distance(x.b.position, x.point) < 0.01)
      .sort((a, b) => a.t - b.t);
    let at = 0;
    for (const c of cuts) {
      acc += c.t * s.length - at;
      at = c.t * s.length;
      if (acc > best.length) best = { length: acc, curves };
      acc = 0;
      curves = 0;
    }
    acc += s.length - at;
    const i = s.index + 1;
    if (i < v.length - 1) curves += curveEquivalent(deflection(v, i));
  }
  if (acc > best.length) best = { length: acc, curves };
  return best;
}

// ---- Caixas de passagem: tipo e dimensão -----------------------------------------------------

export type BoxKind = "octogonal-pvc" | "ferro-fundido" | "alvenaria" | "pvc-sobrepor" | "condulete" | "metalica" | "parede" | "pvc-embutir";

export const BOX_LABEL: Record<BoxKind, string> = {
  "octogonal-pvc": "Caixa octogonal PVC 4×4\" (laje)",
  "ferro-fundido": "Caixa de ferro fundido 4×4\" (piso)",
  alvenaria: "Caixa de passagem em alvenaria",
  "pvc-sobrepor": "Caixa de passagem PVC de sobrepor",
  condulete: "Condulete metálico",
  metalica: "Caixa de passagem metálica",
  parede: "Caixa de passagem na parede (camada única)",
  "pvc-embutir": "Caixa de passagem PVC de embutir (laje)",
};

export interface BoxSpec {
  kind: BoxKind;
  label: string;
  /** mm: largura × altura (face) × profundidade. */
  dims: [number, number, number];
  /** Quantidade (conduletes: um por eletroduto). */
  count: number;
  /** Medidas calculadas antes do arredondamento para a caixa comercial. */
  required: [number, number];
  warning?: string;
}

const ceilTo = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step;

/**
 * Comprimento de uma fileira de tubos lado a lado: metade do primeiro e do último
 * entre a face e a lateral da caixa, as bitolas e, entre tubos vizinhos, o afastamento
 * de metade da maior bitola, arredondado para múltiplos de 10 mm.
 */
export function rowLength(ds: number[]): number {
  if (!ds.length) return 0;
  let w = ds[0] / 2 + ds[ds.length - 1] / 2;
  for (let i = 0; i < ds.length; i++) {
    w += ds[i];
    if (i > 0) w += ceilTo(Math.max(ds[i - 1], ds[i]) / 2, 10);
  }
  return w;
}

/** Fileira única: medida ao longo da fileira e a transversal (bitola + metade de cada lado). */
function singleRow(ds: number[]): [number, number] {
  const max = Math.max(...ds);
  return [rowLength(ds), 2 * max];
}

const SQUARE_PVC = [100, 150, 200, 250, 300, 400, 500];
const SQUARE_METAL = [100, 150, 200, 250, 300, 400, 500, 600];

function pickSquare(sizes: number[], need: number): number | null {
  return sizes.find((s) => s >= need - 1e-6) ?? null;
}

/** Matriz em alvenaria: preenche linha a linha (maiores primeiro). */
function matrixDims(ds: number[], cols: number, rows: number): [number, number] {
  const sorted = [...ds].sort((a, b) => b - a);
  const c = Math.max(1, cols);
  const r = Math.max(1, rows, Math.ceil(sorted.length / c));
  const grid: number[][] = Array.from({ length: r }, () => []);
  sorted.forEach((d, i) => grid[Math.floor(i / c)].push(d));
  const widths = grid.filter((row) => row.length).map(rowLength);
  const columns: number[][] = Array.from({ length: c }, (_, j) => grid.map((row) => row[j]).filter((x): x is number => x != null));
  const heights = columns.filter((col) => col.length).map(rowLength);
  return [Math.max(...widths), Math.max(...heights)];
}

export interface BoxConduit {
  size: RunSize;
  type: RunType;
}

/** Tipo e dimensão da caixa para os eletrodutos que passam por ela. */
export function boxSpec(conduits: BoxConduit[], install: ConduitInstall): BoxSpec {
  const ds = conduits.map((c) => c.size.width);
  const inches = conduits.map((c) => nominalInches(c.size));
  const maxInch = Math.max(...inches);
  const vertical = install.layout === "vertical";
  const orient = ([along, across]: [number, number]): [number, number] => (vertical ? [across, along] : [along, across]);
  const [along, across] = singleRow(ds);
  const need = orient([along, across]);

  const masonry = (warning?: string): BoxSpec => {
    const cols = install.matrix?.cols ?? ds.length;
    const rows = install.matrix?.rows ?? 1;
    const req = matrixDims(ds, cols, rows);
    return {
      kind: "alvenaria",
      label: BOX_LABEL.alvenaria,
      dims: [Math.max(300, ceilTo(req[0], 50)), Math.max(300, ceilTo(req[1], 50)), 300],
      count: 1,
      required: req,
      warning,
    };
  };

  if (install.mode === "piso") {
    if (install.external) return masonry();
    if (maxInch <= 1 + 1e-6 && Math.max(...need) <= 100) {
      return { kind: "ferro-fundido", label: BOX_LABEL["ferro-fundido"], dims: [100, 100, 100], count: 1, required: need };
    }
    if (install.floorLarge === "parede") {
      return { kind: "parede", label: BOX_LABEL.parede, dims: [ceilTo(along, 50), ceilTo(across, 50), 100], count: 1, required: [along, across] };
    }
    return masonry('Eletroduto acima de 1" ou mais tubos do que cabem na caixa 4×4" de piso: caixa em alvenaria.');
  }

  if (install.mode === "laje") {
    if (Math.max(...need) <= 100) return { kind: "octogonal-pvc", label: BOX_LABEL["octogonal-pvc"], dims: [100, 100, 50], count: 1, required: need };
    const s = pickSquare(SQUARE_PVC, Math.max(...need));
    return {
      kind: "pvc-embutir",
      label: BOX_LABEL["pvc-embutir"],
      dims: s ? [s, s, 100] : [ceilTo(need[0], 50), ceilTo(need[1], 50), 100],
      count: 1,
      required: need,
      warning: "Os eletrodutos não cabem na caixa octogonal 4×4\": caixa de passagem maior.",
    };
  }

  // Aparente no teto
  const steel = conduits.some((c) => c.type.conduitMaterial === "aco");
  if (steel) {
    if (maxInch <= 1 + 1e-6) {
      return { kind: "condulete", label: `${BOX_LABEL.condulete} até 1"`, dims: [ceilTo(Math.max(...ds) * 2.2, 10), ceilTo(Math.max(...ds) * 2.2, 10), 60], count: conduits.length, required: need };
    }
    const s = pickSquare(SQUARE_METAL, Math.max(...need));
    return {
      kind: "metalica",
      label: BOX_LABEL.metalica,
      dims: s ? [s, s, 100] : [ceilTo(need[0], 50), ceilTo(need[1], 50), 150],
      count: 1,
      required: need,
      warning: maxInch > 2 + 1e-6 ? 'Eletroduto acima de 2": confira a caixa metálica com o fabricante.' : undefined,
    };
  }
  const s = pickSquare(SQUARE_PVC, Math.max(...need));
  return { kind: "pvc-sobrepor", label: BOX_LABEL["pvc-sobrepor"], dims: s ? [s, s, 80] : [ceilTo(need[0], 50), ceilTo(need[1], 50), 100], count: 1, required: need };
}

// ---- Caixas do projeto ------------------------------------------------------------------------

export interface PullBox {
  /** Índice estável na ordem do projeto (CP-1, CP-2…). */
  index: number;
  tag: string;
  position: Vec3;
  /** Direção do eletroduto principal (para orientar a caixa). */
  dir: Vec3;
  runIds: number[];
  install: ConduitInstall;
  spec: BoxSpec;
  reasons: BoxSite["reason"][];
}

const near = (a: Vec3, b: Vec3, tol: number) => Math.hypot(a[0] - b[0], a[2] - b[2]) <= tol && Math.abs(a[1] - b[1]) <= 0.3;

/**
 * Caixas de passagem de todos os eletrodutos: locais exigidos pelas regras, unidos
 * quando ficam próximos (até 30 cm), com tipo e dimensão para os tubos que passam.
 */
export function pullBoxes(runs: Run[], points: PlacedPoint[], tolerance = 0.3): PullBox[] {
  const conduits = runs.filter(isConduitRun);
  if (!conduits.length) return [];
  const pointAt = (p: Vec3) => points.some((q) => distance(q.position, p) < 0.25);
  // Derivações: ponta de um eletroduto no meio de outro.
  const taps = new Map<number, Vec3[]>();
  const runAt = (p: Vec3, self: number) =>
    conduits.find((o) => o.id !== self && runSegments(o).some((s) => distance(closestOnSegment(p, s.start, s.end).point, p) < 0.01));
  for (const r of conduits) {
    for (const end of [r.vertices[0], r.vertices[r.vertices.length - 1]]) {
      const host = runAt(end, r.id);
      if (host) taps.set(host.id, [...(taps.get(host.id) ?? []), end]);
    }
  }
  const sites: BoxSite[] = [];
  for (const r of conduits) {
    const [a, b] = [r.vertices[0], r.vertices[r.vertices.length - 1]];
    const free = (p: Vec3) => !pointAt(p) && !runAt(p, r.id);
    sites.push(...boxSitesForRun(r, taps.get(r.id) ?? [], { start: free(a), end: free(b) }));
    for (const t of taps.get(r.id) ?? []) sites.push({ position: t, runId: r.id, dir: [1, 0, 0], reason: "derivacao" });
  }
  // Agrupa os locais próximos e os eletrodutos que passam por cada grupo.
  const groups: { sites: BoxSite[]; position: Vec3 }[] = [];
  for (const s of sites) {
    const g = groups.find((x) => near(x.position, s.position, tolerance));
    if (g) g.sites.push(s);
    else groups.push({ sites: [s], position: s.position });
  }
  const byId = new Map(conduits.map((r) => [r.id, r]));
  return groups.map((g, i) => {
    // Também passam pela caixa os eletrodutos que cruzam o local (paralelos ao principal).
    const ids = new Set(g.sites.map((s) => s.runId));
    const d0 = g.sites.find((s) => s.reason !== "derivacao")?.dir ?? g.sites[0].dir;
    for (const r of conduits) {
      if (ids.has(r.id)) continue;
      const along = runSegments(r).some((s) => {
        const l = s.length || 1;
        const par = Math.abs(((s.end[0] - s.start[0]) * d0[0] + (s.end[1] - s.start[1]) * d0[1] + (s.end[2] - s.start[2]) * d0[2]) / l) > 0.95;
        return par && near(closestOnSegment(g.position, s.start, s.end).point, g.position, tolerance);
      });
      if (along) ids.add(r.id);
    }
    const list = [...ids].map((id) => byId.get(id)!);
    const main = byId.get(g.sites[0].runId)!;
    const install = main.install ?? DEFAULT_INSTALL;
    return {
      index: i,
      tag: `CP-${i + 1}`,
      position: g.position,
      dir: g.sites.find((s) => s.reason !== "derivacao")?.dir ?? g.sites[0].dir,
      runIds: [...ids],
      install,
      spec: boxSpec(list.map((r) => ({ size: r.size, type: RUN_TYPE_BY_ID[r.typeId] })), install),
      reasons: [...new Set(g.sites.map((s) => s.reason))],
    };
  });
}

export const BOX_REASON_LABEL: Record<BoxSite["reason"], string> = {
  comprimento: "15 m sem curva",
  curvas: "limite de curvas/comprimento",
  derivacao: "derivação",
  extremidade: "ponta livre",
};

// ---- Caixas como elementos (quantitativos, filtros, interferências, IFC) -------------------------

/** Ids de cena das caixas de passagem: faixa −900.000 (fora de pontos e trechos). */
export const BOX_BASE = 900_000;
export const boxElementId = (index: number) => -(BOX_BASE + index);
export const boxIndexOf = (id: number): number | null => (id <= -BOX_BASE && id > -(BOX_BASE + 50_000) ? -id - BOX_BASE : null);

export const boxSizeLabel = (b: PullBox) => `${b.spec.dims[0]}×${b.spec.dims[1]}×${b.spec.dims[2]} mm`;

export function boxElements(boxes: PullBox[], runs: Run[], levels: StoreyLevel[]): ElementInfo[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  return boxes.map((b) => {
    const [w, h, d] = b.spec.dims.map((v) => v / 2000);
    const r = byId.get(b.runIds[0])!;
    const half: Vec3 = [Math.max(w, h), Math.max(w, h), d];
    return {
      expressID: boxElementId(b.index),
      globalId: derivedGuid(r.guid, 100_000 + b.index),
      ifcType: "IFCJUNCTIONBOX",
      name: `${b.tag} - ${b.spec.label}`,
      objectType: b.spec.label,
      predefinedType: "PULL",
      storey: storeyAt(storeyProbeY(b, b.position[1]), levels),
      systems: r.system ? [r.system] : [],
      discipline: "eletrica",
      category: "acessorio",
      bbox: { min: b.position.map((v, i) => v - half[i]) as Vec3, max: b.position.map((v, i) => v + half[i]) as Vec3 },
      length: null,
      size: b.spec.count > 1 ? `${b.spec.count}× ${boxSizeLabel(b)}` : boxSizeLabel(b),
      origin: "locacao",
    };
  });
}

export function boxProperties(b: PullBox, runs: Run[]): PropertyGroup[] {
  const tags = runs.filter((r) => b.runIds.includes(r.id)).map((r) => `${r.tag} ${r.size.label}`);
  return [
    {
      name: "Caixa de passagem",
      kind: "propriedades",
      values: [
        { name: "Etiqueta", value: b.tag },
        { name: "Tipo", value: b.spec.label },
        { name: "Dimensões (L×A×P)", value: boxSizeLabel(b) },
        ...(b.spec.count > 1 ? [{ name: "Quantidade", value: b.spec.count }] : []),
        { name: "Medida mínima calculada", value: `${Math.round(b.spec.required[0])}×${Math.round(b.spec.required[1])} mm` },
        { name: "Instalação", value: INSTALL_LABEL[b.install.mode] },
        { name: "Arranjo dos tubos", value: b.spec.kind === "alvenaria" ? `matriz ${b.install.matrix?.cols ?? b.runIds.length} × ${b.install.matrix?.rows ?? 1}` : b.install.layout === "vertical" ? "vertical" : "horizontal" },
        { name: "Eletrodutos", value: tags.join(", ") },
        { name: "Motivo", value: b.reasons.map((r) => BOX_REASON_LABEL[r]).join(", ") },
        ...(b.spec.warning ? [{ name: "Atenção", value: b.spec.warning }] : []),
      ],
    },
  ];
}

// ---- Troca da instalação de um eletroduto já desenhado -------------------------------------------

/** Pavimento (piso) de um eletroduto: pelas cotas, conforme a instalação anterior. */
export function runFloorProbeY(run: Run): number {
  const minY = Math.min(...run.vertices.map((v) => v[1]));
  return (run.install?.mode ?? "laje") === "piso" ? minY + 0.06 : minY - 0.3;
}

/**
 * Leva o eletroduto para a cota da nova instalação: as pontas ligadas a pontos locados
 * ficam onde estão (a subida/descida acompanha); o resto passa para a nova cota.
 * Eletroduto flexível em instalação aparente vira rígido de PVC.
 */
export function applyInstall(
  run: Run,
  install: ConduitInstall,
  ctx: { floorY: number; slabUnderside: number; entreforroHeight: number; points: PlacedPoint[] },
): Partial<Run> {
  let t = RUN_TYPE_BY_ID[run.typeId];
  let size = run.size;
  let typeId = run.typeId;
  if (!typeAllowed(t, install.mode)) {
    t = RUN_TYPE_BY_ID["eletroduto-pvc"];
    typeId = t.id;
    size = t.sizes.find((s) => s.width >= run.size.width - 1e-6) ?? t.sizes[t.sizes.length - 1];
  }
  const y = conduitElevation(install, ctx.floorY, ctx.slabUnderside, size.width, ctx.entreforroHeight);
  const atPoint = (p: Vec3) => ctx.points.some((q) => distance(q.position, p) < 0.25);
  const v = run.vertices;
  const vertices: Vec3[] = [];
  v.forEach((p, i) => {
    const end = i === 0 || i === v.length - 1;
    if (end && atPoint(p)) {
      // Ponta no ponto locado: mantém e garante a vertical até a nova cota.
      if (i === 0) vertices.push(p, [p[0], y, p[2]]);
      else vertices.push([p[0], y, p[2]], p);
    } else vertices.push([p[0], y, p[2]]);
  });
  // Remove repetidos e colineares (inclusive as antigas subidas que ficaram com comprimento zero).
  const clean: Vec3[] = [];
  for (const p of vertices) {
    if (clean.length && distance(clean[clean.length - 1], p) < 0.0005) continue;
    clean.push(p);
    while (clean.length >= 3) {
      const [a, b, c] = clean.slice(-3);
      const d1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const d2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const l1 = Math.hypot(...d1);
      const l2 = Math.hypot(...d2);
      if ((d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (l1 * l2) > 1 - 1e-6) clean.splice(clean.length - 2, 1);
      else break;
    }
  }
  return { install, typeId, size, vertices: clean };
}
