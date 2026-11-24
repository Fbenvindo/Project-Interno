// Cliente da API do CDE local (mesmo servidor que entrega esta página). Sessão por token no navegador.
const KEY = 'smarteasybim.cde.sessao';

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s?.token ? s : null;
  } catch {
    return null;
  }
}
export function saveSession(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* sem armazenamento */
  }
}

let onExpired = () => {};
export const setOnExpired = (fn) => {
  onExpired = fn;
};

export async function call(method, path, body) {
  const token = loadSession()?.token;
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (r.status === 401 && token && !path.startsWith('/api/auth/login')) onExpired();
  if (!r.ok) throw new Error(data?.error || `Erro ${r.status}`);
  return data;
}

export const api = {
  status: () => call('GET', '/api/status'),
  setup: (b) => call('POST', '/api/setup', b),
  login: (email, password) => call('POST', '/api/auth/login', { email, password }),
  changePassword: (atual, nova) => call('POST', '/api/auth/senha', { atual, nova }),
  users: () => call('GET', '/api/usuarios'),
  createUser: (b) => call('POST', '/api/usuarios', b),
  updateUser: (id, b) => call('PATCH', `/api/usuarios/${id}`, b),
  projects: () => call('GET', '/api/empreendimentos'),
  createProject: (b) => call('POST', '/api/empreendimentos', b),
  updateProject: (id, b) => call('PATCH', `/api/empreendimentos/${id}`, b),
};

export const cdeApi = {
  overview: (empId) => call('GET', `/api/cde/${empId}`),
  saveConfig: (empId, cfg) => call('PATCH', `/api/cde/${empId}/config`, cfg),
  createDoc: (empId, doc) => call('POST', `/api/cde/${empId}/documentos`, doc),
  updateDoc: (id, patch) => call('PATCH', `/api/cde/documentos/${id}`, patch),
  deleteDoc: (id) => call('DELETE', `/api/cde/documentos/${id}`),
  events: (id) => call('GET', `/api/cde/documentos/${id}/eventos`),
  setState: (id, estado, finalidade, descricao) => call('POST', `/api/cde/documentos/${id}/estado`, { estado, finalidade, descricao }),
  emit: (empId, payload) => call('POST', `/api/cde/${empId}/emissoes`, payload),
  /** Baixa o arquivo atual (ou de um evento do histórico) com o nome padronizado. */
  async download(id, eventoId) {
    const r = await call('GET', `/api/cde/documentos/${id}/download${eventoId ? `?evento=${eventoId}` : ''}`);
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
  /** Envia um arquivo pelo link assinado (com progresso) e confirma no servidor. */
  async upload(id, file, descricao, onProgress = () => {}) {
    const u = await call('POST', `/api/cde/documentos/${id}/upload`, { nome: file.name, content_type: file.type || 'application/octet-stream', tamanho: file.size });
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(u.method || 'PUT', u.url);
      Object.entries(u.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Falha no envio (${xhr.status}).`)));
      xhr.onerror = () => reject(new Error('Falha no envio: confira a conexão com o servidor do CDE.'));
      xhr.send(file);
    });
    return call('POST', `/api/cde/documentos/${id}/arquivo`, { key: u.key, nome: file.name, content_type: file.type || null, descricao });
  },
};
