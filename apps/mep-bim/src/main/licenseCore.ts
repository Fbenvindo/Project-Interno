// Licença do SmartEasyBIM (parte sem Electron, testável): confere a autorização assinada pelo
// servidor de licenças (Ed25519, chave pública embutida), a máquina, a validade e o relógio.
import { createHash, createPublicKey, verify } from "node:crypto";

/** Chave pública do servidor de licenças (a privada fica só no servidor). */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAu1kfPOpCv6cay1inONgmTO8ESa9qhGnnpraI4+PEQR4=
-----END PUBLIC KEY-----`;

/** Renova a autorização quando faltar menos que isso (e sempre que der, em segundo plano). */
export const RENEW_BEFORE_DAYS = 25;

export interface LicenseToken {
  v: 1;
  lic: string;
  ativacao: string;
  cliente: string;
  produto: string;
  maquina: string;
  postos: number;
  emitido: string;
  expira: string;
  validade: string | null;
}

/** O que fica gravado na máquina (pasta de dados do app). */
export interface LicenseFile {
  servidor: string;
  token: string;
  /** Maior data/hora já vista pelo app (detecta relógio atrasado de propósito). */
  visto: string;
}

export type LicenseState =
  | { ok: true; dados: LicenseToken; diasRestantes: number; renovar: boolean }
  | { ok: false; motivo: "ausente" | "invalida" | "outra_maquina" | "expirada" | "relogio"; mensagem: string; dados?: LicenseToken };

/** Identificador da máquina enviado ao servidor: hash do identificador do sistema. */
export const machineHash = (raw: string) => createHash("sha256").update(`smarteasybim:${raw.trim().toLowerCase()}`).digest("hex");

/** Lê e confere a assinatura; devolve os dados ou null. */
export function readToken(token: string, publicKeyPem = LICENSE_PUBLIC_KEY): LicenseToken | null {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  try {
    if (!verify(null, Buffer.from(payload), createPublicKey(publicKeyPem), Buffer.from(sig, "base64url"))) return null;
    const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LicenseToken;
    return t?.v === 1 && t.produto === "smarteasybim" && !!t.ativacao ? t : null;
  } catch {
    return null;
  }
}

const DAY = 864e5;

/** Situação da licença nesta máquina, agora (sem internet). */
export function checkLicense(file: LicenseFile | null, machineId: string, now = new Date(), publicKeyPem = LICENSE_PUBLIC_KEY): LicenseState {
  if (!file?.token) return { ok: false, motivo: "ausente", mensagem: "Esta máquina ainda não tem licença do SmartEasyBIM." };
  const t = readToken(file.token, publicKeyPem);
  if (!t) return { ok: false, motivo: "invalida", mensagem: "A licença gravada nesta máquina é inválida. Ative de novo." };
  if (t.maquina !== machineId) return { ok: false, motivo: "outra_maquina", mensagem: "A licença gravada é de outra máquina. Ative a licença nesta.", dados: t };
  const seen = Date.parse(file.visto || "");
  if (Number.isFinite(seen) && now.getTime() < seen - DAY)
    return { ok: false, motivo: "relogio", mensagem: "O relógio do computador está atrasado em relação ao último uso. Acerte a data e a hora do Windows.", dados: t };
  const left = (Date.parse(t.expira) - now.getTime()) / DAY;
  if (!(left > 0)) {
    const venceu = t.validade && Date.parse(t.validade) <= now.getTime();
    return {
      ok: false,
      motivo: "expirada",
      mensagem: venceu
        ? `A licença de ${t.cliente} venceu em ${new Date(t.validade!).toLocaleDateString("pt-BR")}. Fale com o fornecedor para renovar.`
        : "A autorização desta máquina venceu: conecte à internet para renovar (ou ative de novo).",
      dados: t,
    };
  }
  return { ok: true, dados: t, diasRestantes: Math.floor(left), renovar: left < RENEW_BEFORE_DAYS };
}

/** Normaliza a chave digitada (maiúsculas, hífens nos lugares). */
export function normalizeKey(raw: string): string {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^SEB/, "");
  return s.length === 20 ? `SEB-${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}` : "";
}
