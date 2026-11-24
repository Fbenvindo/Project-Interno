// SmartEasyBIM CDE: aplicativo do computador que serve o CDE na rede do escritório. Liga o
// servidor (API + interface web), mostra os endereços para os colegas e fica na bandeja do sistema.
// Fechar a janela não desliga o servidor; "Sair" (bandeja) desliga.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./server/start');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = () => ({ dataDir: path.join(app.getPath('documents'), 'SmartEasyBIM CDE'), port: 4000 });

let win = null;
let tray = null;
let server = null;
let lastError = null;
let quitting = false;

function readConfig() {
  try {
    return { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(CONFIG(), 'utf8')) };
  } catch {
    return DEFAULTS();
  }
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
  fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2));
}

async function restart() {
  if (server) await server.close().catch(() => {});
  server = null;
  lastError = null;
  const cfg = readConfig();
  try {
    server = await startServer({ dataDir: cfg.dataDir, port: cfg.port, webDir: path.join(__dirname, 'web-dist') });
  } catch (err) {
    lastError = err.code === 'EADDRINUSE' ? `A porta ${cfg.port} já está em uso por outro programa. Escolha outra porta.` : err.message;
  }
  updateTray();
  win?.webContents.send('state', state());
}

function state() {
  const cfg = readConfig();
  return {
    running: !!server,
    error: lastError,
    urls: server?.urls ?? [],
    hostUrl: server?.hostUrl ?? null,
    dataDir: cfg.dataDir,
    port: cfg.port,
    autostart: app.getLoginItemSettings().openAtLogin,
    version: app.getVersion(),
  };
}

/** Ícone da bandeja: quadrado azul com um "C" branco, desenhado em pixels (sem arquivo de imagem). */
function trayIcon() {
  const n = 32;
  const buf = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const corner = Math.min(x, n - 1 - x) + Math.min(y, n - 1 - y) < 5;
      const dx = x - 15.5;
      const dy = y - 15.5;
      const r = Math.hypot(dx, dy);
      const ring = r > 7 && r < 11 && !(dx > 4 && Math.abs(dy) < 5);
      const [b, g, rr, a] = corner ? [0, 0, 0, 0] : ring ? [255, 255, 255, 255] : [216, 110, 29, 255];
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = rr;
      buf[i + 3] = a;
    }
  return nativeImage.createFromBitmap(buf, { width: n, height: n });
}

function openInBrowser() {
  if (server) shell.openExternal(server.urls[0]);
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(server ? `SmartEasyBIM CDE — no ar (porta ${server.port})` : 'SmartEasyBIM CDE — parado');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: server ? `CDE no ar: ${server.hostUrl}` : 'CDE parado', enabled: false },
      { type: 'separator' },
      { label: 'Abrir o CDE no navegador', click: openInBrowser, enabled: !!server },
      { label: 'Painel do servidor', click: showWindow },
      { type: 'separator' },
      {
        label: 'Sair (desliga o CDE para todos)',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function showWindow() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 720,
    height: 680,
    title: 'SmartEasyBIM CDE',
    icon: trayIcon(),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'console.html'));
  win.on('close', (e) => {
    if (quitting) return;
    // Fechar a janela só esconde: o servidor continua atendendo a rede.
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    win = null;
  });
}

ipcMain.handle('cde:state', () => state());
ipcMain.handle('cde:openBrowser', () => openInBrowser());
ipcMain.handle('cde:openFolder', () => shell.openPath(readConfig().dataDir));
ipcMain.handle('cde:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Pasta dos dados do CDE (banco e arquivos)',
    defaultPath: readConfig().dataDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return state();
  writeConfig({ ...readConfig(), dataDir: r.filePaths[0] });
  await restart();
  return state();
});
ipcMain.handle('cde:setPort', async (_e, port) => {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('Porta inválida (use de 1024 a 65535).');
  writeConfig({ ...readConfig(), port: p });
  await restart();
  return state();
});
ipcMain.handle('cde:setAutostart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--oculto'] });
  return state();
});
ipcMain.handle('cde:restart', async () => {
  await restart();
  return state();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.smarteasybim.cde');
    tray = new Tray(trayIcon());
    tray.on('click', showWindow);
    await restart();
    // Iniciado com o Windows: fica só na bandeja.
    if (!process.argv.includes('--oculto')) showWindow();
  });
  app.on('window-all-closed', () => {
    /* continua na bandeja */
  });
  app.on('before-quit', async (e) => {
    quitting = true;
    if (server) {
      e.preventDefault();
      const s = server;
      server = null;
      await s.close().catch(() => {});
      app.quit();
    }
  });
}
