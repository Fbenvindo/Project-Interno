
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

// --- AJUSTE: Usar variáveis padrão do Render ---
// DATABASE_URL já está OK no pool.js
// Para CORS, padronizar para ALLOWED_ORIGINS (Render) ou fallback para CORS_ALLOWED_ORIGINS
const CORS_ORIGINS = process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '';
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const path = require('path');
const { runMigrations } = require('./db/init');
const { pool } = require('./db/pool');
const { createSessionToken, hashPassword, normalizeProfile, toPublicUser, verifyPassword, verifySessionToken } = require('./auth');

// Models
const usersModel = require('./models/users');
const empreendimentoModel = require('./models/empreendimento');
const documentosModel = require('./models/documentos');
const planejamentoModel = require('./models/planejamentoAtividade');
const planejamentoDocumentoModel = require('./models/planejamentoDocumento');
const execucaoModel = require('./models/execucao');
const analiticoModel = require('./models/analitico');
const pavimentoModel = require('./models/pavimento');
const atasModel = require('./models/atasReuniao');
const notificacaoModel = require('./models/notificacaoAtividade');
const atividadeFuncaoModel = require('./models/atividadeFuncao');
const { dispararNotificacoesOcasionais } = require('./services/notificacaoOcasionalService');
const cron = require('node-cron');
const sobraModel = require('./models/sobraUsuario');
const alteracaoModel = require('./models/alteracaoEtapa');
const osModel = require('./models/osManual');
const propostasModel = require('./models/propostas');
const orcamentosModel = require('./models/orcamentos');
const atividadesModel = require('./models/atividades');
const alocacaoModel = require('./models/alocacaoEquipe');
const atividadesEmpModel = require('./models/atividadesEmpreendimento');
const itempreModel = require('./models/itempre');
const controleOSModel = require('./models/controleOS');
const dataCadastroModel = require('./models/dataCadastro');
const comercialModel = require('./models/comercial');
const checklistsModel = require('./models/checklists');
const checklistItemsModel = require('./models/checklistItems');
const consumoAguaModel = require('./models/consumoAgua');


if (cluster.isMaster) {
  const numCPUs = process.env.WEB_CONCURRENCY ? Number(process.env.WEB_CONCURRENCY) : os.cpus().length;
  console.log(`Master ${process.pid} is running. Forking ${numCPUs} workers...`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Forking a new one...`);
    cluster.fork();
  });
} else {
  const app = express();

// Rota amigável para a raiz da API
app.get('/', (req, res) => {
  res.send('API online! Use os endpoints da aplicação.');
});

function getFixedAdminConfig() {
  const email = String(process.env.FIXED_ADMIN_EMAIL || 'admin@interativa.local').trim().toLowerCase();
  const password = String(process.env.FIXED_ADMIN_PASSWORD || 'Admin@123').trim();

  return {
    email,
    password,
    user: {
      id: 'fixed-admin',
      email,
      name: process.env.FIXED_ADMIN_NAME || 'Administrador',
      nome: process.env.FIXED_ADMIN_NAME || 'Administrador',
      full_name: process.env.FIXED_ADMIN_NAME || 'Administrador',
      role: 'admin',
      perfil: 'direcao',
      status: 'ativo',
      is_fixed_admin: true,
    },
  };
}

function normalizeRoleForStorage(raw) {
  const profile = normalizeProfile(raw);
  return profile === 'admin' ? 'admin' : profile;
}

function parseAllowedOrigins(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(CORS_ORIGINS);

function normalizeStringArrayField(raw) {
  const out = [];

  const pushToken = (value) => {
    if (value == null) return;
    let token = String(value).trim();
    if (!token) return;

    while (token.length >= 2 && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))) {
      token = token.slice(1, -1).trim();
    }
    token = token.replace(/""/g, '"').trim();
    if (!token) return;

    if ((token.startsWith('[') && token.endsWith(']')) || (token.startsWith('{') && token.endsWith('}'))) {
      try {
        const parsed = JSON.parse(token);
        if (Array.isArray(parsed)) {
          parsed.forEach(pushToken);
          return;
        }
      } catch (e) {
        // keep going with fallback sanitization below
      }
    }

    token = token.replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim();
    while (token.length >= 2 && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))) {
      token = token.slice(1, -1).trim();
    }

    if (token) out.push(token);
  };

  if (Array.isArray(raw)) {
    raw.forEach(pushToken);
  } else if (raw != null) {
    const text = String(raw).trim();
    if (!text) return [];

    try {
      const parsed = JSON.parse(text.replace(/""/g, '"'));
      if (Array.isArray(parsed)) parsed.forEach(pushToken);
      else pushToken(parsed);
    } catch (e) {
      const sep = text.includes('|') ? '|' : text.includes(';') ? ';' : ',';
      text.split(sep).forEach(pushToken);
    }
  }

  return [...new Set(out)];
}

function normalizeDocumentoResponse(doc) {
  if (!doc) return doc;
  return {
    ...doc,
    disciplinas: normalizeStringArrayField(doc.disciplinas),
    subdisciplinas: normalizeStringArrayField(doc.subdisciplinas),
  };
}

async function ensureChecklistSection(checklistId, titulo) {
  if (!checklistId || !titulo) return null;
  const trimmed = String(titulo).trim();
  if (!trimmed) return null;
  try {
    const normalizedTitle = trimmed.toLowerCase();
    const existing = await pool.query(
      'SELECT id FROM checklist_sections WHERE checklist_id = $1 AND LOWER(titulo) = $2 LIMIT 1',
      [checklistId, normalizedTitle]
    );
    if (existing.rows.length) {
      return existing.rows[0].id;
    }
    const inserted = await pool.query(
      'INSERT INTO checklist_sections (checklist_id, titulo) VALUES ($1, $2) RETURNING id',
      [checklistId, trimmed]
    );
    return inserted.rows[0] ? inserted.rows[0].id : null;
  } catch (err) {
    console.warn('Erro ao garantir seção do checklist:', err.message || err);
    return null;
  }
}

async function resolveResponsavelId(value) {
  if (!value) return null;
  const candidate = String(value).trim();
  if (!candidate) return null;
  try {
    const lower = candidate.toLowerCase();
    if (candidate.includes('@')) {
      const emailMatch = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1',
        [lower]
      );
      if (emailMatch.rows.length) return emailMatch.rows[0].id;
    }
    const exactMatch = await pool.query(
      'SELECT id FROM users WHERE LOWER(name) = $1 LIMIT 1',
      [lower]
    );
    if (exactMatch.rows.length) return exactMatch.rows[0].id;
    const partialMatch = await pool.query(
      'SELECT id FROM users WHERE LOWER(name) LIKE $1 LIMIT 1',
      [`%${lower}%`]
    );
    if (partialMatch.rows.length) return partialMatch.rows[0].id;
  } catch (err) {
    console.warn('Erro ao buscar responsável por nome:', err.message || err);
  }
  return null;
}

// Allow local frontend dev servers to call this API directly.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isLocalhost = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const isOnrender = origin && /\.onrender\.com$/i.test(origin);
  const isExplicitlyAllowed = origin && allowedOrigins.includes(origin);
  if (isLocalhost || isOnrender || isExplicitlyAllowed) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return req.headers['x-session-token'] || null;
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: err.message });
  }
});

app.post('/migrate', async (req, res) => {
  try {
    await runMigrations();
    res.json({ migrated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const fixedAdmin = getFixedAdminConfig();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    if (email === fixedAdmin.email && password === fixedAdmin.password) {
      return res.json({ token: createSessionToken(fixedAdmin.user), user: fixedAdmin.user });
    }

    const user = await usersModel.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    // Bloquear usuário inativo
    if (String(user.status || '').toLowerCase() === 'inativo') {
      return res.status(403).json({ error: 'Usuário inativo. Procure o administrador.' });
    }

    const safeUser = toPublicUser(user);
    return res.json({ token: createSessionToken(user), user: safeUser });
  } catch (err) {
    console.error('POST /api/auth/login error', err);
    return res.status(500).json({ error: 'Erro interno ao autenticar usuário.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = getBearerToken(req);
    const payload = verifySessionToken(token);
    const fixedAdmin = getFixedAdminConfig();

    if (!payload?.sub) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    if (String(payload.sub) === 'fixed-admin' && String(payload.email || '').toLowerCase() === fixedAdmin.email) {
      return res.json(fixedAdmin.user);
    }

    const user = await usersModel.getUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'Usuário da sessão não encontrado.' });
    }

    return res.json(toPublicUser(user));
  } catch (err) {
    console.error('GET /api/auth/me error', err);
    return res.status(500).json({ error: 'Erro interno ao carregar sessão.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  res.status(204).end();
});

// Backfill específico para documentos: popula colunas novas com heurísticas
app.post('/migrate/backfill_documentos', async (req, res) => {
  try {
    // leia e execute statements sequenciais do arquivo de backfill
    const fs = require('fs');
    const path = require('path');
    const sqlPath = path.join(__dirname, 'db', 'backfill_documentos.sql');
    const content = fs.readFileSync(sqlPath, 'utf8');

    // divide em statements por ';
    const stmts = content.split(/;\s*\n/).map(s => s.trim()).filter(s => s.length);
    for (const s of stmts) {
      // ignore comentários e BEGIN/COMMIT soltos
      const t = s.replace(/^--.*$/gm, '').trim();
      if (!t) continue;
      // skip standalone BEGIN/COMMIT
      if (/^BEGIN$/i.test(t) || /^COMMIT$/i.test(t)) continue;
      await pool.query(t);
    }

    res.json({ ok: true, appliedStatements: stmts.length });
  } catch (err) {
    console.error('backfill_documentos error', err);
    res.status(500).json({ error: err.message });
  }
});

// Users
app.post('/api/users', async (req, res) => {
  try {
    console.log('POST /api/users body:', req.body);
    const payload = { ...req.body };
    if (payload.email) payload.email = String(payload.email).trim().toLowerCase();
    if (payload.perfil || payload.role) {
      const profile = normalizeProfile(payload.perfil || payload.role);
      payload.perfil = profile;
      payload.role = normalizeRoleForStorage(profile);
    }
    if (payload.senha || payload.password) {
      payload.password_hash = hashPassword(payload.senha || payload.password);
    }
    delete payload.senha;
    delete payload.password;
    delete payload.confirmarSenha;

    const user = await usersModel.createUser(payload);
    const out = toPublicUser(user);
    console.log('Created user:', out);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    if (req.params.id === 'me') {
      return res.json(null);
    }
    const user = await usersModel.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const out = toPublicUser(user);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    if (req.query.email) {
      const user = await usersModel.getUserByEmail(req.query.email);
      const out = user ? [toPublicUser(user)] : [];
      return res.json(out);
    }
    // fallback: return basic list from DB
    const result = await pool.query('SELECT id, email, name, role, cargo, equipe_id, datas_indisponiveis, usuarios_permitidos_visualizar, created_at, updated_at FROM users ORDER BY id DESC LIMIT 200');
    const rows = result.rows.map(r => ({
      ...r,
      nome: r.name,
      perfil: r.role,
      datas_indisponiveis: Array.isArray(r.datas_indisponiveis) ? r.datas_indisponiveis : [],
      usuarios_permitidos_visualizar: Array.isArray(r.usuarios_permitidos_visualizar) ? r.usuarios_permitidos_visualizar : [],
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id', async (req, res) => {
  try {
    console.log('PATCH /api/users/:id', req.params.id, 'body:', req.body);
    const payload = { ...(req.body || {}) };
    if (payload.email) payload.email = String(payload.email).trim().toLowerCase();
    if (payload.perfil || payload.role) {
      const profile = normalizeProfile(payload.perfil || payload.role);
      payload.perfil = profile;
      payload.role = normalizeRoleForStorage(profile);
    }
    if (payload.senha || payload.password) {
      payload.password_hash = hashPassword(payload.senha || payload.password);
    }
    delete payload.senha;
    delete payload.password;
    delete payload.confirmarSenha;

    const updated = await usersModel.updateUser(req.params.id, payload);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    const out = toPublicUser(updated);
    console.log('Updated user:', out);
    res.json(out);
  } catch (err) {
    console.error('PATCH /api/users/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await usersModel.deleteUser(req.params.id);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/users/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Empreendimentos
app.get('/api/empreendimentos', async (req, res) => {
  try {
    const data = await empreendimentoModel.listEmpreendimentos();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/empreendimentos', async (req, res) => {
  try {
    const e = await empreendimentoModel.createEmpreendimento(req.body);
    res.json(e);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empreendimentos/:id', async (req, res) => {
  try {
    const e = await empreendimentoModel.getEmpreendimentoById(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });
    res.json(e);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/empreendimentos/:id', async (req, res) => {
  try {
    const updated = await empreendimentoModel.updateEmpreendimento(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/empreendimentos/:id', async (req, res) => {
  try {
    await empreendimentoModel.deleteEmpreendimento(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Documentos
app.post('/api/documentos', async (req, res) => {
  try {
    // Map frontend form fields to DB columns
    const payload = req.body || {};
    // Build fields mapping for the documentos model
    const docPayload = {};
    docPayload.titulo = payload.titulo || payload.numero || payload.arquivo || null;
    docPayload.numero = payload.numero || null;
    docPayload.tipo = payload.tipo || null;
    docPayload.arquivo = payload.arquivo || null;
    docPayload.caminho = payload.caminho || payload.arquivo || null;
    docPayload.descritivo = payload.descritivo || payload.descricao || null;
    docPayload.area = payload.area || null;
    docPayload.executor_principal = payload.executor_principal || null;
    if (payload.multiplos_executores !== undefined) {
      docPayload.multiplos_executores = payload.multiplos_executores;
    }
    if (payload.inicio_planejado !== undefined) {
      docPayload.inicio_planejado = payload.inicio_planejado;
    }
    if (payload.termino_planejado !== undefined) {
      docPayload.termino_planejado = payload.termino_planejado;
    }
    docPayload.predecessora_id = payload.predecessora_id || null;
    docPayload.pavimento_id = payload.pavimento_id || null;

    // disciplinas / subdisciplinas: accept array, JSON string, or comma-separated string
    if (payload.disciplinas !== undefined) docPayload.disciplinas = normalizeStringArrayField(payload.disciplinas);
    if (payload.subdisciplinas !== undefined) docPayload.subdisciplinas = normalizeStringArrayField(payload.subdisciplinas);

    docPayload.escala = payload.escala || null;
    docPayload.fator_dificuldade = payload.fator_dificuldade || payload.fatorDificuldade || null;

    // empreendimento
    docPayload.empreendimento_id = payload.empreendimento_id || null;

    // tempo fields (allow string/number)
    const tempoFields = [
      'tempo_total', 'tempo_estudo_preliminar', 'tempo_ante_projeto', 'tempo_projeto_basico',
      'tempo_projeto_executivo', 'tempo_liberado_obra', 'tempo_concepcao', 'tempo_planejamento', 'tempo_execucao_total'
    ];
    tempoFields.forEach(k => { if (payload[k] !== undefined) docPayload[k] = payload[k]; });

    // Resolve disciplina (single) if provided as disciplina or disciplina_id
    if (payload.disciplina !== undefined && payload.disciplina !== null) {
      if (!isNaN(Number(payload.disciplina))) docPayload.disciplina_id = Number(payload.disciplina);
      else {
        try {
          const r = await pool.query('SELECT id FROM disciplinas WHERE nome = $1 LIMIT 1', [String(payload.disciplina).trim()]);
          if (r.rows.length) docPayload.disciplina_id = r.rows[0].id;
        } catch (e) {
          // ignore
        }
      }
    } else if (payload.disciplina_id !== undefined) {
      docPayload.disciplina_id = payload.disciplina_id || null;
    }

    console.log('POST /api/documentos payload:', JSON.stringify(docPayload));
    const doc = await documentosModel.createDocumento(docPayload);
    console.log('POST /api/documentos result:', JSON.stringify(doc));
    res.json(normalizeDocumentoResponse(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/documentos', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10000', 10);
    if (req.query.empreendimento_id) {
      const result = await pool.query('SELECT * FROM documentos WHERE empreendimento_id = $1 ORDER BY id DESC LIMIT $2', [req.query.empreendimento_id, limit]);
      console.log('GET /api/documentos for empreendimento_id=', req.query.empreendimento_id, 'rows=', result.rows.length);
      return res.json((result.rows || []).map(normalizeDocumentoResponse));
    }
    const rows = await documentosModel.listDocumentos({}, limit);
    console.log('GET /api/documentos all rows=', rows.length);
    res.json((rows || []).map(normalizeDocumentoResponse));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/documentos/:id', async (req, res) => {
  try {
    const doc = await documentosModel.getDocumentoById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(normalizeDocumentoResponse(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update documento
app.patch('/api/documentos/:id', async (req, res) => {
  try {
    const payload = req.body || {};
    const docPayload = {};

    // Basic field mapping (only include fields that were actually provided)
    const directFields = [
      'titulo', 'numero', 'tipo', 'arquivo', 'caminho', 'descritivo', 'area',
      'executor_principal', 'multiplos_executores', 'inicio_planejado', 'termino_planejado',
      'predecessora_id',
      'pavimento_id', 'disciplina_id', 'disciplinas', 'subdisciplinas',
      'escala', 'fator_dificuldade', 'empreendimento_id',
      'tempo_total', 'tempo_estudo_preliminar', 'tempo_ante_projeto',
      'tempo_projeto_basico', 'tempo_projeto_executivo', 'tempo_liberado_obra',
      'tempo_concepcao', 'tempo_planejamento', 'tempo_execucao_total'
    ];

    directFields.forEach((key) => {
      if (payload[key] !== undefined) docPayload[key] = payload[key];
    });

    if (docPayload.disciplinas !== undefined) {
      docPayload.disciplinas = normalizeStringArrayField(docPayload.disciplinas);
    }
    if (docPayload.subdisciplinas !== undefined) {
      docPayload.subdisciplinas = normalizeStringArrayField(docPayload.subdisciplinas);
    }

    // Frontend compatibility aliases
    if (payload.descricao !== undefined && docPayload.descritivo === undefined) {
      docPayload.descritivo = payload.descricao;
    }
    if (payload.fatorDificuldade !== undefined && docPayload.fator_dificuldade === undefined) {
      docPayload.fator_dificuldade = payload.fatorDificuldade;
    }

    // Resolve disciplina alias safely: numeric -> disciplina_id; text -> disciplinas
    if (payload.disciplina !== undefined && payload.disciplina !== null) {
      if (!Number.isNaN(Number(payload.disciplina))) {
        docPayload.disciplina_id = Number(payload.disciplina);
      } else {
        const disciplinaNome = String(payload.disciplina).trim();
        if (disciplinaNome) {
          if (docPayload.disciplinas === undefined) docPayload.disciplinas = [disciplinaNome];
          try {
            const r = await pool.query('SELECT id FROM disciplinas WHERE nome = $1 LIMIT 1', [disciplinaNome]);
            if (r.rows.length) docPayload.disciplina_id = r.rows[0].id;
          } catch (e) {
            // Best effort only.
          }
        }
      }
    }

    const updated = await documentosModel.updateDocumento(req.params.id, docPayload);
    res.json(normalizeDocumentoResponse(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete documento
app.delete('/api/documentos/:id', async (req, res) => {
  try {
    await documentosModel.deleteDocumento(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checklists
app.get('/api/checklists', async (req, res) => {
  try {
    const filters = {};
    if (req.query.empreendimento_id) {
      const parsed = Number(req.query.empreendimento_id);
      if (!Number.isNaN(parsed)) filters.empreendimento_id = parsed;
    }
    const data = await checklistsModel.listChecklists(filters);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/checklists', async (req, res) => {
  try {
    const checklist = await checklistsModel.createChecklist(req.body || {});
    res.json(checklist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/checklists/:id', async (req, res) => {
  try {
    const updated = await checklistsModel.updateChecklist(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/checklists/:id', async (req, res) => {
  try {
    const deleted = await checklistsModel.deleteChecklist(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/checklist_items', async (req, res) => {
  try {
    const filters = {};
    if (req.query.checklist_id) {
      const parsedChecklistId = Number(req.query.checklist_id);
      if (!Number.isNaN(parsedChecklistId)) {
        filters.checklist_id = parsedChecklistId;
      }
    }
    if (req.query.secao) {
      filters.secao = req.query.secao;
    }
    const items = await checklistItemsModel.listItems(filters);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/checklist_items/:id', async (req, res) => {
  try {
    const rows = await pool.query('SELECT * FROM checklist_items WHERE id = $1', [req.params.id]);
    if (!rows.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/checklist_items', async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    if (!payload.section_id && payload.checklist_id && payload.secao) {
      payload.section_id = await ensureChecklistSection(payload.checklist_id, payload.secao);
    }
    if (!payload.responsavel_id && payload.responsavel_nome) {
      payload.responsavel_id = await resolveResponsavelId(payload.responsavel_nome);
    }
    const item = await checklistItemsModel.createItem(payload);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/checklist_items/:id', async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    let checklistId = payload.checklist_id;
    if (!checklistId) {
      const existingItem = await pool.query('SELECT checklist_id FROM checklist_items WHERE id = $1', [req.params.id]);
      checklistId = existingItem.rows[0]?.checklist_id;
    }
    if (!payload.section_id && checklistId && payload.secao) {
      payload.section_id = await ensureChecklistSection(checklistId, payload.secao);
    }
    if (!payload.responsavel_id && payload.responsavel_nome) {
      payload.responsavel_id = await resolveResponsavelId(payload.responsavel_nome);
    }
    const updated = await checklistItemsModel.updateItem(req.params.id, payload);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/checklist_items/:id', async (req, res) => {
  try {
    const deleted = await checklistItemsModel.deleteItem(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atividades Empreendimento endpoints (used by frontend as AtividadesEmpreendimento)
app.get('/api/atividades_empreendimento', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '500', 10);
    const filter = {};
    if (req.query.documento_id) filter.documento_id = req.query.documento_id;
    if (req.query.empreendimento_id) filter.empreendimento_id = req.query.empreendimento_id;
    const rows = await atividadesEmpModel.listByFilter(filter, limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/atividades_empreendimento', async (req, res) => {
  try {
    console.log('POST /api/atividades_empreendimento body:', JSON.stringify(req.body));
    const created = await atividadesEmpModel.createAtividadeEmp(req.body || {});
    console.log('POST /api/atividades_empreendimento created:', JSON.stringify(created));
    res.json(created);
  } catch (err) {
    console.error('POST /api/atividades_empreendimento error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/atividades_empreendimento/:id', async (req, res) => {
  try {
    const updated = await atividadesEmpModel.updateAtividadeEmp(req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/atividades_empreendimento/:id', async (req, res) => {
  try {
    await atividadesEmpModel.deleteAtividadeEmp(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Planejamentos
app.post('/api/planejamentos', async (req, res) => {
  try {
    const p = await planejamentoModel.createPlanejamentoAtividade(req.body);
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamentos', async (req, res) => {
  try {
    const parseFilterValue = (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (!trimmed) return trimmed;
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return JSON.parse(trimmed);
        } catch (_) {
          return value;
        }
      }
      return value;
    };

    const normalizeArray = (value) => {
      if (Array.isArray(value)) return value;
      return [];
    };

    const where = [];
    const values = [];
    const addWhere = (sql, value) => {
      values.push(value);
      where.push(`${sql} $${values.length}`);
    };

    const addNumericFilter = (column, rawValue) => {
      if (rawValue === undefined) return;
      const parsed = parseFilterValue(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const inValues = normalizeArray(parsed.$in)
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v));
        if (inValues.length > 0) {
          values.push(inValues);
          where.push(`${column} = ANY($${values.length}::int[])`);
        }
        return;
      }

      const n = Number(parsed);
      if (Number.isFinite(n)) {
        addWhere(`${column} =`, n);
      }
    };

    const addTextFilter = (column, rawValue) => {
      if (rawValue === undefined) return;
      const parsed = parseFilterValue(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const inValues = normalizeArray(parsed.$in)
          .map((v) => String(v || '').trim())
          .filter(Boolean);
        if (inValues.length > 0) {
          values.push(inValues);
          where.push(`${column} = ANY($${values.length}::text[])`);
        }
        return;
      }

      const text = String(parsed || '').trim();
      if (text) {
        addWhere(`${column} =`, text);
      }
    };

    // Use table-qualified column names to avoid ambiguity with the LEFT JOIN on atividades
    const addNumericFilterQualified = (qualifiedColumn, rawValue) => {
      if (rawValue === undefined) return;
      const parsed = parseFilterValue(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const inValues = normalizeArray(parsed.$in)
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v));
        if (inValues.length > 0) {
          values.push(inValues);
          where.push(`${qualifiedColumn} = ANY($${values.length}::int[])`);
        }
        return;
      }
      const n = Number(parsed);
      if (Number.isFinite(n)) {
        values.push(n);
        where.push(`${qualifiedColumn} = $${values.length}`);
      }
    };

    addNumericFilterQualified('pa.id', req.query.id);
    // empreendimento_id: match directly OR via atividade join (for legacy records with NULL empreendimento_id)
    const rawEmpId = req.query.empreendimento_id;
    if (rawEmpId !== undefined) {
      const empId = Number(rawEmpId);
      if (Number.isFinite(empId)) {
        values.push(empId);
        where.push(`(pa.empreendimento_id = $${values.length} OR (pa.empreendimento_id IS NULL AND EXISTS (SELECT 1 FROM atividades a WHERE a.id = pa.atividade_id AND a.empreendimento_id = $${values.length})))`);
      }
    }
    addNumericFilterQualified('pa.atividade_id', req.query.atividade_id);
    addNumericFilterQualified('pa.documento_id', req.query.documento_id);
    addNumericFilterQualified('pa.executor_id', req.query.executor_id);
    addTextFilter('executor_principal', req.query.executor_principal);
    addTextFilter('status', req.query.status);

    const executorInList = String(req.query.executor || req.query.usuario || '').trim();
    if (executorInList) {
      values.push(executorInList);
      where.push(`COALESCE(pa.executores, '[]'::jsonb) ? $${values.length}`);
    }

    const limit = Number.parseInt(req.query.limit || '5000', 10);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10000) : 5000;

    const sql = `
      SELECT pa.*, COALESCE(pa.empreendimento_id, a.empreendimento_id) AS empreendimento_id
      FROM planejamento_atividades pa
      LEFT JOIN atividades a ON a.id = pa.atividade_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pa.id DESC
      LIMIT $${values.length + 1}
    `;

    const result = await pool.query(sql, [...values, safeLimit]);
    const rows = result.rows.map(r => ({ ...r, descritivo: r.descritivo || r.titulo }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamentos/medias', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT atividade_id,
              ROUND(AVG(COALESCE(NULLIF(tempo_executado, 0), tempo_planejado))::numeric, 1) AS media,
              COUNT(*) AS total
       FROM planejamento_atividades
       WHERE atividade_id IS NOT NULL
         AND status IN ('concluido', 'concluido_com_atraso')
         AND COALESCE(NULLIF(tempo_executado, 0), tempo_planejado) > 0
       GROUP BY atividade_id`
    );
    res.json(result.rows.map(r => ({ ...r, media: Number(r.media), total: Number(r.total) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamentos/media-por-atividade/:atividade_id', async (req, res) => {
  try {
    const atividadeId = Number(req.params.atividade_id);
    if (!Number.isFinite(atividadeId)) return res.status(400).json({ error: 'Invalid atividade_id' });
    const result = await pool.query(
      `SELECT ROUND(AVG(COALESCE(NULLIF(tempo_executado, 0), tempo_planejado))::numeric, 1) AS media, COUNT(*) AS total
       FROM planejamento_atividades
       WHERE atividade_id = $1
         AND status IN ('concluido', 'concluido_com_atraso')
         AND COALESCE(NULLIF(tempo_executado, 0), tempo_planejado) > 0`,
      [atividadeId]
    );
    const { media, total } = result.rows[0];
    res.json({ media: media ? Number(media) : null, total: Number(total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamentos/:id', async (req, res) => {
  try {
    const p = await planejamentoModel.getPlanejamentoById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/planejamentos/:id', async (req, res) => {
  try {
    await planejamentoModel.deletePlanejamento(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update planejamento
app.patch('/api/planejamentos/:id', async (req, res) => {
  try {
    const updated = await planejamentoModel.updatePlanejamento(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Planejamento <-> Documentos
app.post('/api/planejamentos/:id/documentos', async (req, res) => {
  try {
    const payload = { planejamento_atividade_id: req.params.id, documento_id: req.body.documento_id, etapa: req.body.etapa };
    const link = await planejamentoDocumentoModel.linkDocumentoToPlanejamento(payload);
    res.json(link);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamentos/:id/documentos', async (req, res) => {
  try {
    const rows = await planejamentoDocumentoModel.listByPlanejamento(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Planejamento documentos - list all and create
app.get('/api/planejamento_documentos', async (req, res) => {
  try {
    const parseFilterValue = (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (!trimmed) return trimmed;
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return JSON.parse(trimmed);
        } catch (_) {
          return value;
        }
      }
      return value;
    };

    const normalizeArray = (value) => {
      if (Array.isArray(value)) return value;
      return [];
    };

    const where = [];
    const values = [];
    const addWhere = (sql, value) => {
      values.push(value);
      where.push(`${sql} $${values.length}`);
    };

    const addNumericFilter = (column, rawValue) => {
      if (rawValue === undefined) return;
      const parsed = parseFilterValue(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const inValues = normalizeArray(parsed.$in)
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v));
        if (inValues.length > 0) {
          values.push(inValues);
          where.push(`${column} = ANY($${values.length}::int[])`);
        }
        return;
      }

      const n = Number(parsed);
      if (Number.isFinite(n)) {
        addWhere(`${column} =`, n);
      }
    };

    const addTextFilter = (column, rawValue) => {
      if (rawValue === undefined) return;
      const parsed = parseFilterValue(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const inValues = normalizeArray(parsed.$in)
          .map((v) => String(v || '').trim())
          .filter(Boolean);
        if (inValues.length > 0) {
          values.push(inValues);
          where.push(`${column} = ANY($${values.length}::text[])`);
        }
        return;
      }

      const text = String(parsed || '').trim();
      if (text) {
        addWhere(`${column} =`, text);
      }
    };

    addNumericFilter('pd.id', req.query.id);
    addNumericFilter('pd.planejamento_atividade_id', req.query.planejamento_atividade_id);
    addNumericFilter('pd.documento_id', req.query.documento_id);
    if (req.query.executor_principal !== undefined) {
      const text = String(req.query.executor_principal || '').trim();
      if (text) { values.push(text); where.push(`pd.executor_principal = $${values.length}`); }
    }
    if (req.query.status !== undefined) {
      const text = String(req.query.status || '').trim();
      if (text) { values.push(text); where.push(`pd.status = $${values.length}`); }
    }

    const executorInList = String(req.query.executor || req.query.usuario || '').trim();
    if (executorInList) {
      values.push(executorInList);
      where.push(`COALESCE(pd.executores, '[]'::jsonb) ? $${values.length}`);
    }

    const empreendimentoId = Number(req.query.empreendimento_id);
    if (Number.isFinite(empreendimentoId)) {
      values.push(empreendimentoId);
      where.push(`EXISTS (
        SELECT 1
        FROM documentos d
        WHERE d.id = pd.documento_id
          AND d.empreendimento_id = $${values.length}
      )`);
    }

    const limit = Number.parseInt(req.query.limit || '5000', 10);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10000) : 5000;

    const sql = `
      SELECT pd.*, d.empreendimento_id
      FROM planejamento_documentos pd
      LEFT JOIN documentos d ON d.id = pd.documento_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pd.id DESC
      LIMIT $${values.length + 1}
    `;

    const result = await pool.query(sql, [...values, safeLimit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamento_documentos/medias', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT documento_id, etapa,
              ROUND(AVG(COALESCE(NULLIF(tempo_executado, 0), tempo_planejado))::numeric, 1) AS media,
              COUNT(*) AS total
       FROM planejamento_documentos
       WHERE status IN ('concluido', 'concluido_com_atraso')
         AND COALESCE(NULLIF(tempo_executado, 0), tempo_planejado) > 0
       GROUP BY documento_id, etapa`
    );
    res.json(result.rows.map(r => ({ ...r, media: Number(r.media), total: Number(r.total) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamento_documentos/media-por-documento/:documento_id', async (req, res) => {
  try {
    const documentoId = Number(req.params.documento_id);
    if (!Number.isFinite(documentoId)) return res.status(400).json({ error: 'Invalid documento_id' });
    const { etapa } = req.query;
    let query, params;
    if (etapa) {
      query = `SELECT ROUND(AVG(COALESCE(NULLIF(tempo_executado, 0), tempo_planejado))::numeric, 1) AS media, COUNT(*) AS total
               FROM planejamento_documentos
               WHERE documento_id = $1 AND etapa = $2
                 AND status IN ('concluido', 'concluido_com_atraso')
                 AND COALESCE(NULLIF(tempo_executado, 0), tempo_planejado) > 0`;
      params = [documentoId, etapa];
    } else {
      query = `SELECT ROUND(AVG(COALESCE(NULLIF(tempo_executado, 0), tempo_planejado))::numeric, 1) AS media, COUNT(*) AS total
               FROM planejamento_documentos
               WHERE documento_id = $1
                 AND status IN ('concluido', 'concluido_com_atraso')
                 AND COALESCE(NULLIF(tempo_executado, 0), tempo_planejado) > 0`;
      params = [documentoId];
    }
    const result = await pool.query(query, params);
    const { media, total } = result.rows[0];
    res.json({ media: media ? Number(media) : null, total: Number(total), etapa: etapa || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/planejamento_documentos', async (req, res) => {
  try {
    const payload = req.body;
    const link = await planejamentoDocumentoModel.linkDocumentoToPlanejamento(payload);
    res.json(link);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update planejamento_documento by id
app.patch('/api/planejamento_documentos/:id', async (req, res) => {
  try {
    if (typeof planejamentoDocumentoModel.updateById !== 'function') {
      return res.status(500).json({ error: 'update not implemented on model' });
    }
    const updated = await planejamentoDocumentoModel.updateById(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });

    // When a document planning is concluded, auto-complete all matching activities
    if (req.body && req.body.status === 'concluido' && updated.documento_id && updated.etapa) {
      try {
        await pool.query(
          `UPDATE planejamento_atividades pa
           SET status = 'concluido', termino_real = CURRENT_DATE
           WHERE pa.documento_id = $1
             AND pa.status != 'concluido'
             AND EXISTS (
               SELECT 1 FROM atividades a WHERE a.id = pa.atividade_id AND a.etapa = $2
               UNION ALL
               SELECT 1 FROM atividades_empreendimento ae WHERE ae.id = pa.atividade_id AND ae.etapa = $2
             )`,
          [updated.documento_id, updated.etapa]
        );
      } catch (autoErr) {
        console.error('[planejamento_documentos PATCH] Erro ao auto-concluir atividades:', autoErr.message);
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete planejamento_documento by id
app.delete('/api/planejamento_documentos/:id', async (req, res) => {
  try {
    if (typeof planejamentoDocumentoModel.deleteById !== 'function') {
      return res.status(500).json({ error: 'delete not implemented on model' });
    }
    const deleted = await planejamentoDocumentoModel.deleteById(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execuções
app.post('/api/execucoes', async (req, res) => {
  try {
    const ex = await execucaoModel.createExecucao(req.body);
    res.json(ex);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single execution by id
app.get('/api/execucoes/:id', async (req, res) => {
  try {
    const ex = await execucaoModel.getExecucaoById(req.params.id);
    if (!ex) return res.status(404).json({ error: 'Not found' });
    res.json(ex);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update execution
app.patch('/api/execucoes/:id', async (req, res) => {
  try {
    const updated = await execucaoModel.updateExecucao(req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE execution
app.delete('/api/execucoes/:id', async (req, res) => {
  try {
    const deleted = await execucaoModel.deleteExecucao(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/planejamentos/:id/execucoes', async (req, res) => {
  try {
    const rows = await execucaoModel.listExecucoesByPlanejamento(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Analíticos
app.post('/api/analiticos', async (req, res) => {
  try {
    const a = await analiticoModel.createAnalitico(req.body);
    res.json(a);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analiticos', async (req, res) => {
  try {
    const rows = await analiticoModel.listAnaliticos(200);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pavimentos
app.post('/api/pavimentos', async (req, res) => {
  try {
    const p = await pavimentoModel.createPavimento(req.body);
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empreendimentos/:id/pavimentos', async (req, res) => {
  try {
    const rows = await pavimentoModel.listPavimentosByEmpreendimento(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Support query-style access to pavimentos: /api/pavimentos?empreendimento_id=1
app.get('/api/pavimentos', async (req, res) => {
  try {
    const empId = req.query.empreendimento_id;
    if (empId) {
      const rows = await pavimentoModel.listPavimentosByEmpreendimento(empId);
      return res.json(rows);
    }
    // fallback: list all pavimentos
    const result = await pool.query('SELECT * FROM pavimentos ORDER BY empreendimento_id, ordem');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update pavimento
app.patch('/api/pavimentos/:id', async (req, res) => {
  try {
    const updated = await pavimentoModel.updatePavimento(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete pavimento
app.delete('/api/pavimentos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM pavimentos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Consumo de Água (hidráulica) - cálculo de demanda e dimensionamento de reservatório
app.post('/api/consumo_agua', async (req, res) => {
  try {
    const c = await consumoAguaModel.createCalculo(req.body);
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Support query-style access: /api/consumo_agua?empreendimento_id=1
app.get('/api/consumo_agua', async (req, res) => {
  try {
    const empId = req.query.empreendimento_id;
    if (empId) {
      const rows = await consumoAguaModel.listCalculosByEmpreendimento(empId);
      return res.json(rows);
    }
    const result = await pool.query('SELECT * FROM consumo_agua_calculos ORDER BY empreendimento_id, id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/consumo_agua/:id', async (req, res) => {
  try {
    const c = await consumoAguaModel.getCalculo(req.params.id);
    if (!c) return res.status(404).json({ error: 'Não encontrado' });
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/consumo_agua/:id', async (req, res) => {
  try {
    const updated = await consumoAguaModel.updateCalculo(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/consumo_agua/:id', async (req, res) => {
  try {
    await consumoAguaModel.deleteCalculo(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const handleCreateAta = async (req, res) => {
  try {
    const ata = await atasModel.createAta(req.body || {});
    res.json(ata);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const handleUpdateAta = async (req, res) => {
  try {
    const updated = await atasModel.updateAta(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const handleListAtas = async (req, res) => {
  try {
    const rows = await atasModel.listAtas({
      sort: req.query.sort,
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const handleGetAta = async (req, res) => {
  try {
    const ata = await atasModel.getAtaById(req.params.id);
    if (!ata) return res.status(404).json({ error: 'Not found' });
    res.json(ata);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const handleDeleteAta = async (req, res) => {
  try {
    await atasModel.deleteAta(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Atas
app.post('/api/atas', handleCreateAta);
app.post('/api/atas_reuniao', handleCreateAta);
app.get('/api/atas_reuniao', handleListAtas);
app.get('/api/atas_reuniao/:id', handleGetAta);

app.get('/api/empreendimentos/:id/atas', async (req, res) => {
  try {
    const rows = await atasModel.listAtasByEmpreendimento(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/atas_reuniao/:id', handleDeleteAta);

// Update ATA
app.patch('/api/atas/:id', handleUpdateAta);
app.patch('/api/atas_reuniao/:id', handleUpdateAta);

// Notificações
app.post('/api/notificacoes', async (req, res) => {
  try {
    const n = await notificacaoModel.createNotificacao(req.body);
    res.json(n);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notificacoes', async (req, res) => {
  try {
    const { usuario_email, status } = req.query;
    // Handle MongoDB-style operators: data_notificacao[$gte]=date
    const raw_data = req.query['data_notificacao'];
    let data_notificacao_gte;
    if (raw_data && typeof raw_data === 'object' && raw_data.$gte) {
      data_notificacao_gte = raw_data.$gte;
    } else if (req.query['data_notificacao[$gte]']) {
      data_notificacao_gte = req.query['data_notificacao[$gte]'];
    }
    const rows = await notificacaoModel.listNotificacoes({ usuario_email, status, data_notificacao_gte });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Responder notificação via link de email (deve vir antes de /:id)
app.get('/api/notificacoes/responder', async (req, res) => {
  const { token, data, ignorar } = req.query;

  const html = (titulo, msg, cor = '#10b981') => `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title></head>
<body style="font-family:Arial,sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="background:#fff;border-radius:10px;padding:40px;max-width:400px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.1);">
    <div style="font-size:48px;margin-bottom:16px;">${cor === '#10b981' ? '✅' : cor === '#f59e0b' ? '🔔' : '❌'}</div>
    <h2 style="color:${cor};margin:0 0 12px;">${titulo}</h2>
    <p style="color:#6b7280;margin:0;">${msg}</p>
  </div>
</body></html>`;

  if (!token) return res.status(400).send(html('Token inválido', 'O link utilizado é inválido ou está incompleto.', '#ef4444'));

  try {
    const notif = await notificacaoModel.getByToken(token);
    if (!notif) return res.status(404).send(html('Não encontrado', 'Esta notificação não existe ou o link expirou.', '#ef4444'));
    if (notif.status !== 'pendente') {
      return res.send(html('Já respondida', `Esta atividade já foi ${notif.status === 'agendada' ? 'agendada' : 'dispensada'} anteriormente.`, '#f59e0b'));
    }

    if (ignorar === 'true') {
      await notificacaoModel.updateNotificacao(notif.id, { status: 'ignorada' });
      return res.send(html('Dispensado', `A atividade "<strong>${notif.atividade_nome}</strong>" não será realizada esta semana.`, '#6b7280'));
    }

    if (data) {
      // Criar planejamento simples para a data escolhida
      const horas = Number(notif.tempo_estimado) || 1;
      const novoPlanejamento = await planejamentoModel.createPlanejamentoAtividade({
        descritivo: notif.atividade_nome,
        executor_principal: notif.usuario_email,
        executores: [notif.usuario_email],
        tempo_planejado: horas,
        inicio_planejado: data,
        termino_planejado: data,
        horas_por_dia: { [data]: horas },
        status: 'nao_iniciado',
      });

      await notificacaoModel.updateNotificacao(notif.id, {
        status: 'agendada',
        data_agendada: data,
        planejamento_id: novoPlanejamento.id,
      });

      const [dia, mes] = data.split('-').slice(1).reverse().map(s => s.padStart(2, '0'));
      return res.send(html('Agendado!', `A atividade "<strong>${notif.atividade_nome}</strong>" foi agendada para ${dia}/${mes}.`));
    }

    return res.status(400).send(html('Ação inválida', 'Nenhuma ação reconhecida no link.', '#ef4444'));
  } catch (err) {
    console.error('Erro ao responder notificação:', err);
    return res.status(500).send(html('Erro', 'Ocorreu um erro ao processar sua resposta. Tente pelo sistema.', '#ef4444'));
  }
});

app.patch('/api/notificacoes/:id', async (req, res) => {
  try {
    const row = await notificacaoModel.updateNotificacao(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disparo manual de notificações ocasionais (útil para testes e fallback)
app.post('/api/notificacoes/disparar', async (req, res) => {
  try {
    const resultado = await dispararNotificacoesOcasionais();
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Atividade funções
app.post('/api/atividade-funcoes', async (req, res) => {
  try {
    const f = await atividadeFuncaoModel.createAtividadeFuncao(req.body);
    res.json(f);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/atividade-funcoes', async (req, res) => {
  try {
    const { funcao, frequencia, id } = req.query;
    const rows = await atividadeFuncaoModel.listAtividadeFuncoes({ funcao, frequencia, id });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/atividade-funcoes/:id', async (req, res) => {
  try {
    const row = await atividadeFuncaoModel.updateAtividadeFuncao(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/atividade-funcoes/:id', async (req, res) => {
  try {
    await atividadeFuncaoModel.deleteAtividadeFuncao(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sobras (full CRUD for the SobraUsuario entity used by the frontend)
app.get('/api/sobras', async (req, res) => {
  try {
    const { empreendimento_id, usuario } = req.query;
    const conditions = [];
    const values = [];
    if (empreendimento_id) { conditions.push(`empreendimento_id = $${values.length + 1}`); values.push(empreendimento_id); }
    if (usuario) { conditions.push(`usuario = $${values.length + 1}`); values.push(usuario); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`SELECT * FROM sobras ${where} ORDER BY id DESC`, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sobras', async (req, res) => {
  try {
    const { usuario, empreendimento_id, horas_sobra } = req.body || {};
    const result = await pool.query(
      `INSERT INTO sobras (usuario, empreendimento_id, horas_sobra) VALUES ($1, $2, $3) RETURNING *`,
      [usuario, empreendimento_id || null, horas_sobra || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sobras/:id', async (req, res) => {
  try {
    const fields = req.body || {};
    const keys = Object.keys(fields);
    if (!keys.length) {
      const row = (await pool.query('SELECT * FROM sobras WHERE id = $1', [req.params.id])).rows[0];
      return res.json(row || null);
    }
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map(k => fields[k]), req.params.id];
    const result = await pool.query(
      `UPDATE sobras SET ${sets}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sobras/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sobras WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disciplinas
app.get('/api/disciplinas', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    const result = await pool.query('SELECT * FROM disciplinas ORDER BY id DESC LIMIT $1', [limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create disciplina
app.post('/api/disciplinas', async (req, res) => {
  try {
    const { nome } = req.body || {};
    const result = await pool.query('INSERT INTO disciplinas (nome) VALUES ($1) RETURNING *', [nome || null]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update disciplina
app.patch('/api/disciplinas/:id', async (req, res) => {
  try {
    const fields = req.body || {};
    const keys = Object.keys(fields);
    if (!keys.length) {
      const row = (await pool.query('SELECT * FROM disciplinas WHERE id = $1', [req.params.id])).rows[0];
      return res.json(row || null);
    }
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map(k => fields[k]);
    const q = `UPDATE disciplinas SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`;
    const result = await pool.query(q, [...values, req.params.id]);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete disciplina
app.delete('/api/disciplinas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM disciplinas WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Equipes (teams)
app.get('/api/equipes', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    if (req.query.empreendimento_id) {
      const result = await pool.query('SELECT * FROM equipes WHERE empreendimento_id = $1 ORDER BY id DESC LIMIT $2', [req.query.empreendimento_id, limit]);
      return res.json(result.rows);
    }
    const result = await pool.query('SELECT * FROM equipes ORDER BY id DESC LIMIT $1', [limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/equipes/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM equipes WHERE id = $1', [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/equipes', async (req, res) => {
  try {
    const { nome, empreendimento_id, cor, descricao } = req.body || {};
    const result = await pool.query(
      'INSERT INTO equipes (nome, empreendimento_id, cor, descricao) VALUES ($1, $2, $3, $4) RETURNING *',
      [nome || null, empreendimento_id || null, cor || '#3B82F6', descricao || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/equipes/:id', async (req, res) => {
  try {
    const fields = req.body || {};
    const keys = Object.keys(fields);
    if (!keys.length) return res.json((await pool.query('SELECT * FROM equipes WHERE id = $1', [req.params.id])).rows[0] || null);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map(k => fields[k]);
    const q = `UPDATE equipes SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`;
    const result = await pool.query(q, [...values, req.params.id]);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/equipes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM equipes WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current user helper (used by frontend User.me())
app.get('/api/users/me', async (req, res) => {
  try {
    const token = getBearerToken(req);
    const payload = verifySessionToken(token);
    const fixedAdmin = getFixedAdminConfig();

    if (payload?.sub && String(payload.sub) === 'fixed-admin' && String(payload.email || '').toLowerCase() === fixedAdmin.email) {
      return res.json(fixedAdmin.user);
    }

    if (payload?.sub) {
      const user = await usersModel.getUserById(payload.sub);
      return res.json(toPublicUser(user));
    }

    res.json(null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Data cadastro (persistent CRUD for CadastroTab)
app.get('/api/data_cadastro', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '5000', 10);
    const filter = {};
    if (req.query.empreendimento_id) filter.empreendimento_id = req.query.empreendimento_id;
    if (req.query.documento_id) filter.documento_id = req.query.documento_id;
    const rows = await dataCadastroModel.listDataCadastro(filter, limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/data_cadastro/:id', async (req, res) => {
  try {
    const row = await dataCadastroModel.getById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const __devStore = { controle_os: {} };

app.post('/api/data_cadastro', async (req, res) => {
  try {
    const row = await dataCadastroModel.createDataCadastro(req.body || {});
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/data_cadastro/:id', async (req, res) => {
  try {
    const row = await dataCadastroModel.updateById(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/data_cadastro/:id', async (req, res) => {
  try {
    await dataCadastroModel.deleteById(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple in-memory Controle OS endpoints to avoid 404s in dev environment
app.get('/api/controle_os', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    const filter = {};
    if (req.query.empreendimento_id) filter.empreendimento_id = req.query.empreendimento_id;
    try {
      const rows = await controleOSModel.listControles(filter, limit);
      return res.json(rows);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('controle_os') && (msg.includes('does not exist') || msg.includes('não existe') || msg.includes('relation'))) {
        // fallback to in-memory
        const rows = Object.values(__devStore.controle_os).filter(r => !filter.empreendimento_id || String(r.empreendimento_id) === String(filter.empreendimento_id));
        return res.json(rows);
      }
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/controle_os', async (req, res) => {
  try {
    try {
      const created = await controleOSModel.createControle(req.body || {});
      return res.status(201).json(created);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('controle_os') && (msg.includes('does not exist') || msg.includes('não existe') || msg.includes('relation'))) {
        const id = `temp-${Date.now()}`;
        const row = { id, ...req.body, created_at: new Date().toISOString() };
        __devStore.controle_os[id] = row;
        return res.status(201).json(row);
      }
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/controle_os/:id', async (req, res) => {
  try {
    try {
      const row = await controleOSModel.getById(req.params.id);
      if (row) return res.json(row);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (!(msg.includes('controle_os') && (msg.includes('does not exist') || msg.includes('não existe') || msg.includes('relation')))) throw err;
    }
    const row = __devStore.controle_os[req.params.id] || null;
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/controle_os/:id', async (req, res) => {
  try {
    try {
      const updated = await controleOSModel.updateById(req.params.id, req.body || {});
      if (updated) return res.json(updated);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (!(msg.includes('controle_os') && (msg.includes('does not exist') || msg.includes('não existe') || msg.includes('relation')))) throw err;
    }

    const existing = __devStore.controle_os[req.params.id];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const updated = { ...existing, ...(req.body || {}), updated_at: new Date().toISOString() };
    __devStore.controle_os[req.params.id] = updated;
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/controle_os/:id', async (req, res) => {
  try {
    try {
      await controleOSModel.deleteById(req.params.id);
      return res.status(204).end();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (!(msg.includes('controle_os') && (msg.includes('does not exist') || msg.includes('não existe') || msg.includes('relation')))) throw err;
    }
    if (__devStore.controle_os[req.params.id]) {
      delete __devStore.controle_os[req.params.id];
      return res.status(204).end();
    }
    res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ItemPRE CRUD backed by DB
app.get('/api/itempre', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '500', 10);
    const filter = {};
    if (req.query.empreendimento_id) filter.empreendimento_id = req.query.empreendimento_id;
    if (req.query.checklist_item_id) filter.checklist_item_id = req.query.checklist_item_id;
    if (req.query.checklist_doc_id) filter.checklist_doc_id = req.query.checklist_doc_id;
    const rows = await itempreModel.listItems(filter, limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/itempre', async (req, res) => {
  try {
    const created = await itempreModel.createItem(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/itempre/:id', async (req, res) => {
  try {
    const row = await itempreModel.getItemById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/itempre/:id', async (req, res) => {
  try {
    console.log('PATCH /api/itempre/:id', req.params.id, 'body:', JSON.stringify(req.body));
    const updated = await itempreModel.updateItem(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/itempre/:id error', err && err.message, 'body:', req.body);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/itempre/:id', async (req, res) => {
  try {
    await itempreModel.deleteItem(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atividades
app.get('/api/atividades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    // optional filter by empreendimento_id
    let result;
    if (req.query.empreendimento_id) {
      result = await pool.query(
        `SELECT a.*, d.nome AS disciplina_nome FROM atividades a LEFT JOIN disciplinas d ON a.disciplina_id = d.id WHERE a.empreendimento_id = $1 ORDER BY a.id DESC LIMIT $2`,
        [req.query.empreendimento_id, limit]
      );
    } else {
      result = await pool.query(
        `SELECT a.*, d.nome AS disciplina_nome FROM atividades a LEFT JOIN disciplinas d ON a.disciplina_id = d.id ORDER BY a.id DESC LIMIT $1`,
        [limit]
      );
    }

    // Map DB columns to frontend expected keys
    const rows = result.rows.map(r => ({
      ...r,
      atividade: r.titulo || r.atividade || '',
      descricao: r.descricao || '',
      disciplina: r.disciplina_nome || null,
      funcao: r.funcao || null,
      predecessora: r.predecessora || null,
      subdisciplina: r.subdisciplina || null,
      tempo: r.tempo || null,
      id_atividade: r.id_atividade || null
    }));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/atividades/:id', async (req, res) => {
  try {
    const atividade = await atividadesModel.getAtividadeById(req.params.id);

    if (!atividade) {
      return res.status(404).json({ error: 'Atividade não encontrada.' });
    }

    const disciplinaNome = atividade.disciplina_id
      ? await pool.query('SELECT nome FROM disciplinas WHERE id = $1 LIMIT 1', [atividade.disciplina_id])
      : { rows: [] };

    return res.json({
      ...atividade,
      atividade: atividade.titulo || atividade.atividade || '',
      descricao: atividade.descricao || '',
      disciplina: disciplinaNome.rows[0]?.nome || null,
      funcao: atividade.funcao || null,
      predecessora: atividade.predecessora || null,
      subdisciplina: atividade.subdisciplina || null,
      tempo: atividade.tempo || null,
      id_atividade: atividade.id_atividade || null
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create atividade
app.post('/api/atividades', async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    console.log('POST /api/atividades payload:', JSON.stringify(payload));

    // Map frontend alias 'atividade' to DB 'titulo'
    if (payload.atividade !== undefined) {
      payload.titulo = payload.atividade;
      delete payload.atividade;
    }

    // Resolve disciplina (name or id) to disciplina_id
    if (payload.disciplina !== undefined) {
      const val = payload.disciplina;
      delete payload.disciplina;
      if (val === null || val === '') {
        payload.disciplina_id = null;
      } else if (!isNaN(Number(val))) {
        payload.disciplina_id = Number(val);
      } else {
        const nome = String(val).trim();
        const r = await pool.query('SELECT id FROM disciplinas WHERE nome = $1 LIMIT 1', [nome]);
        if (r.rows.length) payload.disciplina_id = r.rows[0].id;
        else {
          const ins = await pool.query('INSERT INTO disciplinas (nome) VALUES ($1) RETURNING id', [nome]);
          payload.disciplina_id = ins.rows[0].id;
        }
      }
    }

    // Avoid inserting id field
    delete payload.id;

    // Build sanitized payload mapping frontend keys to DB columns
    const sanitized = {
      titulo: payload.titulo || payload.atividade || null,
      etapa: payload.etapa || null,
      predecessora: payload.predecessora || null,
      funcao: payload.funcao || null,
      subdisciplina: payload.subdisciplina || null,
      tempo: payload.tempo == null ? null : Number(payload.tempo),
      id_atividade: payload.id_atividade || null,
      descricao: payload.descricao || null,
      status: payload.status || null,
      inicio_previsto: payload.inicio_previsto || null,
      fim_previsto: payload.fim_previsto || null,
      empreendimento_id: payload.empreendimento_id || null,
      equipe_id: payload.equipe_id || null,
      disciplina_id: payload.disciplina_id || null,
      responsavel_id: payload.responsavel_id || null
    };

    console.log('POST /api/atividades sanitized:', JSON.stringify(sanitized));

    const created = await atividadesModel.createAtividade(sanitized);
    console.log('POST /api/atividades created:', JSON.stringify(created));
    // map DB -> frontend keys
    const out = {
      ...created,
      atividade: created.titulo,
      disciplina: created.disciplina_id || null,
      id_atividade: created.id_atividade || null
    };
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atividades genéricas (por usuário — filtradas pelo token de autenticação)
function _mapAtividadeGenerica(r) {
  return {
    id: r.id,
    nome: r.nome || '',
    atividade: r.nome || '',
    usuario_id: r.usuario_id ?? null,
    is_global: r.usuario_id === null || r.usuario_id === undefined,
  };
}

app.get('/api/atividades_genericas', async (req, res) => {
  try {
    const token = getBearerToken(req);
    const payload = verifySessionToken(token);
    const userId = payload?.sub ?? null;
    const limit = parseInt(req.query.limit || '200', 10);

    let result;
    if (userId) {
      result = await pool.query(
        `SELECT id, nome, usuario_id FROM atividades_genericas
         WHERE usuario_id = $1 OR usuario_id IS NULL
         ORDER BY nome ASC LIMIT $2`,
        [userId, limit]
      );
    } else {
      result = await pool.query(
        `SELECT id, nome, usuario_id FROM atividades_genericas
         WHERE usuario_id IS NULL
         ORDER BY nome ASC LIMIT $1`,
        [limit]
      );
    }

    res.json(result.rows.map(_mapAtividadeGenerica));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/atividades_genericas/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    const result = await pool.query(
      `SELECT id, nome, usuario_id FROM atividades_genericas WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Atividade genérica não encontrada.' });
    }

    return res.json(_mapAtividadeGenerica(result.rows[0]));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/atividades_genericas', async (req, res) => {
  try {
    const token = getBearerToken(req);
    const payload = verifySessionToken(token);
    if (!payload?.sub) {
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }
    const userId = payload.sub;

    const body = { ...(req.body || {}) };
    const nome = String(body.nome || body.atividade || '').trim();

    if (!nome) {
      return res.status(400).json({ error: 'Campo "nome" é obrigatório.' });
    }

    const insert = await pool.query(
      'INSERT INTO atividades_genericas (nome, usuario_id) VALUES ($1, $2) RETURNING id, nome, usuario_id',
      [nome, userId]
    );

    return res.status(201).json(_mapAtividadeGenerica(insert.rows[0]));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/atividades_genericas/:id', async (req, res) => {
  try {
    const token = getBearerToken(req);
    const payload = verifySessionToken(token);
    if (!payload?.sub) {
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }
    const userId = payload.sub;

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    const body = { ...(req.body || {}) };
    const nome = String(body.nome || body.atividade || '').trim();
    if (!nome) return res.status(400).json({ error: 'Campo "nome" é obrigatório.' });

    const existing = await pool.query(
      'SELECT id, usuario_id FROM atividades_genericas WHERE id = $1',
      [id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Atividade genérica não encontrada.' });

    const atividade = existing.rows[0];
    const userRow = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    const isAdmin = userRow.rows[0]?.role === 'admin';

    if (!isAdmin && atividade.usuario_id !== userId) {
      return res.status(403).json({ error: 'Sem permissão para editar esta atividade.' });
    }

    const updated = await pool.query(
      'UPDATE atividades_genericas SET nome = $1 WHERE id = $2 RETURNING id, nome, usuario_id',
      [nome, id]
    );

    return res.json(_mapAtividadeGenerica(updated.rows[0]));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/atividades_genericas/:id', async (req, res) => {
  try {
    const token = getBearerToken(req);
    const payload = verifySessionToken(token);
    if (!payload?.sub) {
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }
    const userId = payload.sub;

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    const existing = await pool.query(
      'SELECT id, usuario_id FROM atividades_genericas WHERE id = $1',
      [id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Atividade genérica não encontrada.' });

    const atividade = existing.rows[0];
    const userRow = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    const isAdmin = userRow.rows[0]?.role === 'admin';

    const canDelete = isAdmin || (atividade.usuario_id !== null && atividade.usuario_id === userId);
    if (!canDelete) {
      return res.status(403).json({ error: 'Sem permissão para remover esta atividade.' });
    }

    await pool.query('DELETE FROM atividades_genericas WHERE id = $1', [id]);
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update atividade
app.patch('/api/atividades/:id', async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };

    // Map frontend aliases to DB column names
    if (payload.atividade !== undefined) {
      payload.titulo = payload.atividade;
      delete payload.atividade;
    }

    // Handle disciplina: accept name or id -> set disciplina_id
    if (payload.disciplina !== undefined) {
      const val = payload.disciplina;
      delete payload.disciplina;
      if (val === null || val === '') {
        payload.disciplina_id = null;
      } else if (!isNaN(Number(val))) {
        payload.disciplina_id = Number(val);
      } else {
        // resolve by name, create if needed
        const nome = String(val).trim();
        const r = await pool.query('SELECT id FROM disciplinas WHERE nome = $1 LIMIT 1', [nome]);
        if (r.rows.length) payload.disciplina_id = r.rows[0].id;
        else {
          const ins = await pool.query('INSERT INTO disciplinas (nome) VALUES ($1) RETURNING id', [nome]);
          payload.disciplina_id = ins.rows[0].id;
        }
      }
    }

    // Remove any id field to avoid updating primary key
    delete payload.id;

    const updated = await atividadesModel.updateAtividade(req.params.id, payload);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete atividade
app.delete('/api/atividades/:id', async (req, res) => {
  try {
    await atividadesModel.deleteAtividade(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execuções - support list and optional filters
app.get('/api/execucoes', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '5000', 10);
    const where = [];
    const params = [];

    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const addEqualsFilter = (column, value) => {
      if (value === undefined || value === null || value === '') return;
      where.push(`${column} = ${addParam(value)}`);
    };

    const addRangeFilter = (column, rawValue) => {
      if (rawValue === undefined || rawValue === null || rawValue === '') return;

      let parsedValue = rawValue;
      if (typeof rawValue === 'string') {
        try {
          parsedValue = JSON.parse(rawValue);
        } catch (e) {
          parsedValue = rawValue;
        }
      }

      if (parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)) {
        if (parsedValue.$gte !== undefined && parsedValue.$gte !== null && parsedValue.$gte !== '') {
          where.push(`${column} >= ${addParam(parsedValue.$gte)}`);
        }
        if (parsedValue.$lte !== undefined && parsedValue.$lte !== null && parsedValue.$lte !== '') {
          where.push(`${column} <= ${addParam(parsedValue.$lte)}`);
        }
        return;
      }

      where.push(`${column} = ${addParam(parsedValue)}`);
    };

    addEqualsFilter('id', req.query.id);
    addEqualsFilter('planejamento_id', req.query.planejamento_id);
    addEqualsFilter('planejamento_atividade_id', req.query.planejamento_atividade_id);
    addEqualsFilter('usuario_id', req.query.usuario_id);
    addEqualsFilter('usuario', req.query.usuario);
    addEqualsFilter('status', req.query.status);
    addEqualsFilter('empreendimento_id', req.query.empreendimento_id);
    addEqualsFilter('tipo_planejamento', req.query.tipo_planejamento);
    addRangeFilter('inicio', req.query.inicio);
    addRangeFilter('termino', req.query.termino);
    addRangeFilter('data_execucao', req.query.data_execucao);

    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT * FROM execucoes${whereSql} ORDER BY inicio DESC NULLS LAST, id DESC LIMIT ${addParam(limit)}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usuarios/:id/sobras', async (req, res) => {
  try {
    const rows = await sobraModel.listSobrasByUsuario(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alterações de etapa
app.post('/api/alteracoes', async (req, res) => {
  try {
    const a = await alteracaoModel.createAlteracao(req.body);
    res.json(a);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List alterações - support optional data_alteracao filter (default: last 24h)
app.get('/api/alteracoes', async (req, res) => {
  try {
    let since = null;
    if (req.query.data_alteracao) {
      // Try to parse as JSON (in case frontend sends serialized filters)
      try {
        const parsed = JSON.parse(req.query.data_alteracao);
        if (parsed && parsed.$gte) since = new Date(parsed.$gte).toISOString();
      } catch (e) {
        // If it's not JSON (e.g. "[object Object]"), ignore and fallback
      }
    }

    if (!since) {
      const d = new Date();
      d.setHours(d.getHours() - 24);
      since = d.toISOString();
    }

    const result = await pool.query('SELECT * FROM alteracoes_etapa WHERE created_at >= $1 ORDER BY created_at DESC LIMIT $2', [since, parseInt(req.query.limit || '200', 10)]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/atividades/:id/alteracoes', async (req, res) => {
  try {
    const rows = await alteracaoModel.listAlteracoesByAtividade(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OS manual
app.post('/api/os', async (req, res) => {
  try {
    const o = await osModel.createOSManual(req.body);
    res.json(o);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete OS manual by id (also remove corresponding alocacao_equipe entries where referencia matches numero)
app.delete('/api/os/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await pool.query('SELECT * FROM os_manual WHERE id = $1', [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    // delete os_manual row
    await pool.query('DELETE FROM os_manual WHERE id = $1', [id]);
    // if numero present, delete alocacao_equipe entries that reference this OS
    if (row.numero) {
      try {
        await pool.query("DELETE FROM alocacao_equipe WHERE tipo = 'os' AND referencia = $1", [row.numero]);
      } catch (err) {
        console.warn('Could not delete linked alocacao_equipe rows for OS numero', row.numero, err && err.message);
      }
    }
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List OS manual - supports optional filters: usuario_email, data, os, empreendimento_id
app.get('/api/os', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);

    // If querying by usuario_email/data/os, these columns exist on alocacao_equipe (tipo='os'),
    // so query that table instead and map results into a shape compatible with OSManual expected by frontend.
    if (req.query.usuario_email || req.query.data || req.query.os) {
      const where = ['ae.tipo = $1'];
      const params = ['os'];
      let idx = 2;

      if (req.query.usuario_email) {
        where.push(`(ae.usuario_email = $${idx} OR u.email = $${idx})`);
        params.push(req.query.usuario_email);
        idx++;
      }
      if (req.query.data) {
        where.push(`ae.data = $${idx++}`);
        params.push(req.query.data);
      }
      if (req.query.os) {
        where.push(`ae.referencia = $${idx++}`);
        params.push(req.query.os);
      }

      let q = `SELECT ae.*, u.email as usuario_email_db, emp.nome as empreendimento_nome
               FROM alocacao_equipe ae
               LEFT JOIN users u ON ae.usuario_id = u.id
               LEFT JOIN empreendimentos emp ON ae.empreendimento_id = emp.id
               WHERE ${where.join(' AND ')} ORDER BY ae.id DESC LIMIT $${idx}`;
      params.push(limit);

      const result = await pool.query(q, params);
      // Map to OSManual-like shape expected by frontend
      const mapped = (result.rows || []).map(r => ({
        id: r.id,
        usuario_email: r.usuario_email || r.usuario_email_db || null,
        data: r.data,
        os: r.referencia,
        referencia: r.referencia,
        label: r.label,
        cor: r.cor,
        empreendimento_id: r.empreendimento_id,
        empreendimento_nome: r.empreendimento_nome || null,
        created_at: r.created_at
      }));
      return res.json(mapped);
    }

    // Fallback: query os_manual table when no usuario/date/os filters provided
    const where = [];
    const params = [];
    let idx = 1;
    if (req.query.empreendimento_id) {
      where.push(`empreendimento_id = $${idx++}`);
      params.push(req.query.empreendimento_id);
    }

    let q = 'SELECT * FROM os_manual';
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    q += ` ORDER BY id DESC LIMIT $${idx}`;
    params.push(limit);

    const result = await pool.query(q, params);
    res.json(result.rows || []);
  } catch (err) {
    // If table doesn't exist, return empty list to avoid breaking frontend
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('os_manual') && (msg.includes('does not exist') || msg.includes('não existe') || msg.includes('relation'))) {
      return res.json([]);
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empreendimentos/:id/os', async (req, res) => {
  try {
    const rows = await osModel.listOSPorEmpreendimento(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Propostas & Orçamentos
app.post('/api/propostas', async (req, res) => {
  try {
    const p = await propostasModel.createProposta(req.body);
    res.status(201).json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/propostas', async (req, res) => {
  try {
    const filter = {
      status: req.query.status,
      cliente: req.query.cliente,
    };
    const limit = parseInt(req.query.limit || '200', 10);
    const rows = await propostasModel.listPropostas(filter, limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/propostas/:id', async (req, res) => {
  try {
    const row = await propostasModel.getPropostaById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/propostas/:id', async (req, res) => {
  try {
    const row = await propostasModel.updateProposta(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/propostas/:id', async (req, res) => {
  try {
    await propostasModel.deleteProposta(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alias para compatibilidade com o frontend (entity Comercial -> /api/comerciais)
app.post('/api/comerciais', async (req, res) => {
  try {
    const p = await comercialModel.createComercial(req.body);
    res.status(201).json(p);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/comerciais', async (req, res) => {
  try {
    const filter = {
      status: req.query.status,
      cliente: req.query.cliente,
    };
    const limit = parseInt(req.query.limit || '200', 10);
    const rows = await comercialModel.listComerciais(filter, limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/comerciais/:id', async (req, res) => {
  try {
    const row = await comercialModel.getComercialById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/comerciais/:id', async (req, res) => {
  try {
    const row = await comercialModel.updateComercial(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/comerciais/:id', async (req, res) => {
  try {
    await comercialModel.deleteComercial(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alocacao Equipe - CRUD
app.get('/api/alocacao_equipe', async (req, res) => {
  try {
    const filters = {
      empreendimento_id: req.query.empreendimento_id,
      usuario_id: req.query.usuario_id,
      usuario_email: req.query.usuario_email,
      data: req.query.data,
      tipo: req.query.tipo,
      os: req.query.os
    };
    console.log('GET /api/alocacao_equipe filters=', filters);
    const rows = await alocacaoModel.listAlocacao(filters, parseInt(req.query.limit || '500', 10));
    console.log('GET /api/alocacao_equipe -> rows count=', Array.isArray(rows) ? rows.length : 0);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alocacao_equipe', async (req, res) => {
  try {
    const created = await alocacaoModel.createAlocacao(req.body || {});
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/alocacao_equipe/:id', async (req, res) => {
  try {
    const updated = await alocacaoModel.updateAlocacao(req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/alocacao_equipe/:id', async (req, res) => {
  try {
    await alocacaoModel.deleteAlocacao(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orcamentos', async (req, res) => {
  try {
    const o = await orcamentosModel.createOrcamento(req.body);
    res.json(o);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/propostas/:id/orcamentos', async (req, res) => {
  try {
    const rows = await orcamentosModel.listOrcamentosByProposta(req.params.id);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pages / Navigation - listar páginas do app (usado pela navegação principal)
app.get('/api/pages', (req, res) => {
  const pages = [
    { id: 'home', title: 'Início', path: '/' },
    { id: 'analise_concepcao_planejamento', title: 'Análise Concepção Planejamento', path: '/analise-concepcao-planejamento' },
    { id: 'analitico', title: 'Analítico', path: '/analitico' },
    { id: 'ata_planejamento', title: 'Ata Planejamento', path: '/ata-planejamento' },
    { id: 'atividades_rapidas', title: 'Atividades Rápidas', path: '/atividades-rapidas' },
    { id: 'checklist_planejamento', title: 'Checklist Planejamento', path: '/checklist-planejamento' },
    { id: 'comercial', title: 'Comercial', path: '/comercial' },
    { id: 'comercial_detalhes', title: 'Comercial Detalhes', path: '/comercial-detalhes' },
    { id: 'configuracoes', title: 'Configurações', path: '/configuracoes' },
    { id: 'controle_os_global', title: 'Controle OS Global', path: '/controle-os-global' },
    { id: 'dashboard', title: 'Dashboard', path: '/dashboard' },
    { id: 'empreendimento', title: 'Empreendimento', path: '/empreendimento' },
    { id: 'empreendimentos', title: 'Empreendimentos', path: '/empreendimentos' },
    { id: 'orcamentos', title: 'Orçamentos', path: '/orcamentos' },
    { id: 'planejamento', title: 'Planejamento', path: '/planejamento' },
    { id: 'pre', title: 'PRE', path: '/pre' },
    { id: 'propostas', title: 'Propostas', path: '/propostas' },
    { id: 'relatorios', title: 'Relatórios', path: '/relatorios' },
    { id: 'seletor_planejamento', title: 'Seletor Planejamento', path: '/seletor-planejamento' },
    { id: 'usuarios', title: 'Usuários', path: '/usuarios' }
  ];
  res.json(pages);
});

const PORT = Number(process.env.PORT || 4000);

  async function startServer() {
  try {
    await runMigrations();
    console.log('Database migrations applied successfully.');
  } catch (err) {
    console.warn('Warning: failed to apply migrations on startup:', err.message || err);
    console.warn('The server will continue starting, but database schema may be outdated.');
  }

  // Cron: toda sexta-feira às 8h dispara notificações de atividades ocasionais
  cron.schedule('0 8 * * 5', async () => {
    console.log('⏰ Cron sexta-feira: disparando notificações ocasionais...');
    try {
      await dispararNotificacoesOcasionais();
    } catch (err) {
      console.error('❌ Erro no cron de notificações:', err.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} is already in use. Another backend instance is likely running.`);
      console.warn('Reuse the existing instance or stop it before starting a new one.');
      process.exit(0);
      return;
    }
    console.error('Server startup error:', err);
    process.exit(1);
  });
}

  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

// Ensure optional columns exist (backfill for older DBs)
(async function ensureOptionalColumns() {
  try {
    await pool.query("ALTER TABLE disciplinas ADD COLUMN IF NOT EXISTS cor VARCHAR(50);");
    await pool.query("ALTER TABLE disciplinas ADD COLUMN IF NOT EXISTS icone VARCHAR(255);");
    console.log('✅ ensured optional columns on disciplinas');
  } catch (err) {
    console.warn('⚠️ Could not ensure optional columns for disciplinas:', err.message || err);
  }
})();

// Ensure optional columns exist on atividades (backfill for older DBs)
(async function ensureAtividadesColumns() {
  try {
    await pool.query("ALTER TABLE atividades ADD COLUMN IF NOT EXISTS etapa VARCHAR(255);");
    console.log('✅ ensured optional column etapa on atividades');
  } catch (err) {
    console.warn('⚠️ Could not ensure optional columns for atividades:', err.message || err);
  }
})();

// Ensure optional columns on pavimentos expected by frontend forms
(async function ensurePavimentosColumns() {
  try {
    await pool.query("ALTER TABLE pavimentos ADD COLUMN IF NOT EXISTS area NUMERIC(12,2);");
    await pool.query("ALTER TABLE pavimentos ADD COLUMN IF NOT EXISTS escala VARCHAR(50);");
    console.log('✅ ensured optional columns area/escala on pavimentos');
  } catch (err) {
    console.warn('⚠️ Could not ensure optional columns for pavimentos:', err.message || err);
  }
})();

// Ensure data_cadastro table exists for CadastroTab persistence
(async function ensureDataCadastroTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_cadastro (
        id SERIAL PRIMARY KEY,
        empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
        ordem INTEGER NOT NULL,
        documento_id INTEGER REFERENCES documentos(id) ON DELETE CASCADE,
        datas JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS data_cadastro_empreendimento_idx ON data_cadastro(empreendimento_id);');
    await pool.query('CREATE INDEX IF NOT EXISTS data_cadastro_documento_idx ON data_cadastro(documento_id);');
    console.log('✅ ensured data_cadastro table and indexes');
  } catch (err) {
    console.warn('⚠️ Could not ensure data_cadastro table:', err.message || err);
  }
})();

// Ensure Comercial (propostas) columns expected by frontend form
(async function ensureComercialColumns() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comerciais (
        id SERIAL PRIMARY KEY,
        numero VARCHAR(100),
        data_solicitacao DATE,
        solicitante VARCHAR(255),
        cliente VARCHAR(255),
        empreendimento VARCHAR(255),
        tipo_empreendimento VARCHAR(100),
        tipo_obra VARCHAR(100),
        utilizacao VARCHAR(100),
        parceiros JSONB,
        disciplinas JSONB,
        codisciplinas JSONB,
        pavimentos JSONB,
        escopo TEXT,
        area NUMERIC(12,2),
        estado VARCHAR(10),
        valor_bim NUMERIC(12,2),
        valor_cad NUMERIC(12,2),
        data_aprovacao DATE,
        status VARCHAR(50) DEFAULT 'solicitado',
        email VARCHAR(255),
        telefone VARCHAR(100),
        observacao TEXT,
        titulo VARCHAR(255),
        valor_estimate NUMERIC(12,2),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS numero VARCHAR(100);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS data_solicitacao DATE;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS solicitante VARCHAR(255);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS cliente VARCHAR(255);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS empreendimento VARCHAR(255);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS tipo_empreendimento VARCHAR(100);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS tipo_obra VARCHAR(100);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS utilizacao VARCHAR(100);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS parceiros JSONB;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS disciplinas JSONB;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS codisciplinas JSONB;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS pavimentos JSONB;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS escopo TEXT;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS area NUMERIC(12,2);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS estado VARCHAR(10);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS valor_bim NUMERIC(12,2);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS valor_cad NUMERIC(12,2);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS data_aprovacao DATE;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS status VARCHAR(50);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS email VARCHAR(255);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS telefone VARCHAR(100);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS observacao TEXT;");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS titulo VARCHAR(255);");
    await pool.query("ALTER TABLE comerciais ADD COLUMN IF NOT EXISTS valor_estimate NUMERIC(12,2);");

    await pool.query(`
      INSERT INTO comerciais (
        numero, data_solicitacao, solicitante, cliente, empreendimento,
        tipo_empreendimento, tipo_obra, utilizacao,
        parceiros, disciplinas, codisciplinas, pavimentos,
        escopo, area, estado, valor_bim, valor_cad, data_aprovacao,
        status, email, telefone, observacao, titulo, valor_estimate,
        created_at, updated_at
      )
      SELECT
        p.numero, p.data_solicitacao, p.solicitante, p.cliente, p.empreendimento,
        p.tipo_empreendimento, p.tipo_obra, p.utilizacao,
        p.parceiros, p.disciplinas, p.codisciplinas, p.pavimentos,
        p.escopo, p.area, p.estado, p.valor_bim, p.valor_cad, p.data_aprovacao,
        COALESCE(NULLIF(p.status, ''), 'solicitado'), p.email, p.telefone, p.observacao,
        p.titulo, p.valor,
        p.created_at, COALESCE(p.updated_at, p.created_at)
      FROM propostas p
      WHERE NOT EXISTS (
        SELECT 1
        FROM comerciais c
        WHERE COALESCE(c.numero, '') = COALESCE(p.numero, '')
          AND COALESCE(c.cliente, '') = COALESCE(p.cliente, '')
          AND COALESCE(c.empreendimento, '') = COALESCE(p.empreendimento, '')
          AND COALESCE(c.data_solicitacao::text, '') = COALESCE(p.data_solicitacao::text, '')
      );
    `);

    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS numero VARCHAR(100);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS data_solicitacao DATE;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS solicitante VARCHAR(255);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS empreendimento VARCHAR(255);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tipo_empreendimento VARCHAR(100);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tipo_obra VARCHAR(100);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS utilizacao VARCHAR(100);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS parceiros JSONB;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS disciplinas JSONB;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS codisciplinas JSONB;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS pavimentos JSONB;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS escopo TEXT;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS area NUMERIC(12,2);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS estado VARCHAR(10);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_bim NUMERIC(12,2);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_cad NUMERIC(12,2);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS data_aprovacao DATE;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS email VARCHAR(255);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS telefone VARCHAR(100);");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS observacao TEXT;");
    await pool.query("ALTER TABLE propostas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();");
    console.log('✅ ensured Comercial entity (comerciais) and compatibility columns on propostas');
  } catch (err) {
    console.warn('⚠️ Could not ensure Comercial entity columns:', err.message || err);
  }
})();
// Ensure planejamento tables have real start/end date columns used by the frontend
(async function ensurePlanejamentoRealDates() {
  try {
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS inicio_real DATE;");
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS termino_real DATE;");
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS is_quick_activity BOOLEAN DEFAULT false;");
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS documento_id INTEGER REFERENCES documentos(id) ON DELETE SET NULL;");
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS etapa VARCHAR(255);");
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS ordem INTEGER;");
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS ordem_por_dia JSONB;");
    await pool.query("ALTER TABLE planejamento_atividades ADD COLUMN IF NOT EXISTS tempo_executado NUMERIC(10,2) DEFAULT 0;");
    await pool.query("ALTER TABLE planejamento_documentos ADD COLUMN IF NOT EXISTS inicio_real DATE;");
    await pool.query("ALTER TABLE planejamento_documentos ADD COLUMN IF NOT EXISTS termino_real DATE;");
    await pool.query("ALTER TABLE planejamento_documentos ADD COLUMN IF NOT EXISTS ordem INTEGER;");
    await pool.query("ALTER TABLE planejamento_documentos ADD COLUMN IF NOT EXISTS ordem_por_dia JSONB;");
    await pool.query("ALTER TABLE planejamento_documentos ADD COLUMN IF NOT EXISTS tempo_executado NUMERIC(10,2) DEFAULT 0;");
    console.log('✅ ensured inicio_real/termino_real/etapa/ordem/tempo_executado on planejamento tables');
  } catch (err) {
    console.warn('⚠️ Could not ensure real date columns for planejamento tables:', err.message || err);
  }
})();
// Ensure optional columns on execucoes (backfill for older DBs and compatibility)
(async function ensureExecucoesColumns() {
  try {
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS planejamento_id INTEGER;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS usuario TEXT;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS inicio TIMESTAMPTZ;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS termino TIMESTAMPTZ;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS status VARCHAR(50);");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS tempo_total NUMERIC(10,2);");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS descritivo TEXT;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS empreendimento_id INTEGER;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS pausado_automaticamente BOOLEAN DEFAULT false;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS tipo_planejamento VARCHAR(50);");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS observacao TEXT;");
    await pool.query("ALTER TABLE execucoes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();");
    console.log('✅ ensured optional columns on execucoes');
  } catch (err) {
    console.warn('⚠️ Could not ensure optional columns for execucoes:', err.message || err);
  }
})();
// Ensure other optional columns on atividades
(async function ensureAtividadesOtherColumns() {
  try {
    await pool.query("ALTER TABLE atividades ADD COLUMN IF NOT EXISTS predecessora VARCHAR(255);");
    await pool.query("ALTER TABLE atividades ADD COLUMN IF NOT EXISTS funcao VARCHAR(255);");
    await pool.query("ALTER TABLE atividades ADD COLUMN IF NOT EXISTS subdisciplina VARCHAR(255);");
    await pool.query("ALTER TABLE atividades ADD COLUMN IF NOT EXISTS tempo NUMERIC(8,2);");
    await pool.query("ALTER TABLE atividades ADD COLUMN IF NOT EXISTS id_atividade VARCHAR(255);");
    console.log('✅ ensured other optional columns on atividades');
  } catch (err) {
    console.warn('⚠️ Could not ensure other optional columns for atividades:', err.message || err);
  }
})();

// Ensure alocacao_equipe table exists (store planned/realizado/reprogramado entries)
(async function ensureAlocacaoTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alocacao_equipe (
        id serial PRIMARY KEY,
        empreendimento_id integer,
        usuario_id integer,
        usuario_email text,
        data date,
        tipo text,
        referencia text,
        label text,
        cor text,
        created_at timestamptz DEFAULT now()
      );
    `);
    console.log('✅ ensured table alocacao_equipe');
  } catch (err) {
    console.warn('⚠️ Could not ensure alocacao_equipe table:', err.message || err);
  }
})();

// Ensure documentos predecessor column exists for dependency sequencing in UI
(async function ensureDocumentosPredecessoraColumn() {
  try {
    await pool.query('ALTER TABLE documentos ADD COLUMN IF NOT EXISTS predecessora_id INTEGER;');
    await pool.query('CREATE INDEX IF NOT EXISTS documentos_predecessora_idx ON documentos(predecessora_id);');
    console.log('✅ ensured predecessora_id on documentos');
  } catch (err) {
    console.warn('⚠️ Could not ensure predecessora_id on documentos:', err.message || err);
  }
})();

(async function ensureChecklistSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS checklists (
        id SERIAL PRIMARY KEY,
      tipo VARCHAR(100),
      cliente VARCHAR(255),
      numero_os VARCHAR(100),
      tecnico_responsavel VARCHAR(255),
      data_entrega DATE,
      periodo_inicio DATE,
      periodo_termino DATE,
      periodos JSONB DEFAULT '[]'::jsonb,
      status VARCHAR(50) DEFAULT 'em_andamento',
      observacoes TEXT,
      etapa VARCHAR(255),
      referencia VARCHAR(255),
      empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    const checklistColumns = [
      'tipo VARCHAR(100)',
      'cliente VARCHAR(255)',
      'numero_os VARCHAR(100)',
      'tecnico_responsavel VARCHAR(255)',
      'data_entrega DATE',
      'periodo_inicio DATE',
      'periodo_termino DATE',
      "periodos JSONB DEFAULT '[]'::jsonb",
      "status VARCHAR(50) DEFAULT 'em_andamento'",
      "observacoes TEXT",
      "etapa VARCHAR(255)",
      "referencia VARCHAR(255)",
      'empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE',
      'created_at TIMESTAMPTZ DEFAULT now()'
    ];
    for (const columnDef of checklistColumns) {
      await pool.query(`ALTER TABLE checklists ADD COLUMN IF NOT EXISTS ${columnDef};`);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS checklist_items (
        id SERIAL PRIMARY KEY,
        checklist_id INTEGER REFERENCES checklists(id) ON DELETE CASCADE,
        secao VARCHAR(255),
        numero_item VARCHAR(100),
        descricao TEXT,
        contribuicao VARCHAR(255),
        tempo VARCHAR(100),
        observacoes TEXT,
        ordem INTEGER DEFAULT 0,
        status_por_periodo JSONB DEFAULT '{}'::jsonb,
        section_id INTEGER REFERENCES checklist_sections(id) ON DELETE CASCADE,
        titulo VARCHAR(255),
        concluido BOOLEAN DEFAULT FALSE,
        responsavel_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    const checklistItemColumns = [
      'checklist_id INTEGER REFERENCES checklists(id) ON DELETE CASCADE',
      'secao VARCHAR(255)',
      'numero_item VARCHAR(100)',
      'descricao TEXT',
      'contribuicao VARCHAR(255)',
      'tempo VARCHAR(100)',
      'observacoes TEXT',
      'conclusao VARCHAR(25)',
      'status VARCHAR(50) DEFAULT \'pendente\'',
      'folhas JSONB DEFAULT \'[]\'::jsonb',
      'ordem INTEGER DEFAULT 0',
      "status_por_periodo JSONB DEFAULT '{}'::jsonb",
      'section_id INTEGER REFERENCES checklist_sections(id) ON DELETE CASCADE',
      'titulo VARCHAR(255)',
      'concluido BOOLEAN DEFAULT FALSE',
      'responsavel_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
      'created_at TIMESTAMPTZ DEFAULT now()'
    ];
    for (const columnDef of checklistItemColumns) {
      await pool.query(`ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS ${columnDef};`);
    }

    console.log('âœ… ensured checklist schema and items');
  } catch (err) {
    console.warn('âš ï¸ Could not ensure checklist schema:', err.message || err);
  }
})();

(async function ensureAtasReuniaoSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS atas_reuniao (
        id SERIAL PRIMARY KEY,
        empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE,
        titulo VARCHAR(255),
        assunto VARCHAR(255),
        local VARCHAR(255),
        data DATE,
        horario VARCHAR(100),
        data_reuniao TIMESTAMPTZ,
        conteudo TEXT,
        participantes JSONB DEFAULT '[]'::jsonb,
        providencias JSONB DEFAULT '[]'::jsonb,
        folha VARCHAR(50),
        rev VARCHAR(50),
        controle VARCHAR(100),
        emissao VARCHAR(100),
        status VARCHAR(50) DEFAULT 'rascunho',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    const columns = [
      "empreendimento_id INTEGER REFERENCES empreendimentos(id) ON DELETE CASCADE",
      "titulo VARCHAR(255)",
      "assunto VARCHAR(255)",
      "local VARCHAR(255)",
      "data DATE",
      "horario VARCHAR(100)",
      "data_reuniao TIMESTAMPTZ",
      "conteudo TEXT",
      "participantes JSONB DEFAULT '[]'::jsonb",
      "providencias JSONB DEFAULT '[]'::jsonb",
      "folha VARCHAR(50)",
      "rev VARCHAR(50)",
      "controle VARCHAR(100)",
      "emissao VARCHAR(100)",
      "status VARCHAR(50) DEFAULT 'rascunho'",
      "created_at TIMESTAMPTZ DEFAULT now()",
      "updated_at TIMESTAMPTZ DEFAULT now()"
    ];

    for (const columnDef of columns) {
      await pool.query(`ALTER TABLE atas_reuniao ADD COLUMN IF NOT EXISTS ${columnDef};`);
    }

    await pool.query(`
      CREATE OR REPLACE FUNCTION update_atas_reuniao_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query('DROP TRIGGER IF EXISTS trigger_update_atas_reuniao_updated_at ON atas_reuniao;');
    await pool.query(`
      CREATE TRIGGER trigger_update_atas_reuniao_updated_at
      BEFORE UPDATE ON atas_reuniao
      FOR EACH ROW
      EXECUTE FUNCTION update_atas_reuniao_updated_at();
    `);

    console.log('âœ… ensured atas_reuniao schema and trigger');
  } catch (err) {
    console.warn('âš ï¸ Could not ensure atas_reuniao schema:', err.message || err);
  }
})();

// Seed default pages from the frontend pages list (idempotent)
async function seedPages() {
  const defaults = [
    { key: 'home', title: 'Início', path: '/' },
    { key: 'analise_concepcao_planejamento', title: 'Análise Concepção Planejamento', path: '/analise-concepcao-planejamento' },
    { key: 'analitico', title: 'Analítico', path: '/analitico' },
    { key: 'ata_planejamento', title: 'Ata Planejamento', path: '/ata-planejamento' },
    { key: 'atividades_rapidas', title: 'Atividades Rápidas', path: '/atividades-rapidas' },
    { key: 'checklist_planejamento', title: 'Checklist Planejamento', path: '/checklist-planejamento' },
    { key: 'comercial', title: 'Comercial', path: '/comercial' },
    { key: 'comercial_detalhes', title: 'Comercial Detalhes', path: '/comercial-detalhes' },
    { key: 'configuracoes', title: 'Configurações', path: '/configuracoes' },
    { key: 'controle_os_global', title: 'Controle OS Global', path: '/controle-os-global' },
    { key: 'dashboard', title: 'Dashboard', path: '/dashboard' },
    { key: 'empreendimento', title: 'Empreendimento', path: '/empreendimento' },
    { key: 'empreendimentos', title: 'Empreendimentos', path: '/empreendimentos' },
    { key: 'orcamentos', title: 'Orçamentos', path: '/orcamentos' },
    { key: 'planejamento', title: 'Planejamento', path: '/planejamento' },
    { key: 'pre', title: 'PRE', path: '/pre' },
    { key: 'propostas', title: 'Propostas', path: '/propostas' },
    { key: 'relatorios', title: 'Relatórios', path: '/relatorios' },
    { key: 'seletor_planejamento', title: 'Seletor Planejamento', path: '/seletor-planejamento' },
    { key: 'usuarios', title: 'Usuários', path: '/usuarios' }
  ];

  try {
    // If there's no pagesModel implemented in this lightweight server, skip seeding.
    if (typeof pagesModel === 'undefined') {
      console.log('pagesModel not available; skipping page seeding');
      return;
    }

    for (let i = 0; i < defaults.length; i++) {
      const p = defaults[i];
      const existing = await pagesModel.getPageByKey(p.key);
      if (!existing) {
        await pagesModel.createPage({ key: p.key, title: p.title, path: p.path, ord: i });
        console.log(`Seeded page: ${p.key}`);
      }
    }
  } catch (err) {
    console.warn('Could not seed pages:', err.message || err);
  }
}

// Try seeding; don't block server start
seedPages();
