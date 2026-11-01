import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenedFile, SaveRequest } from "../shared/ipc";

// Em produção o renderer é servido por um protocolo próprio (app://), com
// origem estável e cabeçalho CSP, em vez de file://.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const RENDERER_DIR = join(__dirname, "../renderer");
// 'unsafe-eval' é exigido pelo web-ifc (o embind do Emscripten gera funções
// com new Function). O renderer só carrega conteúdo local do próprio app e
// roda com sandbox + contextIsolation, sem acesso direto ao Node.
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:";

let mainWindow: BrowserWindow | null = null;
/** Arquivo passado na linha de comando (ex.: duplo clique em um .ifc). */
let pendingFile: string | null = process.argv.slice(1).find((a) => a.toLowerCase().endsWith(".ifc")) ?? null;

async function readIfc(filePath: string): Promise<OpenedFile> {
  const data = await readFile(filePath);
  return { name: basename(filePath), path: filePath, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "MEP BIM",
    backgroundColor: "#14171c",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadURL("app://renderer/index.html");
}

function buildMenu() {
  const send = (channel: string) => () => mainWindow?.webContents.send(channel);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "Arquivo",
        submenu: [
          { label: "Abrir IFC…", accelerator: "CmdOrCtrl+O", click: send("menu:open") },
          { type: "separator" },
          { role: "quit", label: "Sair" },
        ],
      },
      {
        label: "Exibir",
        submenu: [
          { label: "Enquadrar modelo", accelerator: "F", click: send("menu:fit") },
          { type: "separator" },
          { role: "reload", label: "Recarregar" },
          { role: "toggleDevTools", label: "Ferramentas do desenvolvedor" },
          { role: "togglefullscreen", label: "Tela cheia" },
        ],
      },
    ]),
  );
}

ipcMain.handle("ifc:open", async (): Promise<OpenedFile | null> => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    title: "Abrir modelo IFC",
    filters: [{ name: "Modelos IFC", extensions: ["ifc"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return readIfc(res.filePaths[0]);
});

ipcMain.handle("ifc:pending", async (): Promise<OpenedFile | null> => {
  if (!pendingFile) return null;
  const file = pendingFile;
  pendingFile = null;
  return readIfc(file);
});

ipcMain.handle("file:save", async (_e, req: SaveRequest): Promise<string | null> => {
  const res = await dialog.showSaveDialog(mainWindow!, {
    title: "Salvar arquivo",
    defaultPath: req.defaultName,
    filters: req.filters,
  });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, req.content, "utf8");
  return res.filePath;
});

app.whenReady().then(() => {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = normalize(join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (!filePath.startsWith(normalize(RENDERER_DIR) + sep)) return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    if (filePath.endsWith(".html")) headers.set("Content-Security-Policy", CSP);
    if (filePath.endsWith(".wasm")) headers.set("Content-Type", "application/wasm");
    return new Response(response.body, { status: response.status, headers });
  });

  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS: arquivo aberto pelo Finder com o app já em execução.
app.on("open-file", (event, path) => {
  event.preventDefault();
  pendingFile = path;
  mainWindow?.webContents.send("ifc:pending-available");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
