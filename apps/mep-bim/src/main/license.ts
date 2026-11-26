// Licença do SmartEasyBIM no app desktop: identifica a máquina, ativa com a chave no servidor de
// licenças, guarda a autorização assinada (vale 30 dias sem internet) e renova em segundo plano.
import { app, BrowserWindow, dialog, ipcMain, net } from "electron";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname, networkInterfaces, platform, release, userInfo } from "node:os";
import { join } from "node:path";
import { checkLicense, machineHash, normalizeKey, type LicenseFile, type LicenseState, type LicenseToken } from "./licenseCore";

/** Endereço do servidor de licenças (Gestão de Projetos). Pode ser trocado na janela de ativação. */
export const DEFAULT_LICENSE_SERVER = process.env["SEB_LICENCA_URL"] ?? "https://calculos-instalacoes.vercel.app";

const FILE = () => join(app.getPath("userData"), "licenca.json");

/** A licença só é exigida no app instalado (ou com SEB_LICENCA=1, para testar). */
export const licenseRequired = () => app.isPackaged || process.env["SEB_LICENCA"] === "1";

// ---- Máquina ----------------------------------------------------------------------------------
const run = (cmd: string, args: string[]) =>
  new Promise<string>((res) => execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, out) => res(err ? "" : String(out))));

let machine: { id: string; nome: string } | null = null;
/** Identificador estável da máquina (Windows: MachineGuid), em hash. */
export async function machineInfo() {
  if (machine) return machine;
  let raw = "";
  if (process.platform === "win32") raw = /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(await run("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]))?.[1] ?? "";
  else if (process.platform === "darwin") raw = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(await run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]))?.[1] ?? "";
  else raw = (await readFile("/etc/machine-id", "utf8").catch(() => "")).trim();
  if (!raw) {
    // Sem identificador do sistema: nome + placas de rede (menos estável, mas único).
    const macs = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal && n.mac !== "00:00:00:00:00:00")
      .map((n) => n!.mac)
      .sort();
    raw = `${hostname()}|${macs.join(",")}`;
  }
  machine = { id: machineHash(raw), nome: hostname() };
  return machine;
}

// ---- Arquivo e situação -------------------------------------------------------------------------
async function readFileLicense(): Promise<LicenseFile | null> {
  try {
    return JSON.parse(await readFile(FILE(), "utf8")) as LicenseFile;
  } catch {
    return null;
  }
}
async function writeFileLicense(f: LicenseFile) {
  await writeFile(FILE(), JSON.stringify(f, null, 2), "utf8");
}

export async function currentState(): Promise<LicenseState & { servidor: string }> {
  const f = await readFileLicense();
  const st = checkLicense(f, (await machineInfo()).id);
  // Guarda a maior data vista (relógio atrasado de propósito não reabre uma licença vencida).
  if (f && st.ok && Date.now() > Date.parse(f.visto || "0")) await writeFileLicense({ ...f, visto: new Date().toISOString() });
  return { ...st, servidor: f?.servidor || DEFAULT_LICENSE_SERVER };
}

// ---- Servidor ------------------------------------------------------------------------------------
interface Answer {
  error?: string;
  codigo?: string;
  token?: string;
  dados?: LicenseToken;
}

async function post(server: string, path: string, body: unknown): Promise<Answer> {
  const url = `${server.trim().replace(/\/+$/, "")}${path}`;
  if (!/^https?:\/\//i.test(url)) throw new Error("Informe o endereço do servidor de licenças (https://…).");
  let r: Response;
  try {
    r = await net.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Sem conexão com o servidor de licenças. Confira a internet e tente de novo.");
  }
  const data = (await r.json().catch(() => ({}))) as Answer;
  if (!r.ok) throw Object.assign(new Error(data.error || `Erro ${r.status} no servidor de licenças.`), { codigo: data.codigo });
  return data;
}

/** Resposta com autorização (ativar/renovar). */
function withToken(a: Answer): { token: string; dados: LicenseToken } {
  if (!a.token || !a.dados) throw new Error("Resposta inesperada do servidor de licenças.");
  return { token: a.token, dados: a.dados };
}

const machinePayload = async () => {
  const m = await machineInfo();
  let usuario = "";
  try {
    usuario = userInfo().username;
  } catch {
    /* sem usuário */
  }
  return { id: m.id, nome: m.nome, usuario, sistema: `${platform() === "win32" ? "Windows" : platform()} ${release()}`, versao: app.getVersion() };
};

export async function activate(server: string, rawKey: string) {
  const chave = normalizeKey(rawKey);
  if (!chave) throw new Error("Chave em formato inválido. Ela é assim: SEB-XXXXX-XXXXX-XXXXX-XXXXX.");
  const r = withToken(await post(server, "/api/licencas/ativar", { chave, maquina: await machinePayload() }));
  await writeFileLicense({ servidor: server.trim().replace(/\/+$/, ""), token: r.token, visto: new Date().toISOString() });
  return r.dados;
}

/** Renova a autorização se possível (silencioso sem internet). */
export async function renewIfPossible(): Promise<void> {
  const f = await readFileLicense();
  if (!f?.token || !f.servidor) return;
  try {
    const r = withToken(await post(f.servidor, "/api/licencas/renovar", { token: f.token, maquina: await machinePayload() }));
    await writeFileLicense({ ...f, token: r.token, visto: new Date().toISOString() });
  } catch (e) {
    // Posto liberado ou licença bloqueada: a autorização atual vale até vencer; a próxima
    // abertura depois disso pede a ativação.
    const codigo = (e as { codigo?: string }).codigo;
    if (codigo) console.warn("Licença não renovada:", codigo);
  }
}

export async function deactivate() {
  const f = await readFileLicense();
  if (f?.token && f.servidor) {
    try {
      await post(f.servidor, "/api/licencas/desativar", { token: f.token });
    } catch (e) {
      throw new Error(`Não foi possível liberar o posto no servidor: ${(e as Error).message}`);
    }
  }
  await rm(FILE(), { force: true });
}

// ---- Janela de ativação ----------------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function activationHtml(st: LicenseState & { servidor: string }, m: { id: string; nome: string }) {
  const msg = st.ok ? "" : st.motivo === "ausente" ? "" : st.mensagem;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>SmartEasyBIM — Licença</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
body{font:14px/1.45 "Segoe UI",system-ui,sans-serif;margin:0;background:#14171c;color:#e5e7eb}
main{padding:24px 28px}h1{font-size:18px;margin:0 0 4px;color:#fff}p{margin:6px 0;color:#9ca3af}
label{display:block;margin-top:14px;font-size:12px;color:#9ca3af}
input{width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;border-radius:6px;border:1px solid #374151;background:#1f2937;color:#fff;font:15px Consolas,monospace;letter-spacing:.04em}
#servidor{font:13px "Segoe UI",sans-serif;letter-spacing:0}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
button{font:inherit;padding:7px 16px;border-radius:6px;border:1px solid #374151;background:#1f2937;color:#e5e7eb;cursor:pointer}
button.primary{background:#22d3ee;border-color:#22d3ee;color:#0b1b33;font-weight:600}button:disabled{opacity:.5}
#msg{min-height:20px;margin-top:12px;color:#fca5a5}#msg.ok{color:#86efac}
small{color:#6b7280}details{margin-top:10px}summary{cursor:pointer;color:#9ca3af;font-size:12px}
</style></head><body><main>
<h1>Ativar o SmartEasyBIM</h1>
<p>Digite a chave de licença recebida do fornecedor. A ativação usa a internet uma vez; depois o SmartEasyBIM funciona até 30 dias sem conexão e renova a autorização sozinho.</p>
<label>Chave de licença<input id="chave" placeholder="SEB-XXXXX-XXXXX-XXXXX-XXXXX" autofocus spellcheck="false"></label>
<details ${st.servidor ? "" : "open"}><summary>Servidor de licenças</summary>
<label>Endereço<input id="servidor" value="${esc(st.servidor)}" placeholder="https://…" spellcheck="false"></label></details>
<div id="msg">${esc(msg)}</div>
<div class="row"><button id="sair">Sair</button><button id="ativar" class="primary">Ativar</button></div>
<p><small>Máquina: ${esc(m.nome)} · identificação ${esc(m.id.slice(0, 12))}</small></p>
</main><script>
const $=(id)=>document.getElementById(id);
$("sair").onclick=()=>window.desktop.license.quit();
async function go(){const b=$("ativar");b.disabled=true;$("msg").className="";$("msg").textContent="Ativando…";
try{const r=await window.desktop.license.activate($("servidor").value,$("chave").value);$("msg").className="ok";$("msg").textContent="Licença de "+r.cliente+" ativada.";}
catch(e){$("msg").textContent=String(e&&e.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,"");b.disabled=false;}}
$("ativar").onclick=go;$("chave").addEventListener("keydown",(e)=>{if(e.key==="Enter")go();});
</script></body></html>`;
}

let activationWindow: BrowserWindow | null = null;

/**
 * Garante a licença antes de abrir o app: se válida, segue (e renova em segundo plano); senão abre
 * a janela de ativação e só chama `onReady` depois de ativar.
 */
export async function ensureLicense(onReady: () => void) {
  if (!licenseRequired()) return onReady();
  const st = await currentState();
  if (st.ok) {
    onReady();
    // Renova sempre que houver conexão (mantém os 30 dias cheios e o "último contato" em dia).
    void renewIfPossible();
    return;
  }
  const m = await machineInfo();
  activationWindow = new BrowserWindow({
    width: 560,
    height: 430,
    resizable: false,
    title: "SmartEasyBIM — Licença",
    backgroundColor: "#14171c",
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  activationWindow.setMenu(null);
  activationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(activationHtml(st, m))}`);
  let activated = false;
  ipcMain.removeHandler("license:activate");
  ipcMain.handle("license:activate", async (_e, server: string, key: string) => {
    const dados = await activate(server, key);
    activated = true;
    setTimeout(() => {
      activationWindow?.close();
      onReady();
    }, 900);
    return { cliente: dados.cliente };
  });
  activationWindow.on("closed", () => {
    activationWindow = null;
    if (!activated) app.quit();
  });
}

ipcMain.on("license:quit", () => app.quit());

/** Ajuda › Licença: dados da licença e opção de liberar o posto desta máquina. */
export async function showLicenseDialog(parent: BrowserWindow | null) {
  const st = await currentState();
  const m = await machineInfo();
  const d = st.dados;
  const detail = d
    ? [
        `Licenciado para: ${d.cliente}`,
        `Máquinas da licença: ${d.postos}`,
        `Validade da licença: ${d.validade ? new Date(d.validade).toLocaleDateString("pt-BR") : "sem vencimento"}`,
        `Autorização desta máquina até: ${new Date(d.expira).toLocaleDateString("pt-BR")} (renova sozinha com internet)`,
        `Máquina: ${m.nome} · ${m.id.slice(0, 12)}`,
        `Servidor: ${st.servidor || "—"}`,
      ].join("\n")
    : st.ok
      ? ""
      : st.mensagem;
  const opts = {
    type: "info" as const,
    title: "Licença do SmartEasyBIM",
    message: licenseRequired() ? (st.ok ? "Licença ativa" : "Sem licença válida") : "Versão de desenvolvimento (licença não exigida)",
    detail,
    buttons: ["Fechar", "Desativar esta máquina…"],
    cancelId: 0,
    defaultId: 0,
  };
  const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  if (r.response !== 1) return;
  const c = await dialog.showMessageBox({
    type: "warning",
    title: "Desativar esta máquina",
    message: "Liberar o posto desta máquina e fechar o SmartEasyBIM?",
    detail: "Use ao trocar de computador: o posto fica livre para outra máquina. Para usar de novo aqui, será preciso a chave de licença.",
    buttons: ["Cancelar", "Desativar e fechar"],
    cancelId: 0,
    defaultId: 0,
  });
  if (c.response !== 1) return;
  try {
    await deactivate();
    app.quit();
  } catch (e) {
    dialog.showErrorBox("Licença", (e as Error).message);
  }
}
