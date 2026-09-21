// Cliente simples que mapeia chamadas de entidade para o servidor local (/api)
const PROD_BACKEND = 'https://project-interno-rati.onrender.com';
const _isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const API_BASE = _isLocalhost ? '' : PROD_BACKEND;
const LOCAL_AUTH_TOKEN_KEY = 'project_auth_token';
const LOCAL_AUTH_USER_KEY = 'project_auth_user';

// ---------------------------------------------------------------------------
// Cache em memória + deduplicação de requests
// Reduz drasticamente a carga no servidor quando múltiplos usuários acessam
// os mesmos dados simultaneamente (ex: 50 usuários abrindo a mesma aba).
// ---------------------------------------------------------------------------

// Entidades globais/estáticas ganham TTL maior; dados por empreendimento ficam 2 min
const _STATIC_PATHS = new Set(['disciplinas', 'users', 'empreendimentos']);
const _TTL_STATIC  = 5 * 60 * 1000; // 5 minutos
const _TTL_DEFAULT = 2 * 60 * 1000; // 2 minutos

const _memCache   = new Map(); // key → { data, exp }
const _inFlight   = new Map(); // key → Promise — deduplicação de requests idênticos

function _cacheGet(key) {
  const e = _memCache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { _memCache.delete(key); return null; }
  return e.data;
}

function _cacheSet(key, path, data) {
  const ttl = _STATIC_PATHS.has(path) ? _TTL_STATIC : _TTL_DEFAULT;
  _memCache.set(key, { data, exp: Date.now() + ttl });
}

// Invalida todas as entradas de cache de um path ao escrever
function _cacheInvalidate(path) {
  const prefix = `${path}::`;
  for (const k of _memCache.keys()) {
    if (k.startsWith(prefix)) _memCache.delete(k);
  }
}

// Se há um request idêntico em voo, reutiliza a mesma Promise
function _withDedup(key, fn) {
  if (_inFlight.has(key)) return _inFlight.get(key);
  const p = fn().finally(() => _inFlight.delete(key));
  _inFlight.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------

function qs(obj) {
  if (!obj) return '';
  const parts = Object.entries(obj).map(([k, v]) => {
    let value = v;
    if (value === undefined || value === null) return null;
    if (typeof value === 'object') {
      try {
        value = JSON.stringify(value);
      } catch (e) {
        value = String(value);
      }
    }
    return `${encodeURIComponent(k)}=${encodeURIComponent(value)}`;
  }).filter(Boolean);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function _parseJson(res, fallback) {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      const text = await res.text();
      return Promise.reject(new Error(text));
    }
    if (contentType.includes('application/json')) return await res.json();
    const text = await res.text();
    if (text.trim().startsWith('<')) return fallback;
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function createEntity(path) {
  const base = `${API_BASE}/api/${path}`;
  return {
    list: async (sort = null, limit = 5000, offset = 0) => {
      const q = {};
      if (sort) q.sort = sort;
      if (limit) q.limit = limit;
      if (offset) q.offset = offset;
      const key = `${path}::list::${JSON.stringify(q)}`;
      const cached = _cacheGet(key);
      if (cached) return cached;
      return _withDedup(key, async () => {
        const res = await fetch(base + qs(q));
        const data = await _parseJson(res, []);
        if (!Array.isArray(data) || data.length > 0) _cacheSet(key, path, data);
        return data;
      });
    },
    get: async (id) => {
      const res = await fetch(`${base}/${id}`);
      try {
        if (!res.ok) return null;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) return await res.json();
        const text = await res.text();
        if (text.trim().startsWith('<')) return null;
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    },
    create: async (data) => {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      _cacheInvalidate(path);
      return _parseJson(res, null);
    },
    update: async (id, data) => {
      const res = await fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      _cacheInvalidate(path);
      return _parseJson(res, null);
    },
    delete: async (id) => {
      const res = await fetch(`${base}/${id}`, { method: 'DELETE' });
      _cacheInvalidate(path);
      return _parseJson(res, null);
    },
    filter: async (params) => {
      const key = `${path}::filter::${JSON.stringify(params || {})}`;
      const cached = _cacheGet(key);
      if (cached) return cached;
      return _withDedup(key, async () => {
        const res = await fetch(base + qs(params));
        const data = await _parseJson(res, []);
        if (!Array.isArray(data) || data.length > 0) _cacheSet(key, path, data);
        return data;
      });
    }
  };
}

// Exportar entidades utilizadas pela aplicação
export const Empreendimento = createEntity('empreendimentos');
export const Documento = createEntity('documentos');
export const Usuario = createEntity('users');
export const User = Usuario; // alias

// Provide `me()` helper for compatibility with code that expects `User.me()`
User.me = async () => {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem(LOCAL_AUTH_TOKEN_KEY) : null;
  try {
    const res = await fetch(`${API_BASE}/api/users/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const body = await res.json();
      if (body) {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LOCAL_AUTH_USER_KEY, JSON.stringify(body));
        }
        return body;
      }
    }
  } catch (e) {
    // ignore
  }
  try {
    const item = window.localStorage.getItem(LOCAL_AUTH_USER_KEY);
    return item ? JSON.parse(item) : null;
  } catch (e) {
    return null;
  }
};
export const Analitico = createEntity('analiticos');
export const Atividade = createEntity('atividades');
export const PlanejamentoAtividade = createEntity('planejamentos');
export const Execucao = createEntity('execucoes');
export const PlanejamentoDocumento = createEntity('planejamento_documentos');
export const Pavimento = createEntity('pavimentos');
export const ConsumoAguaCalculo = createEntity('consumo_agua');
export const AtaReuniao = createEntity('atas_reuniao');
export const NotificacaoAtividade = createEntity('notificacoes');
export const AtividadeFuncao = createEntity('atividade-funcoes');
export const SobraUsuario = createEntity('sobras');
export const AlteracaoEtapa = createEntity('alteracoes');
export const OSManual = createEntity('os');
export const AlocacaoEquipe = createEntity('alocacao_equipe');
export const Proposta = createEntity('propostas');
export const Orcamento = createEntity('orcamentos');
export const Comercial = createEntity('comerciais');
export const Pavimentos = Pavimento;
export const Equipe = createEntity('equipes');
export const Disciplina = createEntity('disciplinas');
export const ItemPRE = createEntity('itempre');
export const ChecklistPlanejamento = createEntity('checklists');
export const ChecklistItem = createEntity('checklist_items');
export const AtividadeGenerica = createEntity('atividades_genericas');
export const DataCadastro = createEntity('data_cadastro');
// Compatibilidade: algumas páginas importam `AtividadesDoProjeto`
// que representa uma visão/filtragem das atividades por empreendimento.
export const AtividadesDoProjeto = createEntity('atividades');
export const AtividadesEmpreendimento = createEntity('atividades_empreendimento');

// Default export for compatibility
export default {
  Empreendimento,
  Documento,
  Usuario,
  User,
  Analitico,
  Atividade,
  PlanejamentoAtividade,
  AlocacaoEquipe,
  PlanejamentoDocumento,
  Execucao
};
