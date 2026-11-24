// Coordenadas do projeto e georreferenciamento (IFC4): ponto base do projeto (IfcSite),
// survey point / coordenadas compartilhadas (IfcMapConversion + IfcProjectedCRS),
// norte verdadeiro e latitude/longitude.
//
// Sistemas usados no app:
// - "projeto": coordenadas do IFC (metros), as mesmas do Revit/Archicad que exportou o arquivo;
// - "mapa" (UTM, coordenadas compartilhadas): E, N e cota pela IfcMapConversion.
import type { Vec3 } from "./types";

export interface MapConversion {
  /** Coordenadas (m) do ponto de origem do projeto no sistema do mapa (survey point). */
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  /** Direção do eixo X do projeto no mapa (rotação para o norte de quadrícula). */
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  scale: number;
}

export interface ProjectedCRS {
  /** Ex.: "EPSG:31983". */
  name: string;
  description?: string | null;
  geodeticDatum?: string | null;
  mapProjection?: string | null;
  mapZone?: string | null;
}

export interface SiteInfo {
  /** Graus decimais (negativo = sul / oeste). */
  latitude: number | null;
  longitude: number | null;
  /** Cota de referência do terreno (m). */
  elevation: number | null;
  /** Posição e rotação (graus) do IfcSite nas coordenadas do IFC: o "ponto base do projeto". */
  location: Vec3;
  rotationDeg: number;
}

export interface Georef {
  map: MapConversion | null;
  crs: ProjectedCRS | null;
  site: SiteInfo | null;
  /** Ângulo (graus, anti-horário a partir de +Y do projeto) do norte verdadeiro. */
  trueNorthDeg: number | null;
}

export const EMPTY_GEOREF: Georef = { map: null, crs: null, site: null, trueNorthDeg: null };

/** Rotação (graus) do eixo X do projeto em relação ao leste do mapa. */
export const mapRotationDeg = (m: MapConversion) => (Math.atan2(m.xAxisOrdinate, m.xAxisAbscissa) * 180) / Math.PI;

/** Coordenadas do projeto (IFC, m) → mapa (E, N, cota). */
export function toMap(m: MapConversion, [x, y, z]: Vec3): Vec3 {
  const a = Math.atan2(m.xAxisOrdinate, m.xAxisAbscissa);
  const c = Math.cos(a) * m.scale;
  const s = Math.sin(a) * m.scale;
  return [m.eastings + c * x - s * y, m.northings + s * x + c * y, m.orthogonalHeight + z];
}

/** Mapa (E, N, cota) → coordenadas do projeto (IFC, m). */
export function fromMap(m: MapConversion, [e, n, h]: Vec3): Vec3 {
  const a = Math.atan2(m.xAxisOrdinate, m.xAxisAbscissa);
  const dx = (e - m.eastings) / m.scale;
  const dy = (n - m.northings) / m.scale;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * dx + s * dy, -s * dx + c * dy, h - m.orthogonalHeight];
}

/** Monta a conversão a partir de E, N, cota e ângulo (graus) do eixo X do projeto em relação ao leste. */
export function mapConversionFrom(eastings: number, northings: number, height: number, rotationDeg: number, scale = 1): MapConversion {
  const a = (rotationDeg * Math.PI) / 180;
  return { eastings, northings, orthogonalHeight: height, xAxisAbscissa: Math.cos(a), xAxisOrdinate: Math.sin(a), scale };
}

/** Ângulo IFC (graus, minutos, segundos, milionésimos) → graus decimais. */
export function compoundToDegrees(parts: number[] | null | undefined): number | null {
  if (!parts || !parts.length) return null;
  const sign = parts.some((p) => p < 0) ? -1 : 1;
  const [d = 0, m = 0, s = 0, u = 0] = parts.map(Math.abs);
  return sign * (d + m / 60 + (s + u / 1e6) / 3600);
}

/** Graus decimais → ângulo IFC composto. */
export function degreesToCompound(deg: number): [number, number, number, number] {
  const sign = deg < 0 ? -1 : 1;
  let v = Math.abs(deg);
  const d = Math.floor(v);
  v = (v - d) * 60;
  const m = Math.floor(v);
  v = (v - m) * 60;
  const s = Math.floor(v);
  const u = Math.round((v - s) * 1e6);
  return [sign * d, sign * m, sign * s, sign * u];
}

/** 23°33'01,5"S */
export function formatDms(deg: number | null, axis: "lat" | "lon"): string {
  if (deg == null) return "—";
  const hemi = axis === "lat" ? (deg < 0 ? "S" : "N") : deg < 0 ? "O" : "L";
  let v = Math.abs(deg);
  const d = Math.floor(v);
  v = (v - d) * 60;
  const m = Math.floor(v);
  const s = (v - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1).replace(".", ",").padStart(4, "0")}"${hemi}`;
}

/** Número com separador de milhar (pt-BR) e casas decimais. */
export const fmtCoord = (v: number, decimals = 3) => v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * Configuração do projeto (salva no arquivo): usa a do IFC ou uma informada pelo usuário,
 * para exportar e mostrar coordenadas quando o IFC não traz georreferenciamento.
 */
export interface GeorefSettings {
  source: "ifc" | "manual";
  eastings: number;
  northings: number;
  height: number;
  /** Ângulo do eixo X do projeto em relação ao leste (graus, anti-horário). */
  rotationDeg: number;
  crsName: string;
  trueNorthDeg: number;
  latitude: number | null;
  longitude: number | null;
}

/** Georreferenciamento efetivo: o do IFC ou o informado no projeto. */
export function effectiveGeoref(fromIfc: Georef, settings: GeorefSettings | null): Georef {
  if (!settings || settings.source === "ifc") return fromIfc;
  return {
    map: mapConversionFrom(settings.eastings, settings.northings, settings.height, settings.rotationDeg),
    crs: settings.crsName ? { name: settings.crsName } : null,
    site: {
      latitude: settings.latitude,
      longitude: settings.longitude,
      elevation: settings.height,
      location: fromIfc.site?.location ?? [0, 0, 0],
      rotationDeg: fromIfc.site?.rotationDeg ?? 0,
    },
    trueNorthDeg: settings.trueNorthDeg,
  };
}

/** Valores iniciais do formulário a partir do IFC. */
export function settingsFromGeoref(g: Georef): GeorefSettings {
  return {
    source: "ifc",
    eastings: g.map?.eastings ?? 0,
    northings: g.map?.northings ?? 0,
    height: g.map?.orthogonalHeight ?? g.site?.elevation ?? 0,
    rotationDeg: g.map ? mapRotationDeg(g.map) : 0,
    crsName: g.crs?.name ?? "",
    trueNorthDeg: g.trueNorthDeg ?? 0,
    latitude: g.site?.latitude ?? null,
    longitude: g.site?.longitude ?? null,
  };
}
