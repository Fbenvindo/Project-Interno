// Leitura de modelos IFC com web-ifc: geometria (em metros, Y para cima),
// metadados MEP, pavimentos, sistemas e propriedades. Não depende de UI,
// então roda tanto no renderer quanto em Node (testes).
import {
  IFCBUILDINGSTOREY,
  IFCELEMENTQUANTITY,
  IFCPROPERTYSET,
  IFCRELAGGREGATES,
  IFCRELASSIGNSTOGROUP,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELDEFINESBYTYPE,
  IFCRELNESTS,
  IFCUNITASSIGNMENT,
  type IfcAPI,
} from "web-ifc";
import { classifyDiscipline, getCategory, isGenericMepType, isKnownIfcType } from "../core/disciplines";
import { deriveLength, deriveSize, systemsFromProps } from "../core/quantities";
import type { BBox, ElementInfo, PropertyGroup, PropertyValue } from "../core/types";

export interface ElementMesh {
  expressID: number;
  /** Posições em metros, coordenadas de mundo (Y para cima). */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** RGBA 0..1 definido no IFC. */
  color: [number, number, number, number];
}

export interface LoadedModel {
  modelID: number;
  schema: string;
  /** Fator da unidade de comprimento do projeto para metros. */
  unitToMeters: number;
  elements: ElementInfo[];
  meshes: ElementMesh[];
  /** Pavimentos ordenados por elevação. */
  storeys: string[];
  systems: string[];
  getProperties(expressID: number): PropertyGroup[];
  close(): void;
}

export type ProgressFn = (stage: string, fraction: number) => void;

const SYSTEM_GROUP_TYPES = new Set(["IFCSYSTEM", "IFCDISTRIBUTIONSYSTEM", "IFCDISTRIBUTIONCIRCUIT", "IFCBUILDINGSYSTEM"]);

/** Abre o modelo e extrai tudo o que o app precisa. `api` já deve estar inicializada. */
export function loadIfc(api: IfcAPI, bytes: Uint8Array, onProgress: ProgressFn = () => {}): LoadedModel {
  onProgress("Lendo arquivo IFC", 0);
  const modelID = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 16 });
  if (modelID < 0) throw new Error("Não foi possível abrir o arquivo IFC.");

  const typeName = (id: number) => api.GetNameFromTypeCode(api.GetLineType(modelID, id)).toUpperCase();
  const line = (id: number, flatten = false) => api.GetLine(modelID, id, flatten);
  const idsOf = (type: number) => Array.from(api.GetLineIDsWithType(modelID, type));
  const val = (attr: unknown): any => (attr && typeof attr === "object" && "value" in attr ? (attr as any).value : attr);
  const refs = (attr: unknown): number[] => (Array.isArray(attr) ? attr.map((a) => val(a)).filter((v) => typeof v === "number") : []);

  // ---- Geometria -----------------------------------------------------------
  onProgress("Gerando geometria", 0.1);
  const meshes: ElementMesh[] = [];
  api.StreamAllMeshes(modelID, (flat) => {
    const parts: { pos: Float32Array; nor: Float32Array; idx: Uint32Array }[] = [];
    let color: ElementMesh["color"] = [0.8, 0.8, 0.8, 1];
    const n = flat.geometries.size();
    for (let i = 0; i < n; i++) {
      const placed = flat.geometries.get(i);
      if (i === 0) color = [placed.color.x, placed.color.y, placed.color.z, placed.color.w];
      const geom = api.GetGeometry(modelID, placed.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const index = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      parts.push({ ...transform(verts, placed.flatTransformation), idx: Uint32Array.from(index) });
      geom.delete();
    }
    meshes.push({ expressID: flat.expressID, ...merge(parts), color });
  });

  // ---- Unidades ------------------------------------------------------------
  const unitToMeters = readLengthUnit();

  // ---- Estrutura espacial --------------------------------------------------
  onProgress("Lendo pavimentos e sistemas", 0.6);
  const parent = new Map<number, number>();
  for (const relType of [IFCRELAGGREGATES, IFCRELNESTS]) {
    for (const rid of idsOf(relType)) {
      const rel = line(rid);
      const owner = val(rel.RelatingObject);
      for (const child of refs(rel.RelatedObjects)) parent.set(child, owner);
    }
  }
  for (const rid of idsOf(IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const rel = line(rid);
    const owner = val(rel.RelatingStructure);
    for (const child of refs(rel.RelatedElements)) if (!parent.has(child)) parent.set(child, owner);
  }

  const storeyInfo = new Map<number, { name: string; elevation: number }>();
  for (const sid of idsOf(IFCBUILDINGSTOREY)) {
    const s = line(sid);
    storeyInfo.set(sid, {
      name: val(s.Name) || val(s.LongName) || `Pavimento #${sid}`,
      elevation: Number(val(s.Elevation) ?? 0),
    });
  }
  const storeyOf = (id: number): string | null => {
    let cur: number | undefined = id;
    for (let guard = 0; cur != null && guard < 50; guard++) {
      const info = storeyInfo.get(cur);
      if (info) return info.name;
      cur = parent.get(cur);
    }
    return null;
  };

  // ---- Sistemas ------------------------------------------------------------
  const systemsByElement = new Map<number, { name: string; predefinedType: string | null }[]>();
  for (const rid of idsOf(IFCRELASSIGNSTOGROUP)) {
    const rel = line(rid);
    const gid = val(rel.RelatingGroup);
    if (gid == null || !SYSTEM_GROUP_TYPES.has(typeName(gid))) continue;
    const g = line(gid);
    const sys = { name: val(g.Name) || val(g.LongName) || `Sistema #${gid}`, predefinedType: val(g.PredefinedType) ?? null };
    for (const el of refs(rel.RelatedObjects)) {
      const list = systemsByElement.get(el) ?? [];
      list.push(sys);
      systemsByElement.set(el, list);
    }
  }

  // ---- Índice de propriedades e tipos ---------------------------------------
  const psetsByElement = new Map<number, { id: number; fromType: boolean }[]>();
  const typeObjectOf = new Map<number, number>();
  const pushPset = (el: number, id: number, fromType: boolean) => {
    const list = psetsByElement.get(el) ?? [];
    list.push({ id, fromType });
    psetsByElement.set(el, list);
  };
  for (const rid of idsOf(IFCRELDEFINESBYPROPERTIES)) {
    const rel = line(rid);
    const def = val(rel.RelatingPropertyDefinition);
    for (const el of refs(rel.RelatedObjects)) pushPset(el, def, false);
  }
  for (const rid of idsOf(IFCRELDEFINESBYTYPE)) {
    const rel = line(rid);
    const tid = val(rel.RelatingType);
    if (tid == null) continue;
    const typeObj = line(tid);
    for (const el of refs(rel.RelatedObjects)) {
      typeObjectOf.set(el, tid);
      for (const pid of refs(typeObj.HasPropertySets)) pushPset(el, pid, true);
    }
  }

  const propCache = new Map<number, PropertyGroup[]>();
  const getProperties = (expressID: number): PropertyGroup[] => {
    const cached = propCache.get(expressID);
    if (cached) return cached;
    const groups: PropertyGroup[] = [];
    for (const { id, fromType } of psetsByElement.get(expressID) ?? []) {
      const g = readPropertyDefinition(id, fromType);
      if (g && g.values.length) groups.push(g);
    }
    propCache.set(expressID, groups);
    return groups;
  };

  function readPropertyDefinition(id: number, fromType: boolean): PropertyGroup | null {
    const t = api.GetLineType(modelID, id);
    if (t !== IFCPROPERTYSET && t !== IFCELEMENTQUANTITY) return null;
    const def = line(id, true);
    const name = (val(def.Name) || "Propriedades") + (fromType ? " (tipo)" : "");
    if (t === IFCELEMENTQUANTITY) {
      const values = (def.Quantities ?? []).map((q: any) => ({
        name: String(val(q.Name) ?? "?"),
        value: num(
          val(q.LengthValue) ?? val(q.AreaValue) ?? val(q.VolumeValue) ?? val(q.CountValue) ?? val(q.WeightValue) ?? val(q.TimeValue),
        ),
      }));
      return { name, kind: "quantidades", values };
    }
    const values = (def.HasProperties ?? []).map((p: any) => ({
      name: String(val(p.Name) ?? "?"),
      value: propertyValue(p),
    }));
    return { name, kind: "propriedades", values };
  }

  // ---- Elementos -----------------------------------------------------------
  onProgress("Classificando elementos", 0.8);
  const elements: ElementInfo[] = [];
  const systemNames = new Set<string>();
  for (const mesh of meshes) {
    const id = mesh.expressID;
    const data = line(id);
    let ifcType = typeName(id);
    if (isGenericMepType(ifcType)) {
      const tid = typeObjectOf.get(id);
      const refined = tid != null ? typeName(tid).replace(/TYPE$/, "") : null;
      if (refined && refined !== ifcType && isKnownIfcType(refined)) ifcType = refined;
    }
    const predefinedType = val(data.PredefinedType) ?? null;
    let systems = systemsByElement.get(id) ?? [];

    const preliminary = classifyDiscipline({ ifcType, predefinedType, systems });
    const isBuildingElement = preliminary === "estrutura" || preliminary === "arquitetura";
    const props = isBuildingElement ? [] : getProperties(id);
    if (!systems.length && props.length) {
      systems = systemsFromProps(props).map((name) => ({ name, predefinedType: null }));
    }
    const discipline = isBuildingElement ? preliminary : classifyDiscipline({ ifcType, predefinedType, systems });
    const category = getCategory(ifcType);
    const bbox = computeBBox(mesh.positions);
    systems.forEach((s) => systemNames.add(s.name));

    elements.push({
      expressID: id,
      globalId: val(data.GlobalId) ?? "",
      ifcType,
      name: val(data.Name) || `#${id}`,
      objectType: val(data.ObjectType) || null,
      predefinedType,
      storey: storeyOf(id),
      systems: systems.map((s) => s.name),
      discipline,
      category,
      bbox,
      length: category === "segmento" ? deriveLength(props, unitToMeters, bbox) : null,
      size: isBuildingElement ? null : deriveSize(props, unitToMeters),
    });
  }

  const storeys = [...storeyInfo.values()].sort((a, b) => a.elevation - b.elevation).map((s) => s.name);
  onProgress("Concluído", 1);

  return {
    modelID,
    schema: api.GetModelSchema(modelID),
    unitToMeters,
    elements,
    meshes,
    storeys,
    systems: [...systemNames].sort((a, b) => a.localeCompare(b, "pt-BR")),
    getProperties,
    close: () => api.CloseModel(modelID),
  };

  function readLengthUnit(): number {
    const prefixes: Record<string, number> = { MILLI: 1e-3, CENTI: 1e-2, DECI: 1e-1, KILO: 1e3 };
    for (const uid of idsOf(IFCUNITASSIGNMENT)) {
      const ua = line(uid, true);
      for (const u of ua.Units ?? []) {
        if (val(u?.UnitType) !== "LENGTHUNIT") continue;
        const prefix = val(u.Prefix);
        if (u.ConversionFactor) {
          const factor = Number(val(u.ConversionFactor.ValueComponent));
          const sub = u.ConversionFactor.UnitComponent;
          const subFactor = sub?.Prefix ? (prefixes[val(sub.Prefix)] ?? 1) : 1;
          if (Number.isFinite(factor) && factor > 0) return factor * subFactor;
          const name = String(val(u.Name) ?? "").toUpperCase();
          if (name.includes("INCH")) return 0.0254;
          if (name.includes("FOOT")) return 0.3048;
        }
        return prefix ? (prefixes[prefix] ?? 1) : 1;
      }
    }
    return 1;
  }
}

function num(v: unknown): PropertyValue {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
}

function propertyValue(p: any): PropertyValue {
  const one = (v: any): PropertyValue => {
    if (v == null) return null;
    const raw = typeof v === "object" && "value" in v ? v.value : v;
    const typeHint = typeof v === "object" ? String(v.name ?? v.constructor?.name ?? "").toUpperCase() : "";
    if (typeHint.includes("BOOLEAN") || typeHint.includes("LOGICAL")) {
      if (raw === "T" || raw === true) return true;
      if (raw === "F" || raw === false) return false;
    }
    return typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw);
  };
  if (p.NominalValue !== undefined) return one(p.NominalValue);
  const list = p.EnumerationValues ?? p.ListValues;
  if (Array.isArray(list)) return list.map((v: any) => one(v)).join(", ");
  if (p.UpperBoundValue || p.LowerBoundValue) {
    return `${one(p.LowerBoundValue) ?? "…"} – ${one(p.UpperBoundValue) ?? "…"}`;
  }
  return null;
}

/** Aplica a matriz 4x4 (column-major) do web-ifc ao array intercalado [x,y,z,nx,ny,nz]. */
function transform(verts: Float32Array, m: number[]): { pos: Float32Array; nor: Float32Array } {
  const count = verts.length / 6;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = verts[i * 6], y = verts[i * 6 + 1], z = verts[i * 6 + 2];
    const nx = verts[i * 6 + 3], ny = verts[i * 6 + 4], nz = verts[i * 6 + 5];
    pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const tx = m[0] * nx + m[4] * ny + m[8] * nz;
    const ty = m[1] * nx + m[5] * ny + m[9] * nz;
    const tz = m[2] * nx + m[6] * ny + m[10] * nz;
    const len = Math.hypot(tx, ty, tz) || 1;
    nor[i * 3] = tx / len;
    nor[i * 3 + 1] = ty / len;
    nor[i * 3 + 2] = tz / len;
  }
  return { pos, nor };
}

function merge(parts: { pos: Float32Array; nor: Float32Array; idx: Uint32Array }[]) {
  if (parts.length === 1) return { positions: parts[0].pos, normals: parts[0].nor, indices: parts[0].idx };
  const vtx = parts.reduce((s, p) => s + p.pos.length, 0);
  const idx = parts.reduce((s, p) => s + p.idx.length, 0);
  const positions = new Float32Array(vtx);
  const normals = new Float32Array(vtx);
  const indices = new Uint32Array(idx);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    positions.set(p.pos, vo);
    normals.set(p.nor, vo);
    const base = vo / 3;
    for (let i = 0; i < p.idx.length; i++) indices[io + i] = p.idx[i] + base;
    vo += p.pos.length;
    io += p.idx.length;
  }
  return { positions, normals, indices };
}

function computeBBox(positions: Float32Array): BBox | null {
  if (!positions.length) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}
