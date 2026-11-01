// Gera os pontos do programa de necessidades no modelo: junto a cada equipamento
// (na parede mais próxima, no piso ou no teto) e, para as instalações do ambiente,
// distribuídos pelo contorno.
import { COMPONENT_BY_ID } from "../../../core/library";
import { computePlacement, DEFAULT_CEILING, type Placement, type SurfaceHit } from "../../../core/placement";
import { defaultParams, newGuid, newPointId, nextTag, storeyForMounting, type PlacedPoint } from "../../../core/points";
import { PROGRAM_ORIGIN, roomRequests, type EquipmentInstance, type EquipmentType, type ProgramState } from "../../../core/program";
import { centroid, perimeterPoints, spaceLabel, type Space } from "../../../core/spaces";
import type { ElementInfo, Vec3 } from "../../../core/types";
import type { LoadedModel } from "../../../ifc/loadIfc";
import type { CeilingResolver } from "../locacao/ceiling";
import type { Viewer } from "../viewer/Viewer";
import type { P2 } from "../../../core/plan/section";

const WALL_TYPES = new Set(["IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL", "IFCCOLUMN", "IFCPLATE", "IFCCOVERING"]);
const SPACING = 0.3; // m entre pontos iguais de um mesmo pedido

export interface GenerateResult {
  add: PlacedPoint[];
  removeIds: number[];
  warnings: string[];
}

export function generateProgramPoints(opts: {
  model: LoadedModel;
  viewer: Viewer;
  elementById: Map<number, ElementInfo>;
  resolveCeiling: CeilingResolver;
  catalog: EquipmentType[];
  program: ProgramState;
  inventory: Map<string, EquipmentInstance[]>;
  points: PlacedPoint[];
  rooms: Space[];
}): GenerateResult {
  const { model, viewer, elementById, resolveCeiling, catalog, program, inventory, rooms } = opts;
  const cs = model.coordinates;
  const planToWorld = (p: P2, y: number): Vec3 => cs.ifcToWorld([p[0], p[1], cs.worldToIfc([0, y, 0])[2]]);
  const planDirToWorld = (d: P2): Vec3 => {
    const a = planToWorld([0, 0], 0);
    const b = planToWorld(d, 0);
    return [b[0] - a[0], 0, b[2] - a[2]];
  };
  const isWall = (n: Vec3, id: number) => Math.abs(n[1]) < 0.35 && WALL_TYPES.has(elementById.get(id)?.ifcType ?? "");

  /** Parede mais próxima de um ponto (8 direções horizontais, até 3 m). */
  const nearestWall = (c: Vec3, floorY: number): SurfaceHit | null => {
    const origin: Vec3 = [c[0], floorY + 0.4, c[2]];
    let best: { hit: SurfaceHit; d: number } | null = null;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const hit = viewer.castRay(origin, [Math.cos(a), 0, Math.sin(a)], 3, isWall, true);
      if (!hit) continue;
      const d = Math.hypot(hit.point[0] - origin[0], hit.point[2] - origin[2]);
      if (!best || d < best.d) best = { hit, d };
    }
    return best?.hit ?? null;
  };

  const labels = new Set(rooms.map(spaceLabel));
  const removeIds = opts.points.filter((p) => p.params.Origem === PROGRAM_ORIGIN && labels.has(String(p.params.Ambiente ?? ""))).map((p) => p.id);
  const kept = opts.points.filter((p) => !removeIds.includes(p.id));
  const all = [...kept];
  const add: PlacedPoint[] = [];
  const warnings: string[] = [];

  for (const room of rooms) {
    const label = spaceLabel(room);
    const floorY = room.floorY;
    const reqs = roomRequests(room.globalId, program.rooms[room.globalId], inventory.get(room.globalId) ?? [], catalog);
    // Pontos de parede das instalações do ambiente: pelo contorno, pulando portas e vãos.
    const perimeter = perimeterPoints(room.polygon, 0.5, 0.3);
    let perimeterCursor = 0;

    for (const r of reqs) {
      const def = COMPONENT_BY_ID[r.req.componentId];
      if (!def) {
        warnings.push(`${label}: componente ${r.req.componentId} não existe na biblioteca.`);
        continue;
      }
      const height = r.req.height ?? def.defaultHeight;
      const qty = Math.max(0, Math.round(r.req.qty));
      const placements: Placement[] = [];

      if (r.center) {
        const wall = nearestWall(r.center, floorY);
        const n = wall?.normal ?? null;
        const right: Vec3 = n ? [n[2], 0, -n[0]] : [1, 0, 0];
        for (let i = 0; i < qty; i++) {
          const off = (r.req.lateral ?? 0) + (i - (qty - 1) / 2) * SPACING;
          if (def.mounting === "parede") {
            if (!wall) {
              warnings.push(`${label} · ${r.source}: nenhuma parede a menos de 3 m para ${def.label}.`);
              break;
            }
            const p: Vec3 = [wall.point[0] + right[0] * off, floorY + 0.4, wall.point[2] + right[2] * off];
            // Confirma a parede no ponto deslocado (pode ter saído do trecho de parede).
            const back: Vec3 = [p[0] + n![0] * 0.2, p[1], p[2] + n![2] * 0.2];
            const hit = viewer.castRay(back, [-n![0], 0, -n![2]], 0.5, isWall, true) ?? { point: p, normal: n! };
            placements.push(computePlacement(def, hit, { height, rotation: 0, snap: 0, floorLevel: floorY }));
          } else {
            let base: Vec3 = r.center;
            if (wall && r.req.recuo != null) base = [wall.point[0] + n![0] * r.req.recuo, floorY, wall.point[2] + n![2] * r.req.recuo];
            const p: Vec3 = [base[0] + right[0] * off, floorY, base[2] + right[2] * off];
            const rotation = n ? Math.atan2(n[0], n[2]) : 0;
            if (def.mounting === "teto") {
              const y = resolveCeiling(def, DEFAULT_CEILING, p[0], p[2], floorY);
              placements.push(computePlacement(def, { point: [p[0], y, p[2]], normal: [0, -1, 0] }, { height, rotation, snap: 0, floorLevel: floorY }));
            } else {
              placements.push(computePlacement(def, { point: p, normal: [0, 1, 0] }, { height, rotation, snap: 0, floorLevel: floorY }));
            }
          }
        }
      } else if (def.mounting === "parede") {
        // Sem posição de equipamento: distribui pelo contorno do ambiente.
        let made = 0;
        let tries = 0;
        const step = Math.max(1, Math.floor(perimeter.length / Math.max(1, qty + 1)));
        while (made < qty && tries < perimeter.length * 2 && perimeter.length) {
          const pp = perimeter[(perimeterCursor + step * (made + 1) + tries) % perimeter.length];
          tries++;
          const inner: P2 = [pp.point[0] + pp.inward[0] * 0.15, pp.point[1] + pp.inward[1] * 0.15];
          const hit = viewer.castRay(planToWorld(inner, floorY + 0.4), planDirToWorld([-pp.inward[0], -pp.inward[1]]), 0.6, isWall, true);
          if (!hit) continue;
          placements.push(computePlacement(def, hit, { height, rotation: 0, snap: 0, floorLevel: floorY }));
          made++;
        }
        perimeterCursor += step * (made + 1);
        if (made < qty) warnings.push(`${label}: só ${made} de ${qty} ${def.label} couberam nas paredes.`);
      } else {
        const c = planToWorld(centroid(room.polygon), floorY);
        for (let i = 0; i < qty; i++) {
          const p: Vec3 = [c[0] + (i - (qty - 1) / 2) * SPACING, floorY, c[2]];
          if (def.mounting === "teto") {
            const y = resolveCeiling(def, DEFAULT_CEILING, p[0], p[2], floorY);
            placements.push(computePlacement(def, { point: [p[0], y, p[2]], normal: [0, -1, 0] }, { height, rotation: 0, snap: 0, floorLevel: floorY }));
          } else placements.push(computePlacement(def, { point: p, normal: [0, 1, 0] }, { height, rotation: 0, snap: 0, floorLevel: floorY }));
        }
      }

      for (const pl of placements) {
        if (!pl.ok) continue;
        const point: PlacedPoint = {
          id: newPointId(),
          guid: newGuid(),
          componentId: def.id,
          tag: nextTag(all, def.tagPrefix),
          position: pl.position,
          rotation: pl.rotation,
          height: def.mounting === "teto" ? def.defaultHeight : height,
          refLevel: pl.refLevel,
          storey: storeyForMounting(def.mounting, pl.refLevel, model.storeyLevels),
          system: def.system,
          params: { ...defaultParams(def), ...(r.req.params ?? {}), Ambiente: label, Equipamento: r.source, Origem: PROGRAM_ORIGIN },
          ...(def.mounting === "teto" ? { ceiling: { ...DEFAULT_CEILING } } : {}),
        };
        all.push(point);
        add.push(point);
      }
    }
  }
  return { add, removeIds, warnings };
}
