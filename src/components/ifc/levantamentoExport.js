import { CATEGORIAS_SANITARIAS, ORIENTACOES } from '@/components/ifc/ifcLevantamento';

const NOMES_ORIENTACAO = { N: 'Norte', NE: 'Nordeste', L: 'Leste', SE: 'Sudeste', S: 'Sul', SO: 'Sudoeste', O: 'Oeste', NO: 'Noroeste' };

const baixar = (blob, nome) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const nomeBase = (arquivo) => String(arquivo || 'modelo').replace(/\.ifc$/i, '');
const num = (v, casas = 2) => (v == null || Number.isNaN(Number(v)) ? null : Number(Number(v).toFixed(casas)));
const texto = (v) => (v == null || v === '' ? null : v);

export function exportarLevantamentoJson(levantamento, arquivo) {
  baixar(new Blob([JSON.stringify(levantamento, null, 2)], { type: 'application/json' }), `${nomeBase(arquivo)} - levantamento.json`);
}

function adicionarAba(wb, nome, colunas, linhas) {
  const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = colunas.map((c) => ({ header: c.titulo, key: c.chave, width: c.largura || 14, style: c.formato ? { numFmt: c.formato } : {} }));
  linhas.forEach((l) => ws.addRow(l));
  const cabecalho = ws.getRow(1);
  cabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  cabecalho.alignment = { vertical: 'middle', wrapText: true };
  cabecalho.height = 32;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  return ws;
}

const M2 = '#,##0.00';

export async function exportarLevantamentoExcel(levantamento, arquivo) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Project Interno';
  wb.created = new Date();
  const ambs = levantamento.ambientes;
  const idAmb = (a) => ({ pavimento: a.pavimento, numero: a.numero, ambiente: a.nome || a.rotulo });
  const colsAmb = [
    { titulo: 'Pavimento', chave: 'pavimento', largura: 16 },
    { titulo: 'Número', chave: 'numero', largura: 10 },
    { titulo: 'Ambiente', chave: 'ambiente', largura: 26 },
  ];

  adicionarAba(wb, 'Ambientes', [
    ...colsAmb,
    { titulo: 'Uso', chave: 'uso', largura: 22 },
    { titulo: 'Área (m²)', chave: 'area', formato: M2 },
    { titulo: 'Área geométrica (m²)', chave: 'area_geo', formato: M2 },
    { titulo: 'Pé-direito (m)', chave: 'pd', formato: M2 },
    { titulo: 'Volume (m³)', chave: 'vol', formato: M2 },
    { titulo: 'Perímetro (m)', chave: 'per', formato: M2 },
    { titulo: 'Ocupação (pessoas)', chave: 'ocup' },
    ...ORIENTACOES.map((o) => ({ titulo: `Parede ext. ${o} (m²)`, chave: `pe_${o}`, formato: M2, largura: 12 })),
    { titulo: 'Parede ext. total (m²)', chave: 'pe_total', formato: M2 },
    ...ORIENTACOES.map((o) => ({ titulo: `Janela/vidro ext. ${o} (m²)`, chave: `je_${o}`, formato: M2, largura: 12 })),
    { titulo: 'Janela/vidro ext. total (m²)', chave: 'je_total', formato: M2 },
    { titulo: 'Parede interna (m²)', chave: 'pi', formato: M2 },
    { titulo: 'Cobertura / teto exposto (m²)', chave: 'cob', formato: M2 },
    { titulo: 'Piso sobre solo/exterior (m²)', chave: 'piso', formato: M2 },
    { titulo: 'Portas', chave: 'portas' },
    { titulo: 'Aparelhos sanitários', chave: 'sanit' },
    { titulo: 'Acabamento piso', chave: 'ac_piso', largura: 24 },
    { titulo: 'Acabamento parede', chave: 'ac_parede', largura: 24 },
    { titulo: 'Acabamento teto', chave: 'ac_teto', largura: 24 },
    { titulo: 'Rodapé', chave: 'ac_rodape', largura: 18 },
    { titulo: 'Contorno identificado (%)', chave: 'fech' },
    { titulo: 'GUID IFC', chave: 'guid', largura: 24 },
  ], ambs.map((a) => ({
    ...idAmb(a),
    uso: texto(a.uso),
    area: num(a.area_m2),
    area_geo: num(a.area_geometrica_m2),
    pd: num(a.pe_direito_m),
    vol: num(a.volume_m3),
    per: num(a.perimetro_m),
    ocup: num(a.ocupacao, 1),
    ...Object.fromEntries(ORIENTACOES.map((o) => [`pe_${o}`, num(a.totais.parede_externa_por_orientacao[o])])),
    pe_total: num(a.totais.parede_externa_m2),
    ...Object.fromEntries(ORIENTACOES.map((o) => [`je_${o}`, num(a.totais.janela_externa_por_orientacao[o])])),
    je_total: num(a.totais.janela_externa_m2),
    pi: num(a.totais.parede_interna_m2),
    cob: num(a.totais.cobertura_exposta_m2),
    piso: num(a.totais.piso_solo_exterior_m2),
    portas: a.totais.portas,
    sanit: Object.values(a.totais.sanitarios).reduce((x, y) => x + y, 0),
    ac_piso: texto(a.acabamentos.piso.join('; ')),
    ac_parede: texto(a.acabamentos.parede.join('; ')),
    ac_teto: texto(a.acabamentos.teto.join('; ')),
    ac_rodape: texto(a.acabamentos.rodape.join('; ')),
    fech: a.fechamento_identificado_pct,
    guid: a.guid,
  })));

  adicionarAba(wb, 'Superfícies', [
    ...colsAmb,
    { titulo: 'Superfície', chave: 'tipo', largura: 11 },
    { titulo: 'Condição', chave: 'condicao', largura: 18 },
    { titulo: 'Orientação', chave: 'orientacao', largura: 11 },
    { titulo: 'Azimute (°)', chave: 'az', largura: 10 },
    { titulo: 'Área (m²)', chave: 'area', formato: M2 },
    { titulo: 'Divisa com', chave: 'divisa', largura: 22 },
    { titulo: 'Elemento', chave: 'elemento', largura: 34 },
    { titulo: 'Composição (camadas)', chave: 'materiais', largura: 50 },
    { titulo: 'Espessura (m)', chave: 'esp', formato: '0.000' },
    { titulo: 'U (W/m²K)', chave: 'u', formato: '0.000' },
    { titulo: 'Externo (IFC)', chave: 'ext' },
    { titulo: 'Classe IFC', chave: 'ifc', largura: 20 },
  ], ambs.flatMap((a) => a.superficies.map((s) => ({
    ...idAmb(a),
    tipo: s.tipo,
    condicao: s.condicao,
    orientacao: s.orientacao ? NOMES_ORIENTACAO[s.orientacao] : null,
    az: num(s.azimute_graus, 0),
    area: num(s.area_m2),
    divisa: texto(s.divisa_com),
    elemento: texto(s.elemento),
    materiais: texto(s.materiais),
    esp: num(s.espessura_m, 3),
    u: num(s.u, 3),
    ext: s.externo_ifc == null ? null : (s.externo_ifc ? 'Sim' : 'Não'),
    ifc: s.elemento_ifc,
  }))));

  adicionarAba(wb, 'Aberturas', [
    ...colsAmb,
    { titulo: 'Tipo', chave: 'tipo', largura: 14 },
    { titulo: 'Condição', chave: 'condicao', largura: 12 },
    { titulo: 'Orientação', chave: 'orientacao', largura: 11 },
    { titulo: 'Azimute (°)', chave: 'az', largura: 10 },
    { titulo: 'Largura (m)', chave: 'larg', formato: M2 },
    { titulo: 'Altura (m)', chave: 'alt', formato: M2 },
    { titulo: 'Área (m²)', chave: 'area', formato: M2 },
    { titulo: 'Divisa com', chave: 'divisa', largura: 22 },
    { titulo: 'Tipo construtivo', chave: 'tc', largura: 30 },
    { titulo: 'Parede', chave: 'parede', largura: 30 },
    { titulo: 'U (W/m²K)', chave: 'u', formato: '0.000' },
    { titulo: 'Fator solar', chave: 'fs', formato: '0.00' },
    { titulo: 'Nome no IFC', chave: 'nome', largura: 34 },
  ], ambs.flatMap((a) => a.aberturas.map((o) => ({
    ...idAmb(a),
    tipo: o.tipo,
    condicao: o.condicao,
    orientacao: o.orientacao ? NOMES_ORIENTACAO[o.orientacao] : null,
    az: num(o.azimute_graus, 0),
    larg: num(o.largura_m),
    alt: num(o.altura_m),
    area: num(o.area_m2),
    divisa: texto(o.divisa_com),
    tc: texto(o.tipo_construtivo),
    parede: texto(o.parede),
    u: num(o.u, 3),
    fs: num(o.fator_solar),
    nome: texto(o.nome),
  }))));

  const categoriasPresentes = Object.keys(CATEGORIAS_SANITARIAS)
    .filter((c) => ambs.some((a) => a.totais.sanitarios[c]));
  adicionarAba(wb, 'Aparelhos sanitários', [
    ...colsAmb,
    ...categoriasPresentes.map((c) => ({ titulo: CATEGORIAS_SANITARIAS[c], chave: c, largura: 12 })),
    { titulo: 'Total', chave: 'total', largura: 10 },
  ], ambs.filter((a) => Object.keys(a.totais.sanitarios).length).map((a) => ({
    ...idAmb(a),
    ...Object.fromEntries(categoriasPresentes.map((c) => [c, a.totais.sanitarios[c] || null])),
    total: Object.values(a.totais.sanitarios).reduce((x, y) => x + y, 0),
  })));

  adicionarAba(wb, 'Equipamentos', [
    ...colsAmb,
    { titulo: 'Categoria', chave: 'cat', largura: 22 },
    { titulo: 'Tipo construtivo', chave: 'tc', largura: 34 },
    { titulo: 'Potência / carga (IFC)', chave: 'pot', largura: 16 },
    { titulo: 'Classe IFC', chave: 'ifc', largura: 22 },
    { titulo: 'Tipo predefinido', chave: 'pre', largura: 16 },
    { titulo: 'Nome no IFC', chave: 'nome', largura: 40 },
  ], [
    ...ambs.flatMap((a) => a.equipamentos.map((e) => ({
      ...idAmb(a), cat: e.categoria_nome, tc: texto(e.tipo_construtivo), pot: texto(e.potencia), ifc: e.ifc, pre: texto(e.predefinido), nome: texto(e.nome),
    }))),
    ...(levantamento.equipamentos_sem_ambiente || []).map((e) => ({
      pavimento: null, numero: null, ambiente: 'Sem ambiente', cat: e.categoria_nome, tc: texto(e.tipo_construtivo), ifc: e.ifc, nome: texto(e.nome),
    })),
  ]);

  const parametros = ambs.flatMap((a) => a.parametros_ifc.map((p) => ({ ...idAmb(a), pset: p.pset, nome: p.nome, valor: typeof p.valor === 'number' ? num(p.valor, 4) : String(p.valor) })));
  if (parametros.length) {
    adicionarAba(wb, 'Parâmetros IFC', [
      ...colsAmb,
      { titulo: 'Conjunto (Pset)', chave: 'pset', largura: 26 },
      { titulo: 'Parâmetro', chave: 'nome', largura: 32 },
      { titulo: 'Valor', chave: 'valor', largura: 20 },
    ], parametros);
  }

  const info = wb.addWorksheet('Informações');
  info.columns = [{ width: 32 }, { width: 90 }];
  const norte = levantamento.norte_verdadeiro;
  [
    ['Arquivo', arquivo],
    ['Gerado em', new Date(levantamento.gerado_em).toLocaleString('pt-BR')],
    ['Schema IFC', levantamento.schema],
    ['Norte verdadeiro', norte.definido ? `${norte.desvio_graus}° em relação ao norte de projeto (sentido horário)` : 'Não definido no arquivo; usado o norte de projeto'],
    ['Ambientes', ambs.length],
    ['Área total (m²)', num(ambs.reduce((s, a) => s + (a.area_m2 || 0), 0))],
    ['Método', `Fechamentos identificados por amostragem da superfície dos ambientes a cada ${levantamento.amostragem_m} m. Orientação = direção para onde a face aponta (fachada norte olha para o norte). Áreas de janelas/portas usam as dimensões nominais do IFC quando existem.`],
    [],
    ['Avisos', ''],
    ...levantamento.avisos.map((a) => ['', a]),
  ].forEach((r) => info.addRow(r));
  info.getColumn(1).font = { bold: true };
  info.getColumn(2).alignment = { wrapText: true };

  const buffer = await wb.xlsx.writeBuffer();
  baixar(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${nomeBase(arquivo)} - levantamento por ambiente.xlsx`);
}
