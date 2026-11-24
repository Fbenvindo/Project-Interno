// Pontos de tomada e comando montados em caixa: instalação embutida (caixa 4×2 ou 4×4)
// ou aparente (condulete simples ou duplo), com módulos (tomadas e interruptores).
import type { ComponentDef } from "./library";

export type ModuleKind = "tomada-10a" | "tomada-20a" | "int-simples" | "int-paralelo" | "int-intermediario" | "int-bipolar" | "cego";
export type Install = "embutida" | "aparente";
export type BoxSize = "4x2" | "4x4";

export interface ModuleDef {
  label: string;
  /** Módulos ocupados no suporte. */
  slots: number;
  kind: "tomada" | "interruptor" | "cego";
  /** Sigla na planta (interruptores, prática da NBR 5444). */
  code: string;
}

export const MODULES: Record<ModuleKind, ModuleDef> = {
  "tomada-10a": { label: "Tomada 2P+T 10 A", slots: 1, kind: "tomada", code: "10A" },
  "tomada-20a": { label: "Tomada 2P+T 20 A", slots: 1, kind: "tomada", code: "20A" },
  "int-simples": { label: "Interruptor simples", slots: 1, kind: "interruptor", code: "S" },
  "int-paralelo": { label: "Interruptor paralelo (three-way)", slots: 1, kind: "interruptor", code: "S3W" },
  "int-intermediario": { label: "Interruptor intermediário (four-way)", slots: 1, kind: "interruptor", code: "S4W" },
  "int-bipolar": { label: "Interruptor bipolar", slots: 2, kind: "interruptor", code: "S2P" },
  cego: { label: "Módulo cego", slots: 1, kind: "cego", code: "" },
};
export const MODULE_KINDS = Object.keys(MODULES) as ModuleKind[];

export interface DeviceAssembly {
  install: Install;
  box: BoxSize;
  modules: ModuleKind[];
}

export const capacity = (box: BoxSize) => (box === "4x2" ? 3 : 6);
export const slotsUsed = (modules: ModuleKind[]) => modules.reduce((s, m) => s + (MODULES[m]?.slots ?? 1), 0);

/** Caixa embutida 4×2/4×4 ou condulete simples/duplo (aparente). */
export function boxLabel(a: Pick<DeviceAssembly, "install" | "box">): string {
  if (a.install === "embutida") return a.box === "4x2" ? "Caixa 4×2 embutida" : "Caixa 4×4 embutida";
  return a.box === "4x2" ? "Condulete simples aparente" : "Condulete duplo aparente";
}

/** Problema da montagem (ou null): módulos demais para a caixa. */
export function assemblyProblem(a: DeviceAssembly): string | null {
  const used = slotsUsed(a.modules);
  if (!a.modules.length) return "Sem módulos.";
  if (used > capacity(a.box)) return `${used} módulos não cabem em ${a.box === "4x2" ? "4×2 / condulete simples (máx. 3)" : "4×4 / condulete duplo (máx. 6)"}.`;
  return null;
}

/** Mantém a montagem válida: passa para 4×4 quando os módulos não cabem em 4×2 e corta o excesso de 6. */
export function normalizeAssembly(a: DeviceAssembly): DeviceAssembly {
  let modules = [...a.modules];
  while (slotsUsed(modules) > 6) modules = modules.slice(0, -1);
  const box: BoxSize = slotsUsed(modules) > 3 ? "4x4" : a.box;
  return { install: a.install, box, modules };
}

/** Dimensões (mm) do ponto montado: largura × profundidade (para fora da parede) × altura. */
export function assemblySize(a: Pick<DeviceAssembly, "install" | "box">): [number, number, number] {
  if (a.install === "embutida") return a.box === "4x2" ? [75, 10, 120] : [120, 10, 120];
  return a.box === "4x2" ? [70, 55, 130] : [130, 55, 130];
}

const DEFAULT_MODULE: Record<string, ModuleKind> = {
  "tomada-baixa": "tomada-10a",
  "tomada-media": "tomada-10a",
  "tomada-alta": "tomada-10a",
  "interruptor-simples": "int-simples",
  "interruptor-paralelo": "int-paralelo",
  "interruptor-intermediario": "int-intermediario",
  "interruptor-bipolar": "int-bipolar",
};

/** Componentes da biblioteca montados em caixa (tomadas e interruptores de parede). */
export const supportsAssembly = (def: Pick<ComponentDef, "id">) => def.id in DEFAULT_MODULE;

/** Montagem inicial de um componente (null se ele não é montado em caixa). */
export function defaultAssembly(def: ComponentDef): DeviceAssembly | null {
  const m = DEFAULT_MODULE[def.id];
  if (!m) return null;
  return { install: "embutida", box: "4x2", modules: [m] };
}

/** Texto dos módulos: "2× Tomada 2P+T 10 A + Interruptor paralelo (three-way)". */
export function modulesText(modules: ModuleKind[]): string {
  const counts = new Map<ModuleKind, number>();
  for (const m of modules) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts.entries()].map(([m, n]) => `${n > 1 ? `${n}× ` : ""}${MODULES[m].label}`).join(" + ");
}

export const assemblyDescription = (a: DeviceAssembly) => `${modulesText(a.modules)} — ${boxLabel(a)}`;

/** Sigla dos interruptores do conjunto: S, S2, S3 (seções), S3W, S4W, S2P; combinações com "+". */
export function switchCode(modules: ModuleKind[]): string {
  const sw = modules.filter((m) => MODULES[m].kind === "interruptor");
  if (!sw.length) return "";
  const simples = sw.filter((m) => m === "int-simples").length;
  const parts: string[] = [];
  if (simples) parts.push(simples === 1 ? "S" : `S${simples}`);
  for (const m of sw) if (m !== "int-simples") parts.push(MODULES[m].code);
  return parts.join("+");
}

/** Assinatura (para a legenda): instalação, caixa e módulos. */
export const assemblyKey = (a: DeviceAssembly) => `${a.install}|${a.box}|${[...a.modules].sort().join(",")}`;

/** Quantitativo de caixas e módulos de uma lista de montagens. */
export function deviceMaterials(assemblies: DeviceAssembly[]): { description: string; quantity: number }[] {
  const rows = new Map<string, number>();
  const add = (k: string, n = 1) => rows.set(k, (rows.get(k) ?? 0) + n);
  for (const a of assemblies) {
    add(boxLabel(a));
    add(`Suporte e placa ${a.box === "4x2" ? "4×2" : "4×4"} (${a.install})`);
    for (const m of a.modules) add(`Módulo: ${MODULES[m].label}`);
  }
  return [...rows.entries()].map(([description, quantity]) => ({ description, quantity })).sort((x, y) => x.description.localeCompare(y.description, "pt-BR"));
}
