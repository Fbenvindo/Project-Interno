// Modelo exportado do Revit pelo plugin do SmartEasyBIM (.sebmod): JSON compactado (gzip) com
// os elementos (categoria, família, tipo e parâmetros), a geometria (malhas de tipo
// compartilhadas pelas instâncias), níveis, ambientes, eixos e coordenadas compartilhadas.
// Vira o mesmo IfcData de um IFC: plantas, cortes, 3D, cache, visibilidade e quantitativos
// funcionam igual. As categorias do Revit são traduzidas para as classes IFC equivalentes.
import { classifyDiscipline, getCategory } from "../core/disciplines";
import type { Georef } from "../core/georef";
import { IDENTITY, type Mat4 } from "../core/math";
import type { StoreyLevel } from "../core/points";
import type { Space } from "../core/spaces";
import type { BBox, ElementInfo, PropertyGroup, PropertyValue, Vec3 } from "../core/types";
import type { ElementMesh, IfcData } from "./loadIfc";
import { chunksOfMeshes } from "./meshChunks";

export const SEBMOD_FORMAT = "smarteasybim/modelo";

interface SebParam {
  nome: string;
  valor: PropertyValue;
  texto?: string | null;
  unidade?: string | null;
  grupo?: string | null;
}

interface SebType {
  id: number;
  familia: string;
  nome: string;
  parametros?: SebParam[];
  /** Linhas do símbolo em planta (polilinhas x, y em m, nas coordenadas da família). */
  planta?: number[][];
}

interface SebMesh {
  id: number;
  /** Vértices (m): da família (malha de tipo) ou do modelo (malha própria). */
  posicoes: number[];
  indices: number[];
  paleta?: string[];
  cores?: number[];
}

interface SebElement {
  id: number;
  guid?: string;
  categoria: string;
  categoriaRevit?: string | null;
  tipo?: number | null;
  nome?: string;
  nivel?: string | null;
  /** Malhas do elemento; `matriz` (3×4, por linhas: X, Y, Z e origem) leva a malha ao modelo. */
  malhas?: { malha: number; matriz?: number[] }[];
  parametros?: SebParam[];
  sistemas?: string[];
  /** Portas e janelas: posição, eixos (x ao longo da parede, y para onde abre) e símbolo. */
  porta?: { origem: number[]; x: number[]; y: number[]; matriz?: number[]; espelhada?: boolean; hospedeiro?: number | null };
  comprimento?: number | null;
}

interface SebRoom {
  id: number;
  guid?: string;
  nome: string;
  numero: string;
  nivel?: string | null;
  area?: number;
  cotaPiso: number;
  altura: number;
  contorno: number[];
}

export interface SebModFile {
  formato: string;
  versao: number;
  origem?: string;
  arquivo?: string;
  unidades?: string;
  local?: { leste: number; norte: number; cota: number; eixoX: number[]; pontoBase?: number[] } | null;
  niveis: { id: number; nome: string; cota: number }[];
  tipos?: SebType[];
  malhas: SebMesh[];
  elementos: SebElement[];
  ambientes?: SebRoom[];
  eixos?: { nome: string; pontos: number[] }[];
}

/** Categoria do Revit → classe IFC (e tipo pré-definido) usada pelo app. */
const CATEGORY_IFC: Record<string, [string, string?]> = {
  OST_Walls: ["IFCWALL"],
  OST_Doors: ["IFCDOOR", "DOOR"],
  OST_Windows: ["IFCWINDOW", "WINDOW"],
  OST_Floors: ["IFCSLAB", "FLOOR"],
  OST_StructuralFoundation: ["IFCFOOTING"],
  OST_Roofs: ["IFCROOF"],
  OST_Ceilings: ["IFCCOVERING", "CEILING"],
  OST_Columns: ["IFCCOLUMN"],
  OST_StructuralColumns: ["IFCCOLUMN", "COLUMN"],
  OST_StructuralFraming: ["IFCBEAM", "BEAM"],
  OST_StructuralTruss: ["IFCMEMBER"],
  OST_Stairs: ["IFCSTAIR"],
  OST_StairsRuns: ["IFCSTAIRFLIGHT"],
  OST_StairsLandings: ["IFCSLAB", "LANDING"],
  OST_Ramps: ["IFCRAMP"],
  OST_Railings: ["IFCRAILING"],
  OST_StairsRailing: ["IFCRAILING"],
  OST_CurtainWallPanels: ["IFCPLATE"],
  OST_CurtainWallMullions: ["IFCMEMBER"],
  OST_CurtaSystem: ["IFCCURTAINWALL"],
  OST_Furniture: ["IFCFURNITURE"],
  OST_FurnitureSystems: ["IFCFURNITURE"],
  OST_Casework: ["IFCFURNITURE"],
  OST_Planting: ["IFCGEOGRAPHICELEMENT"],
  OST_Site: ["IFCGEOGRAPHICELEMENT"],
  OST_Topography: ["IFCGEOGRAPHICELEMENT"],
  OST_Toposolid: ["IFCGEOGRAPHICELEMENT"],
  OST_Parking: ["IFCBUILDINGELEMENTPROXY"],
  OST_GenericModel: ["IFCBUILDINGELEMENTPROXY"],
  OST_SpecialityEquipment: ["IFCFURNITURE"],
  OST_PlumbingFixtures: ["IFCSANITARYTERMINAL"],
  OST_LightingFixtures: ["IFCLIGHTFIXTURE"],
  OST_ElectricalFixtures: ["IFCOUTLET"],
  OST_ElectricalEquipment: ["IFCELECTRICDISTRIBUTIONBOARD"],
  OST_MechanicalEquipment: ["IFCUNITARYEQUIPMENT"],
  OST_DuctCurves: ["IFCDUCTSEGMENT"],
  OST_DuctFitting: ["IFCDUCTFITTING"],
  OST_DuctTerminal: ["IFCAIRTERMINAL"],
  OST_FlexDuctCurves: ["IFCDUCTSEGMENT"],
  OST_PipeCurves: ["IFCPIPESEGMENT"],
  OST_FlexPipeCurves: ["IFCPIPESEGMENT"],
  OST_PipeFitting: ["IFCPIPEFITTING"],
  OST_PipeAccessory: ["IFCVALVE"],
  OST_Sprinklers: ["IFCFIRESUPPRESSIONTERMINAL", "SPRINKLER"],
  OST_Conduit: ["IFCCABLECARRIERSEGMENT", "CONDUITSEGMENT"],
  OST_ConduitFitting: ["IFCCABLECARRIERFITTING"],
  OST_CableTray: ["IFCCABLECARRIERSEGMENT", "CABLETRAYSEGMENT"],
  OST_CableTrayFitting: ["IFCCABLECARRIERFITTING"],
};

export const ifcTypeOfCategory = (bic: string | null | undefined): [string, string | null] => {
  const r = bic ? CATEGORY_IFC[bic] : undefined;
  return r ? [r[0], r[1] ?? null] : ["IFCBUILDINGELEMENTPROXY", null];
};

/** Arquivo .sebmod (gzip ou JSON puro)? */
export function isSebmod(name: string, bytes: Uint8Array): boolean {
  if (/\.sebmod$/i.test(name)) return true;
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Lê os bytes (gzip ou JSON) do .sebmod. */
export async function readSebmodBytes(bytes: Uint8Array): Promise<SebModFile> {
  let text: string;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else text = new TextDecoder().decode(bytes);
  const json = JSON.parse(text) as SebModFile;
  if (json?.formato !== SEBMOD_FORMAT) throw new Error("Arquivo não é um modelo exportado pelo plugin do SmartEasyBIM para o Revit.");
  return json;
}

const hexColor = (h: string | undefined): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h ?? "");
  if (!m) return [0.75, 0.75, 0.75];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/** Revit (x, y, z; Z para cima) → cena (x, z, −y), com o deslocamento até a origem. */
type ToScene = (x: number, y: number, z: number) => Vec3;

function paramGroups(title: string, list: SebParam[] | undefined): PropertyGroup[] {
  if (!list?.length) return [];
  const byGroup = new Map<string, PropertyGroup>();
  for (const p of list) {
    const g = p.grupo || title;
    let grp = byGroup.get(g);
    if (!grp) byGroup.set(g, (grp = { name: g, kind: "propriedades", values: [] }));
    const shown: PropertyValue = p.texto != null && p.texto !== "" ? p.texto : p.valor;
    grp.values.push({ name: p.nome, value: shown });
  }
  return [...byGroup.values()];
}

/** Modelo do Revit → dados do app (como um IFC lido). */
export function sebmodToData(f: SebModFile): IfcData {
  // Modelos longe da origem interna: desloca para perto (precisão do Float32 na cena).
  let ox = 0, oy = 0, oz = 0;
  {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of f.elementos)
      for (const m of e.malhas ?? []) {
        const t = m.matriz;
        if (t) {
          x0 = Math.min(x0, t[9]); x1 = Math.max(x1, t[9]);
          y0 = Math.min(y0, t[10]); y1 = Math.max(y1, t[10]);
        }
      }
    for (const m of f.malhas)
      for (let i = 0; i < Math.min(m.posicoes.length, 3000); i += 3) {
        x0 = Math.min(x0, m.posicoes[i]); x1 = Math.max(x1, m.posicoes[i]);
        y0 = Math.min(y0, m.posicoes[i + 1]); y1 = Math.max(y1, m.posicoes[i + 1]);
      }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (Number.isFinite(cx) && Math.hypot(cx, cy) > 2000) {
      ox = Math.round(cx / 1000) * 1000;
      oy = Math.round(cy / 1000) * 1000;
    }
  }
  // cena = C · (x, z, −y): C desloca (−ox, −oz, +oy).
  const coordination: Mat4 = ox || oy || oz ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -ox, -oz, oy, 1] : [...IDENTITY];
  const toScene: ToScene = (x, y, z) => [x - ox, z - oz, -(y - oy)];

  const meshById = new Map(f.malhas.map((m) => [m.id, m]));
  const typeById = new Map((f.tipos ?? []).map((t) => [t.id, t]));
  const levelZ = new Map(f.niveis.map((l) => [l.nome, l.cota]));

  const meshes: ElementMesh[] = [];
  const elements: ElementInfo[] = [];
  const propertyGroups: PropertyGroup[] = [];
  const propertiesOf: [number, number[]][] = [];
  const typeGroupIndex = new Map<number, number[]>();
  const systems = new Set<string>();
  let nextId = 1;

  for (const e of f.elementos) {
    const parts = (e.malhas ?? []).map((ref) => ({ mesh: meshById.get(ref.malha), m: ref.matriz })).filter((p) => p.mesh && p.mesh.indices.length);
    if (!parts.length) continue;
    const nv = parts.reduce((s, p) => s + p.mesh!.posicoes.length / 3, 0);
    const ni = parts.reduce((s, p) => s + p.mesh!.indices.length, 0);
    const positions = new Float32Array(nv * 3);
    const indices = new Uint32Array(ni);
    // Cor do elemento: a cor mais usada nos triângulos (a malha leva uma cor só no app).
    const votes = new Map<string, number>();
    let v = 0, k = 0;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const { mesh, m } of parts) {
      const P = mesh!.posicoes;
      const base = v;
      for (let i = 0; i < P.length; i += 3) {
        let x = P[i], y = P[i + 1], z = P[i + 2];
        if (m) {
          const X = m[0] * x + m[3] * y + m[6] * z + m[9];
          const Y = m[1] * x + m[4] * y + m[7] * z + m[10];
          const Z = m[2] * x + m[5] * y + m[8] * z + m[11];
          x = X; y = Y; z = Z;
        }
        const s = toScene(x, y, z);
        positions.set(s, v * 3);
        for (let a = 0; a < 3; a++) {
          if (s[a] < min[a]) min[a] = s[a];
          if (s[a] > max[a]) max[a] = s[a];
        }
        v++;
      }
      // Matriz espelhada (determinante negativo): inverte a ordem dos triângulos.
      const flip = m ? m[0] * (m[4] * m[8] - m[5] * m[7]) - m[3] * (m[1] * m[8] - m[2] * m[7]) + m[6] * (m[1] * m[5] - m[2] * m[4]) < 0 : false;
      const I = mesh!.indices;
      for (let i = 0; i < I.length; i += 3) {
        indices[k++] = base + I[i];
        indices[k++] = base + (flip ? I[i + 2] : I[i + 1]);
        indices[k++] = base + (flip ? I[i + 1] : I[i + 2]);
      }
      const pal = mesh!.paleta ?? [];
      if (mesh!.cores?.length) for (const c of mesh!.cores) votes.set(pal[c], (votes.get(pal[c]) ?? 0) + 1);
      else if (pal[0]) votes.set(pal[0], (votes.get(pal[0]) ?? 0) + I.length / 3);
    }
    const color = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const id = nextId++;
    const [ifcType, predefinedType] = ifcTypeOfCategory(e.categoriaRevit);
    const type = e.tipo != null ? typeById.get(e.tipo) : undefined;
    const sys = e.sistemas ?? [];
    sys.forEach((s) => systems.add(s));
    const discipline = classifyDiscipline({ ifcType, predefinedType, systems: sys.map((name) => ({ name })) });
    const category = getCategory(ifcType);
    meshes.push({ expressID: id, positions, normals: new Float32Array(0), indices, color: [...hexColor(color), 1] });
    const bbox: BBox = { min, max };
    let frame: ElementInfo["frame"];
    let planSymbol: number[][] | undefined;
    if (e.porta) {
      const o = e.porta.origem;
      const s0 = toScene(o[0], o[1], o[2]);
      const dir = (d: number[]): Vec3 => [d[0], d[2], -d[1]];
      frame = { o: s0, x: dir(e.porta.x), y: dir(e.porta.y) };
      const m = e.porta.matriz;
      if (m && type?.planta?.length) {
        planSymbol = type.planta.map((line) => {
          const out: number[] = [];
          for (let i = 0; i + 1 < line.length; i += 2) out.push(m[0] * line[i] + m[3] * line[i + 1] + m[9], m[1] * line[i] + m[4] * line[i + 1] + m[10]);
          return out;
        });
      }
    }
    elements.push({
      expressID: id,
      globalId: e.guid ?? String(e.id),
      ifcType,
      name: e.nome || (type ? `${type.familia}: ${type.nome}` : e.categoria),
      objectType: type ? `${type.familia}: ${type.nome}` : null,
      predefinedType,
      typeObjectName: type?.nome ?? null,
      storey: e.nivel ?? null,
      systems: sys,
      discipline,
      category,
      bbox,
      length: e.comprimento ?? null,
      size: null,
      ...(frame ? { frame, operation: null } : {}),
      ...(planSymbol ? { planSymbol } : {}),
    });
    // Propriedades: identidade, parâmetros de instância e de tipo (grupos de tipo compartilhados).
    const own = propertyGroups.length;
    propertyGroups.push({
      name: "Revit",
      kind: "propriedades",
      values: [
        { name: "Categoria", value: e.categoria },
        { name: "Família", value: type?.familia ?? null },
        { name: "Tipo", value: type?.nome ?? null },
        { name: "Id do elemento", value: e.id },
        { name: "Nível", value: e.nivel ?? null },
      ],
    });
    const groups = [own];
    for (const g of paramGroups("Instância", e.parametros)) {
      groups.push(propertyGroups.length);
      propertyGroups.push(g);
    }
    if (type) {
      let tg = typeGroupIndex.get(type.id);
      if (!tg) {
        tg = paramGroups("Tipo", type.parametros).map((g) => {
          propertyGroups.push({ ...g, name: g.name === "Tipo" ? "Parâmetros de tipo" : `${g.name} (tipo)` });
          return propertyGroups.length - 1;
        });
        typeGroupIndex.set(type.id, tg);
      }
      groups.push(...tg);
    }
    propertiesOf.push([id, groups]);
  }

  // Níveis: a cota do Revit (convertida para a cena).
  const levelsSorted = [...f.niveis].sort((a, b) => a.cota - b.cota);
  const storeyLevels: StoreyLevel[] = levelsSorted.map((l) => ({ name: l.nome, level: l.cota - oz }));

  const spaces: Space[] = (f.ambientes ?? [])
    .filter((r) => r.contorno.length >= 6)
    .map((r, i) => {
      const poly: [number, number][] = [];
      for (let j = 0; j + 1 < r.contorno.length; j += 2) poly.push([r.contorno[j], r.contorno[j + 1]]);
      let a = 0;
      for (let j = 0; j < poly.length; j++) {
        const p = poly[j], q = poly[(j + 1) % poly.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      if (a < 0) poly.reverse();
      const floor = r.cotaPiso ?? levelZ.get(r.nivel ?? "") ?? 0;
      return {
        expressID: 90_000_000 + i,
        globalId: r.guid ?? String(r.id),
        number: r.numero ?? "",
        name: r.nome ?? "",
        storey: r.nivel ?? null,
        polygon: poly,
        floorY: floor - oz,
        topY: floor - oz + (r.altura || 2.8),
        area: r.area ?? Math.abs(a / 2),
      };
    });

  // Coordenadas compartilhadas: posição da origem interna no mapa e direção do eixo X.
  let georef: Georef = { map: null, crs: null, site: null, trueNorthDeg: null };
  if (f.local) {
    const ax = f.local.eixoX?.[0] ?? 1;
    const ay = f.local.eixoX?.[1] ?? 0;
    const l = Math.hypot(ax, ay) || 1;
    const rot = Math.atan2(ay / l, ax / l);
    georef = {
      map: { eastings: f.local.leste, northings: f.local.norte, orthogonalHeight: f.local.cota, xAxisAbscissa: ax / l, xAxisOrdinate: ay / l, scale: 1 },
      crs: null,
      site: f.local.pontoBase ? { latitude: null, longitude: null, elevation: null, location: [f.local.pontoBase[0], f.local.pontoBase[1], f.local.pontoBase[2]], rotationDeg: 0 } : null,
      trueNorthDeg: Math.abs(rot) > 1e-9 ? (-rot * 180) / Math.PI : null,
    };
  }

  return {
    schema: `Revit${f.origem ? ` (${f.origem.replace(/^Revit\s*/, "")})` : ""}`,
    unitToMeters: 1,
    elements,
    geometry: chunksOfMeshes(meshes),
    storeys: storeyLevels.map((s) => s.name),
    storeyLevels,
    spaces,
    coordination,
    georef,
    systems: [...systems].sort((a, b) => a.localeCompare(b, "pt-BR")),
    propertyGroups,
    propertiesOf,
  };
}
