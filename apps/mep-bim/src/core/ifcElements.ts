// Elementos lidos de um IFC para a biblioteca: as ocorrências são agrupadas por tipo
// (Família:Tipo do Revit, IfcTypeObject) e o app analisa como o elemento foi usado no
// modelo — fixação (parede, teto, piso), altura, lado voltado para o ambiente — para
// configurá-lo sozinho. Quando o uso não é claro, o elemento é marcado para configuração.
import { brandModelOf, profileForIfc } from "./families";
import { COMPONENT_BY_ID, type ComponentDef, type ComponentParam, type Mounting } from "./library";
import type { CoordinateSystem } from "./math";
import { minAreaRect } from "./plan/style";
import type { P2 } from "./plan/section";
import type { StoreyLevel } from "./points";
import { spaceAt, type Space } from "./spaces";
import type { Discipline, ElementInfo, PropertyGroup, Vec3 } from "./types";

/** Malha de um elemento do IFC (cena, metros, Y para cima). */
interface ElementMesh {
  expressID: number;
  positions: Float32Array;
  indices: Uint32Array;
}

export interface IfcUsage {
  /** Quantas vezes o elemento aparece no modelo e em quais pavimentos. */
  count: number;
  storeys: string[];
  /** Fixação deduzida e quantas ocorrências concordam (0–1). */
  mounting: Mounting;
  agreement: number;
  /** Altura em mm no sentido da fixação (parede: centro acima do piso; teto: abaixo do teto; piso: base acima do piso). */
  height: { min: number; median: number; max: number };
  /** O app conseguiu deduzir tudo com segurança. */
  clear: boolean;
  /** Por que precisa de configuração (ou como foi deduzido). */
  notes: string[];
}

export interface IfcElementDef {
  /** Chave do elemento: classe IFC + nome do tipo (normalizados). */
  uid: string;
  /** Nome exibido ("Família : Tipo"). */
  name: string;
  ifcType: string;
  predefinedType: string | null;
  discipline: Discipline;
  brand: string | null;
  model: string | null;
  params: ComponentParam[];
  /** Malha nos eixos do app (mm, X largura, Y para cima, Z para o ambiente), centrada. */
  mesh: { positions: number[]; indices: number[] } | null;
  size: [number, number, number];
  usage: IfcUsage;
}

export interface IfcSource {
  elements: ElementInfo[];
  meshes: ElementMesh[];
  storeyLevels: StoreyLevel[];
  spaces: Space[];
  coordinates: CoordinateSystem;
  getProperties(expressID: number): PropertyGroup[];
}

/** Classes que viram elementos da biblioteca (pontos, equipamentos, mobiliário); o resto é construção ou rede. */
const EXTRA = new Set(["IFCFURNITURE", "IFCFURNISHINGELEMENT", "IFCBUILDINGELEMENTPROXY", "IFCDISTRIBUTIONELEMENT", "IFCDISTRIBUTIONFLOWELEMENT"]);
export const isLibraryCandidate = (e: ElementInfo) => !!e.bbox && (e.category === "terminal" || e.category === "equipamento" || e.category === "acessorio" || EXTRA.has(e.ifcType));

const GENERIC = new Set(["IFCBUILDINGELEMENTPROXY", "IFCDISTRIBUTIONELEMENT", "IFCDISTRIBUTIONFLOWELEMENT", "IFCFLOWTERMINAL"]);

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** "Família:Tipo:123456" (Revit) → "Família : Tipo". */
export function typeLabel(e: ElementInfo): string {
  const raw = e.typeObjectName || e.objectType || e.name;
  const parts = raw.split(":").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
  const uniq = parts.filter((p, i) => p !== parts[i - 1]);
  return uniq.join(" : ") || e.ifcType;
}

export const elementKey = (ifcType: string, label: string) => `${ifcType}|${norm(label)}`;

const PARAMS: { re: RegExp; name: string; unit?: string }[] = [
  { re: /^(potência|potencia|power|apparent load|wattage|carga)$/i, name: "Potência" },
  { re: /^(tensão|tensao|voltage|nominal voltage)$/i, name: "Tensão", unit: "V" },
  { re: /^(fluxo luminoso|luminous flux)$/i, name: "Fluxo luminoso", unit: "lm" },
  { re: /^(vazão|vazao|flow|air ?flow|airflowrate)$/i, name: "Vazão" },
  { re: /^(capacidade|cooling capacity|capacidade de refrigeração|nominal capacity)$/i, name: "Capacidade" },
];

function paramsFrom(groups: PropertyGroup[], like: ComponentDef | undefined): ComponentParam[] {
  const out = new Map<string, ComponentParam>();
  for (const g of groups) {
    if (g.kind !== "propriedades") continue;
    for (const v of g.values) {
      const m = PARAMS.find((p) => p.re.test(v.name.trim()));
      if (m && !out.has(m.name) && v.value != null && v.value !== "") out.set(m.name, { name: m.name, unit: m.unit, default: typeof v.value === "number" ? Math.round(v.value * 1000) / 1000 : String(v.value) });
    }
  }
  for (const p of like?.params ?? []) if (!out.has(p.name)) out.set(p.name, p);
  return [...out.values()];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

interface Occurrence {
  e: ElementInfo;
  mesh: ElementMesh;
  mounting: Mounting | null;
  height: number;
  /** Direção (cena, horizontal) do ambiente, quando encostado numa parede. */
  out: Vec3 | null;
}

/**
 * Agrupa as ocorrências por tipo e analisa o uso de cada um. `fileName` só identifica a origem.
 */
export function analyzeIfcElements(src: IfcSource): IfcElementDef[] {
  const meshById = new Map(src.meshes.map((m) => [m.expressID, m]));
  const levels = [...src.storeyLevels].sort((a, b) => a.level - b.level);
  const walls = src.elements.filter((e) => e.bbox && (e.ifcType === "IFCWALL" || e.ifcType === "IFCWALLSTANDARDCASE" || e.ifcType === "IFCCOLUMN" || e.ifcType === "IFCCURTAINWALL"));
  const toPlan = (v: Vec3): P2 => {
    const p = src.coordinates.worldToIfc(v);
    return [p[0], p[1]];
  };
  const inWall = (p: Vec3) => walls.some((w) => p[0] >= w.bbox!.min[0] - 0.02 && p[0] <= w.bbox!.max[0] + 0.02 && p[2] >= w.bbox!.min[2] - 0.02 && p[2] <= w.bbox!.max[2] + 0.02 && p[1] >= w.bbox!.min[1] && p[1] <= w.bbox!.max[1]);

  const groups = new Map<string, ElementInfo[]>();
  for (const e of src.elements) {
    if (!isLibraryCandidate(e) || !meshById.has(e.expressID)) continue;
    const k = elementKey(e.ifcType, typeLabel(e));
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }

  const out: IfcElementDef[] = [];
  for (const [uid, list] of groups) {
    const first = list[0];
    const occs: Occurrence[] = list.map((e) => analyzeOccurrence(e, meshById.get(e.expressID)!, levels, src.spaces, toPlan, inWall));
    const votes = new Map<Mounting, number>();
    for (const o of occs) if (o.mounting) votes.set(o.mounting, (votes.get(o.mounting) ?? 0) + 1);
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const profile = profileForIfc(first.ifcType, first.predefinedType, first.discipline);
    const mounting: Mounting = ranked[0]?.[0] ?? profile.mounting;
    const agreement = ranked.length ? ranked[0][1] / occs.length : 0;
    const same = occs.filter((o) => o.mounting === mounting);
    const hs = same.map((o) => Math.round(o.height * 1000));
    const notes: string[] = [];
    if (!ranked.length) notes.push("Não foi possível saber se fica na parede, no teto ou no piso.");
    else if (agreement < 0.8) notes.push(`Usado de formas diferentes no modelo (${ranked.map(([m, n]) => `${m} ${n}×`).join(", ")}).`);
    if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 300) notes.push("As alturas variam bastante entre as ocorrências; confira a altura padrão.");
    if (GENERIC.has(first.ifcType)) notes.push("Classe IFC genérica: confira a disciplina e o grupo.");
    const rep = same.find((o) => mounting !== "parede" || o.out) ?? same[0] ?? occs[0];
    if (mounting === "parede" && !rep.out) notes.push("Não foi encontrada a parede junto à peça: confira o lado voltado para o ambiente.");
    const oriented = orientOccurrence(rep, mounting);
    const like = profile.like ? COMPONENT_BY_ID[profile.like] : undefined;
    const groupsProps = src.getProperties(first.expressID);
    const bm = brandModelOf(groupsProps.flatMap((g) => g.values));
    out.push({
      uid,
      name: typeLabel(first),
      ifcType: first.ifcType,
      predefinedType: first.predefinedType,
      discipline: first.discipline,
      brand: bm.brand,
      model: bm.model,
      params: paramsFrom(groupsProps, like),
      mesh: oriented.mesh,
      size: oriented.size,
      usage: {
        count: list.length,
        storeys: [...new Set(list.map((e) => e.storey ?? "—"))],
        mounting,
        agreement,
        height: hs.length ? { min: Math.min(...hs), median: median(hs), max: Math.max(...hs) } : { min: 0, median: 0, max: 0 },
        clear: notes.length === 0,
        notes,
      },
    });
  }
  return out.sort((a, b) => a.discipline.localeCompare(b.discipline) || a.name.localeCompare(b.name, "pt-BR"));
}

function analyzeOccurrence(e: ElementInfo, mesh: ElementMesh, levels: StoreyLevel[], spaces: Space[], toPlan: (v: Vec3) => P2, inWall: (p: Vec3) => boolean): Occurrence {
  const b = e.bbox!;
  const lvlIdx = Math.max(0, levels.findIndex((l) => l.name === e.storey));
  const level = levels[lvlIdx]?.level ?? 0;
  const next = levels[lvlIdx + 1]?.level ?? level + 3;
  const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const room = spaceAt(spaces, toPlan, [c[0], level + 0.5, c[2]], 1);
  const ceiling = room ? room.topY : next - 0.1;
  const bottom = b.min[1] - level;
  const gap = ceiling - b.max[1];
  // Parede: um dos lados horizontais (±eixos da peça) encosta numa parede.
  const axes = horizontalAxes(mesh);
  let out: Vec3 | null = null;
  if (axes) {
    for (const [ax, half] of [
      [axes.u, axes.halfU],
      [axes.v, axes.halfV],
    ] as [Vec3, number][]) {
      for (const s of [1, -1]) {
        const probe: Vec3 = [c[0] + ax[0] * s * (half + 0.06), c[1], c[2] + ax[2] * s * (half + 0.06)];
        if (inWall(probe)) out = [-ax[0] * s, 0, -ax[2] * s];
      }
      if (out) break;
    }
  }
  let mounting: Mounting | null;
  let height: number;
  if (bottom < 0.08) {
    mounting = "piso";
    height = Math.max(0, bottom);
  } else if (gap < 0.3) {
    mounting = "teto";
    height = Math.max(0, gap);
  } else if (out) {
    mounting = "parede";
    height = c[1] - level;
  } else {
    // Suspenso longe do teto ou solto no ambiente: não dá para afirmar.
    mounting = null;
    height = bottom;
  }
  return { e, mesh, mounting, height, out };
}

/** Eixos horizontais da peça (cena): u longo e v curto, pela envoltória em planta. */
function horizontalAxes(mesh: ElementMesh): { u: Vec3; v: Vec3; halfU: number; halfV: number; center: P2 } | null {
  const pts: P2[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) pts.push([mesh.positions[i], mesh.positions[i + 2]]);
  const r = minAreaRect(pts);
  if (!r) return null;
  return { u: [r.axis[0], 0, r.axis[1]], v: [-r.axis[1], 0, r.axis[0]], halfU: r.length / 2, halfV: r.width / 2, center: r.center };
}

/** Malha da ocorrência nos eixos do app: Y para cima; na parede, Z para o ambiente e X ao longo dela. */
function orientOccurrence(o: Occurrence, mounting: Mounting): { mesh: IfcElementDef["mesh"]; size: [number, number, number] } {
  const axes = horizontalAxes(o.mesh);
  let z: Vec3 = axes?.v ?? [0, 0, 1];
  if (mounting === "parede" && o.out) z = o.out;
  const x: Vec3 = [z[2], 0, -z[0]]; // X = Y × Z (Y para cima)
  const p = o.mesh.positions;
  const n = p.length / 3;
  const q = new Array<number>(p.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const v: Vec3 = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
    const l = [(v[0] * x[0] + v[2] * x[2]) * 1000, v[1] * 1000, (v[0] * z[0] + v[2] * z[2]) * 1000];
    for (let k = 0; k < 3; k++) {
      q[3 * i + k] = l[k];
      min[k] = Math.min(min[k], l[k]);
      max[k] = Math.max(max[k], l[k]);
    }
  }
  const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) q[3 * i + k] = Math.round((q[3 * i + k] - c[k]) * 10) / 10;
  const ext = [0, 1, 2].map((k) => Math.max(1, Math.round(max[k] - min[k])));
  return { mesh: n ? { positions: q, indices: Array.from(o.mesh.indices) } : null, size: [ext[0], ext[2], ext[1]] };
}

// ---- Componentes da biblioteca ---------------------------------------------------------------

export interface IfcElementOverride {
  label?: string;
  group?: string;
  mounting?: Mounting;
  height?: number;
  /** Gira a peça 180° (lado para o ambiente invertido). */
  flip?: boolean;
  funcao?: string;
  brand?: string;
  model?: string;
  ifcType?: string;
  /** Já foi revisado pelo usuário (some o aviso "a configurar"). */
  reviewed?: boolean;
}

const slugId = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
/** Id do componente: arquivo de origem + elemento (dois arquivos podem ter o mesmo tipo). */
export const ifcComponentId = (packageId: string, uid: string) => `ifc:${slugId(packageId)}:${slugId(uid)}`;

/** Componente de locação a partir do elemento analisado e dos ajustes do usuário. */
export function ifcElementComponent(packageId: string, el: IfcElementDef, ov: IfcElementOverride = {}, id = ifcComponentId(packageId, el.uid), file?: string): ComponentDef {
  const profile = profileForIfc(ov.ifcType ?? el.ifcType, el.predefinedType, el.discipline);
  const mounting = ov.mounting ?? el.usage.mounting;
  const like = profile.like ? COMPONENT_BY_ID[profile.like] : undefined;
  let positions = el.mesh ? Float32Array.from(el.mesh.positions) : null;
  if (positions && ov.flip) for (let i = 0; i < positions.length; i += 3) ((positions[i] = -positions[i]), (positions[i + 2] = -positions[i + 2]));
  return {
    id,
    group: ov.group ?? profile.group,
    label: ov.label ?? el.name,
    discipline: el.discipline,
    ifcType: ov.ifcType ?? el.ifcType,
    predefinedType: el.predefinedType ?? "NOTDEFINED",
    mounting,
    defaultHeight: ov.height ?? (el.usage.height.median || (mounting === "parede" ? 1100 : 0)),
    size: el.size,
    shape: positions ? "malha" : "caixa",
    mesh: positions ? { positions, indices: Uint32Array.from(el.mesh!.indices) } : undefined,
    system: like?.system ?? "",
    systemType: like?.systemType ?? "NOTDEFINED",
    tagPrefix: like?.tagPrefix ?? "EL",
    params: el.params,
    symbolOf: like?.id,
    source: { kind: "ifc", packageId, familyUid: el.uid, family: el.name, type: el.name, file },
    funcao: ov.funcao ?? el.name,
    brand: ov.brand ?? el.brand ?? undefined,
    model: ov.model ?? el.model ?? undefined,
  };
}
