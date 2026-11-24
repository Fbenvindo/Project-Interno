// Cliente do CDE do servidor (SmartEasyBIM CDE na rede do escritório, ou a versão em nuvem): login, empreendimentos, documentos, envio e
// download de arquivos e emissões. No app desktop as requisições passam pelo processo principal
// (a CSP do app não deixa o renderer acessar a rede, e o S3 exigiria CORS); no navegador, fetch.
import { desktop } from "../platform";

export interface CdeSession {
  url: string;
  token: string;
  user: { id: string | number; name: string | null; email: string; perfil?: string };
}

export interface ServerDoc {
  id: number;
  codigo: string;
  titulo: string;
  tipo: string;
  disciplina: string;
  nivel: string;
  numero: string;
  volume: string;
  revisao: string;
  estado: "andamento" | "compartilhado" | "publicado" | "arquivado";
  finalidade: string;
  arquivo_nome: string | null;
  arquivo_key: string | null;
  tamanho: number | null;
  updated_at: string;
}

export interface Overview {
  config: { projeto: string; originador: string; volume: string };
  documentos: ServerDoc[];
  emissoes: { id: number; numero: string; data: string; itens: unknown[] }[];
  podeAprovar: boolean;
  armazenamento: "s3" | "local";
}

/** Endereço padrão: o servidor do CDE no próprio computador (troque pelo do servidor do escritório). */
export const DEFAULT_CDE_URL = "http://localhost:4000";
const KEY = "smarteasybim.cde";

export function loadSession(): CdeSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return s?.token && s?.url ? s : null;
  } catch {
    return null;
  }
}
export function saveSession(s: CdeSession | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* sem armazenamento */
  }
}

interface RawResponse {
  status: number;
  contentType: string | null;
  body: Uint8Array;
}

async function http(url: string, method: string, headers: Record<string, string>, body?: string | Uint8Array): Promise<RawResponse> {
  if (desktop?.http) return desktop.http({ url, method, headers, body });
  const r = await fetch(url, { method, headers, body: body as BodyInit | undefined });
  return { status: r.status, contentType: r.headers.get("content-type"), body: new Uint8Array(await r.arrayBuffer()) };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");

async function json<T>(s: Pick<CdeSession, "url"> & { token?: string }, method: string, path: string, body?: unknown): Promise<T> {
  const r = await http(`${trimUrl(s.url)}${path}`, method, { "Content-Type": "application/json", ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}) }, body ? JSON.stringify(body) : undefined);
  const t = text(r.body);
  let data: unknown = null;
  try {
    data = t ? JSON.parse(t) : null;
  } catch {
    data = { error: t.slice(0, 200) };
  }
  if (r.status === 401) throw new Error("Sessão do CDE expirada: entre de novo.");
  if (r.status < 200 || r.status >= 300) throw new Error((data as { error?: string })?.error || `Erro ${r.status} no CDE.`);
  return data as T;
}

export const cde = {
  async login(url: string, email: string, password: string): Promise<CdeSession> {
    const r = await json<{ token: string; user: CdeSession["user"] }>({ url }, "POST", "/api/auth/login", { email, password });
    return { url: trimUrl(url), token: r.token, user: r.user };
  },
  empreendimentos: (s: CdeSession) => json<{ id: number; nome: string; status?: string }[]>(s, "GET", "/api/empreendimentos"),
  overview: (s: CdeSession, empId: number) => json<Overview>(s, "GET", `/api/cde/${empId}`),
  createDoc: (s: CdeSession, empId: number, doc: Partial<ServerDoc> & { titulo: string; origem?: string }) => json<ServerDoc>(s, "POST", `/api/cde/${empId}/documentos`, doc),
  setState: (s: CdeSession, id: number, estado: string, finalidade: string, descricao: string) => json<ServerDoc>(s, "POST", `/api/cde/documentos/${id}/estado`, { estado, finalidade, descricao }),
  emit: (s: CdeSession, empId: number, payload: { documento_ids: number[]; estado: string; finalidade: string; destinatario: string; observacoes: string }) =>
    json<{ numero: string; itens: { documento_id: number; revisao: string }[] }>(s, "POST", `/api/cde/${empId}/emissoes`, payload),

  /** Envia um arquivo como nova versão do documento (URL assinada → PUT → confirmação). */
  async upload(s: CdeSession, docId: number, name: string, bytes: Uint8Array, contentType: string, descricao?: string): Promise<ServerDoc> {
    const u = await json<{ key: string; url: string; method: string; headers: Record<string, string> }>(s, "POST", `/api/cde/documentos/${docId}/upload`, { nome: name, content_type: contentType, tamanho: bytes.byteLength });
    const put = await http(u.url, u.method || "PUT", u.headers ?? { "Content-Type": contentType }, bytes);
    if (put.status < 200 || put.status >= 300) throw new Error(`Falha no envio do arquivo (${put.status}).`);
    return json<ServerDoc>(s, "POST", `/api/cde/documentos/${docId}/arquivo`, { key: u.key, nome: name, content_type: contentType, descricao });
  },

  /** Baixa o arquivo atual do documento: bytes e o nome padronizado (código_revisão.ext). */
  async download(s: CdeSession, docId: number): Promise<{ name: string; data: Uint8Array }> {
    const r = await json<{ url: string; nome: string }>(s, "GET", `/api/cde/documentos/${docId}/download`);
    const f = await http(r.url, "GET", {});
    if (f.status < 200 || f.status >= 300) throw new Error(`Falha no download (${f.status}).`);
    return { name: r.nome, data: f.body };
  },
};

/** Elemento de uma interferência (análise de clash do CDE). */
export interface ClashElement {
  id: number;
  globalId: string;
  tipo: string;
  nome: string;
  pavimento: string | null;
  documento_id: number;
  codigo: string;
}
export interface ClashComment {
  id: number;
  autor: string | null;
  texto: string;
  origem: string;
  created_at: string;
}
export interface ClashItem {
  id: number;
  numero: number;
  tipo: "colisao" | "folga";
  distancia: number;
  /** Ponto em coordenadas de cena do web-ifc (metros, Y para cima), absolutas. */
  ponto: [number, number, number];
  a: ClashElement;
  b: ClashElement;
  pavimento: string | null;
  estado: "nova" | "ativa" | "resolvida" | "aprovada";
  situacao?: "nova" | "mantida" | "reaberta";
  responsavel_nome: string | null;
  grupo_nome: string | null;
  comentarios?: ClashComment[];
}
export interface ClashPending {
  analises: { analise: { id: number; nome: string; concluida_at: string; modelos: { documento_id: number; codigo: string; revisao: string }[] }; interferencias: ClashItem[] }[];
  estados: Record<string, string>;
}

export const clash = {
  /** Interferências em aberto das análises mais recentes que envolvem estes documentos do CDE. */
  pending: (s: CdeSession, empId: number, docIds: number[]) => json<ClashPending>(s, "GET", `/api/clash/${empId}/pendencias${docIds.length ? `?documentos=${docIds.join(",")}` : ""}`),
  update: (s: CdeSession, analiseId: number, body: { ids: number[]; estado?: string; comentario?: string; origem?: string }) =>
    json<ClashItem[]>(s, "PATCH", `/api/clash/analises/${analiseId}/interferencias`, body),
};

/** Arquivos que entram como vínculo (modelos de outras disciplinas). */
export const isModelFile = (name: string | null) => !!name && /\.(ifc|sebmod)$/i.test(name);
