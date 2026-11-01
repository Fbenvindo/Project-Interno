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
 * Padrão inicial. Alturas usuais no Brasil (eixo do ponto acima do piso acabado):
 * confira com o padrão do cliente e com os fabricantes dos equipamentos.
 */
export const DEFAULT_CATALOG: EquipmentType[] = [
  {
    id: "bacia",
    label: "Bacia sanitária",
    keywords: ["bacia", "vaso sanitario", "vaso", "toilet", "water closet", "wc"],
    reqs: [R("ponto-agua-fria", { height: 300, lateral: -0.2, params: { Diâmetro: 25 } }), R("ponto-esgoto", { recuo: 0.3, params: { Diâmetro: 100 } })],
  },
  {
    id: "ducha-higienica",
    label: "Ducha higiênica",
    keywords: ["ducha higienica", "bidet", "bide"],
    reqs: [R("ponto-agua-fria", { height: 600, params: { Diâmetro: 20 } })],
  },
  {
    id: "lavatorio",
    label: "Lavatório",
    keywords: ["lavatorio", "lavabo", "cuba de apoio", "cuba de embutir", "washbasin", "wash basin", "lavatory"],
    reqs: [R("ponto-agua-fria", { height: 600, lateral: -0.1, params: { Diâmetro: 20 } }), R("saida-esgoto-parede", { height: 500, params: { Diâmetro: 40 } })],
  },
  {
    id: "chuveiro",
    label: "Chuveiro",
    keywords: ["chuveiro", "ducha", "shower"],
    reqs: [
      R("ponto-agua-fria", { height: 2200, params: { Diâmetro: 25 } }),
      R("tomada-alta", { height: 2200, lateral: 0.15, params: { Potência: 5500, Tensão: 220 } }),
      R("ralo-sifonado", { recuo: 0.5 }),
    ],
  },
  {
    id: "pia-cozinha",
    label: "Pia de cozinha",
    keywords: ["pia", "cuba", "kitchen sink", "sink"],
    reqs: [
      R("ponto-agua-fria", { height: 600, lateral: -0.1, params: { Diâmetro: 25 } }),
      R("saida-esgoto-parede", { height: 500, params: { Diâmetro: 50 } }),
      R("tomada-media", { qty: 2, height: 1100, lateral: 0.6, params: { Potência: 600, Tensão: 127 } }),
    ],
  },
  {
    id: "tanque",
    label: "Tanque",
    keywords: ["tanque", "laundry tub", "utility sink"],
    reqs: [R("ponto-agua-fria", { height: 1000, params: { Diâmetro: 25 } }), R("saida-esgoto-parede", { height: 500, params: { Diâmetro: 40 } })],
  },
  {
    id: "maquina-lavar-roupa",
    label: "Máquina de lavar roupa",
    keywords: ["maquina de lavar roupa", "lavadora", "lava e seca", "washing machine", "washer"],
    reqs: [
      R("ponto-agua-fria", { height: 900, params: { Diâmetro: 20 } }),
      R("saida-esgoto-parede", { height: 900, lateral: 0.2, params: { Diâmetro: 50 } }),
      R("tomada-media", { height: 1100, lateral: -0.3, params: { Potência: 1000, Tensão: 127 } }),
    ],
  },
  {
    id: "lava-loucas",
    label: "Máquina de lavar louça",
    keywords: ["lava loucas", "lava-loucas", "maquina de lavar louca", "dishwasher"],
    reqs: [
      R("ponto-agua-fria", { height: 300, params: { Diâmetro: 20 } }),
      R("saida-esgoto-parede", { height: 400, lateral: 0.2, params: { Diâmetro: 40 } }),
      R("tomada-baixa", { height: 300, lateral: -0.3, params: { Potência: 1500, Tensão: 220 } }),
    ],
  },
  {
    id: "geladeira",
    label: "Geladeira",
    keywords: ["geladeira", "refrigerador", "freezer", "refrigerator", "fridge"],
    reqs: [R("tomada-baixa", { height: 300, params: { Potência: 500, Tensão: 127 } })],
  },
  {
    id: "fogao",
    label: "Fogão / cooktop",
    keywords: ["fogao", "cooktop", "cook top", "stove", "range", "cooker"],
    reqs: [R("ponto-gas", { height: 300, lateral: -0.2 }), R("tomada-baixa", { height: 300, lateral: 0.3, params: { Potência: 100, Tensão: 127 } })],
  },
  {
    id: "forno",
    label: "Forno elétrico",
    keywords: ["forno", "oven"],
    reqs: [R("tomada-media", { height: 1100, params: { Potência: 2500, Tensão: 220 } })],
  },
  {
    id: "micro-ondas",
    label: "Micro-ondas",
    keywords: ["micro-ondas", "micro ondas", "microondas", "microwave"],
    reqs: [R("tomada-alta", { height: 2000, params: { Potência: 1500, Tensão: 127 } })],
  },
  {
    id: "coifa",
    label: "Coifa / depurador",
    keywords: ["coifa", "depurador", "exaustor de cozinha", "range hood", "hood"],
    reqs: [R("tomada-alta", { height: 2200, params: { Potência: 300, Tensão: 127 } })],
  },
  {
    id: "aquecedor",
    label: "Aquecedor de água",
    keywords: ["aquecedor", "boiler", "water heater", "acumulador"],
    reqs: [
      R("ponto-agua-fria", { height: 1500, lateral: -0.15, params: { Diâmetro: 25 } }),
      R("ponto-agua-quente", { height: 1500, lateral: 0.15, params: { Diâmetro: 22 } }),
      R("tomada-alta", { height: 1800, lateral: 0.4, params: { Potência: 2000, Tensão: 220 } }),
    ],
  },
  {
    id: "televisao",
    label: "Televisão",
    keywords: ["televisao", "televisor", "tv", "television", "monitor"],
    reqs: [R("tomada-media", { qty: 2, height: 1300, params: { Potência: 200, Tensão: 127 } }), R("ponto-tv", { height: 1300, lateral: 0.3 }), R("ponto-dados", { height: 1300, lateral: -0.3 })],
  },
  {
    id: "estacao-trabalho",
    label: "Estação de trabalho / mesa",
    keywords: ["estacao de trabalho", "mesa de trabalho", "mesa de escritorio", "escrivaninha", "workstation", "desk"],
    reqs: [R("tomada-baixa", { qty: 2, height: 300, params: { Potência: 200, Tensão: 127 } }), R("ponto-dados", { qty: 2, height: 300, lateral: 0.5 })],
  },
  {
    id: "ar-condicionado",
    label: "Ar-condicionado (evaporadora)",
    keywords: ["evaporadora", "split", "ar condicionado", "ar-condicionado", "air conditioner", "fan coil"],
    reqs: [R("tomada-alta", { height: 2200, lateral: 0.5, params: { Potência: 1500, Tensão: 220 } })],
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

/** Pedido de ponto a gerar: origem (equipamento ou ambiente) e a instalação. */
export interface PointRequest {
  roomId: string;
  /** Rótulo do equipamento (ou "Ambiente"). */
  source: string;
  /** Posição do equipamento (cena), ou null para instalações do ambiente. */
  center: Vec3 | null;
  req: Requirement;
}

/** Todos os pontos que o programa de um ambiente pede. */
export function roomRequests(roomId: string, room: RoomProgram | undefined, instances: EquipmentInstance[], catalog: EquipmentType[]): PointRequest[] {
  const out: PointRequest[] = [];
  for (const inst of instances) {
    const eq = roomEquipment(room, inst);
    if (!eq.include) continue;
    for (const req of effectiveReqs(eq, catalog)) out.push({ roomId, source: inst.name, center: inst.center, req });
  }
  for (const [key, eq] of Object.entries(room?.equipment ?? {})) {
    if (!eq.manual || !eq.include) continue;
    for (const req of effectiveReqs(eq, catalog)) out.push({ roomId, source: eq.manual.label || key, center: null, req });
  }
  for (const req of room?.extras ?? []) out.push({ roomId, source: "Ambiente", center: null, req });
  return out;
}

/** Quantidade total de pontos pedidos. */
export const countPoints = (reqs: PointRequest[]) => reqs.reduce((s, r) => s + Math.max(0, r.req.qty), 0);

/** Parâmetro que marca os pontos gerados pelo programa (para regerar sem duplicar). */
export const PROGRAM_ORIGIN = "Programa de necessidades";
