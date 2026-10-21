import { getApiOrigin } from '@/api/base44Client';

const LOCAL_AUTH_TOKEN_KEY = 'project_auth_token';

function authHeaders() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_AUTH_TOKEN_KEY) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(res) {
  try {
    const data = await res.json();
    return data?.error || `Erro ${res.status}`;
  } catch {
    return `Erro ${res.status}`;
  }
}

export async function listModelosIfc(empreendimentoId) {
  const res = await fetch(`${getApiOrigin()}/api/empreendimentos/${empreendimentoId}/modelos-ifc`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getModeloIfc(id) {
  const res = await fetch(`${getApiOrigin()}/api/modelos-ifc/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// XHR em vez de fetch para ter progresso de envio
export function uploadModeloIfc(empreendimentoId, file, { descricao, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getApiOrigin()}/api/empreendimentos/${empreendimentoId}/modelos-ifc`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    if (descricao) xhr.setRequestHeader('X-File-Description', encodeURIComponent(descricao));
    Object.entries(authHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else if (xhr.status === 413) reject(new Error('Arquivo muito grande (máximo 150 MB).'));
      else reject(new Error(data?.error || `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Falha de conexão ao enviar o arquivo.'));
    xhr.send(file);
  });
}

// Baixa o arquivo já descompactado; total = tamanho original, usado para o progresso
export async function downloadModeloIfc(id, { total, onProgress } = {}) {
  const res = await fetch(`${getApiOrigin()}/api/modelos-ifc/${id}/arquivo`, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(await readError(res));
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(100, Math.round((received / total) * 100)));
  }
  const data = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}

export async function deleteModeloIfc(id) {
  const res = await fetch(`${getApiOrigin()}/api/modelos-ifc/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok && res.status !== 404) throw new Error(await readError(res));
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
