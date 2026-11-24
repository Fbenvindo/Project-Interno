// Biblioteca de carimbos do usuário, guardada neste computador (localStorage).
import { useSyncExternalStore } from "react";
import { parseDxfTemplate, parseSvgTemplate, type TitleBlock } from "../../../core/plan/titleBlock";

const KEY = "smarteasybim.carimbos";
const DEFAULT_KEY = "smarteasybim.carimbo.padrao";

let cache: TitleBlock[] | null = null;
const listeners = new Set<() => void>();

function load(): TitleBlock[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as TitleBlock[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Salva a lista; devolve uma mensagem de erro se o armazenamento recusar (arquivo grande demais). */
function save(list: TitleBlock[]): string | null {
  cache = list;
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return null;
  } catch {
    return "O carimbo foi carregado, mas é grande demais para ficar salvo neste computador. Prefira SVG/DXF ou uma imagem menor.";
  }
}

export function useTitleBlocks(): TitleBlock[] {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    load,
    load,
  );
}

export const titleBlockById = (id: string | null | undefined): TitleBlock | null => (id ? (load().find((t) => t.id === id) ?? null) : null);

export function upsertTitleBlock(tb: TitleBlock): string | null {
  const list = load();
  return save(list.some((t) => t.id === tb.id) ? list.map((t) => (t.id === tb.id ? tb : t)) : [...list, tb]);
}

export function removeTitleBlock(id: string): void {
  save(load().filter((t) => t.id !== id));
  if (defaultTitleBlockId() === id) setDefaultTitleBlockId(null);
}

/** Carimbo usado por padrão nas novas folhas. */
export function defaultTitleBlockId(): string | null {
  try {
    return localStorage.getItem(DEFAULT_KEY);
  } catch {
    return null;
  }
}
export function setDefaultTitleBlockId(id: string | null): void {
  try {
    if (id) localStorage.setItem(DEFAULT_KEY, id);
    else localStorage.removeItem(DEFAULT_KEY);
  } catch {
    /* armazenamento indisponível */
  }
}

const readAs = (file: File, how: "text" | "dataUrl") =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    if (how === "text") r.readAsText(file);
    else r.readAsDataURL(file);
  });

const imageSize = (url: string) =>
  new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Imagem inválida."));
    img.src = url;
  });

/** Lê um arquivo de carimbo: SVG, DXF (ASCII) ou imagem PNG/JPG. */
export async function importTitleBlock(file: File): Promise<TitleBlock> {
  const name = file.name.replace(/\.[^.]+$/, "");
  const id = `tb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "svg") return { id, name, kind: "svg", ...parseSvgTemplate(await readAs(file, "text")) };
  if (ext === "dxf") return { id, name, kind: "svg", ...parseDxfTemplate(await readAs(file, "text")) };
  if (ext === "dwg") throw new Error("DWG não é suportado: no AutoCAD, salve o carimbo como DXF (Salvar como › DXF).");
  if (ext === "png" || ext === "jpg" || ext === "jpeg") {
    const url = await readAs(file, "dataUrl");
    const { w, h } = await imageSize(url);
    const width = 175;
    return { id, name, kind: "image", content: url, viewBox: [0, 0, w, h], width, height: Math.round(((width * h) / w) * 10) / 10 };
  }
  throw new Error("Formato não suportado. Use SVG, DXF, PNG ou JPG.");
}
