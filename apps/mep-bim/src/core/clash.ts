import { inflate, obbIntersectsMesh, obbMesh, type OBB, type TriangleMesh } from "./obb";
import type { BBox, Discipline, Vec3 } from "./types";

export interface ClashItem {
  id: number;
  discipline: Discipline;
  bbox: BBox;
  systems?: string[];
  /** Caixa orientada exata (elementos criados no app). */
  obb?: OBB;
  /** Malha triangulada (elementos do IFC). */
  mesh?: TriangleMesh;
}

export interface ClashOptions {
  /** Disciplinas do grupo A. */
  groupA: Discipline[];
  /** Disciplinas do grupo B (testadas contra o grupo A). */
  groupB: Discipline[];
  /**
   * Folga mínima em metros. Elementos que não se tocam, mas estão mais
   * próximos que isso, são reportados como interferência "de folga".
   */
  clearance?: number;
  /** Penetração mínima (m) para considerar interferência física. Padrão 1 mm. */
  tolerance?: number;
  /** Ignora pares do mesmo sistema (conexões, registros e terminais na rede). */
  ignoreSameSystem?: boolean;
  /** Pares a ignorar (ex.: trecho e o equipamento em que ele se conecta). */
  ignorePair?: (a: number, b: number) => boolean;
}

export interface Clash {
  a: number;
  b: number;
  kind: "fisica" | "folga";
  /** Penetração (física) ou distância livre (folga), em metros; −1 = abaixo da folga, valor exato desconhecido. */
  distance: number;
  /** Centro da região de conflito, para posicionar a câmera. */
  point: Vec3;
}

/**
 * Detecção de interferências em duas etapas:
 * 1. triagem por caixas envolventes (AABB) com "sweep and prune" no eixo X;
 * 2. verificação exata quando um dos lados é um elemento criado no app
 *    (caixa orientada) e o outro tem malha ou caixa orientada.
 * Pares entre dois elementos do IFC ficam só na triagem por AABB.
 */
export function detectClashes(items: ClashItem[], opts: ClashOptions): Clash[] {
  const clearance = opts.clearance ?? 0;
  const tolerance = opts.tolerance ?? 0.001;
  const ignoreSameSystem = opts.ignoreSameSystem ?? true;
  const inA = new Set(opts.groupA);
  const inB = new Set(opts.groupB);

  const candidates = items
    .filter((it) => inA.has(it.discipline) || inB.has(it.discipline))
    .sort((p, q) => p.bbox.min[0] - q.bbox.min[0]);

  const clashes: Clash[] = [];
  const active: ClashItem[] = [];

  for (const cur of candidates) {
    // Remove da lista ativa quem já terminou antes do início do atual (+ folga).
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].bbox.max[0] + clearance < cur.bbox.min[0]) active.splice(i, 1);
    }
    for (const other of active) {
      const pairOk =
        (inA.has(cur.discipline) && inB.has(other.discipline)) ||
        (inB.has(cur.discipline) && inA.has(other.discipline));
      if (!pairOk) continue;
      if (ignoreSameSystem && shareSystem(cur, other)) continue;
      if (opts.ignorePair?.(cur.id, other.id)) continue;

      const c = compare(cur.bbox, other.bbox);
      const physicalCandidate = c.overlap && c.depth > tolerance;
      const clearanceCandidate = clearance > 0 && (c.overlap || c.gap < clearance);
      if (!physicalCandidate && !clearanceCandidate) continue;
      const exact = exactTest(cur, other);
      if (physicalCandidate && (!exact || exact(-tolerance))) {
        clashes.push({ a: other.id, b: cur.id, kind: "fisica", distance: c.depth, point: c.point });
      } else if (clearanceCandidate && (!exact || exact(clearance))) {
        // Caixas sobrepostas sem contato real: distância exata desconhecida (abaixo da folga).
        clashes.push({ a: other.id, b: cur.id, kind: "folga", distance: c.overlap ? -1 : c.gap, point: c.point });
      }
    }
    active.push(cur);
  }

  return clashes.sort((p, q) =>
    p.kind === q.kind ? (p.kind === "fisica" ? q.distance - p.distance : p.distance - q.distance) : p.kind === "fisica" ? -1 : 1,
  );
}

/**
 * Teste exato entre dois itens, se possível: devolve uma função que, para uma
 * margem (m; negativa encolhe a caixa), diz se há contato. null = sem teste exato.
 */
function exactTest(a: ClashItem, b: ClashItem): ((margin: number) => boolean) | null {
  const [box, other] = a.obb ? [a, b] : b.obb ? [b, a] : [null, null];
  if (!box || !other) return null;
  const mesh = other.mesh ?? (other.obb ? obbMesh(other.obb) : null);
  if (!mesh) return null;
  return (margin) => obbIntersectsMesh(inflate(box.obb!, margin), mesh);
}

function shareSystem(a: ClashItem, b: ClashItem): boolean {
  if (!a.systems?.length || !b.systems?.length) return false;
  return a.systems.some((s) => b.systems!.includes(s));
}

function compare(a: BBox, b: BBox): { overlap: boolean; depth: number; gap: number; point: Vec3 } {
  let depth = Infinity;
  let gap2 = 0;
  const point: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.min[i], b.min[i]);
    const hi = Math.min(a.max[i], b.max[i]);
    point[i] = (lo + hi) / 2;
    const ov = hi - lo;
    if (ov >= 0) depth = Math.min(depth, ov);
    else gap2 += ov * ov;
  }
  const overlap = gap2 === 0;
  return { overlap, depth: overlap ? depth : 0, gap: Math.sqrt(gap2), point };
}
