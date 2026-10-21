import * as THREE from 'three';
import { azimute, criarContexto, setorDe } from '@/components/ifc/ifcLevantamento';

// Gera um caso OpenFOAM (linha openfoam.com / ESI) para o escoamento de ar e a temperatura
// dentro de um ambiente: geometria STL do volume de ar com regiões nomeadas, malha
// blockMesh + snappyHexMesh, janelas/portas/difusores recortados com topoSet + createPatch,
// e condições de contorno para buoyantSimpleFoam (regime permanente, empuxo, k-epsilon).

export const PARAMETROS_PADRAO = {
  tamanhoCelula: 0.15, // m
  tExterna: 35, // °C
  tSolo: 25,
  tInicial: 24,
  tInsuflamento: 14,
  trocasHora: 6, // renovações de ar por hora usadas para a vazão de insuflamento
  uParede: 2.5, // W/m²K, usados quando o IFC não informa a transmitância
  uJanela: 5.7,
  uCobertura: 2.0,
  uPorta: 3.0,
  uPiso: 1.5,
};

const TIPOS_TERMINAL = new Set(['IFCAIRTERMINAL', 'IFCFLOWTERMINAL', 'IFCAIRTERMINALBOX', 'IFCUNITARYEQUIPMENT']);
const REGEX_TERMINAL = /diffuser|difusor|grille|grelha|register|registro|louvre|veneziana|airterminal|insufla|retorno|return|exhaust|exaust|supply|vent/;
const REGEX_RETORNO = /return|retorno|exhaust|exaust|extra[cç]|extract|recircula/;

const KELVIN = 273.15;
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const n6 = (v) => Number(v.toFixed(6));
const fmtVec = (v) => `(${n6(v[0])} ${n6(v[1])} ${n6(v[2])})`;

// Cena (Y para cima) -> OpenFOAM (Z para cima, X e Y iguais aos do plano IFC)
const paraOF = (v) => [v.x, -v.z, v.y];

function cabecalho(classe, objeto, local) {
  return `/*--------------------------------*- C++ -*----------------------------------*\\
  Caso gerado pelo Project Interno a partir de um modelo IFC
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       ${classe};${local ? `\n    location    "${local}";` : ''}
    object      ${objeto};
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

`;
}

const rodape = '\n// ************************************************************************* //\n';

// Subdivide triângulos até a maior aresta ficar abaixo de maxAresta (divisão em 4 pelos pontos médios)
function subdividir(tri, maxAresta, saida) {
  const [a, b, c] = tri;
  const maior = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  if (maior <= maxAresta) { saida.push(tri); return; }
  const ab = a.clone().add(b).multiplyScalar(0.5);
  const bc = b.clone().add(c).multiplyScalar(0.5);
  const ca = c.clone().add(a).multiplyScalar(0.5);
  subdividir([a, ab, ca], maxAresta, saida);
  subdividir([ab, b, bc], maxAresta, saida);
  subdividir([ca, bc, c], maxAresta, saida);
  subdividir([ab, bc, ca], maxAresta, saida);
}

function nomeRegiao(tipoFace, condicao, setor) {
  if (tipoFace === 'Piso') return condicao === 'Interna' ? 'piso_interno' : 'piso_externo';
  if (tipoFace === 'Teto') return condicao === 'Interna' ? 'teto_interno' : 'cobertura';
  if (condicao === 'Interna') return 'parede_interna';
  if (condicao === 'Externa') return `parede_externa_${setor || 'N'}`;
  return 'parede_sem_elemento';
}

// Caixa (coordenadas OpenFOAM) de um elemento, alongada na direção mais fina (espessura da parede/forro)
// para alcançar a face do ambiente, e justa nas demais
function caixaDeRecorte(boxCena, origem, alongar = 0.3, folga = 0.02) {
  const pMin = paraOF(boxCena.min);
  const pMax = paraOF(boxCena.max);
  const min = [Math.min(pMin[0], pMax[0]), Math.min(pMin[1], pMax[1]), Math.min(pMin[2], pMax[2])];
  const max = [Math.max(pMin[0], pMax[0]), Math.max(pMin[1], pMax[1]), Math.max(pMin[2], pMax[2])];
  const dims = [0, 1, 2].map((i) => max[i] - min[i]);
  const fino = dims.indexOf(Math.min(...dims));
  const outros = dims.filter((_, i) => i !== fino);
  // Parede oblíqua: a caixa não é fina em nenhum eixo horizontal; alonga os dois um pouco
  const obliquo = fino !== 2 && dims[fino] > 0.5 * Math.min(...outros);
  for (let i = 0; i < 3; i++) {
    let d = folga;
    if (i === fino) d = alongar;
    else if (obliquo && i !== 2) d = alongar / 2;
    min[i] -= d;
    max[i] += d;
  }
  return { min: min.map((v, i) => v - origem[i]), max: max.map((v, i) => v - origem[i]) };
}

export async function gerarCasoOpenFOAM(engine, ambienteId, parametros = {}) {
  const P = { ...PARAMETROS_PADRAO, ...parametros };
  const ctx = criarContexto(engine);
  const { norte, caixas, malhasEspacos, tipoIfc, infoElemento, rotuloEspaco, pontoDentro } = ctx;
  if (!malhasEspacos.has(ambienteId)) throw new Error('O ambiente não tem geometria no IFC.');
  const avisos = [];
  if (!norte.definido) avisos.push('O arquivo não define o norte verdadeiro; as orientações usam o norte de projeto.');

  const { triangulos, volume } = ctx.triangulosDoEspaco(ambienteId);
  const candidatos = ctx.candidatosDoEspaco(ambienteId);
  const caixaCena = caixas.get(ambienteId);
  const pMin = paraOF(caixaCena.min);
  const pMax = paraOF(caixaCena.max);
  const origem = [Math.min(pMin[0], pMax[0]), Math.min(pMin[1], pMax[1]), Math.min(pMin[2], pMax[2])];
  const tamanho = [0, 1, 2].map((i) => Math.abs(pMax[i] - pMin[i]));

  // ---- Superfície do ambiente classificada em regiões ----
  const maxAresta = Math.min(0.6, Math.max(0.3, 2 * P.tamanhoCelula));
  const regioes = new Map(); // nome -> { faces: [], area, elementos: Map(id -> area) }
  const aberturas = new Map(); // id -> { classe, area, condicoes: Map, setores: Map }
  const normal = new THREE.Vector3();
  const centro = new THREE.Vector3();
  for (const tri of triangulos) {
    const pedacos = [];
    subdividir(tri, maxAresta, pedacos);
    for (const [a, b, c] of pedacos) {
      normal.crossVectors(b.clone().sub(a), c.clone().sub(a));
      const area = normal.length() / 2;
      if (area < 1e-6) continue;
      normal.multiplyScalar(1 / (2 * area));
      const tipoFace = ctx.tipoDaFace(normal);
      const setor = tipoFace === 'Parede' ? setorDe(azimute(normal, norte)) : null;
      centro.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const { elemento, condicao } = ctx.lancarRaio(centro, normal, tipoFace, candidatos);
      // Janelas e portas ficam na parede; viram patches próprios depois, pelo topoSet
      const nome = nomeRegiao(tipoFace, condicao, setor);
      const reg = regioes.get(nome) || { faces: [], area: 0, elementos: new Map() };
      reg.faces.push({ n: [normal.x, -normal.z, normal.y], v: [a, b, c].map(paraOF) });
      reg.area += area;
      if (elemento) {
        if (elemento.classe === 'vedacao') reg.elementos.set(elemento.id, (reg.elementos.get(elemento.id) || 0) + area);
        else {
          const ab = aberturas.get(elemento.id) || { classe: elemento.classe, area: 0, condicoes: new Map(), setores: new Map() };
          ab.area += area;
          ab.condicoes.set(condicao, (ab.condicoes.get(condicao) || 0) + area);
          if (setor) ab.setores.set(setor, (ab.setores.get(setor) || 0) + area);
          aberturas.set(elemento.id, ab);
        }
      }
      regioes.set(nome, reg);
    }
  }

  // Transmitância média ponderada pela área quando o IFC informa U nos elementos
  const uDaRegiao = async (reg, padrao) => {
    let soma = 0;
    let areaComU = 0;
    for (const [id, area] of reg.elementos) {
      const info = await infoElemento(id);
      if (info.u != null && info.u > 0) { soma += info.u * area; areaComU += area; }
    }
    return areaComU > 0.5 * reg.area ? { valor: soma / areaComU, origem: 'IFC' } : { valor: padrao, origem: 'padrão' };
  };

  const patches = []; // { nome, tipo: 'parede'|'entrada'|'saida', termico: {...}, area, descricao }
  for (const [nome, reg] of regioes) {
    let termico = { modo: 'adiabatico' };
    if (nome.startsWith('parede_externa')) termico = { modo: 'externo', ta: 'T_externa', ...(await uDaRegiao(reg, P.uParede)) };
    else if (nome === 'cobertura') termico = { modo: 'externo', ta: 'T_externa', ...(await uDaRegiao(reg, P.uCobertura)) };
    else if (nome === 'piso_externo') termico = { modo: 'externo', ta: 'T_solo', ...(await uDaRegiao(reg, P.uPiso)) };
    patches.push({ nome, tipo: 'parede', termico, area: reg.area, descricao: 'Superfície do ambiente' });
  }

  // ---- Janelas, portas e vidros: recortados das paredes ----
  const dominante = (m) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  const recortes = [];
  let contJanela = 0;
  let contPorta = 0;
  let contVidro = 0;
  for (const [id, ab] of aberturas) {
    if (ab.area < 0.05 || !caixas.has(id)) continue;
    const info = await infoElemento(id);
    const condicao = dominante(ab.condicoes);
    const externa = condicao === 'Externa';
    const setor = dominante(ab.setores) || 'N';
    let nome;
    if (ab.classe === 'janela') nome = `janela_${++contJanela}_${externa ? setor : 'interna'}`;
    else if (ab.classe === 'vidro') nome = `vidro_${++contVidro}_${externa ? setor : 'interno'}`;
    else nome = `porta_${++contPorta}_${externa ? 'externa' : 'interna'}`;
    const padrao = ab.classe === 'porta' ? P.uPorta : P.uJanela;
    const termico = externa
      ? { modo: 'externo', ta: 'T_externa', valor: info.u ?? padrao, origem: info.u != null ? 'IFC' : 'padrão' }
      : { modo: 'adiabatico' };
    const patch = { nome, tipo: 'parede', termico, area: ab.area, descricao: info.tipo_construtivo || info.nome, porta: ab.classe === 'porta', externa };
    patches.push(patch);
    recortes.push({ patch, caixa: caixaDeRecorte(caixas.get(id), origem), origemPatches: 'parede_.*' });
  }

  // ---- Terminais de ar (insuflamento e retorno) ----
  const centroCena = caixaCena.getCenter(new THREE.Vector3());
  const zonaTerminais = caixaCena.clone().expandByScalar(0.4);
  const terminais = [];
  for (const [id, meshes] of engine.meshesById) {
    if (!meshes.length || !TIPOS_TERMINAL.has(tipoIfc(id))) continue;
    const cx = caixas.get(id);
    if (!cx || !cx.intersectsBox(zonaTerminais)) continue;
    const info = await infoElemento(id);
    const texto = semAcento(`${info.nome} ${info.tipo_construtivo} ${info.predefinido} ${info.ifc}`);
    if (info.ifc !== 'IFCAIRTERMINAL' && !REGEX_TERMINAL.test(texto)) continue;
    // O terminal precisa estar sobre o ambiente: o centro em planta, na altura média do ambiente, fica dentro dele
    const c = cx.getCenter(new THREE.Vector3());
    if (!pontoDentro(new THREE.Vector3(c.x, centroCena.y, c.z), malhasEspacos.get(ambienteId))) continue;
    terminais.push({ id, info, retorno: REGEX_RETORNO.test(texto) });
  }
  let entradas = terminais.filter((t) => !t.retorno);
  const saidas = terminais.filter((t) => t.retorno);
  const vazaoTotal = (volume * P.trocasHora) / 3600;

  // Sem retorno: o ar sai pelas portas internas (fresta/abertura). Sem nenhuma saída, o insuflamento é desligado.
  const portasComoSaida = !saidas.length && entradas.length
    ? patches.filter((p) => p.porta && !p.externa)
    : [];
  if (entradas.length && !saidas.length && !portasComoSaida.length) {
    avisos.push('Há insuflamento mas nenhuma saída de ar (retorno ou porta interna). O caso foi gerado só com convecção natural; defina uma saída para usar o insuflamento.');
    entradas = [];
  } else if (portasComoSaida.length) {
    avisos.push(`Sem grelha de retorno no ambiente: o ar sai pela(s) porta(s) interna(s) (${portasComoSaida.map((p) => p.nome).join(', ')}).`);
    portasComoSaida.forEach((p) => { p.tipo = 'saida'; p.termico = { modo: 'adiabatico' }; });
  }
  if (!terminais.length) avisos.push('Nenhum difusor ou grelha encontrado no ambiente: o caso simula apenas convecção natural (paredes, vidros e cobertura).');

  const regioesRefino = [];
  entradas.forEach((t, i) => {
    const patch = {
      nome: `insuflamento_${i + 1}`, tipo: 'entrada', vazao: vazaoTotal / entradas.length, area: 0,
      descricao: t.info.tipo_construtivo || t.info.nome, termico: { modo: 'insuflamento' },
    };
    patches.push(patch);
    const caixa = caixaDeRecorte(caixas.get(t.id), origem);
    recortes.push({ patch, caixa, origemPatches: '(teto_.*|cobertura|parede_.*)' });
    regioesRefino.push({ nome: `refino_${patch.nome}`, caixa });
  });
  saidas.forEach((t, i) => {
    const patch = { nome: `retorno_${i + 1}`, tipo: 'saida', area: 0, descricao: t.info.tipo_construtivo || t.info.nome, termico: { modo: 'adiabatico' } };
    patches.push(patch);
    const caixa = caixaDeRecorte(caixas.get(t.id), origem);
    recortes.push({ patch, caixa, origemPatches: '(teto_.*|cobertura|parede_.*)' });
    regioesRefino.push({ nome: `refino_${patch.nome}`, caixa });
  });

  // ---- Ponto dentro do ambiente para o snappyHexMesh ----
  const meshesAmb = malhasEspacos.get(ambienteId);
  let pontoInterno = null;
  const tentativas = [[0.5, 0.5, 0.5], [0.37, 0.41, 0.43], [0.63, 0.59, 0.47], [0.3, 0.7, 0.5], [0.7, 0.3, 0.5], [0.25, 0.25, 0.5], [0.75, 0.75, 0.5]];
  for (const [fx, fy, fz] of tentativas) {
    const p = new THREE.Vector3(
      caixaCena.min.x + fx * (caixaCena.max.x - caixaCena.min.x),
      caixaCena.min.y + fz * (caixaCena.max.y - caixaCena.min.y),
      caixaCena.min.z + fy * (caixaCena.max.z - caixaCena.min.z),
    );
    if (pontoDentro(p, meshesAmb)) { pontoInterno = p; break; }
  }
  if (!pontoInterno) throw new Error('Não foi possível achar um ponto dentro do ambiente para a malha.');
  // Pequeno deslocamento para o ponto não cair exatamente numa face da malha de fundo
  const locationInMesh = paraOF(pontoInterno).map((v, i) => v - origem[i] + 0.0137 * (i + 1));

  const rotulo = rotuloEspaco.get(ambienteId);
  const caso = {
    rotulo, P, volume, tamanho, origem, norte, locationInMesh, patches, recortes, regioesRefino, regioes,
    vazaoTotal, nEntradas: entradas.length, avisos,
  };
  return { arquivos: montarArquivos(caso), resumo: resumoCaso(caso) };
}

function resumoCaso(caso) {
  return {
    ambiente: caso.rotulo,
    volume_m3: caso.volume,
    dimensoes_m: caso.tamanho,
    celulas_estimadas: Math.round(caso.volume / caso.P.tamanhoCelula ** 3),
    vazao_insuflamento_m3s: caso.nEntradas ? caso.vazaoTotal : 0,
    patches: caso.patches.map((p) => ({ nome: p.nome, tipo: p.tipo, area_m2: p.area, termico: p.termico, descricao: p.descricao })),
    avisos: caso.avisos,
  };
}

function stl(caso) {
  const partes = [];
  for (const [nome, reg] of caso.regioes) {
    partes.push(`solid ${nome}`);
    for (const f of reg.faces) {
      partes.push(` facet normal ${n6(f.n[0])} ${n6(f.n[1])} ${n6(f.n[2])}`, '  outer loop');
      for (const v of f.v) partes.push(`   vertex ${n6(v[0] - caso.origem[0])} ${n6(v[1] - caso.origem[1])} ${n6(v[2] - caso.origem[2])}`);
      partes.push('  endloop', ' endfacet');
    }
    partes.push(`endsolid ${nome}`);
  }
  return `${partes.join('\n')}\n`;
}

function blockMeshDict(caso) {
  const h = caso.P.tamanhoCelula;
  const margem = 2 * h;
  const min = [-margem, -margem, -margem];
  const max = caso.tamanho.map((t) => t + margem);
  const n = [0, 1, 2].map((i) => Math.max(1, Math.ceil((max[i] - min[i]) / h)));
  const v = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
  return `${cabecalho('dictionary', 'blockMeshDict', 'system')}// Malha de fundo: caixa envolvente do ambiente com células de ${h} m
scale 1;

vertices
(
${v.map((p) => `    ${fmtVec(p)}`).join('\n')}
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (${n.join(' ')}) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    fundo
    {
        type wall;
        faces
        (
            (3 7 6 2)
            (0 4 7 3)
            (2 6 5 1)
            (1 5 4 0)
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);

mergePatchPairs
(
);
${rodape}`;
}

function snappyHexMeshDict(caso) {
  const regioes = [...caso.regioes.keys()];
  const caixas = caso.regioesRefino.map((r) => `    ${r.nome}
    {
        type searchableBox;
        min ${fmtVec(r.caixa.min)};
        max ${fmtVec(r.caixa.max)};
    }`).join('\n');
  const refino = caso.regioesRefino.map((r) => `        ${r.nome}
        {
            mode inside;
            levels ((1e15 2));
        }`).join('\n');
  return `${cabecalho('dictionary', 'snappyHexMeshDict', 'system')}castellatedMesh true;
snap            true;
addLayers       false;

geometry
{
    ambiente.stl
    {
        type triSurfaceMesh;
        name ambiente;
        regions
        {
${regioes.map((r) => `            ${r} { name ${r}; }`).join('\n')}
        }
    }
${caixas}
}

castellatedMeshControls
{
    maxLocalCells       2000000;
    maxGlobalCells      10000000;
    minRefinementCells  10;
    maxLoadUnbalance    0.10;
    nCellsBetweenLevels 3;

    features
    (
        {
            file "ambiente.eMesh";
            level 1;
        }
    );

    refinementSurfaces
    {
        ambiente
        {
            level (1 1);
            patchInfo
            {
                type wall;
            }
        }
    }

    resolveFeatureAngle 30;

    refinementRegions
    {
${refino}
    }

    // Ponto dentro do volume de ar do ambiente
    locationInMesh ${fmtVec(caso.locationInMesh)};
    allowFreeStandingZoneFaces true;
}

snapControls
{
    nSmoothPatch 3;
    tolerance 2.0;
    nSolveIter 50;
    nRelaxIter 5;
    nFeatureSnapIter 10;
    implicitFeatureSnap false;
    explicitFeatureSnap true;
    multiRegionFeatureSnap true;
}

addLayersControls
{
    relativeSizes true;
    layers
    {
    }
    expansionRatio 1.2;
    finalLayerThickness 0.5;
    minThickness 0.1;
    nGrow 0;
    featureAngle 60;
    slipFeatureAngle 30;
    nRelaxIter 3;
    nSmoothSurfaceNormals 1;
    nSmoothNormals 3;
    nSmoothThickness 10;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3;
    minMedialAxisAngle 90;
    nBufferCellsNoExtrude 0;
    nLayerIter 50;
}

meshQualityControls
{
    maxNonOrtho 65;
    maxBoundarySkewness 20;
    maxInternalSkewness 4;
    maxConcave 80;
    minVol 1e-13;
    minTetQuality 1e-15;
    minArea -1;
    minTwist 0.02;
    minDeterminant 0.001;
    minFaceWeight 0.05;
    minVolRatio 0.01;
    minTriangleTwist -1;
    nSmoothScale 4;
    errorReduction 0.75;
    relaxed
    {
        maxNonOrtho 75;
    }
}

mergeTolerance 1e-6;
${rodape}`;
}

function surfaceFeatureExtractDict() {
  return `${cabecalho('dictionary', 'surfaceFeatureExtractDict', 'system')}ambiente.stl
{
    extractionMethod    extractFromSurface;

    extractFromSurfaceCoeffs
    {
        includedAngle   150;
    }

    subsetFeatures
    {
        nonManifoldEdges    no;
        openEdges           yes;
    }

    writeObj            no;
}
${rodape}`;
}

function topoSetDict(caso) {
  const acoes = caso.recortes.map((r) => `    // ${r.patch.descricao || r.patch.nome}
    {
        name    ${r.patch.nome};
        type    faceSet;
        action  new;
        source  patchToFace;
        patch   "${r.origemPatches}";
    }
    {
        name    ${r.patch.nome};
        type    faceSet;
        action  subset;
        source  boxToFace;
        box     ${fmtVec(r.caixa.min)} ${fmtVec(r.caixa.max)};
    }`).join('\n');
  return `${cabecalho('dictionary', 'topoSetDict', 'system')}// Seleciona as faces das paredes/teto que ficam dentro da caixa de cada janela, porta e difusor do IFC
actions
(
${acoes}
);
${rodape}`;
}

function createPatchDict(caso) {
  const itens = caso.recortes.map((r) => `    {
        name ${r.patch.nome};
        patchInfo
        {
            type ${r.patch.tipo === 'parede' ? 'wall' : 'patch'};
        }
        constructFrom set;
        set ${r.patch.nome};
    }`).join('\n');
  return `${cabecalho('dictionary', 'createPatchDict', 'system')}pointSync false;

patches
(
${itens}
);
${rodape}`;
}

function parametrosInclude(caso) {
  const P = caso.P;
  return `${cabecalho('dictionary', 'parametros', '0/include')}// Parâmetros do caso. Edite aqui e rode novamente o solver.
T_externa       ${n6(P.tExterna + KELVIN)};   // ${P.tExterna} °C
T_solo          ${n6(P.tSolo + KELVIN)};   // ${P.tSolo} °C
T_inicial       ${n6(P.tInicial + KELVIN)};   // ${P.tInicial} °C
T_insuflamento  ${n6(P.tInsuflamento + KELVIN)};   // ${P.tInsuflamento} °C
p_ref           1e5;
k_inicial       1e-3;
epsilon_inicial 1e-4;
${rodape}`;
}

function campoU(caso) {
  const linhas = caso.patches.map((p) => {
    if (p.tipo === 'entrada') {
      return `    ${p.nome}
    {
        // ${n6(p.vazao)} m³/s (${n6(p.vazao * 3600)} m³/h)
        type                flowRateInletVelocity;
        volumetricFlowRate  constant ${n6(p.vazao)};
        value               uniform (0 0 0);
    }`;
    }
    if (p.tipo === 'saida') {
      return `    ${p.nome}
    {
        type        inletOutlet;
        inletValue  uniform (0 0 0);
        value       uniform (0 0 0);
    }`;
    }
    return `    ${p.nome}
    {
        type noSlip;
    }`;
  });
  return `${cabecalho('volVectorField', 'U', '0')}dimensions      [0 1 -1 0 0 0 0];

internalField   uniform (0 0 0);

boundaryField
{
    fundo
    {
        type noSlip;
    }
${linhas.join('\n')}
}
${rodape}`;
}

function campoT(caso) {
  const linhas = caso.patches.map((p) => {
    const t = p.termico;
    if (p.tipo === 'entrada') {
      return `    ${p.nome}
    {
        type    fixedValue;
        value   uniform $T_insuflamento;
    }`;
    }
    if (p.tipo === 'saida') {
      return `    ${p.nome}
    {
        type        inletOutlet;
        inletValue  $internalField;
        value       $internalField;
    }`;
    }
    if (t.modo === 'externo') {
      return `    ${p.nome}
    {
        // U = ${n6(t.valor)} W/m²K (${t.origem}), ambiente externo a $${t.ta}
        type            externalWallHeatFluxTemperature;
        mode            coefficient;
        Ta              constant $${t.ta};
        h               uniform ${n6(t.valor)};
        kappaMethod     fluidThermo;
        value           $internalField;
    }`;
    }
    return `    ${p.nome}
    {
        type zeroGradient;
    }`;
  });
  return `${cabecalho('volScalarField', 'T', '0')}#include "include/parametros"

dimensions      [0 0 0 1 0 0 0];

internalField   uniform $T_inicial;

boundaryField
{
    fundo
    {
        type zeroGradient;
    }
${linhas.join('\n')}
}
${rodape}`;
}

// Campo com o mesmo tratamento para paredes, entradas e saídas
function campoPorTipo(caso, { classe, objeto, dimensoes, interno, parede, entrada, saida, include = false }) {
  const bloco = (nome, corpo) => `    ${nome}\n    {\n${corpo.map((l) => `        ${l}`).join('\n')}\n    }`;
  const linhas = caso.patches.map((p) => {
    const corpo = p.tipo === 'entrada' ? entrada : p.tipo === 'saida' ? saida : parede;
    return bloco(p.nome, corpo);
  });
  return `${cabecalho(classe, objeto, '0')}${include ? '#include "include/parametros"\n\n' : ''}dimensions      ${dimensoes};

internalField   ${interno};

boundaryField
{
${bloco('fundo', parede)}
${linhas.join('\n')}
}
${rodape}`;
}

function controlDict() {
  return `${cabecalho('dictionary', 'controlDict', 'system')}application     buoyantSimpleFoam;

startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         3000;
deltaT          1;

writeControl    timeStep;
writeInterval   500;
purgeWrite      2;
writeFormat     ascii;
writePrecision  7;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable true;
${rodape}`;
}

function fvSchemes() {
  return `${cabecalho('dictionary', 'fvSchemes', 'system')}ddtSchemes
{
    default         steadyState;
}

gradSchemes
{
    default         Gauss linear;
}

// Primeira ordem (upwind) para robustez. Depois de convergir, troque por
// "bounded Gauss linearUpwind grad(U)" etc. para mais precisão.
divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss upwind;
    div(phi,h)      bounded Gauss upwind;
    div(phi,K)      bounded Gauss upwind;
    div(phi,Ekp)    bounded Gauss upwind;
    div(phi,k)      bounded Gauss upwind;
    div(phi,epsilon) bounded Gauss upwind;
    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;
}

laplacianSchemes
{
    default         Gauss linear limited corrected 0.33;
}

interpolationSchemes
{
    default         linear;
}

snGradSchemes
{
    default         limited corrected 0.33;
}

wallDist
{
    method          meshWave;
}
${rodape}`;
}

function fvSolution() {
  return `${cabecalho('dictionary', 'fvSolution', 'system')}solvers
{
    "rho.*"
    {
        solver          PCG;
        preconditioner  DIC;
        tolerance       0;
        relTol          0;
    }

    p_rgh
    {
        solver          GAMG;
        smoother        GaussSeidel;
        tolerance       1e-7;
        relTol          0.01;
    }

    "(U|h|e|k|epsilon)"
    {
        solver          PBiCGStab;
        preconditioner  DILU;
        tolerance       1e-7;
        relTol          0.1;
    }
}

SIMPLE
{
    momentumPredictor no;
    nNonOrthogonalCorrectors 1;
    pRefCell        0;
    pRefValue       1e5;

    residualControl
    {
        p_rgh           1e-4;
        U               1e-4;
        h               1e-5;
        "(k|epsilon)"   1e-4;
    }
}

relaxationFactors
{
    fields
    {
        rho             1.0;
        p_rgh           0.7;
    }
    equations
    {
        U               0.3;
        h               0.3;
        "(k|epsilon)"   0.5;
    }
}
${rodape}`;
}

const constantes = {
  g: () => `${cabecalho('uniformDimensionedVectorField', 'g', 'constant')}dimensions      [0 1 -2 0 0 0 0];
value           (0 0 -9.81);
${rodape}`,
  thermophysicalProperties: () => `${cabecalho('dictionary', 'thermophysicalProperties', 'constant')}thermoType
{
    type            heRhoThermo;
    mixture         pureMixture;
    transport       const;
    thermo          hConst;
    equationOfState incompressiblePerfectGas;
    specie          specie;
    energy          sensibleEnthalpy;
}

// Ar. incompressiblePerfectGas: densidade varia só com a temperatura (rho = pRef/(R T)),
// adequado para ventilação de ambientes
mixture
{
    specie
    {
        molWeight       28.96;
    }
    equationOfState
    {
        pRef            1e5;
    }
    thermodynamics
    {
        Cp              1004.4;
        Hf              0;
    }
    transport
    {
        mu              1.831e-05;
        Pr              0.705;
    }
}
${rodape}`,
  turbulenceProperties: () => `${cabecalho('dictionary', 'turbulenceProperties', 'constant')}simulationType  RAS;

RAS
{
    RASModel        kEpsilon;
    turbulence      on;
    printCoeffs     on;
}
${rodape}`,
  radiationProperties: () => `${cabecalho('dictionary', 'radiationProperties', 'constant')}radiation       off;
radiationModel  none;
${rodape}`,
};

function allrun() {
  return `#!/bin/sh
# Malha + simulação. Rode num terminal com o ambiente do OpenFOAM carregado
# (ex.: source /usr/lib/openfoam/openfoam2312/etc/bashrc).
cd "\${0%/*}" || exit 1

rodar() {
    app="$1"
    if [ -f "log.$app" ]; then
        echo "$app já rodou (log.$app); pulando. Use ./Allclean para recomeçar."
        return 0
    fi
    echo "Rodando $app..."
    "$@" > "log.$app" 2>&1 || { echo "Falhou: $app. Veja log.$app"; exit 1; }
}

rodar surfaceFeatureExtract
rodar blockMesh
rodar snappyHexMesh -overwrite
rodar topoSet
rodar createPatch -overwrite
rodar checkMesh
[ -d 0 ] || cp -r 0.orig 0
rodar buoyantSimpleFoam
echo "Concluído. Abra caso.foam no ParaView."
`;
}

function allclean() {
  return `#!/bin/sh
cd "\${0%/*}" || exit 1
rm -rf 0 [1-9]* constant/polyMesh constant/extendedFeatureEdgeMesh constant/triSurface/*.eMesh
rm -rf processor* postProcessing log.*
`;
}

function readme(caso) {
  const P = caso.P;
  const linhasPatches = caso.patches.map((p) => {
    const t = p.termico;
    const termico = p.tipo === 'entrada' ? `insuflamento ${n6(p.vazao * 3600)} m³/h a ${P.tInsuflamento} °C`
      : p.tipo === 'saida' ? 'saída de ar (pressão)'
        : t.modo === 'externo' ? `troca com ${t.ta === 'T_solo' ? 'o solo' : 'o exterior'}, U ${t.valor.toFixed(2)} W/m²K (${t.origem})`
          : 'adiabática';
    return `| \`${p.nome}\` | ${p.area ? p.area.toFixed(2) : '—'} | ${termico} | ${p.descricao || ''} |`;
  }).join('\n');
  const norteAng = (Math.atan2(caso.norte.x, caso.norte.y) * 180) / Math.PI;
  return `# Caso OpenFOAM — ${caso.rotulo}

Gerado pelo Project Interno a partir do modelo IFC: escoamento de ar e temperatura dentro do ambiente,
em regime permanente, com empuxo (\`buoyantSimpleFoam\`, k-epsilon).

Feito para a linha **openfoam.com (ESI)** e testado no **v2412**; use uma versão recente dessa linha
(\`openfoam2312\`, \`openfoam2406\`, \`openfoam2412\`...). Na linha openfoam.org (v10+), os nomes de solver e de
alguns dicionários são diferentes e o caso precisa de adaptação.

Atenção: o pacote \`openfoam\` (v1912) dos repositórios do Ubuntu/Debian tem um defeito nos solvers com empuxo
em malhas não ortogonais, e o caso diverge nele. Instale pelo repositório oficial (dl.openfoam.com), Docker ou conda-forge.

## Como rodar

\`\`\`sh
chmod +x Allrun Allclean
./Allrun             # malha (snappyHexMesh) + simulação
paraFoam             # ou: touch caso.foam e abrir no ParaView
\`\`\`

Os logs ficam em \`log.*\`. Para recomeçar do zero: \`./Allclean\`.

## Ambiente

- Volume: ${caso.volume.toFixed(2)} m³; caixa envolvente ${caso.tamanho.map((t) => t.toFixed(2)).join(' × ')} m
- Células de ${P.tamanhoCelula} m (≈ ${Math.round(caso.volume / P.tamanhoCelula ** 3).toLocaleString('pt-BR')} células), refinadas junto às superfícies e aos difusores
- Vazão de insuflamento: ${caso.nEntradas ? `${(caso.vazaoTotal * 3600).toFixed(1)} m³/h (${P.trocasHora} trocas/h)` : 'sem insuflamento'}

## Patches

| Patch | Área (m²) | Condição | Origem no IFC |
|---|---|---|---|
${linhasPatches}

Os patches de paredes, piso e teto vêm da superfície do ambiente (IfcSpace), classificada por raios:
o que tem outro ambiente do outro lado é interno (adiabático); o resto é externo, separado por orientação
(\`parede_externa_N\`, \`_NE\`, \`_L\`, \`_SE\`, \`_S\`, \`_SO\`, \`_O\`, \`_NO\`). Janelas, portas e difusores são recortados das
paredes e do teto pelo \`topoSet\`, usando as caixas dos elementos no IFC.

## Coordenadas

- X e Y são os eixos de planta do IFC; Z para cima; gravidade (0 0 -9.81).
- A origem foi deslocada para o canto da caixa do ambiente: some (${caso.origem.map((v) => v.toFixed(3)).join(', ')}) m para voltar às coordenadas do modelo (após o deslocamento que o visualizador aplica).
- Norte verdadeiro: ${caso.norte.definido ? `direção (${caso.norte.x.toFixed(4)}, ${caso.norte.y.toFixed(4)}) no plano XY, ${norteAng.toFixed(1)}° do eixo +Y no sentido horário` : 'não definido no IFC; foi usado o eixo +Y'}.

## Parâmetros

Temperaturas em \`0.orig/include/parametros\` (copiado para \`0/\` pelo Allrun): externa ${P.tExterna} °C, solo ${P.tSolo} °C,
inicial ${P.tInicial} °C, insuflamento ${P.tInsuflamento} °C.

## Simplificações

- Paredes, vidros e cobertura externos usam \`externalWallHeatFluxTemperature\` com h = U do fechamento. O U inclui a
  película interna, que o CFD também resolve, então a troca de calor fica um pouco subestimada.
- Não há ganho solar pelos vidros, radiação, pessoas, iluminação ou equipamentos. Para incluí-los, use \`fvOptions\`
  (\`scalarSemiImplicitSource\` em h) ou \`qr\` nos vidros.
- Sem insuflamento (só convecção natural), o equilíbrio térmico de uma sala fechada é lento em regime permanente:
  acompanhe o resíduo de \`h\` e aumente \`endTime\` em \`system/controlDict\` se necessário.
- Portas internas são paredes adiabáticas${caso.patches.some((p) => p.porta && p.tipo === 'saida') ? ', exceto as definidas como saída de ar' : ''}.
${caso.avisos.length ? `\n## Avisos\n\n${caso.avisos.map((a) => `- ${a}`).join('\n')}\n` : ''}`;
}

function montarArquivos(caso) {
  return {
    Allrun: allrun(),
    Allclean: allclean(),
    'README.md': readme(caso),
    'constant/triSurface/ambiente.stl': stl(caso),
    'constant/g': constantes.g(),
    'constant/thermophysicalProperties': constantes.thermophysicalProperties(),
    'constant/turbulenceProperties': constantes.turbulenceProperties(),
    'constant/radiationProperties': constantes.radiationProperties(),
    'system/controlDict': controlDict(),
    'system/fvSchemes': fvSchemes(),
    'system/fvSolution': fvSolution(),
    'system/blockMeshDict': blockMeshDict(caso),
    'system/snappyHexMeshDict': snappyHexMeshDict(caso),
    'system/surfaceFeatureExtractDict': surfaceFeatureExtractDict(),
    'system/topoSetDict': topoSetDict(caso),
    'system/createPatchDict': createPatchDict(caso),
    '0.orig/include/parametros': parametrosInclude(caso),
    '0.orig/U': campoU(caso),
    '0.orig/T': campoT(caso),
    '0.orig/p': campoPorTipo(caso, {
      classe: 'volScalarField', objeto: 'p', dimensoes: '[1 -1 -2 0 0 0 0]', interno: 'uniform $p_ref', include: true,
      parede: ['type calculated;', 'value $internalField;'], entrada: ['type calculated;', 'value $internalField;'], saida: ['type calculated;', 'value $internalField;'],
    }),
    '0.orig/p_rgh': campoPorTipo(caso, {
      classe: 'volScalarField', objeto: 'p_rgh', dimensoes: '[1 -1 -2 0 0 0 0]', interno: 'uniform $p_ref', include: true,
      parede: ['type fixedFluxPressure;', 'value $internalField;'],
      entrada: ['type fixedFluxPressure;', 'value $internalField;'],
      // p_rgh fixo = pressão hidrostática do lado de fora. (prghPressure fixaria p estático
      // uniforme na altura da abertura e criaria um fluxo artificial em portas e janelas)
      saida: ['type fixedValue;', 'value $internalField;'],
    }),
    '0.orig/k': campoPorTipo(caso, {
      classe: 'volScalarField', objeto: 'k', dimensoes: '[0 2 -2 0 0 0 0]', interno: 'uniform $k_inicial', include: true,
      parede: ['type kqRWallFunction;', 'value $internalField;'],
      entrada: ['type turbulentIntensityKineticEnergyInlet;', 'intensity 0.05;', 'value $internalField;'],
      saida: ['type inletOutlet;', 'inletValue $internalField;', 'value $internalField;'],
    }),
    '0.orig/epsilon': campoPorTipo(caso, {
      classe: 'volScalarField', objeto: 'epsilon', dimensoes: '[0 2 -3 0 0 0 0]', interno: 'uniform $epsilon_inicial', include: true,
      parede: ['type epsilonWallFunction;', 'value $internalField;'],
      entrada: ['type turbulentMixingLengthDissipationRateInlet;', 'mixingLength 0.01;', 'value $internalField;'],
      saida: ['type inletOutlet;', 'inletValue $internalField;', 'value $internalField;'],
    }),
    '0.orig/nut': campoPorTipo(caso, {
      classe: 'volScalarField', objeto: 'nut', dimensoes: '[0 2 -1 0 0 0 0]', interno: 'uniform 0',
      parede: ['type nutkWallFunction;', 'value uniform 0;'],
      entrada: ['type calculated;', 'value uniform 0;'], saida: ['type calculated;', 'value uniform 0;'],
    }),
    '0.orig/alphat': campoPorTipo(caso, {
      classe: 'volScalarField', objeto: 'alphat', dimensoes: '[1 -1 -1 0 0 0 0]', interno: 'uniform 0',
      parede: ['type compressible::alphatWallFunction;', 'Prt 0.85;', 'value uniform 0;'],
      entrada: ['type calculated;', 'value uniform 0;'], saida: ['type calculated;', 'value uniform 0;'],
    }),
    'caso.foam': '',
  };
}

const nomeSeguro = (s) => semAcento(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'ambiente';

// Gera o caso e baixa como .zip (pasta caso_<ambiente>/ com Allrun executável)
export async function baixarCasoOpenFOAM(engine, ambienteId, parametros) {
  const { arquivos, resumo } = await gerarCasoOpenFOAM(engine, ambienteId, parametros);
  const { zipSync, strToU8 } = await import('fflate');
  const pasta = `caso_${nomeSeguro(resumo.ambiente)}`;
  const executavel = { os: 3, attrs: 0o100755 * 0x10000 };
  const normal = { os: 3, attrs: 0o100644 * 0x10000 };
  const entradas = {};
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    entradas[`${pasta}/${caminho}`] = [strToU8(conteudo), caminho === 'Allrun' || caminho === 'Allclean' ? executavel : normal];
  }
  const zip = zipSync(entradas, { level: 6 });
  const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pasta}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return resumo;
}
