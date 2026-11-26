import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkLicense, LICENSE_PUBLIC_KEY, machineHash, normalizeKey, readToken, type LicenseToken } from "../src/main/licenseCore";

// Par de chaves só do teste (a pública de produção está embutida no app).
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
const M = machineHash("maquina-1");
const now = new Date("2026-12-01T12:00:00Z");
const tok = (over: Partial<LicenseToken> = {}, key = privateKey) => {
  const t: LicenseToken = {
    v: 1,
    lic: "l1",
    ativacao: "a1",
    cliente: "Escritório X",
    produto: "smarteasybim",
    maquina: M,
    postos: 3,
    emitido: "2026-11-20T00:00:00Z",
    expira: "2026-12-20T00:00:00Z",
    validade: null,
    ...over,
  };
  const p = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${p}.${sign(null, Buffer.from(p), key).toString("base64url")}`;
};
const file = (token: string, visto = "2026-11-30T00:00:00Z") => ({ servidor: "https://x", token, visto });

describe("licença do SmartEasyBIM", () => {
  it("autorização válida nesta máquina", () => {
    const st = checkLicense(file(tok()), M, now, pub);
    expect(st.ok).toBe(true);
    if (st.ok) {
      expect(st.dados.cliente).toBe("Escritório X");
      expect(st.diasRestantes).toBe(18);
      expect(st.renovar).toBe(true);
    }
  });
  it("recusa sem licença, adulterada, de outra chave, de outra máquina ou de outro produto", () => {
    expect(checkLicense(null, M, now, pub)).toMatchObject({ ok: false, motivo: "ausente" });
    const t = tok();
    const [p, s] = t.split(".");
    const forjado = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), postos: 99 })).toString("base64url");
    expect(checkLicense(file(`${forjado}.${s}`), M, now, pub)).toMatchObject({ ok: false, motivo: "invalida" });
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(checkLicense(file(tok({}, other)), M, now, pub)).toMatchObject({ ok: false, motivo: "invalida" });
    expect(checkLicense(file(tok()), machineHash("outra"), now, pub)).toMatchObject({ ok: false, motivo: "outra_maquina" });
    expect(readToken(tok({ produto: "outro" }), pub)).toBeNull();
  });
  it("autorização vencida e licença vencida", () => {
    expect(checkLicense(file(tok({ expira: "2026-11-30T00:00:00Z" })), M, now, pub)).toMatchObject({ ok: false, motivo: "expirada" });
    const st = checkLicense(file(tok({ expira: "2026-11-30T00:00:00Z", validade: "2026-11-30T00:00:00Z" })), M, now, pub);
    expect(st.ok ? "" : st.mensagem).toMatch(/venceu em 30\/11\/2026/);
  });
  it("relógio atrasado de propósito não reabre a licença", () => {
    expect(checkLicense(file(tok(), "2026-12-05T00:00:00Z"), M, now, pub)).toMatchObject({ ok: false, motivo: "relogio" });
    expect(checkLicense(file(tok(), "2026-12-01T20:00:00Z"), M, now, pub).ok).toBe(true); // fuso/ajuste de horas: tolera 1 dia
  });
  it("chave digitada de qualquer jeito", () => {
    expect(normalizeKey(" seb abcde-fghjk 23456 789ab ")).toBe("SEB-ABCDE-FGHJK-23456-789AB");
    expect(normalizeKey("SEB-123")).toBe("");
  });
  it("chave pública de produção embutida é Ed25519", () => {
    expect(LICENSE_PUBLIC_KEY).toMatch(/BEGIN PUBLIC KEY/);
    expect(readToken(tok(), LICENSE_PUBLIC_KEY)).toBeNull(); // token do teste não vale com a chave de produção
  });
});
