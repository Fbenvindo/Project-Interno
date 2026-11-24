const test = require('node:test');
const assert = require('node:assert');
const r = require('../services/cdeRules');

test('código ISO 19650', () => {
  assert.strictEqual(r.docCode({ projeto: 'Htl', originador: 'seb', volume: 'ZZ' }, { nivel: '01', tipo: 'DR', disciplina: 'EL', numero: '3' }), 'HTL-SEB-ZZ-01-DR-EL-0003');
  assert.strictEqual(r.codeField('São João'), 'SAOJOAO');
});

test('revisões: arquivo novo depois de emitido avança; publicar vai para C', () => {
  const doc = { revisao: 'P01', estado: 'andamento', arquivo_key: 'k' };
  assert.strictEqual(r.revisionForUpload(doc, []), 'P01');
  const shared = [{ tipo: 'estado', revisao: 'P01', estado: 'compartilhado' }];
  assert.strictEqual(r.revisionForUpload(doc, shared), 'P02');
  assert.strictEqual(r.revisionForState(doc, 'compartilhado', []), 'P01');
  assert.strictEqual(r.revisionForState({ ...doc, revisao: 'P02' }, 'publicado', shared), 'C01');
  const pub = [...shared, { tipo: 'estado', revisao: 'C01', estado: 'publicado' }];
  assert.strictEqual(r.revisionForUpload({ ...doc, revisao: 'C01' }, pub), 'C02');
  assert.strictEqual(r.revisionForState({ ...doc, revisao: 'C02' }, 'publicado', pub), 'C02');
  assert.strictEqual(r.revisionForState({ ...doc, revisao: 'C01' }, 'publicado', pub), 'C02');
});

test('permissões e validações de estado', () => {
  const doc = { estado: 'andamento', arquivo_key: 'k' };
  assert.match(r.stateChangeError(doc, 'publicado', 'A1', 'user'), /publicar/);
  assert.strictEqual(r.stateChangeError(doc, 'publicado', 'A1', 'coordenador'), null);
  assert.match(r.stateChangeError({ ...doc, arquivo_key: null }, 'compartilhado', 'S1', 'user'), /arquivo/);
  assert.match(r.stateChangeError(doc, 'compartilhado', 'A1', 'user'), /Finalidade/);
  assert.match(r.stateChangeError({ ...doc, estado: 'arquivado' }, 'compartilhado', 'S1', 'admin'), /arquivado/);
});

test('numeração de GRD e nome de arquivo seguro', () => {
  assert.strictEqual(r.nextEmissionNumber(['GRD-001', 'GRD-009']), 'GRD-010');
  assert.strictEqual(r.safeFileName('../Planta arq (rev).pdf'), 'Planta_arq_rev_.pdf');
  assert.strictEqual(r.safeFileName('..'), 'arquivo');
});
