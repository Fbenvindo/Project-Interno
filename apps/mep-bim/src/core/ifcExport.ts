// Exporta os pontos locados como um modelo IFC4 próprio da disciplina, para
// federar com o modelo original (Revit, Navisworks, Solibri, BIMcollab…).
// As coordenadas são as do IFC de origem, então os modelos se sobrepõem.
import { COMPONENT_BY_ID } from "./library";
import type { CoordinateSystem } from "./math";
import { newGuid, storeyAt, type PlacedPoint, type StoreyLevel } from "./points";
import type { Circuit } from "./circuits";
import { derivedGuid, runFittings, runSegments, RUN_TYPE_BY_ID, segmentBasis, type Run } from "./runs";
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
  /** Trechos de tubulação, eletroduto e eletrocalha a exportar junto. */
  runs?: Run[];
  /** Circuitos: exportados como IfcDistributionCircuit com seus pontos e trechos. */
  circuits?: Circuit[];
}

export function exportPointsIfc(points: PlacedPoint[], { modelName, storeys, cs, runs = [], circuits = [] }: ExportOptions): string {
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
  const circuitMembers = new Map<string, number[]>();

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
    if (p.circuit) circuitMembers.set(p.circuit, [...(circuitMembers.get(p.circuit) ?? []), el]);

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

  // ---- Trechos: segmentos e conexões ------------------------------------------
  const addToStoreyAndSystem = (el: number, y: number, system: string, systemType: string) => {
    const name = storeyAt(y, storeys);
    const storey = name ? storeyIds.get(name) : undefined;
    (storey ? storey.elements : looseElements).push(el);
    if (system) {
      const sys = systems.get(system) ?? { type: systemType, members: [] };
      sys.members.push(el);
      systems.set(system, sys);
    }
  };
  const sectionProfile = (profile: "circular" | "retangular", width: number, height: number) =>
    profile === "circular"
      ? `IFCCIRCLEPROFILEDEF(.AREA.,$,${ref(origin2d)},${num(width / 2)})`
      : `IFCRECTANGLEPROFILEDEF(.AREA.,$,${ref(origin2d)},${num(width)},${num(height)})`;
  const body = (profileEntity: string, depth: number) => {
    const solid = w.add(`IFCEXTRUDEDAREASOLID(${ref(w.add(profileEntity))},${ref(solidPosition)},${ref(zAxis)},${num(depth)})`);
    const rep = w.add(`IFCSHAPEREPRESENTATION(${ref(context)},'Body','SweptSolid',${list([solid])})`);
    return w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,${list([rep])})`);
  };
  const toMm = (v: Vec3): Vec3 => cs.worldToIfc(v).map((c) => c * MM) as Vec3;

  for (const r of runs) {
    const t = RUN_TYPE_BY_ID[r.typeId];
    for (const seg of runSegments(r)) {
      if (seg.length < 0.0005) continue;
      const dirWorld = seg.end.map((v, i) => (v - seg.start[i]) / seg.length) as Vec3;
      const { x } = segmentBasis(dirWorld);
      const axis = cs.worldDirToIfc(dirWorld);
      const ref2 = cs.worldDirToIfc(x);
      const pl = placement(toMm(seg.start), dir(axis), dir(ref2));
      const shape = body(sectionProfile(t.profile, r.size.width, r.size.height), seg.length * MM);
      const el = w.add(
        `IFC${t.segmentType.replace(/^IFC/, "")}('${derivedGuid(r.guid, seg.index)}',$,${str(`${r.tag} - ${t.label} ${r.size.label}`)},$,${str(t.label)},${ref(pl)},${ref(shape)},${str(r.tag)},.${t.segmentPredefined}.)`,
      );
      if (r.circuit) circuitMembers.set(r.circuit, [...(circuitMembers.get(r.circuit) ?? []), el]);
      const props = [
        w.add(`IFCPROPERTYSINGLEVALUE('Etiqueta',$,IFCLABEL(${str(r.tag)}),$)`),
        w.add(`IFCPROPERTYSINGLEVALUE('Bitola',$,IFCLABEL(${str(r.size.label)}),$)`),
        w.add(`IFCPROPERTYSINGLEVALUE('Material',$,IFCLABEL(${str(t.material)}),$)`),
        w.add(`IFCPROPERTYSINGLEVALUE('Sistema',$,IFCLABEL(${str(r.system)}),$)`),
        ...(t.profile === "circular"
          ? [w.add(`IFCPROPERTYSINGLEVALUE('NominalDiameter',$,IFCPOSITIVELENGTHMEASURE(${num(r.size.width)}),$)`)]
          : [
              w.add(`IFCPROPERTYSINGLEVALUE('Width',$,IFCPOSITIVELENGTHMEASURE(${num(r.size.width)}),$)`),
              w.add(`IFCPROPERTYSINGLEVALUE('Height',$,IFCPOSITIVELENGTHMEASURE(${num(r.size.height)}),$)`),
            ]),
        ...(r.slope ? [w.add(`IFCPROPERTYSINGLEVALUE('Declividade (%)',$,IFCREAL(${num(r.slope)}),$)`)] : []),
        ...Object.entries(r.params)
          .filter(([, v]) => v !== "")
          .map(([k, v]) => w.add(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${typeof v === "number" ? `IFCREAL(${num(v)})` : `IFCLABEL(${str(String(v))})`},$)`)),
      ];
      const pset = w.add(`IFCPROPERTYSET('${newGuid()}',$,'Pset_MEP_Tracado',$,${list(props)})`);
      w.add(`IFCRELDEFINESBYPROPERTIES('${newGuid()}',$,$,$,${list([el])},${ref(pset)})`);
      const qtoName = t.segmentType === "IFCPIPESEGMENT" ? "Qto_PipeSegmentBaseQuantities" : "Qto_CableCarrierSegmentBaseQuantities";
      const q = w.add(`IFCQUANTITYLENGTH('Length',$,$,${num(seg.length * MM)},$)`);
      const qto = w.add(`IFCELEMENTQUANTITY('${newGuid()}',$,'${qtoName}',$,$,${list([q])})`);
      w.add(`IFCRELDEFINESBYPROPERTIES('${newGuid()}',$,$,$,${list([el])},${ref(qto)})`);
      addToStoreyAndSystem(el, Math.min(seg.start[1], seg.end[1]), r.system, t.systemType);
    }
  }

  for (const f of runFittings(runs)) {
    const t = RUN_TYPE_BY_ID[f.typeId];
    const r = runs.find((x) => x.id === f.runId)!;
    const d = Math.max(f.size.width, f.size.height) * 1.2;
    const center = toMm(f.position);
    const pl = placement([center[0], center[1], center[2] - d / 2]);
    const shape = body(
      t.profile === "circular"
        ? `IFCCIRCLEPROFILEDEF(.AREA.,$,${ref(origin2d)},${num(d / 2)})`
        : `IFCRECTANGLEPROFILEDEF(.AREA.,$,${ref(origin2d)},${num(f.size.width * 1.2)},${num(f.size.height * 1.2)})`,
      t.profile === "circular" ? d : f.size.height * 1.2,
    );
    const el = w.add(
      `IFC${t.fittingType.replace(/^IFC/, "")}('${derivedGuid(r.guid, 500 + f.index)}',$,${str(`${r.tag} - ${f.label} ${f.size.label}`)},$,${str(f.label)},${ref(pl)},${ref(shape)},${str(r.tag)},.${f.kind === "curva" ? t.bendPredefined : t.teePredefined}.)`,
    );
    addToStoreyAndSystem(el, f.position[1], f.system, t.systemType);
  }

  for (const s of storeyIds.values()) {
    if (s.elements.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${newGuid()}',$,$,$,${list(s.elements)},${ref(s.id)})`);
  }
  if (looseElements.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${newGuid()}',$,$,$,${list(looseElements)},${ref(building)})`);
  for (const [name, s] of systems) {
    const sys = w.add(`IFCDISTRIBUTIONSYSTEM('${newGuid()}',$,${str(name)},$,$,$,.${s.type}.)`);
    w.add(`IFCRELASSIGNSTOGROUP('${newGuid()}',$,$,$,${list(s.members)},$,${ref(sys)})`);
  }

  const panelTag = new Map(points.map((p) => [p.guid, p.tag]));
  for (const c of circuits) {
    const members = circuitMembers.get(c.uid);
    if (!members?.length) continue;
    const name = `${panelTag.get(c.panel) ?? "QD"}-${c.name}`;
    const circ = w.add(
      `IFCDISTRIBUTIONCIRCUIT('${/^[0-3][0-9A-Za-z_$]{21}$/.test(c.uid) ? c.uid : newGuid()}',$,${str(name)},${str(c.description || null)},$,${str(c.description || null)},.${c.type === "iluminacao" ? "LIGHTING" : "ELECTRICAL"}.)`,
    );
    w.add(`IFCRELASSIGNSTOGROUP('${newGuid()}',$,$,$,${list(members)},$,${ref(circ)})`);
  }

  const fileName = `${(modelName ?? "modelo").replace(/\.ifc$/i, "")}-locacao-mep.ifc`;
  return w.toString(fileName, "ViewDefinition [ReferenceView]");
}
