// Análises pedidas pelo SmartEasyWEB (etapa 3): fila com autorização assinada, resultado,
// geometria para o visualizador e recusas.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { startServer } = require('../server/start');
const { makeIfc } = require('./ifcFixture');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-v2-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
let srv;
let web;
let base;

function sign(aud, extra) {
  const now = Math.floor(Date.now() / 1000);
  const c = { aud, jti: crypto.randomUUID(), iat: now, exp: now + 600, emissor: 'smarteasyweb', ...extra };
  const p = Buffer.from(JSON.stringify(c)).toString('base64url');
  return `${p}.${crypto.sign(null, Buffer.from(p), privateKey).toString('base64url')}`;
}
const fileUrl = (op, key, extra = {}) => `${base}/api/v2/${op === 'geometria' ? 'geometria' : 'arquivos'}/${key.split('/').map(encodeURIComponent).join('/')}?g=${sign('cde-arquivo', { op, key, ...extra })}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  web = http.createServer((req, res) => res.end(JSON.stringify({ emissor: 'smarteasyweb', chave: pem })));
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  srv = await startServer({ dataDir, port: 0, host: '127.0.0.1', webDir: path.join(dataDir, 'sem-web') });
  base = `http://127.0.0.1:${srv.port}`;
  await srv.gestao.link(`http://127.0.0.1:${web.address().port}`);
});
test.after(async () => {
  await srv?.close();
  web?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('análise pedida pelo SmartEasyWEB', async () => {
  const est = 'p/proj1/cde/u1/estrutura.ifc';
  const hid = 'p/proj1/cde/u2/hidraulica.ifc';
  const viga = { tipo: 'IFCBEAM', nome: 'V1', base: [0, 0, 2.8], eixo: [1, 0, 0], comprimento: 10, perfil: { retangulo: [0.2, 0.5] } };
  const tubo = { tipo: 'IFCPIPESEGMENT', nome: 'AF-1', base: [5, -2, 2.85], eixo: [0, 1, 0], comprimento: 4, perfil: { raio: 0.05 } };
  for (const [key, el] of [[est, viga], [hid, tubo]]) {
    const r = await fetch(fileUrl('put', key), { method: 'PUT', body: Buffer.from(makeIfc({ elementos: [el] })) });
    assert.equal(r.status, 200);
  }
  const job = { modelos: [{ key: est, codigo: 'EST', docId: 'd1' }, { key: hid, codigo: 'HID', docId: 'd2' }], opts: { ladoA: [0], ladoB: [1], colisao: true, tolerancia: 0.01 } };
  // Recusas na criação.
  assert.equal((await fetch(`${base}/api/v2/analises?g=${sign('cde-arquivo', { op: 'criar', job })}`, { method: 'POST' })).status, 403, 'vale de arquivo não cria análise');
  assert.equal((await fetch(`${base}/api/v2/analises?g=${sign('cde-analise', { op: 'criar', job: { ...job, modelos: [{ key: '../x', codigo: 'X' }] } })}`, { method: 'POST' })).status, 400);
  // Criação (o mesmo pedido não entra duas vezes).
  const g = sign('cde-analise', { op: 'criar', job });
  let r = await fetch(`${base}/api/v2/analises?g=${g}`, { method: 'POST' });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.equal((await (await fetch(`${base}/api/v2/analises?g=${g}`, { method: 'POST' })).json()).id, id);
  // Acompanhamento até terminar.
  let st;
  for (let i = 0; i < 100; i++) {
    st = await (await fetch(`${base}/api/v2/analises/${id}?g=${sign('cde-analise', { op: 'ler', id })}`)).json();
    if (st.estado === 'concluida' || st.estado === 'erro') break;
    await sleep(100);
  }
  assert.equal(st.estado, 'concluida', st.erro);
  assert.equal(st.resultado.interferencias.length, 1);
  assert.equal(st.resultado.interferencias[0].b.nome, 'AF-1');
  assert.equal(st.resultado.interferencias[0].a.m, 0);
  assert.equal((await fetch(`${base}/api/v2/analises/${id}?g=${sign('cde-analise', { op: 'ler', id: 'outra' })}`)).status, 403, 'autorização de outra análise');
  // Geometria para o visualizador.
  r = await fetch(fileUrl('geometria', est));
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).toString('latin1', 0, 7), 'SEBGEO1');
  assert.equal((await fetch(fileUrl('get', est).replace('/arquivos/', '/geometria/'))).status, 403, 'vale de download não serve para geometria');
  // Modelo que sumiu do servidor: erro claro.
  const bad = sign('cde-analise', { op: 'criar', job: { ...job, modelos: [job.modelos[0], { key: 'p/proj1/cde/u9/sumiu.ifc', codigo: 'SUMIU' }] } });
  const id2 = (await (await fetch(`${base}/api/v2/analises?g=${bad}`, { method: 'POST' })).json()).id;
  for (let i = 0; i < 50; i++) {
    st = await (await fetch(`${base}/api/v2/analises/${id2}?g=${sign('cde-analise', { op: 'ler', id: id2 })}`)).json();
    if (st.estado !== 'fila' && st.estado !== 'processando') break;
    await sleep(100);
  }
  assert.equal(st.estado, 'erro');
  assert.match(st.erro, /SUMIU/);
  // Limpeza do resultado já gravado no SmartEasyWEB.
  assert.equal((await fetch(`${base}/api/v2/analises/${id}?g=${sign('cde-analise', { op: 'apagar', id })}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/api/v2/analises/${id}?g=${sign('cde-analise', { op: 'ler', id })}`)).status, 404);
});
