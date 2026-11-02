// Operações de modificação na planta (copiar, mover, recortar, colar, apagar) sobre
// desenhos 2D, pontos locados e trechos. Deslocamentos em planta (IFC x, y em m),
// convertidos para a cena (Y para cima) por `toWorld`.
import { COMPONENT_BY_ID } from "./library";
import { isDraftId, newDraftId, translateDraft, type DraftEntity } from "./draft";
import { newGuid, newPointId, nextTag, type PlacedPoint } from "./points";
import { newRunId, nextRunTag, runIdOfElement, RUN_TYPE_BY_ID, segmentElementId, type Run } from "./runs";
import type { P2 } from "./plan/section";
import type { Vec3 } from "./types";

export interface EditState {
  points: PlacedPoint[];
  runs: Run[];
  drafts: DraftEntity[];
}

/** Deslocamento da cena correspondente a um deslocamento em planta (sem componente vertical). */
export type PlanToWorld = (d: P2) => Vec3;

export interface Picked {
  points: number[];
  runs: number[];
  drafts: number[];
}

/** Separa os ids de seleção (da cena) por tipo de objeto editável. */
export function splitSelection(ids: number[], st: EditState): Picked {
  const pointSet = new Set(st.points.map((p) => p.id));
  const runSet = new Set(st.runs.map((r) => r.id));
  const out: Picked = { points: [], runs: [], drafts: [] };
  for (const id of ids) {
    if (isDraftId(id)) {
      if (st.drafts.some((d) => d.id === id) && !out.drafts.includes(id)) out.drafts.push(id);
      continue;
    }
    const r = runIdOfElement(id);
    if (r != null) {
      if (runSet.has(r) && !out.runs.includes(r)) out.runs.push(r);
      continue;
    }
    if (pointSet.has(id) && !out.points.includes(id)) out.points.push(id);
  }
  return out;
}

export const pickedCount = (p: Picked) => p.points.length + p.runs.length + p.drafts.length;

const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Move os objetos escolhidos. */
export function moveItems(st: EditState, sel: Picked, d: P2, toWorld: PlanToWorld): EditState {
  const w = toWorld(d);
  const ps = new Set(sel.points);
  const rs = new Set(sel.runs);
  const ds = new Set(sel.drafts);
  return {
    points: st.points.map((p) => (ps.has(p.id) ? { ...p, position: addV(p.position, w) } : p)),
    runs: st.runs.map((r) => (rs.has(r.id) ? { ...r, vertices: r.vertices.map((v) => addV(v, w)) } : r)),
    drafts: st.drafts.map((e) => (ds.has(e.id) ? translateDraft(e, d) : e)),
  };
}

/** Remove os objetos escolhidos. */
export function deleteItems(st: EditState, sel: Picked): EditState {
  const ps = new Set(sel.points);
  const rs = new Set(sel.runs);
  const ds = new Set(sel.drafts);
  return { points: st.points.filter((p) => !ps.has(p.id)), runs: st.runs.filter((r) => !rs.has(r.id)), drafts: st.drafts.filter((e) => !ds.has(e.id)) };
}

/** Conteúdo da área de transferência: cópias soltas, com o ponto base em planta e o pavimento de origem. */
export interface Clipboard {
  points: PlacedPoint[];
  runs: Run[];
  drafts: DraftEntity[];
  base: P2;
  storey: string;
  /** Y do piso do pavimento de origem (cena). */
  level: number;
}

export function toClipboard(st: EditState, sel: Picked, base: P2, storey: string, level: number): Clipboard {
  return {
    points: st.points.filter((p) => sel.points.includes(p.id)),
    runs: st.runs.filter((r) => sel.runs.includes(r.id)),
    drafts: st.drafts.filter((e) => sel.drafts.includes(e.id)),
    base,
    storey,
    level,
  };
}

export interface PasteTarget {
  /** Deslocamento em planta. */
  d: P2;
  /** Pavimento de destino e diferença de cota (cena) em relação à origem. */
  storey: string;
  dy: number;
  /** Vista dona das anotações coladas (null/ausente = planta de trabalho). */
  view?: string | null;
}

/**
 * Insere cópias novas (ids, GUIDs e etiquetas novos). Pontos copiados saem sem circuito;
 * trechos levam o circuito apenas se o ponto de destino o mantiver (sem circuito também).
 * Devolve o novo estado e os ids de seleção das cópias.
 */
export function insertCopies(st: EditState, src: Pick<Clipboard, "points" | "runs" | "drafts">, t: PasteTarget, toWorld: PlanToWorld): { state: EditState; ids: number[] } {
  const w = addV(toWorld(t.d), [0, t.dy, 0]);
  const points = [...st.points];
  const runs = [...st.runs];
  const drafts = [...st.drafts];
  const ids: number[] = [];
  for (const p of src.points) {
    const def = COMPONENT_BY_ID[p.componentId];
    const id = newPointId();
    points.push({
      ...p,
      id,
      guid: newGuid(),
      tag: def ? nextTag(points, def.tagPrefix) : p.tag,
      position: addV(p.position, w),
      refLevel: p.refLevel + t.dy,
      storey: t.dy !== 0 ? t.storey : p.storey,
      circuit: null,
      params: Object.fromEntries(Object.entries(p.params).filter(([k]) => k !== "Circuito")),
    });
    ids.push(id);
  }
  for (const r of src.runs) {
    const type = RUN_TYPE_BY_ID[r.typeId];
    const id = newRunId();
    runs.push({
      ...r,
      id,
      guid: newGuid(),
      tag: type ? nextRunTag(runs, type.tagPrefix) : r.tag,
      vertices: r.vertices.map((v) => addV(v, w)),
      circuit: null,
      params: Object.fromEntries(Object.entries(r.params).filter(([k]) => k !== "Circuito")),
    });
    ids.push(segmentElementId(id, 0));
  }
  for (const e of src.drafts) {
    const c = { ...translateDraft(e, t.d), id: newDraftId(), storey: t.storey } as DraftEntity;
    if (t.view) c.view = t.view;
    else delete c.view;
    drafts.push(c);
    ids.push(c.id);
  }
  return { state: { points, runs, drafts }, ids };
}

/** Vértices em planta dos objetos (para a caixa de seleção e os cortes). */
export function itemPlanPoints(st: EditState, sel: Picked, toPlan: (v: Vec3) => P2, draftPts: (e: DraftEntity) => P2[]): P2[] {
  const out: P2[] = [];
  for (const p of st.points) if (sel.points.includes(p.id)) out.push(toPlan(p.position));
  for (const r of st.runs) if (sel.runs.includes(r.id)) out.push(...r.vertices.map(toPlan));
  for (const e of st.drafts) if (sel.drafts.includes(e.id)) out.push(...draftPts(e));
  return out;
}
