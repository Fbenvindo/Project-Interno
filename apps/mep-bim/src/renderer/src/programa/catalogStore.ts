// Padrão do escritório: instalações por tipo de equipamento, guardado neste computador.
import { useSyncExternalStore } from "react";
import { DEFAULT_CATALOG, type EquipmentType } from "../../../core/program";

const KEY = "smarteasybim.programa.padrao";
let cache: EquipmentType[] | null = null;
const listeners = new Set<() => void>();

function load(): EquipmentType[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as EquipmentType[]) : null;
    // Padrões salvos antes dos dados técnicos: completa com os valores iniciais do mesmo tipo.
    cache =
      Array.isArray(parsed) && parsed.length
        ? parsed.map((t) => (t.tech ? t : { ...t, tech: DEFAULT_CATALOG.find((d) => d.id === t.id)?.tech }))
        : DEFAULT_CATALOG;
  } catch {
    cache = DEFAULT_CATALOG;
  }
  return cache;
}

export function useCatalog(): EquipmentType[] {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    load,
    load,
  );
}

export const getCatalog = load;

export function saveCatalog(next: EquipmentType[]): void {
  cache = next;
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* armazenamento indisponível: vale só nesta sessão */
  }
}

export function resetCatalog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  cache = DEFAULT_CATALOG;
  listeners.forEach((l) => l());
}

/** Exporta/importa o padrão (para levar a outro computador ou à equipe). */
export const catalogToJson = (c: EquipmentType[]) => JSON.stringify({ formato: "smarteasybim/padrao-equipamentos", versao: 1, tipos: c }, null, 2);
export function catalogFromJson(text: string): EquipmentType[] {
  const j = JSON.parse(text);
  if (j?.formato !== "smarteasybim/padrao-equipamentos" || !Array.isArray(j.tipos)) throw new Error("Arquivo de padrão inválido.");
  return j.tipos as EquipmentType[];
}
