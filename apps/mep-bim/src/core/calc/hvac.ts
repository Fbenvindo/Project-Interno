// Cálculos de dutos de ar (referência geral: ABNT NBR 16401).

/** Velocidade (m/s) para vazão em m³/h e área livre em m². */
export function velocidadeDuto(vazaoM3h: number, areaM2: number): number {
  if (areaM2 <= 0) throw new Error("Área deve ser maior que zero.");
  return vazaoM3h / 3600 / areaM2;
}

export function areaRetangular(larguraMm: number, alturaMm: number): number {
  return (larguraMm / 1000) * (alturaMm / 1000);
}

export function areaCircular(diametroMm: number): number {
  return (Math.PI * (diametroMm / 1000) ** 2) / 4;
}

/**
 * Diâmetro equivalente (mm) de um duto retangular para mesma perda de carga
 * (Huebscher): De = 1,30 · (a·b)^0,625 / (a+b)^0,25.
 */
export function diametroEquivalente(larguraMm: number, alturaMm: number): number {
  return (1.3 * (larguraMm * alturaMm) ** 0.625) / (larguraMm + alturaMm) ** 0.25;
}

/** Razão de aspecto do duto retangular (maior lado / menor lado). */
export function razaoAspecto(larguraMm: number, alturaMm: number): number {
  return Math.max(larguraMm, alturaMm) / Math.min(larguraMm, alturaMm);
}
