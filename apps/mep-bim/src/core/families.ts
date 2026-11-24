// Famílias exportadas do Revit pelo plugin SmartEasyBIM (arquivo .sebfam):
// leitura do pacote e conversão em componentes da biblioteca de locação.
import { COMPONENT_BY_ID, type ComponentDef, type ComponentMesh, type ComponentParam, type Mounting } from "./library";
import type { Discipline } from "./types";

export const FAMILY_FORMAT = "smarteasybim/familias";

export interface RevitParam {
  nome: string;
  /** BuiltInParameter (parâmetros nativos do Revit). */
  nativo?: string;
  instancia: boolean;
  valor: number | boolean | string | null;
  texto?: string;
  unidade?: string;
}

export interface RevitType {
  nome: string;
  parametros: RevitParam[];
  /** paleta/cores: cor (#rrggbb) de cada triângulo, pelo material da face. */
  malha?: { posicoes: number[]; indices: number[]; paleta?: string[]; cores?: number[] };
  /** Linhas simbólicas visíveis em planta: polilinhas [x0, y0, x1, y1, …] em mm, coordenadas da família. */
  planta?: number[][];
  min?: [number, number, number];
  max?: [number, number, number];
}

export interface RevitConnector {
  dominio: string;
  forma: string;
  sistema?: string | null;
  origem: [number, number, number];
  direcao: [number, number, number];
  diametro?: number;
  largura?: number;
  altura?: number;
}

export interface RevitFamily {
  uid: string;
  nome: string;
  categoria: string | null;
  categoriaRevit: string | null;
  hospedagem: "parede" | "teto" | "piso" | "telhado" | "face" | "nenhuma";
  posicionamento: string;
  conectores: RevitConnector[];
  tipos: RevitType[];
  avisos: string[];
}

export interface FamilyPackage {
  formato: typeof FAMILY_FORMAT;
  versao: number;
  origem: string;
  arquivo?: string;
  exportadoEm?: string;
  unidades: "mm";
  familias: RevitFamily[];
}

export function parseFamilyPackage(text: string): FamilyPackage {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Arquivo de famílias inválido (não é JSON).");
  }
  const pkg = json as FamilyPackage;
  if (!pkg || pkg.formato !== FAMILY_FORMAT || !Array.isArray(pkg.familias)) {
    throw new Error("Este arquivo não foi gerado pelo plugin SmartEasyBIM para Revit.");
  }
  if (pkg.versao > 1) throw new Error(`Pacote versão ${pkg.versao}: atualize o SmartEasyBIM.`);
  for (const f of pkg.familias) {
    if (!f.uid || !f.nome || !Array.isArray(f.tipos)) throw new Error(`Família inválida no pacote: ${f?.nome ?? "?"}`);
  }
  return pkg;
}

// ---- Categorias do Revit ---------------------------------------------------------------------

export interface CategoryProfile {
  discipline: Discipline;
  group: string;
  ifcType: string;
  predefinedType: string;
  mounting: Mounting;
  /** Componente de fábrica de referência (símbolo, etiqueta, sistema, altura padrão). */
  like: string;
}

const PROFILES: Record<string, CategoryProfile> = {
  OST_LightingFixtures: { discipline: "eletrica", group: "Iluminação", ifcType: "IFCLIGHTFIXTURE", predefinedType: "POINTSOURCE", mounting: "teto", like: "lum-embutir-6060" },
  OST_LightingDevices: { discipline: "eletrica", group: "Tomadas e comandos", ifcType: "IFCSWITCHINGDEVICE", predefinedType: "TOGGLESWITCH", mounting: "parede", like: "interruptor-simples" },
  OST_ElectricalFixtures: { discipline: "eletrica", group: "Tomadas e comandos", ifcType: "IFCOUTLET", predefinedType: "POWEROUTLET", mounting: "parede", like: "tomada-baixa" },
  OST_ElectricalEquipment: { discipline: "eletrica", group: "Tomadas e comandos", ifcType: "IFCELECTRICDISTRIBUTIONBOARD", predefinedType: "DISTRIBUTIONBOARD", mounting: "parede", like: "quadro-distribuicao" },
  OST_DataDevices: { discipline: "telecom", group: "Telecom e segurança", ifcType: "IFCOUTLET", predefinedType: "DATAOUTLET", mounting: "parede", like: "ponto-dados" },
  OST_CommunicationDevices: { discipline: "telecom", group: "Telecom e segurança", ifcType: "IFCCOMMUNICATIONSAPPLIANCE", predefinedType: "NOTDEFINED", mounting: "parede", like: "ponto-dados" },
  OST_TelephoneDevices: { discipline: "telecom", group: "Telecom e segurança", ifcType: "IFCOUTLET", predefinedType: "TELEPHONEOUTLET", mounting: "parede", like: "ponto-dados" },
  OST_SecurityDevices: { discipline: "telecom", group: "Telecom e segurança", ifcType: "IFCAUDIOVISUALAPPLIANCE", predefinedType: "CAMERA", mounting: "teto", like: "camera-cftv" },
  OST_NurseCallDevices: { discipline: "telecom", group: "Telecom e segurança", ifcType: "IFCCOMMUNICATIONSAPPLIANCE", predefinedType: "NOTDEFINED", mounting: "parede", like: "ponto-dados" },
  OST_AudioVisualDevices: { discipline: "telecom", group: "Telecom e segurança", ifcType: "IFCAUDIOVISUALAPPLIANCE", predefinedType: "NOTDEFINED", mounting: "parede", like: "ponto-dados" },
  OST_FireAlarmDevices: { discipline: "incendio", group: "Incêndio", ifcType: "IFCSENSOR", predefinedType: "SMOKESENSOR", mounting: "teto", like: "detector-fumaca" },
  OST_Sprinklers: { discipline: "incendio", group: "Incêndio", ifcType: "IFCFIRESUPPRESSIONTERMINAL", predefinedType: "SPRINKLER", mounting: "teto", like: "sprinkler-pendente" },
  OST_FireProtection: { discipline: "incendio", group: "Incêndio", ifcType: "IFCFIRESUPPRESSIONTERMINAL", predefinedType: "FIREHYDRANT", mounting: "parede", like: "abrigo-hidrante" },
  OST_PlumbingFixtures: { discipline: "hidraulica", group: "Hidráulica", ifcType: "IFCSANITARYTERMINAL", predefinedType: "NOTDEFINED", mounting: "piso", like: "bacia-sanitaria" },
  OST_PlumbingEquipment: { discipline: "hidraulica", group: "Hidráulica", ifcType: "IFCFLOWSTORAGEDEVICE", predefinedType: "NOTDEFINED", mounting: "piso", like: "bacia-sanitaria" },
  OST_PipeAccessory: { discipline: "hidraulica", group: "Hidráulica", ifcType: "IFCVALVE", predefinedType: "NOTDEFINED", mounting: "parede", like: "registro-gaveta" },
  OST_MechanicalEquipment: { discipline: "hvac", group: "Climatização", ifcType: "IFCUNITARYEQUIPMENT", predefinedType: "NOTDEFINED", mounting: "piso", like: "condensadora" },
  OST_DuctTerminal: { discipline: "hvac", group: "Climatização", ifcType: "IFCAIRTERMINAL", predefinedType: "DIFFUSER", mounting: "teto", like: "difusor-6060" },
  OST_DuctAccessory: { discipline: "hvac", group: "Climatização", ifcType: "IFCDAMPER", predefinedType: "NOTDEFINED", mounting: "teto", like: "difusor-6060" },
};
const GENERIC: CategoryProfile = { discipline: "mep", group: "Revit (outros)", ifcType: "IFCBUILDINGELEMENTPROXY", predefinedType: "NOTDEFINED", mounting: "piso", like: "" };

export const categoryProfile = (bic: string | null): CategoryProfile => (bic && PROFILES[bic]) || GENERIC;

const DISCIPLINE_PROFILE: Partial<Record<Discipline, CategoryProfile>> = {
  eletrica: PROFILES.OST_ElectricalFixtures,
  telecom: PROFILES.OST_DataDevices,
  hidraulica: PROFILES.OST_PlumbingFixtures,
  hvac: PROFILES.OST_MechanicalEquipment,
  incendio: PROFILES.OST_FireAlarmDevices,
};

/** Perfil (grupo, peça de referência para símbolo e etiqueta) a partir da classe IFC de um elemento. */
export function profileForIfc(ifcType: string, predefinedType: string | null, discipline: Discipline): CategoryProfile {
  // Mobiliário e eletrodomésticos: layout (a tomada que os atende é locada à parte).
  if (["IFCFURNITURE", "IFCFURNISHINGELEMENT", "IFCSYSTEMFURNITUREELEMENT", "IFCELECTRICAPPLIANCE"].includes(ifcType))
    return { discipline, group: "Mobiliário e layout", ifcType, predefinedType: predefinedType ?? "NOTDEFINED", mounting: "piso", like: "" };
  const all = Object.values(PROFILES);
  const exact = all.find((p) => p.ifcType === ifcType && predefinedType && p.predefinedType === predefinedType) ?? all.find((p) => p.ifcType === ifcType);
  if (exact) return { ...exact, predefinedType: predefinedType ?? exact.predefinedType };
  const byDisc = DISCIPLINE_PROFILE[discipline];
  const group = byDisc?.group ?? (discipline === "arquitetura" ? "Mobiliário e layout" : "Elementos IFC");
  return { discipline, group, ifcType, predefinedType: predefinedType ?? "NOTDEFINED", mounting: byDisc?.mounting ?? "piso", like: byDisc?.like ?? "" };
}

// ---- Orientação -------------------------------------------------------------------------------

/** Eixo da família que aponta para fora da superfície onde ela é fixada (para o ambiente). */
export type OutAxis = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
export const OUT_AXES: OutAxis[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];

export interface FamilyOverride {
  mounting?: Mounting;
  out?: OutAxis;
  group?: string;
  /** Função/equivalência: elementos com a mesma função são alternativas (ex.: marcas diferentes). */
  funcao?: string;
  brand?: string;
  model?: string;
  /** Altura padrão (mm), no sentido da fixação. */
  height?: number;
  /** Nome exibido na biblioteca. */
  label?: string;
  /** Classe IFC na exportação. */
  ifcType?: string;
}

type V3 = [number, number, number];
const axisVec = (a: OutAxis): V3 => {
  const s = a[0] === "-" ? -1 : 1;
  return a[1] === "X" ? [s, 0, 0] : a[1] === "Y" ? [0, s, 0] : [0, 0, s];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/** Fixação: pela hospedagem da família, senão pela categoria. */
export function defaultMounting(f: RevitFamily): Mounting {
  if (f.hospedagem === "parede" || f.hospedagem === "teto" || f.hospedagem === "piso") return f.hospedagem;
  if (f.hospedagem === "telhado") return "teto";
  return categoryProfile(f.categoriaRevit).mounting;
}

/** Limites somados de todos os tipos (mm, coordenadas da família). */
function familyBounds(f: RevitFamily): { min: V3; max: V3 } | null {
  const ts = f.tipos.filter((t) => t.min && t.max);
  if (!ts.length) return null;
  return {
    min: [0, 1, 2].map((i) => Math.min(...ts.map((t) => t.min![i]))) as V3,
    max: [0, 1, 2].map((i) => Math.max(...ts.map((t) => t.max![i]))) as V3,
  };
}

/**
 * Eixo "para fora" padrão. Famílias baseadas em face: +Z (a face hospedeira é o plano XY).
 * Teto: −Z (a peça fica abaixo da origem e o +Z da família continua para cima).
 * Parede hospedada: o lado de Y para o qual a geometria avança. Parede sem hospedeiro: −Y
 * (a vista Frontal do Revit olha para +Y). Piso: +Z.
 */
export function defaultOutAxis(f: RevitFamily, mounting: Mounting): OutAxis {
  const b = familyBounds(f);
  if (f.hospedagem === "face") {
    if (b && -b.min[2] > b.max[2] * 1.5) return "-Z";
    return "+Z";
  }
  if (mounting === "teto") return "-Z";
  if (mounting === "piso") return "+Z";
  if (f.hospedagem === "parede" && b) return b.max[1] >= -b.min[1] ? "+Y" : "-Y";
  return "-Y";
}

/** Base do app (X largura, Y para cima, Z para fora) escrita nos eixos da família. */
export function appBasis(out: OutAxis, mounting: Mounting): { x: V3; y: V3; z: V3 } {
  const o = axisVec(out);
  // Eixo secundário: o "para cima" da peça na parede (ou a frente no teto/piso).
  const s: V3 = out[1] === "Z" ? [0, 1, 0] : [0, 0, 1];
  let y: V3;
  let z: V3;
  if (mounting === "parede") {
    z = o;
    y = s;
  } else if (mounting === "teto") {
    y = neg(o);
    z = s;
  } else {
    y = o;
    z = s;
  }
  return { x: cross(y, z), y, z };
}

/** Malha nos eixos do app, centrada na caixa envolvente; devolve também o tamanho [L, P, A] em mm. */
export function orientMesh(
  positions: number[],
  indices: number[],
  out: OutAxis,
  mounting: Mounting,
  colors?: { paleta?: string[]; cores?: number[] },
): { mesh: ComponentMesh; size: [number, number, number]; toApp: (v: V3) => V3 } {
  const { x, y, z } = appBasis(out, mounting);
  const n = positions.length / 3;
  const p = new Float32Array(positions.length);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const v: V3 = [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
    const q: V3 = [dot(v, x), dot(v, y), dot(v, z)];
    for (let k = 0; k < 3; k++) {
      p[3 * i + k] = q[k];
      if (q[k] < min[k]) min[k] = q[k];
      if (q[k] > max[k]) max[k] = q[k];
    }
  }
  const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) p[3 * i + k] -= c[k];
  const ext = [0, 1, 2].map((k) => Math.max(1, Math.round(max[k] - min[k])));
  let triColors: Uint8Array | undefined;
  if (colors?.paleta?.length && colors.cores?.length) {
    const rgb = colors.paleta.map((h) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16) || 0));
    const nt = indices.length / 3;
    triColors = new Uint8Array(nt * 3);
    for (let t = 0; t < nt; t++) triColors.set(rgb[colors.cores[t] ?? 0] ?? [168, 173, 181], t * 3);
  }
  const toApp = (v: V3): V3 => [dot(v, x) - c[0], dot(v, y) - c[1], dot(v, z) - c[2]];
  return { mesh: { positions: p, indices: Uint32Array.from(indices), triColors }, size: [ext[0], ext[2], ext[1]], toApp };
}

/** Linhas de planta da família nos eixos do app (X e Z, mm), centradas como a malha. */
export function orientPlanLines(lines: number[][] | undefined, toApp: ((v: V3) => V3) | undefined): [number, number][][] | undefined {
  if (!lines?.length || !toApp) return undefined;
  const out: [number, number][][] = [];
  for (const l of lines) {
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < l.length; i += 2) {
      const q = toApp([l[i], l[i + 1], 0]);
      pts.push([Math.round(q[0] * 10) / 10, Math.round(q[2] * 10) / 10]);
    }
    if (pts.length >= 2) out.push(pts);
  }
  return out.length ? out : undefined;
}

// ---- Parâmetros ----------------------------------------------------------------------------------

/** Parâmetros nativos do Revit levados para os nomes usados no app. */
const NATIVE: Record<string, { name: string; unit: string }> = {
  FBX_LIGHT_WATTAGE: { name: "Potência", unit: "W" },
  RBS_ELEC_APPARENT_LOAD: { name: "Potência", unit: "VA" },
  RBS_ELEC_APPARENT_LOAD_PHASEA: { name: "Potência", unit: "VA" },
  RBS_ELEC_VOLTAGE: { name: "Tensão", unit: "V" },
  FBX_LIGHT_LIMUNOUS_FLUX: { name: "Fluxo luminoso", unit: "lm" },
  RBS_DUCT_FLOW_PARAM: { name: "Vazão", unit: "m³/h" },
  RBS_PIPE_FLOW_PARAM: { name: "Vazão", unit: "L/s" },
};

const asParamValue = (p: RevitParam): string | number => {
  if (typeof p.valor === "number") return Math.round(p.valor * 1000) / 1000;
  if (typeof p.valor === "boolean") return p.valor ? "Sim" : "Não";
  return p.texto ?? (p.valor == null ? "" : String(p.valor));
};

/**
 * Parâmetros do componente: os nativos reconhecidos (potência, tensão, fluxo, vazão),
 * os parâmetros de projeto/compartilhados da família e os da peça de referência que faltarem
 * (ex.: Circuito).
 */
export function componentParams(t: RevitType, like: ComponentDef | undefined): ComponentParam[] {
  const out = new Map<string, ComponentParam>();
  for (const p of t.parametros) {
    const native = p.nativo ? NATIVE[p.nativo] : undefined;
    if (native) {
      if (!out.has(native.name) && typeof p.valor === "number") out.set(native.name, { name: native.name, unit: native.unit, default: Math.round(p.valor * 1000) / 1000 });
      continue;
    }
    if (p.nativo) continue; // demais nativos (dimensões, identidade…) ficam de fora
    const v = asParamValue(p);
    if (v === "") continue;
    if (!out.has(p.nome)) out.set(p.nome, { name: p.nome, unit: p.unidade && typeof v === "number" ? p.unidade : undefined, default: v });
  }
  for (const p of like?.params ?? []) if (!out.has(p.name)) out.set(p.name, p);
  return [...out.values()];
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

export const revitComponentId = (familyUid: string, typeName: string) => `rvt:${slug(familyUid)}:${slug(typeName)}`;

/** Componentes (um por tipo) de uma família, já orientados e com parâmetros. */
export function familyComponents(packageId: string, f: RevitFamily, ov: FamilyOverride = {}): ComponentDef[] {
  const profile = categoryProfile(f.categoriaRevit);
  const mounting = ov.mounting ?? defaultMounting(f);
  const out = ov.out ?? defaultOutAxis(f, mounting);
  const like = profile.like ? COMPONENT_BY_ID[profile.like] : undefined;
  const sameMounting = like && like.mounting === mounting;
  return f.tipos.map((t) => {
    const oriented = t.malha && t.malha.indices.length ? orientMesh(t.malha.posicoes, t.malha.indices, out, mounting, t.malha) : null;
    const label = t.nome === f.nome ? f.nome : `${f.nome} : ${t.nome}`;
    const found = brandModelOf(t.parametros.map((p) => ({ name: p.nome, value: p.texto ?? (p.valor as string | number | null) })));
    return {
      id: revitComponentId(f.uid, t.nome),
      group: ov.group ?? profile.group,
      label: ov.label ?? label,
      funcao: ov.funcao ?? label,
      brand: ov.brand ?? found.brand ?? undefined,
      model: ov.model ?? found.model ?? undefined,
      discipline: profile.discipline,
      ifcType: ov.ifcType ?? profile.ifcType,
      predefinedType: profile.predefinedType,
      mounting,
      defaultHeight: ov.height ?? (sameMounting ? like!.defaultHeight : mounting === "parede" ? 1100 : 0),
      size: oriented?.size ?? [300, 300, 300],
      shape: oriented ? "malha" : "caixa",
      mesh: oriented?.mesh,
      system: like?.system ?? "",
      systemType: like?.systemType ?? "NOTDEFINED",
      tagPrefix: like?.tagPrefix ?? "RV",
      params: componentParams(t, like),
      symbolOf: like?.id,
      planLines: orientPlanLines(t.planta, oriented?.toApp),
      source: { kind: "revit", packageId, familyUid: f.uid, family: f.nome, type: t.nome },
    };
  });
}

export function packageComponents(packageId: string, pkg: FamilyPackage, overrides: Record<string, FamilyOverride> = {}): ComponentDef[] {
  return pkg.familias.flatMap((f) => familyComponents(packageId, f, overrides[f.uid]));
}

// ---- Fabricante e modelo -----------------------------------------------------------------------

const BRAND_NAMES = /^(manufacturer|fabricante|marca|brand)$/i;
const MODEL_NAMES = /^(modelreference|model ?reference|modellabel|model|modelo)$/i;

/** Fabricante e modelo a partir de parâmetros/propriedades (Revit ou Pset_ManufacturerTypeInformation). */
export function brandModelOf(values: { name: string; value: string | number | boolean | null }[]): { brand: string | null; model: string | null } {
  const pick = (re: RegExp) => {
    const v = values.find((x) => re.test(x.name.trim()) && x.value != null && String(x.value).trim() !== "");
    return v ? String(v.value).trim() : null;
  };
  return { brand: pick(BRAND_NAMES), model: pick(MODEL_NAMES) };
}
