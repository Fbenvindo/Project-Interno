// Gera IFCs simples para os testes de interferência: elementos extrudados (caixas e cilindros)
// num pavimento, com deslocamento grande opcional (coordenadas tipo UTM).
let id = 0;
const lines = [];
const add = (s) => {
  id += 1;
  lines.push(`#${id}=${s};`);
  return `#${id}`;
};
const guid = () => {
  const c = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let s = '';
  for (let i = 0; i < 22; i++) s += c[Math.floor(Math.random() * 64)];
  return `'${s}'`;
};
const n = (v) => (Number.isInteger(v) ? `${v}.` : String(v));
const pt = (p) => add(`IFCCARTESIANPOINT((${p.map(n).join(',')}))`);
const dir = (d) => add(`IFCDIRECTION((${d.map(n).join(',')}))`);

/**
 * elementos: [{ tipo: 'IFCBEAM', nome, base: [x,y,z], eixo: [dx,dy,dz] (extrusão), comprimento,
 *   perfil: { retangulo: [a, b] } | { raio } }]
 */
function makeIfc({ elementos, pavimento = 'Térreo', deslocamento = [0, 0, 0] }) {
  id = 0;
  lines.length = 0;
  const origin = pt([0, 0, 0]);
  const z = dir([0, 0, 1]);
  const x = dir([1, 0, 0]);
  const world = add(`IFCAXIS2PLACEMENT3D(${origin},${z},${x})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`);
  const unit = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const units = add(`IFCUNITASSIGNMENT((${unit}))`);
  const project = add(`IFCPROJECT(${guid()},$,'Teste',$,$,$,$,(${ctx}),${units})`);
  const sitePl = add(`IFCLOCALPLACEMENT($,${add(`IFCAXIS2PLACEMENT3D(${pt(deslocamento)},${z},${x})`)})`);
  const site = add(`IFCSITE(${guid()},$,'Terreno',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = add(`IFCLOCALPLACEMENT(${sitePl},${world})`);
  const bld = add(`IFCBUILDING(${guid()},$,'Edificio',$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const stPl = add(`IFCLOCALPLACEMENT(${bldPl},${world})`);
  const storey = add(`IFCBUILDINGSTOREY(${guid()},$,'${pavimento}',$,$,${stPl},$,$,.ELEMENT.,0.)`);
  add(`IFCRELAGGREGATES(${guid()},$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${guid()},$,$,$,${site},(${bld}))`);
  add(`IFCRELAGGREGATES(${guid()},$,$,$,${bld},(${storey}))`);
  const els = [];
  for (const e of elementos) {
    const axis = e.eixo || [0, 0, 1];
    const ref = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const pl = add(`IFCLOCALPLACEMENT(${stPl},${add(`IFCAXIS2PLACEMENT3D(${pt(e.base)},${dir(axis)},${dir(ref)})`)})`);
    const p2 = add(`IFCAXIS2PLACEMENT2D(${add('IFCCARTESIANPOINT((0.,0.))')},$)`);
    const profile = e.perfil.raio
      ? add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${p2},${n(e.perfil.raio)})`)
      : add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${p2},${n(e.perfil.retangulo[0])},${n(e.perfil.retangulo[1])})`);
    const solid = add(`IFCEXTRUDEDAREASOLID(${profile},${world},${z},${n(e.comprimento)})`);
    const shape = add(`IFCSHAPEREPRESENTATION(${ctx},'Body','SweptSolid',(${solid}))`);
    const prod = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}))`);
    const tipo = e.tipo || 'IFCBUILDINGELEMENTPROXY';
    const extra = tipo === 'IFCBUILDINGELEMENTPROXY' ? ',$' : tipo === 'IFCPIPESEGMENT' || tipo === 'IFCDUCTSEGMENT' || tipo === 'IFCCABLECARRIERSEGMENT' ? ',.NOTDEFINED.' : ',.NOTDEFINED.';
    els.push(add(`${tipo}(${guid()},$,'${e.nome}',$,$,${pl},${prod},$${extra})`));
  }
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,(${els.join(',')}),${storey})`);
  return [
    'ISO-10303-21;',
    "HEADER;FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');FILE_NAME('teste.ifc','2026-01-01T00:00:00',(''),(''),'','','');FILE_SCHEMA(('IFC4'));ENDSEC;",
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
}

module.exports = { makeIfc };
