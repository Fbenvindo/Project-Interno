// Editor em planta 2D: mostra o pavimento cortado (IFC + pontos + trechos) e
// alimenta o mesmo modo de edição usado na vista 3D (locação e traçado), com
// encaixe em faces de parede e cota real de teto/piso obtida por raio no modelo.
import { findSnap, orthoSnap, snapGeometry, SNAP_LABEL, type SnapMode } from "../../../core/osnap";
import { activeSnaps, useDrawAids } from "../desenho/drawAids";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { pullBoxes } from "../../../core/conduits";
import { setCursor } from "../coords/cursor";
import { DISCIPLINES } from "../../../core/disciplines";
import type { SurfaceHit } from "../../../core/placement";
import { buildPlan, boundsOf, type BeamOptions } from "../../../core/plan/build";
import type { Prim } from "../../../core/plan/drawing";
import type { P2 } from "../../../core/plan/section";
import { snapToWall, wallEdges, type WallSnap } from "../../../core/plan/snap";
import { closestOnSegment, distance, runIdOfElement, runSegments } from "../../../core/runs";
import { spaceAt } from "../../../core/spaces";
import type { ElementInfo, Vec3 } from "../../../core/types";
import type { LoadedModel } from "../../../ifc/loadIfc";
import type { PointsStore } from "../locacao/usePointsStore";
import type { PointerContext, PreviewItem, Viewer } from "../viewer/Viewer";
import { draftDistance, isDraftId } from "../../../core/draft";
import type { PlanTool } from "./planTool";
import { applyHalftone, viewFilter, viewMarkers, type ViewDef } from "../../../core/views";
import { buildSection } from "../../../core/plan/elevation";
import { draftPrims } from "../../../core/draft";
import type { Discipline } from "../../../core/types";

interface Props {
  viewer: Viewer;
  model: LoadedModel;
  store: PointsStore;
  storey: string;
  cutHeight: number;
  selection: number[];
  elementById: Map<number, ElementInfo>;
  onPick: (id: number | null, additive: boolean) => void;
  /** Janela de seleção: ids encontrados; additive = somar à seleção atual (Ctrl/Shift). */
  onPickMany?: (ids: number[], additive: boolean) => void;
  /** Fundo preto: a planta é desenhada invertida (traço claro). */
  dark?: boolean;
  /** Muda a cada pedido de enquadramento vindo de fora (faixa de ferramentas). */
  fitSignal?: number;
  /** Ferramenta de desenho/modificação/vista ativa (substitui a seleção comum). */
  planTool?: PlanTool | null;
  /** Vista aberta (null = planta de trabalho do pavimento). */
  viewDef?: ViewDef | null;
  /** Disciplinas do projeto (filtro das vistas de documentação). */
  projectDisciplines?: Discipline[];
  /** Vigas em projeção (piso/teto) e seus textos. */
  beams?: BeamOptions;
  /** Arrastar com o botão direito sobre um elemento: mover a seleção (deslocamento em planta, m). */
  onMoveBy?: (d: P2) => void;
}

type ViewBox = { x: number; y: number; w: number; h: number };

const ALL = new Set(DISCIPLINES.map((d) => d.id));
const LABELS = { tags: true, circuits: true, power: true, sizes: true };
const CEILING_TYPES = new Set(["IFCSLAB", "IFCCOVERING", "IFCROOF", "IFCBEAM", "IFCPLATE"]);
const FLOOR_TYPES = new Set(["IFCSLAB", "IFCCOVERING", "IFCRAMP", "IFCSTAIRFLIGHT"]);
const SNAP_PX = 22;

/** Marcador do encaixe (formas como no CAD) com o nome, e linha de alinhamento no ortogonal. */
function snapMarkerSvg(kind: SnapMode, p: P2, ref: P2 | undefined, px: number): string {
  const [x, y0] = p;
  const y = -y0;
  const k = 6 * px;
  const st = `fill="none" stroke="#f59e0b" stroke-width="2" vector-effect="non-scaling-stroke"`;
  const n = (v: number) => v.toFixed(4);
  let m = "";
  switch (kind) {
    case "fim":
      m = `<rect x="${n(x - k)}" y="${n(y - k)}" width="${n(2 * k)}" height="${n(2 * k)}" ${st}/>`;
      break;
    case "meio":
      m = `<polygon points="${n(x - k)},${n(y + k)} ${n(x + k)},${n(y + k)} ${n(x)},${n(y - k)}" ${st}/>`;
      break;
    case "centro":
      m = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(k)}" ${st}/>`;
      break;
    case "quadrante":
      m = `<polygon points="${n(x)},${n(y - k)} ${n(x + k)},${n(y)} ${n(x)},${n(y + k)} ${n(x - k)},${n(y)}" ${st}/>`;
      break;
    case "intersecao":
      m = `<path d="M${n(x - k)} ${n(y - k)} L${n(x + k)} ${n(y + k)} M${n(x - k)} ${n(y + k)} L${n(x + k)} ${n(y - k)}" ${st}/>`;
      break;
    case "perpendicular":
      m = `<path d="M${n(x - k)} ${n(y - k)} V${n(y + k)} H${n(x + k)} M${n(x - k)} ${n(y)} H${n(x)} V${n(y + k)}" ${st}/>`;
      break;
    case "tangente":
      m = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(k * 0.8)}" ${st}/><path d="M${n(x - k * 1.3)} ${n(y - k * 0.8)} H${n(x + k * 1.3)}" ${st}/>`;
      break;
    case "proximo":
      m = `<path d="M${n(x - k)} ${n(y - k)} H${n(x + k)} L${n(x - k)} ${n(y + k)} H${n(x + k)} Z" ${st}/>`;
      break;
    case "insercao":
      m = `<rect x="${n(x - k)}" y="${n(y - k)}" width="${n(2 * k)}" height="${n(2 * k)}" ${st}/><path d="M${n(x - k)} ${n(y)} H${n(x + k)} M${n(x)} ${n(y - k)} V${n(y + k)}" ${st}/>`;
      break;
  }
  if (ref) {
    m += `<line x1="${n(ref[0])}" y1="${n(-ref[1])}" x2="${n(x)}" y2="${n(y)}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
    m += `<circle cx="${n(ref[0])}" cy="${n(-ref[1])}" r="${n(k * 0.5)}" ${st}/>`;
  }
  const fs = 11 * px;
  m += `<text x="${n(x + k * 1.6)}" y="${n(y + k * 2.6)}" font-size="${n(fs)}" font-family="Arial, sans-serif" fill="#b45309" stroke="#fff" stroke-width="3" paint-order="stroke" vector-effect="non-scaling-stroke">${SNAP_LABEL[kind]}${ref ? " (alinhado)" : ""}</text>`;
  return m;
}
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Primitivas em coordenadas de modelo (Y invertido para o SVG); traços em px. */
function primsToSvg(prims: Prim[]): string {
  const P = ([x, y]: P2) => `${f3(x)},${f3(-y)}`;
  const px = (w: number) => Math.max(0.6, w * 4).toFixed(2);
  return prims
    .map((p) => {
      const id = (p.id != null ? ` data-id="${p.id}"` : "") + (p.opacity != null ? ` opacity="${p.opacity}"` : "");
      const dash = "dashdot" in p && p.dashdot ? ` stroke-dasharray="9 3 2 3"` : "dashed" in p && p.dashed ? ` stroke-dasharray="6 4"` : "";
      const stroke = `stroke="${p.color}" vector-effect="non-scaling-stroke"`;
      if (p.t === "line") return `<line x1="${f3(p.a[0])}" y1="${f3(-p.a[1])}" x2="${f3(p.b[0])}" y2="${f3(-p.b[1])}" ${stroke} stroke-width="${px(p.weight)}"${dash}${id}/>`;
      if (p.t === "poly")
        return `<${p.closed ? "polygon" : "polyline"} points="${p.pts.map(P).join(" ")}" fill="${p.fill ?? "none"}" ${stroke} stroke-width="${px(p.weight)}"${dash}${id}/>`;
      if (p.t === "circle") return `<circle cx="${f3(p.c[0])}" cy="${f3(-p.c[1])}" r="${f3(p.r)}" fill="${p.fill ?? "none"}" ${stroke} stroke-width="${px(p.weight)}"${id}/>`;
      const rot = p.angle ? ` transform="rotate(${f3((-p.angle * 180) / Math.PI)} ${f3(p.p[0])} ${f3(-p.p[1])})"` : "";
      const t = p.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return `<text x="${f3(p.p[0])}" y="${f3(-p.p[1])}" font-size="${f3(p.height)}" text-anchor="${p.anchor}" dominant-baseline="central" fill="${p.color}" font-family="Arial, sans-serif"${rot}${id}>${t}</text>`;
    })
    .join("");
}

export function PlanEditor({ viewer, model, store, storey, cutHeight, selection, elementById, onPick, onPickMany, dark, fitSignal, planTool, viewDef = null, projectDisciplines = [], beams, onMoveBy }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cs = model.coordinates;
  const level = model.storeyLevels.find((s) => s.name === storey)?.level ?? 0;
  const meshes = useMemo(() => new Map(model.meshes.map((m) => [m.expressID, m])), [model]);

  // Vista: trabalho (tudo) ou documentação (disciplinas do projeto + referências em meio-tom).
  const filter = useMemo(() => viewFilter(viewDef, projectDisciplines), [viewDef, projectDisciplines]);
  const isSection = viewDef?.kind === "corte" && !!viewDef.cut;
  const SCALE = viewDef?.scale ?? 50;
  const draftView = viewDef && !(viewDef.kind === "planta" && viewDef.section === "trabalho") ? viewDef.id : null;
  const labels = viewDef?.labels ?? LABELS;
  const disciplines = viewDef ? filter.show : ALL;

  // Base (modelo cortado) e instalações, em camadas separadas para não recortar o IFC a cada ponto.
  const base = useMemo(() => {
    if (isSection)
      return buildSection({
        elements: model.elements,
        meshes,
        cs,
        storeyLevels: model.storeyLevels,
        points: store.points,
        runs: store.runs,
        disciplines,
        cut: viewDef!.cut!,
        scale: SCALE,
        name: viewDef!.name,
        labels,
      });
    return buildPlan({ elements: model.elements, meshes, cs, storeyLevels: model.storeyLevels, storey, cutHeight, points: [], runs: [], scale: SCALE, disciplines, labels, beams });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, meshes, cs, storey, cutHeight, isSection, isSection ? store.points : null, isSection ? store.runs : null, viewDef?.cut, SCALE, disciplines, beams?.mode, beams?.show, beams?.text]);
  const mep = useMemo(() => {
    if (isSection) {
      const prims = store.drafts.filter((d) => d.view === viewDef!.id).flatMap((d) => draftPrims(d, SCALE));
      return { prims, bounds: null, legend: [], scale: SCALE, storey, cutHeight };
    }
    const d = buildPlan({
        elements: [],
        meshes: new Map(),
        cs,
        storeyLevels: model.storeyLevels,
        storey,
        cutHeight,
        points: store.points,
        runs: store.runs,
        scale: SCALE,
        disciplines,
        labels,
        spaces: model.spaces,
        boxes: pullBoxes(store.runs, store.points),
        drafts: store.drafts,
        draftView,
      });
    let prims = d.prims;
    if (viewDef?.section === "documentacao" && viewDef.kind === "planta") prims = [...prims, ...viewMarkers(store.views, storey, SCALE)];
    if (viewDef?.section === "documentacao" && viewDef.workNotes)
      prims = [...prims, ...store.drafts.filter((x) => !x.view && x.storey === storey).flatMap((x) => draftPrims(x, SCALE).map((q) => ({ ...q, id: undefined })))];
    return { ...d, prims };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, model, storey, cutHeight, store.points, store.runs, store.drafts, store.views, isSection, viewDef, SCALE, disciplines, draftView]);
  const layersRef = useRef({ base: base.prims, mep: mep.prims, ready: false });
  layersRef.current = { base: base.prims, mep: mep.prims, ready: base.prims.length + mep.prims.length > 0 };
  const edges = useMemo(() => wallEdges(base.prims), [base]);
  const baseSvg = useMemo(() => primsToSvg(applyHalftone(base.prims, filter)), [base, filter]);
  const mepSvg = useMemo(() => primsToSvg(applyHalftone(mep.prims, filter)), [mep, filter]);

  // ---- Vista (zoom e deslocamento) -----------------------------------------------------
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: -10, w: 20, h: 10 });
  const fit = useCallback(() => {
    const el = host.current;
    const L = layersRef.current;
    const b = viewDef?.kind === "ampliacao" && viewDef.region ? { min: viewDef.region.min, max: viewDef.region.max } : boundsOf([...L.base, ...L.mep]);
    if (!el || !b) return;
    const aspect = el.clientWidth / Math.max(el.clientHeight, 1);
    let w = (b.max[0] - b.min[0]) * 1.1 + 1;
    let h = (b.max[1] - b.min[1]) * 1.1 + 1;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = -(b.min[1] + b.max[1]) / 2;
    setVb({ x: cx - w / 2, y: cy - h / 2, w, h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDef?.id, viewDef?.region, storey, isSection, model, cutHeight, layersRef.current.ready]);
  useEffect(fit, [fit]);
  useEffect(() => {
    if (fitSignal) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // O SVG encaixa o viewBox centralizado (preserveAspectRatio "meet"): quando a área muda de
  // tamanho (um painel abre), sobram faixas e a escala é a menor das duas.
  const pxScale = (r: { width: number; height: number }) => Math.min(r.width / vb.w, r.height / vb.h) || 1;
  const toModel = (clientX: number, clientY: number): P2 => {
    const r = host.current!.getBoundingClientRect();
    const k = pxScale(r);
    const x = vb.x + vb.w / 2 + (clientX - r.left - r.width / 2) / k;
    const y = vb.y + vb.h / 2 + (clientY - r.top - r.height / 2) / k;
    return [x, -y];
  };
  const metersPerPx = () => 1 / pxScale(host.current?.getBoundingClientRect() ?? { width: 1, height: 1 });

  // ---- Conversões planta ⇄ cena ------------------------------------------------------------
  const planToWorld = useCallback((p: P2, y: number): Vec3 => cs.ifcToWorld([p[0], p[1], cs.worldToIfc([0, y, 0])[2]]), [cs]);
  const planDirToWorld = useCallback(
    (d: P2): Vec3 => {
      const a = planToWorld([0, 0], 0);
      const b = planToWorld(d, 0);
      return [b[0] - a[0], 0, b[2] - a[2]];
    },
    [planToWorld],
  );
  const toPlan = useCallback((v: Vec3): P2 => {
    const p = cs.worldToIfc(v);
    return [p[0], p[1]];
  }, [cs]);

  // ---- Modo de edição (o mesmo da vista 3D) --------------------------------------------------
  const [, force] = useState(0);
  useEffect(() => viewer.onPlacementChange(() => force((n) => n + 1)), [viewer]);
  const handler = viewer.getPlacementHandler();
  const [hover, setHover] = useState<{ previews: PreviewItem[]; snap: WallSnap | null } | null>(null);
  const lastPointer = useRef<{ x: number; y: number; shift: boolean } | null>(null);

  /** Traduz o cursor na planta para a superfície e o contexto esperados pelo modo de edição. */
  const probe = useCallback(
    (clientX: number, clientY: number, shift: boolean): { hit: SurfaceHit | null; ctx: PointerContext; snap: WallSnap | null } => {
      const p = toModel(clientX, clientY);
      const h = viewer.getPlacementHandler();
      const surface = h?.surface?.() ?? "teto";
      const el = document.elementFromPoint(clientX, clientY)?.closest("[data-id]");
      const rawId = el ? Number(el.getAttribute("data-id")) : NaN;
      let objectId = Number.isFinite(rawId) && rawId < 0 ? rawId : null;
      if (objectId == null) {
        // Tolerância: ponto locado do pavimento mais próximo, a poucos pixels do cursor.
        const tol = SNAP_PX * 0.6 * metersPerPx();
        let best: { id: number; d: number } | null = null;
        for (const pt of store.points) {
          if (pt.storey !== storey) continue;
          const q = toPlan(pt.position);
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d <= tol && (!best || d < best.d)) best = { id: pt.id, d };
        }
        if (best) objectId = best.id;
      }
      let objectPoint: Vec3 | null = null;
      if (objectId != null) {
        const pt = store.points.find((x) => x.id === objectId);
        const runId = runIdOfElement(objectId);
        const run = runId != null ? store.runs.find((r) => r.id === runId) : undefined;
        if (pt) objectPoint = pt.position;
        else if (run) {
          // Ponto do trecho mais próximo do cursor (na projeção em planta).
          let best: { d: number; v: Vec3 } | null = null;
          for (const sg of runSegments(run)) {
            const a = toPlan(sg.start);
            const b = toPlan(sg.end);
            const { t } = closestOnSegment([p[0], p[1], 0], [a[0], a[1], 0], [b[0], b[1], 0]);
            const v: Vec3 = sg.start.map((c, i) => c + (sg.end[i] - c) * t) as Vec3;
            const d = distance([p[0], p[1], 0], [...toPlan(v), 0]);
            if (!best || d < best.d) best = { d, v };
          }
          objectPoint = best?.v ?? null;
        }
      }
      const origin = planToWorld(p, level + 1);
      let hit: SurfaceHit | null = null;
      let snap: WallSnap | null = null;
      if (surface === "parede") {
        snap = snapToWall(p, edges, SNAP_PX * metersPerPx());
        if (snap) hit = { point: planToWorld(snap.point, level + 1), normal: planDirToWorld(snap.normal) };
      } else if (surface === "teto") {
        hit = viewer.castRay(origin, [0, 1, 0], 15, (n, id) => n[1] < -0.7 && CEILING_TYPES.has(elementById.get(id)?.ifcType ?? ""), true);
        if (!hit) {
          const room = spaceAt(model.spaces, toPlan, [origin[0], level + 0.5, origin[2]], 1);
          hit = { point: planToWorld(p, room ? room.topY : level + 3), normal: [0, -1, 0] };
        }
      } else {
        hit = viewer.castRay(origin, [0, -1, 0], 3, (n, id) => n[1] > 0.7 && FLOOR_TYPES.has(elementById.get(id)?.ifcType ?? ""), true) ?? {
          point: planToWorld(p, level),
          normal: [0, 1, 0],
        };
      }
      const top = planToWorld(p, level + 100);
      return { hit, snap, ctx: { ray: { origin: top, direction: [0, -1, 0] }, shift, objectId, objectPoint } };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewer, store.points, store.runs, edges, level, vb, elementById, model.spaces, planToWorld, planDirToWorld, toPlan, storey],
  );

  const updateHover = useCallback(() => {
    const h = viewer.getPlacementHandler();
    const lp = lastPointer.current;
    if (!h || !lp) {
      setHover(null);
      return;
    }
    const { hit, ctx, snap } = probe(lp.x, lp.y, lp.shift);
    setHover({ previews: h.hover(hit, ctx), snap });
  }, [viewer, probe]);

  // Mudanças de configuração no painel (altura, componente…) atualizam a pré-visualização.
  useEffect(() => {
    updateHover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler, store.points, store.runs]);
  useEffect(() => viewer.onPlacementChange(() => requestAnimationFrame(updateHover)), [viewer, updateHover]);

  // ---- Ferramentas de desenho: encaixe, seleção e pré-visualização ---------------------------------
  const toolRef = useRef(planTool);
  toolRef.current = planTool;
  const storeRef = useRef(store);
  storeRef.current = store;
  const storeyDrafts = useMemo(
    () => store.drafts.filter((d) => (d.view ?? null) === draftView && (isSection || d.storey === storey)),
    [store.drafts, storey, draftView, isSection],
  );
  /** Extensão em planta de cada elemento (para a seleção por janela). */
  const idBounds = useMemo(() => {
    const m = new Map<number, [number, number, number, number]>();
    const grow = (id: number, x: number, y: number) => {
      const b = m.get(id);
      if (!b) m.set(id, [x, y, x, y]);
      else {
        b[0] = Math.min(b[0], x);
        b[1] = Math.min(b[1], y);
        b[2] = Math.max(b[2], x);
        b[3] = Math.max(b[3], y);
      }
    };
    for (const p of [...base.prims, ...mep.prims]) {
      if (p.id == null) continue;
      if (p.t === "line") (grow(p.id, ...p.a), grow(p.id, ...p.b));
      else if (p.t === "poly") p.pts.forEach((q) => grow(p.id!, ...q));
      else if (p.t === "circle") (grow(p.id, p.c[0] - p.r, p.c[1] - p.r), grow(p.id, p.c[0] + p.r, p.c[1] + p.r));
      else (grow(p.id, p.p[0] - p.height, p.p[1] - p.height / 2), grow(p.id, p.p[0] + p.height, p.p[1] + p.height / 2));
    }
    return m;
  }, [base, mep]);

  type Resolved = { p: P2; snapped: boolean; kind?: SnapMode; ref?: P2 };
  const [toolCursor, setToolCursor] = useState<Resolved | null>(null);
  const [boxRect, setBoxRect] = useState<{ a: P2; b: P2 } | null>(null);

  // ---- Encaixe a objetos e ortogonal (barra de status: ORTO / Encaixe) -----------------------
  const aids = useDrawAids();
  const aidsRef = useRef(aids);
  aidsRef.current = aids;
  const snapGeom = useMemo(
    () =>
      snapGeometry(
        [...base.prims, ...mep.prims],
        storeyDrafts,
        isSection ? [] : store.points.filter((pt) => pt.storey === storey).map((pt) => toPlan(pt.position)),
        // Os desenhos entram pela entidade (arcos e círculos exatos), não pelas linhas geradas.
        (q) => q.id != null && isDraftId(q.id),
      ),
    [base, mep, storeyDrafts, store.points, storey, toPlan, isSection],
  );
  /** Ponto com encaixe e ortogonal; `anchor` é o ponto anterior do comando (base do ortogonal). */
  const resolveWith = (clientX: number, clientY: number, anchor: P2 | null | undefined, shift: boolean): Resolved => {
    const p = toModel(clientX, clientY);
    const a = aidsRef.current;
    const modes = activeSnaps(a);
    const tol = SNAP_PX * 0.6 * metersPerPx();
    // Shift inverte o ortogonal enquanto está pressionado.
    if (anchor && a.ortho !== shift) {
      const r = orthoSnap(p, anchor, snapGeom, modes, tol);
      return { p: r.p, snapped: !!r.snap, kind: r.snap?.kind, ref: r.snap && (r.snap.p[0] !== r.p[0] || r.snap.p[1] !== r.p[1]) ? r.snap.p : undefined };
    }
    const sn = findSnap(p, snapGeom, modes, tol, anchor);
    return sn ? { p: sn.p, snapped: true, kind: sn.kind } : { p, snapped: false };
  };
  const resolvePoint = (clientX: number, clientY: number, shift: boolean): Resolved => {
    const t = toolRef.current;
    if (!t?.snap) return { p: toModel(clientX, clientY), snapped: false };
    return resolveWith(clientX, clientY, t.anchor, shift);
  };

  /** Ponto do cursor com encaixe (para o arraste de mover, fora dos comandos). */
  const resolvePointSelect = (clientX: number, clientY: number, anchor?: P2, shift = false): P2 => resolveWith(clientX, clientY, anchor, shift).p;

  const hitAt = (clientX: number, clientY: number, p: P2): number | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest("[data-id]");
    const raw = el ? Number(el.getAttribute("data-id")) : NaN;
    if (Number.isFinite(raw)) return raw;
    const tol = SNAP_PX * 0.4 * metersPerPx();
    let best: { id: number; d: number } | null = null;
    for (const d of storeyDrafts) {
      const k = draftDistance(d, p, SCALE);
      if (k <= tol && (!best || k < best.d)) best = { id: d.id, d: k };
    }
    for (const pt of store.points) {
      if (pt.storey !== storey || isSection) continue;
      const q = toPlan(pt.position);
      const k = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (k <= tol * 1.5 && (!best || k < best.d)) best = { id: pt.id, d: k };
    }
    // Trechos (linhas finas): tolerância em volta do eixo, para não exigir o pixel exato.
    const segD = (a: P2, b: P2) => {
      const { t } = closestOnSegment([p[0], p[1], 0], [a[0], a[1], 0], [b[0], b[1], 0]);
      return Math.hypot(a[0] + (b[0] - a[0]) * t - p[0], a[1] + (b[1] - a[1]) * t - p[1]);
    };
    for (const q of mep.prims) {
      if (q.id == null || q.id > -1000000) continue;
      let k = Infinity;
      if (q.t === "line") k = segD(q.a, q.b);
      else if (q.t === "poly") for (let i = 0; i + 1 < q.pts.length; i++) k = Math.min(k, segD(q.pts[i], q.pts[i + 1]));
      if (k <= tol && (!best || k < best.d)) best = { id: q.id, d: k };
    }
    return best?.id ?? null;
  };

  const edgeAt = (p: P2): [P2, P2] | null => {
    const tol = SNAP_PX * 0.5 * metersPerPx();
    let best: { e: [P2, P2]; d: number } | null = null;
    for (const e of edges) {
      const { t } = closestOnSegment([p[0], p[1], 0], [e.a[0], e.a[1], 0], [e.b[0], e.b[1], 0]);
      const q: P2 = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= tol && (!best || d < best.d)) best = { e: [e.a, e.b], d };
    }
    return best?.e ?? null;
  };

  const idsInBox = (a: P2, b: P2, crossing: boolean): number[] => {
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    const out: number[] = [];
    for (const [id, bb] of idBounds) {
      const inside = bb[0] >= x0 && bb[2] <= x1 && bb[1] >= y0 && bb[3] <= y1;
      const touches = bb[0] <= x1 && bb[2] >= x0 && bb[1] <= y1 && bb[3] >= y0;
      if (crossing ? touches : inside) out.push(id);
    }
    return out;
  };

  // Enter conclui, Esc cancela (fora de campos de texto).
  useEffect(() => {
    if (!planTool) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") return (e.preventDefault(), e.shiftKey ? storeRef.current.redo() : storeRef.current.undo());
      if (mod && e.key.toLowerCase() === "y") return (e.preventDefault(), storeRef.current.redo());
      // Esc é tratado pelo app (encerra o comando e volta a Selecionar).
      if (e.key === "Enter") (e.preventDefault(), toolRef.current?.finish());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [!!planTool]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ---- Ponteiro ---------------------------------------------------------------------------------
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean; box: boolean; start: P2 } | null>(null);
  const raf = useRef(0);
  // Selecionar (sem comando): clique seleciona, arrastar desenha a janela de seleção.
  // Botão do meio (ou, durante comandos de desenho/locação, o esquerdo) arrasta a vista.
  const selectMode = !planTool && !handler;
  // Botão direito sobre um elemento (em Selecionar): arrasta a seleção para movê-la.
  const [moveDrag, setMoveDrag] = useState<{ a: P2; b: P2 } | null>(null);
  const moveDragRef = useRef<{ a: P2 } | null>(null);
  // O ortogonal (botão ORTO, Shift inverte) já vem do encaixe; aqui só arredonda a 10 mm.
  const moveDelta = (a: P2, b: P2): P2 => [Math.round((b[0] - a[0]) * 100) / 100, Math.round((b[1] - a[1]) * 100) / 100];
  const onPointerDown = (e: PointerEvent) => {
    if (edit) return;
    if (e.button === 2 && selectMode && onMoveBy && !isSection) {
      const pm = toModel(e.clientX, e.clientY);
      const id = hitAt(e.clientX, e.clientY, pm);
      if (id != null) {
        if (!selection.includes(id)) onPick(id, false);
        moveDragRef.current = { a: resolvePointSelect(e.clientX, e.clientY) };
        host.current?.setPointerCapture?.(e.pointerId);
        return;
      }
    }
    if (e.button === 1) e.preventDefault();
    const box = e.button === 0 && (planTool ? planTool.selecting : selectMode);
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false, box, start: toModel(e.clientX, e.clientY) };
    // O soltar do botão volta para cá mesmo sobre botões e sobreposições.
    host.current?.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    // Coordenadas do projeto do cursor (para a barra de status), na cota do piso do pavimento.
    const pm = toModel(e.clientX, e.clientY);
    setCursor(isSection ? null : [pm[0], pm[1], cs.worldToIfc([0, level, 0])[2]]);
    if (moveDragRef.current && e.buttons & 2) {
      const b = resolvePointSelect(e.clientX, e.clientY, moveDragRef.current.a, e.shiftKey);
      const dd = moveDelta(moveDragRef.current.a, b);
      setMoveDrag({ a: moveDragRef.current.a, b: [moveDragRef.current.a[0] + dd[0], moveDragRef.current.a[1] + dd[1]] });
      return;
    }
    const d = drag.current;
    if (d && (e.buttons & 1 || e.buttons & 4)) {
      const r = host.current!.getBoundingClientRect();
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved && d.box) {
        if (e.buttons & 1) setBoxRect({ a: d.start, b: pm });
        return;
      }
      else if (d.moved) {
        const k = Math.min(r.width / d.vb.w, r.height / d.vb.h) || 1;
        setVb({ ...d.vb, x: d.vb.x - dx / k, y: d.vb.y - dy / k });
      }
      return;
    }
    if (planTool) {
      const { clientX, clientY, shiftKey } = e;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => host.current && setToolCursor(resolvePoint(clientX, clientY, shiftKey)));
      return;
    }
    lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(updateHover);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (moveDragRef.current) {
      const a = moveDragRef.current.a;
      moveDragRef.current = null;
      setMoveDrag(null);
      const dd = moveDelta(a, resolvePointSelect(e.clientX, e.clientY, a, e.shiftKey));
      if (Math.hypot(dd[0], dd[1]) >= 0.005) onMoveBy?.(dd);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (planTool) {
      if (d?.box && d.moved) {
        const b = toModel(e.clientX, e.clientY);
        setBoxRect(null);
        planTool.box?.(idsInBox(d.start, b, b[0] < d.start[0]), { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
        return;
      }
      if (!d || d.moved) return;
      if (e.button === 2) return planTool.finish();
      if (e.button !== 0) return;
      const r = resolvePoint(e.clientX, e.clientY, e.shiftKey);
      const raw = toModel(e.clientX, e.clientY);
      planTool.click(r.p, { id: hitAt(e.clientX, e.clientY, raw), edge: edgeAt(raw), shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      return;
    }
    if (d?.box && d.moved) {
      const b = toModel(e.clientX, e.clientY);
      setBoxRect(null);
      onPickMany?.(idsInBox(d.start, b, b[0] < d.start[0]), e.ctrlKey || e.metaKey || e.shiftKey);
      return;
    }
    if (!d || d.moved || e.button !== 0) return;
    const h = isSection ? null : viewer.getPlacementHandler();
    if (h) {
      const { hit, ctx } = probe(e.clientX, e.clientY, e.shiftKey);
      h.click(hit, ctx);
      lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      requestAnimationFrame(updateHover);
      return;
    }
    const id = hitAt(e.clientX, e.clientY, toModel(e.clientX, e.clientY));
    onPick(id, e.ctrlKey || e.metaKey || e.shiftKey);
  };

  // ---- Edição de texto no local (duplo clique num texto, ou comando Texto) -----------------------
  const [edit, setEdit] = useState<{ id: number; at: P2; value: string } | null>(null);
  const textEdit = planTool?.textInput ?? null;
  const editDraftText = (clientX: number, clientY: number): boolean => {
    const id = hitAt(clientX, clientY, toModel(clientX, clientY));
    const d = id != null ? store.drafts.find((x) => x.id === id) : undefined;
    if (!d || d.kind !== "texto") return false;
    setEdit({ id: d.id, at: d.p, value: d.text });
    return true;
  };
  const toScreen = (p: P2) => {
    const el = host.current;
    if (!el) return { left: 0, top: 0 };
    const W = el.clientWidth;
    const H = el.clientHeight;
    const k = pxScale({ width: W, height: H });
    return { left: W / 2 + (p[0] - vb.x - vb.w / 2) * k, top: H / 2 + (-p[1] - vb.y - vb.h / 2) * k };
  };
  const onWheel = (e: WheelEvent) => {
    const [mx, my] = toModel(e.clientX, e.clientY);
    const p = { x: mx, y: -my };
    const k = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(Math.max(vb.w * k, 0.5), 2000);
    const s = w / vb.w;
    setVb({ x: p.x - (p.x - vb.x) * s, y: p.y - (p.y - vb.y) * s, w, h: vb.h * s });
  };

  // ---- Sobreposições: pré-visualização, ambientes destacados, encaixe --------------------------
  const previewSvg = (items: PreviewItem[]) =>
    items
      .map((it) => {
        const color = it.ok ? "#2fbf71" : "#ef5350";
        const common = `fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"`;
        if (it.kind === "segmento") {
          const a = toPlan(it.start);
          const b = toPlan(it.end);
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3) return `<circle cx="${f3(a[0])}" cy="${f3(-a[1])}" r="${f3(Math.max(it.width, 0.06))}" ${common}/>`;
          return `<line x1="${f3(a[0])}" y1="${f3(-a[1])}" x2="${f3(b[0])}" y2="${f3(-b[1])}" stroke="${color}" stroke-opacity="0.8" stroke-width="${f3(Math.max(it.width, 0.03))}" stroke-linecap="round"/>`;
        }
        if (it.kind === "no") {
          const c = toPlan(it.position);
          return `<circle cx="${f3(c[0])}" cy="${f3(-c[1])}" r="${f3(Math.max(it.width * 0.7, 0.03))}" ${common}/>`;
        }
        const c = toPlan(it.position);
        const [w, d] = it.size;
        if (it.shape === "cilindro") return `<circle cx="${f3(c[0])}" cy="${f3(-c[1])}" r="${f3(w / 2)}" ${common}/>`;
        const ax = toPlan([it.position[0] + Math.cos(it.rotation), it.position[1], it.position[2] - Math.sin(it.rotation)]);
        const u: P2 = [ax[0] - c[0], ax[1] - c[1]];
        const v: P2 = [-u[1], u[0]];
        const corner = (su: number, sv: number): string => `${f3(c[0] + (u[0] * su * w + v[0] * sv * d) / 2)},${f3(-(c[1] + (u[1] * su * w + v[1] * sv * d) / 2))}`;
        return `<polygon points="${[corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].join(" ")}" ${common}/>`;
      })
      .join("");

  const outlines = isSection
    ? ""
    : viewer
    .getSpaceOutlines()
    .map(({ points, selected }) => {
      const pts = points.map((v) => toPlan(v)).map(([x, y]) => `${f3(x)},${f3(-y)}`).join(" ");
      return `<polygon points="${pts}" fill="${selected ? "#00b8d4" : "none"}" fill-opacity="0.12" stroke="${selected ? "#00a3c4" : "#9aa4b2"}" stroke-width="${selected ? 2 : 1}" stroke-dasharray="${selected ? "" : "4 3"}" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    })
    .join("");

  const snapMarker = hover?.snap
    ? (() => {
        const s = hover.snap;
        const L = 18 * metersPerPx();
        return `<line x1="${f3(s.point[0])}" y1="${f3(-s.point[1])}" x2="${f3(s.point[0] + s.normal[0] * L)}" y2="${f3(-(s.point[1] + s.normal[1] * L))}" stroke="#00a3c4" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${f3(s.point[0])}" cy="${f3(-s.point[1])}" r="${f3(4 * metersPerPx())}" fill="#00a3c4"/>`;
      })()
    : "";

  const highlight = selection.length
    ? `${selection.map((id) => `#editor-planta [data-id="${id}"]`).join(",")}{stroke:#00a3c4 !important}` +
      `${selection.map((id) => `#editor-planta text[data-id="${id}"]`).join(",")}{fill:#00a3c4 !important;stroke:none !important}`
    : "";

  const toolSvg = planTool
    ? (() => {
        const px = metersPerPx();
        let out = primsToSvg(planTool.preview(toolCursor?.p ?? null));
        if (toolCursor?.snapped && toolCursor.kind) out += snapMarkerSvg(toolCursor.kind, toolCursor.p, toolCursor.ref, px);
        if (toolCursor && planTool.snap) {
          const [x, y] = toolCursor.p;
          const k = 14 * px;
          out += `<line x1="${f3(x - k)}" y1="${f3(-y)}" x2="${f3(x + k)}" y2="${f3(-y)}" stroke="#0ea5e9" stroke-width="1" vector-effect="non-scaling-stroke"/><line x1="${f3(x)}" y1="${f3(-y - k)}" x2="${f3(x)}" y2="${f3(-y + k)}" stroke="#0ea5e9" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
        }
        return out;
      })()
    : "";

  return (
    <div
      ref={host}
      className={`plan-editor ${handler || planTool ? "editing" : ""} ${planTool?.selecting || selectMode ? "selecting" : ""} ${dark ? "dark" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => ((lastPointer.current = null), setHover(null), setCursor(null), setToolCursor(null))}
      onWheel={onWheel}
      onContextMenu={(e) => (planTool || selectMode) && e.preventDefault()}
      onDoubleClick={(e) => {
        if (planTool) return planTool.finish();
        if (handler) return handler.doubleClick?.();
        if (!editDraftText(e.clientX, e.clientY)) fit();
      }}
    >
      <style>{highlight}</style>
      <svg id="editor-planta" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" height="100%">
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#ffffff" />
        <g dangerouslySetInnerHTML={{ __html: baseSvg }} />
        <g dangerouslySetInnerHTML={{ __html: outlines }} />
        <g dangerouslySetInnerHTML={{ __html: mepSvg }} />
        <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: previewSvg(viewer.getStaticPreview()) + previewSvg(hover?.previews ?? []) + snapMarker }} />
        {viewDef?.kind === "ampliacao" && viewDef.region && (
          <path
            pointerEvents="none"
            fillRule="evenodd"
            fill="#6b7280"
            fillOpacity={0.28}
            d={`M${vb.x - vb.w} ${vb.y - vb.h}h${vb.w * 3}v${vb.h * 3}h${-vb.w * 3}Z M${viewDef.region.min[0]} ${-viewDef.region.max[1]}H${viewDef.region.max[0]}V${-viewDef.region.min[1]}H${viewDef.region.min[0]}Z`}
          />
        )}
        <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: toolSvg }} />
        {moveDrag && (
          <g pointerEvents="none">
            <line x1={moveDrag.a[0]} y1={-moveDrag.a[1]} x2={moveDrag.b[0]} y2={-moveDrag.b[1]} stroke="#7c3aed" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            <circle cx={moveDrag.b[0]} cy={-moveDrag.b[1]} r={5 * metersPerPx()} fill="#7c3aed" />
            <text x={moveDrag.b[0] + 8 * metersPerPx()} y={-moveDrag.b[1] - 8 * metersPerPx()} fontSize={13 * metersPerPx()} fill="#5b21b6" fontFamily="Arial">
              {`Δx ${(moveDrag.b[0] - moveDrag.a[0]).toFixed(2).replace(".", ",")} · Δy ${(moveDrag.b[1] - moveDrag.a[1]).toFixed(2).replace(".", ",")} m`}
            </text>
          </g>
        )}
        {boxRect &&
          (() => {
            const crossing = boxRect.b[0] < boxRect.a[0];
            const color = crossing ? "#16a34a" : "#2563eb";
            return (
              <rect
                pointerEvents="none"
                x={Math.min(boxRect.a[0], boxRect.b[0])}
                y={-Math.max(boxRect.a[1], boxRect.b[1])}
                width={Math.abs(boxRect.b[0] - boxRect.a[0])}
                height={Math.abs(boxRect.b[1] - boxRect.a[1])}
                fill={color}
                fillOpacity={0.08}
                stroke={color}
                strokeWidth={1.2}
                strokeDasharray={crossing ? "6 4" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            );
          })()}
      </svg>
      {(edit || textEdit) &&
        (() => {
          const at = edit ? edit.at : textEdit!.at;
          const pos = toScreen(at);
          const commit = (v: string) => {
            if (edit) {
              if (v.trim() && v !== edit.value) store.setDrafts((l) => l.map((x) => (x.id === edit.id && x.kind === "texto" ? { ...x, text: v } : x)));
              setEdit(null);
            } else textEdit!.onCommit(v);
          };
          const cancel = () => (edit ? setEdit(null) : textEdit!.onCancel());
          return (
            <input
              key={edit ? `e${edit.id}` : `t${at[0]},${at[1]}`}
              className="inline-text"
              style={{ left: pos.left, top: pos.top }}
              autoFocus
              defaultValue={edit ? edit.value : textEdit!.value}
              placeholder="Digite o texto e tecle Enter"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
                else if (e.key === "Escape") cancel();
              }}
              onBlur={(e) => (edit ? commit(e.target.value) : undefined)}
            />
          );
        })()}
      {viewDef && (
        <div className={`view-badge ${viewDef.section}`}>
          {viewDef.section === "documentacao" ? "Documentação" : "Trabalho"} · {viewDef.name} · 1:{viewDef.scale}
        </div>
      )}
      {planTool && (
        <div className="plan-prompt" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span>{planTool.prompt}</span>
        </div>
      )}
      {planTool?.question && (
        <div className="plan-question" role="dialog" aria-label="Confirmação" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <p>{planTool.question.text}</p>
          <div className="btn-row">
            {planTool.question.options.map((o) => (
              <button key={o.label} className={`btn ${o.primary ? "primary" : ""}`} onClick={o.run}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="btn plan-fit" onClick={fit} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        Enquadrar
      </button>
    </div>
  );
}
