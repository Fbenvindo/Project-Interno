// Perfil do empreendimento: torres, pavimentos (comuns a todas as torres ou de torres
// específicas), altura de cada pavimento (piso a piso) e repetição dos pavimentos tipo.
// Serve de base para os fluxogramas (faixas por pavimento e colunas por torre).

export interface BuildingTower {
  id: string;
  name: string;
}

export interface BuildingFloor {
  id: string;
  name: string;
  /** Altura piso a piso (m). */
  height: number;
  /** Pavimentos iguais repetidos (tipo): 1 = um pavimento só. */
  repeat: number;
  /** Comum a todas as torres (subsolos, térreo, lazer…). */
  common: boolean;
  /** Torres que têm este pavimento (quando não é comum). */
  towers: string[];
}

export interface BuildingProfile {
  towers: BuildingTower[];
  /** De baixo para cima. */
  floors: BuildingFloor[];
  /** Cota do piso do pavimento mais baixo (m). */
  baseElevation: number;
}

let seq = 0;
export const newBuildingId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const EMPTY_PROFILE: BuildingProfile = { towers: [{ id: "torre-a", name: "Torre A" }], floors: [], baseElevation: 0 };

/** Cota do piso de cada pavimento (do primeiro, nos repetidos). */
export function floorElevations(p: BuildingProfile): number[] {
  let z = p.baseElevation;
  return p.floors.map((f) => {
    const e = z;
    z += f.height * Math.max(1, f.repeat);
    return Math.round(e * 1000) / 1000;
  });
}

export const fmtElev = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(2).replace(".", ",")}`;

/** Texto da cota: única ou faixa dos repetidos ("+3,00 a +54,00"). */
export function elevationText(f: BuildingFloor, elevation: number): string {
  const n = Math.max(1, f.repeat);
  return n > 1 ? `${fmtElev(elevation)} a ${fmtElev(elevation + f.height * (n - 1))}` : fmtElev(elevation);
}

/** Nome da faixa: com a repetição ("Tipo ×18"). */
export const floorLabel = (f: BuildingFloor) => (f.repeat > 1 ? `${f.name} ×${f.repeat}` : f.name);

export const towerHasFloor = (f: BuildingFloor, towerId: string) => f.common || f.towers.includes(towerId);

/** Pavimentos de uma torre (contando os repetidos) e altura total dela. */
export function towerSummary(p: BuildingProfile, towerId: string): { floors: number; height: number; top: number } {
  const el = floorElevations(p);
  let floors = 0;
  let top = p.baseElevation;
  p.floors.forEach((f, i) => {
    if (!towerHasFloor(f, towerId)) return;
    floors += Math.max(1, f.repeat);
    top = Math.max(top, el[i] + f.height * Math.max(1, f.repeat));
  });
  return { floors, height: Math.round((top - p.baseElevation) * 100) / 100, top };
}

/** Problemas do perfil (avisos no painel). */
export function checkProfile(p: BuildingProfile): string[] {
  const out: string[] = [];
  if (!p.towers.length) out.push("Cadastre ao menos uma torre.");
  const names = new Set<string>();
  for (const f of p.floors) {
    if (!f.name.trim()) out.push("Há um pavimento sem nome.");
    else if (names.has(f.name.trim().toLowerCase())) out.push(`Pavimento repetido: ${f.name}.`);
    names.add(f.name.trim().toLowerCase());
    if (!(f.height > 0)) out.push(`${f.name || "Pavimento"}: informe a altura piso a piso.`);
    if (!f.common && !f.towers.some((t) => p.towers.some((x) => x.id === t))) out.push(`${f.name}: não é comum e não pertence a nenhuma torre.`);
  }
  return out;
}

/** Perfil a partir dos pavimentos do modelo (uma torre; alturas pela diferença das cotas). */
export function profileFromModel(storeys: { name: string; elevation: number }[]): BuildingProfile {
  const s = [...storeys].sort((a, b) => a.elevation - b.elevation);
  const tower: BuildingTower = { id: "torre-a", name: "Torre A" };
  const floors: BuildingFloor[] = s.map((x, i) => ({
    id: newBuildingId("pav-"),
    name: x.name,
    height: Math.round(((s[i + 1]?.elevation ?? x.elevation + 3) - x.elevation) * 100) / 100 || 3,
    repeat: 1,
    common: true,
    towers: [tower.id],
  }));
  return { towers: [tower], floors, baseElevation: Math.round((s[0]?.elevation ?? 0) * 1000) / 1000 };
}

/**
 * Perfil típico para começar: subsolos e térreo comuns, pavimentos tipo por torre (repetidos),
 * cobertura e barrilete por torre.
 */
export function typicalProfile(towers: number, basements: number, typical: number, height = 3): BuildingProfile {
  const t: BuildingTower[] = Array.from({ length: Math.max(1, towers) }, (_, i) => ({ id: `torre-${String.fromCharCode(97 + i)}`, name: `Torre ${String.fromCharCode(65 + i)}` }));
  const all = t.map((x) => x.id);
  const f = (name: string, common: boolean, repeat = 1, h = height): BuildingFloor => ({ id: newBuildingId("pav-"), name, height: h, repeat, common, towers: common ? [] : all });
  const floors: BuildingFloor[] = [];
  for (let i = basements; i >= 1; i--) floors.push(f(`${i}º Subsolo`, true));
  floors.push(f("Térreo", true, 1, 4.5));
  if (typical > 0) floors.push(f(typical > 1 ? `1º ao ${typical}º Pavimento (tipo)` : "1º Pavimento", false, typical));
  floors.push(f("Cobertura", false));
  floors.push(f("Barrilete / casa de máquinas", false, 1, 2.5));
  return { towers: t, floors, baseElevation: -height * basements };
}
