// Biblioteca de elementos importados, guardada neste computador (IndexedDB: aguenta as
// malhas 3D, que passam do limite do localStorage). Duas origens:
// - pacotes .sebfam do plugin do Revit (famílias e tipos);
// - arquivos IFC, cujos elementos são agrupados por tipo e analisados pelo uso no modelo.
import { useSyncExternalStore } from "react";
import { packageComponents, parseFamilyPackage, type FamilyOverride, type FamilyPackage } from "../../../core/families";
import { ifcComponentId, ifcElementComponent, type IfcElementDef, type IfcElementOverride } from "../../../core/ifcElements";
import { designComponent, OWN_PACKAGE_ID, type ElementDesign } from "../../../core/elementDesign";
import { COMPONENT_BY_ID, registerComponents } from "../../../core/library";

export interface LibraryEntry {
  id: string;
  /** Nome do arquivo importado (.sebfam ou .ifc). */
  name: string;
  importedAt: string;
  kind?: "sebfam" | "ifc" | "proprio";
  /** Elementos criados no app (editor de elementos). */
  designs?: ElementDesign[];
  /** .sebfam */
  pkg?: FamilyPackage;
  overrides: Record<string, FamilyOverride>;
  /** IFC: elementos analisados e ajustes por elemento. */
  elements?: IfcElementDef[];
  ifcOverrides?: Record<string, IfcElementOverride>;
  /** IFC: elemento (uid) que substituiu um existente e herdou o id dele (pontos locados passam a usá-lo). */
  replaces?: Record<string, string>;
  /** Componentes desta entrada substituídos por outro elemento (não aparecem mais). */
  hidden?: string[];
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

/** Componentes de uma entrada (sem os substituídos). */
export function entryComponents(e: LibraryEntry) {
  const hidden = new Set(e.hidden ?? []);
  if (e.kind === "proprio") return (e.designs ?? []).map(designComponent);
  if (e.kind === "ifc")
    return (e.elements ?? [])
      .map((el) => ifcElementComponent(e.id, el, e.ifcOverrides?.[el.uid], e.replaces?.[el.uid] ?? ifcComponentId(e.id, el.uid), e.name))
      .filter((c) => !hidden.has(c.id));
  return e.pkg ? packageComponents(e.id, e.pkg, e.overrides).filter((c) => !hidden.has(c.id)) : [];
}

function register(e: LibraryEntry) {
  registerComponents(e.id, entryComponents(e));
}

/** Carrega a biblioteca salva e registra os componentes (uma vez, na abertura do app). */
export async function loadFamilyLibrary(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    entries = (await tx<LibraryEntry[]>("readonly", (s) => s.getAll() as IDBRequest<LibraryEntry[]>)) ?? [];
  } catch (e) {
    console.warn("Biblioteca de elementos indisponível:", e);
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

function update(next: LibraryEntry) {
  entries = entries.some((x) => x.id === next.id) ? entries.map((x) => (x.id === next.id ? next : x)) : [...entries, next];
  register(next);
  emit();
  void persist(next);
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Importa um .sebfam; um pacote com o mesmo arquivo de origem substitui o anterior. */
export async function importFamilyPackage(fileName: string, text: string): Promise<LibraryEntry> {
  const pkg = parseFamilyPackage(text);
  const previous = entries.find((e) => e.name === fileName && e.kind !== "ifc");
  const entry: LibraryEntry = {
    id: previous?.id ?? newId("pkg"),
    name: fileName,
    importedAt: new Date().toISOString(),
    kind: "sebfam",
    pkg,
    overrides: previous?.overrides ?? {},
    hidden: previous?.hidden,
  };
  update(entry);
  return entry;
}

/** O que fazer com cada elemento lido do IFC. */
export interface ImportDecision {
  include: boolean;
  /** Já existe na biblioteca: manter o existente (não importa), substituir, ou manter os dois. */
  action?: "novo" | "manter" | "substituir" | "ambos";
  existingId?: string;
}

/** Grava os elementos escolhidos de um IFC na biblioteca, aplicando as decisões sobre os já existentes. */
export async function importIfcElements(fileName: string, elements: IfcElementDef[], decisions: Record<string, ImportDecision>): Promise<LibraryEntry> {
  const previous = entries.find((e) => e.name === fileName && e.kind === "ifc");
  const id = previous?.id ?? newId("ifc");
  const chosen = elements.filter((el) => {
    const d = decisions[el.uid];
    return d?.include && d.action !== "manter";
  });
  const ifcOverrides: Record<string, IfcElementOverride> = { ...(previous?.ifcOverrides ?? {}) };
  const replaces: Record<string, string> = {};
  for (const el of chosen) {
    const d = decisions[el.uid];
    const existing = d.existingId ? COMPONENT_BY_ID[d.existingId] : undefined;
    if (!existing) continue;
    if (d.action === "substituir") {
      // O novo herda o id (os pontos já locados passam a usá-lo) e a função do existente.
      replaces[el.uid] = existing.id;
      ifcOverrides[el.uid] = { ...ifcOverrides[el.uid], funcao: existing.funcao ?? existing.label };
      const owner = entries.find((x) => x.id === existing.source?.packageId);
      if (owner && owner.id !== id) update({ ...owner, hidden: [...new Set([...(owner.hidden ?? []), existing.id])] });
    } else if (d.action === "ambos") {
      // Os dois ficam, como alternativas da mesma função: o projeto escolhe qual usar.
      ifcOverrides[el.uid] = { ...ifcOverrides[el.uid], funcao: existing.funcao ?? existing.label };
    }
  }
  const entry: LibraryEntry = { id, name: fileName, importedAt: new Date().toISOString(), kind: "ifc", overrides: {}, elements: chosen, ifcOverrides, replaces };
  update(entry);
  return entry;
}

/** Ajusta fixação, orientação ou grupo de uma família (.sebfam). */
export async function setFamilyOverride(entryId: string, familyUid: string, patch: FamilyOverride): Promise<void> {
  const e = entries.find((x) => x.id === entryId);
  if (!e) return;
  update({ ...e, overrides: { ...e.overrides, [familyUid]: { ...e.overrides[familyUid], ...patch } } });
}

/** Ajusta um elemento importado de IFC (painel de configuração). */
export async function setIfcOverride(entryId: string, uid: string, patch: IfcElementOverride): Promise<void> {
  const e = entries.find((x) => x.id === entryId);
  if (!e) return;
  update({ ...e, ifcOverrides: { ...e.ifcOverrides, [uid]: { ...e.ifcOverrides?.[uid], ...patch } } });
}

/** Volta a mostrar um elemento que tinha sido substituído. */
export async function unhideComponent(entryId: string, componentId: string): Promise<void> {
  const e = entries.find((x) => x.id === entryId);
  if (!e) return;
  update({ ...e, hidden: (e.hidden ?? []).filter((x) => x !== componentId) });
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

// ---- Elementos criados no app ---------------------------------------------------------------------

export const newDesignUid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function ownEntry(): LibraryEntry {
  return entries.find((e) => e.id === OWN_PACKAGE_ID) ?? { id: OWN_PACKAGE_ID, name: "Elementos criados no app", importedAt: new Date().toISOString(), kind: "proprio", overrides: {}, designs: [] };
}

/** Grava (novo ou editado) um elemento criado no app. */
export async function saveDesign(d: ElementDesign): Promise<void> {
  const e = ownEntry();
  const next = { ...d, updatedAt: new Date().toISOString() };
  const designs = e.designs ?? [];
  update({ ...e, designs: designs.some((x) => x.uid === d.uid) ? designs.map((x) => (x.uid === d.uid ? next : x)) : [...designs, next] });
}

export async function deleteDesign(uid: string): Promise<void> {
  const e = ownEntry();
  update({ ...e, designs: (e.designs ?? []).filter((x) => x.uid !== uid) });
}

/** Arquivo para levar elementos criados para outro computador (.sebel, JSON). */
export function exportDesigns(designs: ElementDesign[]): string {
  return JSON.stringify({ formato: "smarteasybim-elementos", versao: 1, elementos: designs }, null, 1);
}

/** Importa um .sebel; elementos com o mesmo identificador são atualizados. */
export async function importDesigns(text: string): Promise<number> {
  const data = JSON.parse(text);
  if (data?.formato !== "smarteasybim-elementos" || !Array.isArray(data.elementos)) throw new Error("arquivo não é de elementos do SmartEasyBIM (.sebel)");
  const e = ownEntry();
  const map = new Map((e.designs ?? []).map((x) => [x.uid, x]));
  for (const d of data.elementos as ElementDesign[]) if (d?.uid && Array.isArray(d.solids)) map.set(d.uid, d);
  update({ ...e, designs: [...map.values()] });
  return data.elementos.length;
}
