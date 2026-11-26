// Análises de interferências pedidas pelo SmartEasyWEB (etapa 3): o SmartEasyWEB guarda as
// análises e as pendências; o servidor só processa (mesmo motor e cache de geometria) e devolve o
// resultado. Cada pedido vem com uma autorização assinada pelo SmartEasyWEB.
//
//   POST   /api/v2/analises?g=<aud cde-analise, op criar, job>  → { id }      (entra na fila)
//   GET    /api/v2/analises/<id>?g=<op ler, id>                  → situação (+ resultado ao terminar)
//   DELETE /api/v2/analises/<id>?g=<op apagar, id>               → { ok }    (resultado já gravado)
//   GET    /api/v2/geometria/<chave>?g=<aud cde-arquivo, op geometria> → cache binário do IFC
//
// job = { modelos: [{ key, codigo, docId }], opts: { ladoA: [i], ladoB: [i], colisao, tolerancia,
//         folga, distancia, ignorar } }  (ladoA/ladoB: índices em `modelos`)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS v2_analises (
  id TEXT PRIMARY KEY,
  spec TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'fila',
  progresso REAL NOT NULL DEFAULT 0,
  mensagem TEXT,
  erro TEXT,
  resultado TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  concluida_at TEXT
);
`;
const KEEP_DAYS = 7;

function createClashV2({ app, db, dataDir, gestao }) {
  db.exec(SCHEMA);
  // Pedidos interrompidos (servidor desligado no meio) voltam para a fila; resultados velhos saem.
  db.run("UPDATE v2_analises SET estado = 'fila', progresso = 0, mensagem = 'Na fila (reiniciada)' WHERE estado = 'processando'");
  db.run(`DELETE FROM v2_analises WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${KEEP_DAYS} days')`);

  const cacheDir = path.join(dataDir, 'cache', 'geometria');
  const cachePath = (key) => path.join(cacheDir, `${crypto.createHash('sha1').update(key).digest('hex')}.bin`);
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const send = (res, err) => res.status(err.status || 500).json({ error: err.message });

  let running = null;
  let current = null;
  let stopped = false;

  function pump() {
    if (running || stopped) return;
    const next = db.get("SELECT id FROM v2_analises WHERE estado = 'fila' ORDER BY created_at LIMIT 1");
    if (!next) return;
    running = next.id;
    process.nextTick(() =>
      run(next.id).finally(() => {
        running = null;
        pump();
      }),
    );
  }

  function run(id) {
    return new Promise((resolve) => {
      const row = db.get('SELECT * FROM v2_analises WHERE id = ?', [id]);
      const spec = JSON.parse(row.spec);
      const setError = (msg) => db.run("UPDATE v2_analises SET estado = 'erro', erro = ?, concluida_at = ? WHERE id = ?", [msg, new Date().toISOString(), id]);
      let modelos;
      try {
        modelos = spec.modelos.map((m) => {
          const ifcPath = gestao.fileOf(m.key);
          if (!fs.existsSync(ifcPath)) throw new Error(`Arquivo do modelo ${m.codigo || m.key} não está no servidor.`);
          return { docId: m.docId, codigo: m.codigo, ifcPath, cachePath: cachePath(m.key) };
        });
      } catch (e) {
        setError(e.message);
        return resolve();
      }
      db.run("UPDATE v2_analises SET estado = 'processando', progresso = 0, mensagem = 'Iniciando', erro = NULL WHERE id = ?", [id]);
      const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { modelos, opts: spec.opts } });
      current = w;
      let done = false;
      let lastSave = 0;
      const finish = (fn) => {
        if (done) return;
        done = true;
        current = null;
        if (!stopped) {
          try {
            fn();
          } catch (e) {
            setError(e.message);
          }
        }
        resolve();
      };
      w.on('message', (m) => {
        if (m.tipo === 'progresso') {
          const now = Date.now();
          if (now - lastSave > 500) {
            lastSave = now;
            db.run('UPDATE v2_analises SET progresso = ?, mensagem = ? WHERE id = ?', [m.fracao, m.mensagem, id]);
          }
        } else if (m.tipo === 'erro') finish(() => setError(m.mensagem));
        else if (m.tipo === 'fim')
          finish(() =>
            db.run("UPDATE v2_analises SET estado = 'concluida', progresso = 1, mensagem = NULL, resultado = ?, concluida_at = ? WHERE id = ?", [
              JSON.stringify(m.resultado),
              new Date().toISOString(),
              id,
            ]),
          );
      });
      w.on('error', (e) => finish(() => setError(e.message)));
      w.on('exit', (code) => finish(() => setError(`Processamento interrompido (código ${code}).`)));
    });
  }

  /** Autorização de análise para a operação (e o id, fora da criação). */
  const claims = (req, op, id) => {
    const c = gestao.verifyClaims(req.query.g, 'cde-analise');
    if (c.op !== op || (id && c.id !== id)) throw fail(403, 'Autorização de outra operação ou análise.');
    return c;
  };

  app.post('/api/v2/analises', (req, res) => {
    try {
      const c = claims(req, 'criar');
      const job = c.job || {};
      const modelos = Array.isArray(job.modelos) ? job.modelos : [];
      if (!modelos.length || modelos.length > 40) throw fail(400, 'Modelos da análise inválidos.');
      for (const m of modelos) gestao.fileOf(m.key); // chave dentro da área dos empreendimentos
      const o = job.opts || {};
      const idx = (l) => (Array.isArray(l) ? l.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < modelos.length) : []);
      const opts = { ...o, ladoA: idx(o.ladoA), ladoB: idx(o.ladoB) };
      if (!opts.ladoA.length || !opts.ladoB.length) throw fail(400, 'Lados da análise inválidos.');
      // O mesmo pedido (jti) não entra duas vezes.
      const id = String(c.jti || crypto.randomUUID());
      if (!db.get('SELECT 1 AS x FROM v2_analises WHERE id = ?', [id]))
        db.run("INSERT INTO v2_analises (id, spec, mensagem) VALUES (?, ?, 'Na fila')", [id, JSON.stringify({ modelos, opts })]);
      pump();
      res.status(201).json({ id });
    } catch (e) {
      send(res, e);
    }
  });

  app.get('/api/v2/analises/:id', (req, res) => {
    try {
      claims(req, 'ler', req.params.id);
      const r = db.get('SELECT * FROM v2_analises WHERE id = ?', [req.params.id]);
      if (!r) throw fail(404, 'Análise não encontrada no servidor (resultados ficam 7 dias).');
      res.json({
        id: r.id,
        estado: r.estado,
        progresso: r.progresso,
        mensagem: r.mensagem,
        erro: r.erro,
        concluidaEm: r.concluida_at,
        resultado: r.estado === 'concluida' && r.resultado ? JSON.parse(r.resultado) : null,
      });
    } catch (e) {
      send(res, e);
    }
  });

  app.delete('/api/v2/analises/:id', (req, res) => {
    try {
      claims(req, 'apagar', req.params.id);
      if (running === req.params.id) throw fail(409, 'A análise está em processamento.');
      db.run('DELETE FROM v2_analises WHERE id = ?', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      send(res, e);
    }
  });

  // Geometria processada de um IFC (para o visualizador 3D do SmartEasyWEB).
  app.get('/api/v2/geometria/*', (req, res) => {
    try {
      const key = decodeURIComponent(req.params[0] || '');
      gestao.grantFor(req, 'geometria', key);
      gestao.fileOf(key);
      const file = cachePath(key);
      if (!fs.existsSync(file)) throw fail(404, 'Geometria ainda não processada (rode uma análise com este modelo).');
      res.type('application/octet-stream');
      res.set('Cache-Control', 'private, max-age=86400');
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      send(res, e);
    }
  });

  pump();
  return {
    pump,
    async stop() {
      stopped = true;
      if (current) await current.terminate();
    },
  };
}

module.exports = { createClashV2 };
