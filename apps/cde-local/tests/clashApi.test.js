// API de interferências: modelos IFC do CDE, análise na fila (thread separada), resultados,
// pendências (estado, responsável, comentário), permissões, geometria e reexecução.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../server/start');
const { makeIfc } = require('./ifcFixture');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-clash-'));
let srv;
let base;
const call = async (method, p, body, token) => {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data = t;
  try {
    data = t ? JSON.parse(t) : null;
  } catch {
    /* binário */
  }
  return { status: r.status, data, raw: r };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(token, docId, name, text) {
  const up = (await call('POST', `/api/cde/documentos/${docId}/upload`, { nome: name }, token)).data;
  await fetch(up.url, { method: 'PUT', headers: up.headers, body: Buffer.from(text) });
  return (await call('POST', `/api/cde/documentos/${docId}/arquivo`, { key: up.key, nome: name }, token)).data;
}
async function waitDone(token, id) {
  for (let i = 0; i < 200; i++) {
    const a = (await call('GET', `/api/clash/analises/${id}`, null, token)).data;
    if (a.estado === 'concluida' || a.estado === 'erro') return a;
    await sleep(100);
  }
  throw new Error('análise não terminou');
}

test.before(async () => {
  srv = await startServer({ dataDir, port: 0, host: '127.0.0.1', webDir: path.join(dataDir, 'sem-web') });
  base = `http://127.0.0.1:${srv.port}`;
});
test.after(async () => {
  await srv?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('análise de interferências pelo CDE', async () => {
  const admin = (await call('POST', '/api/setup', { nome: 'Coord', email: 'c@x', senha: 'segredo1' })).data.token;
  await call('POST', '/api/usuarios', { nome: 'Proj', email: 'p@x', senha: 'segredo2' }, admin);
  const colab = (await call('POST', '/api/auth/login', { email: 'p@x', password: 'segredo2' })).data;
  const emp = (await call('POST', '/api/empreendimentos', { nome: 'Torre' }, admin)).data.id;
  await call('PATCH', `/api/cde/${emp}/config`, { projeto: 'TOR', originador: 'SEB' }, admin);

  const est = (await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Modelo estrutural', tipo: 'M3', disciplina: 'ES' }, admin)).data;
  const hid = (await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Modelo hidráulico', tipo: 'M3', disciplina: 'HD' }, admin)).data;
  const pdf = (await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Planta', tipo: 'DR', disciplina: 'HD' }, admin)).data;
  const viga = (z) => ({ tipo: 'IFCBEAM', nome: 'V1', base: [0, 0, z], eixo: [1, 0, 0], comprimento: 10, perfil: { retangulo: [0.2, 0.5] } });
  await upload(admin, est.id, 'estrutura.ifc', makeIfc({ elementos: [viga(2.8)] }));
  await upload(admin, pdf.id, 'planta.pdf', '%PDF');
  // Estrutura emitida (P01); depois a viga sobe na P02, ainda em andamento.
  await call('POST', `/api/cde/documentos/${est.id}/estado`, { estado: 'compartilhado', finalidade: 'S1' }, admin);
  await upload(admin, est.id, 'estrutura-v2.ifc', makeIfc({ elementos: [viga(5)] }));
  await upload(admin, hid.id, 'hidraulica.ifc', makeIfc({ elementos: [{ tipo: 'IFCPIPESEGMENT', nome: 'AF-01', base: [5, -2, 2.9], eixo: [0, 1, 0], comprimento: 4, perfil: { raio: 0.05 } }] }));

  let r = await call('GET', `/api/clash/${emp}`, null, colab.token);
  assert.deepEqual(r.data.modelos.map((m) => m.codigo).sort(), ['TOR-SEB-ZZ-ZZ-M3-ES-0001', 'TOR-SEB-ZZ-ZZ-M3-HD-0001'], 'só documentos com IFC');
  const mEst = r.data.modelos.find((m) => m.id === est.id);
  assert.equal(mEst.emitida.revisao, 'P01');
  assert.equal(mEst.atual.revisao, 'P02');
  assert.equal(r.data.usuarios.length, 2);

  assert.equal((await call('POST', `/api/clash/${emp}/analises`, { ladoA: [est.id], ladoB: [pdf.id], colisao: true }, colab.token)).status, 400);

  // Versão emitida da estrutura (viga em 2,8 m): colide com o tubo.
  r = await call('POST', `/api/clash/${emp}/analises`, { ladoA: [est.id], ladoB: [hid.id], colisao: true, folga: true, distancia: 0.05, tolerancia: 0.01 }, colab.token);
  assert.equal(r.status, 201);
  assert.equal(r.data.nome, 'ES × HD');
  assert.equal(r.data.modelos.find((m) => m.documento_id === est.id).revisao, 'P01');
  let a = await waitDone(colab.token, r.data.id);
  assert.equal(a.estado, 'concluida', a.erro);
  assert.equal(a.resumo.colisao, 1);
  assert.equal(a.interferencias.length, 1);
  const c = a.interferencias[0];
  assert.equal(c.numero, 1);
  assert.equal(c.estado, 'nova');
  assert.equal(c.a.codigo, 'TOR-SEB-ZZ-ZZ-M3-ES-0001');
  assert.equal(c.b.nome, 'AF-01');
  assert.equal(c.pavimento, 'Térreo');

  // Pendência: responsável, comentário, estado; colaborador não aprova.
  const users = (await call('GET', `/api/clash/${emp}`, null, colab.token)).data.usuarios;
  const proj = users.find((u) => u.name === 'Proj');
  r = await call('PATCH', `/api/clash/analises/${a.id}/interferencias`, { ids: [c.id], estado: 'ativa', responsavel_id: proj.id, comentario: 'Desviar por baixo' }, colab.token);
  assert.equal(r.data[0].responsavel_nome, 'Proj');
  assert.equal(r.data[0].comentario, 'Desviar por baixo');
  assert.equal((await call('PATCH', `/api/clash/analises/${a.id}/interferencias`, { ids: [c.id], estado: 'aprovada' }, colab.token)).status, 403);
  assert.equal((await call('PATCH', `/api/clash/analises/${a.id}/interferencias`, { ids: [c.id], estado: 'aprovada' }, admin)).data[0].estado, 'aprovada');

  // Geometria para o visualizador.
  const g = await fetch(`${base}/api/clash/analises/${a.id}/geometria/0`, { headers: { Authorization: `Bearer ${colab.token}` } });
  assert.equal(g.status, 200);
  assert.equal(Buffer.from(await g.arrayBuffer()).toString('latin1', 0, 7), 'SEBGEO1');
  assert.equal((await fetch(`${base}/api/clash/analises/${a.id}/geometria/0`)).status, 401);

  // Versão atual (viga subiu para 5 m): sem interferência.
  r = await call('POST', `/api/clash/${emp}/analises`, { ladoA: [est.id], ladoB: [hid.id], colisao: true, versao: 'atual' }, colab.token);
  a = await waitDone(colab.token, r.data.id);
  assert.equal(a.modelos.find((m) => m.documento_id === est.id).revisao, 'P02');
  assert.equal(a.interferencias.length, 0);

  // Reexecutar mantém as regras; lista mostra pendências abertas.
  r = await call('POST', `/api/clash/analises/${a.id}/reexecutar`, null, colab.token);
  assert.equal(r.data.config.versao, 'atual');
  await waitDone(colab.token, r.data.id);
  const list = (await call('GET', `/api/clash/${emp}`, null, colab.token)).data;
  assert.equal(list.analises.length, 3);
  assert.equal(list.padrao.versao, 'atual', 'regras da última análise como padrão');

  // Excluir: só coordenação.
  assert.equal((await call('DELETE', `/api/clash/analises/${a.id}`, null, colab.token)).status, 403);
  assert.equal((await call('DELETE', `/api/clash/analises/${a.id}`, null, admin)).status, 204);
});
