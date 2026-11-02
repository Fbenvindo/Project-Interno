// Monta a planta de um pavimento: corte do modelo IFC na altura de corte,
// símbolos dos pontos locados, trechos, etiquetas e legenda.
import { DISCIPLINES, MEP_DISCIPLINES } from "../disciplines";
import { COMPONENT_BY_ID } from "../library";
import type { CoordinateSystem } from "../math";
import type { TriangleMesh } from "../obb";
import type { PlacedPoint, StoreyLevel } from "../points";
import { runFittings, runSegments, RUN_TYPE_BY_ID, segmentElementId, storeyProbeY, type Run } from "../runs";
import type { Discipline, ElementInfo, Vec3 } from "../types";
import { LAYER_PREFIX, PEN, PRINT_COLOR, type LegendItem, type PlanDrawing, type Prim, type SymbolPrim } from "./drawing";
import { chainSegments, cutMesh, type P2 } from "./section";
import { centroid, pointInPolygon, type Space } from "../spaces";
import { assemblySymbol, LEGEND_LINE, RISER_DOWN, RISER_UP, symbolFor, TEE_MARK } from "./symbols";
import { assemblyKey } from "../devices";
import { draftPrims, type DraftEntity } from "../draft";
import { pointSize } from "../points";
import { BOX_LABEL, INSTALL_LABEL, type BoxKind, type PullBox } from "../conduits";

export interface PlanLabels {
  tags: boolean;
  circuits: boolean;
  power: boolean;
  sizes: boolean;
}

export interface PlanInput {
  elements: ElementInfo[];
  meshes: Map<number, TriangleMesh>;
  cs: CoordinateSystem;
  storeyLevels: StoreyLevel[];
  storey: string;
  /** Altura de corte acima do nível do pavimento (m). */
  cutHeight: number;
  points: PlacedPoint[];
  runs: Run[];
  /** Denominador da escala (50 = 1:50). */
  scale: number;
  /** Disciplinas exibidas (arquitetura/estrutura controlam o corte do IFC). */
  disciplines: Set<Discipline>;
  labels: PlanLabels;
  /** Ambientes (IfcSpace): nome e área no centro, quando a arquitetura está visível. */
  spaces?: Space[];
  /** Caixas de passagem dos eletrodutos. */
  boxes?: PullBox[];
  /** Desenho 2D (anotações) do pavimento. */
  drafts?: DraftEntity[];
  /** Vista cujas anotações entram (null = as da planta de trabalho). */
  draftView?: string | null;
}

/** Símbolos das caixas de passagem (mm de papel). */
const sq = (h: number): SymbolPrim => ({ t: "poly", pts: [[-h, -h], [h, -h], [h, h], [-h, h]], closed: true });
const oct = (r: number): SymbolPrim => ({
  t: "poly",
  pts: Array.from({ length: 8 }, (_, i): P2 => [r * Math.cos(((i + 0.5) * Math.PI) / 4), r * Math.sin(((i + 0.5) * Math.PI) / 4)]),
  closed: true,
});
export const BOX_SYMBOL: Record<BoxKind, SymbolPrim[]> = {
  "octogonal-pvc": [oct(1.8)],
  "pvc-embutir": [sq(1.8), { t: "line", a: [-1.8, -1.8], b: [1.8, 1.8] }],
  "ferro-fundido": [sq(1.8), sq(1.1)],
  alvenaria: [sq(2.2), sq(1.6), { t: "text", p: [0, 0], text: "A", height: 1.6 }],
  "pvc-sobrepor": [sq(1.8), { t: "text", p: [0, 0], text: "P", height: 1.6 }],
  condulete: [{ t: "circle", c: [0, 0], r: 1.5 }, { t: "text", p: [0, 0], text: "C", height: 1.6 }],
  metalica: [sq(1.8), { t: "line", a: [-1.8, -1.8], b: [1.8, 1.8] }, { t: "line", a: [-1.8, 1.8], b: [1.8, -1.8] }],
  parede: [{ t: "poly", pts: [[-1.8, 0], [1.8, 0], [1.8, 1.4], [-1.8, 1.4]], closed: true, fill: true }],
};

/** Tipos cortados com hachura cheia (poché). */
const POCHE_TYPES = new Set(["IFCWALL", "IFCWALLSTANDARDCASE", "IFCCOLUMN", "IFCCURTAINWALL", "IFCMEMBER", "IFCPILE"]);
const OPENING_TYPES = new Set(["IFCDOOR", "IFCWINDOW"]);
const POCHE_FILL = "#a6a6a6";

export function buildPlan(input: PlanInput): PlanDrawing {
  const { cs, scale, storey, labels } = input;
  const m = scale / 1000; // metros de modelo por mm de papel
  const levels = [...input.storeyLevels].sort((a, b) => a.level - b.level);
  const idx = levels.findIndex((s) => s.name === storey);
  const level = idx >= 0 ? levels[idx].level : 0;
  const nextLevel = idx >= 0 && idx < levels.length - 1 ? levels[idx + 1].level : Infinity;
  const cutY = level + input.cutHeight;
  const inStorey = (y: number) => y >= level - 0.05 && y < nextLevel - 0.05;

  const plan = (v: Vec3): P2 => {
    const p = cs.worldToIfc(v);
    return [p[0], p[1]];
  };
  const planDir = (d: Vec3): P2 => {
    const p = cs.worldDirToIfc(d);
    const l = Math.hypot(p[0], p[1]) || 1;
    return [p[0] / l, p[1] / l];
  };

  const prims: Prim[] = [];
  const legend = new Map<string, LegendItem>();

  // ---- Modelo IFC cortado ---------------------------------------------------------
  for (const e of input.elements) {
    if (!input.disciplines.has(e.discipline) || !e.bbox) continue;
    const mesh = input.meshes.get(e.expressID);
    if (!mesh) continue;
    const isMep = MEP_DISCIPLINES.includes(e.discipline);
    // Elementos MEP do IFC: corte na meia altura do próprio elemento (mostra o percurso).
    let y = cutY;
    if (isMep) {
      if (!inStorey(e.bbox.min[1])) continue;
      y = (e.bbox.min[1] + e.bbox.max[1]) / 2;
    } else if (e.bbox.min[1] > cutY || e.bbox.max[1] < cutY) continue;
    const segs = cutMesh(mesh.positions, mesh.indices, y).map(({ a, b }): [P2, P2] => [plan(a), plan(b)]);
    if (!segs.length) continue;
    const prefix = LAYER_PREFIX[e.discipline];
    const color = PRINT_COLOR[e.discipline];
    const poche = !isMep && POCHE_TYPES.has(e.ifcType);
    const weight = isMep ? PEN.mep : poche ? PEN.corte : OPENING_TYPES.has(e.ifcType) ? PEN.porta : PEN.vista;
    const layer = isMep ? `${prefix}-IFC` : poche ? `${prefix}-CORTE` : `${prefix}-ELEMENTOS`;
    for (const ch of chainSegments(segs)) {
      prims.push({
        t: "poly",
        pts: ch.points,
        closed: ch.closed,
        weight,
        fill: poche && ch.closed ? POCHE_FILL : null,
        layer,
        color: isMep ? color : "#222222",
        id: e.expressID,
      });
    }
  }

  // ---- Pontos locados ------------------------------------------------------------------
  const textH = 1.8 * m;
  const place = (local: P2, origin: P2, r: P2, f: P2): P2 => [origin[0] + (local[0] * r[0] + local[1] * f[0]) * m, origin[1] + (local[0] * r[1] + local[1] * f[1]) * m];

  const pushSymbol = (sp: SymbolPrim[], origin: P2, r: P2, f: P2, layer: string, color: string, id?: number) => {
    for (const s of sp) {
      if (s.t === "line") prims.push({ t: "line", a: place(s.a, origin, r, f), b: place(s.b, origin, r, f), weight: PEN.simbolo, layer, color, id });
      else if (s.t === "poly") prims.push({ t: "poly", pts: s.pts.map((q) => place(q, origin, r, f)), closed: s.closed, weight: PEN.simbolo, fill: s.fill ? color : null, layer, color, id });
      else if (s.t === "circle") prims.push({ t: "circle", c: place(s.c, origin, r, f), r: s.r * m, weight: PEN.simbolo, fill: s.fill ? color : null, layer, color, id });
      else prims.push({ t: "text", p: place(s.p, origin, r, f), text: s.text, height: s.height * m, anchor: "middle", layer, color, id });
    }
  };

  for (const p of input.points) {
    if (p.storey !== storey) continue;
    const def = COMPONENT_BY_ID[p.componentId];
    if (!input.disciplines.has(def.discipline)) continue;
    const sym = p.assembly ? assemblySymbol(p.assembly, p.height) : symbolFor(def);
    const size = pointSize(p, def);
    const color = PRINT_COLOR[def.discipline];
    const prefix = LAYER_PREFIX[def.discipline];
    const f = planDir([Math.sin(p.rotation), 0, Math.cos(p.rotation)]);
    const r = planDir([Math.cos(p.rotation), 0, -Math.sin(p.rotation)]);
    const center = plan(p.position);
    const wall = def.mounting === "parede";
    // Itens de parede: símbolo apoiado na face da parede, voltado para o ambiente.
    const origin: P2 = wall ? [center[0] - (f[0] * size[1]) / 2000, center[1] - (f[1] * size[1]) / 2000] : center;

    if (sym.footprint) {
      const [w, d] = [def.size[0] / 1000, def.size[1] / 1000];
      if (def.shape === "cilindro") {
        prims.push({ t: "circle", c: center, r: w / 2, weight: PEN.simbolo, layer: `${prefix}-PONTOS`, color, id: p.id });
      } else {
        const corner = (su: number, sv: number): P2 => [center[0] + (r[0] * su * w + f[0] * sv * d) / 2, center[1] + (r[1] * su * w + f[1] * sv * d) / 2];
        const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        prims.push({ t: "poly", pts, closed: true, weight: PEN.simbolo, layer: `${prefix}-PONTOS`, color, id: p.id });
        if (def.id === "quadro-distribuicao") {
          prims.push({ t: "poly", pts: [pts[0], pts[1], pts[2]], closed: true, weight: PEN.simbolo, fill: color, layer: `${prefix}-PONTOS`, color, id: p.id });
        }
      }
    }
    pushSymbol(sym.prims, sym.footprint ? center : origin, r, f, `${prefix}-PONTOS`, color, p.id);

    const parts: string[] = [];
    if (labels.tags) parts.push(p.tag);
    const pot = p.params["Potência"];
    if (labels.power && pot !== undefined && pot !== "") parts.push(`${pot}${def.params.find((x) => x.name === "Potência")?.unit ?? ""}`);
    const circ = p.params["Circuito"];
    if (labels.circuits && circ) parts.push(String(circ));
    if (parts.length) {
      const [w, d] = [def.size[0] / 1000, def.size[1] / 1000];
      let at: P2;
      if (wall) {
        // Além do símbolo e, se houver contorno real, além da profundidade da peça.
        const dist = Math.max(sym.labelOffset * m, sym.footprint ? d + 2 * m : 0);
        at = [origin[0] + f[0] * dist, origin[1] + f[1] * dist];
      } else {
        // No canto superior direito do contorno real (ou do símbolo), fora do eixo
        // por onde os eletrodutos costumam chegar ao centro do ponto.
        const extentX = sym.footprint ? (Math.abs(r[0]) * w + Math.abs(f[0]) * d) / 2 : 2.2 * m;
        const extentY = sym.footprint ? (Math.abs(r[1]) * w + Math.abs(f[1]) * d) / 2 : 2.2 * m;
        at = [center[0] + extentX + 1.2 * m, center[1] + extentY + 0.6 * m];
      }
      // Parede "vertical" na planta: texto alinhado a partir do símbolo; "horizontal": centrado acima/abaixo.
      const anchor = !wall ? "start" : Math.abs(f[0]) > Math.abs(f[1]) ? (f[0] > 0 ? "start" : "end") : "middle";
      if (wall && anchor !== "middle") at = [origin[0] + f[0] * (sym.footprint ? Math.max(d + 1.5 * m, 1.5 * m) : (sym.labelOffset - 1) * m), at[1]];
      prims.push({ t: "text", p: at, text: parts.join(" · "), height: textH, anchor, layer: `${prefix}-TEXTOS`, color, id: p.id });
    }

    const legendKey = p.assembly ? `${def.id}|${assemblyKey(p.assembly)}|${sym.description}` : def.id;
    if (!legend.has(legendKey)) {
      const lp: SymbolPrim[] = sym.footprint ? [{ t: "poly", pts: [[-3, -2], [3, -2], [3, 2], [-3, 2]], closed: true }, ...sym.prims] : sym.prims.map((s) => shiftSymbol(s, wall ? -1.5 : 0));
      legend.set(legendKey, { key: legendKey, label: sym.description, color, prims: lp });
    }
  }

  // ---- Trechos ---------------------------------------------------------------------------
  const fittings = runFittings(input.runs);
  // Pontos do pavimento: um trecho vertical que chega a um deles não leva marca de subida/descida.
  const devicePositions = input.points.filter((p) => p.storey === storey).map((p) => p.position);
  const atDevice = (v: Vec3) => devicePositions.some((q) => Math.hypot(q[0] - v[0], q[1] - v[1], q[2] - v[2]) < 0.05);
  for (const run of input.runs) {
    const t = RUN_TYPE_BY_ID[run.typeId];
    if (!input.disciplines.has(t.discipline)) continue;
    const color = PRINT_COLOR[t.discipline];
    const prefix = LAYER_PREFIX[t.discipline];
    const isConduit = t.segmentType === "IFCCABLECARRIERSEGMENT";
    const segs = runSegments(run);
    let labelSeg: { a: P2; b: P2; len: number } | null = null;

    segs.forEach((s, i) => {
      const lowY = Math.min(s.start[1], s.end[1]);
      if (!inStorey(storeyProbeY(run, lowY))) return;
      const a = plan(s.start);
      const b = plan(s.end);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const id = segmentElementId(run.id, i);
      if (len < 0.001) {
        // Trecho vertical: marca de subida/descida em relação ao trecho horizontal vizinho.
        const neighbor = [segs[i - 1], segs[i + 1]].find((n) => n && Math.hypot(n.end[0] - n.start[0], n.end[2] - n.start[2]) > 0.001);
        const shared = neighbor ? (neighbor === segs[i - 1] ? s.start : s.end) : s.start;
        const other = shared === s.start ? s.end : s.start;
        if (atDevice(other) || atDevice(shared)) return;
        const up = other[1] > shared[1];
        pushSymbol(up ? RISER_UP : RISER_DOWN, a, [1, 0], [0, 1], `${prefix}-TRECHOS`, color, id);
        const key = `riser-${up ? "up" : "down"}`;
        if (!legend.has(key)) legend.set(key, { key, label: up ? "Trecho que sobe" : "Trecho que desce", color: "#333333", prims: up ? RISER_UP : RISER_DOWN });
        return;
      }
      const meanY = (s.start[1] + s.end[1]) / 2;
      // Eletrodutos: estilo pela instalação (piso tracejado, laje contínuo, aparente traço-ponto).
      const mode = isConduit ? (run.install?.mode ?? null) : null;
      const onFloor = isConduit && (mode ? mode === "piso" : meanY < level + 0.5);
      const dashdot = mode === "aparente";
      const style = isConduit ? (mode ?? (onFloor ? "piso" : "teto")) : "rede";
      if (t.profile === "retangular") {
        const w = run.size.width / 1000;
        const n: P2 = [(-(b[1] - a[1]) / len) * (w / 2), ((b[0] - a[0]) / len) * (w / 2)];
        prims.push({ t: "poly", pts: [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]], closed: true, weight: PEN.mep, dashed: onFloor, dashdot, layer: `${prefix}-TRECHOS`, color, id });
      } else {
        prims.push({ t: "line", a, b, weight: PEN.mep, dashed: onFloor, dashdot, layer: `${prefix}-TRECHOS`, color, id });
      }
      if (!labelSeg || len > labelSeg.len) labelSeg = { a, b, len };
      const key = `${t.id}-${style}`;
      if (!legend.has(key)) {
        const where = mode ? ` — ${INSTALL_LABEL[mode]}` : style === "piso" ? " embutido no piso" : style === "teto" ? " no teto / parede" : "";
        const lp: SymbolPrim[] =
          t.profile === "retangular"
            ? [{ t: "poly", pts: [[-4, -0.8], [4, -0.8], [4, 0.8], [-4, 0.8]], closed: true }]
            : LEGEND_LINE;
        legend.set(key, { key, label: `${t.label}${where}`, color, prims: lp, dashed: onFloor, dashdot });
      }
    });

    if (labelSeg && (labels.tags || labels.sizes || labels.circuits)) {
      const { a, b } = labelSeg as { a: P2; b: P2; len: number };
      let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle <= -Math.PI / 2) angle += Math.PI;
      const off = (Math.max(run.size.width / 2000, 0) + 1.2 * m);
      const mid: P2 = [(a[0] + b[0]) / 2 - Math.sin(angle) * off, (a[1] + b[1]) / 2 + Math.cos(angle) * off];
      const parts: string[] = [];
      if (labels.tags) parts.push(run.tag);
      if (labels.sizes) parts.push(run.size.label);
      if (labels.circuits && run.params.Circuito) parts.push(String(run.params.Circuito));
      if (run.slope) parts.push(`i=${run.slope}%`);
      if (parts.length) prims.push({ t: "text", p: mid, text: parts.join(" "), height: 1.6 * m, anchor: "middle", angle, layer: `${prefix}-TEXTOS`, color, id: segmentElementId(run.id, 0) });
    }
  }
  for (const fit of fittings) {
    if (fit.kind !== "te" || !inStorey(fit.position[1])) continue;
    const t = RUN_TYPE_BY_ID[fit.typeId];
    if (!input.disciplines.has(t.discipline)) continue;
    if (t.segmentPredefined === "CONDUITSEGMENT") continue; // eletrodutos: a derivação é uma caixa
    pushSymbol(TEE_MARK, plan(fit.position), [1, 0], [0, 1], `${LAYER_PREFIX[t.discipline]}-TRECHOS`, PRINT_COLOR[t.discipline]);
    if (!legend.has("te")) legend.set("te", { key: "te", label: "Derivação (tê)", color: "#333333", prims: TEE_MARK });
  }

  // ---- Caixas de passagem -------------------------------------------------------------------
  if (input.disciplines.has("eletrica")) {
    for (const b of input.boxes ?? []) {
      if (!inStorey(storeyProbeY(b, b.position[1]))) continue;
      const color = PRINT_COLOR.eletrica;
      const horiz = Math.hypot(b.dir[0], b.dir[2]) > 0.3;
      const r = horiz ? planDir([b.dir[0], 0, b.dir[2]]) : ([1, 0] as P2);
      const f: P2 = [-r[1], r[0]];
      const at = plan(b.position);
      const id = -(900_000 + b.index);
      pushSymbol(BOX_SYMBOL[b.spec.kind], at, r, f, "ELE-CAIXAS", color, id);
      if (labels.tags) {
        prims.push({ t: "text", p: [at[0] + f[0] * 3.6 * m, at[1] + f[1] * 3.6 * m], text: b.tag, height: 1.5 * m, anchor: "middle", layer: "ELE-TEXTOS", color, id });
      }
      const key = `caixa-${b.spec.kind}`;
      if (!legend.has(key)) legend.set(key, { key, label: BOX_LABEL[b.spec.kind], color, prims: BOX_SYMBOL[b.spec.kind] });
    }
  }

  // ---- Desenho 2D (linhas, textos, cotas…) ------------------------------------------------------
  const dv = input.draftView ?? null;
  for (const d of input.drafts ?? []) if (d.storey === storey && (d.view ?? null) === dv) prims.push(...draftPrims(d, scale));

  // ---- Ambientes: número/nome e área (posição livre de instalações, se possível) -------------
  if (input.disciplines.has("arquitetura")) {
    const mepBoxes = prims
      .filter((p) => !/^(ARQ|EST|OUT)-/.test(p.layer))
      .map((p) => boundsOf([p]))
      .filter((b): b is NonNullable<typeof b> => b != null);
    const free = (minX: number, minY: number, maxX: number, maxY: number) =>
      !mepBoxes.some((b) => b.min[0] < maxX && b.max[0] > minX && b.min[1] < maxY && b.max[1] > minY);
    for (const sp of input.spaces ?? []) {
      if (sp.storey !== storey) continue;
      const h = 2.5 * m;
      const title = (sp.name || sp.number).toUpperCase();
      const area = `${sp.number ? sp.number + " · " : ""}${sp.area.toFixed(2).replace(".", ",")} m²`;
      const halfW = (Math.max(title.length * 0.62 * h, area.length * 0.55 * 2 * m) / 2) * 1.1;
      const ys = sp.polygon.map((q) => q[1]);
      const H = Math.max(...ys) - Math.min(...ys);
      let c = centroid(sp.polygon);
      if (!pointInPolygon(c, sp.polygon)) c = sp.polygon[0];
      const options = [0, -0.18, 0.18, -0.3, 0.3, -0.4, 0.4].map((k): P2 => [c[0], c[1] + k * H]);
      const best =
        options.find((o) => pointInPolygon(o, sp.polygon) && free(o[0] - halfW, o[1] - 1.6 * h, o[0] + halfW, o[1] + 1.6 * h)) ?? c;
      prims.push({ t: "text", p: [best[0], best[1] + h * 0.7], text: title, height: h, anchor: "middle", layer: "ARQ-AMBIENTES", color: "#333333" });
      prims.push({ t: "text", p: [best[0], best[1] - h * 0.7], text: area, height: 2 * m, anchor: "middle", layer: "ARQ-AMBIENTES", color: "#555555" });
    }
  }

  // Ordem de desenho: modelo, trechos, símbolos e, por cima, os textos.
  const rank = (layer: string) => (layer.endsWith("-TEXTOS") ? 3 : layer.endsWith("-PONTOS") || layer.endsWith("-CAIXAS") ? 2 : layer.endsWith("-TRECHOS") ? 1 : 0);
  prims.sort((a, b) => rank(a.layer) - rank(b.layer));

  return { prims, bounds: boundsOf(prims), legend: sortLegend([...legend.values()]), scale, storey, cutHeight: input.cutHeight };
}

function shiftSymbol(s: SymbolPrim, dy: number): SymbolPrim {
  const sh = (p: P2): P2 => [p[0], p[1] + dy];
  if (s.t === "line") return { ...s, a: sh(s.a), b: sh(s.b) };
  if (s.t === "poly") return { ...s, pts: s.pts.map(sh) };
  if (s.t === "circle") return { ...s, c: sh(s.c) };
  return { ...s, p: sh(s.p) };
}

const LEGEND_ORDER = DISCIPLINES.map((d) => PRINT_COLOR[d.id]);
function sortLegend(items: LegendItem[]): LegendItem[] {
  return items.sort((a, b) => LEGEND_ORDER.indexOf(a.color) - LEGEND_ORDER.indexOf(b.color) || a.label.localeCompare(b.label, "pt-BR"));
}

export function boundsOf(prims: Prim[]): PlanDrawing["bounds"] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = ([x, y]: P2, r = 0) => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  for (const p of prims) {
    if (p.t === "line") (add(p.a), add(p.b));
    else if (p.t === "poly") p.pts.forEach((q) => add(q));
    else if (p.t === "circle") add(p.c, p.r);
    else add(p.p, p.height);
  }
  return Number.isFinite(minX) ? { min: [minX, minY], max: [maxX, maxY] } : null;
}
