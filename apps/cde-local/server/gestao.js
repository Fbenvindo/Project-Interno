// Ligação com o SmartEasyWEB (Gestão de Projetos): o servidor CDE passa a ser o "cofre" de
// arquivos dos empreendimentos e só aceita operações com vale assinado pelo SmartEasyWEB
// (Ed25519). A chave pública é buscada uma vez, ao ligar, e fica guardada (não muda sozinha).
//
// API v2 (para o SmartEasyWEB e o navegador):
//   GET    /api/v2/status                        situação (ligado, impressão da chave, espaço livre)
//   POST   /api/v2/ligar { url }                 liga a um SmartEasyWEB (só no próprio servidor)
//   PUT    /api/v2/arquivos/<chave>?g=<vale>     grava o corpo (vale "put", tamanho máximo)
//   GET    /api/v2/arquivos/<chave>?g=<vale>     baixa (vale "get")
//   HEAD   /api/v2/arquivos/<chave>?g=<vale>     confere existência e tamanho (vale "stat")
//   DELETE /api/v2/arquivos/<chave>?g=<vale>     apaga (vale "delete")
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isLoopback = (req) => /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(req.socket.remoteAddress || '');
const fingerprint = (pem) => crypto.createHash('sha256').update(pem).digest('hex').slice(0, 16);

function createGestao({ app, db, dataDir }) {
  const base = path.resolve(dataDir, 'arquivos');
  fs.mkdirSync(base, { recursive: true });
  const fileOf = (key) => {
    const k = String(key || '');
    if (!/^p\/[A-Za-z0-9_-]+\//.test(k) || k.includes('..') || k.includes('\\')) throw Object.assign(new Error('Chave de arquivo inválida.'), { status: 400 });
    const p = path.resolve(base, k);
    if (!p.startsWith(base + path.sep)) throw Object.assign(new Error('Chave de arquivo inválida.'), { status: 400 });
    return p;
  };

  const state = () => {
    const pem = db.setting('gestao_chave');
    return { url: db.setting('gestao_url'), pem, impressao: pem ? fingerprint(pem) : null, ligadoEm: db.setting('gestao_ligado_em') };
  };

  /** Liga ao SmartEasyWEB do endereço: busca e guarda a chave pública. */
  async function link(url) {
    const u = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) throw new Error('Informe o endereço do SmartEasyWEB (ex.: http://localhost:3000).');
    let r;
    try {
      r = await fetch(`${u}/api/servico/chave-publica`, { signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new Error(`Sem resposta de ${u}: ${e.cause?.code || e.message}`);
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.emissor !== 'smarteasyweb' || !/BEGIN PUBLIC KEY/.test(d.chave || '')) throw new Error(d.error || `O endereço não respondeu como um SmartEasyWEB (${r.status}).`);
    crypto.createPublicKey(d.chave); // valida
    db.setting('gestao_url', u);
    db.setting('gestao_chave', d.chave);
    db.setting('gestao_ligado_em', new Date().toISOString());
    return state();
  }

  function unlink() {
    db.run("DELETE FROM ajustes WHERE chave IN ('gestao_url', 'gestao_chave', 'gestao_ligado_em')");
  }

  /** Confere o vale: assinatura do SmartEasyWEB, finalidade, operação, chave e validade. */
  function grantFor(req, op, key) {
    const pem = db.setting('gestao_chave');
    if (!pem) throw Object.assign(new Error('Servidor CDE ainda não ligado a um SmartEasyWEB.'), { status: 503 });
    const [payload, sig] = String(req.query.g || '').split('.');
    let c = null;
    try {
      if (payload && sig && crypto.verify(null, Buffer.from(payload), crypto.createPublicKey(pem), Buffer.from(sig, 'base64url')))
        c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      c = null;
    }
    if (!c || c.aud !== 'cde-arquivo' || c.emissor !== 'smarteasyweb') throw Object.assign(new Error('Vale inválido.'), { status: 403 });
    if (!(c.exp > Date.now() / 1000)) throw Object.assign(new Error('Vale vencido: peça de novo ao SmartEasyWEB.'), { status: 403 });
    if (c.op !== op || c.key !== key) throw Object.assign(new Error('Vale de outra operação ou arquivo.'), { status: 403 });
    return c;
  }

  const send = (res, err) => res.status(err.status || 500).json({ error: err.message });

  app.get('/api/v2/status', (req, res) => {
    const s = state();
    let livreGB = null;
    try {
      const st = fs.statfsSync(dataDir);
      livreGB = Math.round((st.bavail * st.bsize) / 1e9);
    } catch {
      /* sem statfs */
    }
    res.json({ app: 'SmartEasyBIM CDE', versao: require('../package.json').version, ligado: !!s.pem, gestao: s.url, impressao: s.impressao, ligadoEm: s.ligadoEm, livreGB });
  });

  app.post('/api/v2/ligar', async (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: 'A ligação ao SmartEasyWEB é feita no próprio computador do servidor.' });
    try {
      res.json(await link(req.body?.url));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Arquivos: a chave é o resto do caminho (p/<projeto>/<área>/<uuid>/<nome>).
  const keyOf = (req) => decodeURIComponent(req.params[0] || '');

  app.put('/api/v2/arquivos/*', (req, res) => {
    let key, file, c;
    try {
      key = keyOf(req);
      c = grantFor(req, 'put', key);
      file = fileOf(key);
    } catch (e) {
      return send(res, e);
    }
    const max = Number.isFinite(c.max) ? c.max : Infinity;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.parcial`;
    const out = fs.createWriteStream(tmp);
    let size = 0;
    let failed = false;
    const fail = (status, msg) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rmSync(tmp, { force: true });
      if (!res.headersSent) res.status(status).json({ error: msg });
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        req.unpipe(out);
        fail(413, 'Arquivo maior que o informado ao SmartEasyWEB.');
        req.resume();
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (failed) return;
      fs.renameSync(tmp, file);
      res.status(200).json({ ok: true, tamanho: size });
    });
    out.on('error', (err) => fail(500, err.message));
    req.on('aborted', () => fail(400, 'Envio interrompido.'));
  });

  app.head('/api/v2/arquivos/*', (req, res) => {
    try {
      const key = keyOf(req);
      grantFor(req, 'stat', key);
      const st = fs.statSync(fileOf(key), { throwIfNoEntry: false });
      if (!st) return res.status(404).end();
      res.set('Content-Length', String(st.size)).status(200).end();
    } catch (e) {
      res.status(e.status || 500).end();
    }
  });

  app.get('/api/v2/arquivos/*', (req, res) => {
    try {
      const key = keyOf(req);
      const c = grantFor(req, 'get', key);
      const file = fileOf(key);
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
      res.download(file, c.nome || path.basename(file));
    } catch (e) {
      send(res, e);
    }
  });

  app.delete('/api/v2/arquivos/*', (req, res) => {
    try {
      const key = keyOf(req);
      grantFor(req, 'delete', key);
      const file = fileOf(key);
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
      fs.rmSync(file, { force: true });
      // Remove a pasta do uuid, se ficou vazia.
      try {
        fs.rmdirSync(path.dirname(file));
      } catch {
        /* não vazia */
      }
      res.json({ ok: true });
    } catch (e) {
      send(res, e);
    }
  });

  return { state, link, unlink };
}

module.exports = { createGestao, fingerprint };
