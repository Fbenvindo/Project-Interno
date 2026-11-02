// Contrato entre o processo principal (Electron) e o renderer.

export interface OpenedFile {
  name: string;
  path: string | null;
  data: Uint8Array;
}

export interface SaveRequest {
  defaultName: string;
  content: string;
  filters: { name: string; extensions: string[] }[];
  /** Grava direto neste arquivo do projeto (.seb/.json), sem diálogo ("Salvar"). */
  path?: string;
}

export interface OpenedTextFile {
  name: string;
  path: string | null;
  content: string;
}

export type FileFilter = { name: string; extensions: string[] };

export interface PdfRequest {
  defaultName: string;
  /** Documento SVG completo da prancha. */
  svg: string;
  widthMm: number;
  heightMm: number;
}

export interface DesktopApi {
  openIfc(): Promise<OpenedFile | null>;
  /** Vários IFC de uma vez (vínculos). */
  openIfcMany(): Promise<OpenedFile[]>;
  /** Relê um IFC pelo caminho (vínculos salvos no projeto); null se não existir mais. */
  readIfcPath(path: string): Promise<OpenedFile | null>;
  /** Arquivo recebido pela linha de comando / sistema operacional, se houver. */
  takePendingIfc(): Promise<OpenedFile | null>;
  saveFile(req: SaveRequest): Promise<string | null>;
  openTextFile(filters: FileFilter[]): Promise<OpenedTextFile | null>;
  savePdf(req: PdfRequest): Promise<string | null>;
  on(channel: "menu:open" | "menu:fit" | "ifc:pending-available", cb: () => void): () => void;
}
