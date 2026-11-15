// Cache dos modelos IFC já processados (geometria, elementos, propriedades), no IndexedDB
// deste computador. A chave é o conteúdo do arquivo (SHA-256) e a versão do leitor: se o
// IFC mudar, ou o app passar a ler de outro jeito, o modelo é processado de novo.
// Funciona tanto na interface quanto no Web Worker.
import type { IfcData } from "../../../ifc/loadIfc";
import { IFC_DATA_VERSION } from "../../../ifc/ifcDataVersion";

const DB = "smarteasybim-modelos";
const DATA = "dados";
const META = "indice";
/** Limites do cache: o que passar disso sai, do usado há mais tempo para o mais recente. */
export const CACHE_MAX_BYTES = 3 * 1024 ** 3;
export const CACHE_MAX_ENTRIES = 12;

export interface CacheEntry {
  key: string;
  name: string;
  bytes: number;
  usedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DATA);
      req.result.createObjectStore(META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Chave do cache: SHA-256 do arquivo + versão do leitor. */
export async function cacheKey(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer));
  return `v${IFC_DATA_VERSION}-${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Tamanho aproximado dos dados (as malhas são quase tudo). */
export function dataBytes(d: IfcData): number {
  const g = d.geometry;
  return g.positions.byteLength + g.normals.byteLength + g.indices.byteLength + g.ids.length * 40 + d.elements.length * 400 + d.propertyGroups.length * 300;
}

export async function cacheGet(key: string): Promise<IfcData | null> {
  try {
    const db = await open();
    try {
      const tx = db.transaction([DATA, META], "readwrite");
      const data = (await request(tx.objectStore(DATA).get(key))) as IfcData | undefined;
      const meta = (await request(tx.objectStore(META).get(key))) as CacheEntry | undefined;
      if (data && meta) tx.objectStore(META).put({ ...meta, usedAt: Date.now() });
      await done(tx);
      return data ?? null;
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("Cache de modelos indisponível:", e);
    return null;
  }
}

/**
 * Grava e libera espaço pelos limites. `onCopied` é chamado assim que o IndexedDB copiou os
 * dados (a partir daí as malhas podem ser transferidas), antes de terminar a gravação.
 */
export async function cachePut(key: string, name: string, d: IfcData, onCopied: () => void = () => {}): Promise<void> {
  let copied = false;
  try {
    const db = await open();
    try {
      const tx = db.transaction([DATA, META], "readwrite");
      tx.objectStore(DATA).put(d, key);
      tx.objectStore(META).put({ key, name, bytes: dataBytes(d), usedAt: Date.now() } satisfies CacheEntry);
      copied = true;
      onCopied();
      await done(tx);
      await evict(db);
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("Não foi possível gravar o modelo no cache:", e);
    if (!copied) onCopied();
  }
}

/** Quais entradas sair para respeitar os limites (as mais antigas primeiro). */
export function entriesToEvict(entries: CacheEntry[], maxBytes = CACHE_MAX_BYTES, maxEntries = CACHE_MAX_ENTRIES): string[] {
  const sorted = [...entries].sort((a, b) => b.usedAt - a.usedAt);
  const keep: CacheEntry[] = [];
  let total = 0;
  const out: string[] = [];
  for (const e of sorted) {
    // A mais recente sempre fica, mesmo sozinha passando do limite.
    if (keep.length === 0 || (keep.length < maxEntries && total + e.bytes <= maxBytes)) {
      keep.push(e);
      total += e.bytes;
    } else out.push(e.key);
  }
  return out;
}

async function evict(db: IDBDatabase) {
  const tx = db.transaction([DATA, META], "readwrite");
  const all = (await request(tx.objectStore(META).getAll())) as CacheEntry[];
  for (const key of entriesToEvict(all)) {
    tx.objectStore(DATA).delete(key);
    tx.objectStore(META).delete(key);
  }
  await done(tx);
}

export async function cacheList(): Promise<CacheEntry[]> {
  try {
    const db = await open();
    try {
      const tx = db.transaction(META, "readonly");
      const all = (await request(tx.objectStore(META).getAll())) as CacheEntry[];
      return all.sort((a, b) => b.usedAt - a.usedAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function cacheClear(): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([DATA, META], "readwrite");
    tx.objectStore(DATA).clear();
    tx.objectStore(META).clear();
    await done(tx);
  } finally {
    db.close();
  }
}
