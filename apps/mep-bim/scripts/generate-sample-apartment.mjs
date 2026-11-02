// Gera um apartamento IFC4 de exemplo com louças, eletrodomésticos e móveis por
// ambiente, para o programa de necessidades. Uso: node scripts/generate-sample-apartment.mjs
// Unidades do modelo: milímetros.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "samples", "exemplo-apartamento.ifc");

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
  return "3APT" + s.padStart(18, "0");
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
// Norte verdadeiro a 10° do +Y do projeto (anti-horário).
const trueNorth = add(`IFCDIRECTION((${num(-Math.sin((10 * Math.PI) / 180))},${num(Math.cos((10 * Math.PI) / 180))}))`);
const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(worldAxis)},${ref(trueNorth)})`);
// Georreferenciamento (IFC4): SIRGAS 2000 / UTM 23S, survey point em E 333.456,789 / N 7.394.123,456 / 760 m,
// eixo X do projeto girado 12° em relação ao leste.
const mapUnit = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
const crs = add(`IFCPROJECTEDCRS('EPSG:31983','SIRGAS 2000 / UTM zone 23S','SIRGAS2000',$,'UTM','23S',${ref(mapUnit)})`);
add(`IFCMAPCONVERSION(${ref(context)},${ref(crs)},333456.789,7394123.456,760.,${num(Math.cos((12 * Math.PI) / 180))},${num(Math.sin((12 * Math.PI) / 180))},1.)`);
const project = add(
  `IFCPROJECT('${guid()}',$,'Apartamento exemplo',$,$,$,$,${list([context])},${ref(units)})`,
);
const site = add(
  `IFCSITE('${guid()}',$,'Terreno',$,$,${ref(placement(0, 0, 0))},$,$,.ELEMENT.,(-23,33,1,500000),(-46,38,2,0),760000.,$,$)`,
);
const building = add(
  `IFCBUILDING('${guid()}',$,'Residencial Exemplo',$,$,${ref(placement(0, 0, 0))},$,$,.ELEMENT.,$,$,$)`,
);
const storeys = [
  { name: "Pavimento tipo", elevation: 0 },
  { name: "Cobertura", elevation: 2950 },
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

/** Elemento IFC4 de 9 atributos (Name, ObjectType e PredefinedType). */
function element(type, name, geom, predefined, storey, objectType = null) {
  const id = add(`IFC${type}('${guid()}',$,'${name}',$,${str(objectType)},${ref(geom.placement)},${ref(geom.shape)},$,.${predefined}.)`);
  storey.elements.push(id);
  return id;
}

const [tipo, cobertura] = storeys;
const H = 2800;
const T = 150;

// Paredes (externas e internas)
const wall = (name, cx, cy, dx, dy) => element("WALL", name, box(cx, cy, 0, dx, dy, H), "STANDARD", tipo);
wall("Parede externa sul", 5000, 0, 10000 + T, T);
wall("Parede externa norte", 5000, 8000, 10000 + T, T);
wall("Parede externa oeste", 0, 4000, T, 8000);
wall("Parede externa leste", 10000, 4000, T, 8000);
wall("Parede sala/cozinha", 6000, 4000, T, 8000);
wall("Parede social/íntima", 5000, 4500, 10000, T);
wall("Parede banho/serviço", 8500, 6250, T, 3500);
element("SLAB", "Laje de cobertura", box(5000, 4000, H, 10000 + T, 8000 + T, 150), "ROOF", cobertura);

// Estrutura: pilares 20×20 nos cantos e nos encontros das paredes; vigas 15×50 sob a laje de cobertura.
const column = (name, cx, cy) => element("COLUMN", name, box(cx, cy, 0, 200, 200, H), "COLUMN", tipo);
column("Pilar P1", 0, 0);
column("Pilar P2", 6000, 0);
column("Pilar P3", 10000, 0);
column("Pilar P4", 0, 8000);
column("Pilar P5", 6000, 8000);
column("Pilar P6", 10000, 8000);
const beam = (name, cx, cy, dx, dy) => element("BEAM", name, box(cx, cy, H - 500, dx, dy, 500), "BEAM", tipo);
beam("Viga V1", 5000, 0, 10000, 150);
beam("Viga V2", 5000, 8000, 10000, 150);
beam("Viga V3", 6000, 4000, 150, 8000);
beam("Viga V4", 3000, 4500, 6000, 150);

// Equipamentos (nomes como saem do Revit: Família:Tipo)
const eq = (type, name, cx, cy, z, dx, dy, dz, predefined, objectType) => element(type, name, box(cx, cy, z, dx, dy, dz), predefined, tipo, objectType);
// Sala
eq("AUDIOVISUALAPPLIANCE", "Televisão 55\"", 3000, 150, 1000, 1240, 60, 720, "TV", "Televisão:55 polegadas");
eq("FURNITURE", "Sofá 3 lugares", 3000, 3300, 0, 2100, 900, 850, "SOFA", "Sofá:3 lugares");
// Cozinha
eq("SANITARYTERMINAL", "Pia de cozinha 1,20 m", 8000, 375, 600, 1200, 550, 250, "SINK", "Pia de cozinha:Inox 1,20 m");
eq("ELECTRICAPPLIANCE", "Geladeira duplex", 9600, 1600, 0, 700, 700, 1850, "FRIDGE_FREEZER", "Geladeira:Duplex 480 L");
eq("ELECTRICAPPLIANCE", "Fogão 4 bocas", 6700, 375, 0, 550, 600, 850, "ELECTRICCOOKER", "Fogão:4 bocas");
// Banheiro
eq("SANITARYTERMINAL", "Bacia sanitária com caixa acoplada", 6450, 7600, 0, 380, 650, 780, "TOILETPAN", "Bacia sanitária:Caixa acoplada");
eq("SANITARYTERMINAL", "Lavatório suspenso", 7400, 7700, 650, 500, 450, 200, "WASHHANDBASIN", "Lavatório:Suspenso 50 cm");
eq("SANITARYTERMINAL", "Chuveiro elétrico", 8250, 4800, 2050, 150, 150, 100, "SHOWER", "Chuveiro:Elétrico");
// Área de serviço
eq("SANITARYTERMINAL", "Tanque de louça", 9600, 7600, 600, 550, 450, 300, "SINK", "Tanque:40 L");
eq("ELECTRICAPPLIANCE", "Máquina de lavar roupa", 9550, 6200, 0, 600, 650, 950, "WASHINGMACHINE", "Lavadora:12 kg");
// Escritório
eq("FURNITURE", "Mesa de trabalho 1,40 m", 1500, 7550, 0, 1400, 700, 750, "DESK", "Mesa de trabalho:1,40 m");

// Ambientes
const spaces = [];
function space(number, longName, x0, y0, x1, y1) {
  const geom = box((x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, H);
  const id = add(`IFCSPACE('${guid()}',$,'${number}',$,$,${ref(geom.placement)},${ref(geom.shape)},'${longName}',.ELEMENT.,.SPACE.,$)`);
  const area = add(`IFCQUANTITYAREA('NetFloorArea',$,$,${num(((x1 - x0) * (y1 - y0)) / 1e6)},$)`);
  const qto = add(`IFCELEMENTQUANTITY('${guid()}',$,'Qto_SpaceBaseQuantities',$,$,${list([area])})`);
  add(`IFCRELDEFINESBYPROPERTIES('${guid()}',$,$,$,${list([id])},${ref(qto)})`);
  spaces.push(id);
}
const h = T / 2;
space("01", "Sala", h, h, 6000 - h, 4500 - h);
space("02", "Cozinha", 6000 + h, h, 10000 - h, 4500 - h);
space("03", "Banheiro", 6000 + h, 4500 + h, 8500 - h, 8000 - h);
space("04", "Área de serviço", 8500 + h, 4500 + h, 10000 - h, 8000 - h);
space("05", "Escritório", h, 4500 + h, 6000 - h, 8000 - h);
add(`IFCRELAGGREGATES('${guid()}',$,$,$,${ref(tipo.id)},${list(spaces)})`);

for (const s of storeys) {
  if (s.elements.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',$,$,$,${list(s.elements)},${ref(s.id)})`);
}

const header = [
  "ISO-10303-21;",
  "HEADER;",
  "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
  "FILE_NAME('exemplo-apartamento.ifc','2026-01-01T00:00:00',(''),(''),'SmartEasyBIM - gerador de exemplo','','');",
  "FILE_SCHEMA(('IFC4'));",
  "ENDSEC;",
  "DATA;",
];
const encode = (s) =>
  s.replace(/[^\x20-\x7E]/g, (c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}\\X0\\`);
const content = [...header, ...lines.map(encode), "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, content, "utf8");
console.log(`Gerado ${outFile} (${lines.length} entidades)`);
