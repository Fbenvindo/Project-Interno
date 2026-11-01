// Cálculos elétricos de baixa tensão (referência: ABNT NBR 5410).
//
// Este módulo cobre queda de tensão e seção mínima. A verificação por
// capacidade de condução de corrente (tabelas 36 a 39 da NBR 5410, com
// fatores de agrupamento e temperatura) entra numa fase seguinte, com as
// tabelas da norma cadastradas e conferidas.

export type SistemaEletrico = "monofasico" | "bifasico" | "trifasico";
export type MaterialCondutor = "cobre" | "aluminio";
export type TipoCircuito = "iluminacao" | "forca" | "sinalizacao";

/** Seções nominais comerciais (mm²). */
export const SECOES_PADRAO = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500];

const RESISTIVIDADE_20C: Record<MaterialCondutor, number> = {
  cobre: 0.017241, // Ω·mm²/m
  aluminio: 0.028264,
};
const COEF_TEMPERATURA: Record<MaterialCondutor, number> = {
  cobre: 0.00393,
  aluminio: 0.00403,
};

/** Seção mínima do condutor-fase de cobre (NBR 5410, tabela 47). */
export const SECAO_MINIMA_COBRE: Record<TipoCircuito, number> = {
  iluminacao: 1.5,
  forca: 2.5,
  sinalizacao: 0.5,
};

export interface QuedaTensaoInput {
  sistema: SistemaEletrico;
  /** Tensão de referência (V): fase-neutro no monofásico, fase-fase no bi/trifásico. */
  tensao: number;
  /** Corrente de projeto (A). */
  corrente: number;
  /** Comprimento do circuito, só ida (m). */
  comprimento: number;
  /** Seção do condutor (mm²). */
  secao: number;
  material?: MaterialCondutor;
  /** Fator de potência. Padrão 0,92. */
  fatorPotencia?: number;
  /** Reatância do condutor (Ω/km). Padrão 0,10, típico de cabos em eletroduto. */
  reatanciaOhmKm?: number;
  /** Temperatura do condutor (°C). Padrão 70 (isolação PVC em regime). */
  temperatura?: number;
  /** Limite admissível (%). Padrão 4% para circuitos terminais. */
  limitePercentual?: number;
}

export interface QuedaTensaoResultado {
  quedaVolts: number;
  quedaPercentual: number;
  limitePercentual: number;
  atende: boolean;
  /** Resistência do condutor na temperatura considerada (Ω/km). */
  resistenciaOhmKm: number;
}

export function resistenciaOhmKm(secao: number, material: MaterialCondutor = "cobre", temperatura = 70): number {
  const rho = RESISTIVIDADE_20C[material] * (1 + COEF_TEMPERATURA[material] * (temperatura - 20));
  return (rho / secao) * 1000;
}

/**
 * ΔV = k · I · L · (R·cosφ + X·senφ), com k = 2 (mono/bifásico, ida e volta)
 * ou √3 (trifásico equilibrado).
 */
export function quedaDeTensao(input: QuedaTensaoInput): QuedaTensaoResultado {
  const {
    sistema,
    tensao,
    corrente,
    comprimento,
    secao,
    material = "cobre",
    fatorPotencia = 0.92,
    reatanciaOhmKm = 0.1,
    temperatura = 70,
    limitePercentual = 4,
  } = input;
  if (tensao <= 0 || secao <= 0) throw new Error("Tensão e seção devem ser maiores que zero.");
  if (fatorPotencia <= 0 || fatorPotencia > 1) throw new Error("Fator de potência deve estar entre 0 e 1.");

  const k = sistema === "trifasico" ? Math.sqrt(3) : 2;
  const r = resistenciaOhmKm(secao, material, temperatura) / 1000;
  const x = reatanciaOhmKm / 1000;
  const sen = Math.sqrt(1 - fatorPotencia ** 2);
  const quedaVolts = k * corrente * comprimento * (r * fatorPotencia + x * sen);
  const quedaPercentual = (quedaVolts / tensao) * 100;
  return {
    quedaVolts,
    quedaPercentual,
    limitePercentual,
    atende: quedaPercentual <= limitePercentual,
    resistenciaOhmKm: r * 1000,
  };
}

/**
 * Menor seção comercial que atende à queda de tensão e à seção mínima do
 * tipo de circuito. Retorna null se nenhuma seção da lista atender.
 */
export function secaoPorQuedaDeTensao(
  input: Omit<QuedaTensaoInput, "secao"> & { tipoCircuito?: TipoCircuito },
): { secao: number; resultado: QuedaTensaoResultado } | null {
  const minima = SECAO_MINIMA_COBRE[input.tipoCircuito ?? "forca"];
  for (const secao of SECOES_PADRAO) {
    if (secao < minima) continue;
    const resultado = quedaDeTensao({ ...input, secao });
    if (resultado.atende) return { secao, resultado };
  }
  return null;
}

/** Corrente de projeto a partir da potência (W). */
export function correnteDeProjeto(potenciaW: number, tensao: number, sistema: SistemaEletrico, fatorPotencia = 0.92): number {
  const k = sistema === "trifasico" ? Math.sqrt(3) : 1;
  return potenciaW / (k * tensao * fatorPotencia);
}
