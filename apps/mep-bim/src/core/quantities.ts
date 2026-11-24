import { DISCIPLINE_BY_ID, getTypeLabel } from "./disciplines";
import type { BBox, Discipline, ElementCategory, ElementInfo, PropertyGroup, PropertyValue } from "./types";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Procura o primeiro valor numérico cujo nome (normalizado) esteja em `names`. */
function findNumber(groups: PropertyGroup[], names: string[], kind?: PropertyGroup["kind"]): number | null {
  const wanted = names.map(norm);
  for (const key of wanted) {
    for (const g of groups) {
      if (kind && g.kind !== kind) continue;
      for (const v of g.values) {
        if (norm(v.name) === key) {
          const n = toNumber(v.value);
          if (n != null && n > 0) return n;
        }
      }
    }
  }
  return null;
}

function toNumber(v: PropertyValue): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.replace(",", ".").match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return null;
}

const LENGTH_NAMES = ["Length", "Comprimento", "NominalLength", "Comprimento total", "CenterLineLength"];

/**
 * Comprimento do segmento em metros.
 * 1º quantidades IFC (Qto_*), 2º propriedades, 3º maior dimensão da caixa envolvente.
 * `unitToMeters` converte a unidade de comprimento do projeto para metros.
 */
export function deriveLength(groups: PropertyGroup[], unitToMeters: number, bbox: BBox | null): number | null {
  const fromQto = findNumber(groups, LENGTH_NAMES, "quantidades");
  if (fromQto != null) return fromQto * unitToMeters;
  const fromProps = findNumber(groups, LENGTH_NAMES, "propriedades");
  if (fromProps != null) return fromProps * unitToMeters;
  if (bbox) {
    const d = bbox.max.map((v, i) => v - bbox.min[i]);
    return Math.max(...d);
  }
  return null;
}

const DIAMETER_NAMES = [
  "NominalDiameter",
  "Diametro nominal",
  "Diametro",
  "Diameter",
  "DN",
  "OuterDiameter",
  "Diametro externo",
];
const WIDTH_NAMES = ["Width", "Largura", "NominalWidth"];
const HEIGHT_NAMES = ["Height", "Altura", "NominalHeight", "Depth"];
const SIZE_TEXT_NAMES = ["Size", "Tamanho", "Dimensao", "Bitola"];

const fmtMm = (v: number) => String(Math.round(v * 10) / 10);

/** Dimensão nominal legível em milímetros: "Ø50", "400x300" ou o texto de "Tamanho". */
export function deriveSize(groups: PropertyGroup[], unitToMeters: number): string | null {
  const toMm = unitToMeters * 1000;
  const dia = findNumber(groups, DIAMETER_NAMES);
  if (dia != null) return `Ø${fmtMm(dia * toMm)}`;
  const w = findNumber(groups, WIDTH_NAMES);
  const h = findNumber(groups, HEIGHT_NAMES);
  if (w != null && h != null) return `${fmtMm(w * toMm)}x${fmtMm(h * toMm)}`;
  for (const key of SIZE_TEXT_NAMES.map(norm)) {
    for (const g of groups) {
      const v = g.values.find((x) => norm(x.name) === key);
      if (v && v.value != null && String(v.value).trim()) return String(v.value).trim();
    }
  }
  return null;
}

const SYSTEM_PROP_NAMES = ["System Name", "Nome do sistema", "SystemName", "System Classification", "Classificacao do sistema", "System Type", "Tipo de sistema"];

/** Sistemas declarados apenas como propriedade (comum em exportações do Revit). */
export function systemsFromProps(groups: PropertyGroup[]): string[] {
  const wanted = SYSTEM_PROP_NAMES.map(norm);
  for (const key of wanted) {
    for (const g of groups) {
      const v = g.values.find((x) => norm(x.name) === key);
      if (v && typeof v.value === "string" && v.value.trim()) {
        return v.value
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
  }
  return [];
}

export interface QuantityRow {
  key: string;
  discipline: Discipline;
  disciplineLabel: string;
  category: ElementCategory;
  ifcType: string;
  typeLabel: string;
  description: string;
  size: string;
  system: string;
  storey: string;
  unit: "m" | "un";
  count: number;
  /** Comprimento total em metros (segmentos) ou quantidade (demais). */
  quantity: number;
  expressIDs: number[];
}

export interface QuantityOptions {
  groupByStorey?: boolean;
  groupBySystem?: boolean;
  /** Agrupar também pelo nome/tipo do elemento (ex.: "Luminária LED 40W"). */
  groupByName?: boolean;
}

/** Agrupa elementos em linhas de quantitativo. */
export function buildQuantities(elements: ElementInfo[], opts: QuantityOptions = {}): QuantityRow[] {
  const { groupByStorey = true, groupBySystem = true, groupByName = true } = opts;
  const rows = new Map<string, QuantityRow>();

  for (const el of elements) {
    const unit = el.category === "segmento" ? "m" : "un";
    const size = el.size ?? "";
    const system = groupBySystem ? el.systems.join(", ") : "";
    const storey = groupByStorey ? (el.storey ?? "") : "";
    const description = groupByName ? (el.objectType || stripRevitId(el.name)) : "";
    const key = [el.discipline, el.ifcType, description, size, system, storey].join("|");

    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        discipline: el.discipline,
        disciplineLabel: DISCIPLINE_BY_ID[el.discipline].label,
        category: el.category,
        ifcType: el.ifcType,
        typeLabel: getTypeLabel(el.ifcType),
        description,
        size,
        system,
        storey,
        unit,
        count: 0,
        quantity: 0,
        expressIDs: [],
      };
      rows.set(key, row);
    }
    row.count += 1;
    row.quantity += unit === "m" ? (el.length ?? 0) : 1;
    row.expressIDs.push(el.expressID);
  }

  const order = Object.keys(DISCIPLINE_BY_ID);
  return [...rows.values()].sort(
    (a, b) =>
      order.indexOf(a.discipline) - order.indexOf(b.discipline) ||
      a.typeLabel.localeCompare(b.typeLabel, "pt-BR") ||
      a.description.localeCompare(b.description, "pt-BR") ||
      a.size.localeCompare(b.size, "pt-BR", { numeric: true }) ||
      a.storey.localeCompare(b.storey, "pt-BR"),
  );
}

/** Revit exporta nomes como "Família:Tipo:123456"; removemos o ID final. */
function stripRevitId(name: string): string {
  return name.replace(/:\d+$/, "");
}
