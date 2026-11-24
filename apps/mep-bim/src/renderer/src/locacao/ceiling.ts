// Busca no modelo do forro (IfcCovering) e da laje acima de um ponto, para itens de teto.
import { ceilingPlane, elevationFor, type CeilingMount } from "../../../core/placement";
import type { ComponentDef } from "../../../core/library";
import { storeyAt, storeyForMounting, type PlacedPoint, type StoreyLevel } from "../../../core/points";
import type { ElementInfo, Vec3 } from "../../../core/types";
import type { Viewer } from "../viewer/Viewer";

const SLAB_TYPES = new Set(["IFCSLAB", "IFCROOF"]);

/** Nível (Y) do piso do pavimento em que está a cota y. */
export function floorLevelAt(y: number, levels: StoreyLevel[]): number {
  const name = storeyAt(y - 0.1, levels);
  return levels.find((s) => s.name === name)?.level ?? 0;
}

/** Altura até o próximo pavimento (limite da busca do forro e da laje). */
function reachAbove(floorY: number, levels: StoreyLevel[]): number {
  const next = levels.map((s) => s.level).filter((l) => l > floorY + 0.5).sort((a, b) => a - b)[0];
  return next != null ? next - floorY + 0.3 : 8;
}

export type CeilingResolver = (def: ComponentDef, mount: CeilingMount, x: number, z: number, floorY: number) => number;

/** Plano de referência (Y) de um item de teto em (x, z) da cena, sobre o piso floorY. */
export function makeCeilingResolver(viewer: Viewer, elementById: Map<number, ElementInfo>, levels: StoreyLevel[]): CeilingResolver {
  return (def, mount, x, z, floorY) => {
    if (mount.ref === "entreforro") return ceilingPlane(def, mount, floorY, { covering: null, slab: null });
    const origin: Vec3 = [x, floorY + 0.3, z];
    const reach = reachAbove(floorY, levels);
    const typeOf = (id: number) => elementById.get(id)?.ifcType ?? "";
    const covering = viewer.castRay(origin, [0, 1, 0], reach, (n, id) => n[1] < -0.7 && typeOf(id) === "IFCCOVERING", true)?.point[1] ?? null;
    const slab = mount.ref === "laje" ? (viewer.castRay(origin, [0, 1, 0], reach, (n, id) => n[1] < -0.7 && SLAB_TYPES.has(typeOf(id)), true)?.point[1] ?? null) : null;
    return ceilingPlane(def, mount, floorY, { covering, slab });
  };
}

/** Reposiciona um ponto de teto para uma nova referência (forro, entreforro ou laje). */
export function reseatCeiling(
  p: PlacedPoint,
  def: ComponentDef,
  mount: CeilingMount,
  resolve: CeilingResolver,
  levels: StoreyLevel[],
  height = p.height,
): Partial<PlacedPoint> {
  const floorY = levels.find((s) => s.name === p.storey)?.level ?? floorLevelAt(p.refLevel, levels);
  const refLevel = resolve(def, mount, p.position[0], p.position[2], floorY);
  const h = mount.ref === "entreforro" ? 0 : height;
  return {
    ceiling: mount,
    refLevel,
    height: h,
    position: [p.position[0], elevationFor(def, refLevel, h), p.position[2]],
    storey: storeyForMounting("teto", refLevel, levels),
  };
}

/** Face inferior da laje acima de (x, z): do modelo (IfcSlab/IfcRoof) ou estimada pelo próximo pavimento. */
export function makeSlabProbe(viewer: Viewer, elementById: Map<number, ElementInfo>, levels: StoreyLevel[]) {
  return (x: number, z: number, floorY: number): number => {
    const reach = reachAbove(floorY, levels);
    const hit = viewer.castRay([x, floorY + 0.3, z], [0, 1, 0], reach, (n, id) => n[1] < -0.7 && SLAB_TYPES.has(elementById.get(id)?.ifcType ?? ""), true);
    if (hit) return hit.point[1];
    const next = levels.map((s) => s.level).filter((l) => l > floorY + 0.5).sort((a, b) => a - b)[0];
    return next != null ? next - 0.15 : floorY + 2.85;
  };
}
