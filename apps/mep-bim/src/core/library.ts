// Biblioteca de componentes para locação de pontos MEP.
//
// As alturas são valores usuais de projeto no Brasil, servindo apenas como
// ponto de partida: todas são editáveis no app e devem seguir o padrão do
// cliente, o memorial e as normas aplicáveis.
import type { Discipline } from "./types";

/** Onde o componente é fixado. */
export type Mounting = "parede" | "teto" | "piso";
export type Shape = "caixa" | "cilindro" | "malha";

/** Geometria própria (famílias importadas): mm, eixos locais do app (X largura, Y altura, Z para fora), centrada. */
export interface ComponentMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface ComponentParam {
  name: string;
  unit?: string;
  default: string | number;
}

export interface ComponentDef {
  id: string;
  group: string;
  label: string;
  discipline: Discipline;
  /** Entidade IFC4 gerada na exportação. */
  ifcType: string;
  predefinedType: string;
  mounting: Mounting;
  /**
   * Em mm. Parede: altura do centro acima do piso. Teto: afastamento abaixo
   * do teto/forro. Piso: altura da base acima do piso.
   */
  defaultHeight: number;
  /** Em mm: largura (ao longo da parede), profundidade (para fora da superfície), altura. */
  size: [number, number, number];
  shape: Shape;
  system: string;
  /** IfcDistributionSystemEnum do sistema na exportação. */
  systemType: string;
  tagPrefix: string;
  params: ComponentParam[];
  /** Geometria 3D própria (shape "malha"). */
  mesh?: ComponentMesh;
  /** Componente cujo símbolo de planta é reaproveitado. */
  symbolOf?: string;
  /** Origem externa: famílias do Revit (.sebfam) ou elementos lidos de um IFC. */
  source?: { kind: "revit" | "ifc"; packageId: string; familyUid: string; family: string; type: string; file?: string };
  /** Função/equivalência: elementos com a mesma função são alternativas entre si (ex.: marcas). */
  funcao?: string;
  /** Fabricante e modelo. */
  brand?: string;
  model?: string;
}

const P = {
  potW: (v: number): ComponentParam => ({ name: "Potência", unit: "W", default: v }),
  fluxo: (v: number): ComponentParam => ({ name: "Fluxo luminoso", unit: "lm", default: v }),
  potVA: (v: number): ComponentParam => ({ name: "Potência", unit: "VA", default: v }),
  tensao: (v = 127): ComponentParam => ({ name: "Tensão", unit: "V", default: v }),
  circuito: (): ComponentParam => ({ name: "Circuito", default: "" }),
  btu: (v: number): ComponentParam => ({ name: "Capacidade", unit: "BTU/h", default: v }),
  vazao: (v: number): ComponentParam => ({ name: "Vazão", unit: "m³/h", default: v }),
};

type Def = Omit<ComponentDef, "params"> & { params?: ComponentParam[] };
const def = (d: Def): ComponentDef => ({ params: [], ...d });

export const COMPONENTS: ComponentDef[] = [
  // ---- Iluminação ----------------------------------------------------------
  def({ id: "lum-embutir-6060", group: "Iluminação", label: "Luminária de embutir 600×600", discipline: "eletrica", ifcType: "IFCLIGHTFIXTURE", predefinedType: "POINTSOURCE", mounting: "teto", defaultHeight: 0, size: [600, 600, 80], shape: "caixa", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "L", params: [P.potW(40), P.fluxo(3600), P.tensao(220), P.circuito()] }),
  def({ id: "lum-sobrepor-300", group: "Iluminação", label: "Luminária de sobrepor Ø300", discipline: "eletrica", ifcType: "IFCLIGHTFIXTURE", predefinedType: "POINTSOURCE", mounting: "teto", defaultHeight: 0, size: [300, 300, 80], shape: "cilindro", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "L", params: [P.potW(18), P.fluxo(1500), P.tensao(220), P.circuito()] }),
  def({ id: "lum-linear-1200", group: "Iluminação", label: "Luminária linear 1200 mm", discipline: "eletrica", ifcType: "IFCLIGHTFIXTURE", predefinedType: "POINTSOURCE", mounting: "teto", defaultHeight: 0, size: [1200, 150, 60], shape: "caixa", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "L", params: [P.potW(36), P.fluxo(3400), P.tensao(220), P.circuito()] }),
  def({ id: "arandela", group: "Iluminação", label: "Arandela", discipline: "eletrica", ifcType: "IFCLIGHTFIXTURE", predefinedType: "DIRECTIONSOURCE", mounting: "parede", defaultHeight: 2000, size: [200, 120, 150], shape: "caixa", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "L", params: [P.potW(10), P.tensao(220), P.circuito()] }),
  def({ id: "emergencia", group: "Iluminação", label: "Luminária de emergência", discipline: "eletrica", ifcType: "IFCLIGHTFIXTURE", predefinedType: "SECURITYLIGHTING", mounting: "parede", defaultHeight: 2200, size: [300, 60, 80], shape: "caixa", system: "Iluminação de emergência", systemType: "LIGHTING", tagPrefix: "LE", params: [P.potW(3), P.circuito()] }),

  // ---- Tomadas e comandos -------------------------------------------------
  def({ id: "tomada-baixa", group: "Tomadas e comandos", label: "Tomada baixa 2P+T", discipline: "eletrica", ifcType: "IFCOUTLET", predefinedType: "POWEROUTLET", mounting: "parede", defaultHeight: 300, size: [60, 40, 105], shape: "caixa", system: "Tomadas", systemType: "ELECTRICAL", tagPrefix: "T", params: [P.potVA(100), P.tensao(), P.circuito()] }),
  def({ id: "tomada-media", group: "Tomadas e comandos", label: "Tomada média 2P+T", discipline: "eletrica", ifcType: "IFCOUTLET", predefinedType: "POWEROUTLET", mounting: "parede", defaultHeight: 1100, size: [60, 40, 105], shape: "caixa", system: "Tomadas", systemType: "ELECTRICAL", tagPrefix: "T", params: [P.potVA(600), P.tensao(), P.circuito()] }),
  def({ id: "tomada-alta", group: "Tomadas e comandos", label: "Tomada alta 2P+T", discipline: "eletrica", ifcType: "IFCOUTLET", predefinedType: "POWEROUTLET", mounting: "parede", defaultHeight: 2000, size: [60, 40, 105], shape: "caixa", system: "Tomadas", systemType: "ELECTRICAL", tagPrefix: "T", params: [P.potVA(100), P.tensao(), P.circuito()] }),
  def({ id: "tomada-piso", group: "Tomadas e comandos", label: "Tomada de piso", discipline: "eletrica", ifcType: "IFCOUTLET", predefinedType: "POWEROUTLET", mounting: "piso", defaultHeight: 0, size: [120, 120, 30], shape: "caixa", system: "Tomadas", systemType: "ELECTRICAL", tagPrefix: "T", params: [P.potVA(100), P.tensao(), P.circuito()] }),
  def({ id: "interruptor-simples", group: "Tomadas e comandos", label: "Interruptor simples", discipline: "eletrica", ifcType: "IFCSWITCHINGDEVICE", predefinedType: "TOGGLESWITCH", mounting: "parede", defaultHeight: 1100, size: [60, 40, 105], shape: "caixa", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "S", params: [P.circuito()] }),
  def({ id: "interruptor-paralelo", group: "Tomadas e comandos", label: "Interruptor paralelo (three-way)", discipline: "eletrica", ifcType: "IFCSWITCHINGDEVICE", predefinedType: "TOGGLESWITCH", mounting: "parede", defaultHeight: 1100, size: [60, 40, 105], shape: "caixa", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "S", params: [P.circuito()] }),
  def({ id: "interruptor-intermediario", group: "Tomadas e comandos", label: "Interruptor intermediário (four-way)", discipline: "eletrica", ifcType: "IFCSWITCHINGDEVICE", predefinedType: "TOGGLESWITCH", mounting: "parede", defaultHeight: 1100, size: [60, 40, 105], shape: "caixa", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "S", params: [P.circuito()] }),
  def({ id: "interruptor-bipolar", group: "Tomadas e comandos", label: "Interruptor bipolar", discipline: "eletrica", ifcType: "IFCSWITCHINGDEVICE", predefinedType: "TOGGLESWITCH", mounting: "parede", defaultHeight: 1100, size: [60, 40, 105], shape: "caixa", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "S", params: [P.circuito()] }),
  def({ id: "quadro-distribuicao", group: "Tomadas e comandos", label: "Quadro de distribuição", discipline: "eletrica", ifcType: "IFCELECTRICDISTRIBUTIONBOARD", predefinedType: "DISTRIBUTIONBOARD", mounting: "parede", defaultHeight: 1500, size: [500, 150, 700], shape: "caixa", system: "Distribuição", systemType: "ELECTRICAL", tagPrefix: "QD", params: [{ name: "Sistema", default: "3F-127/220" }] }),
  def({ id: "caixa-passagem-teto", group: "Tomadas e comandos", label: "Caixa de passagem (teto)", discipline: "eletrica", ifcType: "IFCJUNCTIONBOX", predefinedType: "POWER", mounting: "teto", defaultHeight: 0, size: [100, 100, 50], shape: "cilindro", system: "Iluminação", systemType: "LIGHTING", tagPrefix: "CP" }),

  // ---- Telecom e segurança -------------------------------------------------
  def({ id: "ponto-dados", group: "Telecom e segurança", label: "Ponto de dados RJ45", discipline: "telecom", ifcType: "IFCOUTLET", predefinedType: "DATAOUTLET", mounting: "parede", defaultHeight: 300, size: [60, 40, 105], shape: "caixa", system: "Telecom - Dados", systemType: "COMMUNICATION", tagPrefix: "D" }),
  def({ id: "ponto-tv", group: "Telecom e segurança", label: "Ponto de TV", discipline: "telecom", ifcType: "IFCOUTLET", predefinedType: "AUDIOVISUALOUTLET", mounting: "parede", defaultHeight: 1300, size: [60, 40, 105], shape: "caixa", system: "Telecom - TV", systemType: "COMMUNICATION", tagPrefix: "TV" }),
  def({ id: "access-point", group: "Telecom e segurança", label: "Ponto de acesso Wi-Fi", discipline: "telecom", ifcType: "IFCCOMMUNICATIONSAPPLIANCE", predefinedType: "NETWORKAPPLIANCE", mounting: "teto", defaultHeight: 0, size: [200, 200, 40], shape: "cilindro", system: "Telecom - Dados", systemType: "COMMUNICATION", tagPrefix: "AP" }),
  def({ id: "camera-cftv", group: "Telecom e segurança", label: "Câmera CFTV (dome)", discipline: "telecom", ifcType: "IFCAUDIOVISUALAPPLIANCE", predefinedType: "CAMERA", mounting: "teto", defaultHeight: 0, size: [120, 120, 100], shape: "cilindro", system: "CFTV", systemType: "SECURITY", tagPrefix: "CAM" }),

  // ---- Incêndio -------------------------------------------------------------
  def({ id: "sprinkler-pendente", group: "Incêndio", label: "Sprinkler pendente", discipline: "incendio", ifcType: "IFCFIRESUPPRESSIONTERMINAL", predefinedType: "SPRINKLER", mounting: "teto", defaultHeight: 0, size: [60, 60, 80], shape: "cilindro", system: "Incêndio - Sprinklers", systemType: "FIREPROTECTION", tagPrefix: "SPK" }),
  def({ id: "detector-fumaca", group: "Incêndio", label: "Detector de fumaça", discipline: "incendio", ifcType: "IFCSENSOR", predefinedType: "SMOKESENSOR", mounting: "teto", defaultHeight: 0, size: [100, 100, 50], shape: "cilindro", system: "Incêndio - Alarme", systemType: "FIREPROTECTION", tagPrefix: "DF" }),
  def({ id: "acionador-manual", group: "Incêndio", label: "Acionador manual", discipline: "incendio", ifcType: "IFCALARM", predefinedType: "MANUALPULLBOX", mounting: "parede", defaultHeight: 1200, size: [90, 50, 90], shape: "caixa", system: "Incêndio - Alarme", systemType: "FIREPROTECTION", tagPrefix: "AM" }),
  def({ id: "sirene", group: "Incêndio", label: "Sirene audiovisual", discipline: "incendio", ifcType: "IFCALARM", predefinedType: "SIREN", mounting: "parede", defaultHeight: 2200, size: [100, 60, 100], shape: "caixa", system: "Incêndio - Alarme", systemType: "FIREPROTECTION", tagPrefix: "SI" }),
  def({ id: "abrigo-hidrante", group: "Incêndio", label: "Abrigo de hidrante", discipline: "incendio", ifcType: "IFCFIRESUPPRESSIONTERMINAL", predefinedType: "FIREHYDRANT", mounting: "parede", defaultHeight: 1200, size: [900, 170, 600], shape: "caixa", system: "Incêndio - Hidrantes", systemType: "FIREPROTECTION", tagPrefix: "H" }),

  // ---- Hidráulica -----------------------------------------------------------
  def({ id: "lavatorio", group: "Hidráulica", label: "Lavatório", discipline: "hidraulica", ifcType: "IFCSANITARYTERMINAL", predefinedType: "WASHHANDBASIN", mounting: "parede", defaultHeight: 750, size: [500, 400, 200], shape: "caixa", system: "Água Fria", systemType: "DOMESTICCOLDWATER", tagPrefix: "LV" }),
  def({ id: "bacia-sanitaria", group: "Hidráulica", label: "Bacia sanitária", discipline: "hidraulica", ifcType: "IFCSANITARYTERMINAL", predefinedType: "TOILETPAN", mounting: "piso", defaultHeight: 0, size: [380, 650, 400], shape: "caixa", system: "Água Fria", systemType: "DOMESTICCOLDWATER", tagPrefix: "BS" }),
  def({ id: "chuveiro", group: "Hidráulica", label: "Chuveiro", discipline: "hidraulica", ifcType: "IFCSANITARYTERMINAL", predefinedType: "SHOWER", mounting: "parede", defaultHeight: 2100, size: [150, 300, 100], shape: "caixa", system: "Água Fria", systemType: "DOMESTICCOLDWATER", tagPrefix: "CH" }),
  def({ id: "pia-cozinha", group: "Hidráulica", label: "Pia de cozinha", discipline: "hidraulica", ifcType: "IFCSANITARYTERMINAL", predefinedType: "SINK", mounting: "parede", defaultHeight: 850, size: [1200, 550, 200], shape: "caixa", system: "Água Fria", systemType: "DOMESTICCOLDWATER", tagPrefix: "PI" }),
  def({ id: "registro-gaveta", group: "Hidráulica", label: "Registro de gaveta", discipline: "hidraulica", ifcType: "IFCVALVE", predefinedType: "ISOLATING", mounting: "parede", defaultHeight: 1800, size: [80, 80, 80], shape: "caixa", system: "Água Fria", systemType: "DOMESTICCOLDWATER", tagPrefix: "RG" }),
  // Pontos de utilização (saídas das instalações para os equipamentos)
  def({ id: "ponto-agua-fria", group: "Hidráulica", label: "Ponto de água fria", discipline: "hidraulica", ifcType: "IFCPIPEFITTING", predefinedType: "OBSTRUCTION", mounting: "parede", defaultHeight: 600, size: [60, 60, 60], shape: "cilindro", system: "Água Fria", systemType: "DOMESTICCOLDWATER", tagPrefix: "AF", params: [{ name: "Diâmetro", unit: "mm", default: 25 }] }),
  def({ id: "ponto-agua-quente", group: "Hidráulica", label: "Ponto de água quente", discipline: "hidraulica", ifcType: "IFCPIPEFITTING", predefinedType: "OBSTRUCTION", mounting: "parede", defaultHeight: 600, size: [60, 60, 60], shape: "cilindro", system: "Água Quente", systemType: "DOMESTICHOTWATER", tagPrefix: "AQ", params: [{ name: "Diâmetro", unit: "mm", default: 22 }] }),
  def({ id: "ponto-esgoto", group: "Hidráulica", label: "Ponto de esgoto (piso)", discipline: "hidraulica", ifcType: "IFCWASTETERMINAL", predefinedType: "NOTDEFINED", mounting: "piso", defaultHeight: 0, size: [100, 100, 30], shape: "cilindro", system: "Esgoto", systemType: "SEWAGE", tagPrefix: "ES", params: [{ name: "Diâmetro", unit: "mm", default: 100 }] }),
  def({ id: "saida-esgoto-parede", group: "Hidráulica", label: "Saída de esgoto na parede", discipline: "hidraulica", ifcType: "IFCWASTETERMINAL", predefinedType: "NOTDEFINED", mounting: "parede", defaultHeight: 500, size: [60, 60, 60], shape: "cilindro", system: "Esgoto", systemType: "SEWAGE", tagPrefix: "ES", params: [{ name: "Diâmetro", unit: "mm", default: 40 }] }),
  def({ id: "ponto-gas", group: "Hidráulica", label: "Ponto de gás", discipline: "gas", ifcType: "IFCVALVE", predefinedType: "GASCOCK", mounting: "parede", defaultHeight: 300, size: [60, 60, 60], shape: "cilindro", system: "Gás", systemType: "GAS", tagPrefix: "PG", params: [{ name: "Diâmetro", unit: "mm", default: 15 }] }),
  def({ id: "ralo-sifonado", group: "Hidráulica", label: "Ralo sifonado", discipline: "hidraulica", ifcType: "IFCWASTETERMINAL", predefinedType: "FLOORTRAP", mounting: "piso", defaultHeight: 0, size: [100, 100, 30], shape: "cilindro", system: "Esgoto", systemType: "SEWAGE", tagPrefix: "RS" }),

  // ---- Climatização -----------------------------------------------------------
  def({ id: "difusor-6060", group: "Climatização", label: "Difusor de teto 600×600", discipline: "hvac", ifcType: "IFCAIRTERMINAL", predefinedType: "DIFFUSER", mounting: "teto", defaultHeight: 0, size: [600, 600, 50], shape: "caixa", system: "Climatização - Insuflamento", systemType: "AIRCONDITIONING", tagPrefix: "DI", params: [P.vazao(500)] }),
  def({ id: "grelha-retorno", group: "Climatização", label: "Grelha de retorno 600×300", discipline: "hvac", ifcType: "IFCAIRTERMINAL", predefinedType: "GRILLE", mounting: "teto", defaultHeight: 0, size: [600, 300, 50], shape: "caixa", system: "Climatização - Retorno", systemType: "AIRCONDITIONING", tagPrefix: "GR", params: [P.vazao(500)] }),
  def({ id: "evaporadora-hiwall", group: "Climatização", label: "Evaporadora hi-wall", discipline: "hvac", ifcType: "IFCUNITARYEQUIPMENT", predefinedType: "SPLITSYSTEM", mounting: "parede", defaultHeight: 2200, size: [900, 220, 300], shape: "caixa", system: "Climatização", systemType: "AIRCONDITIONING", tagPrefix: "EV", params: [P.btu(12000), P.circuito()] }),
  def({ id: "evaporadora-cassete", group: "Climatização", label: "Evaporadora cassete", discipline: "hvac", ifcType: "IFCUNITARYEQUIPMENT", predefinedType: "SPLITSYSTEM", mounting: "teto", defaultHeight: 0, size: [840, 840, 250], shape: "caixa", system: "Climatização", systemType: "AIRCONDITIONING", tagPrefix: "EV", params: [P.btu(24000), P.circuito()] }),
  def({ id: "condensadora", group: "Climatização", label: "Condensadora", discipline: "hvac", ifcType: "IFCCONDENSER", predefinedType: "AIRCOOLED", mounting: "piso", defaultHeight: 0, size: [800, 300, 550], shape: "caixa", system: "Climatização", systemType: "AIRCONDITIONING", tagPrefix: "CD", params: [P.btu(12000), P.circuito()] }),
  def({ id: "exaustor", group: "Climatização", label: "Exaustor de parede", discipline: "hvac", ifcType: "IFCFAN", predefinedType: "PROPELLORAXIAL", mounting: "parede", defaultHeight: 2200, size: [250, 150, 250], shape: "caixa", system: "Exaustão", systemType: "EXHAUST", tagPrefix: "EX", params: [P.vazao(300), P.circuito()] }),
];

export const COMPONENT_BY_ID: Record<string, ComponentDef> = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));

export const COMPONENT_GROUPS: string[] = [...new Set(COMPONENTS.map((c) => c.group))];

/** Quantidade de componentes de fábrica (os demais vêm de bibliotecas importadas). */
export const BUILTIN_COUNT = COMPONENTS.length;

// ---- Componentes importados (famílias do Revit) -------------------------------------------
let libraryVersion = 0;
const libraryListeners = new Set<() => void>();

/**
 * Substitui os componentes de uma origem (pacote importado) por `defs`. As listas
 * exportadas acima são atualizadas no lugar, para que todo o app as enxergue.
 */
export function registerComponents(packageId: string, defs: ComponentDef[]): void {
  for (let i = COMPONENTS.length - 1; i >= BUILTIN_COUNT; i--) {
    if (COMPONENTS[i].source?.packageId === packageId) {
      delete COMPONENT_BY_ID[COMPONENTS[i].id];
      COMPONENTS.splice(i, 1);
    }
  }
  for (const d of defs) {
    if (COMPONENT_BY_ID[d.id] && !COMPONENT_BY_ID[d.id].source) continue; // nunca substitui os de fábrica
    if (COMPONENT_BY_ID[d.id]) {
      const at = COMPONENTS.indexOf(COMPONENT_BY_ID[d.id]);
      if (at >= 0) COMPONENTS.splice(at, 1);
    }
    COMPONENTS.push(d);
    COMPONENT_BY_ID[d.id] = d;
  }
  COMPONENT_GROUPS.splice(0, COMPONENT_GROUPS.length, ...new Set(COMPONENTS.map((c) => c.group)));
  libraryVersion++;
  libraryListeners.forEach((l) => l());
}

export const getLibraryVersion = () => libraryVersion;
export function onLibraryChange(cb: () => void): () => void {
  libraryListeners.add(cb);
  return () => libraryListeners.delete(cb);
}

export const MOUNTING_LABEL: Record<Mounting, string> = {
  parede: "parede",
  teto: "teto / forro",
  piso: "piso",
};
