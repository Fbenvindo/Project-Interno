// Motor de interferências com IFCs gerados: colisão, folga, elemento dentro de outro,
// elementos que só encostam, longe, coordenadas UTM, agrupamento e cache de geometria.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeIfc } = require('./ifcFixture');
const { extractGeometry, writeCache, readCache } = require('../server/clash/geometry');
const { runClash } = require('../server/clash/engine');

const UTM = [330000, 7390000, 10];
const enc = (s) => new TextEncoder().encode(s);

// Estrutura: duas vigas ao longo de X (seção 0,2 de altura em Z × 0,5 em Y; perfil horizontal:
// [altura, largura]), de z = 2,7 a 2,9 m,
// e uma parede (bloco) grande.
const estrutura = makeIfc({
  deslocamento: UTM,
  elementos: [
    { tipo: 'IFCBEAM', nome: 'V1', base: [0, 0, 2.8], eixo: [1, 0, 0], comprimento: 10, perfil: { retangulo: [0.2, 0.5] } },
    { tipo: 'IFCBEAM', nome: 'V2', base: [0, 4, 2.8], eixo: [1, 0, 0], comprimento: 10, perfil: { retangulo: [0.2, 0.5] } },
    { tipo: 'IFCWALL', nome: 'Parede', base: [20, 0, 0], eixo: [0, 0, 1], comprimento: 3, perfil: { retangulo: [2, 2] } },
  ],
});
// Instalações: tubo cruzando as duas vigas (mesmo tubo → grupo), tubo 3 cm abaixo da V1 (folga),
// tubo longe, caixa dentro da parede e tubo apoiado em cima da V2 (encosta).
const instalacoes = makeIfc({
  deslocamento: UTM,
  elementos: [
    { tipo: 'IFCPIPESEGMENT', nome: 'AF-01', base: [5, -2, 2.9], eixo: [0, 1, 0], comprimento: 8, perfil: { raio: 0.05 } },
    { tipo: 'IFCPIPESEGMENT', nome: 'AF-02', base: [7, -2, 2.62], eixo: [0, 1, 0], comprimento: 4, perfil: { raio: 0.05 } },
    { tipo: 'IFCPIPESEGMENT', nome: 'AF-03', base: [7, 10, 0.5], eixo: [1, 0, 0], comprimento: 3, perfil: { raio: 0.05 } },
    { tipo: 'IFCFLOWTERMINAL', nome: 'Caixa', base: [20, 0, 1], eixo: [0, 0, 1], comprimento: 0.2, perfil: { retangulo: [0.2, 0.2] } },
    { tipo: 'IFCPIPESEGMENT', nome: 'AF-04', base: [2, 4, 2.95], eixo: [1, 0, 0], comprimento: 2, perfil: { raio: 0.05 } },
  ],
});

let est;
let ins;
test.before(async () => {
  est = await extractGeometry(enc(estrutura));
  ins = await extractGeometry(enc(instalacoes));
});

const models = () => [
  { docId: 1, codigo: 'EST', ...est },
  { docId: 2, codigo: 'HID', ...ins },
];

test('colisões físicas, elemento embutido e agrupamento', () => {
  const r = runClash(models(), { ladoA: [0], ladoB: [1], colisao: true, tolerancia: 0.01, folga: false });
  const names = r.interferencias.map((i) => `${i.a.nome}×${i.b.nome}`).sort();
  assert.deepEqual(names, ['Parede×Caixa', 'V1×AF-01', 'V2×AF-01']);
  assert.ok(r.interferencias.every((i) => i.tipo === 'colisao'));
  const af01 = r.interferencias.filter((i) => i.b.nome === 'AF-01');
  assert.equal(af01[0].grupo, af01[1].grupo, 'mesmo tubo nas duas vigas: um grupo');
  assert.match(af01[0].grupoNome, /AF-01/);
  assert.equal(r.interferencias.find((i) => i.b.nome === 'Caixa').grupo, null);
  // Ponto em coordenadas de cena absolutas (X do IFC = x; Z do IFC = y).
  const p = af01.find((i) => i.a.nome === 'V1').ponto;
  assert.ok(Math.abs(p[0] - (UTM[0] + 5)) < 0.1, `x ${p[0]}`);
  assert.ok(Math.abs(p[1] - (UTM[2] + 2.9)) < 0.15, `y ${p[1]}`);
  assert.equal(af01[0].a.pavimento, 'Térreo');
  assert.match(af01[0].b.globalId, /^.{22}$/);
});

test('folga mínima entre elementos que não colidem', () => {
  const r = runClash(models(), { ladoA: [0], ladoB: [1], colisao: true, tolerancia: 0.01, folga: true, distancia: 0.05 });
  const folgas = r.interferencias.filter((i) => i.tipo === 'folga');
  assert.equal(folgas.length, 1);
  assert.equal(folgas[0].b.nome, 'AF-02');
  assert.ok(Math.abs(folgas[0].distancia - 0.03) < 0.003, `distância ${folgas[0].distancia}`);
  // AF-04 só encosta na V2: nem colisão nem folga.
  assert.ok(!r.interferencias.some((i) => i.b.nome === 'AF-04'));
  assert.ok(!r.interferencias.some((i) => i.b.nome === 'AF-03'));
});

test('ignorar tipos e mesmo modelo nos dois lados', () => {
  const r = runClash(models(), { ladoA: [0], ladoB: [1], colisao: true, tolerancia: 0.01, ignorar: ['ifcwall'] });
  assert.ok(!r.interferencias.some((i) => i.a.tipo === 'IFCWALL'));
  // Instalações contra elas mesmas: nenhum par repetido nem elemento contra si mesmo.
  const self = runClash(models(), { ladoA: [1], ladoB: [1], colisao: true, folga: false });
  assert.equal(self.interferencias.length, 0);
});

test('cache de geometria: grava e lê igual', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-geo-'));
  try {
    const f = path.join(dir, 'g.bin');
    writeCache(f, est);
    const g = readCache(f);
    assert.deepEqual(g.origem, est.origem);
    assert.equal(g.elementos.length, est.elementos.length);
    assert.deepEqual(Array.from(g.positions), Array.from(est.positions));
    assert.deepEqual(Array.from(g.indices), Array.from(est.indices));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
