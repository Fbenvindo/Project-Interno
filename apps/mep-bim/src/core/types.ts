// Tipos de domínio compartilhados pelo núcleo (sem dependência de UI ou de IFC).

export type Discipline =
  | "hidraulica"
  | "incendio"
  | "gas"
  | "hvac"
  | "eletrica"
  | "telecom"
  | "mep"
  | "estrutura"
  | "arquitetura"
  | "outros";

/** Papel do elemento na rede, usado para definir a unidade do quantitativo. */
export type ElementCategory =
  | "segmento"
  | "conexao"
  | "acessorio"
  | "terminal"
  | "equipamento"
  | "construtivo"
  | "outro";

export type Vec3 = [number, number, number];

/** Caixa envolvente alinhada aos eixos, em metros (sistema Y para cima). */
export interface BBox {
  min: Vec3;
  max: Vec3;
}

import type { OBB } from "./obb";

export type PropertyValue = string | number | boolean | null;

export interface PropertyGroup {
  name: string;
  kind: "propriedades" | "quantidades";
  values: { name: string; value: PropertyValue }[];
}

export interface ElementInfo {
  expressID: number;
  globalId: string;
  /** Nome da entidade IFC em maiúsculas, ex.: IFCPIPESEGMENT. */
  ifcType: string;
  name: string;
  objectType: string | null;
  predefinedType: string | null;
  storey: string | null;
  systems: string[];
  discipline: Discipline;
  category: ElementCategory;
  bbox: BBox | null;
  /** Comprimento em metros (somente segmentos). */
  length: number | null;
  /** Dimensão nominal legível, ex.: "Ø50" ou "400x300" (mm). */
  size: string | null;
  /** "locacao" para pontos criados no app; ausente para elementos do IFC. */
  origin?: "ifc" | "locacao";
  /** Caixa orientada exata (elementos criados no app), para interferências precisas. */
  obb?: OBB;
}
