// Análise de interferências (clash) do CDE: análises por empreendimento entre modelos IFC do CDE
// (última revisão emitida de cada um, ou a atual), processadas uma de cada vez numa thread
// separada; as interferências viram pendências com estado, responsável e comentário.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const ESTADOS = { nova: 'Nova', ativa: 'Ativa (em tratamento)', resolvida: 'Resolvida', aprovada: 'Aprovada (aceita como está)' };
const IGNORAR_PADRAO = ['IFCSPACE', 'IFCOPENINGELEMENT', 'IFCANNOTATION', 'IFCFURNISHINGELEMENT', 'IFCCOVERING'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clash_analises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empreendimento_id INTEGER NOT NULL REFERENCES empreendimentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  config TEXT NOT NULL,
  modelos TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'fila',
  progresso REAL NOT NULL DEFAULT 0,
  mensagem TEXT,
  erro TEXT,
  resumo TEXT,
  origem TEXT,
  criado_por TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  concluida_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clash_analises_emp ON clash_analises (empreendimento_id, id);
CREATE TABLE IF NOT EXISTS clash_interferencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analise_id INTEGER NOT NULL REFERENCES clash_analises(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  grupo INTEGER,
  grupo_nome TEXT,
  tipo TEXT NOT NULL,
  distancia REAL NOT NULL,
  ponto TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  pavimento TEXT,
  estado TEXT NOT NULL DEFAULT 'nova',
  responsavel_id INTEGER,
  responsavel_nome TEXT,
  comentario TEXT,
  updated_at TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_clash_interf_analise ON clash_interferencias (analise_id, numero);
`;

const isIfc = (name) => /\.ifc$/i.test(name || '');

function createClash({ app, db, storage, dataDir, rules, login, wrap, fail, isApprover, config, empOf }) {
  db.exec(SCHEMA);
  const cacheDir = path.join(dataDir, 'cache', 'geometria');
  const cachePath = (key) => path.join(cacheDir, `${crypto.createHash('sha1').update(key).digest('hex')}.bin`);

  // Análises interrompidas (servidor desligado no meio) voltam para a fila.
  db.run("UPDATE clash_analises SET estado = 'fila', progresso = 0, mensagem = 'Na fila (reiniciada)' WHERE estado = 'processando'");

  // ---- Modelos disponíveis (documentos do CDE com arquivo IFC) ---------------------------------
  /** Última versão emitida (compartilhada/publicada) com arquivo IFC, e a atual. */
  function versions(doc) {
    const evs = db.all("SELECT * FROM cde_eventos WHERE documento_id = ? AND arquivo_key IS NOT NULL ORDER BY id DESC", [doc.id]);
    const issued = evs.find((e) => e.tipo === 'estado' && (e.estado === 'compartilhado' || e.estado === 'publicado') && isIfc(e.arquivo_nome));
    return {
      emitida: issued ? { revisao: issued.revisao, estado: issued.estado, arquivo_key: issued.arquivo_key, arquivo_nome: issued.arquivo_nome } : null,
      atual: isIfc(doc.arquivo_nome) ? { revisao: doc.revisao, estado: doc.estado, arquivo_key: doc.arquivo_key, arquivo_nome: doc.arquivo_nome } : null,
    };
  }
  function modelDocs(empId) {
    const cfg = config(empId);
    return db
      .all("SELECT * FROM cde_documentos WHERE empreendimento_id = ? AND estado != 'arquivado' ORDER BY disciplina, tipo, numero", [empId])
      .map((d) => ({ d, v: versions(d) }))
      .filter(({ v }) => v.emitida || v.atual)
      .map(({ d, v }) => ({ id: d.id, codigo: rules.docCode(cfg, d), titulo: d.titulo, disciplina: d.disciplina, ...v }));
  }

  const parseAnalysis = (a) =>
    a && {
      ...a,
      config: JSON.parse(a.config),
      modelos: JSON.parse(a.modelos),
      resumo: a.resumo ? JSON.parse(a.resumo) : null,
      origem: a.origem ? JSON.parse(a.origem) : null,
    };
  const parseClash = (c) => ({ ...c, ponto: JSON.parse(c.ponto), a: JSON.parse(c.a), b: JSON.parse(c.b) });
  const loadAnalysis = (id) => {
    const a = parseAnalysis(db.get('SELECT * FROM clash_analises WHERE id = ?', [Number(id)]));
    if (!a) throw fail(404, 'Análise não encontrada.');
    return a;
  };

  // ---- Fila de processamento ----------------------------------------------------------------
  let running = null;
  let current = null;
  let stopped = false;
  function pump() {
    if (running || stopped) return;
    const next = db.get("SELECT id FROM clash_analises WHERE estado = 'fila' ORDER BY id LIMIT 1");
    if (!next) return;
    running = next.id;
    process.nextTick(() => runAnalysis(next.id).finally(() => {
      running = null;
      pump();
    }));
  }

  function runAnalysis(id) {
    return new Promise((resolve) => {
      const a = loadAnalysis(id);
      const docsIdx = a.modelos.map((m) => m.documento_id);
      const modelos = a.modelos.map((m) => ({ docId: m.documento_id, codigo: m.codigo, ifcPath: path.join(storage.dir, m.arquivo_key), cachePath: cachePath(m.arquivo_key) }));
      const missing = modelos.find((m) => !fs.existsSync(m.ifcPath));
      if (missing) {
        db.run("UPDATE clash_analises SET estado = 'erro', erro = ? WHERE id = ?", [`Arquivo do modelo ${missing.codigo} não encontrado no servidor.`, id]);
        return resolve();
      }
      const opts = {
        ...a.config,
        ladoA: a.config.ladoA.map((d) => docsIdx.indexOf(d)),
        ladoB: a.config.ladoB.map((d) => docsIdx.indexOf(d)),
      };
      db.run("UPDATE clash_analises SET estado = 'processando', progresso = 0, mensagem = 'Iniciando', erro = NULL WHERE id = ?", [id]);
      const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { modelos, opts } });
      current = w;
      let lastSave = 0;
      let done = false;
      const finish = (fn) => {
        if (done) return;
        done = true;
        current = null;
        if (stopped) return resolve();
        try {
          fn();
        } catch (err) {
          db.run("UPDATE clash_analises SET estado = 'erro', erro = ? WHERE id = ?", [err.message, id]);
        }
        resolve();
      };
      w.on('message', (m) => {
        if (m.tipo === 'progresso') {
          const now = Date.now();
          if (now - lastSave > 500) {
            lastSave = now;
            db.run('UPDATE clash_analises SET progresso = ?, mensagem = ? WHERE id = ?', [m.fracao, m.mensagem, id]);
          }
        } else if (m.tipo === 'erro') {
          finish(() => db.run("UPDATE clash_analises SET estado = 'erro', erro = ? WHERE id = ?", [m.mensagem, id]));
        } else if (m.tipo === 'fim') {
          finish(() => saveResult(a, m.resultado));
        }
      });
      w.on('error', (err) => finish(() => db.run("UPDATE clash_analises SET estado = 'erro', erro = ? WHERE id = ?", [err.message, id])));
      w.on('exit', (code) => finish(() => db.run("UPDATE clash_analises SET estado = 'erro', erro = ? WHERE id = ?", [`Processamento interrompido (código ${code}).`, id])));
    });
  }

  function saveResult(a, r) {
    const doc = (m) => a.modelos[m];
    const withDoc = (e) => ({ ...e, documento_id: doc(e.m).documento_id, codigo: doc(e.m).codigo, m: undefined });
    const resumo = { total: r.interferencias.length, colisao: 0, folga: 0, grupos: new Set(), pares: r.pares, elementos: r.elementos };
    db.tx(() => {
      db.run('DELETE FROM clash_interferencias WHERE analise_id = ?', [a.id]);
      r.interferencias.forEach((c, i) => {
        resumo[c.tipo] += 1;
        if (c.grupo) resumo.grupos.add(c.grupo);
        db.run(
          `INSERT INTO clash_interferencias (analise_id, numero, grupo, grupo_nome, tipo, distancia, ponto, a, b, pavimento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, i + 1, c.grupo, c.grupoNome, c.tipo, c.distancia, JSON.stringify(c.ponto), JSON.stringify(withDoc(c.a)), JSON.stringify(withDoc(c.b)), c.a.pavimento || c.b.pavimento || null],
        );
      });
      resumo.grupos = resumo.grupos.size;
      db.run("UPDATE clash_analises SET estado = 'concluida', progresso = 1, mensagem = NULL, resumo = ?, origem = ?, concluida_at = ? WHERE id = ?", [
        JSON.stringify(resumo),
        JSON.stringify(r.origem),
        new Date().toISOString(),
        a.id,
      ]);
    });
  }

  /** Cria a análise com a versão escolhida de cada modelo e põe na fila. */
  function createAnalysis(empId, body, user) {
    const b = body || {};
    const ladoA = [...new Set((b.ladoA || []).map(Number).filter(Boolean))];
    const ladoB = [...new Set((b.ladoB || []).map(Number).filter(Boolean))];
    if (!ladoA.length || !ladoB.length) throw fail(400, 'Escolha os modelos dos dois lados da análise.');
    if (!b.colisao && !b.folga) throw fail(400, 'Escolha colisão física e/ou folga mínima.');
    const versao = b.versao === 'atual' ? 'atual' : 'emitida';
    const available = new Map(modelDocs(empId).map((m) => [m.id, m]));
    const modelos = [];
    for (const id of [...new Set([...ladoA, ...ladoB])]) {
      const m = available.get(id);
      if (!m) throw fail(400, 'Modelo sem arquivo IFC no CDE (ou de outro empreendimento).');
      const v = versao === 'atual' ? m.atual || m.emitida : m.emitida || m.atual;
      modelos.push({ documento_id: id, codigo: m.codigo, titulo: m.titulo, disciplina: m.disciplina, ...v });
    }
    const num = (v, def, max) => {
      const x = Number(v);
      return Number.isFinite(x) && x >= 0 && x <= max ? x : def;
    };
    const cfg = {
      ladoA,
      ladoB,
      versao,
      colisao: !!b.colisao,
      tolerancia: num(b.tolerancia, 0.01, 1),
      folga: !!b.folga,
      distancia: num(b.distancia, 0.05, 2),
      ignorar: Array.isArray(b.ignorar) ? b.ignorar.map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 100) : IGNORAR_PADRAO,
    };
    const nome = String(b.nome || '').trim() || `${modelos.filter((m) => ladoA.includes(m.documento_id)).map((m) => m.disciplina).join('+')} × ${modelos.filter((m) => ladoB.includes(m.documento_id)).map((m) => m.disciplina).join('+')}`;
    const { id } = db.run('INSERT INTO clash_analises (empreendimento_id, nome, config, modelos, mensagem, criado_por) VALUES (?, ?, ?, ?, ?, ?)', [
      empId,
      nome.slice(0, 120),
      JSON.stringify(cfg),
      JSON.stringify(modelos),
      'Na fila',
      user.name || String(user.id),
    ]);
    pump();
    return loadAnalysis(id);
  }

  // ---- Rotas ----------------------------------------------------------------------------------
  app.get('/api/clash/:empId', login, wrap((req, res) => {
    const empId = empOf(req.params.empId);
    const analises = db.all('SELECT * FROM clash_analises WHERE empreendimento_id = ? ORDER BY id DESC', [empId]).map(parseAnalysis);
    const abertas = new Map(
      db
        .all(
          `SELECT analise_id, COUNT(*) AS n FROM clash_interferencias WHERE estado IN ('nova','ativa') AND analise_id IN (SELECT id FROM clash_analises WHERE empreendimento_id = ?) GROUP BY analise_id`,
          [empId],
        )
        .map((r) => [r.analise_id, r.n]),
    );
    res.json({
      modelos: modelDocs(empId),
      analises: analises.map((a) => ({ ...a, abertas: abertas.get(a.id) || 0 })),
      usuarios: db.all('SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome').map((u) => ({ id: u.id, name: u.nome })),
      estados: ESTADOS,
      ignorarPadrao: IGNORAR_PADRAO,
      padrao: analises[0]?.config || null,
    });
  }));

  app.post('/api/clash/:empId/analises', login, wrap((req, res) => {
    res.status(201).json(createAnalysis(empOf(req.params.empId), req.body, req.cdeUser));
  }));

  app.get('/api/clash/analises/:id', login, wrap((req, res) => {
    const a = loadAnalysis(req.params.id);
    const interferencias = db.all('SELECT * FROM clash_interferencias WHERE analise_id = ? ORDER BY numero', [a.id]).map(parseClash);
    res.json({ ...a, interferencias, estados: ESTADOS });
  }));

  /** Roda de novo com as mesmas regras e a versão mais recente de cada modelo. */
  app.post('/api/clash/analises/:id/reexecutar', login, wrap((req, res) => {
    const a = loadAnalysis(req.params.id);
    res.status(201).json(createAnalysis(a.empreendimento_id, { ...a.config, nome: a.nome }, req.cdeUser));
  }));

  app.delete('/api/clash/analises/:id', login, wrap((req, res) => {
    const a = loadAnalysis(req.params.id);
    if (!isApprover(req)) throw fail(403, 'Só a coordenação exclui análises.');
    if (a.estado === 'processando') throw fail(400, 'Aguarde o fim do processamento.');
    db.run('DELETE FROM clash_interferencias WHERE analise_id = ?', [a.id]);
    db.run('DELETE FROM clash_analises WHERE id = ?', [a.id]);
    res.status(204).end();
  }));

  /** Atualiza estado, responsável e comentário de uma ou várias interferências da análise. */
  app.patch('/api/clash/analises/:id/interferencias', login, wrap((req, res) => {
    const a = loadAnalysis(req.params.id);
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) throw fail(400, 'Nenhuma interferência escolhida.');
    if (b.estado != null && !ESTADOS[b.estado]) throw fail(400, 'Estado inválido.');
    if (b.estado === 'aprovada' && !isApprover(req)) throw fail(403, 'Só a coordenação aprova interferências (aceitar como está).');
    let resp = undefined;
    if (b.responsavel_id !== undefined) {
      if (b.responsavel_id === null || b.responsavel_id === '') resp = { id: null, nome: null };
      else {
        const u = db.get('SELECT id, nome FROM usuarios WHERE id = ? AND ativo = 1', [Number(b.responsavel_id)]);
        if (!u) throw fail(400, 'Responsável não encontrado.');
        resp = u;
      }
    }
    const who = req.cdeUser.name || String(req.cdeUser.id);
    const now = new Date().toISOString();
    db.tx(() => {
      for (const id of ids) {
        const c = db.get('SELECT * FROM clash_interferencias WHERE id = ? AND analise_id = ?', [id, a.id]);
        if (!c) throw fail(404, 'Interferência não encontrada nesta análise.');
        db.run('UPDATE clash_interferencias SET estado = ?, responsavel_id = ?, responsavel_nome = ?, comentario = ?, updated_at = ?, updated_by = ? WHERE id = ?', [
          b.estado ?? c.estado,
          resp ? resp.id : c.responsavel_id,
          resp ? resp.nome : c.responsavel_nome,
          b.comentario !== undefined ? String(b.comentario || '').slice(0, 2000) || null : c.comentario,
          now,
          who,
          id,
        ]);
      }
    });
    res.json(db.all(`SELECT * FROM clash_interferencias WHERE id IN (${ids.map(() => '?').join(',')})`, ids).map(parseClash));
  }));

  /** Geometria de um modelo da análise (cache binário) para o visualizador 3D. */
  app.get('/api/clash/analises/:id/geometria/:idx', login, wrap((req, res) => {
    const a = loadAnalysis(req.params.id);
    const m = a.modelos[Number(req.params.idx)];
    if (!m) throw fail(404, 'Modelo não encontrado na análise.');
    const file = cachePath(m.arquivo_key);
    if (!fs.existsSync(file)) throw fail(404, 'Geometria ainda não processada.');
    res.type('application/octet-stream');
    res.set('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(file).pipe(res);
  }));

  pump();
  return {
    pump,
    running: () => running,
    /** Para a fila (servidor desligando); a análise em andamento volta para a fila no próximo início. */
    async stop() {
      stopped = true;
      if (current) await current.terminate();
    },
  };
}

module.exports = { createClash, ESTADOS, IGNORAR_PADRAO };
