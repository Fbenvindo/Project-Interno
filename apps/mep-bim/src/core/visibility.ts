// Visibilidade (como "Visibilidade/Gráficos" do Revit): ocultar um modelo IFC (principal ou
// vínculo), as instalações do projeto, um tipo de elemento (classe IFC), um sistema ou
// elementos isolados. As regras valem numa vista (planta, ampliação, corte, 3D) ou no projeto
// inteiro (todas as vistas, folhas e o 3D).
import { runIdOfElement } from "./runs";
import type { ElementInfo } from "./types";

export interface HideRules {
  /** Modelos ocultos: "principal", id do vínculo ou "projeto" (instalações criadas no app). */
  models?: string[];
  /** Tipos de elemento (classe IFC, ex.: IFCFURNISHINGELEMENT). */
  types?: string[];
  /** Sistemas (nome do sistema). */
  systems?: string[];
  /** Elementos isolados (chave do elemento: id, ou "r<id>" para o trecho inteiro). */
  elements?: string[];
}

export const MODEL_HOST = "principal";
export const MODEL_PROJECT = "projeto";

/** Chave de um elemento: o trecho inteiro para segmentos de trecho. */
export const elementKey = (id: number): string => {
  const r = runIdOfElement(id);
  return r != null ? `r${r}` : String(id);
};

export const isEmptyRules = (r: HideRules | null | undefined) => !r || !(r.models?.length || r.types?.length || r.systems?.length || r.elements?.length);

/** O elemento está oculto por alguma das regras. `modelOf` dá o modelo do elemento. */
export function isHidden(e: ElementInfo, modelOf: (id: number) => string, ...rules: (HideRules | null | undefined)[]): boolean {
  for (const r of rules) {
    if (!r || isEmptyRules(r)) continue;
    if (r.models?.includes(modelOf(e.expressID))) return true;
    if (r.types?.includes(e.ifcType)) return true;
    if (r.systems?.length && e.systems.some((s) => r.systems!.includes(s))) return true;
    if (r.elements?.length && r.elements.includes(elementKey(e.expressID))) return true;
  }
  return false;
}

/** Ids ocultos entre os elementos dados. */
export function hiddenIds(elements: ElementInfo[], modelOf: (id: number) => string, ...rules: (HideRules | null | undefined)[]): Set<number> {
  const out = new Set<number>();
  if (rules.every(isEmptyRules)) return out;
  for (const e of elements) if (isHidden(e, modelOf, ...rules)) out.add(e.expressID);
  return out;
}

type Field = keyof HideRules;
/** Liga ou desliga um valor numa regra. */
export function toggleRule(r: HideRules | null | undefined, field: Field, value: string, hide: boolean): HideRules {
  const cur = r?.[field] ?? [];
  const next = hide ? [...new Set([...cur, value])] : cur.filter((v) => v !== value);
  return { ...(r ?? {}), [field]: next };
}
/** Acrescenta vários valores (ocultar a seleção). */
export function addToRule(r: HideRules | null | undefined, field: Field, values: string[]): HideRules {
  return { ...(r ?? {}), [field]: [...new Set([...(r?.[field] ?? []), ...values])] };
}
