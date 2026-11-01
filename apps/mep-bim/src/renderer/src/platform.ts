// Acesso à plataforma: usa a API do Electron quando disponível e, no navegador
// (modo de desenvolvimento "dev:web"), recorre a <input type=file> e download.
import { IfcAPI } from "web-ifc";
import type { DesktopApi, FileFilter, OpenedFile, OpenedTextFile, PdfRequest, SaveRequest } from "../../shared/ipc";

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export const desktop = window.desktop ?? null;

export async function openIfc(): Promise<OpenedFile | null> {
  if (desktop) return desktop.openIfc();
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ifc";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, path: null, data: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.click();
  });
}

export async function saveFile(req: SaveRequest): Promise<string | null> {
  if (desktop) return desktop.saveFile(req);
  const blob = new Blob([req.content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = req.defaultName;
  a.click();
  URL.revokeObjectURL(a.href);
  return req.defaultName;
}

export async function openTextFile(filters: FileFilter[]): Promise<OpenedTextFile | null> {
  if (desktop) return desktop.openTextFile(filters);
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, path: null, content: await file.text() } : null);
    };
    input.click();
  });
}

/** PDF da prancha: no app desktop, gerado direto; no navegador, pela janela de impressão. */
export async function savePdf(req: PdfRequest): Promise<string | null> {
  if (desktop) return desktop.savePdf(req);
  const w = window.open("", "_blank");
  if (!w) return null;
  w.document.write(
    `<!doctype html><html><head><title>${req.defaultName}</title><style>@page{size:${req.widthMm}mm ${req.heightMm}mm;margin:0}` +
      `html,body{margin:0}svg{display:block;width:${req.widthMm}mm;height:${req.heightMm}mm}</style></head><body>${req.svg}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return req.defaultName;
}

let ifcApi: Promise<IfcAPI> | null = null;

/** Instância única do web-ifc (WebAssembly em thread única, sem exigir COOP/COEP). */
export function getIfcApi(): Promise<IfcAPI> {
  if (!ifcApi) {
    ifcApi = (async () => {
      const api = new IfcAPI();
      api.SetWasmPath(new URL("wasm/", document.baseURI).href, true);
      await api.Init(undefined, true);
      return api;
    })();
  }
  return ifcApi;
}
