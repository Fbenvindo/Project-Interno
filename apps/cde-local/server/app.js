// Servidor do CDE local (ISO 19650): API (usuários, empreendimentos, documentos, arquivos,
// estados e GRDs) e a interface web, servidos por um computador da rede do escritório.
// A API do CDE tem o mesmo formato da versão em nuvem, para o SmartEasyBIM usar as duas.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const rules = require('./rules');
const auth = require('./auth');
const { openDb } = require('./db');
const { createStorage } = require('./storage');
const { createClash } = require('./clash');
const { createGestao } = require('./gestao');
const { createClashV2 } = require('./clash/v2');

const DOC_FIELDS = ['volume', 'nivel', 'tipo', 'disciplina', 'numero'];
const VERSION = require('../package.json').version;

const isLoopback = (req) => /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(req.socket.remoteAddress || '');

/**
 * Cria o servidor. `dataDir`: pasta do banco e dos arquivos. `webDir`: interface web compilada.
 * Devolve { app, db, storage, clash, gestao }.
 */
async function createApp({ dataDir, webDir = path.join(__dirname, '..', 'web-dist') }) {
  const db = await openDb(dataDir);
  const storage = createStorage(dataDir, auth.secretOf(db));
  const app = express();
  app.disable('x-powered-by');

  // O SmartEasyBIM (e o navegador em desenvolvimento) chamam de outra origem; sessão é por token, sem cookies.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  storage.register(app); // antes do JSON: o PUT do arquivo é o corpo bruto
  app.use(express.json({ limit: '2mb' }));

  const fail = (status, message) => Object.assign(new Error(message), { status });
  const wrap = (fn) => (req, res) => {
    try {
      const r = fn(req, res);
      if (r && typeof r.then === 'function') r.catch((err) => sendError(req, res, err));
    } catch (err) {
      sendError(req, res, err);
    }
  };
  function sendError(req, res, err) {
    const unique = /UNIQUE constraint failed/.test(err.message || '');
    if (!err.status && !unique) console.error(`CDE ${req.method} ${req.path}`, err);
    res.status(err.status || (unique ? 409 : 500)).json({ error: unique ? 'Já existe um registro com esses dados (código ou e-mail repetido).' : err.message });
  }
  const login = (req, res, next) => {
    const h = req.get('authorization') || '';
    const user = auth.userFromToken(db, h.startsWith('Bearer ') ? h.slice(7) : null);
    if (!user) return res.status(401).json({ error: 'Faça login para usar o CDE.' });
    req.cdeUser = user;
    next();
  };
  const isApprover = (req) => rules.APPROVERS.has(req.cdeUser.perfil);
  const adminOnly = (req) => {
    if (req.cdeUser.perfil !== 'admin') throw fail(403, 'Só o administrador gerencia usuários.');
  };
  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
  const hasUsers = () => !!db.get('SELECT 1 AS x FROM usuarios LIMIT 1');

  // ---- Situação, primeira configuração e login --------------------------------------------------
  app.get('/api/status', (req, res) => {
    res.json({ app: 'SmartEasyBIM CDE', versao: VERSION, configurado: hasUsers(), nome: db.setting('nome') || 'CDE' });
  });

  /** Cria o primeiro administrador. Só no próprio computador do servidor e só enquanto não há usuários. */
  app.post('/api/setup', wrap((req, res) => {
    if (hasUsers()) throw fail(400, 'O CDE já foi configurado.');
    if (!isLoopback(req)) throw fail(403, 'A primeira configuração é feita no próprio computador do servidor.');
    const { nome, email, senha, empresa } = req.body || {};
    if (!String(nome || '').trim() || !/.+@.+/.test(String(email || '')) || String(senha || '').length < 6)
      throw fail(400, 'Informe nome, e-mail e uma senha com pelo menos 6 caracteres.');
    const { id } = db.run('INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, ?)', [String(nome).trim(), String(email).trim(), auth.hashPassword(senha), 'admin']);
    if (empresa) db.setting('nome', String(empresa).trim());
    res.status(201).json({ token: auth.issueToken(db, id), user: auth.publicUser(db.get('SELECT * FROM usuarios WHERE id = ?', [id])) });
  }));

  app.post('/api/auth/login', wrap((req, res) => {
    const { email, password, senha } = req.body || {};
    const u = db.get('SELECT * FROM usuarios WHERE email = ?', [String(email || '').trim()]);
    if (!u || !u.ativo || !auth.checkPassword(password ?? senha, u.senha)) throw fail(401, 'E-mail ou senha incorretos.');
    res.json({ token: auth.issueToken(db, u.id), user: auth.publicUser(u) });
  }));
  app.get('/api/auth/me', login, (req, res) => res.json(req.cdeUser));
  app.post('/api/auth/senha', login, wrap((req, res) => {
    const { atual, nova } = req.body || {};
    const u = db.get('SELECT * FROM usuarios WHERE id = ?', [req.cdeUser.id]);
    if (!auth.checkPassword(atual, u.senha)) throw fail(400, 'Senha atual incorreta.');
    if (String(nova || '').length < 6) throw fail(400, 'A nova senha precisa de pelo menos 6 caracteres.');
    db.run('UPDATE usuarios SET senha = ? WHERE id = ?', [auth.hashPassword(nova), u.id]);
    res.json({ ok: true });
  }));

  // ---- Usuários (administrador) -----------------------------------------------------------------
  app.get('/api/usuarios', login, wrap((req, res) => {
    adminOnly(req);
    res.json(db.all('SELECT * FROM usuarios ORDER BY nome').map(auth.publicUser));
  }));
  app.post('/api/usuarios', login, wrap((req, res) => {
    adminOnly(req);
    const { nome, email, senha, perfil = 'colaborador' } = req.body || {};
    if (!String(nome || '').trim() || !/.+@.+/.test(String(email || ''))) throw fail(400, 'Informe nome e e-mail.');
    if (String(senha || '').length < 6) throw fail(400, 'A senha precisa de pelo menos 6 caracteres.');
    if (!auth.PERFIS.includes(perfil)) throw fail(400, 'Perfil inválido.');
    const { id } = db.run('INSERT INTO usuarios (nome, email, senha, perfil) VALUES (?, ?, ?, ?)', [String(nome).trim(), String(email).trim(), auth.hashPassword(senha), perfil]);
    res.status(201).json(auth.publicUser(db.get('SELECT * FROM usuarios WHERE id = ?', [id])));
  }));
  app.patch('/api/usuarios/:id', login, wrap((req, res) => {
    adminOnly(req);
    const u = db.get('SELECT * FROM usuarios WHERE id = ?', [Number(req.params.id)]);
    if (!u) throw fail(404, 'Usuário não encontrado.');
    const b = req.body || {};
    const next = {
      nome: b.nome != null ? String(b.nome).trim() || u.nome : u.nome,
      perfil: b.perfil != null ? b.perfil : u.perfil,
      ativo: b.ativo != null ? (b.ativo ? 1 : 0) : u.ativo,
    };
    if (!auth.PERFIS.includes(next.perfil)) throw fail(400, 'Perfil inválido.');
    const losesAdmin = u.perfil === 'admin' && (next.perfil !== 'admin' || !next.ativo);
    if (losesAdmin && db.get("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND ativo = 1").n <= 1)
      throw fail(400, 'É preciso manter pelo menos um administrador ativo.');
    db.run('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?', [next.nome, next.perfil, next.ativo, u.id]);
    if (b.senha) {
      if (String(b.senha).length < 6) throw fail(400, 'A senha precisa de pelo menos 6 caracteres.');
      db.run('UPDATE usuarios SET senha = ? WHERE id = ?', [auth.hashPassword(b.senha), u.id]);
    }
    res.json(auth.publicUser(db.get('SELECT * FROM usuarios WHERE id = ?', [u.id])));
  }));

  // ---- Empreendimentos ----------------------------------------------------------------------------
  const empOf = (raw) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || !db.get('SELECT 1 AS x FROM empreendimentos WHERE id = ?', [id])) throw fail(404, 'Empreendimento não encontrado.');
    return id;
  };
  app.get('/api/empreendimentos', login, wrap((req, res) => {
    res.json(
      db.all(
        `SELECT e.*, (SELECT COUNT(*) FROM cde_documentos d WHERE d.empreendimento_id = e.id) AS documentos
         FROM empreendimentos e ORDER BY e.status = 'ativo' DESC, e.nome`,
      ),
    );
  }));
  app.post('/api/empreendimentos', login, wrap((req, res) => {
    if (!isApprover(req)) throw fail(403, 'Só a coordenação ou o administrador criam empreendimentos.');
    const { nome, cliente } = req.body || {};
    if (!String(nome || '').trim()) throw fail(400, 'Informe o nome do empreendimento.');
    const { id } = db.run('INSERT INTO empreendimentos (nome, cliente) VALUES (?, ?)', [String(nome).trim(), cliente ? String(cliente).trim() : null]);
    res.status(201).json(db.get('SELECT * FROM empreendimentos WHERE id = ?', [id]));
  }));
  app.patch('/api/empreendimentos/:id', login, wrap((req, res) => {
    if (!isApprover(req)) throw fail(403, 'Só a coordenação ou o administrador alteram empreendimentos.');
    const id = empOf(req.params.id);
    const e = db.get('SELECT * FROM empreendimentos WHERE id = ?', [id]);
    const b = req.body || {};
    db.run('UPDATE empreendimentos SET nome = ?, cliente = ?, status = ? WHERE id = ?', [
      b.nome != null ? String(b.nome).trim() || e.nome : e.nome,
      b.cliente != null ? String(b.cliente).trim() : e.cliente,
      b.status === 'concluido' || b.status === 'ativo' ? b.status : e.status,
      id,
    ]);
    res.json(db.get('SELECT * FROM empreendimentos WHERE id = ?', [id]));
  }));

  // ---- CDE: visão geral e codificação ----------------------------------------------------------------
  const config = (empId) => db.get('SELECT projeto, originador, volume FROM cde_config WHERE empreendimento_id = ?', [empId]) || { projeto: '', originador: '', volume: 'ZZ' };
  const loadDoc = (id) => {
    const d = db.get('SELECT * FROM cde_documentos WHERE id = ?', [Number(id)]);
    if (!d) throw fail(404, 'Documento não encontrado.');
    return d;
  };
  const events = (docId) => db.all('SELECT * FROM cde_eventos WHERE documento_id = ? ORDER BY id', [docId]);
  const withCode = (cfg, d) => ({ ...d, codigo: rules.docCode(cfg, d) });
  const now = () => new Date().toISOString();

  /** Muda o estado de um documento (dentro de uma transação) e registra o evento. */
  function applyState(doc, { estado, finalidade, descricao }, user) {
    const fin = finalidade || rules.SUITABILITY[estado]?.[0]?.code;
    const err = rules.stateChangeError(doc, estado, fin, user.perfil);
    if (err) throw fail(400, err);
    const revisao = rules.revisionForState(doc, estado, events(doc.id));
    db.run(
      `INSERT INTO cde_eventos (documento_id, tipo, revisao, estado, finalidade, descricao, arquivo_key, arquivo_nome, tamanho, content_type, autor_id, autor_nome)
       VALUES (?, 'estado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [doc.id, revisao, estado, fin, descricao || null, doc.arquivo_key, doc.arquivo_nome, doc.tamanho, doc.content_type, String(user.id), user.name || user.email || null],
    );
    db.run('UPDATE cde_documentos SET revisao = ?, estado = ?, finalidade = ?, updated_at = ? WHERE id = ?', [revisao, estado, fin, now(), doc.id]);
    return loadDoc(doc.id);
  }

  app.get('/api/cde/:empId', login, wrap((req, res) => {
    const empId = empOf(req.params.empId);
    const cfg = config(empId);
    const docs = db.all('SELECT * FROM cde_documentos WHERE empreendimento_id = ? ORDER BY tipo, disciplina, nivel, numero', [empId]);
    const emissoes = db.all('SELECT * FROM cde_emissoes WHERE empreendimento_id = ? ORDER BY id DESC', [empId]).map((e) => ({ ...e, itens: JSON.parse(e.itens || '[]') }));
    res.json({
      empreendimento: db.get('SELECT * FROM empreendimentos WHERE id = ?', [empId]),
      config: cfg,
      documentos: docs.map((d) => withCode(cfg, d)),
      emissoes,
      podeAprovar: isApprover(req),
      armazenamento: 'local',
      estados: rules.STATE_LABEL,
      finalidades: rules.SUITABILITY,
    });
  }));

  app.patch('/api/cde/:empId/config', login, wrap((req, res) => {
    const empId = empOf(req.params.empId);
    if (!isApprover(req)) throw fail(403, 'Só a coordenação ou o administrador alteram a codificação.');
    const { projeto = '', originador = '', volume = 'ZZ' } = req.body || {};
    db.run(
      `INSERT INTO cde_config (empreendimento_id, projeto, originador, volume, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(empreendimento_id) DO UPDATE SET projeto = excluded.projeto, originador = excluded.originador, volume = excluded.volume, updated_at = excluded.updated_at`,
      [empId, rules.codeField(projeto, ''), rules.codeField(originador, ''), rules.codeField(volume, 'ZZ'), now()],
    );
    res.json(config(empId));
  }));

  // ---- Documentos ------------------------------------------------------------------------------------
  app.post('/api/cde/:empId/documentos', login, wrap((req, res) => {
    const empId = empOf(req.params.empId);
    const b = req.body || {};
    if (!String(b.titulo || '').trim()) throw fail(400, 'Informe o título do documento.');
    const f = {
      volume: b.volume ? rules.codeField(b.volume, '') : '',
      nivel: rules.codeField(b.nivel, 'ZZ'),
      tipo: rules.codeField(b.tipo, 'DR'),
      disciplina: rules.codeField(b.disciplina, 'ZZ'),
    };
    const doc = db.tx(() => {
      let numero = b.numero ? rules.padNumber(b.numero) : null;
      if (!numero) {
        // Próximo número da mesma série (tipo e disciplina).
        const rows = db.all('SELECT numero FROM cde_documentos WHERE empreendimento_id = ? AND tipo = ? AND disciplina = ?', [empId, f.tipo, f.disciplina]);
        numero = rules.padNumber(rows.reduce((m, x) => Math.max(m, Number(x.numero) || 0), 0) + 1);
      }
      const { id } = db.run(
        `INSERT INTO cde_documentos (empreendimento_id, volume, nivel, tipo, disciplina, numero, titulo, origem, criado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empId, f.volume, f.nivel, f.tipo, f.disciplina, numero, String(b.titulo).trim(), String(b.origem || 'web').slice(0, 30), req.cdeUser.name || String(req.cdeUser.id)],
      );
      return loadDoc(id);
    });
    res.status(201).json(withCode(config(empId), doc));
  }));

  app.patch('/api/cde/documentos/:id', login, wrap((req, res) => {
    const doc = loadDoc(req.params.id);
    const b = req.body || {};
    const touchesCode = DOC_FIELDS.some((k) => b[k] != null && String(b[k]) !== String(doc[k]));
    if (touchesCode && events(doc.id).some((e) => e.tipo === 'estado' && e.estado !== 'andamento') && !isApprover(req))
      throw fail(403, 'O documento já foi emitido: só a coordenação pode mudar o código.');
    db.run('UPDATE cde_documentos SET titulo = ?, volume = ?, nivel = ?, tipo = ?, disciplina = ?, numero = ?, updated_at = ? WHERE id = ?', [
      b.titulo != null ? String(b.titulo).trim() || doc.titulo : doc.titulo,
      b.volume != null ? rules.codeField(b.volume, '') : doc.volume,
      b.nivel != null ? rules.codeField(b.nivel, 'ZZ') : doc.nivel,
      b.tipo != null ? rules.codeField(b.tipo, 'DR') : doc.tipo,
      b.disciplina != null ? rules.codeField(b.disciplina, 'ZZ') : doc.disciplina,
      b.numero != null ? rules.padNumber(b.numero) : doc.numero,
      now(),
      doc.id,
    ]);
    res.json(withCode(config(doc.empreendimento_id), loadDoc(doc.id)));
  }));

  app.delete('/api/cde/documentos/:id', login, wrap((req, res) => {
    const doc = loadDoc(req.params.id);
    if (!isApprover(req)) throw fail(403, 'Só a coordenação exclui documentos.');
    if (events(doc.id).some((e) => e.tipo === 'estado' && e.estado !== 'andamento')) throw fail(400, 'Documento já emitido: arquive em vez de excluir (o histórico fica).');
    db.run('DELETE FROM cde_eventos WHERE documento_id = ?', [doc.id]);
    db.run('DELETE FROM cde_documentos WHERE id = ?', [doc.id]);
    res.status(204).end();
  }));

  app.get('/api/cde/documentos/:id/eventos', login, wrap((req, res) => {
    const doc = loadDoc(req.params.id);
    res.json(events(doc.id).reverse());
  }));

  // ---- Arquivos ----------------------------------------------------------------------------------------
  /** 1) Pede o link de envio. */
  app.post('/api/cde/documentos/:id/upload', login, wrap((req, res) => {
    const doc = loadDoc(req.params.id);
    if (doc.estado === 'arquivado') throw fail(400, 'Documento arquivado.');
    const nome = rules.safeFileName(req.body?.nome);
    const key = `cde/${doc.empreendimento_id}/${doc.id}/${crypto.randomUUID()}/${nome}`;
    res.json({ key, ...storage.uploadUrl(key, baseUrl(req)) });
  }));

  /** 2) Confirma o envio: registra a versão (nova revisão se a atual já tiver saído). */
  app.post('/api/cde/documentos/:id/arquivo', login, wrap((req, res) => {
    const b = req.body || {};
    const doc = db.tx(() => {
      const d = loadDoc(req.params.id);
      if (!String(b.key || '').startsWith(`cde/${d.empreendimento_id}/${d.id}/`)) throw fail(400, 'Arquivo não pertence a este documento.');
      const size = storage.stat(b.key);
      if (size == null) throw fail(400, 'O arquivo não chegou ao servidor. Envie de novo.');
      const revisao = rules.revisionForUpload(d, events(d.id));
      const nome = String(b.nome || b.key.split('/').pop()).slice(0, 255);
      db.run(
        `INSERT INTO cde_eventos (documento_id, tipo, revisao, estado, finalidade, descricao, arquivo_key, arquivo_nome, tamanho, content_type, sha256, autor_id, autor_nome)
         VALUES (?, 'arquivo', ?, 'andamento', 'S0', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.id, revisao, b.descricao || null, b.key, nome, size, b.content_type || null, b.sha256 || null, String(req.cdeUser.id), req.cdeUser.name || null],
      );
      db.run(
        `UPDATE cde_documentos SET revisao = ?, estado = 'andamento', finalidade = 'S0', arquivo_key = ?, arquivo_nome = ?, tamanho = ?, content_type = ?, updated_at = ? WHERE id = ?`,
        [revisao, b.key, nome, size, b.content_type || null, now(), d.id],
      );
      return loadDoc(d.id);
    });
    res.json(withCode(config(doc.empreendimento_id), doc));
    setImmediate(() => clash.onDocumentChanged(doc.id));
  }));

  /** Link de download: do arquivo atual ou de um evento do histórico (?evento=ID). */
  app.get('/api/cde/documentos/:id/download', login, wrap((req, res) => {
    const doc = loadDoc(req.params.id);
    let key = doc.arquivo_key;
    let rev = doc.revisao;
    let ext = (doc.arquivo_nome || '').includes('.') ? doc.arquivo_nome.split('.').pop() : 'bin';
    if (req.query.evento) {
      const ev = db.get('SELECT * FROM cde_eventos WHERE id = ? AND documento_id = ?', [Number(req.query.evento), doc.id]);
      if (!ev?.arquivo_key) throw fail(404, 'Versão sem arquivo.');
      key = ev.arquivo_key;
      rev = ev.revisao;
      ext = (ev.arquivo_nome || '').includes('.') ? ev.arquivo_nome.split('.').pop() : ext;
    }
    if (!key) throw fail(404, 'Documento ainda sem arquivo.');
    // Nome padronizado: código_revisão.extensão.
    const name = `${rules.docCode(config(doc.empreendimento_id), doc)}_${rev}.${ext}`;
    res.json({ url: storage.downloadUrl(key, name, baseUrl(req)), nome: name });
  }));

  // ---- Estados e emissões (GRD) -------------------------------------------------------------------------
  app.post('/api/cde/documentos/:id/estado', login, wrap((req, res) => {
    const doc = db.tx(() => applyState(loadDoc(req.params.id), req.body || {}, req.cdeUser));
    res.json(withCode(config(doc.empreendimento_id), doc));
    setImmediate(() => clash.onDocumentChanged(doc.id));
  }));

  app.post('/api/cde/:empId/emissoes', login, wrap((req, res) => {
    const empId = empOf(req.params.empId);
    const b = req.body || {};
    const ids = Array.isArray(b.documento_ids) ? b.documento_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) throw fail(400, 'Escolha os documentos da emissão.');
    if (!['compartilhado', 'publicado'].includes(b.estado)) throw fail(400, 'Emissão é para compartilhar ou publicar.');
    const emissao = db.tx(() => {
      const cfg = config(empId);
      const numero = rules.nextEmissionNumber(db.all('SELECT numero FROM cde_emissoes WHERE empreendimento_id = ?', [empId]).map((r) => r.numero));
      const itens = ids.map((id) => {
        const doc = loadDoc(id);
        if (doc.empreendimento_id !== empId) throw fail(400, 'Documento de outro empreendimento.');
        const d = applyState(doc, { estado: b.estado, finalidade: b.finalidade, descricao: `Emissão ${numero}${b.observacoes ? `: ${b.observacoes}` : ''}` }, req.cdeUser);
        return { documento_id: d.id, codigo: rules.docCode(cfg, d), titulo: d.titulo, revisao: d.revisao, estado: d.estado, finalidade: d.finalidade, arquivo: d.arquivo_nome };
      });
      const fin = b.finalidade || rules.SUITABILITY[b.estado][0].code;
      const { id } = db.run(
        'INSERT INTO cde_emissoes (empreendimento_id, numero, destinatario, finalidade, observacoes, autor_nome, itens) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [empId, numero, b.destinatario || null, fin, b.observacoes || null, req.cdeUser.name || null, JSON.stringify(itens)],
      );
      const e = db.get('SELECT * FROM cde_emissoes WHERE id = ?', [id]);
      return { ...e, itens };
    });
    res.status(201).json(emissao);
    setImmediate(() => ids.forEach((id) => clash.onDocumentChanged(id)));
  }));

  // ---- SmartEasyWEB (servidor como cofre de arquivos dos empreendimentos) -------------------------
  const gestao = createGestao({ app, db, dataDir });
  const clashV2 = createClashV2({ app, db, dataDir, gestao });

  // ---- Interferências (clash) -------------------------------------------------------------------
  const clash = createClash({ app, db, storage, dataDir, rules, login, wrap, fail, isApprover, config, empOf });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  // ---- Interface web ----------------------------------------------------------------------------------
  if (fs.existsSync(webDir)) {
    app.use(express.static(webDir, { index: 'index.html' }));
    app.get('*', (req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  return { app, db, storage, clash, gestao, clashV2 };
}

module.exports = { createApp, VERSION };
