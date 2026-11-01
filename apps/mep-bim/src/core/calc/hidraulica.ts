// Cálculos hidráulicos (referências: ABNT NBR 5626 para água fria e quente;
// Hazen-Williams, usado também em redes de sprinklers, NBR 10897).

export type MaterialTubo = "pvc" | "cobre" | "aco_galvanizado";

/** Velocidade máxima recomendada em água fria (NBR 5626). */
export const VELOCIDADE_MAXIMA_AF = 3; // m/s

/** Método dos pesos relativos: Q = 0,3 · √ΣP (L/s). */
export function vazaoPorPesos(somaPesos: number): number {
  if (somaPesos < 0) throw new Error("A soma dos pesos não pode ser negativa.");
  return 0.3 * Math.sqrt(somaPesos);
}

/** Velocidade média (m/s) para vazão em L/s e diâmetro interno em mm. */
export function velocidade(vazaoLs: number, diametroMm: number): number {
  const area = Math.PI * (diametroMm / 1000) ** 2 / 4;
  return vazaoLs / 1000 / area;
}

/**
 * Perda de carga unitária (kPa/m) pela fórmula de Fair-Whipple-Hsiao:
 *  - tubos lisos (PVC, cobre):     J = 8,69·10⁶ · Q^1,75 · d^-4,75
 *  - tubos rugosos (aço galvan.):  J = 20,2·10⁶ · Q^1,88 · d^-4,88
 * com Q em L/s e d (diâmetro interno) em mm.
 */
export function perdaCargaFairWhippleHsiao(vazaoLs: number, diametroMm: number, material: MaterialTubo = "pvc"): number {
  if (diametroMm <= 0) throw new Error("Diâmetro deve ser maior que zero.");
  if (vazaoLs <= 0) return 0;
  return material === "aco_galvanizado"
    ? 20.2e6 * vazaoLs ** 1.88 * diametroMm ** -4.88
    : 8.69e6 * vazaoLs ** 1.75 * diametroMm ** -4.75;
}

/**
 * Perda de carga unitária (m/m) por Hazen-Williams:
 * J = 10,643 · Q^1,852 · C^-1,852 · D^-4,87, com Q em m³/s e D em m.
 */
export function perdaCargaHazenWilliams(vazaoLs: number, diametroMm: number, coeficienteC: number): number {
  if (diametroMm <= 0 || coeficienteC <= 0) throw new Error("Diâmetro e coeficiente C devem ser maiores que zero.");
  if (vazaoLs <= 0) return 0;
  const q = vazaoLs / 1000;
  const d = diametroMm / 1000;
  return 10.643 * q ** 1.852 * coeficienteC ** -1.852 * d ** -4.87;
}

export interface TrechoAguaFriaInput {
  vazaoLs: number;
  diametroInternoMm: number;
  /** Comprimento real do trecho (m). */
  comprimento: number;
  /** Comprimento equivalente das conexões (m). */
  comprimentoEquivalente?: number;
  material?: MaterialTubo;
}

export interface TrechoAguaFriaResultado {
  velocidade: number;
  velocidadeAtende: boolean;
  /** kPa/m */
  perdaUnitaria: number;
  /** kPa */
  perdaTotal: number;
  /** m.c.a. */
  perdaTotalMca: number;
}

export function trechoAguaFria(input: TrechoAguaFriaInput): TrechoAguaFriaResultado {
  const v = velocidade(input.vazaoLs, input.diametroInternoMm);
  const j = perdaCargaFairWhippleHsiao(input.vazaoLs, input.diametroInternoMm, input.material);
  const total = j * (input.comprimento + (input.comprimentoEquivalente ?? 0));
  return {
    velocidade: v,
    velocidadeAtende: v <= VELOCIDADE_MAXIMA_AF,
    perdaUnitaria: j,
    perdaTotal: total,
    perdaTotalMca: total / 9.80665,
  };
}
