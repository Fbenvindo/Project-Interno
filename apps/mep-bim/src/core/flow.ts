// Fluxogramas das instalações (começando pela elétrica): o percurso da energia desde a
// alimentação até os quadros, desenhado livremente pelo usuário com blocos e ligações,
// em faixas por pavimento e colunas por torre. Depois de pronto, o fluxograma orienta o
// projeto e é conferido com o modelo (quadros locados, circuitos e cargas).
//
// Coordenadas do fluxograma: "metros de desenho" com Y para baixo (como na tela); na folha,
// a escala 1:100 faz 1 unidade = 10 mm de papel.
import type { Prim } from "./plan/drawing";
import type { P2 } from "./plan/section";
import type { Discipline } from "./types";
import { floorElevationsByTower, floorElevText, floorLabel, type BuildingProfile } from "./building";

/** Sistema do fluxograma (cada um com a sua paleta, ligações e conferência). */
export type FlowSystem = "eletrica" | "agua-fria";

export const SYSTEM_LABEL: Record<FlowSystem, string> = { eletrica: "Elétrica", "agua-fria": "Água fria" };

export type FlowLinkKind = "mt" | "bt" | "barramento" | "emergencia" | "fv" | "abastecimento" | "recalque" | "agua" | "pressurizada";

export const LINK_LABEL: Record<FlowLinkKind, string> = {
  mt: "Média tensão",
  bt: "Alimentador BT",
  barramento: "Barramento blindado",
  emergencia: "Emergência (gerador)",
  fv: "Fotovoltaico",
  abastecimento: "Abastecimento (rede)",
  recalque: "Recalque",
  agua: "Distribuição por gravidade",
  pressurizada: "Distribuição pressurizada",
};

export const LINK_STYLE: Record<FlowLinkKind, { color: string; weight: number; dashed?: boolean }> = {
  mt: { color: "#7c3aed", weight: 0.7 },
  bt: { color: "#1e3a8a", weight: 0.5 },
  barramento: { color: "#ea580c", weight: 0.9 },
  emergencia: { color: "#dc2626", weight: 0.5, dashed: true },
  fv: { color: "#16a34a", weight: 0.5 },
  abastecimento: { color: "#0ea5e9", weight: 0.6, dashed: true },
  recalque: { color: "#ea580c", weight: 0.6 },
  agua: { color: "#1d4ed8", weight: 0.5 },
  pressurizada: { color: "#7c3aed", weight: 0.5 },
};

export const LINK_KINDS: Record<FlowSystem, FlowLinkKind[]> = {
  eletrica: ["mt", "bt", "barramento", "emergencia", "fv"],
  "agua-fria": ["abastecimento", "recalque", "agua", "pressurizada"],
};

export interface FlowParamDef {
  key: string;
  label: string;
  unit?: string;
  default: string | number;
  options?: string[];
}

export type FlowSymbol =
  | "rede"
  | "medicao"
  | "painel"
  | "trafo"
  | "quadro"
  | "barramento"
  | "derivacao"
  | "mec"
  | "gerador"
  | "qta"
  | "fv"
  | "inversor"
  | "motor"
  | "caixa"
  | "texto"
  | "tanque"
  | "bomba"
  | "valvula"
  | "coluna"
  | "hidrometro"
  | "consumo";

export interface FlowBlockDef {
  id: string;
  /** Sistema (ausente = elétrica). */
  system?: FlowSystem;
  /** Grupo da paleta (1 a 9, como no pedido; 0 = anotação). */
  group: number;
  label: string;
  tagPrefix: string;
  /** Tamanho (unidades de desenho). */
  w: number;
  h: number;
  /** Cor do traço (o fundo é uma versão clara). */
  color: string;
  symbol: FlowSymbol;
  /** Tipo das ligações que saem do bloco. */
  out: FlowLinkKind;
  params: FlowParamDef[];
  /** Fonte de energia (não precisa ser alimentado). */
  source?: boolean;
  /** Quadro: pode ser vinculado a um quadro locado no modelo. */
  board?: boolean;
  /** Recebe média tensão. */
  acceptsMT?: boolean;
  /** Caixa de medição: quantidade de medidores. */
  meters?: number;
  /** Uma linha de resumo com os parâmetros principais. */
  summary?: (p: Record<string, string | number>) => string;
  /** Ponto final do sistema (consumo): não precisa alimentar outros blocos. */
  sink?: boolean;
}

/** Grupos da paleta da elétrica (mantido por compatibilidade; ver FLOW_GROUPS_BY). */
export const FLOW_GROUPS: Record<number, string> = {
  1: "Alimentação de energia",
  2: "Distribuição dos alimentadores",
  3: "Subestação",
  4: "Centro de medição convencional",
  5: "Barramento blindado e medição no andar",
  6: "Geradores",
  7: "Painéis fotovoltaicos",
  8: "Quadros de iluminação e tomadas",
  9: "Quadros de motores e bombas",
  0: "Anotação",
};

export const FLOW_GROUPS_BY: Record<FlowSystem, Record<number, string>> = {
  eletrica: FLOW_GROUPS,
  "agua-fria": {
    1: "Abastecimento",
    2: "Reservação inferior",
    3: "Recalque",
    4: "Reservação superior",
    5: "Distribuição (barrilete e colunas)",
    6: "Controle de pressão",
    7: "Medição individualizada",
    8: "Consumo",
    0: "Anotação",
  },
};

const MT = "#7c3aed";
const AF = "#0369a1";
const AF_SRC = "#0ea5e9";
const PUMP = "#c2410c";
const VALVE = "#7c3aed";
/** Litros com separador de milhar ("60.000 L"). */
export const fmtL = (v: number) => `${Math.round(v || 0).toLocaleString("pt-BR")} L`;
const BT = "#1e3a8a";
const BUS = "#ea580c";
const EM = "#dc2626";
const FV = "#16a34a";
const MOT = "#b45309";

const mec = (n: number, roman: string): FlowBlockDef => ({
  id: `mec-${roman.toLowerCase()}`,
  group: 5,
  label: `Caixa MEC ${roman} (${n} medidores)`,
  tagPrefix: "MEC",
  w: 2.2,
  h: 0.9,
  color: BT,
  symbol: "mec",
  out: "bt",
  meters: n,
  params: [{ key: "disjuntor", label: "Disjuntor geral", unit: "A", default: n <= 4 ? 100 : 200 }],
  summary: (p) => `${n} medidores${p.disjuntor ? ` · ${p.disjuntor} A` : ""}`,
});

const RAW_BLOCKS: FlowBlockDef[] = [
  // 1) Alimentação de energia
  {
    id: "concessionaria-mt",
    group: 1,
    label: "Concessionária (média tensão)",
    tagPrefix: "CONC",
    w: 2.4,
    h: 1,
    color: MT,
    symbol: "rede",
    out: "mt",
    source: true,
    params: [{ key: "tensao", label: "Tensão", unit: "kV", default: 13.8 }],
    summary: (p) => `Rede MT ${p.tensao} kV`,
  },
  {
    id: "concessionaria-bt",
    group: 1,
    label: "Concessionária (baixa tensão)",
    tagPrefix: "CONC",
    w: 2.4,
    h: 1,
    color: BT,
    symbol: "rede",
    out: "bt",
    source: true,
    params: [{ key: "tensao", label: "Tensão", unit: "V", default: "380/220" }],
    summary: (p) => `Rede BT ${p.tensao} V`,
  },
  {
    id: "medicao-mt",
    group: 1,
    label: "Cabine de medição MT",
    tagPrefix: "CMT",
    w: 2.2,
    h: 1,
    color: MT,
    symbol: "medicao",
    out: "mt",
    acceptsMT: true,
    params: [],
    summary: () => "TC/TP da concessionária",
  },
  {
    id: "entrada-bt",
    group: 1,
    label: "Entrada / medição BT",
    tagPrefix: "ENT",
    w: 2.2,
    h: 1,
    color: BT,
    symbol: "medicao",
    out: "bt",
    params: [{ key: "disjuntor", label: "Disjuntor geral", unit: "A", default: 200 }],
    summary: (p) => `Disj. ${p.disjuntor} A`,
  },
  // 2) Distribuição dos alimentadores
  {
    id: "caixa-passagem",
    group: 2,
    label: "Caixa de passagem",
    tagPrefix: "CP",
    w: 1.4,
    h: 0.8,
    color: BT,
    symbol: "caixa",
    out: "bt",
    params: [{ key: "dimensao", label: "Dimensões", unit: "cm", default: "60×60×60" }],
    summary: (p) => `${p.dimensao} cm`,
  },
  {
    id: "seccionadora",
    group: 2,
    label: "Chave seccionadora / proteção geral",
    tagPrefix: "CS",
    w: 1.8,
    h: 0.8,
    color: BT,
    symbol: "caixa",
    out: "bt",
    params: [{ key: "corrente", label: "Corrente", unit: "A", default: 630 }],
    summary: (p) => `${p.corrente} A`,
  },
  // 3) Subestação
  {
    id: "painel-mt",
    group: 3,
    label: "Painel de média tensão",
    tagPrefix: "PMT",
    w: 2.2,
    h: 1.2,
    color: MT,
    symbol: "painel",
    out: "mt",
    acceptsMT: true,
    params: [
      { key: "cubiculos", label: "Cubículos", default: 3 },
      { key: "tensao", label: "Tensão", unit: "kV", default: 15 },
    ],
    summary: (p) => `${p.cubiculos} cubículos · ${p.tensao} kV`,
  },
  {
    id: "transformador",
    group: 3,
    label: "Transformador",
    tagPrefix: "TR",
    w: 1.8,
    h: 1.3,
    color: MT,
    symbol: "trafo",
    out: "bt",
    acceptsMT: true,
    params: [
      { key: "potencia", label: "Potência", unit: "kVA", default: 500 },
      { key: "primario", label: "Primário", unit: "kV", default: 13.8 },
      { key: "secundario", label: "Secundário", unit: "V", default: "380/220" },
      { key: "ligacao", label: "Ligação", default: "Δ-Yn", options: ["Δ-Yn", "Y-Yn", "Δ-Δ"] },
      { key: "impedancia", label: "Impedância", unit: "%", default: 5 },
      { key: "tipo", label: "Tipo", default: "a seco", options: ["a seco", "a óleo"] },
    ],
    summary: (p) => `${p.potencia} kVA`,
  },
  // 4) Centro de medição convencional
  {
    id: "cm-convencional",
    group: 4,
    label: "Centro de medição convencional",
    tagPrefix: "CM",
    w: 2.8,
    h: 1,
    color: BT,
    symbol: "mec",
    out: "bt",
    params: [
      { key: "medidores", label: "Medidores", default: 6 },
      { key: "disjuntor", label: "Disjuntor geral", unit: "A", default: 400 },
    ],
    summary: (p) => `${p.medidores} medidores · ${p.disjuntor} A`,
  },
  // 5) Barramento blindado e medição no andar
  {
    id: "barramento",
    group: 5,
    label: "Barramento blindado",
    tagPrefix: "BB",
    w: 0.5,
    h: 6,
    color: BUS,
    symbol: "barramento",
    out: "bt",
    params: [
      { key: "corrente", label: "Corrente nominal", unit: "A", default: 800 },
      { key: "material", label: "Condutor", default: "alumínio", options: ["alumínio", "cobre"] },
    ],
    summary: (p) => `${p.corrente} A`,
  },
  {
    id: "derivacao",
    group: 5,
    label: "Caixa de derivação (cofre)",
    tagPrefix: "CD",
    w: 1.2,
    h: 0.7,
    color: BUS,
    symbol: "derivacao",
    out: "bt",
    params: [{ key: "corrente", label: "Corrente", unit: "A", default: 125 }],
    summary: (p) => `${p.corrente} A`,
  },
  mec(2, "II"),
  mec(4, "IV"),
  mec(6, "VI"),
  mec(9, "IX"),
  mec(12, "XII"),
  // 6) Geradores
  {
    id: "gerador",
    group: 6,
    label: "Grupo gerador",
    tagPrefix: "GMG",
    w: 1.8,
    h: 1.2,
    color: EM,
    symbol: "gerador",
    out: "emergencia",
    source: true,
    params: [
      { key: "potencia", label: "Potência", unit: "kVA", default: 250 },
      { key: "combustivel", label: "Combustível", default: "diesel", options: ["diesel", "gás"] },
    ],
    summary: (p) => `${p.potencia} kVA ${p.combustivel}`,
  },
  {
    id: "qta",
    group: 6,
    label: "QTA (transferência automática)",
    tagPrefix: "QTA",
    w: 1.8,
    h: 0.9,
    color: EM,
    symbol: "qta",
    out: "emergencia",
    params: [{ key: "corrente", label: "Corrente", unit: "A", default: 400 }],
    summary: (p) => `${p.corrente} A`,
  },
  // 7) Painéis fotovoltaicos
  {
    id: "modulos-fv",
    group: 7,
    label: "Módulos fotovoltaicos",
    tagPrefix: "FV",
    w: 2.4,
    h: 1,
    color: FV,
    symbol: "fv",
    out: "fv",
    source: true,
    params: [
      { key: "potencia", label: "Potência", unit: "kWp", default: 60 },
      { key: "modulos", label: "Módulos", default: 110 },
    ],
    summary: (p) => `${p.potencia} kWp · ${p.modulos} módulos`,
  },
  {
    id: "string-box",
    group: 7,
    label: "String box",
    tagPrefix: "SB",
    w: 1.8,
    h: 0.9,
    color: FV,
    symbol: "caixa",
    out: "fv",
    params: [{ key: "tensao", label: "Tensão CC", unit: "V", default: 1000 }],
    summary: (p) => `CC ${p.tensao} V`,
  },
  {
    id: "inversor",
    group: 7,
    label: "Inversor",
    tagPrefix: "INV",
    w: 1.8,
    h: 0.9,
    color: FV,
    symbol: "inversor",
    out: "fv",
    params: [
      { key: "potencia", label: "Potência", unit: "kW", default: 50 },
      { key: "saida", label: "Saída CA", unit: "V", default: 380 },
    ],
    summary: (p) => `${p.potencia} kW · CA ${p.saida} V`,
  },
  // 8) Quadros de iluminação e tomadas
  {
    id: "qgbt",
    group: 8,
    label: "QGBT (quadro geral de baixa tensão)",
    tagPrefix: "QGBT",
    w: 2.6,
    h: 1.3,
    color: BT,
    symbol: "quadro",
    out: "bt",
    board: true,
    params: [
      { key: "corrente", label: "Barramento", unit: "A", default: 1000 },
      { key: "tensao", label: "Tensão", unit: "V", default: "380/220" },
    ],
    summary: (p) => `${p.tensao} V · ${p.corrente} A`,
  },
  {
    id: "qd",
    group: 8,
    label: "Quadro de distribuição (QD / QL / QT)",
    tagPrefix: "QD",
    w: 2,
    h: 0.9,
    color: BT,
    symbol: "quadro",
    out: "bt",
    board: true,
    params: [
      { key: "tipo", label: "Tipo", default: "QD", options: ["QD", "QL", "QT", "QDL", "QDF"] },
      { key: "quantidade", label: "Quantidade (unidades iguais)", default: 1 },
      { key: "uso", label: "Atende", default: "" },
    ],
    summary: (p) => `${p.tipo}${Number(p.quantidade) > 1 ? ` ×${p.quantidade}` : ""}${p.uso ? ` · ${p.uso}` : ""}`,
  },
  // 9) Quadros de motores e bombas
  {
    id: "qfb",
    group: 9,
    label: "Quadro de bombas (QFB)",
    tagPrefix: "QFB",
    w: 2.4,
    h: 0.9,
    color: MOT,
    symbol: "motor",
    out: "bt",
    board: true,
    params: [
      { key: "uso", label: "Bombas", default: "recalque" },
      { key: "potencia", label: "Potência", unit: "cv", default: "2×5" },
    ],
    summary: (p) => `${p.uso} · ${p.potencia} cv`,
  },
  {
    id: "ccm",
    group: 9,
    label: "CCM (centro de controle de motores)",
    tagPrefix: "CCM",
    w: 2.4,
    h: 0.9,
    color: MOT,
    symbol: "motor",
    out: "bt",
    board: true,
    params: [{ key: "potencia", label: "Potência", unit: "kW", default: 30 }],
    summary: (p) => `${p.potencia} kW`,
  },
  {
    id: "elevadores",
    group: 9,
    label: "Quadro de elevadores",
    tagPrefix: "QE",
    w: 2.2,
    h: 0.9,
    color: MOT,
    symbol: "motor",
    out: "bt",
    board: true,
    params: [{ key: "potencia", label: "Potência", unit: "kW", default: "2×15" }],
    summary: (p) => `${p.potencia} kW`,
  },
  // ---- Água fria --------------------------------------------------------------------------
  {
    id: "rede-agua",
    system: "agua-fria",
    group: 1,
    label: "Rede pública (concessionária)",
    tagPrefix: "REDE",
    w: 2.4,
    h: 1,
    color: AF_SRC,
    symbol: "rede",
    out: "abastecimento",
    source: true,
    params: [{ key: "diametro", label: "Ramal predial", unit: "mm", default: 50 }],
    summary: (p) => `ramal Ø${p.diametro} mm`,
  },
  {
    id: "poco",
    system: "agua-fria",
    group: 1,
    label: "Poço artesiano",
    tagPrefix: "POÇO",
    w: 2,
    h: 1,
    color: AF_SRC,
    symbol: "bomba",
    out: "abastecimento",
    source: true,
    params: [{ key: "vazao", label: "Vazão", unit: "m³/h", default: 5 }],
    summary: (p) => `${p.vazao} m³/h`,
  },
  {
    id: "hidrometro-geral",
    system: "agua-fria",
    group: 1,
    label: "Hidrômetro geral (cavalete)",
    tagPrefix: "HG",
    w: 2,
    h: 0.9,
    color: AF_SRC,
    symbol: "hidrometro",
    out: "abastecimento",
    params: [{ key: "diametro", label: "Diâmetro", unit: "mm", default: 50 }],
    summary: (p) => `Ø${p.diametro} mm`,
  },
  {
    id: "cisterna",
    system: "agua-fria",
    group: 2,
    label: "Reservatório inferior (cisterna)",
    tagPrefix: "RI",
    w: 2.6,
    h: 1.3,
    color: AF,
    symbol: "tanque",
    out: "recalque",
    params: [
      { key: "volume", label: "Volume útil", unit: "L", default: 60000 },
      { key: "incendio", label: "Reserva de incêndio", unit: "L", default: 0 },
      { key: "celulas", label: "Células", default: 2 },
    ],
    summary: (p) => `${fmtL(Number(p.volume))}${Number(p.incendio) ? ` + RTI ${fmtL(Number(p.incendio))}` : ""}`,
  },
  {
    id: "bomba-recalque",
    system: "agua-fria",
    group: 3,
    label: "Conjunto motobomba de recalque",
    tagPrefix: "BR",
    w: 2.4,
    h: 1.1,
    color: PUMP,
    symbol: "bomba",
    out: "recalque",
    params: [
      { key: "conjunto", label: "Bombas", default: "1+1 reserva" },
      { key: "vazao", label: "Vazão", unit: "m³/h", default: 10 },
      { key: "hman", label: "Altura manométrica", unit: "mca", default: 40 },
      { key: "potencia", label: "Potência", unit: "cv", default: 5 },
    ],
    summary: (p) => `${p.vazao} m³/h · ${p.hman} mca · ${p.potencia} cv`,
  },
  {
    id: "coluna-recalque",
    system: "agua-fria",
    group: 3,
    label: "Coluna de recalque",
    tagPrefix: "RC",
    w: 0.35,
    h: 6,
    color: PUMP,
    symbol: "coluna",
    out: "recalque",
    params: [{ key: "diametro", label: "Diâmetro", unit: "mm", default: 50 }],
    summary: (p) => `Ø${p.diametro} mm`,
  },
  {
    id: "reservatorio-superior",
    system: "agua-fria",
    group: 4,
    label: "Reservatório superior",
    tagPrefix: "RS",
    w: 2.6,
    h: 1.3,
    color: AF,
    symbol: "tanque",
    out: "agua",
    params: [
      { key: "volume", label: "Volume útil", unit: "L", default: 30000 },
      { key: "incendio", label: "Reserva de incêndio", unit: "L", default: 0 },
      { key: "nivel", label: "Nível d'água acima do piso", unit: "m", default: 1.5 },
      { key: "celulas", label: "Células", default: 2 },
    ],
    summary: (p) => `${fmtL(Number(p.volume))}${Number(p.incendio) ? ` + RTI ${fmtL(Number(p.incendio))}` : ""}`,
  },
  {
    id: "barrilete",
    system: "agua-fria",
    group: 5,
    label: "Barrilete",
    tagPrefix: "BAR",
    w: 2.2,
    h: 0.8,
    color: AF,
    symbol: "caixa",
    out: "agua",
    params: [{ key: "diametro", label: "Diâmetro", unit: "mm", default: 75 }],
    summary: (p) => `Ø${p.diametro} mm`,
  },
  {
    id: "coluna-af",
    system: "agua-fria",
    group: 5,
    label: "Coluna de água fria",
    tagPrefix: "AF",
    w: 0.35,
    h: 6,
    color: AF,
    symbol: "coluna",
    out: "agua",
    params: [{ key: "diametro", label: "Diâmetro", unit: "mm", default: 50 }],
    summary: (p) => `Ø${p.diametro} mm`,
  },
  {
    id: "registro",
    system: "agua-fria",
    group: 5,
    label: "Registro geral",
    tagPrefix: "RG",
    w: 1.4,
    h: 0.8,
    color: AF,
    symbol: "valvula",
    out: "agua",
    params: [{ key: "diametro", label: "Diâmetro", unit: "mm", default: 50 }],
    summary: (p) => `Ø${p.diametro} mm`,
  },
  {
    id: "vrp",
    system: "agua-fria",
    group: 6,
    label: "Estação redutora de pressão (VRP)",
    tagPrefix: "VRP",
    w: 2.2,
    h: 1,
    color: VALVE,
    symbol: "valvula",
    out: "agua",
    params: [
      { key: "saida", label: "Pressão de saída", unit: "mca", default: 20 },
      { key: "diametro", label: "Diâmetro", unit: "mm", default: 50 },
    ],
    summary: (p) => `saída ${p.saida} mca · Ø${p.diametro}`,
  },
  {
    id: "pressurizador",
    system: "agua-fria",
    group: 6,
    label: "Pressurizador (booster)",
    tagPrefix: "PR",
    w: 2.2,
    h: 1,
    color: VALVE,
    symbol: "bomba",
    out: "pressurizada",
    params: [
      { key: "pressao", label: "Pressão de saída", unit: "mca", default: 20 },
      { key: "vazao", label: "Vazão", unit: "m³/h", default: 3 },
    ],
    summary: (p) => `${p.pressao} mca · ${p.vazao} m³/h`,
  },
  {
    id: "abrigo-hidrometros",
    system: "agua-fria",
    group: 7,
    label: "Abrigo de hidrômetros (andar)",
    tagPrefix: "HID",
    w: 2.2,
    h: 0.9,
    color: AF,
    symbol: "hidrometro",
    out: "agua",
    params: [{ key: "hidrometros", label: "Hidrômetros", default: 4 }],
    summary: (p) => `${p.hidrometros} hidrômetros`,
  },
  {
    id: "aptos-af",
    system: "agua-fria",
    group: 8,
    label: "Apartamentos (ramais)",
    tagPrefix: "AP",
    w: 2.2,
    h: 0.9,
    color: AF,
    symbol: "consumo",
    out: "agua",
    sink: true,
    params: [
      { key: "quantidade", label: "Apartamentos", default: 4 },
      { key: "pessoas", label: "Pessoas por apto", default: 4 },
      { key: "percapita", label: "Consumo per capita", unit: "L/dia", default: 200 },
    ],
    summary: (p) => `${p.quantidade} aptos · ${p.pessoas} pessoas`,
  },
  {
    id: "consumo-af",
    system: "agua-fria",
    group: 8,
    label: "Área comum / outros usos",
    tagPrefix: "USO",
    w: 2.2,
    h: 0.9,
    color: AF,
    symbol: "consumo",
    out: "agua",
    sink: true,
    params: [
      { key: "uso", label: "Uso", default: "áreas comuns" },
      { key: "consumo", label: "Consumo", unit: "L/dia", default: 3000 },
    ],
    summary: (p) => `${p.uso} · ${fmtL(Number(p.consumo))}/dia`,
  },
  // Anotação
  {
    id: "texto",
    group: 0,
    label: "Texto",
    tagPrefix: "",
    w: 2.4,
    h: 0.5,
    color: "#334155",
    symbol: "texto",
    out: "bt",
    source: true,
    params: [],
  },
];

/** Tamanhos finais (25% maiores que a base, para leitura na tela e na folha). */
export const FLOW_BLOCKS: FlowBlockDef[] = RAW_BLOCKS.map((b) => (b.symbol === "barramento" || b.symbol === "coluna" || b.symbol === "texto" ? b : { ...b, w: Math.round(b.w * 12.5) / 10, h: Math.round(b.h * 12.5) / 10 }));

export const FLOW_BLOCK_BY_ID: Record<string, FlowBlockDef> = Object.fromEntries(FLOW_BLOCKS.map((b) => [b.id, b]));

export interface FlowBlock {
  id: string;
  kind: string;
  tag: string;
  /** Canto superior esquerdo (unidades de desenho, Y para baixo). */
  x: number;
  y: number;
  /** Altura própria (barramento blindado: vence vários pavimentos). */
  h?: number;
  params: Record<string, string | number>;
  /** Quadro locado no modelo (GlobalId do ponto). */
  pointGuid?: string;
  /** Texto livre (bloco de texto) ou observação. */
  text?: string;
}

export interface FlowLink {
  id: string;
  from: string;
  to: string;
  kind: FlowLinkKind;
  /** Cabo ou barramento (texto livre, ex.: "4×(1×120) mm²"). */
  label?: string;
}

export interface FlowTower {
  id: string;
  name: string;
  /** Largura da coluna (unidades). */
  width: number;
}

export interface FlowData {
  discipline: Discipline;
  /** Sistema (ausente = elétrica). */
  system?: FlowSystem;
  /** Por pavimento (faixas e colunas por torre) ou livre. */
  layout: "pavimentos" | "livre";
  /** Pavimentos de cima para baixo. */
  storeys: string[];
  /** Dados de cada faixa (mesma ordem de `storeys`), vindos do perfil do empreendimento. */
  levels?: FlowLevel[];
  /** Altura padrão das faixas. */
  bandH: number;
  /** Altura própria de cada faixa (mesma ordem de `storeys`; null = padrão). */
  bandHs?: (number | null)[];
  towers: FlowTower[];
  blocks: FlowBlock[];
  links: FlowLink[];
}

/** Faixa de pavimento vinda do perfil do empreendimento. */
export interface FlowLevel {
  /** Nome do pavimento no perfil (sem a repetição). */
  floor: string;
  /** Cota (texto, ex.: "+3,00 a +54,00"). */
  elevation?: string;
  /** Comum a todas as torres. */
  common?: boolean;
  /** Torres que têm o pavimento (quando não é comum). */
  towers?: string[];
  /** Cota do piso (m) em cada torre que tem o pavimento; nos repetidos, do primeiro. */
  z?: Record<string, number>;
  /** Repetidos: cota do piso do último pavimento do grupo, por torre. */
  zTop?: Record<string, number>;
  /** Pavimentos iguais representados pela faixa (tipo ×n). */
  repeat?: number;
}

export const LABEL_W = 3.2;
export const HEADER_H = 1.2;
export const MIN_BAND_H = 1.2;

/** Altura da faixa i (própria ou a padrão). */
export const bandHeight = (f: FlowData, i: number) => f.bandHs?.[i] ?? f.bandH;

/** Topo da faixa i (i = número de faixas dá a base da última). */
export function bandTop(f: FlowData, i: number): number {
  let y = HEADER_H;
  for (let k = 0; k < i; k++) y += bandHeight(f, k);
  return y;
}

export const bandsBottom = (f: FlowData) => bandTop(f, f.storeys.length);

/** Faixa que contém a altura y (−1 fora das faixas). */
export function bandIndexAt(f: FlowData, y: number): number {
  if (y < HEADER_H) return -1;
  let top = HEADER_H;
  for (let i = 0; i < f.storeys.length; i++) {
    const h = bandHeight(f, i);
    if (y < top + h) return i;
    top += h;
  }
  return -1;
}

/**
 * Muda a altura padrão e/ou as alturas próprias das faixas levando os blocos junto: cada
 * bloco fica na mesma faixa, à mesma distância do topo dela (sem passar da base); o
 * barramento acompanha o topo e a base (estica ou encolhe).
 */
export function withBandHeights(f: FlowData, next: { bandH?: number; bandHs?: (number | null)[] }): FlowData {
  const g: FlowData = { ...f, ...(next.bandH != null ? { bandH: next.bandH } : {}), ...(next.bandHs ? { bandHs: next.bandHs } : {}) };
  if (f.layout !== "pavimentos") return g;
  const oldBottom = bandsBottom(f);
  const newBottom = bandsBottom(g);
  const mapY = (y: number) => {
    const i = bandIndexAt(f, y);
    if (i < 0) return y < HEADER_H ? y : y + (newBottom - oldBottom);
    const off = y - bandTop(f, i);
    return bandTop(g, i) + Math.max(0, Math.min(off, bandHeight(g, i)));
  };
  const r1 = (v: number) => Math.round(v * 100) / 100;
  const blocks = f.blocks.map((b) => {
    const r = blockRect(b);
    if (isBus(b)) {
      const top = mapY(r.y);
      const bottom = mapY(r.y + r.h - 1e-6);
      return { ...b, y: r1(top), h: r1(Math.max(1, bottom - top)) };
    }
    // Bloco comum: segue a faixa do seu centro.
    const i = bandIndexAt(f, r.y + r.h / 2);
    if (i < 0) {
      const y = r.y >= oldBottom ? r1(r.y + newBottom - oldBottom) : b.y;
      return y === b.y ? b : { ...b, y };
    }
    const off = r.y - bandTop(f, i);
    const y = r1(bandTop(g, i) + Math.min(off, Math.max(0, bandHeight(g, i) - r.h)));
    return y === b.y ? b : { ...b, y };
  });
  return { ...g, blocks };
}

export function newFlow(discipline: Discipline, storeysBottomUp: string[], profile?: BuildingProfile | null, system?: FlowSystem): FlowData {
  const base: FlowData = {
    discipline,
    ...(system ? { system } : {}),
    layout: "pavimentos",
    storeys: [...storeysBottomUp].reverse(),
    bandH: 3,
    towers: [{ id: "t1", name: "Torre A", width: 16 }],
    blocks: [],
    links: [],
  };
  return profile?.floors.length ? applyProfile(base, profile) : base;
}

/** X inicial da coluna de cada torre. */
export function towerX0(f: FlowData): Map<string, number> {
  const m = new Map<string, number>();
  let x = LABEL_W;
  for (const t of f.towers) (m.set(t.id, x), (x += t.width));
  return m;
}

/** A torre tem o pavimento da faixa i? (sem dados do perfil: sim) */
export function levelHasTower(f: FlowData, i: number, towerId: string): boolean {
  const lv = f.levels?.[i];
  if (!lv || lv.common || !lv.towers) return true;
  return lv.towers.includes(towerId);
}

/**
 * Faixas e colunas a partir do perfil do empreendimento. Os blocos já desenhados ficam no
 * mesmo pavimento (pelo nome) e na mesma torre (pelo id), na mesma posição dentro da célula.
 */
export function applyProfile(f: FlowData, p: BuildingProfile): FlowData {
  const byTower = floorElevationsByTower(p);
  const topDown = p.floors.map((fl, i) => ({ fl, i })).reverse();
  const storeys = topDown.map(({ fl }) => floorLabel(fl));
  const levels: FlowLevel[] = topDown.map(({ fl, i }) => {
    const z: Record<string, number> = {};
    const zTop: Record<string, number> = {};
    for (const t of p.towers) {
      const e = byTower[t.id]?.[i];
      if (e == null) continue;
      z[t.id] = e;
      zTop[t.id] = Math.round((e + fl.height * (Math.max(1, fl.repeat) - 1)) * 1000) / 1000;
    }
    return { floor: fl.name, elevation: floorElevText(p, i), common: fl.common, towers: fl.common ? undefined : [...fl.towers], z, zTop, repeat: Math.max(1, fl.repeat) };
  });
  const oldWidth = new Map(f.towers.map((t) => [t.id, t.width]));
  const towers: FlowTower[] = p.towers.map((t) => ({ id: t.id, name: t.name, width: oldWidth.get(t.id) ?? 16 }));
  // A altura própria de cada faixa segue o pavimento (pelo nome).
  const oldH = new Map<string, number>();
  f.storeys.forEach((s, i) => {
    const h = f.bandHs?.[i];
    if (h == null) return;
    oldH.set(s, h);
    if (f.levels?.[i]?.floor) oldH.set(f.levels[i].floor, h);
  });
  const bandHs = oldH.size ? storeys.map((s, i) => oldH.get(s) ?? oldH.get(levels[i].floor) ?? null) : undefined;
  const next: FlowData = { ...f, storeys, levels, towers, bandHs };
  if (f.layout !== "pavimentos") return next;
  const oldX0 = towerX0(f);
  const newX0 = towerX0(next);
  const indexOf = (name: string | null) => {
    if (!name) return -1;
    const i = storeys.indexOf(name);
    if (i >= 0) return i;
    const base = f.levels?.[f.storeys.indexOf(name)]?.floor ?? name;
    return levels.findIndex((l) => l.floor === base || l.floor === name);
  };
  const blocks = f.blocks.map((b) => {
    const r = blockRect(b);
    // Barramento: pela faixa do topo; demais: pela faixa do centro.
    const refY = isBus(b) ? r.y + 0.01 : r.y + r.h / 2;
    const oi = bandIndexAt(f, refY);
    const ni = oi >= 0 ? indexOf(f.storeys[oi]) : -1;
    let { x, y } = b;
    if (ni >= 0) y = Math.round((bandTop(next, ni) + (b.y - bandTop(f, oi))) * 10) / 10;
    const t = towerAt(f, r.x + r.w / 2);
    if (t && newX0.has(t.id)) x = Math.round((newX0.get(t.id)! + (b.x - oldX0.get(t.id)!)) * 10) / 10;
    return x === b.x && y === b.y ? b : { ...b, x, y };
  });
  return { ...next, blocks };
}

let seq = 0;
export const newFlowId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---- Geometria ------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function blockRect(b: FlowBlock): Rect {
  const d = FLOW_BLOCK_BY_ID[b.kind];
  return { x: b.x, y: b.y, w: d?.w ?? 2, h: b.h ?? d?.h ?? 1 };
}

/** Elemento vertical que vence pavimentos (barramento blindado, coluna de água). */
export const isBus = (b: FlowBlock | undefined) => {
  const s = b && FLOW_BLOCK_BY_ID[b.kind]?.symbol;
  return s === "barramento" || s === "coluna";
};
/** Barramento blindado (regras das caixas de medição). */
export const isBusway = (b: FlowBlock | undefined) => b?.kind === "barramento";

export const flowSystem = (f: FlowData): FlowSystem => f.system ?? (f.discipline === "hidraulica" ? "agua-fria" : "eletrica");

/** Faixa (pavimento) e coluna (torre) que contêm o ponto; null fora delas ou no modo livre. */
export function bandAt(f: FlowData, y: number): string | null {
  if (f.layout !== "pavimentos") return null;
  const i = bandIndexAt(f, y);
  return i >= 0 ? f.storeys[i] : null;
}

export function towerAt(f: FlowData, x: number): FlowTower | null {
  if (f.layout !== "pavimentos") return null;
  let x0 = LABEL_W;
  for (const t of f.towers) {
    if (x >= x0 && x < x0 + t.width) return t;
    x0 += t.width;
  }
  return null;
}

export const blockStorey = (f: FlowData, b: FlowBlock) => bandAt(f, b.y + blockRect(b).h / 2);
export const blockTower = (f: FlowData, b: FlowBlock) => towerAt(f, b.x + blockRect(b).w / 2);

/** Pavimentos que o barramento atravessa (do topo à base do bloco). */
export function busStoreys(f: FlowData, b: FlowBlock): string[] {
  const r = blockRect(b);
  return f.storeys.filter((_, i) => {
    const y0 = bandTop(f, i);
    return r.y < y0 + bandHeight(f, i) - 0.05 && r.y + r.h > y0 + 0.05;
  });
}

export function flowWidth(f: FlowData): number {
  const blocksX = Math.max(0, ...f.blocks.map((b) => b.x + blockRect(b).w + 1));
  return Math.max(LABEL_W + f.towers.reduce((s, t) => s + t.width, 0), blocksX);
}

/** Pontos da ligação (ortogonal), da saída do bloco de origem à entrada do destino. */
export function linkPath(a: FlowBlock, b: FlowBlock): P2[] {
  const ra = blockRect(a);
  const rb = blockRect(b);
  const cy = (r: Rect) => r.y + r.h / 2;
  const cx = (r: Rect) => r.x + r.w / 2;
  const clampY = (bus: Rect, y: number) => Math.max(bus.y + 0.2, Math.min(bus.y + bus.h - 0.2, y));
  // Barramento: a ligação sai ou chega na altura do outro bloco (derivação no andar).
  if (isBus(a) || isBus(b)) {
    const busR = isBus(a) ? ra : rb;
    const other = isBus(a) ? rb : ra;
    const y = clampY(busR, cy(other));
    const right = cx(other) > cx(busR);
    const busPt: P2 = [right ? busR.x + busR.w : busR.x, y];
    const otherPt: P2 = [right ? other.x : other.x + other.w, cy(other)];
    const mx = (busPt[0] + otherPt[0]) / 2;
    const path: P2[] = Math.abs(y - cy(other)) < 1e-6 ? [busPt, otherPt] : [busPt, [mx, y], [mx, cy(other)], otherPt];
    return isBus(a) ? path : path.reverse();
  }
  const gap = 0.2;
  if (rb.x >= ra.x + ra.w + gap || rb.x + rb.w <= ra.x - gap) {
    const toRight = rb.x >= ra.x + ra.w + gap;
    const s: P2 = [toRight ? ra.x + ra.w : ra.x, cy(ra)];
    const e: P2 = [toRight ? rb.x : rb.x + rb.w, cy(rb)];
    if (Math.abs(s[1] - e[1]) < 1e-6) return [s, e];
    const mx = (s[0] + e[0]) / 2;
    return [s, [mx, s[1]], [mx, e[1]], e];
  }
  const down = cy(rb) > cy(ra);
  const s: P2 = [cx(ra), down ? ra.y + ra.h : ra.y];
  const e: P2 = [cx(rb), down ? rb.y : rb.y + rb.h];
  if (Math.abs(s[0] - e[0]) < 1e-6) return [s, e];
  const my = (s[1] + e[1]) / 2;
  return [s, [s[0], my], [e[0], my], e];
}

/** Tipo da ligação pelo bloco de origem (média tensão até o transformador, etc.). */
export function defaultLinkKind(from: FlowBlock, to: FlowBlock): FlowLinkKind {
  const d = FLOW_BLOCK_BY_ID[from.kind];
  if (d?.system === "agua-fria") return d.out;
  if (isBus(from) || isBus(to)) return d?.out === "emergencia" ? "emergencia" : "bt";
  if (d?.out === "mt" && !FLOW_BLOCK_BY_ID[to.kind]?.acceptsMT) return "mt";
  return d?.out ?? "bt";
}

// ---- Desenho (primitivas: planta/folha/DXF) ---------------------------------------------------

const light = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
  const m = (v: number) => Math.round(v + (255 - v) * 0.9);
  return `#${[m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** Altura de texto: mm de papel → unidades de desenho (1:100; as primitivas usam a unidade do desenho). */
const mm = (v: number) => v * 0.1;

/** Y para cima nas primitivas. */
const P = (x: number, y: number): P2 => [x, -y];

function symbolPrims(d: FlowBlockDef, r: Rect, layer: string, id?: number): Prim[] {
  const c = d.color;
  const out: Prim[] = [];
  const sx = r.x + 0.5;
  const sy = r.y + r.h / 2;
  const line = (a: P2, b: P2, w = 0.25): Prim => ({ t: "line", a: P(...a), b: P(...b), weight: w, color: c, layer, id });
  switch (d.symbol) {
    case "rede":
      out.push({ t: "poly", pts: [P(sx - 0.25, sy + 0.25), P(sx, sy - 0.25), P(sx + 0.25, sy + 0.25)], closed: false, weight: 0.3, color: c, layer, id });
      out.push(line([sx - 0.12, sy], [sx + 0.12, sy]));
      break;
    case "trafo":
      out.push({ t: "circle", c: P(r.x + r.w / 2 - 0.18, r.y + 0.45), r: 0.3, weight: 0.35, color: MT, layer, id });
      out.push({ t: "circle", c: P(r.x + r.w / 2 + 0.18, r.y + 0.45), r: 0.3, weight: 0.35, color: BT, layer, id });
      break;
    case "gerador":
      out.push({ t: "circle", c: P(sx, sy), r: 0.3, weight: 0.35, color: c, layer, id });
      out.push({ t: "poly", pts: [P(sx - 0.18, sy), P(sx - 0.09, sy - 0.1), P(sx, sy), P(sx + 0.09, sy + 0.1), P(sx + 0.18, sy)], closed: false, weight: 0.25, color: c, layer, id });
      break;
    case "painel":
      for (let k = 0; k < 4; k++) out.push(line([r.x + 0.3 + k * 0.25, r.y + 0.2], [r.x + 0.3 + k * 0.25, r.y + 0.65], 0.18));
      break;
    case "mec":
    case "medicao":
      for (let k = 0; k < 3; k++) out.push(line([sx - 0.18, r.y + 0.22 + k * 0.18], [sx + 0.12, r.y + 0.22 + k * 0.18], 0.3));
      break;
    case "quadro":
      out.push({ t: "poly", pts: [P(sx - 0.18, sy - 0.25), P(sx + 0.18, sy - 0.25), P(sx + 0.18, sy + 0.25), P(sx - 0.18, sy + 0.25)], closed: true, weight: 0.25, color: c, layer, id });
      out.push({ t: "poly", pts: [P(sx - 0.18, sy - 0.25), P(sx + 0.18, sy - 0.25), P(sx + 0.18, sy + 0.25)], closed: true, weight: 0.1, fill: c, color: c, layer, id });
      break;
    case "qta":
      out.push(line([sx - 0.2, sy - 0.15], [sx + 0.2, sy - 0.15]));
      out.push(line([sx - 0.2, sy + 0.15], [sx + 0.2, sy + 0.15]));
      out.push(line([sx + 0.2, sy - 0.15], [sx - 0.05, sy + 0.15]));
      break;
    case "fv":
      for (let k = 0; k < 2; k++)
        out.push({ t: "poly", pts: [P(sx - 0.3 + k * 0.32, sy - 0.18), P(sx - 0.05 + k * 0.32, sy - 0.18), P(sx - 0.12 + k * 0.32, sy + 0.18), P(sx - 0.37 + k * 0.32, sy + 0.18)], closed: true, weight: 0.2, color: c, layer, id });
      break;
    case "inversor":
      out.push({ t: "poly", pts: [P(sx - 0.25, sy - 0.25), P(sx + 0.25, sy - 0.25), P(sx + 0.25, sy + 0.25), P(sx - 0.25, sy + 0.25)], closed: true, weight: 0.2, color: c, layer, id });
      out.push(line([sx - 0.25, sy + 0.25], [sx + 0.25, sy - 0.25], 0.15));
      break;
    case "motor":
      out.push({ t: "circle", c: P(sx, sy), r: 0.27, weight: 0.3, color: c, layer, id });
      out.push({ t: "text", p: P(sx, sy + 0.1), text: "M", height: mm(2.2), anchor: "middle", color: c, layer, id });
      break;
    case "derivacao":
      break;
    case "tanque":
      out.push({ t: "poly", pts: [P(sx - 0.3, sy - 0.3), P(sx + 0.3, sy - 0.3), P(sx + 0.3, sy + 0.3), P(sx - 0.3, sy + 0.3)], closed: true, weight: 0.25, color: c, layer, id });
      out.push({ t: "poly", pts: [P(sx - 0.3, sy - 0.02), P(sx + 0.3, sy - 0.02), P(sx + 0.3, sy + 0.3), P(sx - 0.3, sy + 0.3)], closed: true, weight: 0.05, fill: "#7dd3fc", color: c, layer, id });
      break;
    case "bomba":
      out.push({ t: "circle", c: P(sx, sy), r: 0.28, weight: 0.3, color: c, layer, id });
      out.push({ t: "poly", pts: [P(sx - 0.12, sy - 0.2), P(sx + 0.2, sy), P(sx - 0.12, sy + 0.2)], closed: true, weight: 0.1, fill: c, color: c, layer, id });
      break;
    case "valvula":
      out.push({ t: "poly", pts: [P(sx - 0.28, sy - 0.18), P(sx + 0.28, sy + 0.18), P(sx + 0.28, sy - 0.18), P(sx - 0.28, sy + 0.18)], closed: true, weight: 0.25, color: c, layer, id });
      out.push(line([sx, sy], [sx, sy - 0.3], 0.2));
      break;
    case "hidrometro":
      out.push({ t: "circle", c: P(sx, sy), r: 0.26, weight: 0.3, color: c, layer, id });
      out.push({ t: "text", p: P(sx, sy + 0.02), text: "H", height: mm(2.2), anchor: "middle", color: c, layer, id });
      break;
    case "consumo":
      out.push({ t: "poly", pts: [P(sx - 0.25, sy + 0.25), P(sx - 0.25, sy - 0.05), P(sx, sy - 0.28), P(sx + 0.25, sy - 0.05), P(sx + 0.25, sy + 0.25)], closed: true, weight: 0.25, color: c, layer, id });
      break;
    case "caixa":
      out.push({ t: "poly", pts: [P(sx - 0.2, sy - 0.2), P(sx + 0.2, sy - 0.2), P(sx + 0.2, sy + 0.2), P(sx - 0.2, sy + 0.2)], closed: true, weight: 0.2, color: c, layer, id });
      out.push(line([sx - 0.2, sy - 0.2], [sx + 0.2, sy + 0.2], 0.12));
      out.push(line([sx - 0.2, sy + 0.2], [sx + 0.2, sy - 0.2], 0.12));
      break;
    default:
      break;
  }
  return out;
}

export interface FlowDrawOptions {
  /** Id numérico de cena por bloco (para seleção no editor). */
  idOf?: (blockId: string) => number | undefined;
  /** Legenda das ligações. */
  legend?: boolean;
}

/** Desenho do fluxograma em primitivas (Y para cima), para a tela, as folhas, o PDF e o DXF. */
export function flowPrims(f: FlowData, opt: FlowDrawOptions = {}): Prim[] {
  const out: Prim[] = [];
  const W = flowWidth(f);
  if (f.layout === "pavimentos" && f.storeys.length) {
    const H = bandsBottom(f);
    // Colunas por torre (nomes no topo)
    const x0s = towerX0(f);
    for (const t of f.towers)
      out.push({ t: "text", p: P(x0s.get(t.id)! + t.width / 2, HEADER_H * 0.6), text: t.name.toUpperCase(), height: mm(4), anchor: "middle", color: "#334155", layer: "FLUXO-FAIXAS" });
    f.storeys.forEach((s, i) => {
      const y0 = bandTop(f, i);
      const bh = bandHeight(f, i);
      const lv = f.levels?.[i];
      if (i % 2 === 0) out.push({ t: "poly", pts: [P(0, y0), P(W, y0), P(W, y0 + bh), P(0, y0 + bh)], closed: true, weight: 0, fill: "#f4f6f9", color: "#f4f6f9", layer: "FLUXO-FAIXAS" });
      // Pavimento que uma torre não tem: célula cinza.
      for (const t of f.towers) {
        if (levelHasTower(f, i, t.id)) continue;
        const x0 = x0s.get(t.id)!;
        out.push({ t: "poly", pts: [P(x0, y0), P(x0 + t.width, y0), P(x0 + t.width, y0 + bh), P(x0, y0 + bh)], closed: true, weight: 0, fill: "#e5e7eb", color: "#e5e7eb", layer: "FLUXO-FAIXAS" });
        out.push({ t: "text", p: P(x0 + t.width / 2, y0 + bh / 2), text: `${t.name} não tem este pavimento`, height: mm(2.2), anchor: "middle", color: "#94a3b8", layer: "FLUXO-FAIXAS" });
      }
      // Divisas entre torres: só nos pavimentos que não são comuns.
      if (!lv?.common) for (const t of f.towers.slice(0, -1)) {
        const x = x0s.get(t.id)! + t.width;
        out.push({ t: "line", a: P(x, y0), b: P(x, y0 + bh), weight: 0.18, color: "#94a3b8", layer: "FLUXO-FAIXAS", dashed: true });
      }
      out.push({ t: "text", p: P(0.25, y0 + 0.55), text: s.toUpperCase(), height: mm(3), anchor: "start", color: "#334155", layer: "FLUXO-FAIXAS" });
      if (lv?.elevation) out.push({ t: "text", p: P(0.25, y0 + 0.95), text: lv.elevation, height: mm(2.4), anchor: "start", color: "#64748b", layer: "FLUXO-FAIXAS" });
      if (lv?.common && f.towers.length > 1) out.push({ t: "text", p: P(0.25, y0 + 1.3), text: "comum às torres", height: mm(2.2), anchor: "start", color: "#0e7490", layer: "FLUXO-FAIXAS" });
      out.push({ t: "line", a: P(0, y0), b: P(W, y0), weight: 0.13, color: "#cbd5e1", layer: "FLUXO-FAIXAS", dashed: true });
    });
    out.push({ t: "line", a: P(0, H), b: P(W, H), weight: 0.13, color: "#cbd5e1", layer: "FLUXO-FAIXAS", dashed: true });
    out.push({ t: "line", a: P(LABEL_W, HEADER_H), b: P(LABEL_W, H), weight: 0.13, color: "#cbd5e1", layer: "FLUXO-FAIXAS" });
  }
  const byId = new Map(f.blocks.map((b) => [b.id, b]));
  // Ligações (por baixo dos blocos)
  for (const l of f.links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;
    const st = LINK_STYLE[l.kind];
    const pts = linkPath(a, b);
    out.push({ t: "poly", pts: pts.map((q) => P(...q)), closed: false, weight: st.weight, color: st.color, layer: `FLUXO-LIG-${l.kind.toUpperCase()}`, dashed: st.dashed });
    // Seta na chegada
    const [p1, p2] = [pts[pts.length - 2], pts[pts.length - 1]];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
    const u = [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len];
    const k = 0.22;
    out.push({
      t: "poly",
      pts: [P(p2[0], p2[1]), P(p2[0] - u[0] * k - u[1] * k * 0.55, p2[1] - u[1] * k + u[0] * k * 0.55), P(p2[0] - u[0] * k + u[1] * k * 0.55, p2[1] - u[1] * k - u[0] * k * 0.55)],
      closed: true,
      weight: 0.1,
      fill: st.color,
      color: st.color,
      layer: `FLUXO-LIG-${l.kind.toUpperCase()}`,
    });
    if (l.label) {
      // Rótulo no trecho mais longo
      let best = 0;
      let bl = -1;
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        if (d > bl) ((bl = d), (best = i));
      }
      const [s, e] = [pts[best], pts[best + 1]];
      const vertical = Math.abs(e[0] - s[0]) < 1e-6;
      // Rótulo que não cabe no trecho fica só nas propriedades (não encavala nos blocos).
      if (bl < l.label.length * mm(2.1) * 0.6 + 0.3) continue;
      out.push({
        t: "text",
        p: P((s[0] + e[0]) / 2 + (vertical ? -0.12 : 0), (s[1] + e[1]) / 2 - (vertical ? 0 : 0.12)),
        text: l.label,
        height: mm(2.1),
        anchor: "middle",
        angle: vertical ? Math.PI / 2 : 0,
        color: "#475569",
        layer: "FLUXO-TEXTOS",
      });
    }
  }
  // Blocos
  for (const b of f.blocks) {
    const d = FLOW_BLOCK_BY_ID[b.kind];
    if (!d) continue;
    const r = blockRect(b);
    const id = opt.idOf?.(b.id);
    const layer = `FLUXO-${d.group ? `G${d.group}` : "TEXTO"}`;
    if (d.symbol === "texto") {
      out.push({ t: "text", p: P(r.x, r.y + r.h * 0.7), text: b.text || "Texto", height: mm(2.5), anchor: "start", color: d.color, layer, id });
      continue;
    }
    if (d.symbol === "coluna") {
      out.push({ t: "line", a: P(r.x + r.w / 2, r.y), b: P(r.x + r.w / 2, r.y + r.h), weight: 0.7, color: d.color, layer, id });
      out.push({ t: "circle", c: P(r.x + r.w / 2, r.y), r: 0.09, weight: 0.3, fill: d.color, color: d.color, layer, id });
      out.push({ t: "text", p: P(r.x - 0.15, r.y + r.h / 2), text: `${b.tag} · ${d.summary?.(b.params) ?? ""}`, height: mm(2.4), anchor: "middle", angle: Math.PI / 2, color: d.color, layer, id });
      continue;
    }
    if (d.symbol === "barramento") {
      out.push({ t: "poly", pts: [P(r.x, r.y), P(r.x + r.w, r.y), P(r.x + r.w, r.y + r.h), P(r.x, r.y + r.h)], closed: true, weight: 0.5, fill: "#fff7ed", color: d.color, layer, id });
      out.push({ t: "line", a: P(r.x + r.w / 2, r.y + 0.1), b: P(r.x + r.w / 2, r.y + r.h - 0.1), weight: 0.25, color: d.color, layer, id });
      out.push({ t: "text", p: P(r.x - 0.15, r.y + r.h / 2), text: `${b.tag} · ${d.summary?.(b.params) ?? ""}`, height: mm(2.4), anchor: "middle", angle: Math.PI / 2, color: "#9a3412", layer, id });
      continue;
    }
    out.push({ t: "poly", pts: [P(r.x, r.y), P(r.x + r.w, r.y), P(r.x + r.w, r.y + r.h), P(r.x, r.y + r.h)], closed: true, weight: d.symbol === "quadro" && b.kind === "qgbt" ? 0.5 : 0.35, fill: light(d.color), color: d.color, layer, id });
    if (d.symbol === "derivacao") out.push({ t: "poly", pts: [P(r.x, r.y), P(r.x + 0.35, r.y), P(r.x + 0.35, r.y + r.h), P(r.x, r.y + r.h)], closed: true, weight: 0.1, fill: d.color, color: d.color, layer, id });
    out.push(...symbolPrims(d, r, layer, id));
    const tx = d.symbol === "trafo" ? r.x + r.w / 2 : r.x + 0.9 + (r.w - 0.9) / 2;
    const ty = d.symbol === "trafo" ? r.y + r.h - 0.55 : r.y + r.h / 2 - 0.08;
    out.push({ t: "text", p: P(tx, ty), text: b.tag, height: mm(3.2), anchor: "middle", color: d.color, layer, id });
    const sub = d.summary?.(b.params);
    if (sub) out.push({ t: "text", p: P(tx, ty + 0.36), text: sub, height: mm(2.1), anchor: "middle", color: "#475569", layer, id });
  }
  if (opt.legend && f.links.length) {
    const kinds = [...new Set(f.links.map((l) => l.kind))];
    const H = f.layout === "pavimentos" ? bandsBottom(f) : Math.max(0, ...f.blocks.map((b) => b.y + blockRect(b).h));
    let x = 0.3;
    const y = H + 0.7;
    for (const k of kinds) {
      const st = LINK_STYLE[k];
      out.push({ t: "line", a: P(x, y), b: P(x + 1, y), weight: st.weight, color: st.color, layer: "FLUXO-LEGENDA", dashed: st.dashed });
      out.push({ t: "text", p: P(x + 1.2, y + 0.06), text: LINK_LABEL[k], height: mm(2.4), anchor: "start", color: "#334155", layer: "FLUXO-LEGENDA" });
      x += 1.8 + LINK_LABEL[k].length * 0.17;
    }
  }
  return out;
}

// ---- Conferência (regras e modelo) ----------------------------------------------------------

export type IssueLevel = "erro" | "aviso" | "info";

export interface FlowIssue {
  level: IssueLevel;
  text: string;
  blockId?: string;
  /** Ação sugerida: locar o quadro no modelo, ou vincular ao quadro de mesma etiqueta. */
  action?: { kind: "locar"; blockId: string } | { kind: "vincular"; blockId: string; pointGuid: string };
}

/** Quadro locado no modelo, com a carga dos circuitos dele. */
export interface ModelBoard {
  guid: string;
  tag: string;
  storey: string | null;
  /** Carga instalada dos circuitos do quadro (VA). */
  loadVA: number;
}

export interface FlowContext {
  boards: ModelBoard[];
}

/** Blocos alimentados por um bloco (a jusante, sem repetir). */
export function downstream(f: FlowData, fromId: string): FlowBlock[] {
  const byId = new Map(f.blocks.map((b) => [b.id, b]));
  const seen = new Set<string>([fromId]);
  const out: FlowBlock[] = [];
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const l of f.links) {
      if (l.from !== id || seen.has(l.to)) continue;
      seen.add(l.to);
      const b = byId.get(l.to);
      if (b) (out.push(b), stack.push(b.id));
    }
  }
  return out;
}

/** Quadro do modelo representado pelo bloco (vínculo explícito ou mesma etiqueta). */
export function boardOf(b: FlowBlock, ctx: FlowContext): ModelBoard | undefined {
  if (b.pointGuid) return ctx.boards.find((x) => x.guid === b.pointGuid);
  return undefined;
}

/** Carga a jusante (VA) somada dos quadros vinculados ao modelo. */
export function downstreamLoad(f: FlowData, blockId: string, ctx: FlowContext): { va: number; boards: number } {
  const self = f.blocks.find((b) => b.id === blockId);
  const list = [...(self ? [self] : []), ...downstream(f, blockId)];
  let va = 0;
  let boards = 0;
  const seen = new Set<string>();
  for (const b of list) {
    const m = boardOf(b, ctx);
    if (!m || seen.has(m.guid)) continue;
    seen.add(m.guid);
    va += m.loadVA * Math.max(1, Number(b.params.quantidade) || 1);
    boards++;
  }
  return { va, boards };
}

const MEC_KINDS = new Set(["mec-ii", "mec-iv", "mec-vi", "mec-ix", "mec-xii"]);
export const isMec = (b: FlowBlock | undefined): b is FlowBlock => !!b && MEC_KINDS.has(b.kind);

// ---- Água fria: cotas, pressões e reservação -------------------------------------------------------

/** Cotas do piso (m) do pavimento do bloco, pela faixa e torre: do primeiro e do último (repetidos). */
export function blockZ(f: FlowData, b: FlowBlock): { low: number; high: number } | null {
  const r = blockRect(b);
  const i = bandIndexAt(f, r.y + r.h / 2);
  const lv = i >= 0 ? f.levels?.[i] : undefined;
  if (!lv?.z) return null;
  const t = blockTower(f, b);
  const pick = (m?: Record<string, number>) => (m ? (t && m[t.id] != null ? m[t.id] : Object.values(m)[0]) : undefined);
  const low = pick(lv.z);
  if (low == null) return null;
  return { low, high: pick(lv.zTop) ?? low };
}

/** Pavimentos iguais que o bloco representa (faixa "tipo ×n"). */
export const blockRepeat = (f: FlowData, b: FlowBlock) => {
  const r = blockRect(b);
  const i = bandIndexAt(f, r.y + r.h / 2);
  return Math.max(1, (i >= 0 ? f.levels?.[i]?.repeat : 1) ?? 1);
};

/** Altura do chuveiro acima do piso, para a pressão mínima (m). */
export const SHOWER_H = 2.0;
/** Limites da NBR 5626: estática máxima 40 mca; mínima nos pontos 1 mca. */
export const P_MAX = 40;
export const P_MIN = 1;

/** Cota piezométrica (m) que cada bloco recebe: reservatório superior, VRP ou pressurizador a montante. */
export function waterHeads(f: FlowData): Map<string, { head: number; from: string }> {
  const byId = new Map(f.blocks.map((b) => [b.id, b]));
  const heads = new Map<string, { head: number; from: string }>();
  const own = (b: FlowBlock): number | null => {
    const z = blockZ(f, b);
    if (!z) return null;
    if (b.kind === "reservatorio-superior") return z.low + (Number(b.params.nivel) || 0);
    if (b.kind === "vrp") return z.low + (Number(b.params.saida) || 0);
    if (b.kind === "pressurizador") return z.low + (Number(b.params.pressao) || 0);
    return null;
  };
  const setters = f.blocks.filter((b) => b.kind === "reservatorio-superior" || b.kind === "vrp" || b.kind === "pressurizador");
  const queue: string[] = [];
  for (const b of setters) {
    const h = own(b);
    if (h == null) continue;
    heads.set(b.id, { head: h, from: b.id });
    queue.push(b.id);
  }
  while (queue.length) {
    const id = queue.shift()!;
    const h = heads.get(id)!;
    for (const l of f.links) {
      if (l.from !== id) continue;
      const c = byId.get(l.to);
      if (!c || heads.has(c.id)) continue;
      if (c.kind === "reservatorio-superior" || c.kind === "vrp" || c.kind === "pressurizador" || c.kind === "cisterna" || c.kind === "bomba-recalque" || c.kind === "coluna-recalque") continue;
      heads.set(c.id, h);
      queue.push(c.id);
    }
  }
  return heads;
}

/** Pressões estáticas no pavimento do bloco (mca): máxima no piso do mais baixo, mínima no chuveiro do mais alto. */
export function waterPressure(f: FlowData, b: FlowBlock, heads = waterHeads(f)): { max: number; min: number; head: number; from: string } | null {
  const h = heads.get(b.id);
  const z = blockZ(f, b);
  if (!h || !z) return null;
  return { max: h.head - z.low, min: h.head - (z.high + SHOWER_H), head: h.head, from: h.from };
}

/** Consumo diário (L) dos blocos de consumo e volume das reservações. */
export function waterBalance(f: FlowData): { consumo: number; inferior: number; superior: number; dias: number } {
  let consumo = 0;
  let inferior = 0;
  let superior = 0;
  for (const b of f.blocks) {
    const n = blockRepeat(f, b);
    if (b.kind === "aptos-af") consumo += n * (Number(b.params.quantidade) || 0) * (Number(b.params.pessoas) || 0) * (Number(b.params.percapita) || 0);
    else if (b.kind === "consumo-af") consumo += n * (Number(b.params.consumo) || 0);
    else if (b.kind === "cisterna") inferior += Number(b.params.volume) || 0;
    else if (b.kind === "reservatorio-superior") superior += Number(b.params.volume) || 0;
  }
  return { consumo, inferior, superior, dias: consumo > 0 ? (inferior + superior) / consumo : 0 };
}

const mca = (v: number) => `${v.toFixed(1).replace(".", ",")} mca`;

function checkWater(f: FlowData, issues: FlowIssue[], tag: (b: FlowBlock) => string) {
  const byId = new Map(f.blocks.map((b) => [b.id, b]));
  const outgoing = (id: string) => f.links.filter((l) => l.from === id);
  const hasZ = !!f.levels?.some((l) => l.z && Object.keys(l.z).length);
  const heads = waterHeads(f);
  if (!hasZ && f.blocks.some((b) => FLOW_BLOCK_BY_ID[b.kind]?.sink))
    issues.push({ level: "info", text: "Sem as cotas do perfil do empreendimento as pressões não são calculadas: aplique o perfil (Propriedades › Pavimentos › do perfil)." });
  // Pressões estáticas nos pontos de consumo e nos abrigos de hidrômetros.
  for (const b of f.blocks) {
    if (!(FLOW_BLOCK_BY_ID[b.kind]?.sink || b.kind === "abrigo-hidrometros")) continue;
    const p = waterPressure(f, b, heads);
    if (!p) continue;
    const where = blockStorey(f, b) ?? "";
    if (p.max > P_MAX)
      issues.push({ level: "aviso", text: `${tag(b)} (${where}): pressão estática de ${mca(p.max)} no piso passa de ${P_MAX} mca (NBR 5626). Use válvula redutora de pressão (VRP) a montante.`, blockId: b.id });
    if (p.min < P_MIN)
      issues.push({ level: "aviso", text: `${tag(b)} (${where}): pressão estática de ${mca(p.min)} no chuveiro, abaixo de ${P_MIN} mca. Use pressurizador ou eleve o reservatório.`, blockId: b.id });
  }
  // Abrigo de hidrômetros: unidades atendidas x hidrômetros.
  for (const b of f.blocks.filter((x) => x.kind === "abrigo-hidrometros")) {
    const cap = Number(b.params.hidrometros) || 0;
    const units = outgoing(b.id).reduce((sum, l) => {
      const t = byId.get(l.to);
      return sum + (t?.kind === "aptos-af" ? Number(t.params.quantidade) || 0 : t ? 1 : 0);
    }, 0);
    if (cap && units > cap) issues.push({ level: "erro", text: `${tag(b)}: ${units} unidades atendidas, mas o abrigo tem ${cap} hidrômetros.`, blockId: b.id });
  }
  // Coluna: as derivações têm de estar nos pavimentos que ela alcança.
  if (f.layout === "pavimentos")
    for (const col of f.blocks.filter((b) => b.kind === "coluna-af")) {
      const span = new Set(busStoreys(f, col));
      for (const l of outgoing(col.id)) {
        const t = byId.get(l.to);
        if (!t || isBus(t)) continue;
        const s = blockStorey(f, t);
        if (s && !span.has(s)) issues.push({ level: "aviso", text: `${tag(t)} (${s}) está num pavimento que a coluna ${tag(col)} não alcança: estique a coluna.`, blockId: t.id });
      }
    }
  // Reservação e recalque.
  const bal = waterBalance(f);
  if (bal.consumo > 0) {
    const v = bal.inferior + bal.superior;
    const pctSup = v ? Math.round((bal.superior / v) * 100) : 0;
    if (bal.dias < 1)
      issues.push({ level: "aviso", text: `Reservação de ${fmtL(v)} para consumo de ${fmtL(bal.consumo)}/dia: ${bal.dias.toFixed(2).replace(".", ",")} dia — abaixo do consumo de 24 h (NBR 5626).` });
    else
      issues.push({ level: "info", text: `Reservação de ${fmtL(v)} (inferior ${100 - pctSup}% · superior ${pctSup}%) para consumo de ${fmtL(bal.consumo)}/dia: autonomia de ${bal.dias.toFixed(1).replace(".", ",")} dia(s).` });
  }
  for (const pump of f.blocks.filter((b) => b.kind === "bomba-recalque")) {
    const zp = blockZ(f, pump);
    const tops = downstream(f, pump.id).filter((b) => b.kind === "reservatorio-superior");
    if (!tops.length) issues.push({ level: "aviso", text: `${tag(pump)}: o recalque deve chegar a um reservatório superior.`, blockId: pump.id });
    if (!f.links.some((l) => l.to === pump.id && byId.get(l.from)?.kind === "cisterna")) issues.push({ level: "aviso", text: `${tag(pump)}: a bomba de recalque deve sair do reservatório inferior.`, blockId: pump.id });
    if (zp) {
      const desnivel = Math.max(0, ...tops.map((t) => (blockZ(f, t)?.low ?? zp.low) + (Number(t.params.nivel) || 0) - zp.low));
      const hman = Number(pump.params.hman) || 0;
      if (desnivel && hman < desnivel)
        issues.push({ level: "aviso", text: `${tag(pump)}: altura manométrica de ${mca(hman)} menor que o desnível geométrico de ${mca(desnivel)} até o reservatório superior (sem contar as perdas).`, blockId: pump.id });
    }
    const q = Number(pump.params.vazao) || 0;
    if (bal.consumo > 0 && q < (0.15 * bal.consumo) / 1000)
      issues.push({ level: "aviso", text: `${tag(pump)}: vazão de ${q} m³/h abaixo de 15% do consumo diário por hora (${((0.15 * bal.consumo) / 1000).toFixed(1).replace(".", ",")} m³/h, NBR 5626).`, blockId: pump.id });
  }
}

export function checkFlow(f: FlowData, ctx: FlowContext): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const byId = new Map(f.blocks.map((b) => [b.id, b]));
  const incoming = (id: string) => f.links.filter((l) => l.to === id);
  const outgoing = (id: string) => f.links.filter((l) => l.from === id);
  const tag = (b: FlowBlock) => b.tag || FLOW_BLOCK_BY_ID[b.kind]?.label || b.kind;
  const paved = f.layout === "pavimentos";

  for (const l of f.links) if (!byId.has(l.from) || !byId.has(l.to)) issues.push({ level: "erro", text: "Ligação com bloco apagado." });

  for (const b of f.blocks) {
    const d = FLOW_BLOCK_BY_ID[b.kind];
    if (!d || d.symbol === "texto") continue;
    const inc = incoming(b.id);
    if (!d.source && !inc.length) issues.push({ level: "aviso", text: `${tag(b)} não está alimentado (nenhuma ligação chega nele).`, blockId: b.id });
    if (!outgoing(b.id).length && !d.board && !d.sink && !MEC_KINDS.has(b.kind) && b.kind !== "cm-convencional")
      issues.push({ level: "info", text: `${tag(b)} não alimenta nenhum bloco.`, blockId: b.id });
    // Média tensão só em painel MT, cabine de medição MT e transformador.
    for (const l of inc)
      if (l.kind === "mt" && !d.acceptsMT) issues.push({ level: "aviso", text: `Média tensão chegando em ${tag(b)}: só painel de MT, cabine de medição MT ou transformador recebem MT.`, blockId: b.id });
    if (paved && !isBus(b) && !blockStorey(f, b)) issues.push({ level: "aviso", text: `${tag(b)} está fora das faixas de pavimento.`, blockId: b.id });
    if (paved && !isBus(b)) {
      const r = blockRect(b);
      const i = bandIndexAt(f, r.y + r.h / 2);
      const t = blockTower(f, b);
      if (t && i >= 0 && !levelHasTower(f, i, t.id))
        issues.push({ level: "aviso", text: `${tag(b)} está no ${f.storeys[i]} da ${t.name}, mas a ${t.name} não tem esse pavimento (perfil do empreendimento).`, blockId: b.id });
    }
  }

  // Barramentos blindados: caixa direta (uma só) ou caixas de derivação (até 2 por andar).
  for (const bus of f.blocks.filter(isBusway)) {
    const direct = outgoing(bus.id)
      .map((l) => byId.get(l.to))
      .filter(isMec);
    const derivs = outgoing(bus.id)
      .map((l) => byId.get(l.to))
      .filter((b): b is FlowBlock => b?.kind === "derivacao");
    const viaDeriv = derivs.flatMap((dv) => outgoing(dv.id).map((l) => ({ dv, mec: byId.get(l.to) }))).filter((x): x is { dv: FlowBlock; mec: FlowBlock } => isMec(x.mec));
    if (direct.length && direct.length + viaDeriv.length > 1)
      issues.push({
        level: "erro",
        text: `${tag(bus)}: com a caixa de medição ligada direto no barramento, só pode haver uma caixa por barramento (há ${direct.length + viaDeriv.length}). Use caixas de derivação para ter até 2 caixas por andar.`,
        blockId: bus.id,
      });
    if (paved) {
      const span = new Set(busStoreys(f, bus));
      const perStorey = new Map<string, number>();
      for (const { dv, mec } of viaDeriv) {
        const s = blockStorey(f, dv);
        if (s) perStorey.set(s, (perStorey.get(s) ?? 0) + 1);
        const sm = blockStorey(f, mec);
        if (s && sm && s !== sm) issues.push({ level: "aviso", text: `${tag(mec)} está em ${sm}, mas a caixa de derivação ${tag(dv)} está em ${s}.`, blockId: mec.id });
      }
      for (const [s, n] of perStorey) if (n > 2) issues.push({ level: "erro", text: `${tag(bus)}: ${n} caixas de medição no ${s}; com derivação, o limite é de 2 caixas por andar no mesmo barramento.`, blockId: bus.id });
      for (const b of [...direct, ...derivs]) {
        const s = blockStorey(f, b);
        if (s && !span.has(s)) issues.push({ level: "aviso", text: `${tag(b)} (${s}) está num pavimento que o ${tag(bus)} não alcança: estique o barramento.`, blockId: b.id });
      }
    }
  }
  for (const dv of f.blocks.filter((b) => b.kind === "derivacao")) {
    if (incoming(dv.id).some((l) => !isBusway(byId.get(l.from)))) issues.push({ level: "aviso", text: `${tag(dv)}: a caixa de derivação deve sair de um barramento blindado.`, blockId: dv.id });
    const mecs = outgoing(dv.id).filter((l) => isMec(byId.get(l.to))).length;
    if (mecs > 2) issues.push({ level: "erro", text: `${tag(dv)}: ${mecs} caixas de medição na mesma derivação (máximo 2).`, blockId: dv.id });
  }

  // Capacidade das caixas de medição e centros de medição.
  for (const b of f.blocks) {
    const d = FLOW_BLOCK_BY_ID[b.kind];
    const cap = d?.meters ?? (b.kind === "cm-convencional" ? Number(b.params.medidores) || 0 : 0);
    if (!cap) continue;
    const units = outgoing(b.id).reduce((s, l) => {
      const t = byId.get(l.to);
      return s + (t && FLOW_BLOCK_BY_ID[t.kind]?.board ? Math.max(1, Number(t.params.quantidade) || 1) : 0);
    }, 0);
    if (units > cap) issues.push({ level: "erro", text: `${tag(b)}: ${units} quadros ligados, mas a caixa tem ${cap} medidores.`, blockId: b.id });
  }

  // Capacidade de transformadores e geradores frente à carga dos quadros vinculados.
  for (const b of f.blocks.filter((x) => x.kind === "transformador" || x.kind === "gerador")) {
    const kva = Number(b.params.potencia) || 0;
    const { va } = downstreamLoad(f, b.id, ctx);
    if (kva && va > kva * 1000) issues.push({ level: "aviso", text: `${tag(b)}: carga instalada a jusante de ${(va / 1000).toFixed(1).replace(".", ",")} kVA passa da potência de ${kva} kVA (confira a demanda).`, blockId: b.id });
  }

  // Modelo: quadros locados e vínculos.
  const linked = new Set<string>();
  for (const b of f.blocks) {
    const d = FLOW_BLOCK_BY_ID[b.kind];
    if (!d?.board) continue;
    if (b.pointGuid) {
      const m = ctx.boards.find((x) => x.guid === b.pointGuid);
      if (!m) {
        issues.push({ level: "erro", text: `${tag(b)}: o quadro vinculado não existe mais no modelo.`, blockId: b.id, action: { kind: "locar", blockId: b.id } });
        continue;
      }
      linked.add(m.guid);
      const s = blockStorey(f, b);
      if (paved && s && m.storey && s !== m.storey) issues.push({ level: "aviso", text: `${tag(b)} está no ${s} no fluxograma, mas o quadro ${m.tag} foi locado no ${m.storey}.`, blockId: b.id });
      if (m.tag !== b.tag) issues.push({ level: "info", text: `${tag(b)} está vinculado ao quadro ${m.tag} (etiquetas diferentes).`, blockId: b.id });
      continue;
    }
    const same = ctx.boards.find((x) => x.tag === b.tag && !f.blocks.some((o) => o.pointGuid === x.guid));
    if (same) issues.push({ level: "info", text: `${tag(b)}: há um quadro ${same.tag} no modelo; vincule para conferir a carga e o pavimento.`, blockId: b.id, action: { kind: "vincular", blockId: b.id, pointGuid: same.guid } });
    else issues.push({ level: "info", text: `${tag(b)} ainda não foi locado no modelo.`, blockId: b.id, action: { kind: "locar", blockId: b.id } });
  }
  if (flowSystem(f) === "eletrica") for (const m of ctx.boards) if (!linked.has(m.guid) && !f.blocks.some((b) => b.tag === m.tag)) issues.push({ level: "aviso", text: `O quadro ${m.tag}${m.storey ? ` (${m.storey})` : ""} está no modelo, mas não aparece no fluxograma.` });

  if (flowSystem(f) === "agua-fria") checkWater(f, issues, tag);

  const order: Record<IssueLevel, number> = { erro: 0, aviso: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/** Próxima etiqueta livre (ex.: QD-3). */
export function nextTag(f: FlowData, kind: string): string {
  const d = FLOW_BLOCK_BY_ID[kind];
  if (!d?.tagPrefix) return "";
  const used = new Set(f.blocks.map((b) => b.tag));
  for (let n = 1; ; n++) {
    const t = `${d.tagPrefix}-${n}`;
    if (!used.has(t)) return t;
  }
}

/** Organiza: centraliza cada bloco na faixa do seu pavimento e afasta os que se sobrepõem. */
export function autoArrange(f: FlowData): FlowData {
  if (f.layout !== "pavimentos") return f;
  const blocks = f.blocks.map((b) => ({ ...b }));
  const groups = new Map<string, FlowBlock[]>();
  for (const b of blocks) {
    if (isBus(b) || b.kind === "texto") continue;
    const s = blockStorey(f, b);
    if (!s) continue;
    const i = f.storeys.indexOf(s);
    b.y = Math.round((bandTop(f, i) + (bandHeight(f, i) - blockRect(b).h) / 2) * 10) / 10;
    const k = `${s}|${blockTower(f, b)?.id ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.x - b.x);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const minX = prev.x + blockRect(prev).w + 0.6;
      if (list[i].x < minX) list[i].x = Math.round(minX * 10) / 10;
    }
  }
  return { ...f, blocks };
}
