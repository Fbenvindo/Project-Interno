// Quadros e circuitos → SmartEasyWEB (Quadros Terminais) e resultados de lá → circuitos do modelo.
import { calcCircuit, isPanel, panelSystem, pointPowerVA, type Circuit, type CircuitWebResult } from "../../../core/circuits";
import { COMPONENT_BY_ID } from "../../../core/library";
import type { PlacedPoint } from "../../../core/points";
import type { Run } from "../../../core/runs";

export interface WebPanelOut {
  guid: string;
  nome: string;
  pavimento: string | null;
  fases: number;
  vFN: number;
  vFF: number;
  circuitos: {
    uid: string;
    nome: string;
    descricao: string;
    tipo: string;
    polos: number;
    fp: number;
    comprimento: number;
    cargas: { guid: string; descricao: string; watts: number; fp: number }[];
  }[];
}

export interface WebCircuitResult {
  uid: string;
  tag: string;
  quadro: string;
  potenciaKw: number;
  correnteA: number;
  disjuntorA: number;
  curva: string;
  bitolaFaseMm2: number | null;
  bitolaTerraMm2: number | null;
  temNeutro: boolean;
  quedaPercent: number;
  quedaOk: boolean;
  curtoOk: boolean;
  eletroduto: { nominal: string; ocupacaoPercent: number } | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function panelsForWeb(points: PlacedPoint[], circuits: Circuit[], runs: Run[]): WebPanelOut[] {
  return points.filter(isPanel).map((panel) => {
    const sys = panelSystem(panel.params.Sistema);
    return {
      guid: panel.guid,
      nome: panel.tag || "Quadro",
      pavimento: panel.storey,
      fases: sys.phases,
      vFN: sys.vFN,
      vFF: sys.vFF,
      circuitos: circuits
        .filter((c) => c.panel === panel.guid)
        .map((c) => {
          const pts = points.filter((p) => p.circuit === c.uid);
          const k = calcCircuit({ ...c, web: undefined }, sys, panel.position, pts, runs);
          return {
            uid: c.uid,
            nome: c.name,
            descricao: c.description,
            tipo: c.type,
            polos: c.poles,
            fp: c.powerFactor,
            comprimento: r1(k.length),
            cargas: pts.map((p) => ({
              guid: p.guid,
              descricao: `${COMPONENT_BY_ID[p.componentId]?.label ?? "Ponto"}${p.tag ? ` ${p.tag}` : ""}`,
              watts: Math.round(pointPowerVA(p, c.powerFactor) * c.powerFactor * 10) / 10,
              fp: c.powerFactor,
            })),
          };
        }),
    };
  });
}

/** Resultado para guardar no circuito (null se não veio resultado para ele). */
export function webResultFor(r: WebCircuitResult | undefined, calculadoEm: string): CircuitWebResult | null {
  if (!r) return null;
  return {
    calculadoEm,
    quadro: r.quadro,
    potenciaW: Math.round(r.potenciaKw * 1000 * 10) / 10,
    correnteA: r.correnteA,
    disjuntorA: r.disjuntorA,
    curva: r.curva,
    bitolaFaseMm2: r.bitolaFaseMm2,
    bitolaTerraMm2: r.bitolaTerraMm2,
    temNeutro: r.temNeutro,
    quedaPercent: r.quedaPercent,
    quedaOk: r.quedaOk,
    curtoOk: r.curtoOk,
    eletroduto: r.eletroduto?.nominal ?? null,
  };
}

/** Bitola do eletroduto do SmartEasyWEB ("20 (1/2\")") → tamanho do tipo de trecho daqui ("Ø20"). */
export function conduitSizeLabel(nominal: string | null, sizes: { label: string }[]): string | null {
  const mm = nominal ? /(\d+(?:[.,]\d+)?)/.exec(nominal)?.[1] : null;
  if (!mm) return null;
  return sizes.find((s) => s.label.replace(/\D+/g, "") === mm.replace(/\D+/g, ""))?.label ?? null;
}
