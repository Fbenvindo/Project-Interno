// Cache dos modelos IFC já processados (geometria, elementos, propriedades), no IndexedDB
// deste computador. A chave é o conteúdo do arquivo (SHA-256) e a versão do leitor: se o
// IFC mudar, ou o app passar a ler de outro jeito, o modelo é processado de novo.
// Funciona tanto na interface quanto no Web Worker. A geometria é guardada bloco a bloco
// (um registro por bloco, uma transação por vez), para não duplicar a memória ao gravar.
import type { IfcData } from "../../../ifc/loadIfc";
import { IFC_DATA_VERSION } from "../../../ifc/ifcDataVersion";
import { chunkBytes, type MeshChunk } from "../../../ifc/meshChunks";

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
  /** Quantos blocos de geometria (registros `${key}#${i}`). */
  chunks?: number;
}

const chunkKey = (key: string, i: number) => `${key}#${i}`;

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

/** Tamanho aproximado dos dados (a geometria é quase tudo). */
export function dataBytes(d: IfcData): number {
  return chunkBytes(d.geometry) + d.elements.length * 400 + d.propertyGroups.length * 300;
}

export async function cacheGet(key: string): Promise<IfcData | null> {
  try {
    const db = await open();
    try {
      const tx = db.transaction([DATA, META], "readwrite");
      const meta = (await request(tx.objectStore(META).get(key))) as CacheEntry | undefined;
      if (!meta) {
        await done(tx);
        return null;
      }
      const base = (await request(tx.objectStore(DATA).get(key))) as Omit<IfcData, "geometry"> | undefined;
      const geometry: MeshChunk[] = [];
      for (let i = 0; i < (meta.chunks ?? 0); i++) {
        const c = (await request(tx.objectStore(DATA).get(chunkKey(key, i)))) as MeshChunk | undefined;
        if (!c) break;
        geometry.push(c);
      }
      if (!base || geometry.length !== (meta.chunks ?? 0)) {
        await done(tx);
        return null;
      }
      tx.objectStore(META).put({ ...meta, usedAt: Date.now() });
      await done(tx);
      return { ...base, geometry };
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("Cache de modelos indisponível:", e);
    return null;
  }
}

/**
 * Grava em etapas (dados gerais e depois cada bloco de geometria, uma transação por vez), sem
 * travar a interface por muito tempo nem copiar o modelo inteiro de uma vez. O índice é gravado
 * por último: uma gravação interrompida não é usada. Modelos maiores que o limite não entram.
 */
export async function cachePut(key: string, name: string, d: IfcData): Promise<boolean> {
  const bytes = dataBytes(d);
  if (bytes > CACHE_MAX_BYTES) return false;
  try {
    const db = await open();
    try {
      const { geometry, ...base } = d;
      let tx = db.transaction(DATA, "readwrite");
      tx.objectStore(DATA).put(base, key);
      await done(tx);
      for (let i = 0; i < geometry.length; i++) {
        tx = db.transaction(DATA, "readwrite");
        tx.objectStore(DATA).put(geometry[i], chunkKey(key, i));
        await done(tx);
        // Deixa a interface respirar entre um bloco e outro.
        await new Promise((r) => setTimeout(r, 0));
      }
      tx = db.transaction(META, "readwrite");
      tx.objectStore(META).put({ key, name, bytes, usedAt: Date.now(), chunks: geometry.length } satisfies CacheEntry);
      await done(tx);
      await evict(db);
      return true;
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("Não foi possível gravar o modelo no cache:", e);
    return false;
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
  const byKey = new Map(all.map((e) => [e.key, e]));
  for (const key of entriesToEvict(all)) {
    tx.objectStore(DATA).delete(key);
    for (let i = 0; i < (byKey.get(key)?.chunks ?? 0); i++) tx.objectStore(DATA).delete(chunkKey(key, i));
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
