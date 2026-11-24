// Primitivas do desenho em planta, em coordenadas do projeto IFC (metros,
// X para a direita, Y para cima). Espessuras e textos em milímetros de papel.
import type { Discipline } from "../types";
import type { P2 } from "./section";

interface Base {
  layer: string;
  /** Cor de exibição (hex). */
  color: string;
  /** Elemento do modelo associado (seleção). */
  id?: number;
  /** Opacidade (0–1); ausente = opaco. */
  opacity?: number;
}

export type Prim = Base &
  (
    | { t: "line"; a: P2; b: P2; weight: number; dashed?: boolean; dashdot?: boolean }
    | { t: "poly"; pts: P2[]; closed: boolean; weight: number; fill?: string | null; dashed?: boolean; dashdot?: boolean }
    | { t: "circle"; c: P2; r: number; weight: number; fill?: string | null }
    | { t: "text"; p: P2; text: string; height: number; anchor: "start" | "middle" | "end"; angle?: number }
  );

/** Primitivas de símbolo em milímetros de papel, num sistema local (Y para cima). */
export type SymbolPrim =
  | { t: "line"; a: P2; b: P2 }
  | { t: "poly"; pts: P2[]; closed: boolean; fill?: boolean }
  | { t: "circle"; c: P2; r: number; fill?: boolean }
  | { t: "text"; p: P2; text: string; height: number };

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  /** Desenho do item em mm de papel, centrado na origem (cabe em ~8 × 6 mm). */
  prims: SymbolPrim[];
  dashed?: boolean;
  /** Traço-ponto (eletroduto aparente). */
  dashdot?: boolean;
}

export interface PlanDrawing {
  prims: Prim[];
  bounds: { min: P2; max: P2 } | null;
  legend: LegendItem[];
  scale: number;
  storey: string;
  cutHeight: number;
}

/** Cores de impressão por disciplina (mais escuras que as da cena 3D). */
export const PRINT_COLOR: Record<Discipline, string> = {
  hidraulica: "#1f5fbf",
  incendio: "#c0392b",
  gas: "#a07c00",
  hvac: "#1e8449",
  eletrica: "#d35400",
  telecom: "#7d3c98",
  mep: "#2e86c1",
  estrutura: "#555555",
  arquitetura: "#333333",
  outros: "#777777",
};

/** Prefixo de camada (DXF) por disciplina. */
export const LAYER_PREFIX: Record<Discipline, string> = {
  hidraulica: "HID",
  incendio: "INC",
  gas: "GAS",
  hvac: "HVAC",
  eletrica: "ELE",
  telecom: "TEL",
  mep: "MEP",
  estrutura: "EST",
  arquitetura: "ARQ",
  outros: "OUT",
};

/** Espessuras de pena (mm), seguindo a gradação usual (NBR 8403). */
export const PEN = { corte: 0.35, vista: 0.13, porta: 0.18, mep: 0.35, simbolo: 0.25, fino: 0.13 };
