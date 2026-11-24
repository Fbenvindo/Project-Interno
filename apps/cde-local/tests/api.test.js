// Fluxo completo da API do CDE local: configuração, usuários, empreendimento, documentos, envio de
// arquivo, estados, emissão (GRD), download, permissões e persistência do banco no disco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../server/start');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-teste-'));
let srv;
let base;

async function call(method, p, body, token) {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
}

test.before(async () => {
  srv = await startServer({ dataDir, port: 0, host: '127.0.0.1', webDir: path.join(dataDir, 'sem-web') });
  base = `http://127.0.0.1:${srv.port}`;
});
test.after(async () => {
  await srv?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('fluxo completo do CDE local', async () => {
  let r = await call('GET', '/api/status');
  assert.equal(r.data.configurado, false);

  r = await call('POST', '/api/setup', { nome: 'Admin', email: 'admin@escritorio', senha: 'segredo1', empresa: 'Escritório' });
  assert.equal(r.status, 201);
  const admin = r.data.token;
  assert.equal((await call('POST', '/api/setup', { nome: 'X', email: 'x@x', senha: 'segredo1' })).status, 400, 'setup só uma vez');

  assert.equal((await call('GET', '/api/empreendimentos')).status, 401, 'exige login');
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@escritorio', password: 'errada' })).status, 401);

  r = await call('POST', '/api/usuarios', { nome: 'Projetista', email: 'proj@escritorio', senha: 'segredo2', perfil: 'colaborador' }, admin);
  assert.equal(r.status, 201);
  r = await call('POST', '/api/auth/login', { email: 'PROJ@escritorio', password: 'segredo2' });
  assert.equal(r.status, 200, 'e-mail sem diferenciar maiúsculas');
  const colab = r.data.token;
  assert.equal(r.data.user.perfil, 'colaborador');
  assert.equal((await call('GET', '/api/usuarios', null, colab)).status, 403);
  assert.equal((await call('POST', '/api/empreendimentos', { nome: 'X' }, colab)).status, 403);

  r = await call('POST', '/api/empreendimentos', { nome: 'Hotel Centro', cliente: 'Construtora' }, admin);
  const emp = r.data.id;
  assert.equal((await call('PATCH', `/api/cde/${emp}/config`, { projeto: 'htl', originador: 'seb' }, admin)).data.projeto, 'HTL');

  r = await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Planta térreo', tipo: 'DR', disciplina: 'EL', nivel: '00' }, colab);
  assert.equal(r.status, 201);
  const doc = r.data;
  assert.equal(doc.codigo, 'HTL-SEB-ZZ-00-DR-EL-0001');
  r = await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Planta 1º', tipo: 'DR', disciplina: 'EL', nivel: '01' }, colab);
  assert.equal(r.data.numero, '0002', 'numeração da série');
  assert.equal((await call('POST', `/api/cde/${emp}/documentos`, { titulo: 'Repetido', tipo: 'DR', disciplina: 'EL', nivel: '00', numero: '1' }, colab)).status, 409);

  // Compartilhar sem arquivo: recusado.
  assert.equal((await call('POST', `/api/cde/documentos/${doc.id}/estado`, { estado: 'compartilhado', finalidade: 'S1' }, colab)).status, 400);

  // Envio do arquivo pelo link assinado.
  const up = (await call('POST', `/api/cde/documentos/${doc.id}/upload`, { nome: '../planta.pdf', content_type: 'application/pdf' }, colab)).data;
  assert.ok(!up.key.includes('..'));
  const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body: Buffer.from('%PDF-1.4 teste') });
  assert.equal(put.status, 200);
  assert.equal((await fetch(up.url.replace(/\.[^.]+$/, '.x'), { method: 'PUT', body: 'x' })).status, 403, 'link adulterado');
  r = await call('POST', `/api/cde/documentos/${doc.id}/arquivo`, { key: up.key, nome: 'planta.pdf', content_type: 'application/pdf' }, colab);
  assert.equal(r.data.revisao, 'P01');
  assert.equal(r.data.tamanho, 14);

  // Colaborador não publica; emissão compartilha (S1) e numera a GRD.
  assert.equal((await call('POST', `/api/cde/documentos/${doc.id}/estado`, { estado: 'publicado', finalidade: 'A1' }, colab)).status, 400);
  r = await call('POST', `/api/cde/${emp}/emissoes`, { documento_ids: [doc.id], estado: 'compartilhado', finalidade: 'S1', destinatario: 'Obra' }, colab);
  assert.equal(r.status, 201);
  assert.equal(r.data.numero, 'GRD-001');
  assert.equal(r.data.itens[0].revisao, 'P01');

  // Novo arquivo depois de compartilhado: P02 em andamento.
  const up2 = (await call('POST', `/api/cde/documentos/${doc.id}/upload`, { nome: 'planta-v2.pdf' }, colab)).data;
  await fetch(up2.url, { method: 'PUT', headers: up2.headers, body: Buffer.from('%PDF-1.4 v2') });
  r = await call('POST', `/api/cde/documentos/${doc.id}/arquivo`, { key: up2.key, nome: 'planta-v2.pdf' }, colab);
  assert.equal(r.data.revisao, 'P02');

  // Coordenação publica: C01.
  r = await call('POST', `/api/cde/${emp}/emissoes`, { documento_ids: [doc.id], estado: 'publicado', finalidade: 'A1' }, admin);
  assert.equal(r.data.numero, 'GRD-002');
  assert.equal(r.data.itens[0].revisao, 'C01');

  // Download da versão atual e de uma antiga, com nome padronizado.
  r = await call('GET', `/api/cde/documentos/${doc.id}/download`, null, colab);
  assert.equal(r.data.nome, 'HTL-SEB-ZZ-00-DR-EL-0001_C01.pdf');
  assert.equal(await (await fetch(r.data.url)).text(), '%PDF-1.4 v2');
  const hist = (await call('GET', `/api/cde/documentos/${doc.id}/eventos`, null, colab)).data;
  const first = hist.find((h) => h.tipo === 'arquivo' && h.revisao === 'P01');
  r = await call('GET', `/api/cde/documentos/${doc.id}/download?evento=${first.id}`, null, colab);
  assert.equal(await (await fetch(r.data.url)).text(), '%PDF-1.4 teste');

  // Documento emitido não pode ser excluído.
  assert.equal((await call('DELETE', `/api/cde/documentos/${doc.id}`, null, admin)).status, 400);

  // Visão geral.
  r = await call('GET', `/api/cde/${emp}`, null, colab);
  assert.equal(r.data.documentos.length, 2);
  assert.equal(r.data.emissoes.length, 2);
  assert.equal(r.data.podeAprovar, false);
  assert.ok(Array.isArray(r.data.emissoes[0].itens));

  // Administrador desativa o colaborador: o token deixa de valer.
  const colabId = (await call('GET', '/api/usuarios', null, admin)).data.find((u) => u.perfil === 'colaborador').id;
  await call('PATCH', `/api/usuarios/${colabId}`, { ativo: false }, admin);
  assert.equal((await call('GET', '/api/empreendimentos', null, colab)).status, 401);
  // Não dá para ficar sem administrador.
  const adminId = (await call('GET', '/api/auth/me', null, admin)).data.id;
  assert.equal((await call('PATCH', `/api/usuarios/${adminId}`, { perfil: 'colaborador' }, admin)).status, 400);
});

test('dados persistem ao reiniciar o servidor', async () => {
  await srv.close();
  srv = await startServer({ dataDir, port: 0, host: '127.0.0.1', webDir: path.join(dataDir, 'sem-web') });
  base = `http://127.0.0.1:${srv.port}`;
  const login = await call('POST', '/api/auth/login', { email: 'admin@escritorio', password: 'segredo1' });
  assert.equal(login.status, 200);
  const emps = (await call('GET', '/api/empreendimentos', null, login.data.token)).data;
  assert.equal(emps.length, 1);
  assert.equal(emps[0].documentos, 2);
  assert.ok(fs.existsSync(path.join(dataDir, 'backups')), 'cópia de segurança do dia');
});
