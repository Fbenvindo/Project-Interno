// Cliente da API do CDE (Ambiente Comum de Dados, ISO 19650). Usa o token da sessão do sistema.
import { getApiOrigin } from '@/api/base44Client';

const token = () => {
  try {
    return localStorage.getItem('project_auth_token');
  } catch {
    return null;
  }
};

async function call(method, path, body) {
  const r = await fetch(`${getApiOrigin()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error || `Erro ${r.status}`);
  return data;
}

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
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
  /**
   * Envia um arquivo: pede a URL assinada, manda direto para o armazenamento (S3) com progresso e
   * confirma no servidor (nova revisão se a atual já tiver sido emitida).
   */
  async upload(id, file, descricao, onProgress = () => {}) {
    const u = await call('POST', `/api/cde/documentos/${id}/upload`, { nome: file.name, content_type: file.type || 'application/octet-stream', tamanho: file.size });
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(u.method || 'PUT', u.url);
      Object.entries(u.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Falha no envio (${xhr.status}).`)));
      xhr.onerror = () => reject(new Error('Falha no envio. Se o armazenamento é S3, confira o CORS do bucket.'));
      xhr.send(file);
    });
    return call('POST', `/api/cde/documentos/${id}/arquivo`, { key: u.key, nome: file.name, content_type: file.type || null, descricao });
  },
};
