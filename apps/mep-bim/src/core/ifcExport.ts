// Exporta os pontos locados como um modelo IFC4 próprio da disciplina, para
// federar com o modelo original (Revit, Navisworks, Solibri, BIMcollab…).
// As coordenadas são as do IFC de origem, então os modelos se sobrepõem.
import { COMPONENT_BY_ID } from "./library";
import type { CoordinateSystem } from "./math";
import { newGuid, type PlacedPoint, type StoreyLevel } from "./points";
import type { Vec3 } from "./types";

class StepWriter {
  private lines: string[] = [];
  private next = 1;

  add(entity: string): number {
    const id = this.next++;
    this.lines.push(`#${id}=${entity};`);
    return id;
  }

  toString(fileName: string, description: string): string {
    const header = [
      "ISO-10303-21;",
      "HEADER;",
      `FILE_DESCRIPTION((${str(description)}),'2;1');`,
      `FILE_NAME(${str(fileName)},'${new Date().toISOString().slice(0, 19)}',(''),(''),'MEP BIM','MEP BIM','');`,
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
    ];
    return [...header, ...this.lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
  }
}

/** Número real no formato STEP (sempre com ponto decimal). */
export function num(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  const s = String(Object.is(r, -0) ? 0 : r);
  if (s.includes("e")) return r.toExponential().replace("e", "E").replace(/^(-?\d+)E/, "$1.E");
  return s.includes(".") ? s : `${s}.`;
}

/** String STEP: aspas duplicadas e caracteres fora do ASCII como \X2\hhhh\X0\. */
export function str(s: string | null | undefined): string {
  if (s == null) return "$";
  const body = s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .replace(/[^\x20-\x7E]/g, (c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}\\X0\\`);
  return `'${body}'`;
}

const ref = (id: number | null) => (id == null ? "$" : `#${id}`);
const list = (ids: number[]) => `(${ids.map(ref).join(",")})`;

export interface ExportOptions {
  modelName: string | null;
  storeys: StoreyLevel[];
  cs: CoordinateSystem;
}

export function exportPointsIfc(points: PlacedPoint[], { modelName, storeys, cs }: ExportOptions): string {
  const w = new StepWriter();
  const MM = 1000;
  const pt = ([x, y, z]: Vec3) => w.add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  const dir = ([x, y, z]: Vec3) => w.add(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
  const placement = (loc: Vec3, axis: number | null = null, refDir: number | null = null, relTo: number | null = null) => {
    const a = w.add(`IFCAXIS2PLACEMENT3D(${ref(pt(loc))},${ref(axis)},${ref(refDir)})`);
    return w.add(`IFCLOCALPLACEMENT(${ref(relTo)},${ref(a)})`);
  };

  const units = w.add(`IFCUNITASSIGNMENT(${list([w.add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)"), w.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)")])})`);
  const context = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(w.add(`IFCAXIS2PLACEMENT3D(${ref(pt([0, 0, 0]))},$,$)`))},$)`);
  const projectName = `Locação MEP${modelName ? ` - ${modelName.replace(/\.ifc$/i, "")}` : ""}`;
  const project = w.add(`IFCPROJECT('${newGuid()}',$,${str(projectName)},$,$,$,$,${list([context])},${ref(units)})`);
  const sitePlacement = placement([0, 0, 0]);
  const site = w.add(`IFCSITE('${newGuid()}',$,'Terreno',$,$,${ref(sitePlacement)},$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingPlacement = placement([0, 0, 0], null, null, sitePlacement);
  const building = w.add(`IFCBUILDING('${newGuid()}',$,'Edifício',$,$,${ref(buildingPlacement)},$,$,.ELEMENT.,$,$,$)`);
  w.add(`IFCRELAGGREGATES('${newGuid()}',$,$,$,${ref(project)},${list([site])})`);
  w.add(`IFCRELAGGREGATES('${newGuid()}',$,$,$,${ref(site)},${list([building])})`);

  // Pavimentos com os mesmos nomes e cotas do modelo de origem.
  const storeyIds = new Map<string, { id: number; elements: number[] }>();
  for (const s of storeys) {
    const elev = cs.worldToIfc([0, s.level, 0])[2] * MM;
    const id = w.add(
      `IFCBUILDINGSTOREY('${newGuid()}',$,${str(s.name)},$,$,${ref(placement([0, 0, elev], null, null, buildingPlacement))},$,$,.ELEMENT.,${num(elev)})`,
    );
    storeyIds.set(s.name, { id, elements: [] });
  }
  if (storeyIds.size) w.add(`IFCRELAGGREGATES('${newGuid()}',$,$,$,${ref(building)},${list([...storeyIds.values()].map((s) => s.id))})`);
  const looseElements: number[] = [];

  const zAxis = dir([0, 0, 1]);
  const origin2d = w.add(`IFCAXIS2PLACEMENT2D(${ref(w.add("IFCCARTESIANPOINT((0.,0.))"))},$)`);
  const solidPosition = w.add(`IFCAXIS2PLACEMENT3D(${ref(pt([0, 0, 0]))},$,$)`);
  const systems = new Map<string, { type: string; members: number[] }>();

  for (const p of points) {
    const def = COMPONENT_BY_ID[p.componentId];
    const [sw, sd, sh] = def.size;
    const profile =
      def.shape === "cilindro"
        ? w.add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${ref(origin2d)},${num(sw / 2)})`)
        : w.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${ref(origin2d)},${num(sw)},${num(sd)})`);
    const solid = w.add(`IFCEXTRUDEDAREASOLID(${ref(profile)},${ref(solidPosition)},${ref(zAxis)},${num(sh)})`);
    const rep = w.add(`IFCSHAPEREPRESENTATION(${ref(context)},'Body','SweptSolid',${list([solid])})`);
    const shape = w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,${list([rep])})`);

    // Origem local na base do componente; eixo X local ao longo da largura.
    const center = cs.worldToIfc(p.position);
    const base: Vec3 = [center[0] * MM, center[1] * MM, center[2] * MM - sh / 2];
    const xDir = cs.worldDirToIfc([Math.cos(p.rotation), 0, -Math.sin(p.rotation)]);
    const objPlacement = placement(base, zAxis, dir([xDir[0], xDir[1], 0]));

    const el = w.add(
      `IFC${def.ifcType.replace(/^IFC/, "")}('${p.guid}',$,${str(`${p.tag} - ${def.label}`)},$,${str(def.label)},${ref(objPlacement)},${ref(shape)},${str(p.tag)},.${def.predefinedType}.)`,
    );

    const props: number[] = [
      w.add(`IFCPROPERTYSINGLEVALUE('Etiqueta',$,IFCLABEL(${str(p.tag)}),$)`),
      w.add(`IFCPROPERTYSINGLEVALUE('Componente',$,IFCLABEL(${str(def.label)}),$)`),
      w.add(`IFCPROPERTYSINGLEVALUE(${str("Fixação")},$,IFCLABEL(${str(def.mounting)}),$)`),
      w.add(`IFCPROPERTYSINGLEVALUE('Altura de montagem',$,IFCLENGTHMEASURE(${num(p.height)}),$)`),
      w.add(`IFCPROPERTYSINGLEVALUE('Sistema',$,IFCLABEL(${str(p.system)}),$)`),
    ];
    for (const param of def.params) {
      const v = p.params[param.name];
      if (v === undefined || v === "") continue;
      const name = param.unit ? `${param.name} (${param.unit})` : param.name;
      const value = typeof v === "number" ? `IFCREAL(${num(v)})` : `IFCLABEL(${str(String(v))})`;
      props.push(w.add(`IFCPROPERTYSINGLEVALUE(${str(name)},$,${value},$)`));
    }
    const pset = w.add(`IFCPROPERTYSET('${newGuid()}',$,'Pset_MEP_Locacao',$,${list(props)})`);
    w.add(`IFCRELDEFINESBYPROPERTIES('${newGuid()}',$,$,$,${list([el])},${ref(pset)})`);

    const storey = p.storey ? storeyIds.get(p.storey) : undefined;
    (storey ? storey.elements : looseElements).push(el);
    if (p.system) {
      const sys = systems.get(p.system) ?? { type: def.systemType, members: [] };
      sys.members.push(el);
      systems.set(p.system, sys);
    }
  }

  for (const s of storeyIds.values()) {
    if (s.elements.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${newGuid()}',$,$,$,${list(s.elements)},${ref(s.id)})`);
  }
  if (looseElements.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${newGuid()}',$,$,$,${list(looseElements)},${ref(building)})`);
  for (const [name, s] of systems) {
    const sys = w.add(`IFCDISTRIBUTIONSYSTEM('${newGuid()}',$,${str(name)},$,$,$,.${s.type}.)`);
    w.add(`IFCRELASSIGNSTOGROUP('${newGuid()}',$,$,$,${list(s.members)},$,${ref(sys)})`);
  }

  const fileName = `${(modelName ?? "modelo").replace(/\.ifc$/i, "")}-locacao-mep.ifc`;
  return w.toString(fileName, "ViewDefinition [ReferenceView]");
}
