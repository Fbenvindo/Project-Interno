import type { Discipline, ElementCategory } from "./types";

export interface DisciplineMeta {
  id: Discipline;
  label: string;
  /** Cor de exibição no visualizador (hex). */
  color: string;
  isMep: boolean;
}

export const DISCIPLINES: DisciplineMeta[] = [
  { id: "hidraulica", label: "Hidráulica", color: "#2f80ed", isMep: true },
  { id: "incendio", label: "Incêndio", color: "#eb3b3b", isMep: true },
  { id: "gas", label: "Gás", color: "#f2c94c", isMep: true },
  { id: "hvac", label: "HVAC / Climatização", color: "#27ae60", isMep: true },
  { id: "eletrica", label: "Elétrica", color: "#f2994a", isMep: true },
  { id: "telecom", label: "Telecom / Dados", color: "#9b51e0", isMep: true },
  { id: "mep", label: "MEP (genérico)", color: "#56ccf2", isMep: true },
  { id: "estrutura", label: "Estrutura", color: "#8d8d8d", isMep: false },
  { id: "arquitetura", label: "Arquitetura", color: "#cfc8bd", isMep: false },
  { id: "outros", label: "Outros", color: "#b0b0b0", isMep: false },
];

export const DISCIPLINE_BY_ID: Record<Discipline, DisciplineMeta> = Object.fromEntries(
  DISCIPLINES.map((d) => [d.id, d]),
) as Record<Discipline, DisciplineMeta>;

export const MEP_DISCIPLINES: Discipline[] = DISCIPLINES.filter((d) => d.isMep).map((d) => d.id);

interface TypeRule {
  label: string;
  category: ElementCategory;
  discipline: Discipline;
  /**
   * Regra "forte": o tipo já define a disciplina (ex.: duto é sempre HVAC).
   * Regras fracas (ex.: tubulação) podem ser reclassificadas pelo sistema.
   */
  strong: boolean;
}

const r = (label: string, category: ElementCategory, discipline: Discipline, strong = true): TypeRule => ({
  label,
  category,
  discipline,
  strong,
});

/** Tipos IFC (IFC2x3 e IFC4) reconhecidos. Chave em maiúsculas. */
const TYPE_RULES: Record<string, TypeRule> = {
  // Tubulações (hidráulica por padrão, reclassificável por sistema)
  IFCPIPESEGMENT: r("Tubo", "segmento", "hidraulica", false),
  IFCPIPEFITTING: r("Conexão de tubulação", "conexao", "hidraulica", false),
  IFCVALVE: r("Válvula / registro", "acessorio", "hidraulica", false),
  IFCPUMP: r("Bomba", "equipamento", "hidraulica", false),
  IFCTANK: r("Reservatório", "equipamento", "hidraulica", false),
  IFCFLOWMETER: r("Medidor de vazão", "acessorio", "hidraulica", false),
  IFCSANITARYTERMINAL: r("Louça / metal sanitário", "terminal", "hidraulica"),
  IFCWASTETERMINAL: r("Ralo / terminal de esgoto", "terminal", "hidraulica"),
  IFCINTERCEPTOR: r("Caixa separadora", "equipamento", "hidraulica"),
  IFCSTACKTERMINAL: r("Terminal de ventilação / tubo de queda", "terminal", "hidraulica"),
  IFCFIRESUPPRESSIONTERMINAL: r("Sprinkler / hidrante", "terminal", "incendio"),
  IFCALARM: r("Alarme", "terminal", "incendio"),
  IFCSENSOR: r("Sensor / detector", "terminal", "mep", false),
  IFCACTUATOR: r("Atuador", "acessorio", "mep", false),
  IFCCONTROLLER: r("Controlador", "equipamento", "mep", false),

  // HVAC
  IFCDUCTSEGMENT: r("Duto", "segmento", "hvac"),
  IFCDUCTFITTING: r("Conexão de duto", "conexao", "hvac"),
  IFCDUCTSILENCER: r("Atenuador de ruído", "acessorio", "hvac"),
  IFCAIRTERMINAL: r("Difusor / grelha", "terminal", "hvac"),
  IFCAIRTERMINALBOX: r("Caixa VAV", "equipamento", "hvac"),
  IFCDAMPER: r("Damper", "acessorio", "hvac"),
  IFCFAN: r("Ventilador", "equipamento", "hvac"),
  IFCFILTER: r("Filtro", "acessorio", "hvac"),
  IFCUNITARYEQUIPMENT: r("Equipamento de climatização", "equipamento", "hvac"),
  IFCAIRTOAIRHEATRECOVERY: r("Recuperador de calor", "equipamento", "hvac"),
  IFCCHILLER: r("Chiller", "equipamento", "hvac"),
  IFCCOOLINGTOWER: r("Torre de resfriamento", "equipamento", "hvac"),
  IFCCOIL: r("Serpentina", "equipamento", "hvac"),
  IFCCONDENSER: r("Condensadora", "equipamento", "hvac"),
  IFCEVAPORATOR: r("Evaporadora", "equipamento", "hvac"),
  IFCCOMPRESSOR: r("Compressor", "equipamento", "hvac"),
  IFCBOILER: r("Caldeira", "equipamento", "hvac"),
  IFCHUMIDIFIER: r("Umidificador", "equipamento", "hvac"),
  IFCHEATEXCHANGER: r("Trocador de calor", "equipamento", "hvac"),
  IFCSPACEHEATER: r("Aquecedor de ambiente", "equipamento", "hvac"),
  IFCEVAPORATIVECOOLER: r("Resfriador evaporativo", "equipamento", "hvac"),

  // Elétrica
  IFCCABLECARRIERSEGMENT: r("Eletroduto / eletrocalha / leito", "segmento", "eletrica"),
  IFCCABLECARRIERFITTING: r("Conexão de eletroduto / eletrocalha", "conexao", "eletrica"),
  IFCCABLESEGMENT: r("Cabo", "segmento", "eletrica"),
  IFCCABLEFITTING: r("Terminação de cabo", "conexao", "eletrica"),
  IFCJUNCTIONBOX: r("Caixa de passagem", "acessorio", "eletrica"),
  IFCLIGHTFIXTURE: r("Luminária", "terminal", "eletrica"),
  IFCLAMP: r("Lâmpada", "terminal", "eletrica"),
  IFCOUTLET: r("Tomada / ponto", "terminal", "eletrica"),
  IFCSWITCHINGDEVICE: r("Interruptor / comando", "terminal", "eletrica"),
  IFCPROTECTIVEDEVICE: r("Dispositivo de proteção", "acessorio", "eletrica"),
  IFCELECTRICDISTRIBUTIONBOARD: r("Quadro elétrico", "equipamento", "eletrica"),
  IFCELECTRICDISTRIBUTIONPOINT: r("Quadro elétrico", "equipamento", "eletrica"),
  IFCELECTRICAPPLIANCE: r("Equipamento elétrico", "equipamento", "eletrica"),
  IFCELECTRICMOTOR: r("Motor elétrico", "equipamento", "eletrica"),
  IFCELECTRICGENERATOR: r("Gerador", "equipamento", "eletrica"),
  IFCTRANSFORMER: r("Transformador", "equipamento", "eletrica"),
  IFCSOLARDEVICE: r("Painel solar", "equipamento", "eletrica"),
  IFCELECTRICFLOWSTORAGEDEVICE: r("Banco de baterias / nobreak", "equipamento", "eletrica"),
  IFCMOTORCONNECTION: r("Conexão de motor", "acessorio", "eletrica"),

  // Telecom
  IFCCOMMUNICATIONSAPPLIANCE: r("Equipamento de telecom", "equipamento", "telecom"),
  IFCAUDIOVISUALAPPLIANCE: r("Equipamento audiovisual", "equipamento", "telecom"),

  // Genéricos MEP (comuns em IFC2x3)
  IFCFLOWSEGMENT: r("Segmento (genérico)", "segmento", "mep", false),
  IFCFLOWFITTING: r("Conexão (genérica)", "conexao", "mep", false),
  IFCFLOWTERMINAL: r("Terminal (genérico)", "terminal", "mep", false),
  IFCFLOWCONTROLLER: r("Controle de fluxo (genérico)", "acessorio", "mep", false),
  IFCFLOWMOVINGDEVICE: r("Bomba / ventilador (genérico)", "equipamento", "mep", false),
  IFCFLOWSTORAGEDEVICE: r("Armazenamento (genérico)", "equipamento", "mep", false),
  IFCFLOWTREATMENTDEVICE: r("Tratamento (genérico)", "equipamento", "mep", false),
  IFCENERGYCONVERSIONDEVICE: r("Conversão de energia (genérico)", "equipamento", "mep", false),
  IFCDISTRIBUTIONELEMENT: r("Elemento de distribuição", "outro", "mep", false),
  IFCDISTRIBUTIONCONTROLELEMENT: r("Controle (genérico)", "acessorio", "mep", false),
  IFCDISTRIBUTIONFLOWELEMENT: r("Elemento de fluxo (genérico)", "outro", "mep", false),
  IFCDISTRIBUTIONCHAMBERELEMENT: r("Caixa de inspeção / câmara", "acessorio", "mep", false),

  // Estrutura
  IFCBEAM: r("Viga", "construtivo", "estrutura"),
  IFCCOLUMN: r("Pilar", "construtivo", "estrutura"),
  IFCSLAB: r("Laje", "construtivo", "estrutura"),
  IFCFOOTING: r("Fundação", "construtivo", "estrutura"),
  IFCPILE: r("Estaca", "construtivo", "estrutura"),
  IFCMEMBER: r("Elemento estrutural", "construtivo", "estrutura"),
  IFCREINFORCINGBAR: r("Armadura", "construtivo", "estrutura"),

  // Arquitetura
  IFCWALL: r("Parede", "construtivo", "arquitetura"),
  IFCWALLSTANDARDCASE: r("Parede", "construtivo", "arquitetura"),
  IFCCURTAINWALL: r("Fachada cortina", "construtivo", "arquitetura"),
  IFCDOOR: r("Porta", "construtivo", "arquitetura"),
  IFCWINDOW: r("Janela", "construtivo", "arquitetura"),
  IFCROOF: r("Cobertura", "construtivo", "arquitetura"),
  IFCSTAIR: r("Escada", "construtivo", "arquitetura"),
  IFCSTAIRFLIGHT: r("Lance de escada", "construtivo", "arquitetura"),
  IFCRAMP: r("Rampa", "construtivo", "arquitetura"),
  IFCRAILING: r("Guarda-corpo", "construtivo", "arquitetura"),
  IFCCOVERING: r("Revestimento / forro", "construtivo", "arquitetura"),
  IFCPLATE: r("Placa", "construtivo", "arquitetura"),
  IFCFURNISHINGELEMENT: r("Mobiliário", "construtivo", "arquitetura"),
  IFCFURNITURE: r("Mobiliário", "construtivo", "arquitetura"),
  IFCSPACE: r("Ambiente", "outro", "arquitetura"),
};

/** Tipos de saída (tomada) que pertencem a telecom. */
const TELECOM_OUTLETS = new Set(["DATAOUTLET", "TELEPHONEOUTLET", "COMMUNICATIONSOUTLET", "AUDIOVISUALOUTLET"]);

/** IfcDistributionSystemEnum / IfcDistributionSystemTypeEnum -> disciplina. */
const SYSTEM_ENUM: Record<string, Discipline> = {
  DOMESTICCOLDWATER: "hidraulica",
  DOMESTICHOTWATER: "hidraulica",
  DRAINAGE: "hidraulica",
  SEWAGE: "hidraulica",
  STORMWATER: "hidraulica",
  RAINWATER: "hidraulica",
  WASTEWATER: "hidraulica",
  WATERSUPPLY: "hidraulica",
  VENT: "hidraulica",
  FIREPROTECTION: "incendio",
  GAS: "gas",
  FUEL: "gas",
  OIL: "gas",
  AIRCONDITIONING: "hvac",
  VENTILATION: "hvac",
  EXHAUST: "hvac",
  HEATING: "hvac",
  CHILLEDWATER: "hvac",
  CONDENSERWATER: "hvac",
  REFRIGERATION: "hvac",
  COMPRESSEDAIR: "mep",
  VACUUM: "mep",
  ELECTRICAL: "eletrica",
  LIGHTING: "eletrica",
  POWERGENERATION: "eletrica",
  LIGHTNINGPROTECTION: "eletrica",
  EARTHING: "eletrica",
  ELECTROACOUSTIC: "telecom",
  COMMUNICATION: "telecom",
  DATA: "telecom",
  TELEPHONE: "telecom",
  TV: "telecom",
  SECURITY: "telecom",
  SIGNAL: "telecom",
  CONTROL: "telecom",
};

/** Palavras-chave em nomes de sistema (pt-BR e inglês). A ordem importa. */
const SYSTEM_KEYWORDS: [RegExp, Discipline][] = [
  [/inc[eê]ndio|sprinkler|hidrante|chuveiro autom|fire|spk\b/i, "incendio"],
  [/\bg[aá]s\b|glp|\bgn\b|natural gas/i, "gas"],
  [/ventila[cç][aã]o sanit[aá]ria|esgoto|pluvial|sanit[aá]ri/i, "hidraulica"],
  [/climatiza|ar[- ]condicionado|hvac|ventila|exaust|insufla|retorno de ar|renova[cç][aã]o|duto|[aá]gua gelada|chilled|refrigera/i, "hvac"],
  [/dados|telecom|telefon|cftv|l[oó]gica|rede estruturada|data|communication|sinal|seguran[cç]a|alarme/i, "telecom"],
  [/el[eé]tric|ilumina|for[cç]a|tomada|spda|aterramento|electrical|lighting|power/i, "eletrica"],
  [/[aá]gua|hidr[aá]ul|drenag|water|sewer|drain|plumbing|\baf\b|\baq\b/i, "hidraulica"],
];

export function getTypeLabel(ifcType: string): string {
  return TYPE_RULES[ifcType.toUpperCase()]?.label ?? prettifyIfcType(ifcType);
}

export function getCategory(ifcType: string): ElementCategory {
  return TYPE_RULES[ifcType.toUpperCase()]?.category ?? "outro";
}

/** "IFCPIPESEGMENT" -> "IfcPipeSegment" não é trivial; devolvemos algo legível. */
function prettifyIfcType(ifcType: string): string {
  const t = ifcType.toUpperCase().replace(/^IFC/, "");
  return "Ifc" + t.charAt(0) + t.slice(1).toLowerCase();
}

export function disciplineFromSystem(systemName: string | null | undefined, systemEnum?: string | null): Discipline | null {
  if (systemEnum) {
    const d = SYSTEM_ENUM[systemEnum.toUpperCase()];
    if (d) return d;
  }
  if (systemName) {
    for (const [re, d] of SYSTEM_KEYWORDS) if (re.test(systemName)) return d;
  }
  return null;
}

export interface ClassifyInput {
  ifcType: string;
  predefinedType?: string | null;
  systems?: { name: string; predefinedType?: string | null }[];
}

export function classifyDiscipline({ ifcType, predefinedType, systems = [] }: ClassifyInput): Discipline {
  const type = ifcType.toUpperCase();
  const rule = TYPE_RULES[type];

  if (type === "IFCOUTLET" && predefinedType && TELECOM_OUTLETS.has(predefinedType.toUpperCase())) {
    return "telecom";
  }
  if (rule?.strong) return rule.discipline;

  for (const s of systems) {
    const d = disciplineFromSystem(s.name, s.predefinedType);
    if (d) return d;
  }
  if (rule) return rule.discipline;
  return "outros";
}

export function isKnownIfcType(ifcType: string): boolean {
  return ifcType.toUpperCase() in TYPE_RULES;
}

/** Tipos genéricos do IFC2x3 que podem ser refinados pelo objeto de tipo (ex.: IfcPipeSegmentType). */
export function isGenericMepType(ifcType: string): boolean {
  return /^IFC(FLOW|DISTRIBUTION|ENERGYCONVERSIONDEVICE)/.test(ifcType.toUpperCase());
}
