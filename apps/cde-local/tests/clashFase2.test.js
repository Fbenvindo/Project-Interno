// Fase 2 das interferências: comparação com a análise anterior (mantida, nova, reaberta,
// resolvida), reexecução automática ao emitir revisão nova, importação de BCF e pendências para o
// SmartEasyBIM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../server/start');
const { makeIfc } = require('./ifcFixture');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-clash2-'));
let srv;
let base;
const call = async (method, p, body, token) => {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function upload(token, docId, name, text) {
  const up = (await call('POST', `/api/cde/documentos/${docId}/upload`, { nome: name }, token)).data;
  await fetch(up.url, { method: 'PUT', headers: up.headers, body: Buffer.from(text) });
  return (await call('POST', `/api/cde/documentos/${docId}/arquivo`, { key: up.key, nome: name }, token)).data;
}
async function waitIdle(token, emp) {
  for (let i = 0; i < 300; i++) {
    const l = (await call('GET', `/api/clash/${emp}`, null, token)).data.analises;
    if (l.length && l.every((a) => a.estado === 'concluida' || a.estado === 'erro')) return l;
    await sleep(100);
  }
  throw new Error('análises não terminaram');
}

test.before(async () => {
  srv = await startServer({ dataDir, port: 0, host: '127.0.0.1', webDir: path.join(dataDir, 'sem-web') });
  base = `http://127.0.0.1:${srv.port}`;
});
test.after(async () => {
  await srv?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Estrutura: duas vigas. Hidráulica P01: tubos AF-1 e AF-2 cruzando a V1 e AF-3 cruzando a V2.
const vigas = makeIfc({
  elementos: [
    { tipo: 'IFCBEAM', nome: 'V1', base: [0, 0, 2.8], eixo: [1, 0, 0], comprimento: 10, perfil: { retangulo: [0.2, 0.5] } },
    { tipo: 'IFCBEAM', nome: 'V2', base: [0, 4, 2.8], eixo: [1, 0, 0], comprimento: 10, perfil: { retangulo: [0.2, 0.5] } },
  ],
});
// Os GlobalIds dos tubos precisam ficar iguais entre revisões (como num modelo de verdade).
const tubo = (nome, x, y0, z, guid) => ({ tipo: 'IFCPIPESEGMENT', nome, base: [x, y0, z], eixo: [0, 1, 0], comprimento: 1, perfil: { raio: 0.05 }, guid });
const hidP01 = (z1, z2, z3) => {
  const txt = makeIfc({ elementos: [tubo('AF-1', 2, -0.5, z1), tubo('AF-2', 5, -0.5, z2), tubo('AF-3', 7, 3.5, z3)] });
  // GlobalIds fixos por nome.
  return txt.replace(/IFCPIPESEGMENT\('[^']+',\$,'(AF-\d)'/g, (_, n) => `IFCPIPESEGMENT('0000000000000000000${n.replace('-', '')}',$,'${n}'`);
};

test('comparação entre revisões, reexecução automática, BCF e pendências', async () => {
  const coord = (await call('POST', '/api/setup', { nome: 'Coord', email: 'c@x', senha: 'segredo1' })).data.token;
  const emp = (await call('POST', '/api/empreendimentos', { nome: 'Torre' }, coord)).data.id;
  const est = (await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Estrutura', tipo: 'M3', disciplina: 'ES' }, coord)).data;
  const hid = (await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Hidráulica', tipo: 'M3', disciplina: 'HD' }, coord)).data;
  await upload(coord, est.id, 'est.ifc', vigas);
  await upload(coord, hid.id, 'hid.ifc', hidP01(2.85, 2.85, 2.85));
  await call('POST', `/api/cde/${emp}/emissoes`, { documento_ids: [est.id, hid.id], estado: 'compartilhado', finalidade: 'S1' }, coord);

  // 1ª análise (versão emitida): 3 colisões.
  let r = await call('POST', `/api/clash/${emp}/analises`, { ladoA: [est.id], ladoB: [hid.id], colisao: true }, coord);
  const first = r.data.id;
  await waitIdle(coord, emp);
  let a1 = (await call('GET', `/api/clash/analises/${first}`, null, coord)).data;
  assert.equal(a1.interferencias.length, 3);
  assert.ok(a1.interferencias.every((c) => c.situacao === 'nova' && /^[0-9a-f-]{36}$/.test(c.guid)));
  assert.equal(a1.resumo.comparacao, undefined, 'primeira análise: nada para comparar');
  const byName = (list, n) => list.find((c) => c.b.nome === n);
  // AF-1 em tratamento com comentário; AF-3 marcada como resolvida (mas não vai ser corrigida).
  await call('PATCH', `/api/clash/analises/${first}/interferencias`, { ids: [byName(a1.interferencias, 'AF-1').id], estado: 'ativa', comentario: 'Baixar 30 cm' }, coord);
  await call('PATCH', `/api/clash/analises/${first}/interferencias`, { ids: [byName(a1.interferencias, 'AF-3').id], estado: 'resolvida' }, coord);

  // Hidráulica P02 (só enviada, ainda em andamento): a análise "emitida" não roda de novo.
  await upload(coord, hid.id, 'hid-p02.ifc', hidP01(2.85, 2.4, 2.85));
  await sleep(300);
  assert.equal((await call('GET', `/api/clash/${emp}`, null, coord)).data.analises.length, 1);
  // Emitida: roda de novo sozinha e compara com a anterior.
  await call('POST', `/api/cde/documentos/${hid.id}/estado`, { estado: 'compartilhado', finalidade: 'S1' }, coord);
  const list = await waitIdle(coord, emp);
  assert.equal(list.length, 2);
  const second = list[0];
  assert.equal(second.automatica, 1);
  assert.equal(second.criado_por, 'automática');
  assert.equal(second.anterior_id, first);
  assert.equal(second.modelos.find((m) => m.documento_id === hid.id).revisao, 'P02');
  const a2 = (await call('GET', `/api/clash/analises/${second.id}`, null, coord)).data;
  const cmp = a2.resumo.comparacao;
  assert.deepEqual([cmp.novas, cmp.mantidas, cmp.reabertas, cmp.resolvidas], [0, 1, 1, 1]);
  assert.equal(cmp.resolvidasLista[0].b.nome, 'AF-2', 'AF-2 baixou: resolvida');
  const af1 = byName(a2.interferencias, 'AF-1');
  assert.equal(af1.situacao, 'mantida');
  assert.equal(af1.estado, 'ativa');
  assert.equal(af1.guid, byName(a1.interferencias, 'AF-1').guid, 'mesmo GUID (BCF) entre análises');
  assert.match(af1.comentarios.map((k) => k.texto).join(' | '), /Baixar 30 cm/);
  const af3 = byName(a2.interferencias, 'AF-3');
  assert.equal(af3.situacao, 'reaberta');
  assert.equal(af3.estado, 'ativa');
  assert.match(af3.comentarios.at(-1).texto, /^Reaberta/);
  assert.equal(a2.anterior.id, first);
  // Na análise anterior, a AF-2 ficou registrada como resolvida pela revisão nova.
  a1 = (await call('GET', `/api/clash/analises/${first}`, null, coord)).data;
  assert.equal(byName(a1.interferencias, 'AF-2').estado, 'resolvida');
  assert.match(byName(a1.interferencias, 'AF-2').comentarios.at(-1).texto, /^Resolvida/);

  // BCF de volta de outro software: AF-1 resolvida com comentário; GUID desconhecido ignorado;
  // reimportar o mesmo arquivo não duplica comentários.
  const bcf = { topicos: [{ guid: af1.guid.toUpperCase(), status: 'Resolved', comentarios: [{ guid: 'c-1', autor: 'revit@obra', data: '2026-11-20T10:00:00Z', texto: 'Tubo rebaixado no Revit' }] }, { guid: 'nao-existe', status: 'Open' }] };
  r = await call('POST', `/api/clash/analises/${second.id}/bcf`, bcf, coord);
  assert.deepEqual(r.data, { topicos: 2, encontrados: 1, estados: 1, comentarios: 1, ignorados: 1 });
  r = await call('POST', `/api/clash/analises/${second.id}/bcf`, bcf, coord);
  assert.equal(r.data.comentarios, 0);
  // Comentários do próprio CDE que voltam no BCF (mesmo GUID) também não duplicam.
  const own = af1.comentarios.find((k) => /Baixar 30 cm/.test(k.texto));
  assert.ok(own.bcf_guid, 'comentário com GUID fixo');
  r = await call('POST', `/api/clash/analises/${second.id}/bcf`, { topicos: [{ guid: af1.guid, status: 'Resolved', comentarios: [{ guid: own.bcf_guid.toUpperCase(), autor: 'x', texto: own.texto }] }] }, coord);
  assert.equal(r.data.comentarios, 0);
  const a2b = (await call('GET', `/api/clash/analises/${second.id}`, null, coord)).data;
  const af1b = byName(a2b.interferencias, 'AF-1');
  assert.equal(af1b.estado, 'resolvida');
  assert.ok(af1b.comentarios.some((k) => k.origem === 'bcf' && k.autor === 'revit@obra'));

  // Pendências para o SmartEasyBIM: só as em aberto da análise mais recente, do documento pedido.
  r = await call('GET', `/api/clash/${emp}/pendencias?documentos=${hid.id}`, null, coord);
  assert.equal(r.data.analises.length, 1);
  assert.equal(r.data.analises[0].analise.id, second.id);
  assert.deepEqual(r.data.analises[0].interferencias.map((c) => c.b.nome), ['AF-3']);
  assert.ok(Array.isArray(r.data.analises[0].analise.origem));
});
