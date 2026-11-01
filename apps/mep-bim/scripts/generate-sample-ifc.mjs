// Gera um modelo IFC4 de exemplo com instalações MEP, usado como demonstração
// e como fixture dos testes. Uso: npm run sample
//
// Unidades do modelo: milímetros. Contém interferências propositais
// (duto x tubulação, duto x eletrocalha e MEP x parede interna).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "samples", "exemplo-mep.ifc");

const lines = [];
let nextId = 1;
let guidCounter = 0;
const GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** GlobalId determinístico (22 caracteres no alfabeto IFC). */
function guid() {
  let n = ++guidCounter;
  let s = "";
  while (n > 0) {
    s = GUID_CHARS[n % 64] + s;
    n = Math.floor(n / 64);
  }
  return "3MEP" + s.padStart(18, "0");
}

function add(entity) {
  const id = nextId++;
  lines.push(`#${id}=${entity};`);
  return id;
}

const num = (v) => (Number.isInteger(v) ? `${v}.` : String(v));
const str = (s) => (s == null ? "$" : `'${s}'`);
const ref = (id) => (id == null ? "$" : `#${id}`);
const list = (ids) => `(${ids.map(ref).join(",")})`;

const pt = (x, y, z) => add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
const dir = (x, y, z) => add(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
const origin2d = add("IFCCARTESIANPOINT((0.,0.))");
const xDir2d = add("IFCDIRECTION((1.,0.))");
const profilePlacement = add(`IFCAXIS2PLACEMENT2D(${ref(origin2d)},${ref(xDir2d)})`);
const zUp = dir(0, 0, 1);

function placement(x, y, z, axis = null, refDir = null) {
  const a = add(`IFCAXIS2PLACEMENT3D(${ref(pt(x, y, z))},${ref(axis)},${ref(refDir)})`);
  return add(`IFCLOCALPLACEMENT($,${ref(a)})`);
}

// ---- Projeto, unidades e contexto -------------------------------------------
const lengthUnit = add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)");
const areaUnit = add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
const volumeUnit = add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
const units = add(`IFCUNITASSIGNMENT(${list([lengthUnit, areaUnit, volumeUnit])})`);
const worldAxis = add(`IFCAXIS2PLACEMENT3D(${ref(pt(0, 0, 0))},$,$)`);
const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(worldAxis)},$)`);
const project = add(
  `IFCPROJECT('${guid()}',$,'Exemplo MEP',$,$,$,$,${list([context])},${ref(units)})`,
);
const site = add(
  `IFCSITE('${guid()}',$,'Terreno',$,$,${ref(placement(0, 0, 0))},$,$,.ELEMENT.,$,$,$,$,$)`,
);
const building = add(
  `IFCBUILDING('${guid()}',$,'Edifício Exemplo',$,$,${ref(placement(0, 0, 0))},$,$,.ELEMENT.,$,$,$)`,
);
const storeys = [
  { name: "Térreo", elevation: 0 },
  { name: "1º Pavimento", elevation: 3000 },
].map((s) => ({
  ...s,
  id: add(
    `IFCBUILDINGSTOREY('${guid()}',$,'${s.name}',$,$,${ref(placement(0, 0, s.elevation))},$,$,.ELEMENT.,${num(s.elevation)})`,
  ),
  elements: [],
}));
add(`IFCRELAGGREGATES('${guid()}',$,$,$,${ref(project)},${list([site])})`);
add(`IFCRELAGGREGATES('${guid()}',$,$,$,${ref(site)},${list([building])})`);
add(`IFCRELAGGREGATES('${guid()}',$,$,$,${ref(building)},${list(storeys.map((s) => s.id))})`);

// ---- Geometria --------------------------------------------------------------
function shape(solid) {
  const rep = add(`IFCSHAPEREPRESENTATION(${ref(context)},'Body','SweptSolid',${list([solid])})`);
  return add(`IFCPRODUCTDEFINITIONSHAPE($,$,${list([rep])})`);
}

/** Caixa com base centrada em (cx, cy) e cota inferior z. */
function box(cx, cy, z, dx, dy, dz) {
  const profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${ref(profilePlacement)},${num(dx)},${num(dy)})`);
  const pos = add(`IFCAXIS2PLACEMENT3D(${ref(pt(0, 0, 0))},$,$)`);
  const solid = add(`IFCEXTRUDEDAREASOLID(${ref(profile)},${ref(pos)},${ref(zUp)},${num(dz)})`);
  return { placement: placement(cx, cy, z), shape: shape(solid) };
}

/**
 * Segmento horizontal a partir do eixo inicial (x, y, z), ao longo de "x" ou "y".
 * section: { diameter } para seção circular ou { width, height } para retangular.
 */
function run(x, y, z, axis, length, section) {
  const runDir = axis === "x" ? dir(1, 0, 0) : dir(0, 1, 0);
  const profile = section.diameter
    ? add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${ref(profilePlacement)},${num(section.diameter / 2)})`)
    : add(
        `IFCRECTANGLEPROFILEDEF(.AREA.,$,${ref(profilePlacement)},${num(section.height)},${num(section.width)})`,
      );
  const pos = add(`IFCAXIS2PLACEMENT3D(${ref(pt(0, 0, 0))},$,$)`);
  const solid = add(`IFCEXTRUDEDAREASOLID(${ref(profile)},${ref(pos)},${ref(zUp)},${num(length)})`);
  return { placement: placement(x, y, z, runDir, dir(0, 0, 1)), shape: shape(solid) };
}

// ---- Propriedades -----------------------------------------------------------
function psets(elementId, { props = {}, length = null, qtoName = null }) {
  const propIds = Object.entries(props).map(([name, value]) => {
    const v =
      typeof value === "number"
        ? `IFCPOSITIVELENGTHMEASURE(${num(value)})`
        : `IFCLABEL('${value}')`;
    return add(`IFCPROPERTYSINGLEVALUE('${name}',$,${v},$)`);
  });
  if (propIds.length) {
    const pset = add(`IFCPROPERTYSET('${guid()}',$,'Pset_MEP_Exemplo',$,${list(propIds)})`);
    add(`IFCRELDEFINESBYPROPERTIES('${guid()}',$,$,$,${list([elementId])},${ref(pset)})`);
  }
  if (length != null && qtoName) {
    const q = add(`IFCQUANTITYLENGTH('Length',$,$,${num(length)},$)`);
    const qto = add(`IFCELEMENTQUANTITY('${guid()}',$,'${qtoName}',$,$,${list([q])})`);
    add(`IFCRELDEFINESBYPROPERTIES('${guid()}',$,$,$,${list([elementId])},${ref(qto)})`);
  }
}

const systems = new Map();
function system(name, predefined) {
  if (!systems.has(name)) {
    const id = add(`IFCDISTRIBUTIONSYSTEM('${guid()}',$,'${name}',$,$,$,.${predefined}.)`);
    systems.set(name, { id, members: [] });
  }
  return systems.get(name);
}

/** Cria um elemento IFC4 de 9 atributos (padrão dos elementos de distribuição). */
function element(type, name, geom, predefined, storey, opts = {}) {
  const id = add(
    `IFC${type}('${guid()}',$,'${name}',$,$,${ref(geom.placement)},${ref(geom.shape)},$,.${predefined}.)`,
  );
  storey.elements.push(id);
  if (opts.system) system(opts.system[0], opts.system[1]).members.push(id);
  psets(id, opts);
  return id;
}

const [terreo, pav1] = storeys;
const AF = ["Água Fria", "DOMESTICCOLDWATER"];
const SPK = ["Incêndio - Sprinklers", "FIREPROTECTION"];
const VENT = ["Ventilação - Insuflamento", "VENTILATION"];
const ELE = ["Elétrica - Força e Iluminação", "ELECTRICAL"];
const TEL = ["Telecom - Dados", "COMMUNICATION"];

// Arquitetura / estrutura
element("WALL", "Parede externa sul", box(5000, 0, 0, 10000, 150, 3000), "STANDARD", terreo);
element("WALL", "Parede externa norte", box(5000, 6000, 0, 10000, 150, 3000), "STANDARD", terreo);
element("WALL", "Parede interna", box(7000, 3000, 0, 150, 5850, 3000), "STANDARD", terreo);
element("SLAB", "Laje 1º pavimento", box(5000, 3000, 3000, 10000, 6000, 150), "FLOOR", pav1);

// Hidráulica - água fria (DN50 PVC)
element("PIPESEGMENT", "Tubo AF DN50", run(500, 1500, 2600, "x", 9000, { diameter: 50 }), "RIGIDSEGMENT", terreo, {
  system: AF,
  props: { NominalDiameter: 50, Material: "PVC soldável" },
  length: 9000,
  qtoName: "Qto_PipeSegmentBaseQuantities",
});
element("VALVE", "Registro de gaveta DN50", box(400, 1500, 2550, 100, 100, 100), "ISOLATING", terreo, {
  system: AF,
});
element("PIPESEGMENT", "Tubo AF DN32", run(500, 1500, 5600, "x", 6000, { diameter: 32 }), "RIGIDSEGMENT", pav1, {
  system: AF,
  props: { NominalDiameter: 32, Material: "PVC soldável" },
  length: 6000,
  qtoName: "Qto_PipeSegmentBaseQuantities",
});

// Incêndio - sprinklers (sem quantitativo: comprimento obtido pela geometria)
element("PIPESEGMENT", "Tubo SPK DN25", run(500, 4500, 2700, "x", 9000, { diameter: 25 }), "RIGIDSEGMENT", terreo, {
  system: SPK,
  props: { NominalDiameter: 25, Material: "Aço carbono" },
});
for (const x of [2000, 4500, 8500]) {
  element("FIRESUPPRESSIONTERMINAL", "Sprinkler pendente", box(x, 4500, 2620, 50, 50, 70), "SPRINKLER", terreo, {
    system: SPK,
  });
}

// HVAC - duto de insuflamento 400x300 e difusores
element("DUCTSEGMENT", "Duto 400x300", run(5000, 200, 2500, "y", 5600, { width: 400, height: 300 }), "RIGIDSEGMENT", terreo, {
  system: VENT,
  props: { Width: 400, Height: 300, Material: "Chapa galvanizada" },
  length: 5600,
  qtoName: "Qto_DuctSegmentBaseQuantities",
});
for (const y of [1000, 5000]) {
  element("AIRTERMINAL", "Difusor 600x600", box(5000, y, 2300, 600, 600, 50), "DIFFUSER", terreo, { system: VENT });
}

// Elétrica - eletrocalha, quadro, luminárias e tomadas
element(
  "CABLECARRIERSEGMENT",
  "Eletrocalha 200x100",
  run(500, 3000, 2550, "x", 9000, { width: 200, height: 100 }),
  "CABLETRAYSEGMENT",
  terreo,
  {
    system: ELE,
    props: { Width: 200, Height: 100, Material: "Aço galvanizado" },
    length: 9000,
    qtoName: "Qto_CableCarrierSegmentBaseQuantities",
  },
);
element("ELECTRICDISTRIBUTIONBOARD", "QDL-01", box(9500, 5800, 1000, 600, 200, 800), "DISTRIBUTIONBOARD", terreo, {
  system: ELE,
});
for (const [x, y] of [
  [2000, 1500],
  [2000, 4500],
  [6000, 1500],
  [6000, 4500],
]) {
  element("LIGHTFIXTURE", "Luminária LED 600x600 40W", box(x, y, 2900, 600, 600, 80), "POINTSOURCE", terreo, {
    system: ELE,
    props: { Potencia: "40 W" },
  });
}
for (const [x, y] of [
  [3000, 3000],
  [8000, 3000],
]) {
  element("LIGHTFIXTURE", "Luminária LED 600x600 40W", box(x, y, 5900, 600, 600, 80), "POINTSOURCE", pav1, {
    system: ELE,
    props: { Potencia: "40 W" },
  });
}
for (const x of [1500, 4000, 8500]) {
  element("OUTLET", "Tomada 2P+T 10A", box(x, 120, 300, 100, 30, 100), "POWEROUTLET", terreo, { system: ELE });
}
element("OUTLET", "Tomada 2P+T 10A", box(2000, 120, 3300, 100, 30, 100), "POWEROUTLET", pav1, { system: ELE });
element("OUTLET", "Ponto de dados RJ45", box(6000, 120, 300, 100, 30, 100), "DATAOUTLET", terreo, { system: TEL });

// ---- Relações espaciais e de sistemas --------------------------------------
for (const s of storeys) {
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',$,$,$,${list(s.elements)},${ref(s.id)})`);
}
for (const s of systems.values()) {
  add(`IFCRELASSIGNSTOGROUP('${guid()}',$,$,$,${list(s.members)},$,${ref(s.id)})`);
}

const header = [
  "ISO-10303-21;",
  "HEADER;",
  "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
  "FILE_NAME('exemplo-mep.ifc','2026-01-01T00:00:00',(''),(''),'MEP BIM - gerador de exemplo','','');",
  "FILE_SCHEMA(('IFC4'));",
  "ENDSEC;",
  "DATA;",
];
// O formato STEP usa ISO 8859-1 com escapes; codificamos acentos como \X2\...\X0\.
const encode = (s) =>
  s.replace(/[^\x20-\x7E]/g, (c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}\\X0\\`);
const content = [...header, ...lines.map(encode), "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, content, "utf8");
console.log(`Gerado ${outFile} (${lines.length} entidades)`);
