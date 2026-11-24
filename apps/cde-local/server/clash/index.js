// Análise de interferências (clash) do CDE: análises por empreendimento entre modelos IFC do CDE
// (última revisão emitida de cada um, ou a atual), processadas uma de cada vez numa thread
// separada; as interferências viram pendências com estado, responsável e comentários.
// Fase 2: cada análise é comparada com a anterior de mesmas regras (interferências mantidas levam
// estado, responsável e comentários; as que sumiram ficam como resolvidas), roda de novo sozinha
// quando chega revisão nova de um dos modelos, e troca pendências com outros softwares por BCF.
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
CREATE TABLE IF NOT EXISTS clash_comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interferencia_id INTEGER NOT NULL REFERENCES clash_interferencias(id) ON DELETE CASCADE,
  autor TEXT,
  texto TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'cde',
  bcf_guid TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_clash_coment_interf ON clash_comentarios (interferencia_id, id);
`;

/** Colunas acrescentadas depois da primeira versão (bancos já existentes). */
const MIGRATIONS = [
  ['clash_analises', 'anterior_id', 'INTEGER'],
  ['clash_analises', 'automatica', 'INTEGER NOT NULL DEFAULT 0'],
  ['clash_analises', 'chave', 'TEXT'],
  ['clash_interferencias', 'guid', 'TEXT'],
  ['clash_interferencias', 'chave', 'TEXT'],
  ['clash_interferencias', 'situacao', "TEXT NOT NULL DEFAULT 'nova'"],
];

/** Situação em relação à análise anterior de mesmas regras. */
const SITUACOES = { nova: 'Nova nesta análise', mantida: 'Continua da análise anterior', reaberta: 'Reaberta (estava resolvida)' };

/** Regras da análise que definem "a mesma análise" (para comparar e reexecutar sozinha). */
const configKey = (c) =>
  JSON.stringify([
    [...c.ladoA].sort((x, y) => x - y),
    [...c.ladoB].sort((x, y) => x - y),
    c.versao,
    !!c.colisao,
    c.tolerancia,
    !!c.folga,
    c.folga ? c.distancia : null,
    [...(c.ignorar || [])].sort(),
  ]);

/** Identidade de uma interferência entre análises: os dois elementos (GlobalId) e o tipo. */
const clashKey = (tipo, a, b) => {
  const id = (e) => e.globalId || `${e.codigo}#${e.id}`;
  return `${tipo}|${[id(a), id(b)].sort().join('|')}`;
};

/** GUID no formato do BCF (UUID). */
const uuid = () => crypto.randomUUID();

const isIfc = (name) => /\.ifc$/i.test(name || '');

function createClash({ app, db, storage, dataDir, rules, login, wrap, fail, isApprover, config, empOf }) {
  db.exec(SCHEMA);
  for (const [table, col, def] of MIGRATIONS) {
    if (!db.all(`PRAGMA table_info(${table})`).some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  // Interferências antigas: GUID do BCF e comentário único viram histórico.
  for (const c of db.all('SELECT id, comentario, updated_by, updated_at FROM clash_interferencias WHERE guid IS NULL')) {
    db.run('UPDATE clash_interferencias SET guid = ? WHERE id = ?', [uuid(), c.id]);
    if (c.comentario && !db.get('SELECT 1 AS x FROM clash_comentarios WHERE interferencia_id = ?', [c.id]))
      db.run('INSERT INTO clash_comentarios (interferencia_id, autor, texto, bcf_guid, created_at) VALUES (?, ?, ?, ?, ?)', [c.id, c.updated_by, c.comentario, uuid(), c.updated_at || new Date().toISOString()]);
  }
  for (const k of db.all('SELECT id FROM clash_comentarios WHERE bcf_guid IS NULL')) db.run('UPDATE clash_comentarios SET bcf_guid = ? WHERE id = ?', [uuid(), k.id]);
  for (const a of db.all('SELECT id, config FROM clash_analises WHERE chave IS NULL')) db.run('UPDATE clash_analises SET chave = ? WHERE id = ?', [configKey(JSON.parse(a.config)), a.id]);
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
  /** Interferências com o histórico de comentários. */
  const withComments = (list) => {
    if (!list.length) return list;
    const byId = new Map(list.map((c) => [c.id, { ...c, comentarios: [] }]));
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      for (const k of db.all(`SELECT * FROM clash_comentarios WHERE interferencia_id IN (${part.map(() => '?').join(',')}) ORDER BY id`, part)) byId.get(k.interferencia_id).comentarios.push(k);
    }
    return [...byId.values()];
  };
  // Todo comentário tem GUID fixo: vai no BCF e, ao voltar, não é importado de novo.
  const addComment = (clashId, autor, texto, origem = 'cde', bcfGuid = null, when = null) => {
    db.run('INSERT INTO clash_comentarios (interferencia_id, autor, texto, origem, bcf_guid, created_at) VALUES (?, ?, ?, ?, ?, ?)', [clashId, autor, texto, origem, bcfGuid || uuid(), when || new Date().toISOString()]);
    db.run('UPDATE clash_interferencias SET comentario = ? WHERE id = ?', [texto.slice(0, 2000), clashId]);
  };
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
    // Análise anterior de mesmas regras: o que continua, o que é novo e o que sumiu.
    const prev = a.anterior_id ? db.get("SELECT * FROM clash_analises WHERE id = ? AND estado = 'concluida'", [a.anterior_id]) : null;
    const prevClashes = prev ? db.all('SELECT * FROM clash_interferencias WHERE analise_id = ?', [prev.id]) : [];
    const prevByKey = new Map(prevClashes.map((c) => [c.chave, c]));
    const matched = new Set();
    const cmp = prev ? { anterior_id: prev.id, novas: 0, mantidas: 0, reabertas: 0, resolvidas: 0, resolvidasLista: [] } : null;
    const revisions = a.modelos.map((m) => `${m.codigo.split('-').slice(-3).join('-')} ${m.revisao}`).join(', ');
    db.tx(() => {
      db.run('DELETE FROM clash_interferencias WHERE analise_id = ?', [a.id]);
      r.interferencias.forEach((c, i) => {
        resumo[c.tipo] += 1;
        if (c.grupo) resumo.grupos.add(c.grupo);
        const ea = withDoc(c.a);
        const eb = withDoc(c.b);
        const key = clashKey(c.tipo, ea, eb);
        const old = prevByKey.get(key);
        let estado = 'nova';
        let situacao = 'nova';
        if (old && !matched.has(old.id)) {
          matched.add(old.id);
          situacao = old.estado === 'resolvida' ? 'reaberta' : 'mantida';
          estado = old.estado === 'resolvida' ? 'ativa' : old.estado;
        }
        if (cmp) cmp[situacao === 'nova' ? 'novas' : situacao === 'mantida' ? 'mantidas' : 'reabertas'] += 1;
        const { id } = db.run(
          `INSERT INTO clash_interferencias (analise_id, numero, grupo, grupo_nome, tipo, distancia, ponto, a, b, pavimento, estado, responsavel_id, responsavel_nome, comentario, updated_at, updated_by, guid, chave, situacao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            a.id, i + 1, c.grupo, c.grupoNome, c.tipo, c.distancia, JSON.stringify(c.ponto), JSON.stringify(ea), JSON.stringify(eb), c.a.pavimento || c.b.pavimento || null,
            estado, old?.responsavel_id ?? null, old?.responsavel_nome ?? null, old?.comentario ?? null, old?.updated_at ?? null, old?.updated_by ?? null,
            old?.guid || uuid(), key, situacao,
          ],
        );
        if (old) {
          db.run(
            `INSERT INTO clash_comentarios (interferencia_id, autor, texto, origem, bcf_guid, created_at)
             SELECT ?, autor, texto, origem, bcf_guid, created_at FROM clash_comentarios WHERE interferencia_id = ? ORDER BY id`,
            [id, old.id],
          );
          if (situacao === 'reaberta') addComment(id, 'CDE', `Reaberta: a interferência continua nos modelos ${revisions}.`, 'sistema');
        }
      });
      if (cmp) {
        for (const old of prevClashes) {
          if (matched.has(old.id)) continue;
          cmp.resolvidas += 1;
          if (cmp.resolvidasLista.length < 500) {
            const x = JSON.parse(old.a);
            const y = JSON.parse(old.b);
            cmp.resolvidasLista.push({ numero: old.numero, tipo: old.tipo, estado: old.estado, a: { nome: x.nome, tipo: x.tipo, codigo: x.codigo }, b: { nome: y.nome, tipo: y.tipo, codigo: y.codigo }, pavimento: old.pavimento, guid: old.guid });
          }
          // A pendência da análise anterior fica registrada como resolvida pela revisão nova.
          if (old.estado === 'nova' || old.estado === 'ativa') {
            db.run("UPDATE clash_interferencias SET estado = 'resolvida', updated_at = ?, updated_by = 'CDE' WHERE id = ?", [new Date().toISOString(), old.id]);
            addComment(old.id, 'CDE', `Resolvida: não aparece mais na análise de ${new Date().toLocaleDateString('pt-BR')} (modelos ${revisions}).`, 'sistema');
          }
        }
        resumo.comparacao = cmp;
      }
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
  function createAnalysis(empId, body, user, automatica = false) {
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
      // Roda de novo sozinha quando chega revisão nova de um dos modelos.
      auto: b.auto !== false,
    };
    const chave = configKey(cfg);
    // Anterior para comparar: a última análise concluída com as mesmas regras.
    const prev = db.get("SELECT id FROM clash_analises WHERE empreendimento_id = ? AND chave = ? AND estado = 'concluida' ORDER BY id DESC LIMIT 1", [empId, chave]);
    const nome = String(b.nome || '').trim() || `${modelos.filter((m) => ladoA.includes(m.documento_id)).map((m) => m.disciplina).join('+')} × ${modelos.filter((m) => ladoB.includes(m.documento_id)).map((m) => m.disciplina).join('+')}`;
    const { id } = db.run('INSERT INTO clash_analises (empreendimento_id, nome, config, modelos, mensagem, criado_por, chave, anterior_id, automatica) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      empId,
      nome.slice(0, 120),
      JSON.stringify(cfg),
      JSON.stringify(modelos),
      automatica ? 'Na fila (revisão nova de um modelo)' : 'Na fila',
      automatica ? 'automática' : user.name || String(user.id),
      chave,
      prev?.id ?? null,
      automatica ? 1 : 0,
    ]);
    pump();
    return loadAnalysis(id);
  }

  /**
   * Um documento recebeu arquivo novo ou mudou de estado: as análises (as mais recentes de cada
   * conjunto de regras, com reexecução automática) que usam esse modelo rodam de novo se a versão
   * que elas usariam agora mudou.
   */
  function onDocumentChanged(docId) {
    const doc = db.get('SELECT empreendimento_id FROM cde_documentos WHERE id = ?', [docId]);
    if (!doc) return;
    const latest = new Map();
    for (const a of db.all('SELECT * FROM clash_analises WHERE empreendimento_id = ? ORDER BY id', [doc.empreendimento_id]).map(parseAnalysis)) latest.set(a.chave, a);
    const available = new Map(modelDocs(doc.empreendimento_id).map((m) => [m.id, m]));
    for (const a of latest.values()) {
      if (a.config.auto === false || a.estado === 'fila' || a.estado === 'processando') continue;
      if (!a.modelos.some((m) => m.documento_id === docId)) continue;
      const changed = a.modelos.some((m) => {
        const now = available.get(m.documento_id);
        if (!now) return false;
        const v = a.config.versao === 'atual' ? now.atual || now.emitida : now.emitida || now.atual;
        return v && v.arquivo_key !== m.arquivo_key;
      });
      if (changed) {
        try {
          createAnalysis(doc.empreendimento_id, { ...a.config, nome: a.nome }, { name: 'automática' }, true);
        } catch (err) {
          console.error('Reexecução automática da análise', a.id, err.message);
        }
      }
    }
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
      usuarios: db.all('SELECT id, nome, email FROM usuarios WHERE ativo = 1 ORDER BY nome').map((u) => ({ id: u.id, name: u.nome, email: u.email })),
      estados: ESTADOS,
      situacoes: SITUACOES,
      ignorarPadrao: IGNORAR_PADRAO,
      padrao: analises[0]?.config || null,
    });
  }));

  app.post('/api/clash/:empId/analises', login, wrap((req, res) => {
    res.status(201).json(createAnalysis(empOf(req.params.empId), req.body, req.cdeUser));
  }));

  app.get('/api/clash/analises/:id', login, wrap((req, res) => {
    const a = loadAnalysis(req.params.id);
    const interferencias = withComments(db.all('SELECT * FROM clash_interferencias WHERE analise_id = ? ORDER BY numero', [a.id]).map(parseClash));
    const anterior = a.anterior_id ? db.get('SELECT id, nome, concluida_at, modelos FROM clash_analises WHERE id = ?', [a.anterior_id]) : null;
    res.json({ ...a, anterior: anterior && { ...anterior, modelos: JSON.parse(anterior.modelos) }, interferencias, estados: ESTADOS, situacoes: SITUACOES });
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
    db.run('DELETE FROM clash_comentarios WHERE interferencia_id IN (SELECT id FROM clash_interferencias WHERE analise_id = ?)', [a.id]);
    db.run('DELETE FROM clash_interferencias WHERE analise_id = ?', [a.id]);
    db.run('UPDATE clash_analises SET anterior_id = NULL WHERE anterior_id = ?', [a.id]);
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
        db.run('UPDATE clash_interferencias SET estado = ?, responsavel_id = ?, responsavel_nome = ?, updated_at = ?, updated_by = ? WHERE id = ?', [
          b.estado ?? c.estado,
          resp ? resp.id : c.responsavel_id,
          resp ? resp.nome : c.responsavel_nome,
          now,
          who,
          id,
        ]);
        // Comentário novo entra no histórico (com a mudança de estado, se houver).
        const texto = String(b.comentario || '').trim().slice(0, 2000);
        const mudou = b.estado && b.estado !== c.estado ? `[${ESTADOS[c.estado].split(' (')[0]} → ${ESTADOS[b.estado].split(' (')[0]}] ` : '';
        if (texto || mudou) addComment(id, who, `${mudou}${texto}`.trim(), String(b.origem || 'cde').slice(0, 20));
      }
    });
    res.json(withComments(db.all(`SELECT * FROM clash_interferencias WHERE id IN (${ids.map(() => '?').join(',')})`, ids).map(parseClash)));
  }));

  /**
   * Importação de BCF (lido no navegador): para cada tópico com o GUID de uma interferência, o
   * estado (Resolved/Closed → resolvida, In Progress/Active → ativa) e os comentários novos.
   */
  app.post('/api/clash/analises/:id/bcf', login, wrap((req, res) => {
    const a = loadAnalysis(req.params.id);
    const topics = Array.isArray(req.body?.topicos) ? req.body.topicos : [];
    const byGuid = new Map(db.all('SELECT id, guid, estado FROM clash_interferencias WHERE analise_id = ?', [a.id]).map((c) => [String(c.guid).toLowerCase(), c]));
    const out = { topicos: topics.length, encontrados: 0, estados: 0, comentarios: 0, ignorados: 0 };
    const now = new Date().toISOString();
    const who = req.cdeUser.name || String(req.cdeUser.id);
    db.tx(() => {
      for (const t of topics.slice(0, 20000)) {
        const c = byGuid.get(String(t.guid || '').toLowerCase());
        if (!c) {
          out.ignorados += 1;
          continue;
        }
        out.encontrados += 1;
        const st = String(t.status || '').toLowerCase();
        const estado = /resolv|closed|fechad|conclu/.test(st) ? 'resolvida' : /progress|active|ativ|andamento/.test(st) ? 'ativa' : null;
        if (estado && estado !== c.estado && c.estado !== 'aprovada') {
          db.run('UPDATE clash_interferencias SET estado = ?, updated_at = ?, updated_by = ? WHERE id = ?', [estado, now, `${who} (BCF)`, c.id]);
          addComment(c.id, `${who} (BCF)`, `[${ESTADOS[c.estado].split(' (')[0]} → ${ESTADOS[estado].split(' (')[0]}] status "${t.status}" no BCF`, 'bcf');
          c.estado = estado;
          out.estados += 1;
        }
        for (const k of Array.isArray(t.comentarios) ? t.comentarios.slice(0, 500) : []) {
          const texto = String(k.texto || '').trim().slice(0, 2000);
          if (!texto) continue;
          if (k.guid && db.get('SELECT 1 AS x FROM clash_comentarios WHERE interferencia_id = ? AND lower(bcf_guid) = lower(?)', [c.id, String(k.guid)])) continue;
          if (db.get('SELECT 1 AS x FROM clash_comentarios WHERE interferencia_id = ? AND texto = ?', [c.id, texto])) continue;
          const when = k.data && !Number.isNaN(Date.parse(k.data)) ? new Date(k.data).toISOString() : now;
          db.run('INSERT INTO clash_comentarios (interferencia_id, autor, texto, origem, bcf_guid, created_at) VALUES (?, ?, ?, ?, ?, ?)', [c.id, String(k.autor || 'BCF').slice(0, 120), texto, 'bcf', k.guid ? String(k.guid) : null, when]);
          db.run('UPDATE clash_interferencias SET comentario = ? WHERE id = ?', [texto, c.id]);
          out.comentarios += 1;
        }
      }
    });
    res.json(out);
  }));

  /**
   * Pendências de um empreendimento para o SmartEasyBIM: interferências em aberto das análises
   * mais recentes (uma por conjunto de regras) que envolvem os documentos informados.
   */
  app.get('/api/clash/:empId/pendencias', login, wrap((req, res) => {
    const empId = empOf(req.params.empId);
    const docs = new Set(String(req.query.documentos || '').split(',').map(Number).filter(Boolean));
    const latest = new Map();
    for (const a of db.all("SELECT * FROM clash_analises WHERE empreendimento_id = ? AND estado = 'concluida' ORDER BY id", [empId]).map(parseAnalysis)) latest.set(a.chave, a);
    const out = [];
    for (const a of latest.values()) {
      if (docs.size && !a.modelos.some((m) => docs.has(m.documento_id))) continue;
      const list = withComments(db.all("SELECT * FROM clash_interferencias WHERE analise_id = ? AND estado IN ('nova','ativa') ORDER BY numero LIMIT 2000", [a.id]).map(parseClash)).filter(
        (c) => !docs.size || docs.has(c.a.documento_id) || docs.has(c.b.documento_id),
      );
      if (list.length) out.push({ analise: { id: a.id, nome: a.nome, concluida_at: a.concluida_at, modelos: a.modelos, origem: a.origem }, interferencias: list });
    }
    res.json({ analises: out, estados: ESTADOS });
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
    onDocumentChanged,
    running: () => running,
    /** Para a fila (servidor desligando); a análise em andamento volta para a fila no próximo início. */
    async stop() {
      stopped = true;
      if (current) await current.terminate();
    },
  };
}

module.exports = { createClash, ESTADOS, SITUACOES, IGNORAR_PADRAO, configKey, clashKey };
