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
import { visibleTopEdges } from "./projection";
import { centroid, pointInPolygon, type Space } from "../spaces";
import { assemblySymbol, LEGEND_LINE, RISER_DOWN, RISER_UP, symbolFor, TEE_MARK } from "./symbols";
import { assemblyKey } from "../devices";
import { draftPrims, type DraftEntity } from "../draft";
import { pointSize } from "../points";
import { BEAM_COLOR, BEAM_OPACITY, COLUMN_FILL, COLUMN_TYPES, isLayout, LAYOUT_GRAY, minAreaRect, WALL_FILL } from "./style";
import type { PlanRange } from "./levels";
import { BOX_LABEL, INSTALL_LABEL, INSTALL_ZONE, isApparent, type BoxKind, type PullBox } from "../conduits";

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
  /**
   * Vigas em projeção (tracejadas): na planta de piso, as da laje de baixo; na planta de teto,
   * as do pavimento de cima. `text` = largura × altura (cm) em cada viga.
   */
  beams?: BeamOptions;
  /**
   * Faixa de visualização (plantas de pavimento). Piso: corte em base + acima; abaixo da base só
   * instalações. Teto: corte em base − abaixo; acima da base só instalações. Sem faixa, vale o
   * corte em `cutHeight` com o pavimento inteiro.
   */
  range?: PlanRange;
  /** Ajustes de portas feitos no projeto (por GlobalId). */
  doors?: Record<string, DoorOverride>;
  /** Escrever nome e área dos ambientes (padrão: sim; a camada do modelo não escreve). */
  roomLabels?: boolean;
}

/** Ajuste de uma porta: inverter o lado da abertura, inverter a dobradiça ou não desenhar o arco. */
export interface DoorOverride {
  flipSide?: boolean;
  flipHand?: boolean;
  none?: boolean;
  /** Desenhar o arco mesmo onde o app não desenharia (nome de veneziana, peitoril). */
  force?: boolean;
}

export interface BeamOptions {
  mode: "piso" | "teto";
  show: boolean;
  text: boolean;
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

export function buildPlan(input: PlanInput): PlanDrawing {
  const { cs, scale, storey, labels } = input;
  const m = scale / 1000; // metros de modelo por mm de papel
  const levels = [...input.storeyLevels].sort((a, b) => a.level - b.level);
  const idx = levels.findIndex((s) => s.name === storey);
  const level = idx >= 0 ? levels[idx].level : 0;
  const nextLevel = idx >= 0 && idx < levels.length - 1 ? levels[idx + 1].level : Infinity;
  const R = input.range;
  const cutY = R ? (R.type === "piso" ? R.base + R.above : R.base - R.below) : level + input.cutHeight;
  // Faixas: instalações (abaixo e acima) e demais elementos (só acima no piso, só abaixo no teto).
  const mepLo = R ? R.base - R.below : -Infinity;
  const mepHi = R ? R.base + R.above : Infinity;
  const archLo = R ? (R.type === "piso" ? R.base : R.base - R.below) : -Infinity;
  const archHi = R ? (R.type === "piso" ? R.base + R.above : R.base) : Infinity;
  const inStorey = R ? (y: number) => y >= mepLo - 0.02 && y <= mepHi + 0.02 : (y: number) => y >= level - 0.05 && y < nextLevel - 0.05;
  /** Faixa vertical [lo, hi] dentro da faixa de instalações. */
  const inMepRange = (lo: number, hi: number) => (R ? hi >= mepLo - 0.02 && lo <= mepHi + 0.02 : inStorey(lo));

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
  const bo = input.beams;

  // ---- Modelo IFC cortado ---------------------------------------------------------
  /** Elementos em projeção (vistos de cima, com linhas ocultas removidas no fim). */
  const projQueue: { e: ElementInfo; mesh: TriangleMesh }[] = [];
  /** Portas e janelas (venezianas) do pavimento: sempre visíveis, com o vão aberto na parede. */
  const openings: { e: ElementInfo; mesh: TriangleMesh }[] = [];
  const nextFloor = levels.find((l) => l.level > level + 1.8)?.level ?? level + 3.5;
  const pushElement = (e: ElementInfo, raw: { a: Vec3; b: Vec3 }[], projected: boolean) => {
    const segs = raw.map(({ a, b }): [P2, P2] => [plan(a), plan(b)]);
    if (!segs.length) return;
    const isMep = MEP_DISCIPLINES.includes(e.discipline);
    const prefix = LAYER_PREFIX[e.discipline];
    // Layout e equipamentos da arquitetura (inclusive louças e metais): cinza, sempre.
    const layout = isLayout(e.ifcType);
    const color = layout ? LAYOUT_GRAY : PRINT_COLOR[e.discipline];
    const poche = !isMep && !projected && POCHE_TYPES.has(e.ifcType);
    const weight = layout ? PEN.vista : isMep ? PEN.mep : poche ? PEN.corte : OPENING_TYPES.has(e.ifcType) ? PEN.porta : PEN.vista;
    const layer = layout ? "ARQ-LAYOUT" : isMep ? `${prefix}-IFC` : poche ? `${prefix}-CORTE` : `${prefix}-ELEMENTOS`;
    const pocheFill = COLUMN_TYPES.has(e.ifcType) ? COLUMN_FILL : WALL_FILL;
    for (const ch of chainSegments(segs)) {
      prims.push({
        t: "poly",
        pts: ch.points,
        closed: ch.closed,
        weight,
        fill: poche && ch.closed ? pocheFill : null,
        layer,
        color: isMep || layout ? color : projected ? "#666666" : "#222222",
        id: e.expressID,
      });
    }
  };
  for (const e of input.elements) {
    if (!input.disciplines.has(e.discipline) || !e.bbox) continue;
    const mesh = input.meshes.get(e.expressID);
    if (!mesh) continue;
    const isMep = MEP_DISCIPLINES.includes(e.discipline);
    // Portas e janelas do pavimento (piso ou teto): tratadas à parte, sempre visíveis.
    if (!isMep && OPENING_TYPES.has(e.ifcType)) {
      if (e.bbox.min[1] >= level - 0.2 && e.bbox.min[1] < nextFloor - 0.3) openings.push({ e, mesh });
      continue;
    }
    // Elementos MEP do IFC: corte na meia altura do próprio elemento (mostra o percurso).
    let y = cutY;
    let projected = false;
    const lo = e.bbox.min[1];
    const hi = e.bbox.max[1];
    if (isMep) {
      if (R) {
        if (!inMepRange(lo, hi)) continue;
        y = (Math.max(lo, mepLo) + Math.min(hi, mepHi)) / 2;
      } else {
        if (!inStorey(lo)) continue;
        y = (lo + hi) / 2;
      }
    } else if (lo > cutY || hi < cutY) {
      // Com faixa: o que está inteiro dentro dela (sem cruzar o corte) aparece em projeção.
      if (!R || e.ifcType === "IFCBEAM") continue; // vigas: projeção própria (tracejada), abaixo
      const a = Math.max(lo, archLo);
      const b = Math.min(hi, archHi);
      if (b - a < 0.01) continue;
      y = (a + b) / 2;
      projected = true;
    }
    if (projected) {
      projQueue.push({ e, mesh });
      continue;
    }
    pushElement(e, cutMesh(mesh.positions, mesh.indices, y), false);
  }

  // Projeção vista de cima: só o que fica visível (o tampo esconde os pés da mesa, a mesa esconde a cadeira embaixo).
  if (projQueue.length) {
    const vis = visibleTopEdges(
      projQueue.map(({ e, mesh }) => ({ id: e.expressID, positions: mesh.positions, indices: mesh.indices })),
      archHi,
    );
    for (const { e } of projQueue) pushElement(e, vis.get(e.expressID) ?? [], true);
  }

  // Portas e janelas: o vão aparece aberto na parede (sem a parede de cima) e a peça é desenhada
  // mesmo se o plano de corte passar acima ou abaixo dela; arco de abertura nas plantas de piso.
  for (const { e, mesh } of openings) {
    const pts: P2[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) pts.push(plan([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]));
    const rect = minAreaRect(pts);
    if (rect) prims.push({ t: "poly", pts: rect.corners, closed: true, weight: 0.01, fill: "#ffffff", layer: "ARQ-VAOS", color: "#ffffff", id: e.expressID });
    const lo = e.bbox!.min[1];
    const hi = e.bbox!.max[1];
    const yCut = cutY > lo + 0.05 && cutY < hi - 0.05 ? cutY : (lo + hi) / 2;
    pushElement(e, cutMesh(mesh.positions, mesh.indices, yCut), false);
    // Família do Revit com símbolo de planta: desenhado como no Revit (folha, arco, caixilho).
    if (e.planSymbol?.length) {
      if (R?.type !== "teto" || e.ifcType !== "IFCDOOR")
        for (const line of e.planSymbol) {
          const pts: P2[] = [];
          for (let i = 0; i + 1 < line.length; i += 2) pts.push([line[i], line[i + 1]]);
          if (pts.length >= 2) prims.push({ t: "poly", pts, closed: false, weight: PEN.vista, layer: "ARQ-PORTAS", color: "#333333", id: e.expressID });
        }
      continue;
    }
    if (e.ifcType === "IFCDOOR" && e.frame && R?.type !== "teto") prims.push(...doorSwing(e, mesh.positions, mesh.indices, plan, input.spaces ?? [], input.doors?.[e.globalId], R ? R.base : level));
  }

  // ---- Vigas (projeção tracejada, verde com 50% de transparência) ---------------------------
  if (bo?.show && input.disciplines.has("estrutura")) {
    // Piso: vigas da laje deste pavimento (topo junto ao nível). Teto: as do pavimento de cima.
    const ref = bo.mode === "teto" ? (Number.isFinite(nextLevel) ? nextLevel : level + 3) : level;
    for (const e of input.elements) {
      if (e.ifcType !== "IFCBEAM" || !e.bbox) continue;
      const top = e.bbox.max[1];
      if (top < ref - 0.6 || top > ref + 0.1) continue;
      const mesh = input.meshes.get(e.expressID);
      if (!mesh) continue;
      const pts: P2[] = [];
      for (let i = 0; i < mesh.positions.length; i += 3) pts.push(plan([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]));
      const r = minAreaRect(pts);
      if (!r || r.length < 0.05) continue;
      const base = { layer: "EST-VIGAS", color: BEAM_COLOR, opacity: BEAM_OPACITY, id: e.expressID };
      prims.push({ t: "poly", pts: r.corners, closed: true, weight: PEN.vista + 0.05, dashed: true, ...base });
      if (bo.text) {
        const cm = (v: number) => Math.round(v * 100);
        let angle = Math.atan2(r.axis[1], r.axis[0]);
        if (angle > Math.PI / 2 + 1e-6) angle -= Math.PI;
        if (angle <= -Math.PI / 2 + 1e-6) angle += Math.PI;
        const off = r.width / 2 + 1.6 * m;
        const at: P2 = [r.center[0] - Math.sin(angle) * off, r.center[1] + Math.cos(angle) * off];
        prims.push({ t: "text", p: at, text: `${cm(r.width)}x${cm(e.bbox.max[1] - e.bbox.min[1])}`, height: 1.8 * m, anchor: "middle", angle, ...base, layer: "EST-VIGAS-TEXTOS" });
      }
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
    // Com faixa: os pontos pela altura (inclusive os do pavimento de baixo, junto à laje);
    // sem faixa: os do pavimento.
    if (R ? !inStorey(p.position[1]) : p.storey !== storey) continue;
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

    // Família com símbolo de planta próprio (linhas simbólicas do Revit): desenhado em tamanho real.
    const own = def.planLines?.length ? def.planLines : null;
    if (own) {
      const at = ([x, z]: [number, number]): P2 => [center[0] + (r[0] * x + f[0] * z) / 1000, center[1] + (r[1] * x + f[1] * z) / 1000];
      for (const l of own) prims.push({ t: "poly", pts: l.map(at), closed: false, weight: PEN.simbolo, layer: `${prefix}-PONTOS`, color, id: p.id });
    } else if (sym.footprint) {
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
    if (!own) pushSymbol(sym.prims, sym.footprint ? center : origin, r, f, `${prefix}-PONTOS`, color, p.id);

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
    if (!legend.has(legendKey) && own) {
      legend.set(legendKey, { key: legendKey, label: def.label, color, prims: fitLegendLines(own) });
    } else if (!legend.has(legendKey)) {
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
      if (R ? !inMepRange(lowY, Math.max(s.start[1], s.end[1])) : !inStorey(storeyProbeY(run, lowY))) return;
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
      const onFloor = isConduit && (mode ? INSTALL_ZONE[mode] === "piso" : meanY < level + 0.5);
      const dashdot = isApparent(mode ?? undefined);
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
      if (!inStorey(R ? b.position[1] : storeyProbeY(b, b.position[1]))) continue;
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
    for (const sp of input.roomLabels === false ? [] : (input.spaces ?? [])) {
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

/**
 * Folha e arco de abertura da porta, pela orientação da porta no IFC (x ao longo da parede, y
 * para o lado em que ela abre) e pelo tipo de abertura (OperationType: à esquerda, à direita,
 * folha dupla; de correr, pivotante e outras ficam sem arco).
 */
/** Elementos exportados como porta que não abrem (venezianas, janelas, grelhas, brises, alçapões). */
export const NOT_A_SWING_DOOR = /VENEZIAN|JANELA|WINDOW|GRELHA|GRADE|BRISE|LOUVER|VENTIL|ALÇAP|ALCAP|SHAFT|VISITA|FIXA|FIXED/i;

/** A porta leva arco? (não para venezianas e afins, nem para as que não chegam ao piso). */
export function isSwingDoor(e: ElementInfo, floorY: number | null, ov?: DoorOverride): boolean {
  if (ov?.none) return false;
  if (ov?.force) return true;
  const text = `${e.name} ${e.objectType ?? ""} ${e.typeObjectName ?? ""}`;
  // "Porta de abrir … venezianas" é porta; "Veneziana" sozinha (fachada) não.
  if (NOT_A_SWING_DOOR.test(text) && !/PORTA|POR_ABRIR|DE ABRIR|DOOR/i.test(text)) return false;
  if (floorY != null && e.bbox && e.bbox.min[1] > floorY + 0.3) return false;
  return true;
}

/**
 * Lado da folha (−1 ou 1, em relação ao meio da espessura) pela geometria: faces grandes
 * paralelas à parede no meio do vão (a folha fechada, encostada no batente do lado para onde a
 * porta abre). null se não der para saber.
 */
export function leafSide(positions: Float32Array, indices: ArrayLike<number>, o: Vec3, X: Vec3, Y: Vec3, x0: number, x1: number, y0: number, y1: number): 1 | -1 | null {
  const loc = (i: number): [number, number] => {
    const d0 = positions[i * 3] - o[0], d1 = positions[i * 3 + 1] - o[1], d2 = positions[i * 3 + 2] - o[2];
    return [d0 * X[0] + d1 * X[1] + d2 * X[2], d0 * Y[0] + d1 * Y[1] + d2 * Y[2]];
  };
  const w = x1 - x0;
  let sum = 0;
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!len || Math.abs((nx * Y[0] + ny * Y[1] + nz * Y[2]) / len) < 0.9) continue;
    const [ax, ay] = loc(a), [bx] = loc(b), [cx] = loc(c);
    const mx = (ax + bx + cx) / 3;
    // Só o meio do vão (fora os batentes e alizares).
    if (mx < x0 + w * 0.2 || mx > x1 - w * 0.2) continue;
    sum += ay * len;
    area += len;
  }
  if (!area) return null;
  const leaf = sum / area - (y0 + y1) / 2;
  return Math.abs(leaf) < 0.01 ? null : leaf > 0 ? 1 : -1;
}

function doorSwing(e: ElementInfo, positions: Float32Array, indices: ArrayLike<number>, plan: (v: Vec3) => P2, spaces: Space[], ov: DoorOverride | undefined, levelY: number | null = null): Prim[] {
  if (!isSwingDoor(e, levelY, ov)) return [];
  const f = e.frame!;
  const nx = Math.hypot(...f.x) || 1;
  const ny = Math.hypot(...f.y) || 1;
  const X: Vec3 = [f.x[0] / nx, f.x[1] / nx, f.x[2] / nx];
  const Y: Vec3 = [f.y[0] / ny, f.y[1] / ny, f.y[2] / ny];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const d: Vec3 = [positions[i] - f.o[0], positions[i + 1] - f.o[1], positions[i + 2] - f.o[2]];
    const lx = d[0] * X[0] + d[1] * X[1] + d[2] * X[2];
    const ly = d[0] * Y[0] + d[1] * Y[1] + d[2] * Y[2];
    if (lx < x0) x0 = lx;
    if (lx > x1) x1 = lx;
    if (ly > y1) y1 = ly;
    if (ly < y0) y0 = ly;
  }
  const width = x1 - x0;
  const op = (e.operation ?? "").toUpperCase();
  if (!(width > 0.4 && width < 4) || /SLIDING|FOLDING|REVOLVING|ROLLINGUP|SWING_FIXED|LIFTING/.test(op)) return [];
  const at = (lx: number, ly: number): P2 => plan([f.o[0] + X[0] * lx + Y[0] * ly, f.o[1], f.o[2] + X[2] * lx + Y[2] * ly]);
  // Lado da abertura: o da folha (encostada no batente do lado para onde abre, como no Revit).
  // Sem folha reconhecível: para dentro do ambiente (IfcSpace); por fim, o +y do IFC.
  const mid = (x0 + x1) / 2;
  const floorY = e.bbox?.min[1] ?? f.o[1];
  const inRoom = (p: P2) => spaces.some((sp) => Math.abs(sp.floorY - floorY) < 1.5 && pointInPolygon(p, sp.polygon));
  const byLeaf = leafSide(positions, indices, f.o, X, Y, x0, x1, y0, y1);
  const plus = inRoom(at(mid, y1 + 0.6));
  const minus = inRoom(at(mid, y0 - 0.6));
  let sideIn: 1 | -1 = byLeaf ?? (plus || !minus ? 1 : -1);
  if (ov?.flipSide) sideIn = sideIn === 1 ? -1 : 1;
  const other = (s: 1 | -1): 1 | -1 => (s === 1 ? -1 : 1);
  // Folhas: dobradiça à esquerda (x0) ou à direita (x1), invertida pelo ajuste da porta.
  const right = /RIGHT/.test(op) !== !!ov?.flipHand;
  const opposite = /OPPOSITE/.test(op);
  const leaves: { hinge: number; dir: 1 | -1; w: number; side: 1 | -1 }[] = /DOUBLE/.test(op)
    ? [
        { hinge: x0, dir: 1, w: width / 2, side: opposite && right ? other(sideIn) : sideIn },
        { hinge: x1, dir: -1, w: width / 2, side: opposite && !right ? other(sideIn) : sideIn },
      ]
    : [right ? { hinge: x1, dir: -1, w: width, side: sideIn } : { hinge: x0, dir: 1, w: width, side: sideIn }];
  const out: Prim[] = [];
  const base = { layer: "ARQ-PORTAS", color: "#333333", id: e.expressID };
  for (const l of leaves) {
    // Folha aberta (4 cm de espessura, para dentro do vão) e o arco da ponta da folha ao batente.
    const t = 0.04 * l.dir;
    const face = l.side === 1 ? y1 : y0;
    const s = l.side;
    out.push({ t: "poly", pts: [at(l.hinge, face), at(l.hinge, face + s * l.w), at(l.hinge + t, face + s * l.w), at(l.hinge + t, face)], closed: true, weight: PEN.porta, ...base });
    const arc: P2[] = [];
    for (let k = 0; k <= 16; k++) {
      const a = ((Math.PI / 2) * k) / 16;
      arc.push(at(l.hinge + l.dir * l.w * Math.sin(a), face + s * l.w * Math.cos(a)));
    }
    out.push({ t: "poly", pts: arc, closed: false, weight: PEN.vista, ...base });
  }
  return out;
}

/** Linhas da família reduzidas para caber no quadro da legenda (≈ 8 × 6 mm). */
function fitLegendLines(lines: [number, number][][]): SymbolPrim[] {
  const all = lines.flat();
  const [x0, x1] = [Math.min(...all.map((q) => q[0])), Math.max(...all.map((q) => q[0]))];
  const [z0, z1] = [Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[1]))];
  const k = Math.min(8 / Math.max(x1 - x0, 1e-6), 6 / Math.max(z1 - z0, 1e-6));
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return lines.map((l) => ({ t: "poly", pts: l.map(([x, z]): P2 => [(x - cx) * k, (z - cz) * k]), closed: false }));
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
