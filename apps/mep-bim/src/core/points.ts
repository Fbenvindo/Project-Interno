// Pontos locados pelo usuário: representação, conversão para ElementInfo
// (para quantitativos, filtros e interferências) e arquivo de projeto.
import { getCategory } from "./disciplines";
import { COMPONENT_BY_ID, type ComponentDef } from "./library";
import type { CoordinateSystem } from "./math";
import { CEILING_REF_LABEL, type CeilingMount, type CeilingRef } from "./placement";
import type { OBB } from "./obb";
import type { BBox, ElementInfo, PropertyGroup, Vec3 } from "./types";

export interface PlacedPoint {
  /** Identificador negativo e único na sessão; usado como expressID na cena. */
  id: number;
  /** GlobalId IFC estável entre sessões. */
  guid: string;
  componentId: string;
  tag: string;
  /** Centro do componente (cena). */
  position: Vec3;
  /** Rotação em torno do eixo vertical (rad). */
  rotation: number;
  /** Altura de montagem (mm), com o significado da fixação do componente. */
  height: number;
  /** Y da superfície de referência (piso ou teto). */
  refLevel: number;
  storey: string | null;
  system: string;
  params: Record<string, string | number>;
  /** Circuito (uid) ao qual o ponto pertence. */
  circuit?: string | null;
  /** Itens de teto: alinhados ao forro, no entreforro ou na laje. */
  ceiling?: CeilingMount;
}

export interface StoreyLevel {
  name: string;
  /** Cota do pavimento na cena (Y). */
  level: number;
}

let nextId = -1;
/** Novo identificador de sessão para um ponto (sempre negativo). */
export function newPointId(): number {
  return nextId--;
}

const GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** GlobalId IFC aleatório (22 caracteres; o primeiro entre 0 e 3). */
export function newGuid(): string {
  const bytes = new Uint8Array(22);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b, i) => GUID_CHARS[i === 0 ? b % 4 : b % 64]).join("");
}

/** Pavimento de uma cota: o mais alto cujo nível está abaixo (tolerância de 5 cm). */
export function storeyAt(y: number, levels: StoreyLevel[]): string | null {
  if (!levels.length) return null;
  const sorted = [...levels].sort((a, b) => a.level - b.level);
  let found = sorted[0];
  for (const s of sorted) if (s.level <= y + 0.05) found = s;
  return found.name;
}

/**
 * Pavimento de um componente pela superfície onde ele é fixado: itens de
 * parede e piso pertencem ao pavimento do piso; itens de teto, ao pavimento
 * do ambiente abaixo do teto (e não ao pavimento de cima da laje).
 */
export function storeyForMounting(mounting: ComponentDef["mounting"], refLevel: number, levels: StoreyLevel[]): string | null {
  return storeyAt(mounting === "teto" ? refLevel - 0.1 : refLevel, levels);
}

/** Próxima etiqueta livre para o prefixo (ex.: L1, L2… ou T7). */
export function nextTag(points: PlacedPoint[], prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[^A-Za-z0-9]/g, "")}(\\d+)$`);
  let max = 0;
  for (const p of points) {
    const m = p.tag.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function defaultParams(def: ComponentDef): Record<string, string | number> {
  return Object.fromEntries(def.params.map((p) => [p.name, p.default]));
}

export function pointBBox(p: PlacedPoint, def: ComponentDef): BBox {
  const [w, d, h] = def.size.map((v) => v / 2000);
  const c = Math.abs(Math.cos(p.rotation));
  const s = Math.abs(Math.sin(p.rotation));
  const ex = c * w + s * d;
  const ez = s * w + c * d;
  const [x, y, z] = p.position;
  return { min: [x - ex, y - h, z - ez], max: [x + ex, y + h, z + ez] };
}

/** Caixa orientada do componente (cilindros aproximados pela caixa circunscrita). */
export function pointOBB(p: PlacedPoint, def: ComponentDef): OBB {
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return {
    center: p.position,
    axes: [[c, 0, -s], [0, 1, 0], [s, 0, c]],
    half: [def.size[0] / 2000, def.size[2] / 2000, def.size[1] / 2000],
  };
}

export function pointToElement(p: PlacedPoint): ElementInfo {
  const def = COMPONENT_BY_ID[p.componentId];
  return {
    expressID: p.id,
    globalId: p.guid,
    ifcType: def.ifcType,
    name: `${p.tag} - ${def.label}`,
    objectType: def.label,
    predefinedType: def.predefinedType,
    storey: p.storey,
    systems: p.system ? [p.system] : [],
    discipline: def.discipline,
    category: getCategory(def.ifcType),
    bbox: pointBBox(p, def),
    length: null,
    size: null,
    origin: "locacao",
    obb: pointOBB(p, def),
  };
}

export function pointProperties(p: PlacedPoint): PropertyGroup[] {
  const def = COMPONENT_BY_ID[p.componentId];
  const unitOf = new Map(def.params.map((x) => [x.name, x.unit]));
  return [
    {
      name: "Locação",
      kind: "propriedades",
      values: [
        { name: "Etiqueta", value: p.tag },
        { name: "Componente", value: def.label },
        { name: "Fixação", value: def.mounting },
        ...(p.ceiling ? [{ name: "Referência no teto", value: CEILING_REF_LABEL[p.ceiling.ref] }] : []),
        ...(p.ceiling && p.ceiling.ref !== "laje"
          ? [{ name: p.ceiling.ref === "forro" ? "Altura do forro (sem forro no modelo)" : "Altura do fundo (piso)", value: `${Math.round(p.ceiling.level)} mm` }]
          : []),
        { name: heightLabel(def), value: `${Math.round(p.height)} mm` },
        { name: "Dimensões (L×P×A)", value: `${def.size.join("×")} mm` },
        ...Object.entries(p.params).map(([name, value]) => ({
          name: unitOf.get(name) ? `${name} (${unitOf.get(name)})` : name,
          value,
        })),
      ],
    },
  ];
}

export function heightLabel(def: ComponentDef): string {
  if (def.mounting === "parede") return "Altura do centro (piso)";
  if (def.mounting === "teto") return "Afastamento do teto";
  return "Altura acima do piso";
}

// ---- Arquivo de locação (.mepbim.json) -------------------------------------

export const LOCACAO_FORMAT = "mep-bim/locacao";

interface StoredPoint {
  guid: string;
  componente: string;
  etiqueta: string;
  /** Centro em coordenadas IFC (metros, Z para cima). */
  posicao: Vec3;
  /** Cota IFC (m) da superfície de referência. */
  nivelReferencia: number;
  rotacao: number;
  altura: number;
  pavimento: string | null;
  sistema: string;
  parametros: Record<string, string | number>;
  circuito?: string | null;
  /** Itens de teto: referência e altura (mm acima do piso). */
  teto?: { referencia: CeilingRef; alturaMm: number };
}

export interface LocacaoFile {
  formato: typeof LOCACAO_FORMAT;
  versao: 1 | 2 | 3;
  modeloIfc: string | null;
  salvoEm: string;
  pontos: StoredPoint[];
}

export function serializePoints(points: PlacedPoint[], cs: CoordinateSystem, modelName: string | null): LocacaoFile {
  return {
    formato: LOCACAO_FORMAT,
    versao: 1,
    modeloIfc: modelName,
    salvoEm: new Date().toISOString(),
    pontos: points.map((p) => ({
      guid: p.guid,
      componente: p.componentId,
      etiqueta: p.tag,
      posicao: cs.worldToIfc(p.position).map(round6) as Vec3,
      nivelReferencia: round6(cs.worldToIfc([p.position[0], p.refLevel, p.position[2]])[2]),
      rotacao: round6(p.rotation),
      altura: p.height,
      pavimento: p.storey,
      sistema: p.system,
      parametros: p.params,
      ...(p.circuit ? { circuito: p.circuit } : {}),
      ...(p.ceiling ? { teto: { referencia: p.ceiling.ref, alturaMm: p.ceiling.level } } : {}),
    })),
  };
}

export function deserializePoints(json: unknown, cs: CoordinateSystem): PlacedPoint[] {
  const file = json as LocacaoFile;
  if (!file || file.formato !== LOCACAO_FORMAT || !Array.isArray(file.pontos)) {
    throw new Error("Arquivo de locação inválido.");
  }
  return file.pontos.map((s) => {
    if (!COMPONENT_BY_ID[s.componente]) throw new Error(`Componente desconhecido: ${s.componente}`);
    const [x, y] = s.posicao;
    return {
      id: newPointId(),
      guid: s.guid,
      componentId: s.componente,
      tag: s.etiqueta,
      position: cs.ifcToWorld(s.posicao),
      rotation: s.rotacao,
      height: s.altura,
      refLevel: cs.ifcToWorld([x, y, s.nivelReferencia])[1],
      storey: s.pavimento,
      system: s.sistema,
      params: s.parametros ?? {},
      circuit: s.circuito ?? null,
      ...(s.teto && s.teto.referencia in CEILING_REF_LABEL ? { ceiling: { ref: s.teto.referencia, level: Number(s.teto.alturaMm) || 0 } } : {}),
    };
  });
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
