// Desenho de uma vista (planta, ampliação ou corte) para a folha e o DXF, aplicando as regras
// da seção: em Documentação, só as disciplinas do projeto e, em meio-tom, as de referência.
import { flowPrims } from "./flow";
import type { PullBox } from "./conduits";
import type { DraftEntity } from "./draft";
import { draftPrims } from "./draft";
import type { CoordinateSystem } from "./math";
import type { TriangleMesh } from "./obb";
import { boundsOf, buildPlan, type DoorOverride } from "./plan/build";
import type { PlanDrawing } from "./plan/drawing";
import { buildSection } from "./plan/elevation";
import type { SheetInfo, SheetFormat } from "./plan/sheet";
import type { PlacedPoint, StoreyLevel } from "./points";
import { segmentElementId, type Run } from "./runs";
import type { Space } from "./spaces";
import type { Discipline, ElementInfo } from "./types";
import { applyHalftone, beamOptions, clipPrims, DEFAULT_LABELS, filterLegend, parseFloorPlanId, rangeOf, viewFilter, viewMarkers, type ViewDef } from "./views";
import { planRangeOf } from "./plan/levels";

export interface ModelContext {
  elements: ElementInfo[];
  meshes: Map<number, TriangleMesh>;
  cs: CoordinateSystem;
  storeyLevels: StoreyLevel[];
  points: PlacedPoint[];
  runs: Run[];
  spaces?: Space[];
  boxes?: PullBox[];
  drafts: DraftEntity[];
  views: ViewDef[];
  /** Disciplinas do projeto (vazio = todas as de instalações). */
  projectDisciplines: Discipline[];
  /** Ids ocultos na vista (visibilidade da vista e geral). */
  hidden?: (view: ViewDef) => Set<number>;
  /** Ajustes das portas (lado, dobradiça, sem arco). */
  doors?: Record<string, DoorOverride>;
}

/** Contexto sem os elementos, pontos e trechos ocultos na vista. */
function visibleContext(view: ViewDef, ctx: ModelContext): ModelContext {
  const h = ctx.hidden?.(view);
  if (!h?.size) return ctx;
  return {
    ...ctx,
    elements: ctx.elements.filter((e) => !h.has(e.expressID)),
    points: ctx.points.filter((p) => !h.has(p.id)),
    runs: ctx.runs.filter((r) => !h.has(segmentElementId(r.id, 0))),
  };
}

export function viewDrawing(view: ViewDef, full: ModelContext): PlanDrawing | null {
  const ctx = visibleContext(view, full);
  if (view.kind === "fluxograma") {
    if (!view.flow) return null;
    const prims = flowPrims(view.flow, { legend: true });
    return { prims, bounds: boundsOf(prims), legend: [], scale: view.scale, storey: "", cutHeight: 0 };
  }
  const f = viewFilter(view, ctx.projectDisciplines);
  if (view.kind === "corte" && view.cut) {
    const d = buildSection({
      elements: ctx.elements,
      meshes: ctx.meshes,
      cs: ctx.cs,
      storeyLevels: ctx.storeyLevels,
      points: ctx.points,
      runs: ctx.runs,
      disciplines: f.show,
      cut: view.cut,
      scale: view.scale,
      name: view.name,
      labels: view.labels ?? DEFAULT_LABELS,
    });
    const notes = ctx.drafts.filter((x) => x.view === view.id).flatMap((x) => draftPrims(x, view.scale));
    const prims = [...applyHalftone(d.prims, f), ...notes];
    return { ...d, prims, bounds: boundsOf(prims) };
  }
  if ((view.kind === "planta" || view.kind === "ampliacao") && view.storey) {
    const d = buildPlan({
      elements: ctx.elements,
      meshes: ctx.meshes,
      cs: ctx.cs,
      storeyLevels: ctx.storeyLevels,
      storey: view.storey,
      cutHeight: view.cutHeight ?? 1.2,
      points: ctx.points,
      runs: ctx.runs,
      scale: view.scale,
      disciplines: f.show,
      labels: view.labels ?? DEFAULT_LABELS,
      spaces: ctx.spaces,
      boxes: ctx.boxes,
      drafts: ctx.drafts,
      draftView: view.section === "trabalho" && view.kind === "planta" ? null : view.id,
      beams: beamOptions(view),
      range: view.kind === "planta" ? planRangeOf(view, ctx.elements, ctx.storeyLevels) : undefined,
      doors: ctx.doors,
    });
    let prims = applyHalftone(d.prims, f);
    if (view.section === "documentacao" && view.workNotes)
      prims = [...prims, ...ctx.drafts.filter((x) => !x.view && x.storey === view.storey).flatMap((x) => draftPrims(x, view.scale))];
    if (view.kind === "planta" && view.section === "documentacao") prims = [...prims, ...viewMarkers(ctx.views, view.storey, view.scale)];
    if (view.kind === "ampliacao" && view.region) prims = clipPrims(prims, view.region);
    const bounds = view.kind === "ampliacao" && view.region ? { min: view.region.min, max: view.region.max } : boundsOf(prims);
    return { ...d, prims, bounds, legend: filterLegend(d.legend, f) };
  }
  return null;
}

export function viewSubtitle(view: ViewDef): string {
  const s = `ESCALA 1:${view.scale}`;
  const fp = parseFloorPlanId(view.id);
  const n = (v: number) => v.toFixed(2).replace(".", ",");
  if (fp) {
    const r = rangeOf(view, fp.type);
    return `${s} · ${fp.type === "teto" ? "planta de teto: base na laje de teto" : "planta de piso: base no piso"}, ${n(r.below)} m abaixo e ${n(r.above)} m acima`;
  }
  if (view.kind === "planta") return `${s} · corte a ${n(view.cutHeight ?? 1.2)} m do piso`;
  if (view.kind === "corte" && view.cut) return `${s} · profundidade ${view.cut.depth.toFixed(1).replace(".", ",")} m`;
  if (view.kind === "3d" || view.kind === "fluxograma") return "SEM ESCALA";
  return s;
}

export const viewTitle = (view: ViewDef) => view.name.toUpperCase();

// ---- Folhas ------------------------------------------------------------------------------

export interface SheetViewportDef {
  viewId: string;
  /** Centro na folha (mm); ausente = automático. */
  pos?: [number, number];
  /** Vistas 3D: largura da imagem (mm). */
  widthMm?: number;
}

export interface SheetDef {
  id: string;
  /** Número/nome da folha (ex.: "ELE-01"). */
  name: string;
  format: SheetFormat;
  titleBlockId: string | null;
  info: SheetInfo;
  viewports: SheetViewportDef[];
}

let sheetSeq = 0;
export const newSheetId = () => `folha-${Date.now().toString(36)}-${(sheetSeq++).toString(36)}`;
