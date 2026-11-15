// Web Worker: lê o IFC com o web-ifc fora da thread da interface (a janela não trava)
// e usa o cache dos modelos já processados.
// O web-ifc (~6 MB) só é carregado quando precisa processar um arquivo: quem vem do cache
// não espera por ele.
import type { IfcAPI } from "web-ifc";
import type { IfcData } from "../../../ifc/loadIfc";
import { ifcDataBuffers } from "../../../ifc/ifcDataBuffers";
import { cacheGet, cacheKey, cachePut } from "./modelCache";

export type WorkerRequest = { id: number; name: string; bytes: Uint8Array; wasmPath: string; useCache: boolean } | { id: 0; warm: true; wasmPath: string };
export type WorkerResponse =
  | { id: number; type: "progress"; stage: string; fraction: number }
  | { id: number; type: "done"; data: IfcData; fromCache: boolean; ms: number }
  | { id: number; type: "error"; message: string };

let api: Promise<IfcAPI> | null = null;
function getApi(wasmPath: string) {
  if (!api) {
    api = (async () => {
      const { IfcAPI } = await import("web-ifc");
      const a = new IfcAPI();
      a.SetWasmPath(wasmPath, true);
      await a.Init(undefined, true);
      return a;
    })();
  }
  return api;
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

// Um arquivo por vez (o web-ifc é de thread única).
let queue = Promise.resolve();
self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  // Aquecimento: prepara o leitor em segundo plano, sem bloquear a fila.
  if ("warm" in req) void getApi(req.wasmPath).catch(() => {});
  else queue = queue.then(() => handle(req));
};

async function handle({ id, name, bytes, wasmPath, useCache }: Extract<WorkerRequest, { name: string }>) {
  const t0 = performance.now();
  try {
    const progress = (stage: string, fraction: number) => post({ id, type: "progress", stage, fraction });
    let key: string | null = null;
    if (useCache) {
      progress("Procurando o modelo no cache", 0);
      key = await cacheKey(bytes);
      const cached = await cacheGet(key);
      if (cached) {
        post({ id, type: "done", data: cached, fromCache: true, ms: performance.now() - t0 }, ifcDataBuffers(cached));
        return;
      }
    }
    progress("Inicializando leitor IFC", 0);
    const [a, { extractIfc }] = await Promise.all([getApi(wasmPath), import("../../../ifc/loadIfc")]);
    const data = extractIfc(a, bytes, progress);
    const send = () => post({ id, type: "done", data, fromCache: false, ms: performance.now() - t0 }, ifcDataBuffers(data));
    // O IndexedDB copia os dados no put; logo depois as malhas vão para a interface sem cópia,
    // e a gravação termina em segundo plano.
    if (key) await cachePut(key, name, data, send);
    else send();
  } catch (e) {
    post({ id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
