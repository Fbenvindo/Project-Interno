// Editor em planta 2D: mostra o pavimento cortado (IFC + pontos + trechos) e
// alimenta o mesmo modo de edição usado na vista 3D (locação e traçado), com
// encaixe em faces de parede e cota real de teto/piso obtida por raio no modelo.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { DISCIPLINES } from "../../../core/disciplines";
import type { SurfaceHit } from "../../../core/placement";
import { buildPlan, boundsOf } from "../../../core/plan/build";
import type { Prim } from "../../../core/plan/drawing";
import type { P2 } from "../../../core/plan/section";
import { snapToWall, wallEdges, type WallSnap } from "../../../core/plan/snap";
import { closestOnSegment, distance, runIdOfElement, runSegments } from "../../../core/runs";
import { spaceAt } from "../../../core/spaces";
import type { ElementInfo, Vec3 } from "../../../core/types";
import type { LoadedModel } from "../../../ifc/loadIfc";
import type { PointsStore } from "../locacao/usePointsStore";
import type { PointerContext, PreviewItem, Viewer } from "../viewer/Viewer";

interface Props {
  viewer: Viewer;
  model: LoadedModel;
  store: PointsStore;
  storey: string;
  cutHeight: number;
  selection: number[];
  elementById: Map<number, ElementInfo>;
  onPick: (id: number | null, additive: boolean) => void;
  /** Fundo preto: a planta é desenhada invertida (traço claro). */
  dark?: boolean;
  /** Muda a cada pedido de enquadramento vindo de fora (faixa de ferramentas). */
  fitSignal?: number;
}

type ViewBox = { x: number; y: number; w: number; h: number };

const SCALE = 50; // símbolos dimensionados como em 1:50
const ALL = new Set(DISCIPLINES.map((d) => d.id));
const LABELS = { tags: true, circuits: true, power: true, sizes: true };
const CEILING_TYPES = new Set(["IFCSLAB", "IFCCOVERING", "IFCROOF", "IFCBEAM", "IFCPLATE"]);
const FLOOR_TYPES = new Set(["IFCSLAB", "IFCCOVERING", "IFCRAMP", "IFCSTAIRFLIGHT"]);
const SNAP_PX = 22;
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Primitivas em coordenadas de modelo (Y invertido para o SVG); traços em px. */
function primsToSvg(prims: Prim[]): string {
  const P = ([x, y]: P2) => `${f3(x)},${f3(-y)}`;
  const px = (w: number) => Math.max(0.6, w * 4).toFixed(2);
  return prims
    .map((p) => {
      const id = p.id != null ? ` data-id="${p.id}"` : "";
      const dash = "dashed" in p && p.dashed ? ` stroke-dasharray="6 4"` : "";
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

export function PlanEditor({ viewer, model, store, storey, cutHeight, selection, elementById, onPick, dark, fitSignal }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cs = model.coordinates;
  const level = model.storeyLevels.find((s) => s.name === storey)?.level ?? 0;
  const meshes = useMemo(() => new Map(model.meshes.map((m) => [m.expressID, m])), [model]);

  // Base (modelo cortado) e instalações, em camadas separadas para não recortar o IFC a cada ponto.
  const base = useMemo(
    () =>
      buildPlan({ elements: model.elements, meshes, cs, storeyLevels: model.storeyLevels, storey, cutHeight, points: [], runs: [], scale: SCALE, disciplines: ALL, labels: LABELS }),
    [model, meshes, cs, storey, cutHeight],
  );
  const mep = useMemo(
    () =>
      buildPlan({
        elements: [],
        meshes: new Map(),
        cs,
        storeyLevels: model.storeyLevels,
        storey,
        cutHeight,
        points: store.points,
        runs: store.runs,
        scale: SCALE,
        disciplines: ALL,
        labels: LABELS,
        spaces: model.spaces,
      }),
    [cs, model, storey, cutHeight, store.points, store.runs],
  );
  const edges = useMemo(() => wallEdges(base.prims), [base]);
  const baseSvg = useMemo(() => primsToSvg(base.prims), [base]);
  const mepSvg = useMemo(() => primsToSvg(mep.prims), [mep]);

  // ---- Vista (zoom e deslocamento) -----------------------------------------------------
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: -10, w: 20, h: 10 });
  const fit = useCallback(() => {
    const el = host.current;
    const b = boundsOf([...base.prims, ...mep.prims]);
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
  }, [base]);
  useEffect(fit, [fit]);
  useEffect(() => {
    if (fitSignal) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  const toModel = (clientX: number, clientY: number): P2 => {
    const r = host.current!.getBoundingClientRect();
    const x = vb.x + ((clientX - r.left) / r.width) * vb.w;
    const y = vb.y + ((clientY - r.top) / r.height) * vb.h;
    return [x, -y];
  };
  const metersPerPx = () => vb.w / Math.max(host.current?.clientWidth ?? 1, 1);

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

  // ---- Ponteiro ---------------------------------------------------------------------------------
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);
  const raf = useRef(0);
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d && (e.buttons & 1 || e.buttons & 4)) {
      const r = host.current!.getBoundingClientRect();
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) d.moved = true;
      if (d.moved) setVb({ ...d.vb, x: d.vb.x - (dx / r.width) * d.vb.w, y: d.vb.y - (dy / r.height) * d.vb.h });
      return;
    }
    lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(updateHover);
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || e.button !== 0) return;
    const h = viewer.getPlacementHandler();
    if (h) {
      const { hit, ctx } = probe(e.clientX, e.clientY, e.shiftKey);
      h.click(hit, ctx);
      lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      requestAnimationFrame(updateHover);
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-id]");
    const id = target ? Number(target.getAttribute("data-id")) : NaN;
    onPick(Number.isFinite(id) ? id : null, e.ctrlKey || e.metaKey || e.shiftKey);
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

  const outlines = viewer
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

  return (
    <div
      ref={host}
      className={`plan-editor ${handler ? "editing" : ""} ${dark ? "dark" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => ((lastPointer.current = null), setHover(null))}
      onWheel={onWheel}
      onDoubleClick={() => (handler ? handler.doubleClick?.() : fit())}
    >
      <style>{highlight}</style>
      <svg id="editor-planta" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" height="100%">
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#ffffff" />
        <g dangerouslySetInnerHTML={{ __html: baseSvg }} />
        <g dangerouslySetInnerHTML={{ __html: outlines }} />
        <g dangerouslySetInnerHTML={{ __html: mepSvg }} />
        <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: previewSvg(viewer.getStaticPreview()) + previewSvg(hover?.previews ?? []) + snapMarker }} />
      </svg>
      <button className="btn plan-fit" onClick={fit} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        Enquadrar
      </button>
    </div>
  );
}
