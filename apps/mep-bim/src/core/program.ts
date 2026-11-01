// Programa de necessidades: levantamento dos equipamentos do IFC por ambiente e
// as instalações que cada tipo de equipamento pede (padrão do escritório),
// personalizáveis por ambiente e por equipamento.
import type { ElementInfo, Vec3 } from "./types";
import type { Space } from "./spaces";
import type { P2 } from "./plan/section";

/** Uma instalação pedida por um equipamento (ou pelo ambiente). */
export interface Requirement {
  id: string;
  componentId: string;
  qty: number;
  /** mm; vazio = altura padrão do componente. */
  height?: number;
  /** m, ao longo da parede a partir da projeção do equipamento (+ para a direita de quem olha a parede). */
  lateral?: number;
  /** m, afastamento da parede (itens de piso). Vazio = no centro do equipamento. */
  recuo?: number;
  /** Parâmetros do ponto (ex.: Potência, Tensão, Diâmetro). */
  params?: Record<string, string | number>;
}

export interface EquipmentType {
  id: string;
  label: string;
  /** Dados técnicos do equipamento (levados aos pontos). */
  tech?: TechData;
  /** Palavras que identificam o equipamento no nome/tipo do objeto do IFC (sem acento, minúsculas). */
  keywords: string[];
  reqs: Requirement[];
}

/** Equipamento de um ambiente: do IFC (chave = GlobalId) ou incluído à mão. */
export interface RoomEquipment {
  typeId: string | null;
  include: boolean;
  /** Instalações próprias deste equipamento (substituem as do tipo). */
  reqs?: Requirement[];
  /** Dados técnicos próprios (sobrepõem os do tipo, campo a campo). */
  tech?: TechData;
  /** Incluído à mão (sem objeto no IFC). */
  manual?: { label: string };
}

export interface RoomProgram {
  equipment: Record<string, RoomEquipment>;
  /** Instalações do ambiente (independentes de equipamento): tomadas de uso geral, dados… */
  extras: Requirement[];
}

export interface ProgramState {
  /** Por GlobalId do IfcSpace. */
  rooms: Record<string, RoomProgram>;
}

export const EMPTY_PROGRAM: ProgramState = { rooms: {} };

let seq = 0;
export const reqId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
const R = (componentId: string, extra: Omit<Requirement, "id" | "componentId" | "qty"> & { qty?: number } = {}): Requirement => ({
  id: `${componentId}-${seq++}`,
  componentId,
  qty: extra.qty ?? 1,
  ...extra,
});

/**
 * Dados técnicos do equipamento, levados aos pontos gerados:
 * potência e tensão → tomada que alimenta o equipamento (e daí ao quadro de cargas);
 * pesos (NBR 5626) → pontos de água fria/quente; UHC e diâmetro (NBR 8160) → ponto de esgoto.
 */
export interface TechData {
  /** W ou VA (como no catálogo do fabricante). */
  potencia?: number;
  tensao?: number;
  /** Peso relativo de água fria (NBR 5626). */
  pesoAF?: number;
  /** Peso relativo de água quente (NBR 5626). */
  pesoAQ?: number;
  /** Unidades Hunter de contribuição (NBR 8160). */
  uhc?: number;
  /** Diâmetro nominal mínimo do ramal de descarga (mm, NBR 8160). */
  diamEsgoto?: number;
}

export const TECH_FIELDS: { key: keyof TechData; label: string; unit: string; step: number }[] = [
  { key: "potencia", label: "Potência", unit: "W/VA", step: 50 },
  { key: "tensao", label: "Tensão", unit: "V", step: 1 },
  { key: "pesoAF", label: "Peso AF", unit: "NBR 5626", step: 0.1 },
  { key: "pesoAQ", label: "Peso AQ", unit: "NBR 5626", step: 0.1 },
  { key: "uhc", label: "UHC", unit: "NBR 8160", step: 1 },
  { key: "diamEsgoto", label: "Ø esgoto", unit: "mm", step: 10 },
];

/**
 * Padrão inicial. Alturas usuais no Brasil (eixo do ponto acima do piso acabado);
 * pesos da NBR 5626 (tabela de pesos relativos) e UHC/diâmetros mínimos da NBR 8160
 * (aparelhos residenciais). Confira com o padrão do cliente e com os fabricantes.
 */
export const DEFAULT_CATALOG: EquipmentType[] = [
  {
    id: "bacia",
    label: "Bacia sanitária",
    keywords: ["bacia", "vaso sanitario", "vaso", "toilet", "water closet", "wc"],
    tech: { pesoAF: 0.3, uhc: 6, diamEsgoto: 100 },
    reqs: [R("ponto-agua-fria", { height: 300, lateral: -0.2 }), R("ponto-esgoto", { recuo: 0.3 })],
  },
  {
    id: "ducha-higienica",
    label: "Ducha higiênica",
    keywords: ["ducha higienica", "bidet", "bide"],
    tech: { pesoAF: 0.4 },
    reqs: [R("ponto-agua-fria", { height: 600 })],
  },
  {
    id: "lavatorio",
    label: "Lavatório",
    keywords: ["lavatorio", "lavabo", "cuba de apoio", "cuba de embutir", "washbasin", "wash basin", "lavatory"],
    tech: { pesoAF: 0.3, uhc: 1, diamEsgoto: 40 },
    reqs: [R("ponto-agua-fria", { height: 600, lateral: -0.1 }), R("saida-esgoto-parede", { height: 500 })],
  },
  {
    id: "chuveiro",
    label: "Chuveiro",
    keywords: ["chuveiro", "ducha", "shower"],
    tech: { potencia: 5500, tensao: 220, pesoAF: 0.4, uhc: 2, diamEsgoto: 40 },
    reqs: [R("ponto-agua-fria", { height: 2200 }), R("tomada-alta", { height: 2200, lateral: 0.15 }), R("ralo-sifonado", { recuo: 0.5 })],
  },
  {
    id: "pia-cozinha",
    label: "Pia de cozinha",
    keywords: ["pia", "cuba", "kitchen sink", "sink"],
    tech: { pesoAF: 0.7, uhc: 3, diamEsgoto: 50 },
    reqs: [
      R("ponto-agua-fria", { height: 600, lateral: -0.1 }),
      R("saida-esgoto-parede", { height: 500 }),
      R("tomada-media", { qty: 2, height: 1100, lateral: 0.6, params: { Potência: 600, Tensão: 127 } }),
    ],
  },
  {
    id: "tanque",
    label: "Tanque",
    keywords: ["tanque", "laundry tub", "utility sink"],
    tech: { pesoAF: 0.7, uhc: 3, diamEsgoto: 40 },
    reqs: [R("ponto-agua-fria", { height: 1000 }), R("saida-esgoto-parede", { height: 500 })],
  },
  {
    id: "maquina-lavar-roupa",
    label: "Máquina de lavar roupa",
    keywords: ["maquina de lavar roupa", "lavadora", "lava e seca", "washing machine", "washer"],
    tech: { potencia: 1000, tensao: 127, pesoAF: 1.0, uhc: 3, diamEsgoto: 50 },
    reqs: [R("ponto-agua-fria", { height: 900 }), R("saida-esgoto-parede", { height: 900, lateral: 0.2 }), R("tomada-media", { height: 1100, lateral: -0.3 })],
  },
  {
    id: "lava-loucas",
    label: "Máquina de lavar louça",
    keywords: ["lava loucas", "lava-loucas", "maquina de lavar louca", "dishwasher"],
    tech: { potencia: 1500, tensao: 220, pesoAF: 1.0, uhc: 2, diamEsgoto: 50 },
    reqs: [R("ponto-agua-fria", { height: 300 }), R("saida-esgoto-parede", { height: 400, lateral: 0.2 }), R("tomada-baixa", { height: 300, lateral: -0.3 })],
  },
  {
    id: "geladeira",
    label: "Geladeira",
    keywords: ["geladeira", "refrigerador", "freezer", "refrigerator", "fridge"],
    tech: { potencia: 500, tensao: 127 },
    reqs: [R("tomada-baixa", { height: 300 })],
  },
  {
    id: "fogao",
    label: "Fogão / cooktop",
    keywords: ["fogao", "cooktop", "cook top", "stove", "range", "cooker"],
    tech: { potencia: 100, tensao: 127 },
    reqs: [R("tomada-baixa", { height: 300, lateral: 0.3 }), R("ponto-gas", { height: 300, lateral: -0.2 })],
  },
  {
    id: "forno",
    label: "Forno elétrico",
    keywords: ["forno", "oven"],
    tech: { potencia: 2500, tensao: 220 },
    reqs: [R("tomada-media", { height: 1100 })],
  },
  {
    id: "micro-ondas",
    label: "Micro-ondas",
    keywords: ["micro-ondas", "micro ondas", "microondas", "microwave"],
    tech: { potencia: 1500, tensao: 127 },
    reqs: [R("tomada-alta", { height: 2000 })],
  },
  {
    id: "coifa",
    label: "Coifa / depurador",
    keywords: ["coifa", "depurador", "exaustor de cozinha", "range hood", "hood"],
    tech: { potencia: 300, tensao: 127 },
    reqs: [R("tomada-alta", { height: 2200 })],
  },
  {
    id: "aquecedor",
    label: "Aquecedor de água",
    keywords: ["aquecedor", "boiler", "water heater", "acumulador"],
    tech: { potencia: 2000, tensao: 220, pesoAF: 0.4, pesoAQ: 0.4 },
    reqs: [
      R("tomada-alta", { height: 1800, lateral: 0.4 }),
      R("ponto-agua-fria", { height: 1500, lateral: -0.15 }),
      R("ponto-agua-quente", { height: 1500, lateral: 0.15 }),
    ],
  },
  {
    id: "televisao",
    label: "Televisão",
    keywords: ["televisao", "televisor", "tv", "television", "monitor"],
    tech: { potencia: 200, tensao: 127 },
    reqs: [R("tomada-media", { qty: 2, height: 1300 }), R("ponto-tv", { height: 1300, lateral: 0.3 }), R("ponto-dados", { height: 1300, lateral: -0.3 })],
  },
  {
    id: "estacao-trabalho",
    label: "Estação de trabalho / mesa",
    keywords: ["estacao de trabalho", "mesa de trabalho", "mesa de escritorio", "escrivaninha", "workstation", "desk"],
    tech: { potencia: 300, tensao: 127 },
    reqs: [R("tomada-baixa", { qty: 2, height: 300 }), R("ponto-dados", { qty: 2, height: 300, lateral: 0.5 })],
  },
  {
    id: "ar-condicionado",
    label: "Ar-condicionado (evaporadora)",
    keywords: ["evaporadora", "split", "ar condicionado", "ar-condicionado", "air conditioner", "fan coil"],
    tech: { potencia: 1500, tensao: 220 },
    reqs: [R("tomada-alta", { height: 2200, lateral: 0.5 })],
  },
];

/** Classes IFC de objetos que podem ser equipamentos (móveis, louças, eletrodomésticos…). */
export const EQUIPMENT_CLASSES = new Set([
  "IFCSANITARYTERMINAL",
  "IFCFURNITURE",
  "IFCFURNISHINGELEMENT",
  "IFCSYSTEMFURNITUREELEMENT",
  "IFCELECTRICAPPLIANCE",
  "IFCBUILDINGELEMENTPROXY",
  "IFCFLOWTERMINAL",
  "IFCCOMMUNICATIONSAPPLIANCE",
  "IFCAUDIOVISUALAPPLIANCE",
  "IFCUNITARYEQUIPMENT",
  "IFCSPACEHEATER",
  "IFCTANK",
  "IFCBOILER",
]);

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_:]/g, " ");

/** Tipo de equipamento pelo nome/tipo do objeto: a palavra-chave mais longa encontrada vence. */
export function detectType(el: Pick<ElementInfo, "name" | "objectType" | "predefinedType">, catalog: EquipmentType[]): string | null {
  const text = ` ${norm(`${el.name} ${el.objectType ?? ""} ${el.predefinedType ?? ""}`)} `;
  let best: { id: string; len: number } | null = null;
  for (const t of catalog) {
    for (const k of t.keywords) {
      const kw = norm(k).trim();
      if (!kw) continue;
      // Palavras curtas (tv, wc, pia) só valem como palavra inteira.
      const hit = kw.length <= 3 ? new RegExp(`[^a-z0-9]${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}[^a-z0-9]`).test(text) : text.includes(kw);
      if (hit && (!best || kw.length > best.len)) best = { id: t.id, len: kw.length };
    }
  }
  return best?.id ?? null;
}

export interface EquipmentInstance {
  /** GlobalId do objeto no IFC. */
  key: string;
  expressID: number;
  name: string;
  ifcType: string;
  /** Centro em planta na cota do piso do ambiente (cena). */
  center: Vec3;
  detected: string | null;
}

/** Equipamentos do IFC em cada ambiente (por GlobalId do IfcSpace). */
export function roomInventory(
  elements: ElementInfo[],
  spaces: Space[],
  toPlan: (v: Vec3) => P2,
  catalog: EquipmentType[],
): Map<string, EquipmentInstance[]> {
  const out = new Map<string, EquipmentInstance[]>(spaces.map((s) => [s.globalId, []]));
  for (const e of elements) {
    if (!EQUIPMENT_CLASSES.has(e.ifcType) || !e.bbox || e.origin === "locacao") continue;
    const c: Vec3 = [(e.bbox.min[0] + e.bbox.max[0]) / 2, e.bbox.min[1] + 0.05, (e.bbox.min[2] + e.bbox.max[2]) / 2];
    const p = toPlan(c);
    const room = spaces.find((s) => c[1] >= s.floorY - 0.3 && c[1] <= s.topY + 0.3 && inside(p, s.polygon));
    if (!room) continue;
    out.get(room.globalId)!.push({ key: e.globalId, expressID: e.expressID, name: e.name || e.objectType || e.ifcType, ifcType: e.ifcType, center: [c[0], room.floorY, c[2]], detected: detectType(e, catalog) });
  }
  return out;
}

function inside(p: P2, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Situação de um equipamento do IFC no programa do ambiente (padrão quando não personalizado). */
export function roomEquipment(room: RoomProgram | undefined, inst: EquipmentInstance): RoomEquipment {
  return room?.equipment[inst.key] ?? { typeId: inst.detected, include: inst.detected != null };
}

/** Instalações efetivas de um equipamento: as próprias, senão as do tipo. */
export function effectiveReqs(eq: RoomEquipment, catalog: EquipmentType[]): Requirement[] {
  if (eq.reqs) return eq.reqs;
  return catalog.find((t) => t.id === eq.typeId)?.reqs ?? [];
}

/** Dados técnicos efetivos: os do equipamento sobre os do tipo. */
export function effectiveTech(eq: RoomEquipment, catalog: EquipmentType[]): TechData {
  const base = catalog.find((t) => t.id === eq.typeId)?.tech ?? {};
  const out: TechData = { ...base };
  for (const [k, v] of Object.entries(eq.tech ?? {})) {
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) delete out[k as keyof TechData];
    else out[k as keyof TechData] = v;
  }
  return out;
}

/** Pedido de ponto a gerar: origem (equipamento ou ambiente) e a instalação. */
export interface PointRequest {
  roomId: string;
  /** Rótulo do equipamento (ou "Ambiente"). */
  source: string;
  /** Posição do equipamento (cena), ou null para instalações do ambiente. */
  center: Vec3 | null;
  req: Requirement;
  /** Dados técnicos do equipamento de origem. */
  tech: TechData;
  /** Chave do equipamento (para levar os dados técnicos a um ponto só de cada tipo). */
  equipKey: string;
}

/** Todos os pontos que o programa de um ambiente pede. */
export function roomRequests(roomId: string, room: RoomProgram | undefined, instances: EquipmentInstance[], catalog: EquipmentType[]): PointRequest[] {
  const out: PointRequest[] = [];
  for (const inst of instances) {
    const eq = roomEquipment(room, inst);
    if (!eq.include) continue;
    const tech = effectiveTech(eq, catalog);
    for (const req of effectiveReqs(eq, catalog)) out.push({ roomId, source: inst.name, center: inst.center, req, tech, equipKey: inst.key });
  }
  for (const [key, eq] of Object.entries(room?.equipment ?? {})) {
    if (!eq.manual || !eq.include) continue;
    const tech = effectiveTech(eq, catalog);
    for (const req of effectiveReqs(eq, catalog)) out.push({ roomId, source: eq.manual.label || key, center: null, req, tech, equipKey: key });
  }
  for (const req of room?.extras ?? []) out.push({ roomId, source: "Ambiente", center: null, req, tech: {}, equipKey: "" });
  return out;
}

/** Quantidade total de pontos pedidos. */
export const countPoints = (reqs: PointRequest[]) => reqs.reduce((s, r) => s + Math.max(0, r.req.qty), 0);

/** Parâmetro que marca os pontos gerados pelo programa (para regerar sem duplicar). */
export const PROGRAM_ORIGIN = "Programa de necessidades";

// ---- Parâmetros dos pontos -----------------------------------------------------------------

/** Papel do ponto em relação aos dados técnicos do equipamento. */
function roleOf(componentId: string, def: { discipline: string; params: { name: string }[] } | undefined): "eletrica" | "af" | "aq" | "esgoto" | null {
  if (componentId === "ponto-agua-fria") return "af";
  if (componentId === "ponto-agua-quente") return "aq";
  if (componentId === "ponto-esgoto" || componentId === "saida-esgoto-parede" || componentId === "ralo-sifonado") return "esgoto";
  if (def?.discipline === "eletrica" && def.params.some((p) => p.name === "Potência")) return "eletrica";
  return null;
}

export const PARAM_PESO = "Peso (NBR 5626)";
export const PARAM_UHC = "UHC (NBR 8160)";

/**
 * Parâmetros de cada ponto a gerar (já com a quantidade expandida). Os dados técnicos
 * do equipamento vão para o primeiro ponto de cada papel (a tomada que o alimenta, o
 * ponto de água fria, o de água quente e a saída de esgoto); valores informados na
 * própria instalação prevalecem.
 */
export function expandRequests(
  reqs: PointRequest[],
  defOf: (componentId: string) => { discipline: string; params: { name: string; default: string | number }[] } | undefined,
): { request: PointRequest; index: number; params: Record<string, string | number> }[] {
  const used = new Set<string>();
  const out: { request: PointRequest; index: number; params: Record<string, string | number> }[] = [];
  for (const r of reqs) {
    const def = defOf(r.req.componentId);
    const role = roleOf(r.req.componentId, def);
    for (let i = 0; i < Math.max(0, Math.round(r.req.qty)); i++) {
      const params: Record<string, string | number> = Object.fromEntries((def?.params ?? []).map((p) => [p.name, p.default]));
      const key = `${r.equipKey}|${role}`;
      if (r.equipKey && role && !used.has(key)) {
        const t = r.tech;
        let applied = false;
        if (role === "eletrica" && (t.potencia != null || t.tensao != null)) {
          if (t.potencia != null) params["Potência"] = t.potencia;
          if (t.tensao != null) params["Tensão"] = t.tensao;
          applied = true;
        } else if (role === "af" && t.pesoAF != null) {
          params[PARAM_PESO] = t.pesoAF;
          applied = true;
        } else if (role === "aq" && t.pesoAQ != null) {
          params[PARAM_PESO] = t.pesoAQ;
          applied = true;
        } else if (role === "esgoto" && (t.uhc != null || t.diamEsgoto != null)) {
          if (t.uhc != null) params[PARAM_UHC] = t.uhc;
          if (t.diamEsgoto != null && "Diâmetro" in params) params["Diâmetro"] = t.diamEsgoto;
          applied = true;
        }
        if (applied) used.add(key);
      }
      Object.assign(params, r.req.params ?? {});
      out.push({ request: r, index: i, params });
    }
  }
  return out;
}

export interface ProgramTotals {
  /** Soma das potências das tomadas (W/VA). */
  potencia: number;
  pesosAF: number;
  pesosAQ: number;
  uhc: number;
  /** Vazão estimada de água fria pela soma dos pesos (L/s): Q = 0,3·√ΣP. */
  vazaoAF: number;
}

export function totalsOf(points: { request: PointRequest; params: Record<string, string | number> }[], defOf: (id: string) => { discipline: string; params: { name: string }[] } | undefined): ProgramTotals {
  const t: ProgramTotals = { potencia: 0, pesosAF: 0, pesosAQ: 0, uhc: 0, vazaoAF: 0 };
  for (const p of points) {
    const role = roleOf(p.request.req.componentId, defOf(p.request.req.componentId));
    const n = (k: string) => (typeof p.params[k] === "number" ? (p.params[k] as number) : Number(p.params[k]) || 0);
    if (role === "eletrica") t.potencia += n("Potência");
    if (role === "af") t.pesosAF += n(PARAM_PESO);
    if (role === "aq") t.pesosAQ += n(PARAM_PESO);
    if (role === "esgoto") t.uhc += n(PARAM_UHC);
  }
  t.vazaoAF = 0.3 * Math.sqrt(t.pesosAF);
  return t;
}
