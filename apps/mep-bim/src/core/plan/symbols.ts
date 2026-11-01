// Simbologia em planta dos componentes da biblioteca.
//
// Elétrica: baseada na prática brasileira derivada da NBR 5444 (tomadas por
// triângulos vazio/meio/cheio conforme a altura, interruptores por círculo,
// quadro por retângulo meio preenchido, eletroduto contínuo no teto/parede e
// tracejado no piso). Demais disciplinas: símbolos simples com sigla. Confira
// com o padrão gráfico do escritório antes de emitir pranchas.
import type { ComponentDef } from "../library";
import type { SymbolPrim } from "./drawing";
import type { P2 } from "./section";

export interface SymbolDef {
  /** Desenha o contorno real (em escala) do componente. */
  footprint: boolean;
  /**
   * Símbolo em mm de papel. Para itens de parede, a base fica em y = 0 (face
   * da parede) e o símbolo cresce para +y (para dentro do ambiente).
   */
  prims: SymbolPrim[];
  /** Distância (mm de papel) do ponto de inserção até onde vai o texto. */
  labelOffset: number;
  description: string;
}

const S = 3.6; // tamanho base dos símbolos (mm)
const tri = (side = S): P2[] => [
  [-side / 2, 0],
  [side / 2, 0],
  [0, (side * Math.sqrt(3)) / 2],
];
const circle = (r: number, fill = false, c: P2 = [0, 0]): SymbolPrim => ({ t: "circle", c, r, fill });
const text = (t: string, p: P2 = [0, 0], height = 1.6): SymbolPrim => ({ t: "text", p, text: t, height });
const box = (w: number, h: number, c: P2 = [0, 0], fill = false): SymbolPrim => ({
  t: "poly",
  pts: [
    [c[0] - w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] + h / 2],
    [c[0] - w / 2, c[1] + h / 2],
  ],
  closed: true,
  fill,
});
const x = (r: number): SymbolPrim[] => [
  { t: "line", a: [-r, -r], b: [r, r] },
  { t: "line", a: [-r, r], b: [r, -r] },
];

/** Triângulo de tomada: vazio (baixa), metade cheia junto à parede (média) ou cheio (alta). */
function outletTriangle(level: "baixa" | "media" | "alta"): SymbolPrim[] {
  const t = tri();
  const out: SymbolPrim[] = [{ t: "poly", pts: t, closed: true, fill: level === "alta" }];
  if (level === "media") {
    const h = t[2][1] / 2;
    out.push({ t: "poly", pts: [t[0], t[1], [S / 4, h], [-S / 4, h]], closed: true, fill: true });
  }
  return out;
}

const SYMBOLS: Record<string, Omit<SymbolDef, "description">> = {
  // Iluminação
  "lum-embutir-6060": { footprint: true, prims: [circle(1.2), ...x(0.85)], labelOffset: 3 },
  "lum-sobrepor-300": { footprint: true, prims: [circle(1.2), ...x(0.85)], labelOffset: 3 },
  "lum-linear-1200": { footprint: true, prims: [circle(1.2), ...x(0.85)], labelOffset: 3 },
  arandela: { footprint: false, prims: [{ t: "poly", pts: Array.from({ length: 9 }, (_, i): P2 => [2 * Math.cos((Math.PI * i) / 8), 2 * Math.sin((Math.PI * i) / 8)]), closed: true }], labelOffset: 4 },
  emergencia: { footprint: false, prims: [box(4.5, 1.8, [0, 0.9]), text("E", [0, 0.9], 1.3)], labelOffset: 4 },
  // Tomadas e comandos
  "tomada-baixa": { footprint: false, prims: outletTriangle("baixa"), labelOffset: 5 },
  "tomada-media": { footprint: false, prims: outletTriangle("media"), labelOffset: 5 },
  "tomada-alta": { footprint: false, prims: outletTriangle("alta"), labelOffset: 5 },
  "tomada-piso": { footprint: false, prims: [box(S, S), { t: "poly", pts: tri(2.6).map(([a, b]): P2 => [a, b - 1.1]), closed: true }], labelOffset: 4 },
  "interruptor-simples": { footprint: false, prims: [circle(1.5, false, [0, 1.5]), text("S", [0, 1.5], 1.4)], labelOffset: 4.5 },
  "interruptor-paralelo": { footprint: false, prims: [circle(1.5, false, [0, 1.5]), text("Sp", [0, 1.5], 1.2)], labelOffset: 4.5 },
  "quadro-distribuicao": { footprint: true, prims: [], labelOffset: 4 },
  "caixa-passagem-teto": { footprint: false, prims: [box(2.6, 2.6), ...x(1.3)], labelOffset: 3 },
  // Telecom e segurança
  "ponto-dados": { footprint: false, prims: [{ t: "poly", pts: tri(), closed: true }, text("D", [0, 1.05], 1.3)], labelOffset: 5 },
  "ponto-tv": { footprint: false, prims: [{ t: "poly", pts: tri(), closed: true }, text("TV", [0, 1.05], 1.0)], labelOffset: 5 },
  "access-point": { footprint: false, prims: [circle(2), text("AP", [0, 0], 1.3)], labelOffset: 3.5 },
  "camera-cftv": { footprint: false, prims: [circle(1.8), { t: "poly", pts: [[-0.9, -0.6], [1.2, 0], [-0.9, 0.6]], closed: true, fill: true }], labelOffset: 3.5 },
  // Incêndio
  "sprinkler-pendente": { footprint: false, prims: [circle(1.4), { t: "line", a: [-2, 0], b: [2, 0] }, { t: "line", a: [0, -2], b: [0, 2] }], labelOffset: 3 },
  "detector-fumaca": { footprint: false, prims: [circle(1.9), text("DF", [0, 0], 1.2)], labelOffset: 3.5 },
  "acionador-manual": { footprint: false, prims: [box(3, 3, [0, 1.5]), text("AM", [0, 1.5], 1.1)], labelOffset: 4.5 },
  sirene: { footprint: false, prims: [box(3, 3, [0, 1.5]), text("SI", [0, 1.5], 1.1)], labelOffset: 4.5 },
  "abrigo-hidrante": { footprint: true, prims: [text("H", [0, 0], 2)], labelOffset: 4 },
  // Hidráulica
  lavatorio: { footprint: true, prims: [text("LV", [0, 0], 1.4)], labelOffset: 4 },
  "bacia-sanitaria": { footprint: true, prims: [text("BS", [0, 0], 1.4)], labelOffset: 4 },
  chuveiro: { footprint: false, prims: [circle(1.6, false, [0, 1.6]), text("CH", [0, 1.6], 1.0)], labelOffset: 4.5 },
  "pia-cozinha": { footprint: true, prims: [text("PIA", [0, 0], 1.4)], labelOffset: 4 },
  "registro-gaveta": { footprint: false, prims: [{ t: "poly", pts: [[-1.4, 0.4], [1.4, 2.2], [1.4, 0.4], [-1.4, 2.2]], closed: true, fill: true }], labelOffset: 4 },
  "ponto-agua-fria": { footprint: false, prims: [circle(1.5, false, [0, 1.5]), text("AF", [0, 1.5], 1.1)], labelOffset: 4.5 },
  "ponto-agua-quente": { footprint: false, prims: [circle(1.5, false, [0, 1.5]), text("AQ", [0, 1.5], 1.1)], labelOffset: 4.5 },
  "ponto-esgoto": { footprint: false, prims: [circle(1.6, true), circle(2.2)], labelOffset: 3.5 },
  "saida-esgoto-parede": { footprint: false, prims: [circle(1.5, true, [0, 1.5])], labelOffset: 4.5 },
  "ponto-gas": { footprint: false, prims: [circle(1.5, false, [0, 1.5]), text("G", [0, 1.5], 1.2)], labelOffset: 4.5 },
  "ralo-sifonado": { footprint: false, prims: [circle(1.5), ...x(1.05)], labelOffset: 3 },
  // Climatização
  "difusor-6060": { footprint: true, prims: x(1.4), labelOffset: 3 },
  "grelha-retorno": { footprint: true, prims: [{ t: "line", a: [-1.5, -0.6], b: [1.5, -0.6] }, { t: "line", a: [-1.5, 0], b: [1.5, 0] }, { t: "line", a: [-1.5, 0.6], b: [1.5, 0.6] }], labelOffset: 3 },
  "evaporadora-hiwall": { footprint: true, prims: [text("EV", [0, 0], 1.4)], labelOffset: 4 },
  "evaporadora-cassete": { footprint: true, prims: [...x(2), text("EV", [0, 0], 1.2)], labelOffset: 4 },
  condensadora: { footprint: true, prims: [circle(1.6), text("CD", [0, 0], 1.0)], labelOffset: 4 },
  exaustor: { footprint: true, prims: [circle(1.4), ...x(1)], labelOffset: 4 },
};

const HEIGHT_TEXT = (def: ComponentDef) => (def.mounting === "parede" ? ` (h = ${def.defaultHeight} mm)` : "");

export function symbolFor(def: ComponentDef): SymbolDef {
  const s = SYMBOLS[def.id] ?? (def.symbolOf ? SYMBOLS[def.symbolOf] : undefined) ?? { footprint: true, prims: [circle(1.5)], labelOffset: 4 };
  return { ...s, description: `${def.label}${HEIGHT_TEXT(def)}` };
}

/** Componentes com símbolo próprio (os demais usam contorno + círculo). */
export const SYMBOL_IDS = Object.keys(SYMBOLS);

/** Riscos de legenda para trechos (linha de 8 mm) e marcas de subida/descida. */
export const LEGEND_LINE: SymbolPrim[] = [{ t: "line", a: [-4, 0], b: [4, 0] }];
export const RISER_UP: SymbolPrim[] = [circle(1.1, true)];
export const RISER_DOWN: SymbolPrim[] = [circle(1.1, false), { t: "circle", c: [0, 0], r: 0.35, fill: true }];
export const TEE_MARK: SymbolPrim[] = [circle(0.6, true)];
