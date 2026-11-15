// Leitura de IFC pela interface: manda o arquivo para o Web Worker (que usa o cache) e
// recebe os dados prontos. Se o worker não puder ser criado, lê na própria thread.
import { loadIfc, modelFromData, type LoadedModel } from "../../../ifc/loadIfc";
import { getIfcApi } from "../platform";
import type { WorkerRequest, WorkerResponse } from "./ifcWorker";
import { cachePut } from "./modelCache";

export interface LoadInfo {
  fromCache: boolean;
  ms: number;
}

const CACHE_PREF = "smarteasybim.modelCache";

/** Cache de modelos ligado (padrão) ou desligado neste computador. */
export function modelCacheEnabled(): boolean {
  try {
    return localStorage.getItem(CACHE_PREF) !== "off";
  } catch {
    return true;
  }
}

export function setModelCacheEnabled(on: boolean) {
  try {
    localStorage.setItem(CACHE_PREF, on ? "on" : "off");
  } catch {
    /* sem armazenamento local */
  }
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { name: string; resolve: (r: { model: LoadedModel; info: LoadInfo }) => void; reject: (e: Error) => void; progress: (stage: string, fraction: number) => void }>();

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL("./ifcWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === "progress") p.progress(msg.stage, msg.fraction);
      else {
        pending.delete(msg.id);
        if (msg.type === "done") {
          p.resolve({ model: modelFromData(msg.data), info: { fromCache: msg.fromCache, ms: msg.ms } });
          // Grava no cache em segundo plano, bloco a bloco, depois de o modelo aparecer.
          const key = msg.cacheKey;
          if (key) setTimeout(() => void cachePut(key, p.name, msg.data), 300);
        } else p.reject(new Error(msg.message));
        // O WebAssembly do leitor não devolve memória: depois de processar um IFC (ou de um
        // erro, que pode deixá-lo inutilizável), o leitor é trocado por um novo.
        if (msg.type === "error" || !msg.fromCache) recycleWorker();
      }
    };
    worker.onmessageerror = () => {
      for (const [, p] of pending) p.reject(new Error("Falha ao receber o modelo do leitor (memória insuficiente?)."));
      pending.clear();
    };
    worker.onerror = (ev) => {
      // Falha ao iniciar (ou erro fatal): devolve os pendentes com erro e passa a ler na interface.
      console.error("Worker do IFC:", ev.message);
      for (const [, p] of pending) p.reject(new Error(ev.message || "Falha no leitor de IFC em segundo plano."));
      pending.clear();
      worker?.terminate();
      worker = null;
      workerFailed = true;
    };
  } catch (e) {
    console.warn("Sem Web Worker; o IFC será lido na interface.", e);
    workerFailed = true;
    worker = null;
  }
  return worker;
}

function recycleWorker() {
  if (pending.size || !worker) return;
  worker.terminate();
  worker = null;
  setTimeout(() => {
    if (!worker && !pending.size) warmIfcWorker();
  }, 2000);
}

/** Interrompe a leitura em andamento (o leitor é reiniciado na próxima). */
export function cancelIfcLoad() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(new Error("Leitura cancelada."));
  pending.clear();
}

/** Cria o worker e prepara o leitor IFC em segundo plano (chamar na abertura do app). */
export function warmIfcWorker() {
  const w = getWorker();
  if (w) w.postMessage({ id: 0, warm: true, wasmPath: new URL("wasm/", document.baseURI).href } satisfies WorkerRequest);
}

/**
 * Lê o IFC sem travar a janela. `transfer`: entrega o arquivo ao worker sem cópia (o
 * `data` original fica vazio); use quando o chamador não precisa mais dos bytes.
 */
export async function loadIfcModel(
  file: { name: string; data: Uint8Array },
  onProgress: (stage: string, fraction: number) => void = () => {},
  opts: { transfer?: boolean } = {},
): Promise<{ model: LoadedModel; info: LoadInfo }> {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { name: file.name, resolve, reject, progress: onProgress });
        const req: WorkerRequest = { id, name: file.name, bytes: file.data, wasmPath: new URL("wasm/", document.baseURI).href, useCache: modelCacheEnabled() };
        w.postMessage(req, opts.transfer ? [file.data.buffer] : []);
      });
    } catch (e) {
      // Worker caiu antes de responder: tenta na interface (se ainda houver os bytes).
      if (!workerFailed || !file.data.byteLength) throw e;
    }
  }
  const t0 = performance.now();
  const api = await getIfcApi();
  const model = loadIfc(api, file.data, onProgress);
  return { model, info: { fromCache: false, ms: performance.now() - t0 } };
}
