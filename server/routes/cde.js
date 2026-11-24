// API do CDE (Ambiente Comum de Dados, ISO 19650), independente de software: cada
// empreendimento tem documentos (de qualquer origem: PDF, DWG, RVT, IFC, planilhas…) com código,
// revisões, estados, arquivos (S3) e emissões (GRD). Todas as rotas exigem login.
const crypto = require('crypto');
const rules = require('../services/cdeRules');
const storage = require('../services/cdeStorage');

const DOC_FIELDS = ['volume', 'nivel', 'tipo', 'disciplina', 'numero'];

/**
 * Registra as rotas. `resolveUser(req)` devolve o usuário da sessão ({ id, name, perfil }) ou null.
 */
function registerCde(app, { pool, resolveUser }) {
  storage.registerLocalRoutes(app);

  const auth = async (req, res, next) => {
    try {
      const user = await resolveUser(req);
      if (!user) return res.status(401).json({ error: 'Faça login para usar o CDE.' });
      req.cdeUser = user;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  const isApprover = (req) => rules.APPROVERS.has(req.cdeUser.perfil);
  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`CDE ${req.method} ${req.path}`, err);
      const status = err.status || (err.code === '23505' ? 409 : 500);
      res.status(status).json({ error: err.code === '23505' ? 'Já existe um documento com este código.' : err.message });
    }
  };
  const fail = (status, message) => Object.assign(new Error(message), { status });

  async function config(empId, db = pool) {
    const r = await db.query('SELECT projeto, originador, volume FROM cde_config WHERE empreendimento_id = $1', [empId]);
    return r.rows[0] || { projeto: '', originador: '', volume: 'ZZ' };
  }
  async function loadDoc(id, db = pool, lock = false) {
    const r = await db.query(`SELECT * FROM cde_documentos WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!r.rows[0]) throw fail(404, 'Documento não encontrado.');
    return r.rows[0];
  }
  async function events(docId, db = pool) {
    return (await db.query('SELECT * FROM cde_eventos WHERE documento_id = $1 ORDER BY id', [docId])).rows;
  }
  const withCode = (cfg, d) => ({ ...d, codigo: rules.docCode(cfg, d), tamanho: d.tamanho == null ? null : Number(d.tamanho) });
  const empOf = (raw) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw fail(400, 'Empreendimento inválido.');
    return id;
  };

  /** Muda o estado de um documento (já travado na transação) e registra o evento. */
  async function applyState(db, doc, { estado, finalidade, descricao }, user) {
    const fin = finalidade || rules.SUITABILITY[estado]?.[0]?.code;
    const err = rules.stateChangeError(doc, estado, fin, user.perfil);
    if (err) throw fail(400, err);
    const evs = await events(doc.id, db);
    const revisao = rules.revisionForState(doc, estado, evs);
    await db.query(
      `INSERT INTO cde_eventos (documento_id, tipo, revisao, estado, finalidade, descricao, arquivo_key, arquivo_nome, tamanho, content_type, autor_id, autor_nome)
       VALUES ($1, 'estado', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [doc.id, revisao, estado, fin, descricao || null, doc.arquivo_key, doc.arquivo_nome, doc.tamanho, doc.content_type, String(user.id), user.name || user.email || null],
    );
    const r = await db.query('UPDATE cde_documentos SET revisao = $2, estado = $3, finalidade = $4, updated_at = now() WHERE id = $1 RETURNING *', [doc.id, revisao, estado, fin]);
    return r.rows[0];
  }

  // ---- Visão geral do empreendimento ------------------------------------------------------------
  app.get('/api/cde/:empId', auth, wrap(async (req, res) => {
    const empId = empOf(req.params.empId);
    const cfg = await config(empId);
    const docs = (await pool.query('SELECT * FROM cde_documentos WHERE empreendimento_id = $1 ORDER BY tipo, disciplina, nivel, numero', [empId])).rows;
    const emissoes = (await pool.query('SELECT * FROM cde_emissoes WHERE empreendimento_id = $1 ORDER BY id DESC', [empId])).rows;
    res.json({
      config: cfg,
      documentos: docs.map((d) => withCode(cfg, d)),
      emissoes,
      podeAprovar: isApprover(req),
      armazenamento: storage.s3Configured() ? 's3' : 'local',
      estados: rules.STATE_LABEL,
      finalidades: rules.SUITABILITY,
    });
  }));

  app.patch('/api/cde/:empId/config', auth, wrap(async (req, res) => {
    const empId = empOf(req.params.empId);
    if (!isApprover(req)) throw fail(403, 'Só coordenação, gestão, liderança, direção ou administrador alteram a codificação.');
    const { projeto = '', originador = '', volume = 'ZZ' } = req.body || {};
    const r = await pool.query(
      `INSERT INTO cde_config (empreendimento_id, projeto, originador, volume) VALUES ($1, $2, $3, $4)
       ON CONFLICT (empreendimento_id) DO UPDATE SET projeto = $2, originador = $3, volume = $4, updated_at = now()
       RETURNING projeto, originador, volume`,
      [empId, rules.codeField(projeto, ''), rules.codeField(originador, ''), rules.codeField(volume, 'ZZ')],
    );
    res.json(r.rows[0]);
  }));

  // ---- Documentos --------------------------------------------------------------------------------
  app.post('/api/cde/:empId/documentos', auth, wrap(async (req, res) => {
    const empId = empOf(req.params.empId);
    const b = req.body || {};
    if (!String(b.titulo || '').trim()) throw fail(400, 'Informe o título do documento.');
    const f = {
      volume: b.volume ? rules.codeField(b.volume, '') : '',
      nivel: rules.codeField(b.nivel, 'ZZ'),
      tipo: rules.codeField(b.tipo, 'DR'),
      disciplina: rules.codeField(b.disciplina, 'ZZ'),
    };
    let numero = b.numero ? rules.padNumber(b.numero) : null;
    if (!numero) {
      // Próximo número da mesma série (tipo e disciplina).
      const r = await pool.query('SELECT numero FROM cde_documentos WHERE empreendimento_id = $1 AND tipo = $2 AND disciplina = $3', [empId, f.tipo, f.disciplina]);
      numero = rules.padNumber(r.rows.reduce((m, x) => Math.max(m, Number(x.numero) || 0), 0) + 1);
    }
    const r = await pool.query(
      `INSERT INTO cde_documentos (empreendimento_id, volume, nivel, tipo, disciplina, numero, titulo, origem, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [empId, f.volume, f.nivel, f.tipo, f.disciplina, numero, String(b.titulo).trim(), String(b.origem || 'web').slice(0, 30), req.cdeUser.name || String(req.cdeUser.id)],
    );
    res.status(201).json(withCode(await config(empId), r.rows[0]));
  }));

  app.patch('/api/cde/documentos/:id', auth, wrap(async (req, res) => {
    const doc = await loadDoc(req.params.id);
    const b = req.body || {};
    const touchesCode = DOC_FIELDS.some((k) => b[k] != null && String(b[k]) !== String(doc[k]));
    if (touchesCode && (await events(doc.id)).some((e) => e.tipo === 'estado' && e.estado !== 'andamento') && !isApprover(req))
      throw fail(403, 'O documento já foi emitido: só a coordenação pode mudar o código.');
    const next = {
      titulo: b.titulo != null ? String(b.titulo).trim() || doc.titulo : doc.titulo,
      volume: b.volume != null ? rules.codeField(b.volume, '') : doc.volume,
      nivel: b.nivel != null ? rules.codeField(b.nivel, 'ZZ') : doc.nivel,
      tipo: b.tipo != null ? rules.codeField(b.tipo, 'DR') : doc.tipo,
      disciplina: b.disciplina != null ? rules.codeField(b.disciplina, 'ZZ') : doc.disciplina,
      numero: b.numero != null ? rules.padNumber(b.numero) : doc.numero,
    };
    const r = await pool.query(
      'UPDATE cde_documentos SET titulo = $2, volume = $3, nivel = $4, tipo = $5, disciplina = $6, numero = $7, updated_at = now() WHERE id = $1 RETURNING *',
      [doc.id, next.titulo, next.volume, next.nivel, next.tipo, next.disciplina, next.numero],
    );
    res.json(withCode(await config(doc.empreendimento_id), r.rows[0]));
  }));

  app.delete('/api/cde/documentos/:id', auth, wrap(async (req, res) => {
    const doc = await loadDoc(req.params.id);
    if (!isApprover(req)) throw fail(403, 'Só a coordenação exclui documentos.');
    if ((await events(doc.id)).some((e) => e.tipo === 'estado' && e.estado !== 'andamento')) throw fail(400, 'Documento já emitido: arquive em vez de excluir (o histórico fica).');
    await pool.query('DELETE FROM cde_documentos WHERE id = $1', [doc.id]);
    res.status(204).end();
  }));

  app.get('/api/cde/documentos/:id/eventos', auth, wrap(async (req, res) => {
    const doc = await loadDoc(req.params.id);
    res.json((await events(doc.id)).reverse());
  }));

  // ---- Arquivos ----------------------------------------------------------------------------------
  /** 1) Pede a URL de envio (o arquivo vai direto para o S3). */
  app.post('/api/cde/documentos/:id/upload', auth, wrap(async (req, res) => {
    const doc = await loadDoc(req.params.id);
    if (doc.estado === 'arquivado') throw fail(400, 'Documento arquivado.');
    const nome = rules.safeFileName(req.body?.nome);
    const key = `cde/${doc.empreendimento_id}/${doc.id}/${crypto.randomUUID()}/${nome}`;
    const up = await storage.uploadUrl(key, req.body?.content_type, baseUrl(req));
    res.json({ key, ...up });
  }));

  /** 2) Confirma o envio: registra a versão (nova revisão se a atual já tiver saído). */
  app.post('/api/cde/documentos/:id/arquivo', auth, wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const doc = await loadDoc(req.params.id, client, true);
      const b = req.body || {};
      if (!String(b.key || '').startsWith(`cde/${doc.empreendimento_id}/${doc.id}/`)) throw fail(400, 'Arquivo não pertence a este documento.');
      const size = await storage.stat(b.key);
      if (size == null) throw fail(400, 'O arquivo não chegou ao armazenamento. Envie de novo.');
      const revisao = rules.revisionForUpload(doc, await events(doc.id, client));
      const nome = String(b.nome || b.key.split('/').pop()).slice(0, 255);
      await client.query(
        `INSERT INTO cde_eventos (documento_id, tipo, revisao, estado, finalidade, descricao, arquivo_key, arquivo_nome, tamanho, content_type, sha256, autor_id, autor_nome)
         VALUES ($1, 'arquivo', $2, 'andamento', 'S0', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [doc.id, revisao, b.descricao || null, b.key, nome, size, b.content_type || null, b.sha256 || null, String(req.cdeUser.id), req.cdeUser.name || null],
      );
      const r = await client.query(
        `UPDATE cde_documentos SET revisao = $2, estado = 'andamento', finalidade = 'S0', arquivo_key = $3, arquivo_nome = $4, tamanho = $5, content_type = $6, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [doc.id, revisao, b.key, nome, size, b.content_type || null],
      );
      await client.query('COMMIT');
      res.json(withCode(await config(doc.empreendimento_id), r.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  /** URL de download: do arquivo atual ou de um evento do histórico (?evento=ID). */
  app.get('/api/cde/documentos/:id/download', auth, wrap(async (req, res) => {
    const doc = await loadDoc(req.params.id);
    let key = doc.arquivo_key;
    let rev = doc.revisao;
    let ext = (doc.arquivo_nome || '').includes('.') ? doc.arquivo_nome.split('.').pop() : 'bin';
    if (req.query.evento) {
      const ev = (await pool.query('SELECT * FROM cde_eventos WHERE id = $1 AND documento_id = $2', [req.query.evento, doc.id])).rows[0];
      if (!ev?.arquivo_key) throw fail(404, 'Versão sem arquivo.');
      key = ev.arquivo_key;
      rev = ev.revisao;
      ext = (ev.arquivo_nome || '').includes('.') ? ev.arquivo_nome.split('.').pop() : ext;
    }
    if (!key) throw fail(404, 'Documento ainda sem arquivo.');
    // Nome padronizado: código_revisão.extensão.
    const name = `${rules.docCode(await config(doc.empreendimento_id), doc)}_${rev}.${ext}`;
    res.json({ url: await storage.downloadUrl(key, name, baseUrl(req)), nome: name });
  }));

  // ---- Estados -----------------------------------------------------------------------------------
  app.post('/api/cde/documentos/:id/estado', auth, wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const doc = await loadDoc(req.params.id, client, true);
      const updated = await applyState(client, doc, req.body || {}, req.cdeUser);
      await client.query('COMMIT');
      res.json(withCode(await config(doc.empreendimento_id), updated));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  // ---- Emissões (GRD) ----------------------------------------------------------------------------
  app.post('/api/cde/:empId/emissoes', auth, wrap(async (req, res) => {
    const empId = empOf(req.params.empId);
    const b = req.body || {};
    const ids = Array.isArray(b.documento_ids) ? b.documento_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) throw fail(400, 'Escolha os documentos da emissão.');
    if (!['compartilhado', 'publicado'].includes(b.estado)) throw fail(400, 'Emissão é para compartilhar ou publicar.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Numeração sem repetição entre emissões simultâneas do mesmo empreendimento.
      await client.query('SELECT pg_advisory_xact_lock($1)', [empId]);
      const cfg = await config(empId, client);
      const numero = rules.nextEmissionNumber((await client.query('SELECT numero FROM cde_emissoes WHERE empreendimento_id = $1', [empId])).rows.map((r) => r.numero));
      const itens = [];
      for (const id of ids) {
        const doc = await loadDoc(id, client, true);
        if (doc.empreendimento_id !== empId) throw fail(400, 'Documento de outro empreendimento.');
        const d = await applyState(client, doc, { estado: b.estado, finalidade: b.finalidade, descricao: `Emissão ${numero}${b.observacoes ? `: ${b.observacoes}` : ''}` }, req.cdeUser);
        itens.push({ documento_id: d.id, codigo: rules.docCode(cfg, d), titulo: d.titulo, revisao: d.revisao, estado: d.estado, finalidade: d.finalidade, arquivo: d.arquivo_nome });
      }
      const fin = b.finalidade || rules.SUITABILITY[b.estado][0].code;
      const r = await client.query(
        `INSERT INTO cde_emissoes (empreendimento_id, numero, destinatario, finalidade, observacoes, autor_nome, itens)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [empId, numero, b.destinatario || null, fin, b.observacoes || null, req.cdeUser.name || null, JSON.stringify(itens)],
      );
      await client.query('COMMIT');
      res.status(201).json(r.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));
}

module.exports = { registerCde };
