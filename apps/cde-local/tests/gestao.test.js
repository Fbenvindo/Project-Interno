// Servidor CDE como cofre do SmartEasyWEB: ligação (chave pública), vales assinados para enviar,
// conferir, baixar e apagar arquivos, e as recusas (vale adulterado, vencido, de outra operação ou
// arquivo, maior que o informado, chave fora da área dos empreendimentos).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { startServer } = require('../server/start');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-gestao-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
let srv;
let web;
let base;
let webUrl;

/** Vale como o SmartEasyWEB emite (src/lib/serviceToken.ts). */
function grant(op, key, extra = {}, key2 = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const c = { op, key, aud: 'cde-arquivo', jti: crypto.randomUUID(), iat: now, exp: now + 600, emissor: 'smarteasyweb', ...extra };
  const p = Buffer.from(JSON.stringify(c)).toString('base64url');
  return `${p}.${crypto.sign(null, Buffer.from(p), key2).toString('base64url')}`;
}
const url = (key, g) => `${base}/api/v2/arquivos/${key.split('/').map(encodeURIComponent).join('/')}?g=${g}`;

test.before(async () => {
  web = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/servico/chave-publica') res.end(JSON.stringify({ emissor: 'smarteasyweb', chave: pem }));
    else res.writeHead(404).end('{}');
  });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  webUrl = `http://127.0.0.1:${web.address().port}`;
  srv = await startServer({ dataDir, port: 0, host: '127.0.0.1', webDir: path.join(dataDir, 'sem-web') });
  base = `http://127.0.0.1:${srv.port}`;
});
test.after(async () => {
  await srv?.close();
  web?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('cofre de arquivos do SmartEasyWEB', async () => {
  let st = await (await fetch(`${base}/api/v2/status`)).json();
  assert.equal(st.ligado, false);
  const key = 'p/proj123/documentos/0b0c/planta térreo.pdf';
  assert.equal((await fetch(url(key, grant('put', key)), { method: 'PUT', body: 'x' })).status, 503, 'sem ligação, recusa');

  // Ligação (só no próprio computador do servidor).
  let r = await fetch(`${base}/api/v2/ligar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webUrl + '/' }) });
  assert.equal(r.status, 200);
  st = await (await fetch(`${base}/api/v2/status`)).json();
  assert.equal(st.ligado, true);
  assert.equal(st.gestao, webUrl);
  assert.equal(st.impressao, crypto.createHash('sha256').update(pem).digest('hex').slice(0, 16));
  assert.ok(st.livreGB == null || st.livreGB >= 0);
  r = await fetch(`${base}/api/v2/ligar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1:1' }) });
  assert.equal(r.status, 400, 'endereço sem SmartEasyWEB');
  assert.equal((await (await fetch(`${base}/api/v2/status`)).json()).gestao, webUrl, 'ligação anterior mantida');

  // Envio, conferência, download e exclusão.
  const body = Buffer.from('%PDF-1.4 conteúdo de teste '.repeat(100));
  r = await fetch(url(key, grant('put', key, { max: body.length })), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).tamanho, body.length);
  r = await fetch(url(key, grant('stat', key)), { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-length'), String(body.length));
  r = await fetch(url(key, grant('get', key, { nome: 'Planta térreo.pdf' })));
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), body);
  assert.match(r.headers.get('content-disposition'), /Planta/);
  assert.ok(fs.existsSync(path.join(dataDir, 'arquivos', key)), 'gravado na pasta do empreendimento');

  // Recusas.
  const status = async (u, init) => (await fetch(u, init)).status;
  const g = grant('get', key);
  assert.equal(await status(url(key, g.slice(0, -4) + 'AAAA')), 403, 'vale adulterado');
  assert.equal(await status(url(key, grant('get', key, {}, crypto.generateKeyPairSync('ed25519').privateKey))), 403, 'vale de outra chave');
  assert.equal(await status(url(key, grant('get', key, { exp: Math.floor(Date.now() / 1000) - 1 }))), 403, 'vale vencido');
  assert.equal(await status(url(key, grant('put', key))), 403, 'vale de envio usado para baixar');
  assert.equal(await status(url(key, grant('get', 'p/proj123/documentos/0b0c/outro.pdf'))), 403, 'vale de outro arquivo');
  assert.equal(await status(url(key, grant('get', key, { aud: 'app' }))), 403, 'autorização de login não é vale');
  const big = 'p/proj123/documentos/1/grande.bin';
  assert.equal(await status(url(big, grant('put', big, { max: 10 })), { method: 'PUT', body: Buffer.alloc(5000) }), 413, 'maior que o informado');
  assert.equal((await fetch(url(big, grant('stat', big)), { method: 'HEAD' })).status, 404, 'envio recusado não fica gravado');
  const bad = 'p/proj123/../../cde.sqlite';
  // A URL com ".." é normalizada antes de chegar (vira outro arquivo: vale não confere) ou cai na checagem da chave.
  assert.ok([400, 403].includes(await status(`${base}/api/v2/arquivos/p/proj123/%2E%2E/%2E%2E/cde.sqlite?g=${grant('get', bad)}`)), 'fora da pasta');
  assert.equal(await status(url('outro/x.txt', grant('get', 'outro/x.txt'))), 400, 'fora da área dos empreendimentos');

  // Exclusão.
  assert.equal(await status(url(key, grant('delete', key)), { method: 'DELETE' }), 200);
  assert.equal((await fetch(url(key, grant('stat', key)), { method: 'HEAD' })).status, 404);

  // Desligar: volta a recusar.
  srv.gestao.unlink();
  assert.equal(await status(url(key, grant('stat', key)), { method: 'HEAD' }), 503);
});
