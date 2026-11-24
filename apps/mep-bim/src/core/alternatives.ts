// Elementos equivalentes (mesma função), por exemplo a mesma evaporadora da Daikin e da LG,
// ou duas versões de um mesmo elemento mantidas na biblioteca. Em cada projeto, o usuário
// escolhe a marca de referência por grupo (vale para o projeto todo) e, onde ainda houver
// mais de uma opção, qual usar.
import type { ComponentDef } from "./library";

export interface ProjectChoices {
  /** Marca de referência por grupo da biblioteca (ex.: Climatização → Daikin). */
  brands: Record<string, string>;
  /** Escolha explícita por função (chave de equivalência → id do componente). */
  variants: Record<string, string>;
}

export const EMPTY_CHOICES: ProjectChoices = { brands: {}, variants: {} };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Chave de equivalência: disciplina + função. Componentes sem função são únicos. */
export const funcaoKey = (c: ComponentDef): string | null => (c.funcao ? `${c.discipline}|${norm(c.funcao)}` : null);

/** Agrupa os componentes por função; cada grupo com mais de um item tem alternativas. */
export function alternativeGroups(list: ComponentDef[]): Map<string, ComponentDef[]> {
  const m = new Map<string, ComponentDef[]>();
  for (const c of list) {
    const k = funcaoKey(c);
    if (!k) continue;
    const g = m.get(k);
    if (g) g.push(c);
    else m.set(k, [c]);
  }
  for (const [k, g] of m) if (g.length < 2) m.delete(k);
  return m;
}

/**
 * Componente usado no projeto entre as alternativas: a escolha explícita, senão o da marca
 * de referência do grupo, senão o primeiro.
 */
export function chooseAlternative(alts: ComponentDef[], choices: ProjectChoices): { def: ComponentDef; by: "escolha" | "marca" | "padrão" } {
  const k = funcaoKey(alts[0]);
  const explicit = k ? alts.find((c) => c.id === choices.variants[k]) : undefined;
  if (explicit) return { def: explicit, by: "escolha" };
  const brand = choices.brands[alts[0].group];
  const byBrand = brand ? alts.find((c) => c.brand && norm(c.brand) === norm(brand)) : undefined;
  if (byBrand) return { def: byBrand, by: "marca" };
  return { def: alts[0], by: "padrão" };
}

export interface PaletteItem {
  def: ComponentDef;
  /** Todas as opções equivalentes (inclui `def`), quando houver mais de uma. */
  alternatives: ComponentDef[];
  by?: "escolha" | "marca" | "padrão";
}

/** Itens da paleta de locação: um por função, já resolvido pelas escolhas do projeto. */
export function paletteItems(list: ComponentDef[], choices: ProjectChoices): PaletteItem[] {
  const groups = alternativeGroups(list);
  const seen = new Set<string>();
  const out: PaletteItem[] = [];
  for (const c of list) {
    const k = funcaoKey(c);
    const alts = k ? groups.get(k) : undefined;
    if (!alts) {
      out.push({ def: c, alternatives: [] });
      continue;
    }
    if (seen.has(k!)) continue;
    seen.add(k!);
    const r = chooseAlternative(alts, choices);
    out.push({ def: r.def, alternatives: alts, by: r.by });
  }
  return out;
}

/** Marcas presentes em cada grupo da biblioteca (para escolher a referência do projeto). */
export function brandsByGroup(list: ComponentDef[]): Map<string, string[]> {
  const m = new Map<string, Set<string>>();
  for (const c of list) {
    if (!c.brand) continue;
    const s = m.get(c.group) ?? new Set<string>();
    s.add(c.brand.trim());
    m.set(c.group, s);
  }
  return new Map([...m].map(([g, s]) => [g, [...s].sort((a, b) => a.localeCompare(b, "pt-BR"))]));
}

/** Elemento já existente na biblioteca que corresponde a um novo: mesmo nome, ou mesmo fabricante e modelo. */
export function findExisting(list: ComponentDef[], cand: { name: string; brand: string | null; model: string | null; ifcType?: string }): ComponentDef | null {
  const n = norm(cand.name);
  return (
    list.find((c) => c.source && norm(c.label) === n) ??
    (cand.brand && cand.model ? (list.find((c) => c.source && c.brand && c.model && norm(c.brand) === norm(cand.brand!) && norm(c.model) === norm(cand.model!)) ?? null) : null)
  );
}

/** Texto de uma opção entre equivalentes: marca, nome e, se o nome se repete, o arquivo de origem. */
export function alternativeLabel(a: ComponentDef, all: ComponentDef[]): string {
  const repeated = all.filter((x) => norm(x.label) === norm(a.label)).length > 1;
  return `${a.brand ? `${a.brand} — ` : ""}${a.label}${repeated && a.source?.file ? ` (${a.source.file})` : ""}`;
}
