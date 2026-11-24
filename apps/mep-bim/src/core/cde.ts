// Gestão da informação (ISO 19650 / NBR ISO 19650), no projeto do SmartEasyBIM:
// - codificação dos documentos: Projeto-Originador-Volume-Nível-Tipo-Disciplina-Número
//   (ex.: HTL-SEB-ZZ-01-DR-EL-0001);
// - revisões: P01, P02… enquanto em andamento/compartilhado (preliminar); C01, C02… depois de
//   publicado (contratual);
// - estados e finalidade (código de adequação): em andamento (S0), compartilhado (S1 a S4),
//   publicado (A1…, para construção), arquivado (AR);
// - emissões (GRD / transmittal): o que saiu, em que revisão, para quem e com que finalidade.
import type { Discipline } from "./types";

export type CdeState = "andamento" | "compartilhado" | "publicado" | "arquivado";

export const STATE_LABEL: Record<CdeState, string> = {
  andamento: "Em andamento",
  compartilhado: "Compartilhado",
  publicado: "Publicado",
  arquivado: "Arquivado",
};

/** Finalidade (código de adequação da ISO 19650) por estado. */
export const SUITABILITY: Record<CdeState, { code: string; label: string }[]> = {
  andamento: [{ code: "S0", label: "Em andamento (uso interno)" }],
  compartilhado: [
    { code: "S1", label: "Para coordenação" },
    { code: "S2", label: "Para informação" },
    { code: "S3", label: "Para revisão e comentários" },
    { code: "S4", label: "Para aprovação" },
  ],
  publicado: [
    { code: "A1", label: "Aprovado para construção" },
    { code: "A2", label: "Aprovado para licitação" },
    { code: "A3", label: "Aprovado para fabricação" },
    { code: "B1", label: "Aprovado parcialmente (com comentários)" },
  ],
  arquivado: [{ code: "AR", label: "Arquivado (substituído)" }],
};

export const suitabilityLabel = (code: string) =>
  Object.values(SUITABILITY)
    .flat()
    .find((s) => s.code === code)?.label ?? code;

/** Tipos de documento (ISO 19650, anexo nacional). */
export const DOC_TYPES: { code: string; label: string }[] = [
  { code: "DR", label: "Desenho (prancha)" },
  { code: "M3", label: "Modelo 3D" },
  { code: "M2", label: "Modelo 2D" },
  { code: "SH", label: "Planilha / quantitativos" },
  { code: "CA", label: "Memória de cálculo" },
  { code: "SP", label: "Especificação / memorial" },
  { code: "RP", label: "Relatório" },
  { code: "SC", label: "Esquema / fluxograma" },
];

/** Código da disciplina no nome dos arquivos (editável no projeto). */
export const DISCIPLINE_CODE: Record<Discipline, string> = {
  eletrica: "EL",
  telecom: "TC",
  hidraulica: "HD",
  incendio: "IN",
  gas: "GS",
  hvac: "AC",
  mep: "MP",
  estrutura: "ES",
  arquitetura: "AR",
  outros: "ZZ",
};

/** Campos do projeto (iguais em todos os documentos). */
export interface ProjectCoding {
  /** Código curto do projeto (ex.: "HTL"). */
  projeto: string;
  /** Empresa que produz a informação (ex.: "SEB"). */
  originador: string;
  /** Volume/zona padrão ("ZZ" = vários, "XX" = nenhum). */
  volume: string;
  /** Responsável padrão pelas revisões. */
  autor: string;
}

export const EMPTY_CODING: ProjectCoding = { projeto: "", originador: "", volume: "ZZ", autor: "" };

/** Uma revisão registrada do documento. */
export interface Revision {
  rev: string;
  data: string;
  estado: CdeState;
  finalidade: string;
  descricao: string;
  autor: string;
}

/** Campos de cada documento (folha ou modelo) e o histórico de revisões. */
export interface DocMeta {
  /** Volume (vazio = o do projeto). */
  volume?: string;
  /** Nível ("00", "01"…, "ZZ" = vários, "XX" = nenhum). */
  nivel: string;
  tipo: string;
  disciplina: string;
  /** Número sequencial (4 dígitos). */
  numero: string;
  revisao: string;
  estado: CdeState;
  finalidade: string;
  historico: Revision[];
}

/** Item de uma emissão (GRD). */
export interface EmissionItem {
  /** Folha (id) ou modelo ("modelo:<disciplina>"). */
  docId: string;
  codigo: string;
  titulo: string;
  revisao: string;
  estado: CdeState;
  finalidade: string;
  formato: string;
}

export interface Emission {
  id: string;
  /** Número da GRD (ex.: "GRD-003"). */
  numero: string;
  data: string;
  destinatario: string;
  finalidade: string;
  observacoes: string;
  autor: string;
  itens: EmissionItem[];
}

/** Gestão da informação do projeto (gravada no .seb). */
export interface CdeData {
  coding: ProjectCoding;
  /** Modelos (IFC por disciplina), pela disciplina do app. */
  modelos: Partial<Record<Discipline, DocMeta>>;
  emissoes: Emission[];
}

export const EMPTY_CDE: CdeData = { coding: EMPTY_CODING, modelos: {}, emissoes: [] };

// ---- Código ---------------------------------------------------------------------------------

/** Campo de código: maiúsculas, sem acentos, só letras e números. */
export function codeField(s: string, fallback = "XX"): string {
  const v = (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return v || fallback;
}

export const padNumber = (n: string | number) => {
  const d = String(n).replace(/\D/g, "");
  return (d || "1").padStart(4, "0").slice(-6);
};

/** Código completo do documento (ISO 19650): Projeto-Originador-Volume-Nível-Tipo-Disciplina-Número. */
export function docCode(c: ProjectCoding, d: Pick<DocMeta, "volume" | "nivel" | "tipo" | "disciplina" | "numero">): string {
  return [codeField(c.projeto, "PRJ"), codeField(c.originador, "ORG"), codeField(d.volume || c.volume, "ZZ"), codeField(d.nivel, "ZZ"), codeField(d.tipo, "DR"), codeField(d.disciplina, "ZZ"), padNumber(d.numero)].join("-");
}

/** Nome de arquivo: código e revisão (ex.: HTL-SEB-ZZ-01-DR-EL-0001_P02.pdf). */
export const docFileName = (c: ProjectCoding, d: DocMeta, ext: string) => `${docCode(c, d)}_${d.revisao}.${ext}`;

/** O projeto já tem código (projeto e originador): os arquivos saem com o nome padronizado. */
export const hasCoding = (c: ProjectCoding | undefined) => !!c && !!c.projeto.trim() && !!c.originador.trim();

// ---- Revisões --------------------------------------------------------------------------------

/**
 * Próxima revisão. Preliminar (P01, P02…) até ser publicado; ao publicar pela primeira vez vira
 * C01; publicado de novo: C02…
 */
export function nextRevision(rev: string, publishing: boolean): string {
  const m = /^([PC])(\d+)$/i.exec(rev.trim());
  const kind = m ? m[1].toUpperCase() : "P";
  const n = m ? Number(m[2]) : 0;
  if (publishing) return kind === "C" ? `C${String(n + 1).padStart(2, "0")}` : "C01";
  return kind === "C" ? `C${String(n + 1).padStart(2, "0")}` : `P${String(n + 1).padStart(2, "0")}`;
}

/** Documento novo: P01, em andamento. */
export function newDocMeta(fields: Partial<DocMeta> = {}): DocMeta {
  return { nivel: "ZZ", tipo: "DR", disciplina: "ZZ", numero: "0001", revisao: "P01", estado: "andamento", finalidade: "S0", historico: [], ...fields };
}

/**
 * Muda o estado do documento. Compartilhar/publicar gera uma revisão nova (registrada no
 * histórico); arquivar só marca. Voltar para "em andamento" mantém a revisão (o trabalho segue nela).
 */
export function changeState(d: DocMeta, estado: CdeState, finalidade: string, descricao: string, autor: string, data: string): DocMeta {
  const fin = finalidade || SUITABILITY[estado][0].code;
  if (estado === "andamento" || estado === "arquivado") return { ...d, estado, finalidade: fin };
  // A revisão atual é usada na primeira vez; depois de emitida, a próxima emissão avança.
  // Publicar leva à série contratual (C01, C02…), continuando a última C do histórico.
  const used = d.historico.some((h) => h.rev === d.revisao);
  let rev: string;
  if (estado === "publicado") {
    if (d.revisao.startsWith("C") && !used) rev = d.revisao;
    else {
      const lastC = d.historico.reduce((m, h) => Math.max(m, /^C(\d+)$/.exec(h.rev) ? Number(h.rev.slice(1)) : 0), 0);
      rev = `C${String(lastC + 1).padStart(2, "0")}`;
    }
  } else rev = used ? nextRevision(d.revisao, false) : d.revisao;
  return { ...d, revisao: rev, estado, finalidade: fin, historico: [...d.historico, { rev, data, estado, finalidade: fin, descricao, autor }] };
}

/** Próximo número de GRD do projeto. */
export function nextEmissionNumber(list: Emission[]): string {
  const n = list.reduce((m, e) => Math.max(m, Number(/(\d+)\s*$/.exec(e.numero)?.[1] ?? 0)), 0);
  return `GRD-${String(n + 1).padStart(3, "0")}`;
}

/**
 * Nível do código pela posição do pavimento: térreo "00", acima "01", "02"…, abaixo "B1", "B2"…;
 * vários ou nenhum, "ZZ". O térreo é o pavimento com esse nome; sem ele, o de cota mais perto de 0
 * (cotas do projeto, não da cena).
 */
export function levelCode(storey: string | null | undefined, storeys: { name: string; level: number }[]): string {
  if (!storey) return "ZZ";
  const sorted = [...storeys].sort((a, b) => a.level - b.level);
  const i = sorted.findIndex((s) => s.name === storey);
  if (i < 0) return "ZZ";
  let ground = sorted.findIndex((s) => /t[ée]rreo|ground|^pavimento 0$|^piso 0$/i.test(s.name.trim()));
  if (ground < 0) ground = sorted.reduce((b, s, k) => (Math.abs(s.level) < Math.abs(sorted[b].level) ? k : b), 0);
  const k = i - ground;
  return k < 0 ? `B${-k}` : String(k).padStart(2, "0");
}

// ---- Lista de emissão (CSV) ------------------------------------------------------------------------

/** Lista de documentos da emissão (CSV com ponto e vírgula, para Excel em português). */
export function emissionCsv(e: Emission, c: ProjectCoding): string {
  const q = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = [`${e.numero} - ${c.projeto}`, `Data: ${e.data}`, `Destinatário: ${e.destinatario}`, `Finalidade: ${suitabilityLabel(e.finalidade)}`].map(q).join(";");
  const rows = e.itens.map((i) => [i.codigo, i.titulo, i.revisao, STATE_LABEL[i.estado], `${i.finalidade} - ${suitabilityLabel(i.finalidade)}`, i.formato].map(q).join(";"));
  return [head, "", ["Código", "Título", "Revisão", "Estado", "Finalidade", "Formato"].map(q).join(";"), ...rows, "", q(`Emitido por: ${e.autor}`), q(`Observações: ${e.observacoes}`)].join("\r\n");
}

// ---- Documentos do projeto -------------------------------------------------------------------------

/** Folha: campos gravados ou, sem eles, o padrão (desenho, nível do pavimento, número pela ordem). */
export function sheetDocMeta(sheet: { cde?: DocMeta }, index: number, nivel: string, disciplina: string): DocMeta {
  return sheet.cde ?? newDocMeta({ tipo: "DR", nivel, disciplina, numero: padNumber(index + 1) });
}

/** Modelo (IFC de uma disciplina): campos gravados ou o padrão (modelo 3D, vários níveis). */
export function modelDocMeta(cde: CdeData, d: Discipline): DocMeta {
  return cde.modelos[d] ?? newDocMeta({ tipo: "M3", nivel: "ZZ", disciplina: DISCIPLINE_CODE[d], numero: "0001" });
}

// ---- Guia de remessa (GRD) em folha A4 -------------------------------------------------------------

const xml = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GRD em A4 retrato (SVG em mm, para o PDF). Itens que não cabem continuam em "… e mais N". */
export function emissionSvg(e: Emission, c: ProjectCoding): string {
  const W = 210, H = 297, M = 15;
  const F = `font-family="Arial, sans-serif"`;
  const out: string[] = [`<rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" fill="none" stroke="#000" stroke-width="0.4"/>`];
  const t = (x: number, y: number, s: string, size = 3, extra = "") => out.push(`<text x="${x}" y="${y}" font-size="${size}" ${F} ${extra}>${xml(s)}</text>`);
  t(M + 4, M + 10, "GUIA DE REMESSA DE DOCUMENTOS (GRD)", 5, `font-weight="bold"`);
  t(W - M - 4, M + 10, e.numero, 5, `text-anchor="end" font-weight="bold"`);
  const info: [string, string][] = [
    ["Projeto", c.projeto],
    ["Originador", c.originador],
    ["Data", e.data],
    ["Destinatário", e.destinatario || "—"],
    ["Finalidade", `${e.finalidade} — ${suitabilityLabel(e.finalidade)}`],
    ["Emitido por", e.autor || "—"],
  ];
  info.forEach(([k, v], i) => {
    const y = M + 20 + i * 6;
    t(M + 4, y, `${k}:`, 3, `fill="#555"`);
    t(M + 34, y, v, 3.2);
  });
  // Tabela.
  const cols = [
    { h: "Código", w: 62 },
    { h: "Título", w: 54 },
    { h: "Rev.", w: 12 },
    { h: "Estado", w: 24 },
    { h: "Fin.", w: 10 },
    { h: "Formato", w: 18 },
  ];
  let y = M + 62;
  let x = M + 2;
  out.push(`<rect x="${M + 2}" y="${y - 5}" width="${W - 2 * M - 4}" height="7" fill="#e5e7eb"/>`);
  for (const col of cols) {
    t(x + 1.5, y, col.h, 2.8, `font-weight="bold"`);
    x += col.w;
  }
  const rowH = 6;
  const maxRows = Math.floor((H - M - 40 - y) / rowH);
  const shown = e.itens.slice(0, maxRows);
  shown.forEach((it, i) => {
    const ry = y + (i + 1) * rowH;
    out.push(`<line x1="${M + 2}" y1="${ry - 4.5}" x2="${W - M - 2}" y2="${ry - 4.5}" stroke="#bbb" stroke-width="0.2"/>`);
    const vals = [it.codigo, it.titulo.length > 34 ? `${it.titulo.slice(0, 33)}…` : it.titulo, it.revisao, STATE_LABEL[it.estado], it.finalidade, it.formato];
    let cx = M + 2;
    vals.forEach((v, k) => {
      t(cx + 1.5, ry, v, k === 0 ? 2.5 : 2.7);
      cx += cols[k].w;
    });
  });
  if (e.itens.length > shown.length) t(M + 4, y + (shown.length + 1) * rowH, `… e mais ${e.itens.length - shown.length} documento(s) (ver a lista em CSV)`, 2.7, `fill="#555"`);
  // Observações e recebimento.
  const by = H - M - 30;
  out.push(`<line x1="${M}" y1="${by}" x2="${W - M}" y2="${by}" stroke="#000" stroke-width="0.3"/>`);
  t(M + 4, by + 6, `Observações: ${e.observacoes || "—"}`, 3);
  t(M + 4, by + 22, "Recebido por: ______________________________     Data: ____/____/______", 3);
  t(W - M - 2, H - M + 5, "Gerado pelo SmartEasyBIM · ISO 19650", 2.2, `text-anchor="end" fill="#666"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${out.join("")}</svg>`;
}
