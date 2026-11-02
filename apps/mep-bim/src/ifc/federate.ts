// Vínculos IFC (referências externas): modelos de outras disciplinas sobrepostos ao
// modelo principal, alinhados pelas coordenadas do projeto (as do IFC de cada um).
import { storeyAt } from "../core/points";
import type { Space } from "../core/spaces";
import type { Discipline, ElementInfo, PropertyGroup, Vec3 } from "../core/types";
import type { ElementMesh, LoadedModel } from "./loadIfc";
import { fromMap, toMap, type MapConversion } from "../core/georef";

/** Dados salvos no projeto. */
export interface LinkMeta {
  id: string;
  name: string;
  /** Caminho do arquivo (app desktop), para reabrir com o projeto. */
  path: string | null;
  /** "auto" = disciplina pela classe IFC de cada elemento. */
  discipline: Discipline | "auto";
  visible: boolean;
  translucent: boolean;
  /**
   * Alinhamento: "projeto" (origem a origem: mesmas coordenadas do IFC), "compartilhadas"
   * (pelo survey point / IfcMapConversion de cada arquivo) ou "manual" (deslocamento e rotação).
   */
  align?: LinkAlign;
}

export interface LinkAlign {
  mode: "projeto" | "compartilhadas" | "manual";
  /** Manual: deslocamento (m) e rotação (graus, anti-horário) aplicados às coordenadas do vínculo. */
  dx: number;
  dy: number;
  dz: number;
  rotDeg: number;
}

export const DEFAULT_ALIGN: LinkAlign = { mode: "projeto", dx: 0, dy: 0, dz: 0, rotDeg: 0 };

type IfcMap = (p: Vec3) => Vec3;

/**
 * Mapeamento das coordenadas IFC do vínculo para as do principal, conforme o alinhamento.
 * Devolve também um aviso quando o modo pedido não é possível (falta georreferenciamento).
 */
export function alignmentMap(align: LinkAlign, linkMap: MapConversion | null, hostMap: MapConversion | null): { map: IfcMap; warning: string | null } {
  if (align.mode === "compartilhadas") {
    if (linkMap && hostMap) return { map: (p) => fromMap(hostMap, toMap(linkMap, p)), warning: null };
    return {
      map: (p) => p,
      warning: !hostMap ? "O modelo principal não tem survey point: alinhado origem a origem." : "Este vínculo não tem survey point (IfcMapConversion): alinhado origem a origem.",
    };
  }
  if (align.mode === "manual") {
    const a = (align.rotDeg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { map: ([x, y, z]) => [c * x - s * y + align.dx, s * x + c * y + align.dy, z + align.dz], warning: null };
  }
  return { map: (p) => p, warning: null };
}

/** Vínculo carregado: elementos e malhas já na cena do modelo principal, com ids próprios. */
export interface LinkData {
  id: string;
  slot: number;
  raw: LoadedModel;
  elements: ElementInfo[];
  meshes: ElementMesh[];
  spaces: Space[];
  /** Assinatura do alinhamento usado (para refazer quando mudar). */
  alignKey: string;
  /** Aviso do alinhamento (ex.: sem survey point). */
  warning: string | null;
}

/** Ids de elementos dos vínculos: slot × 100.000.000 + expressID do arquivo de origem. */
export const LINK_ID_BASE = 100_000_000;
export const linkSlotOf = (id: number) => (id >= LINK_ID_BASE ? Math.floor(id / LINK_ID_BASE) : 0);

type Affine = { o: Vec3; x: Vec3; y: Vec3; z: Vec3 };

/** Transformação da cena do vínculo para a cena do principal (pelas coordenadas IFC). */
export function linkTransform(raw: LoadedModel, host: LoadedModel, ifcMap: IfcMap = (p) => p): Affine {
  const f = (p: Vec3) => host.coordinates.ifcToWorld(ifcMap(raw.coordinates.worldToIfc(p)));
  const o = f([0, 0, 0]);
  const d = (p: Vec3): Vec3 => {
    const q = f(p);
    return [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
  };
  return { o, x: d([1, 0, 0]), y: d([0, 1, 0]), z: d([0, 0, 1]) };
}

const apply = (t: Affine, p: Vec3): Vec3 => [
  t.o[0] + t.x[0] * p[0] + t.y[0] * p[1] + t.z[0] * p[2],
  t.o[1] + t.x[1] * p[0] + t.y[1] * p[1] + t.z[1] * p[2],
  t.o[2] + t.x[2] * p[0] + t.y[2] * p[1] + t.z[2] * p[2],
];

export function prepareLink(
  id: string,
  slot: number,
  raw: LoadedModel,
  host: LoadedModel,
  align: LinkAlign = DEFAULT_ALIGN,
  hostMap: MapConversion | null = host.georef?.map ?? null,
): LinkData {
  const { map: ifcMap, warning } = alignmentMap(align, raw.georef?.map ?? null, hostMap);
  const t = linkTransform(raw, host, ifcMap);
  const base = slot * LINK_ID_BASE;
  const identity = Math.abs(t.o[0]) + Math.abs(t.o[1]) + Math.abs(t.o[2]) < 1e-9 && t.x[0] === 1 && t.y[1] === 1 && t.z[2] === 1;
  const levels = host.storeyLevels;
  const elements = raw.elements.map((e): ElementInfo => {
    let bbox = e.bbox;
    if (bbox && !identity) {
      const corners: Vec3[] = [];
      for (const x of [bbox.min[0], bbox.max[0]]) for (const y of [bbox.min[1], bbox.max[1]]) for (const z of [bbox.min[2], bbox.max[2]]) corners.push(apply(t, [x, y, z]));
      bbox = {
        min: [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k]))) as Vec3,
        max: [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k]))) as Vec3,
      };
    }
    // Pavimentos do principal (os nomes dos pavimentos do vínculo podem ser outros).
    const storey = bbox && levels.length ? storeyAt(bbox.min[1] + 0.05, levels) : e.storey;
    return { ...e, expressID: base + e.expressID, bbox, storey };
  });
  const meshes = raw.meshes.map((m): ElementMesh => {
    if (identity) return { ...m, expressID: base + m.expressID };
    const positions = new Float32Array(m.positions.length);
    const normals = new Float32Array(m.normals.length);
    for (let i = 0; i < m.positions.length; i += 3) {
      const p = apply(t, [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
      positions[i] = p[0];
      positions[i + 1] = p[1];
      positions[i + 2] = p[2];
      const nx = m.normals[i];
      const ny = m.normals[i + 1];
      const nz = m.normals[i + 2];
      const n: Vec3 = [t.x[0] * nx + t.y[0] * ny + t.z[0] * nz, t.x[1] * nx + t.y[1] * ny + t.z[1] * nz, t.x[2] * nx + t.y[2] * ny + t.z[2] * nz];
      const l = Math.hypot(...n) || 1;
      normals[i] = n[0] / l;
      normals[i + 1] = n[1] / l;
      normals[i + 2] = n[2] / l;
    }
    return { ...m, expressID: base + m.expressID, positions, normals };
  });
  // Ambientes: contorno em coordenadas do projeto (passa pelo alinhamento); cotas para a cena do principal.
  const yToHost = (y: number) => host.coordinates.ifcToWorld([0, 0, ifcMap([0, 0, raw.coordinates.worldToIfc([0, y, 0])[2]])[2]])[1];
  const spaces = raw.spaces.map((s): Space => {
    const floorY = yToHost(s.floorY);
    const polygon = s.polygon.map(([x, y]) => {
      const q = ifcMap([x, y, 0]);
      return [q[0], q[1]] as [number, number];
    });
    return { ...s, expressID: base + s.expressID, polygon, floorY, topY: yToHost(s.topY), storey: levels.length ? storeyAt(floorY + 0.05, levels) : s.storey };
  });
  return { id, slot, raw, elements, meshes, spaces, alignKey: alignKey(align, hostMap), warning };
}

export const alignKey = (a: LinkAlign, hostMap: MapConversion | null) =>
  `${a.mode}|${a.dx}|${a.dy}|${a.dz}|${a.rotDeg}|${hostMap ? `${hostMap.eastings},${hostMap.northings},${hostMap.orthogonalHeight},${hostMap.xAxisAbscissa},${hostMap.xAxisOrdinate}` : "-"}`;

const withDiscipline = (els: ElementInfo[], d: LinkMeta["discipline"]) => (d === "auto" ? els : els.map((e) => ({ ...e, discipline: d })));

/**
 * Modelo federado: o principal mais os vínculos visíveis. Pavimentos, cotas e coordenadas
 * são os do principal; propriedades de cada elemento vêm do arquivo de origem.
 */
export function federate(host: LoadedModel, links: { data: LinkData; meta: LinkMeta }[]): LoadedModel {
  const visible = links.filter((l) => l.meta.visible);
  if (!visible.length) return host;
  const seenSpaces = new Set(host.spaces.map((s) => s.globalId));
  const spaces = [...host.spaces];
  for (const l of visible) {
    for (const s of l.data.spaces) {
      if (seenSpaces.has(s.globalId)) continue;
      seenSpaces.add(s.globalId);
      spaces.push(s);
    }
  }
  const bySlot = new Map(links.map((l) => [l.data.slot, l.data]));
  return {
    ...host,
    elements: [...host.elements, ...visible.flatMap((l) => withDiscipline(l.data.elements, l.meta.discipline))],
    meshes: [...host.meshes, ...visible.flatMap((l) => l.data.meshes)],
    spaces,
    systems: [...new Set([...host.systems, ...visible.flatMap((l) => l.data.raw.systems)])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    getProperties(id: number): PropertyGroup[] {
      const slot = linkSlotOf(id);
      if (!slot) return host.getProperties(id);
      const link = bySlot.get(slot);
      if (!link) return [];
      const name = links.find((l) => l.data.slot === slot)?.meta.name ?? "";
      return [{ name: "Vínculo", kind: "propriedades", values: [{ name: "Arquivo", value: name }] }, ...link.raw.getProperties(id - slot * LINK_ID_BASE)];
    },
    close: host.close,
  };
}
