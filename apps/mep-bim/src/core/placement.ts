// Cálculo de posição e orientação de componentes a partir do ponto clicado.
// Coordenadas da cena: metros, Y para cima.
import type { ComponentDef } from "./library";
import type { Vec3 } from "./types";

export interface SurfaceHit {
  point: Vec3;
  /** Normal da face atingida, apontando para o observador. */
  normal: Vec3;
}

export interface PlacementOptions {
  /** mm; significado conforme a fixação (ver ComponentDef.defaultHeight). */
  height: number;
  /** Rotação adicional (rad) em torno do eixo vertical, para teto e piso. */
  rotation: number;
  /** Passo de arredondamento em metros (0 = livre). */
  snap: number;
  /** Nível (Y) do piso abaixo do ponto, usado na fixação em parede. */
  floorLevel: number;
}

export interface Placement {
  ok: boolean;
  reason?: string;
  /** Centro do componente. */
  position: Vec3;
  /** Rotação em torno de Y: o eixo local +Z (frente) aponta para (sen θ, 0, cos θ). */
  rotation: number;
  /** Superfície de referência: piso (parede e piso) ou teto (teto). */
  refLevel: number;
}

/** Dimensões do componente em metros: [largura, profundidade, altura]. */
export function sizeMeters(def: ComponentDef): Vec3 {
  return [def.size[0] / 1000, def.size[1] / 1000, def.size[2] / 1000];
}

const snapTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

export function computePlacement(def: ComponentDef, hit: SurfaceHit, opts: PlacementOptions): Placement {
  const [, depth, height] = sizeMeters(def);
  const [px, py, pz] = hit.point;
  const [nx, ny, nz] = hit.normal;
  const offset = opts.height / 1000;

  if (def.mounting === "parede") {
    const horizontal = Math.hypot(nx, nz);
    if (Math.abs(ny) > 0.35 || horizontal < 1e-6) {
      return { ok: false, reason: "Aponte para uma parede.", position: hit.point, rotation: 0, refLevel: opts.floorLevel };
    }
    const hx = nx / horizontal;
    const hz = nz / horizontal;
    const rotation = Math.atan2(hx, hz);
    // Arredonda apenas ao longo da parede, para não descolar o ponto da face.
    const tx = Math.cos(rotation);
    const tz = -Math.sin(rotation);
    const s = px * tx + pz * tz;
    const ds = snapTo(s, opts.snap) - s;
    return {
      ok: true,
      position: [px + tx * ds + hx * (depth / 2), opts.floorLevel + offset, pz + tz * ds + hz * (depth / 2)],
      rotation,
      refLevel: opts.floorLevel,
    };
  }

  if (def.mounting === "teto") {
    if (ny > -0.7) {
      return { ok: false, reason: "Aponte para a face inferior do teto ou forro.", position: hit.point, rotation: opts.rotation, refLevel: py };
    }
    return {
      ok: true,
      position: [snapTo(px, opts.snap), py - offset - height / 2, snapTo(pz, opts.snap)],
      rotation: opts.rotation,
      refLevel: py,
    };
  }

  if (ny < 0.7) {
    return { ok: false, reason: "Aponte para o piso.", position: hit.point, rotation: opts.rotation, refLevel: py };
  }
  return {
    ok: true,
    position: [snapTo(px, opts.snap), py + offset + height / 2, snapTo(pz, opts.snap)],
    rotation: opts.rotation,
    refLevel: py,
  };
}

// ---- Itens de teto: forro, entreforro ou laje -------------------------------------------

/** Onde o item de teto se apoia. */
export type CeilingRef = "forro" | "entreforro" | "laje";

export interface CeilingMount {
  ref: CeilingRef;
  /**
   * mm acima do piso do pavimento. Forro: altura do forro (usada quando o modelo
   * não tem forro, IfcCovering). Entreforro: altura do fundo do item. Laje: ignorado.
   */
  level: number;
}

export const CEILING_REF_LABEL: Record<CeilingRef, string> = {
  forro: "Alinhado ao forro",
  entreforro: "No entreforro (altura informada)",
  laje: "Encostado na laje superior",
};

export const DEFAULT_CEILING: CeilingMount = { ref: "forro", level: 2600 };

/**
 * Plano de referência (Y da cena) de um item de teto: face inferior do forro ou da
 * laje encontrada no modelo, ou a altura informada. No entreforro, o plano é o topo
 * do item, de modo que o fundo fique na altura informada (com afastamento zero).
 */
export function ceilingPlane(
  def: ComponentDef,
  mount: CeilingMount,
  floorY: number,
  found: { covering: number | null; slab: number | null },
): number {
  if (mount.ref === "entreforro") return floorY + mount.level / 1000 + def.size[2] / 1000;
  if (mount.ref === "forro") return found.covering ?? floorY + mount.level / 1000;
  return found.slab ?? found.covering ?? floorY + Math.max(mount.level / 1000, 2.6);
}

/** Recalcula a cota do centro quando a altura de montagem muda. */
export function elevationFor(def: ComponentDef, refLevel: number, heightMm: number): number {
  const h = def.size[2] / 1000;
  const offset = heightMm / 1000;
  if (def.mounting === "parede") return refLevel + offset;
  if (def.mounting === "teto") return refLevel - offset - h / 2;
  return refLevel + offset + h / 2;
}

/**
 * Centros de uma grade de linhas × colunas dentro do retângulo entre dois
 * cantos (no plano horizontal do primeiro canto). Colunas ao longo de X, linhas ao longo de Z.
 */
export function gridPoints(corner1: Vec3, corner2: Vec3, rows: number, cols: number): Vec3[] {
  const r = Math.max(1, Math.floor(rows));
  const c = Math.max(1, Math.floor(cols));
  const [x1, y, z1] = corner1;
  const [x2, , z2] = corner2;
  const out: Vec3[] = [];
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      out.push([x1 + ((j + 0.5) * (x2 - x1)) / c, y, z1 + ((i + 0.5) * (z2 - z1)) / r]);
    }
  }
  return out;
}

/** Quantidade mínima de divisões para não exceder o espaçamento máximo (m). */
export function countForSpacing(length: number, maxSpacing: number): number {
  if (maxSpacing <= 0) return 1;
  return Math.max(1, Math.ceil(Math.abs(length) / maxSpacing - 1e-9));
}
