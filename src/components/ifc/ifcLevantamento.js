import * as THREE from 'three';
import * as WebIFC from 'web-ifc';

// Levantamento por ambiente a partir de um modelo IFC já carregado no IfcViewerEngine.
// Fechamentos (paredes, pisos, tetos, janelas, portas) são identificados por amostragem:
// de pontos espalhados na superfície de cada ambiente saem raios para fora, e o primeiro
// elemento construtivo atingido é o fechamento daquele trecho. Continuando o raio, se ele
// encontra outro ambiente o fechamento é interno; senão é externo. Isso funciona mesmo
// quando o arquivo não traz IfcRelSpaceBoundary.

const SAMPLE_SPACING = 0.4; // m entre amostras na superfície do ambiente
const START_OFFSET = 0.05; // m para dentro do ambiente de onde o raio parte
const ELEMENT_DEPTH = { Parede: 1.2, Piso: 2.0, Teto: 2.0 }; // alcance para achar o elemento
const NEIGHBOR_DEPTH = { Parede: 1.5, Piso: 2.5, Teto: 2.5 }; // alcance para achar o ambiente vizinho

export const ORIENTACOES = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

export const CATEGORIAS_SANITARIAS = {
  bacia_sanitaria: 'Bacia sanitária',
  lavatorio: 'Lavatório',
  chuveiro: 'Chuveiro',
  banheira: 'Banheira',
  pia_cozinha: 'Pia de cozinha',
  tanque: 'Tanque',
  mictorio: 'Mictório',
  bide: 'Bidê',
  maquina_lavar_roupa: 'Máquina de lavar roupa',
  maquina_lavar_louca: 'Máquina de lavar louça',
  bebedouro: 'Bebedouro',
  ralo: 'Ralo',
  torneira: 'Torneira',
};

const CATEGORIAS_OUTRAS = {
  aquecedor: 'Aquecedor de água',
  climatizacao: 'Climatização',
  iluminacao: 'Iluminação',
  eletrodomestico: 'Eletrodoméstico / eletrônico',
  mobiliario: 'Mobiliário',
  outros: 'Outros',
};

export const CATEGORIAS = { ...CATEGORIAS_SANITARIAS, ...CATEGORIAS_OUTRAS };

// A ordem importa: a primeira regra que casar define a categoria
const REGRAS_CATEGORIA = [
  ['banheira', /bath ?tub|banheira|\bbath\b|ofuro|hidromassagem/],
  ['chuveiro', /shower|chuveiro|ducha/],
  ['mictorio', /urinal|mictorio/],
  ['bide', /bidet|\bbide\b/],
  ['bacia_sanitaria', /water ?closet|toilet|\bwc\b|bacia|vaso sanit|wcseat|toiletpan/],
  ['tanque', /tanque|laundry|utility sink|mop sink|service sink/],
  ['lavatorio', /lavatory|lavatorio|wash ?hand|washhandbasin|\bbasin\b|cuba de apoio|vanity/],
  ['maquina_lavar_roupa', /washing machine|lavar roupa|lava-?roupa|lavadora|\bwasher\b/],
  ['maquina_lavar_louca', /dishwasher|lava-?louca|lavar louca/],
  ['pia_cozinha', /\bsink\b|\bpia\b|\bcuba\b/],
  ['bebedouro', /drinking|bebedouro|water cooler|fountain/],
  ['ralo', /floor drain|\bralo\b|gully|ifcwasteterminal/],
  ['torneira', /faucet|\btap\b|torneira|hose ?bib/],
  ['aquecedor', /water heater|aquecedor|boiler|caldeira/],
  ['climatizacao', /air ?condition|\bsplit\b|fan ?coil|ar.?condicionado|evaporadora|condensadora|ifcairterminal|difusor|unitaryequipment|\bvrf\b|hvac|space ?heater/],
  ['iluminacao', /light|lumin|\blamp\b|ifclamp/],
  ['eletrodomestico', /refrigerator|fridge|geladeira|freezer|\boven\b|forno|cooktop|fogao|stove|microwave|microondas|television|\btv\b|computer|computador|electricappliance|coffee ?maker|espresso|cafeteira/],
  ['mobiliario', /furnitur|furnishing|chair|cadeira|\btable\b|\bmesa\b|\bbed\b|\bcama\b|sofa|\bdesk\b|cabinet|armario|shelf|estante|wardrobe|bench|banco/],
];

const TIPOS_VEDACAO = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE', 'IFCCURTAINWALL', 'IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE',
  'IFCMEMBER', 'IFCMEMBERSTANDARDCASE', 'IFCBEAM', 'IFCBEAMSTANDARDCASE', 'IFCCHIMNEY', 'IFCBUILDINGELEMENTPART',
  'IFCSLAB', 'IFCSLABSTANDARDCASE', 'IFCSLABELEMENTEDCASE', 'IFCROOF', 'IFCFOOTING',
]);
const TIPOS_JANELA = new Set(['IFCWINDOW', 'IFCWINDOWSTANDARDCASE']);
const TIPOS_PORTA = new Set(['IFCDOOR', 'IFCDOORSTANDARDCASE']);
const TIPOS_PLACA = new Set(['IFCPLATE', 'IFCPLATESTANDARDCASE']);
const TIPOS_EQUIPAMENTO = new Set([
  'IFCFLOWTERMINAL', 'IFCSANITARYTERMINAL', 'IFCWASTETERMINAL', 'IFCAIRTERMINAL', 'IFCLIGHTFIXTURE', 'IFCLAMP',
  'IFCELECTRICAPPLIANCE', 'IFCUNITARYEQUIPMENT', 'IFCOUTLET', 'IFCFURNISHINGELEMENT', 'IFCFURNITURE',
  'IFCSYSTEMFURNITUREELEMENT', 'IFCBUILDINGELEMENTPROXY', 'IFCENERGYCONVERSIONDEVICE', 'IFCFLOWMOVINGDEVICE',
  'IFCFLOWSTORAGEDEVICE', 'IFCFIRESUPPRESSIONTERMINAL', 'IFCAUDIOVISUALAPPLIANCE', 'IFCCOMMUNICATIONSAPPLIANCE',
  'IFCMEDICALDEVICE', 'IFCSTACKTERMINAL', 'IFCSPACEHEATER', 'IFCFAN', 'IFCPUMP', 'IFCBOILER', 'IFCCHILLER',
]);

const PREFIXOS_SI = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9,
};

// Valor simples de um atributo/propriedade do web-ifc (rótulos, medidas, booleanos, enums)
const val = (x) => {
  if (x == null) return null;
  if (typeof x !== 'object') return x;
  if (x.value !== undefined) return x.value;
  if (x._representationValue !== undefined) return x._representationValue;
  return null;
};

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

function idsOf(api, modelID, type) {
  if (type === undefined) return [];
  const vec = api.GetLineIDsWithType(modelID, type);
  const out = new Array(vec.size());
  for (let i = 0; i < out.length; i++) out[i] = vec.get(i);
  return out;
}

const refId = (r) => (r && typeof r === 'object' ? r.value : r);
const refIds = (list) => (Array.isArray(list) ? list.map(refId).filter((v) => v != null) : []);

function lerUnidades(api, modelID) {
  const dims = { LENGTHUNIT: 1, AREAUNIT: 2, VOLUMEUNIT: 3 };
  const escalas = {};
  const siScale = (u, dim) => (PREFIXOS_SI[val(u?.Prefix)] ?? 1) ** dim;
  for (const id of idsOf(api, modelID, WebIFC.IFCUNITASSIGNMENT)) {
    const ua = api.GetLine(modelID, id, true);
    for (const u of ua?.Units || []) {
      const tipo = val(u?.UnitType);
      if (!(tipo in dims) || escalas[tipo]) continue;
      if (u.ConversionFactor) {
        const fator = Number(val(u.ConversionFactor.ValueComponent));
        if (Number.isFinite(fator)) escalas[tipo] = fator * siScale(u.ConversionFactor.UnitComponent, dims[tipo]);
      } else {
        escalas[tipo] = siScale(u, dims[tipo]);
      }
    }
  }
  const L = escalas.LENGTHUNIT || 1;
  return { L, A: escalas.AREAUNIT || L * L, V: escalas.VOLUMEUNIT || L * L * L };
}

function lerNorteVerdadeiro(api, modelID) {
  for (const id of idsOf(api, modelID, WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT)) {
    const ctx = api.GetLine(modelID, id, true);
    const ratios = ctx?.TrueNorth?.DirectionRatios;
    if (!ratios) continue;
    const [x, y] = ratios.map(val).map(Number);
    const len = Math.hypot(x, y);
    if (len > 1e-9) {
      // Ângulo do norte verdadeiro em relação ao norte de projeto (+Y), positivo no sentido horário
      const desvio = (THREE.MathUtils.radToDeg(Math.atan2(x / len, y / len)) + 360) % 360;
      return { x: x / len, y: y / len, definido: true, desvio_graus: Number(desvio.toFixed(2)) };
    }
  }
  return { x: 0, y: 1, definido: false, desvio_graus: 0 };
}

// Na cena, o plano IFC (x, y) vira (x, -z). Azimute: 0° = norte verdadeiro, sentido horário.
export function azimute(normal, norte) {
  const px = normal.x;
  const py = -normal.z;
  const len = Math.hypot(px, py);
  if (len < 1e-6) return null;
  const leste = px * norte.y - py * norte.x;
  const nort = px * norte.x + py * norte.y;
  return (THREE.MathUtils.radToDeg(Math.atan2(leste, nort)) + 360) % 360;
}

export const setorDe = (az) => (az == null ? null : ORIENTACOES[Math.round(az / 45) % 8]);

function indexarRelacoes(api, modelID) {
  const idx = {
    material: new Map(),
    tipo: new Map(),
    contidoEm: new Map(),
    pai: new Map(),
    revestimentosDoAmbiente: new Map(),
    hospedeiro: new Map(),
  };
  for (const id of idsOf(api, modelID, WebIFC.IFCRELASSOCIATESMATERIAL)) {
    const r = api.GetLine(modelID, id);
    const mat = refId(r.RelatingMaterial);
    for (const o of refIds(r.RelatedObjects)) idx.material.set(o, mat);
  }
  for (const id of idsOf(api, modelID, WebIFC.IFCRELDEFINESBYTYPE)) {
    const r = api.GetLine(modelID, id);
    const t = refId(r.RelatingType);
    for (const o of refIds(r.RelatedObjects)) idx.tipo.set(o, t);
  }
  for (const id of idsOf(api, modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const r = api.GetLine(modelID, id);
    const s = refId(r.RelatingStructure);
    for (const o of refIds(r.RelatedElements)) idx.contidoEm.set(o, s);
  }
  for (const id of idsOf(api, modelID, WebIFC.IFCRELAGGREGATES)) {
    const r = api.GetLine(modelID, id);
    const p = refId(r.RelatingObject);
    for (const o of refIds(r.RelatedObjects)) idx.pai.set(o, p);
  }
  for (const id of idsOf(api, modelID, WebIFC.IFCRELCOVERSSPACES)) {
    const r = api.GetLine(modelID, id);
    // IFC2x3 usa RelatedSpace, IFC4 usa RelatingSpace
    const s = refId(r.RelatingSpace ?? r.RelatedSpace);
    if (s == null) continue;
    idx.revestimentosDoAmbiente.set(s, [...(idx.revestimentosDoAmbiente.get(s) || []), ...refIds(r.RelatedCoverings)]);
  }
  const aberturaHospedeiro = new Map();
  for (const id of idsOf(api, modelID, WebIFC.IFCRELVOIDSELEMENT)) {
    const r = api.GetLine(modelID, id);
    aberturaHospedeiro.set(refId(r.RelatedOpeningElement), refId(r.RelatingBuildingElement));
  }
  for (const id of idsOf(api, modelID, WebIFC.IFCRELFILLSELEMENT)) {
    const r = api.GetLine(modelID, id);
    const host = aberturaHospedeiro.get(refId(r.RelatingOpeningElement));
    if (host != null) idx.hospedeiro.set(refId(r.RelatedBuildingElement), host);
  }
  return idx;
}

function camadasDeMaterial(api, modelID, materialId, L) {
  if (materialId == null) return [];
  let mat;
  try {
    mat = api.GetLine(modelID, materialId, true);
  } catch {
    return [];
  }
  const tipoDe = (o) => String(api.GetNameFromTypeCode(o?.type) || '').toUpperCase();
  const walk = (o, depth = 0) => {
    if (!o || depth > 5) return [];
    const t = tipoDe(o);
    if (t === 'IFCMATERIALLAYERSETUSAGE') return walk(o.ForLayerSet, depth + 1);
    if (t === 'IFCMATERIALLAYERSET') return (o.MaterialLayers || []).flatMap((l) => walk(l, depth + 1));
    if (t === 'IFCMATERIALLAYER') {
      const esp = Number(val(o.LayerThickness));
      return [{ nome: val(o.Material?.Name) ?? val(o.Name) ?? 'Camada', espessura_m: Number.isFinite(esp) ? esp * L : null }];
    }
    if (t === 'IFCMATERIAL') return [{ nome: val(o.Name), espessura_m: null }];
    if (t === 'IFCMATERIALLIST') return (o.Materials || []).flatMap((m) => walk(m, depth + 1));
    if (t === 'IFCMATERIALCONSTITUENTSET') return (o.MaterialConstituents || []).flatMap((c) => walk(c, depth + 1));
    if (t === 'IFCMATERIALCONSTITUENT') return [{ nome: val(o.Material?.Name) ?? val(o.Name), espessura_m: null }];
    if (t === 'IFCMATERIALPROFILESETUSAGE') return walk(o.ForProfileSet, depth + 1);
    if (t === 'IFCMATERIALPROFILESET') return (o.MaterialProfiles || []).flatMap((p) => walk(p, depth + 1));
    if (t === 'IFCMATERIALPROFILE') return [{ nome: val(o.Material?.Name) ?? val(o.Name), espessura_m: null }];
    return [];
  };
  return walk(mat).filter((c) => c.nome);
}

export function descreverCamadas(camadas) {
  return camadas
    .map((c) => (c.espessura_m ? `${c.nome} ${(c.espessura_m * 100).toFixed(1).replace('.', ',')} cm` : c.nome))
    .join(' + ');
}

// Converte o valor de uma propriedade/quantidade IFC para unidades SI (m, m², m³)
function valorPropriedade(p, un) {
  if (!p) return null;
  if (p.LengthValue !== undefined) return Number(val(p.LengthValue)) * un.L;
  if (p.AreaValue !== undefined) return Number(val(p.AreaValue)) * un.A;
  if (p.VolumeValue !== undefined) return Number(val(p.VolumeValue)) * un.V;
  if (p.CountValue !== undefined) return Number(val(p.CountValue));
  if (p.WeightValue !== undefined) return Number(val(p.WeightValue));
  const nv = p.NominalValue;
  if (nv === undefined) {
    const enums = p.EnumerationValues?.map?.(val).filter(Boolean);
    return enums?.length ? enums.join(', ') : null;
  }
  const v = val(nv);
  if (v == null) return null;
  const rotulo = String(nv.name || nv.label || '').toUpperCase();
  if (typeof v === 'number' || (typeof v === 'string' && /MEASURE/.test(rotulo) && v.trim() !== '' && !Number.isNaN(Number(v)))) {
    const n = Number(v);
    if (/AREAMEASURE/.test(rotulo)) return n * un.A;
    if (/VOLUMEMEASURE/.test(rotulo)) return n * un.V;
    if (/LENGTHMEASURE/.test(rotulo)) return n * un.L;
    return n;
  }
  if (v === 'T') return true;
  if (v === 'F') return false;
  return v;
}

// Revit exporta muitos campos vazios com o próprio nome como valor (ex.: FloorCovering=FloorCovering)
const valorUtil = (nome, valor) => {
  if (valor == null) return false;
  if (typeof valor === 'string') {
    const s = valor.trim();
    // Também descarta preenchimentos como "LightingZoneName = Unit A LightingZoneName"
    const placeholder = s === nome || (!/\s/.test(nome) && nome.length > 6 && s.endsWith(nome));
    return s !== '' && !placeholder && s.toLowerCase() !== 'default' && s !== '<Default>';
  }
  return true;
};

// Estruturas compartilhadas pelo levantamento e pela exportação para CFD
export function criarContexto(engine) {
  const { api, modelID } = engine;
  if (!api || modelID == null) throw new Error('Nenhum modelo carregado.');
  const un = lerUnidades(api, modelID);
  const norte = lerNorteVerdadeiro(api, modelID);
  const rel = indexarRelacoes(api, modelID);

  const tipoIfc = (id) => String(engine.typeById.get(id) || api.GetNameFromTypeCode(api.GetLineType(modelID, id)) || '').toUpperCase();

  // ---- Informações de elementos (lidas sob demanda e guardadas) ----
  const cacheInfo = new Map();
  const lerPsets = async (id) => {
    const lista = [];
    const adicionar = (pset, origem) => {
      const nomePset = val(pset?.Name) || '';
      for (const p of pset?.HasProperties || pset?.Quantities || []) {
        if (!p) continue;
        const nome = val(p.Name);
        const valor = valorPropriedade(p, un);
        if (nome && valorUtil(nome, valor)) lista.push({ pset: nomePset, nome, valor, origem });
      }
    };
    try {
      const psets = await api.properties.getPropertySets(modelID, id, true, false);
      psets.forEach((ps) => adicionar(ps, 'instancia'));
    } catch { /* elemento sem psets */ }
    const tipoId = rel.tipo.get(id);
    if (tipoId != null) {
      try {
        const tipo = api.GetLine(modelID, tipoId, true);
        (tipo?.HasPropertySets || []).forEach((ps) => adicionar(ps, 'tipo'));
      } catch { /* tipo sem psets */ }
    }
    return lista;
  };

  const acharProp = (props, regexNome, { numero = false, regexPset } = {}) => {
    const p = props.find((x) => regexNome.test(semAcento(x.nome))
      && (!regexPset || regexPset.test(semAcento(x.pset)))
      && (!numero || typeof x.valor === 'number'));
    return p ? p.valor : null;
  };

  // Primeira propriedade numérica que casar, respeitando a ordem de prioridade dos padrões
  const acharPrimeiro = (props, regexes) => {
    for (const r of regexes) {
      const v = acharProp(props, r, { numero: true });
      if (v != null) return v;
    }
    return null;
  };

  const infoElemento = async (id) => {
    if (cacheInfo.has(id)) return cacheInfo.get(id);
    const linha = api.GetLine(modelID, id);
    const ifc = tipoIfc(id);
    const tipoId = rel.tipo.get(id);
    let tipoNome = null;
    if (tipoId != null) {
      try { tipoNome = val(api.GetLine(modelID, tipoId)?.Name); } catch { tipoNome = null; }
    }
    const props = await lerPsets(id);
    let camadas = camadasDeMaterial(api, modelID, rel.material.get(id), un.L);
    if (!camadas.length && tipoId != null) camadas = camadasDeMaterial(api, modelID, rel.material.get(tipoId), un.L);
    const somaCamadas = camadas.reduce((s, c) => s + (c.espessura_m || 0), 0);
    const largura = Number(val(linha.OverallWidth));
    const altura = Number(val(linha.OverallHeight));
    const externo = acharProp(props, /^isexternal$/);
    const info = {
      id,
      ifc,
      nome: val(linha.Name) || null,
      tipo_construtivo: val(linha.ObjectType) || tipoNome || null,
      predefinido: val(linha.PredefinedType) || null,
      camadas,
      materiais: descreverCamadas(camadas) || null,
      espessura_m: somaCamadas > 0 ? somaCamadas : acharProp(props, /^(width|thickness|totalthickness|espessura|largura)$/, { numero: true }),
      externo_ifc: typeof externo === 'boolean' ? externo : null,
      u: acharProp(props, /thermaltransmittance|heat transfer coefficient|transmitancia|^u$|u-?value/, { numero: true }),
      fator_solar: acharProp(props, /solar ?heat ?gain|shgc|g-?value|fator solar|solarheatgain/, { numero: true }),
      largura_m: Number.isFinite(largura) && largura > 0 ? largura * un.L : null,
      altura_m: Number.isFinite(altura) && altura > 0 ? altura * un.L : null,
      potencia: acharProp(props, /potencia|power|wattage|apparent load|^load$|^carga$/, {}),
      hospedeiro: rel.hospedeiro.get(id) ?? null,
      props,
    };
    cacheInfo.set(id, info);
    return info;
  };

  const cacheClasse = new Map();
  const classeFechamento = (id) => {
    if (!cacheClasse.has(id)) cacheClasse.set(id, calcularClasse(id));
    return cacheClasse.get(id);
  };
  const calcularClasse = (id) => {
    const t = tipoIfc(id);
    if (TIPOS_JANELA.has(t)) return 'janela';
    if (TIPOS_PORTA.has(t)) return 'porta';
    if (t === 'IFCCOVERING') return 'revestimento';
    if (TIPOS_PLACA.has(t)) {
      const linha = api.GetLine(modelID, id);
      const texto = semAcento(`${val(linha.Name)} ${val(linha.ObjectType)}`);
      if (/solid|opaco|spandrel/.test(texto)) return 'vedacao';
      if (/glaz|glass|vidro|vitr/.test(texto)) return 'vidro';
      const pai = rel.pai.get(id);
      return pai != null && tipoIfc(pai) === 'IFCCURTAINWALL' ? 'vidro' : 'vedacao';
    }
    if (TIPOS_VEDACAO.has(t)) {
      // Pisos e paredes de acabamento modelados como laje/parede fina (comum no Revit)
      const linha = api.GetLine(modelID, id);
      if (/finish|acabamento|revestimento/.test(semAcento(`${val(linha.Name)} ${val(linha.ObjectType)}`))) return 'acabamento';
      return 'vedacao';
    }
    return null;
  };

  // ---- Malhas e caixas envolventes ----
  const espacosIds = idsOf(api, modelID, WebIFC.IFCSPACE);
  if (!espacosIds.length) {
    throw new Error('O modelo não tem ambientes (IfcSpace). No Revit, exporte o IFC com os ambientes (Rooms/Spaces) incluídos.');
  }

  const caixas = new Map();
  const malhasElementos = [];
  const revestimentos = [];
  const malhasEspacos = new Map();
  for (const [id, meshes] of engine.meshesById) {
    const box = new THREE.Box3();
    meshes.forEach((m) => {
      m.updateMatrixWorld(true);
      box.expandByObject(m);
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    });
    caixas.set(id, box);
    if (tipoIfc(id) === 'IFCSPACE') malhasEspacos.set(id, meshes);
    if (tipoIfc(id) === 'IFCCOVERING') revestimentos.push(id);
    else if (classeFechamento(id)) meshes.forEach((m) => malhasElementos.push({ id, mesh: m, box }));
  }

  // Pavimento de cada ambiente, a partir da árvore espacial
  const pavimentoDe = new Map();
  const elevacaoPavimento = new Map();
  const percorrer = (no, pav) => {
    const tipo = String(no.type || '').toUpperCase();
    let atual = pav;
    if (tipo === 'IFCBUILDINGSTOREY') {
      atual = { id: no.expressID, nome: no.name || `Pavimento #${no.expressID}` };
      try {
        const e = Number(val(api.GetLine(modelID, no.expressID).Elevation));
        elevacaoPavimento.set(no.expressID, Number.isFinite(e) ? e * un.L : 0);
      } catch { elevacaoPavimento.set(no.expressID, 0); }
    }
    if (tipo === 'IFCSPACE' && atual) pavimentoDe.set(no.expressID, atual);
    (no.children || []).forEach((c) => percorrer(c, atual));
  };
  if (engine.tree) percorrer(engine.tree, null);

  const rotuloEspaco = new Map();
  for (const id of espacosIds) {
    const l = api.GetLine(modelID, id);
    const numero = val(l.Name) || '';
    const nome = val(l.LongName) || '';
    rotuloEspaco.set(id, nome && !numero.includes(nome) ? [numero, nome].filter(Boolean).join(' - ') : (numero || nome || `Ambiente #${id}`));
  }

  const raycaster = new THREE.Raycaster();
  const dirTeste = new THREE.Vector3(0.0123, 1, 0.0171).normalize();
  const pontoDentro = (ponto, meshes) => {
    raycaster.set(ponto, dirTeste);
    raycaster.far = Infinity;
    return raycaster.intersectObjects(meshes, false).length % 2 === 1;
  };

  // Triângulos (em coordenadas da cena) da superfície de um ambiente, com normais para fora
  const triangulosDoEspaco = (sid) => {
    let volumeComSinal = 0;
    const triangulos = [];
    for (const mesh of malhasEspacos.get(sid) || []) {
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const n = index ? index.count : pos.count;
      for (let k = 0; k + 2 < n; k += 3) {
        const ia = index ? index.getX(k) : k;
        const ib = index ? index.getX(k + 1) : k + 1;
        const ic = index ? index.getX(k + 2) : k + 2;
        const va = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
        const vb = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
        const vc = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
        volumeComSinal += va.dot(new THREE.Vector3().crossVectors(vb, vc)) / 6;
        triangulos.push([va, vb, vc]);
      }
    }
    // Volume com sinal negativo indica triângulos orientados para dentro
    if (volumeComSinal < 0) triangulos.forEach((t) => { const tmp = t[1]; t[1] = t[2]; t[2] = tmp; });
    return { triangulos, volume: Math.abs(volumeComSinal) };
  };

  const candidatosDoEspaco = (sid) => {
    const zona = caixas.get(sid).clone().expandByScalar(2.6);
    const elementos = malhasElementos.filter((e) => e.box.intersectsBox(zona)).map((e) => e.mesh);
    const espacos = [];
    for (const [outro, ms] of malhasEspacos) {
      if (outro !== sid && caixas.get(outro).intersectsBox(zona)) espacos.push(...ms);
    }
    return { elementos, espacos };
  };

  const tipoDaFace = (normal) => (normal.y < -0.7 ? 'Piso' : normal.y > 0.7 ? 'Teto' : 'Parede');

  // Raio a partir de um ponto da superfície do ambiente, para fora: primeiro elemento construtivo
  // atingido e, continuando, se existe outro ambiente do outro lado
  const origemRaio = new THREE.Vector3();
  const lancarRaio = (ponto, normal, tipoFace, candidatos) => {
    origemRaio.copy(ponto).addScaledVector(normal, -START_OFFSET);
    raycaster.set(origemRaio, normal);
    raycaster.far = START_OFFSET + ELEMENT_DEPTH[tipoFace];
    let elemento = null;
    const acabamentos = [];
    for (const hit of raycaster.intersectObjects(candidatos.elementos, false)) {
      const eid = hit.object.userData.expressID;
      const classe = classeFechamento(eid);
      if (classe === 'revestimento') continue;
      if (classe === 'acabamento') {
        // Laje de acabamento só vale para o piso; parede de acabamento só para a parede
        const ehLaje = /SLAB|ROOF|FOOTING/.test(tipoIfc(eid));
        if ((tipoFace === 'Piso' && ehLaje) || (tipoFace === 'Parede' && !ehLaje)) acabamentos.push(eid);
        continue;
      }
      if (classe) { elemento = { id: eid, classe }; break; }
    }

    raycaster.far = START_OFFSET + NEIGHBOR_DEPTH[tipoFace];
    const vizinhoHit = candidatos.espacos.length ? raycaster.intersectObjects(candidatos.espacos, false).find((h) => h.distance > 0.01) : null;
    const vizinho = vizinhoHit ? vizinhoHit.object.userData.expressID : null;

    let condicao;
    if (vizinho != null) condicao = 'Interna';
    else if (tipoFace === 'Parede') condicao = elemento ? 'Externa' : 'Sem elemento';
    else if (tipoFace === 'Teto') condicao = 'Cobertura / exterior';
    else condicao = 'Solo / exterior';
    return { elemento, acabamentos, vizinho, condicao };
  };

  return {
    api, modelID, un, norte, rel, tipoIfc, lerPsets, acharProp, acharPrimeiro, infoElemento, classeFechamento,
    espacosIds, caixas, malhasElementos, malhasEspacos, revestimentos, pavimentoDe, elevacaoPavimento, rotuloEspaco,
    raycaster, pontoDentro, triangulosDoEspaco, candidatosDoEspaco, tipoDaFace, lancarRaio,
  };
}

export async function gerarLevantamento(engine, { onProgress } = {}) {
  const ctx = criarContexto(engine);
  const {
    api, modelID, un, norte, rel, tipoIfc, lerPsets, acharProp, acharPrimeiro, infoElemento,
    espacosIds, caixas, malhasEspacos, revestimentos, pavimentoDe, elevacaoPavimento, rotuloEspaco,
    pontoDentro, triangulosDoEspaco, candidatosDoEspaco, tipoDaFace, lancarRaio,
  } = ctx;
  const avisos = [];
  if (!norte.definido) {
    avisos.push('O arquivo não define o norte verdadeiro (TrueNorth). As orientações consideram o norte de projeto (eixo Y do modelo).');
  }

  // ---- Equipamentos: associação a ambientes ----
  onProgress?.({ etapa: 'Localizando equipamentos...', percentual: 0 });
  const equipamentosPorEspaco = new Map();
  const equipamentosSemAmbiente = [];
  const espacoDoEquipamento = (id) => {
    const direto = rel.contidoEm.get(id);
    if (direto != null && malhasEspacos.has(direto)) return direto;
    const caixa = caixas.get(id);
    if (!caixa || caixa.isEmpty()) return direto != null && tipoIfc(direto) === 'IFCSPACE' ? direto : null;
    const centro = caixa.getCenter(new THREE.Vector3());
    const pontos = [centro, new THREE.Vector3(centro.x, caixa.min.y + 0.05, centro.z)];
    for (const p of pontos) {
      for (const [sid, meshes] of malhasEspacos) {
        const cx = caixas.get(sid);
        if (!cx.containsPoint(p)) continue;
        if (pontoDentro(p, meshes)) return sid;
      }
    }
    return null;
  };
  for (const id of engine.meshesById.keys()) {
    if (!TIPOS_EQUIPAMENTO.has(tipoIfc(id))) continue;
    const sid = espacoDoEquipamento(id);
    if (sid == null) equipamentosSemAmbiente.push(id);
    else equipamentosPorEspaco.set(sid, [...(equipamentosPorEspaco.get(sid) || []), id]);
  }

  const classificarEquipamento = (info, ambienteTexto = '') => {
    const texto = semAcento(`${info.nome} ${info.tipo_construtivo} ${info.predefinido} ${info.ifc}`);
    for (const [cat, regex] of REGRAS_CATEGORIA) {
      if (!regex.test(texto)) continue;
      // "Sink" num banheiro é lavatório
      if (cat === 'pia_cozinha' && /bath|banh|\bwc\b|lavabo|sanit|toilet|vestiario|powder|restroom/.test(semAcento(ambienteTexto))) return 'lavatorio';
      return cat;
    }
    if (info.ifc === 'IFCFURNISHINGELEMENT' || info.ifc === 'IFCFURNITURE') return 'mobiliario';
    if (info.ifc === 'IFCLIGHTFIXTURE') return 'iluminacao';
    return 'outros';
  };

  // ---- Ambientes ----
  const ambientes = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const ponto = new THREE.Vector3();
  const GOLDEN = 0.6180339887;

  for (let i = 0; i < espacosIds.length; i++) {
    const sid = espacosIds[i];
    onProgress?.({ etapa: `Analisando ambiente ${i + 1} de ${espacosIds.length}...`, percentual: Math.round((i / espacosIds.length) * 100) });
    await yieldToUi();

    const linha = api.GetLine(modelID, sid);
    const props = await lerPsets(sid);
    const meshes = malhasEspacos.get(sid) || [];
    const pav = pavimentoDe.get(sid) || (() => {
      const pai = rel.pai.get(sid) ?? rel.contidoEm.get(sid);
      if (pai == null) return null;
      try { return { id: pai, nome: val(api.GetLine(modelID, pai).Name) || `#${pai}` }; } catch { return null; }
    })();

    const ambiente = {
      id: sid,
      guid: val(linha.GlobalId),
      pavimento: pav?.nome || null,
      elevacao_pavimento_m: pav ? (elevacaoPavimento.get(pav.id) ?? null) : null,
      numero: val(linha.Name) || null,
      nome: val(linha.LongName) || null,
      rotulo: rotuloEspaco.get(sid),
      uso: val(linha.ObjectType) || acharProp(props, /^(occupancytype|category description|uso|tipo de uso)$/) || null,
      area_ifc_m2: acharPrimeiro(props, [/^(netfloorarea|net floor area)$/, /^(area|area util)$/, /^(grossfloorarea|gross floor area)$/]),
      pe_direito_ifc_m: acharPrimeiro(props, [/^finishceilingheight$/, /^(height|pe.?direito|altura)$/, /^unbounded height$/]),
      volume_ifc_m3: acharPrimeiro(props, [/^netvolume$/, /^volume$/, /^grossvolume$/]),
      perimetro_m: acharPrimeiro(props, [/^netperimeter$/, /^(perimeter|perimetro)$/, /^grossperimeter$/]),
      ocupacao: acharProp(props, /occupancynumber|number of people|ocupacao|^pessoas$|numero de pessoas/, { numero: true }),
      area_por_pessoa_m2: acharProp(props, /area per person|area por pessoa/, { numero: true }),
      area_geometrica_m2: 0,
      pe_direito_geometrico_m: null,
      volume_geometrico_m3: 0,
      acabamentos: { piso: [], parede: [], teto: [], rodape: [] },
      parametros_ifc: props
        .filter((p) => /energy|thermal|termic|hvac|occupan|ocupac|lighting|ilumina|condicion|load|carga/.test(semAcento(`${p.pset} ${p.nome}`)))
        .map((p) => ({ pset: p.pset, nome: p.nome, valor: p.valor })),
      superficies: [],
      aberturas: [],
      equipamentos: [],
      fechamento_identificado_pct: null,
    };

    // Acabamentos declarados nas propriedades do ambiente
    const regrasAcabamento = [
      ['piso', /floor ?(finish|covering)|floorcovering|acabamento.*piso|revestimento.*piso|^piso$|flooring/],
      ['parede', /wall ?(finish|covering)|wallcovering|acabamento.*parede|revestimento.*parede|^parede$/],
      ['teto', /ceiling ?(finish|covering)|ceilingcovering|^forro$|acabamento.*(teto|forro)|revestimento.*(teto|forro)|^teto$/],
      ['rodape', /base ?finish|skirting|rodape/],
    ];
    for (const p of props) {
      if (typeof p.valor !== 'string') continue;
      const nome = semAcento(p.nome);
      for (const [campo, regex] of regrasAcabamento) if (regex.test(nome)) ambiente.acabamentos[campo].push(p.valor);
    }
    for (const covId of rel.revestimentosDoAmbiente.get(sid) || []) {
      const info = await infoElemento(covId);
      const campo = { FLOORING: 'piso', CEILING: 'teto', CLADDING: 'parede', SKIRTINGBOARD: 'rodape' }[info.predefinido] || 'parede';
      ambiente.acabamentos[campo].push(info.tipo_construtivo || info.nome);
    }

    if (meshes.length) {
      const { triangulos, volume } = triangulosDoEspaco(sid);
      ambiente.volume_geometrico_m3 = volume;
      const caixa = caixas.get(sid);
      ambiente.pe_direito_geometrico_m = caixa.max.y - caixa.min.y;
      const candidatos = candidatosDoEspaco(sid);

      const sup = new Map();
      const abert = new Map();
      const acabamentosVistos = { Piso: new Set(), Parede: new Set() };
      let areaAmostrada = 0;
      let areaComElemento = 0;

      for (const [va, vb, vc] of triangulos) {
        ab.subVectors(vb, va);
        ac.subVectors(vc, va);
        normal.crossVectors(ab, ac);
        const areaTri = normal.length() / 2;
        if (areaTri < 1e-4) continue;
        normal.multiplyScalar(1 / (areaTri * 2));
        const tipoFace = tipoDaFace(normal);
        if (tipoFace === 'Piso') ambiente.area_geometrica_m2 += areaTri;
        const az = tipoFace === 'Parede' ? azimute(normal, norte) : null;
        const setor = setorDe(az);

        const nAmostras = Math.max(1, Math.round(areaTri / (SAMPLE_SPACING * SAMPLE_SPACING)));
        const pesoAmostra = areaTri / nAmostras;
        for (let s = 0; s < nAmostras; s++) {
          // Pontos bem distribuídos no triângulo (sequência de baixa discrepância)
          const r1 = (s + 0.5) / nAmostras;
          const r2 = (s * GOLDEN) % 1;
          const sr = Math.sqrt(r1);
          a.copy(va).multiplyScalar(1 - sr);
          b.copy(vb).multiplyScalar(sr * (1 - r2));
          c.copy(vc).multiplyScalar(sr * r2);
          ponto.copy(a).add(b).add(c);
          areaAmostrada += pesoAmostra;

          const { elemento, acabamentos, vizinho, condicao } = lancarRaio(ponto, normal, tipoFace, candidatos);
          acabamentos.forEach((eid) => acabamentosVistos[tipoFace].add(eid));
          if (elemento) areaComElemento += pesoAmostra;

          if (elemento && elemento.classe !== 'vedacao') {
            const chave = elemento.id;
            const atual = abert.get(chave) || { id: elemento.id, classe: elemento.classe, area: 0, condicoes: new Map(), setores: new Map(), vizinho: null, vx: 0, vy: 0 };
            atual.area += pesoAmostra;
            atual.condicoes.set(condicao, (atual.condicoes.get(condicao) || 0) + pesoAmostra);
            if (setor) atual.setores.set(setor, (atual.setores.get(setor) || 0) + pesoAmostra);
            if (az != null) { atual.vx += Math.sin(THREE.MathUtils.degToRad(az)) * pesoAmostra; atual.vy += Math.cos(THREE.MathUtils.degToRad(az)) * pesoAmostra; }
            if (vizinho != null) atual.vizinho = vizinho;
            abert.set(chave, atual);
            continue;
          }

          const chave = [tipoFace, elemento?.id ?? '-', condicao, vizinho ?? '-', setor ?? '-'].join('|');
          const atual = sup.get(chave) || { tipo: tipoFace, elementoId: elemento?.id ?? null, condicao, vizinho, setor, area: 0, vx: 0, vy: 0 };
          atual.area += pesoAmostra;
          if (az != null) { atual.vx += Math.sin(THREE.MathUtils.degToRad(az)) * pesoAmostra; atual.vy += Math.cos(THREE.MathUtils.degToRad(az)) * pesoAmostra; }
          sup.set(chave, atual);
        }
      }

      ambiente.fechamento_identificado_pct = areaAmostrada > 0 ? Math.round((areaComElemento / areaAmostrada) * 100) : null;
      const azMedio = (o) => (o.vx || o.vy ? Number(((THREE.MathUtils.radToDeg(Math.atan2(o.vx, o.vy)) + 360) % 360).toFixed(1)) : null);

      for (const s of sup.values()) {
        // Trechos de uma única amostra são ruído de borda (quinas, encontros com laje)
        if (s.area < 0.25) continue;
        const info = s.elementoId != null ? await infoElemento(s.elementoId) : null;
        ambiente.superficies.push({
          tipo: s.tipo,
          condicao: s.condicao,
          divisa_com: s.vizinho != null ? rotuloEspaco.get(s.vizinho) : null,
          orientacao: s.setor,
          azimute_graus: s.tipo === 'Parede' ? azMedio(s) : null,
          area_m2: s.area,
          elemento_id: s.elementoId,
          elemento: info ? (info.tipo_construtivo || info.nome || info.ifc) : null,
          elemento_ifc: info?.ifc || null,
          materiais: info?.materiais || null,
          espessura_m: info?.espessura_m ?? null,
          u: info?.u ?? null,
          externo_ifc: info?.externo_ifc ?? null,
        });
      }
      ambiente.superficies.sort((x, y) => x.tipo.localeCompare(y.tipo) || x.condicao.localeCompare(y.condicao) || (ORIENTACOES.indexOf(x.orientacao) - ORIENTACOES.indexOf(y.orientacao)));

      for (const o of abert.values()) {
        if (o.area < 0.02) continue;
        const info = await infoElemento(o.id);
        const dominante = (m) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
        const nominal = info.largura_m && info.altura_m ? info.largura_m * info.altura_m : null;
        const hosp = info.hospedeiro != null ? await infoElemento(info.hospedeiro) : null;
        ambiente.aberturas.push({
          tipo: { janela: 'Janela', porta: 'Porta', vidro: 'Vidro (fachada)' }[o.classe],
          condicao: dominante(o.condicoes),
          divisa_com: o.vizinho != null ? rotuloEspaco.get(o.vizinho) : null,
          orientacao: dominante(o.setores),
          azimute_graus: azMedio(o),
          elemento_id: o.id,
          nome: info.nome,
          tipo_construtivo: info.tipo_construtivo,
          largura_m: info.largura_m,
          altura_m: info.altura_m,
          area_m2: nominal ?? o.area,
          area_amostrada_m2: o.area,
          u: info.u,
          fator_solar: info.fator_solar,
          parede: hosp ? (hosp.tipo_construtivo || hosp.nome) : null,
        });
      }

      for (const [campo, ids] of [['piso', acabamentosVistos.Piso], ['parede', acabamentosVistos.Parede]]) {
        for (const id of ids) {
          const info = await infoElemento(id);
          ambiente.acabamentos[campo].push(info.tipo_construtivo || info.nome);
        }
      }

      // Revestimentos (IfcCovering) que ocupam o ambiente: forros e pisos costumam cobrir vários ambientes
      const interior = caixa.clone();
      interior.min.x += 0.15; interior.min.z += 0.15; interior.max.x -= 0.15; interior.max.z -= 0.15;
      interior.min.y -= 0.3; interior.max.y += 0.3;
      for (const covId of revestimentos) {
        const cb = caixas.get(covId);
        if (!cb.intersectsBox(interior)) continue;
        const sobreposicao = cb.clone().intersect(interior);
        const areaPlanta = (sobreposicao.max.x - sobreposicao.min.x) * (sobreposicao.max.z - sobreposicao.min.z);
        const info = await infoElemento(covId);
        let campo = { FLOORING: 'piso', CEILING: 'teto', CLADDING: 'parede', SKIRTINGBOARD: 'rodape' }[info.predefinido];
        if (!campo) {
          const fino = cb.max.y - cb.min.y < 0.2;
          campo = !fino ? 'parede' : (cb.min.y > caixa.min.y + (caixa.max.y - caixa.min.y) / 2 ? 'teto' : 'piso');
        }
        if ((campo === 'piso' || campo === 'teto') && areaPlanta < 0.3) continue;
        ambiente.acabamentos[campo].push(info.tipo_construtivo || info.nome);
      }
    }

    for (const eid of equipamentosPorEspaco.get(sid) || []) {
      const info = await infoElemento(eid);
      const categoria = classificarEquipamento(info, `${ambiente.rotulo} ${ambiente.uso || ''}`);
      ambiente.equipamentos.push({
        elemento_id: eid,
        categoria,
        categoria_nome: CATEGORIAS[categoria],
        sanitario: categoria in CATEGORIAS_SANITARIAS,
        ifc: info.ifc,
        nome: info.nome,
        tipo_construtivo: info.tipo_construtivo,
        predefinido: info.predefinido,
        potencia: info.potencia,
      });
    }

    for (const campo of Object.keys(ambiente.acabamentos)) {
      ambiente.acabamentos[campo] = [...new Set(ambiente.acabamentos[campo].filter(Boolean))];
    }
    ambientes.push(ambiente);
  }

  ambientes.sort((x, y) => (x.elevacao_pavimento_m ?? 0) - (y.elevacao_pavimento_m ?? 0)
    || String(x.pavimento || '').localeCompare(String(y.pavimento || ''))
    || String(x.numero || x.rotulo).localeCompare(String(y.numero || y.rotulo), 'pt-BR', { numeric: true }));

  const semGeometria = ambientes.filter((amb) => !malhasEspacos.has(amb.id));
  if (semGeometria.length) avisos.push(`${semGeometria.length} ambiente(s) sem geometria no IFC: área por geometria e fechamentos não puderam ser levantados.`);
  const baixaCobertura = ambientes.filter((amb) => amb.fechamento_identificado_pct != null && amb.fechamento_identificado_pct < 70);
  if (baixaCobertura.length) {
    avisos.push(`${baixaCobertura.length} ambiente(s) com menos de 70% do contorno associado a um elemento construtivo (ex.: ${baixaCobertura.slice(0, 3).map((x) => x.rotulo).join(', ')}). Confira os fechamentos desses ambientes.`);
  }

  const semAmbiente = [];
  for (const eid of equipamentosSemAmbiente) {
    const info = await infoElemento(eid);
    const categoria = classificarEquipamento(info);
    if (categoria === 'mobiliario' || categoria === 'outros') continue;
    semAmbiente.push({ elemento_id: eid, categoria, categoria_nome: CATEGORIAS[categoria], nome: info.nome, tipo_construtivo: info.tipo_construtivo, ifc: info.ifc });
  }
  if (semAmbiente.length) avisos.push(`${semAmbiente.length} equipamento(s) relevante(s) fora de qualquer ambiente (listados em "Sem ambiente").`);

  onProgress?.({ etapa: 'Concluído', percentual: 100 });

  return {
    versao: 1,
    gerado_em: new Date().toISOString(),
    schema: api.GetModelSchema(modelID),
    unidades_arquivo: { comprimento_m: un.L, area_m2: un.A, volume_m3: un.V },
    norte_verdadeiro: norte,
    amostragem_m: SAMPLE_SPACING,
    avisos,
    ambientes: ambientes.map(resumirAmbiente),
    equipamentos_sem_ambiente: semAmbiente,
  };
}

// Totais por ambiente usados na tabela e na planilha
function resumirAmbiente(amb) {
  const porOrientacao = () => Object.fromEntries(ORIENTACOES.map((o) => [o, 0]));
  const paredeExt = porOrientacao();
  const vidroExt = porOrientacao();
  let paredeInt = 0;
  let cobertura = 0;
  let pisoExt = 0;
  for (const s of amb.superficies) {
    if (s.tipo === 'Parede' && s.condicao === 'Externa' && s.orientacao) paredeExt[s.orientacao] += s.area_m2;
    if (s.tipo === 'Parede' && s.condicao === 'Interna') paredeInt += s.area_m2;
    if (s.tipo === 'Teto' && s.condicao !== 'Interna') cobertura += s.area_m2;
    if (s.tipo === 'Piso' && s.condicao !== 'Interna') pisoExt += s.area_m2;
  }
  let portas = 0;
  for (const o of amb.aberturas) {
    if (o.tipo === 'Porta') portas += 1;
    if (o.tipo !== 'Porta' && o.condicao === 'Externa' && o.orientacao) vidroExt[o.orientacao] += o.area_m2;
  }
  const sanitarios = {};
  for (const e of amb.equipamentos) if (e.sanitario) sanitarios[e.categoria] = (sanitarios[e.categoria] || 0) + 1;
  const soma = (o) => Object.values(o).reduce((x, y) => x + y, 0);
  return {
    ...amb,
    area_m2: amb.area_ifc_m2 ?? amb.area_geometrica_m2,
    pe_direito_m: amb.pe_direito_ifc_m ?? amb.pe_direito_geometrico_m,
    volume_m3: amb.volume_ifc_m3 ?? amb.volume_geometrico_m3,
    totais: {
      parede_externa_m2: soma(paredeExt),
      parede_externa_por_orientacao: paredeExt,
      parede_interna_m2: paredeInt,
      janela_externa_m2: soma(vidroExt),
      janela_externa_por_orientacao: vidroExt,
      cobertura_exposta_m2: cobertura,
      piso_solo_exterior_m2: pisoExt,
      portas,
      sanitarios,
      equipamentos: amb.equipamentos.length,
    },
  };
}
