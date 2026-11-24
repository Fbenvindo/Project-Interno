// Arquivos do CDE local: ficam na pasta de dados ("arquivos/<empreendimento>/<documento>/…"). O envio
// e o download usam links assinados e com validade (mesmo formato da versão em nuvem), para o
// navegador e o SmartEasyBIM mandarem o arquivo direto, sem passar pela API em JSON.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXPIRES_S = 60 * 60; // 1 hora

function createStorage(dataDir, secret) {
  const base = path.resolve(dataDir, 'arquivos');
  fs.mkdirSync(base, { recursive: true });

  /** Caminho no disco de uma chave (sem sair da pasta de arquivos). */
  const localPath = (key) => {
    const p = path.resolve(base, key);
    if (!p.startsWith(base + path.sep)) throw new Error('Chave de arquivo inválida.');
    return p;
  };
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const token = (op, key, extra = {}) => {
    const payload = Buffer.from(JSON.stringify({ op, key, exp: Date.now() + EXPIRES_S * 1000, ...extra })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };
  const readToken = (t, op) => {
    const [payload, sig] = String(t || '').split('.');
    if (!payload || !sig) return null;
    const expected = sign(payload);
    if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return data.op === op && data.key && data.exp >= Date.now() ? data : null;
    } catch {
      return null;
    }
  };

  return {
    dir: base,
    uploadUrl: (key, baseUrl) => ({ url: `${baseUrl}/api/cde/arquivos/${token('put', key)}`, method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, storage: 'local' }),
    downloadUrl: (key, fileName, baseUrl) => `${baseUrl}/api/cde/arquivos/${token('get', key, { name: fileName || 'arquivo' })}`,
    /** Tamanho do arquivo (bytes), ou null se não existe. */
    stat(key) {
      try {
        return fs.statSync(localPath(key)).size;
      } catch {
        return null;
      }
    },
    /** Rotas: PUT grava o corpo no disco (em fluxo), GET devolve o arquivo. */
    register(app) {
      app.put('/api/cde/arquivos/:token', (req, res) => {
        const t = readToken(req.params.token, 'put');
        if (!t) return res.status(403).json({ error: 'Link de envio inválido ou expirado.' });
        let file;
        try {
          file = localPath(t.key);
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.parcial`;
        const out = fs.createWriteStream(tmp);
        req.pipe(out);
        out.on('finish', () => {
          fs.renameSync(tmp, file);
          res.status(200).json({ ok: true });
        });
        out.on('error', (err) => res.status(500).json({ error: err.message }));
        req.on('aborted', () => fs.rmSync(tmp, { force: true }));
      });
      app.get('/api/cde/arquivos/:token', (req, res) => {
        const t = readToken(req.params.token, 'get');
        if (!t) return res.status(403).json({ error: 'Link de download inválido ou expirado.' });
        let file;
        try {
          file = localPath(t.key);
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
        res.download(file, t.name);
      });
    },
  };
}

module.exports = { createStorage };
