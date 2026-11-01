// Circuitos elétricos ligados a um quadro: potência, corrente, comprimento
// pelo traçado, dimensionamento e quadro de cargas (referência: NBR 5410).
//
// Capacidade de condução: tabela 36 da NBR 5410, método de referência B1
// (condutores isolados em eletroduto embutido em alvenaria), cobre, isolação
// PVC 70 °C, temperatura ambiente 30 °C. Fatores de agrupamento (tabela 42)
// e de temperatura entram pelo campo FCA de cada circuito. Confira os valores
// com a edição vigente da norma antes de emitir o projeto.
import { quedaDeTensao, SECAO_MINIMA_COBRE, SECOES_PADRAO, type SistemaEletrico } from "./calc/eletrica";
import { COMPONENT_BY_ID } from "./library";
import type { PlacedPoint } from "./points";
import { closestOnSegment, distance, RUN_TYPE_BY_ID, runSegments, type Run } from "./runs";
import type { Vec3 } from "./types";

export type CircuitType = "iluminacao" | "tug" | "tue" | "outro";

export const CIRCUIT_TYPE_LABEL: Record<CircuitType, string> = {
  iluminacao: "Iluminação",
  tug: "TUG",
  tue: "TUE",
  outro: "Outro",
};

export interface PanelSystem {
  id: string;
  label: string;
  phases: 1 | 2 | 3;
  /** Tensão fase-neutro (V). */
  vFN: number;
  /** Tensão fase-fase (V). */
  vFF: number;
}

export const PANEL_SYSTEMS: PanelSystem[] = [
  { id: "1F-127", label: "1F+N 127 V", phases: 1, vFN: 127, vFF: 127 },
  { id: "1F-220", label: "1F+N 220 V", phases: 1, vFN: 220, vFF: 220 },
  { id: "2F-127/220", label: "2F+N 127/220 V", phases: 2, vFN: 127, vFF: 220 },
  { id: "3F-127/220", label: "3F+N 127/220 V", phases: 3, vFN: 127, vFF: 220 },
  { id: "3F-220/380", label: "3F+N 220/380 V", phases: 3, vFN: 220, vFF: 380 },
];
export const DEFAULT_PANEL_SYSTEM = "3F-127/220";
export const panelSystem = (id: string | number | undefined) => PANEL_SYSTEMS.find((s) => s.id === id) ?? PANEL_SYSTEMS.find((s) => s.id === DEFAULT_PANEL_SYSTEM)!;

export interface Circuit {
  /** Identificador de sessão (numérico). */
  id: number;
  /** Identificador estável (arquivo de projeto). */
  uid: string;
  /** GlobalId do quadro (ponto locado). */
  panel: string;
  name: string;
  description: string;
  type: CircuitType;
  /** Número de fases do circuito (1 = F+N, 2 = F+F, 3 = 3F). */
  poles: 1 | 2 | 3;
  /** Fases ligadas: "A", "B", "C", "AB", "BC", "CA" ou "ABC". */
  phases: string;
  powerFactor: number;
  /** Fator de correção (agrupamento × temperatura) aplicado à capacidade de condução. */
  correction: number;
  /** Limite de queda de tensão do circuito (%). */
  dropLimit: number;
}

let circuitSerial = 1;
export const newCircuitId = () => circuitSerial++;

/** Capacidade de condução (A) — tabela 36, método B1, cobre/PVC 70 °C, 30 °C. */
const AMPACITY_B1: Record<2 | 3, Record<number, number>> = {
  2: { 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57, 16: 76, 25: 101, 35: 125, 50: 151, 70: 192, 95: 232, 120: 269, 150: 309, 185: 353, 240: 415 },
  3: { 1.5: 15.5, 2.5: 21, 4: 28, 6: 36, 10: 50, 16: 68, 25: 89, 35: 110, 50: 134, 70: 171, 95: 207, 120: 239, 150: 275, 185: 314, 240: 370 },
};

/** Correntes nominais usuais de disjuntores termomagnéticos (A). */
export const BREAKERS = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100, 125];

export function ampacity(section: number, loadedConductors: 2 | 3): number | null {
  return AMPACITY_B1[loadedConductors][section] ?? null;
}

/** Potência aparente de um ponto (VA): "Potência" em VA, ou em W dividida pelo fator de potência. */
export function pointPowerVA(p: PlacedPoint, powerFactor: number): number {
  const def = COMPONENT_BY_ID[p.componentId];
  const value = Number(p.params["Potência"]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = def.params.find((x) => x.name === "Potência")?.unit;
  return unit === "W" ? value / powerFactor : value;
}

export function circuitVoltage(c: Pick<Circuit, "poles">, sys: PanelSystem): number {
  return c.poles === 1 ? sys.vFN : sys.vFF;
}

export function circuitCurrent(powerVA: number, voltage: number, poles: 1 | 2 | 3): number {
  return poles === 3 ? powerVA / (Math.sqrt(3) * voltage) : powerVA / voltage;
}

// ---- Comprimento pelo traçado ------------------------------------------------------------

const keyOf = (v: Vec3) => v.map((c) => Math.round(c * 1000)).join(",");

/**
 * Distâncias, pelo traçado de eletrodutos e eletrocalhas, de `from` até cada
 * alvo (null se o alvo não estiver ligado à rede). Os trechos são divididos
 * onde outro trecho chega no meio (tê).
 */
export function conduitDistances(runs: Run[], from: Vec3, targets: Vec3[], snap = 0.05): (number | null)[] {
  const conduits = runs.filter((r) => RUN_TYPE_BY_ID[r.typeId]?.segmentType === "IFCCABLECARRIERSEGMENT");
  const nodes = new Map<string, Vec3>();
  const adj = new Map<string, { to: string; w: number }[]>();
  const link = (a: Vec3, b: Vec3) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === kb) return;
    nodes.set(ka, a);
    nodes.set(kb, b);
    const w = distance(a, b);
    adj.set(ka, [...(adj.get(ka) ?? []), { to: kb, w }]);
    adj.set(kb, [...(adj.get(kb) ?? []), { to: ka, w }]);
  };
  const ends = conduits.flatMap((r) => [r.vertices[0], r.vertices[r.vertices.length - 1]]);
  for (const r of conduits) {
    for (const s of runSegments(r)) {
      // Pontos de derivação sobre este segmento (extremidades de outros trechos).
      const cuts = ends
        .map((e) => ({ e, ...closestOnSegment(e, s.start, s.end) }))
        .filter(({ e, point, t }) => t > 1e-6 && t < 1 - 1e-6 && distance(e, point) < 0.005)
        .sort((a, b) => a.t - b.t)
        .map((c) => c.point);
      const chain = [s.start, ...cuts, s.end];
      for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
    }
  }
  const nearest = (p: Vec3): string | null => {
    let best: string | null = null;
    let bd = snap;
    for (const [k, v] of nodes) {
      const d = distance(p, v);
      if (d <= bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  const start = nearest(from);
  if (!start) return targets.map(() => null);
  // Dijkstra simples (redes pequenas).
  const dist = new Map<string, number>([[start, 0]]);
  const done = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    let cd = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < cd) ((cur = k), (cd = d));
    if (cur == null) break;
    done.add(cur);
    for (const { to, w } of adj.get(cur) ?? []) if (cd + w < (dist.get(to) ?? Infinity)) dist.set(to, cd + w);
  }
  return targets.map((t) => {
    const k = nearest(t);
    return k != null && dist.has(k) ? dist.get(k)! : null;
  });
}

/** Estimativa sem traçado: percurso ortogonal (|Δx| + |Δy| + |Δz|). */
export const estimateLength = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

// ---- Dimensionamento -------------------------------------------------------------------------

export interface CircuitCalc {
  circuit: Circuit;
  points: PlacedPoint[];
  powerVA: number;
  voltage: number;
  current: number;
  /** Comprimento até o ponto mais distante (m). */
  length: number;
  lengthSource: "tracado" | "misto" | "estimado" | "sem pontos";
  breaker: number | null;
  section: number | null;
  /** Critério que definiu a seção. */
  criterion: "mínima" | "capacidade" | "queda" | null;
  /** Capacidade de condução corrigida da seção escolhida (A). */
  iz: number | null;
  drop: number | null;
  warnings: string[];
}

export function calcCircuit(c: Circuit, sys: PanelSystem, panelPosition: Vec3 | null, points: PlacedPoint[], runs: Run[]): CircuitCalc {
  const warnings: string[] = [];
  const powerVA = points.reduce((s, p) => s + pointPowerVA(p, c.powerFactor), 0);
  if (points.some((p) => pointPowerVA(p, c.powerFactor) === 0 && COMPONENT_BY_ID[p.componentId].params.some((x) => x.name === "Potência"))) {
    warnings.push("Há pontos com potência zero.");
  }
  if (c.poles > sys.phases) warnings.push(`O quadro (${sys.label}) não tem ${c.poles} fases.`);
  const voltage = circuitVoltage(c, sys);
  const current = circuitCurrent(powerVA, voltage, c.poles);

  let length = 0;
  let lengthSource: CircuitCalc["lengthSource"] = "sem pontos";
  if (panelPosition && points.length) {
    const viaRuns = conduitDistances(runs, panelPosition, points.map((p) => p.position));
    const lens = viaRuns.map((d, i) => d ?? estimateLength(panelPosition, points[i].position));
    length = Math.max(...lens);
    const known = viaRuns.filter((d) => d != null).length;
    lengthSource = known === points.length ? "tracado" : known ? "misto" : "estimado";
    if (lengthSource !== "tracado") warnings.push("Comprimento estimado para pontos sem traçado até o quadro.");
  } else if (!panelPosition) warnings.push("Quadro não encontrado.");

  const loaded: 2 | 3 = c.poles === 3 ? 3 : 2;
  const minimum = SECAO_MINIMA_COBRE[c.type === "iluminacao" ? "iluminacao" : "forca"];
  const breaker = BREAKERS.find((b) => b >= current - 1e-9) ?? null;
  if (breaker == null) warnings.push("Corrente acima dos disjuntores da lista.");
  const sistema: SistemaEletrico = c.poles === 1 ? "monofasico" : c.poles === 2 ? "bifasico" : "trifasico";

  let section: number | null = null;
  let criterion: CircuitCalc["criterion"] = null;
  let iz: number | null = null;
  let drop: number | null = null;
  if (breaker != null) {
    const dropAt = (sec: number) =>
      powerVA > 0 && length > 0
        ? quedaDeTensao({ sistema, tensao: voltage, corrente: current, comprimento: length, secao: sec, fatorPotencia: c.powerFactor }).quedaPercentual
        : 0;
    const candidates = SECOES_PADRAO.filter((s) => s >= minimum && ampacity(s, loaded) != null);
    // Menor seção por critério: capacidade de condução (Iz corrigida ≥ In) e queda de tensão.
    const byAmpacity = candidates.find((s) => ampacity(s, loaded)! * c.correction + 1e-9 >= breaker);
    const byDrop = candidates.find((s) => dropAt(s) <= c.dropLimit + 1e-9);
    if (byAmpacity != null && byDrop != null) {
      section = Math.max(minimum, byAmpacity, byDrop);
      criterion = section === minimum ? "mínima" : byAmpacity >= byDrop ? "capacidade" : "queda";
      iz = ampacity(section, loaded)! * c.correction;
      drop = dropAt(section);
    } else warnings.push("Nenhuma seção da tabela atende: divida o circuito ou aumente o FCA.");
  }
  return { circuit: c, points, powerVA, voltage, current, length, lengthSource, breaker, section, criterion, iz, drop, warnings };
}

// ---- Quadro: fases e totais --------------------------------------------------------------------

export function phaseLoads(calcs: Pick<CircuitCalc, "circuit" | "powerVA">[]): Record<"A" | "B" | "C", number> {
  const out = { A: 0, B: 0, C: 0 };
  for (const { circuit, powerVA } of calcs) {
    const ph = circuit.phases.split("").filter((x): x is "A" | "B" | "C" => x === "A" || x === "B" || x === "C");
    for (const f of ph) out[f] += powerVA / ph.length;
  }
  return out;
}

/** Desequilíbrio entre fases: (maior − menor) / maior, considerando as fases existentes no quadro. */
export function imbalance(loads: Record<"A" | "B" | "C", number>, phases: 1 | 2 | 3): number {
  const v = (["A", "B", "C"] as const).slice(0, phases).map((f) => loads[f]);
  const max = Math.max(...v);
  return max > 0 ? (max - Math.min(...v)) / max : 0;
}

/**
 * Distribui os circuitos entre as fases do quadro (do mais carregado para o
 * menos), ligando cada um à(s) fase(s) com menor carga acumulada.
 */
export function balancePhases(calcs: Pick<CircuitCalc, "circuit" | "powerVA">[], panelPhases: 1 | 2 | 3): Map<number, string> {
  const avail = (["A", "B", "C"] as const).slice(0, panelPhases);
  const load: Record<string, number> = { A: 0, B: 0, C: 0 };
  const result = new Map<number, string>();
  const pairs = panelPhases === 3 ? ["AB", "BC", "CA"] : ["AB"];
  for (const { circuit, powerVA } of [...calcs].sort((a, b) => b.powerVA - a.powerVA)) {
    let ph: string;
    if (circuit.poles >= 3 && panelPhases === 3) ph = "ABC";
    else if (circuit.poles >= 2 && panelPhases >= 2) ph = pairs.reduce((best, p) => (load[p[0]] + load[p[1]] < load[best[0]] + load[best[1]] ? p : best));
    else ph = avail.reduce((best, f) => (load[f] < load[best] ? f : best), avail[0]);
    for (const f of ph) load[f] += powerVA / ph.length;
    result.set(circuit.id, ph);
  }
  return result;
}

export function nextCircuitName(circuits: Circuit[], panel: string): string {
  let max = 0;
  for (const c of circuits) {
    if (c.panel !== panel) continue;
    const m = c.name.match(/^C(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `C${max + 1}`;
}

/** Tipo de circuito sugerido pelos pontos (iluminação, tomadas de uso geral ou específico). */
export function suggestType(points: PlacedPoint[]): CircuitType {
  if (!points.length) return "tug";
  const isLighting = (p: PlacedPoint) => {
    const d = COMPONENT_BY_ID[p.componentId];
    return d.group === "Iluminação" || d.ifcType === "IFCSWITCHINGDEVICE";
  };
  if (points.every(isLighting)) return "iluminacao";
  if (points.length === 1 && pointPowerVA(points[0], 0.92) >= 1000) return "tue";
  if (points.every((p) => COMPONENT_BY_ID[p.componentId].ifcType === "IFCOUTLET")) return "tug";
  return "outro";
}

/** Pontos que podem pertencer a circuitos: os que têm o parâmetro "Circuito". */
export const isCircuitable = (p: PlacedPoint) => COMPONENT_BY_ID[p.componentId].params.some((x) => x.name === "Circuito");
export const isPanel = (p: PlacedPoint) => p.componentId === "quadro-distribuicao";
