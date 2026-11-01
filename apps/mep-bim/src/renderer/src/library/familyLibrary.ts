// Biblioteca de famílias do Revit importadas, guardada neste computador (IndexedDB:
// aguenta as malhas 3D, que passam do limite do localStorage).
import { useSyncExternalStore } from "react";
import { packageComponents, parseFamilyPackage, type FamilyOverride, type FamilyPackage } from "../../../core/families";
import { registerComponents } from "../../../core/library";

export interface LibraryEntry {
  id: string;
  /** Nome do arquivo .sebfam importado. */
  name: string;
  importedAt: string;
  pkg: FamilyPackage;
  overrides: Record<string, FamilyOverride>;
}

const DB = "smarteasybim";
const STORE = "familias";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

let entries: LibraryEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function register(e: LibraryEntry) {
  registerComponents(e.id, packageComponents(e.id, e.pkg, e.overrides));
}

/** Carrega a biblioteca salva e registra os componentes (uma vez, na abertura do app). */
export async function loadFamilyLibrary(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    entries = (await tx<LibraryEntry[]>("readonly", (s) => s.getAll() as IDBRequest<LibraryEntry[]>)) ?? [];
  } catch (e) {
    console.warn("Biblioteca de famílias indisponível:", e);
    entries = [];
  }
  entries.sort((a, b) => a.importedAt.localeCompare(b.importedAt));
  for (const e of entries) register(e);
  emit();
}

export function useFamilyLibrary(): LibraryEntry[] {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => entries,
    () => entries,
  );
}

async function persist(e: LibraryEntry) {
  try {
    await tx("readwrite", (s) => s.put(e));
  } catch (err) {
    console.warn("Não foi possível salvar a biblioteca:", err);
  }
}

/** Importa um .sebfam; um pacote com o mesmo arquivo de origem substitui o anterior. */
export async function importFamilyPackage(fileName: string, text: string): Promise<LibraryEntry> {
  const pkg = parseFamilyPackage(text);
  const previous = entries.find((e) => e.name === fileName);
  const entry: LibraryEntry = {
    id: previous?.id ?? `pkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: fileName,
    importedAt: new Date().toISOString(),
    pkg,
    overrides: previous?.overrides ?? {},
  };
  entries = [...entries.filter((e) => e.id !== entry.id), entry];
  register(entry);
  emit();
  await persist(entry);
  return entry;
}

/** Ajusta fixação, orientação ou grupo de uma família e atualiza os componentes. */
export async function setFamilyOverride(entryId: string, familyUid: string, patch: FamilyOverride): Promise<void> {
  const e = entries.find((x) => x.id === entryId);
  if (!e) return;
  const next: LibraryEntry = { ...e, overrides: { ...e.overrides, [familyUid]: { ...e.overrides[familyUid], ...patch } } };
  entries = entries.map((x) => (x.id === entryId ? next : x));
  register(next);
  emit();
  await persist(next);
}

export async function removeFamilyPackage(entryId: string): Promise<void> {
  entries = entries.filter((e) => e.id !== entryId);
  registerComponents(entryId, []);
  emit();
  try {
    await tx("readwrite", (s) => s.delete(entryId));
  } catch (err) {
    console.warn(err);
  }
}
