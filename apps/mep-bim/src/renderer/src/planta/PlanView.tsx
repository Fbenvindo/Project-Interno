import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { PlacedViewport, SheetResult } from "../../../core/plan/sheet";

interface Props {
  sheet: SheetResult;
  selection: number[];
  onSelect: (ids: number[], additive: boolean) => void;
  /** Muda a cada pedido de enquadramento vindo da faixa de ferramentas. */
  fitSignal?: number;
  /** Arrastar as vistas na folha (em vez de deslocar a folha). */
  moveMode?: boolean;
  viewports?: PlacedViewport[];
  onMoveViewport?: (viewId: string, center: [number, number]) => void;
  /** Duplo clique numa vista da folha: abrir a vista. */
  onOpenViewport?: (viewId: string) => void;
}

type ViewBox = { x: number; y: number; w: number; h: number };

/** Prancha interativa: roda do mouse = zoom, arrastar = deslocar, clique = selecionar. */
export function PlanView({ sheet, selection, onSelect, fitSignal, moveMode, viewports = [], onMoveViewport, onOpenViewport }: Props) {
  /** Vista sendo arrastada e deslocamento atual (mm da folha). */
  const [dragVp, setDragVp] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const vpDrag = useRef<{ id: string; x: number; y: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: sheet.width, h: sheet.height });
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);

  const fit = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const aspect = el.clientWidth / Math.max(el.clientHeight, 1);
    const pad = 1.04;
    let w = sheet.width * pad;
    let h = sheet.height * pad;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    setVb({ x: (sheet.width - w) / 2, y: (sheet.height - h) / 2, w, h });
  }, [sheet.width, sheet.height]);

  // Reenquadra ao trocar o formato da folha.
  useEffect(fit, [fit]);
  useEffect(() => {
    if (fitSignal) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  const toSheet = (clientX: number, clientY: number) => {
    const r = host.current!.getBoundingClientRect();
    return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
  };

  const onWheel = (e: WheelEvent) => {
    const p = toSheet(e.clientX, e.clientY);
    const f = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(Math.max(vb.w * f, 10), sheet.width * 4);
    const k = w / vb.w;
    setVb({ x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w, h: vb.h * k });
  };

  const vpAt = (clientX: number, clientY: number): string | null => {
    const p = toSheet(clientX, clientY);
    const hit = viewports.find((v) => p.x >= v.x - 2 && p.x <= v.x + v.w + 2 && p.y >= v.y - 2 && p.y <= v.y + v.h + 12);
    return hit?.id ?? null;
  };
  const onPointerDown = (e: PointerEvent) => {
    if (moveMode && e.button === 0) {
      const id = vpAt(e.clientX, e.clientY);
      if (id) {
        const p = toSheet(e.clientX, e.clientY);
        vpDrag.current = { id, x: p.x, y: p.y };
        setDragVp({ id, dx: 0, dy: 0 });
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }
    }
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (vpDrag.current) {
      const p = toSheet(e.clientX, e.clientY);
      setDragVp({ id: vpDrag.current.id, dx: p.x - vpDrag.current.x, dy: p.y - vpDrag.current.y });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const r = host.current!.getBoundingClientRect();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 3) d.moved = true;
    if (d.moved) setVb({ ...d.vb, x: d.vb.x - (dx / r.width) * d.vb.w, y: d.vb.y - (dy / r.height) * d.vb.h });
  };
  const onPointerUp = (e: PointerEvent) => {
    if (vpDrag.current) {
      const v = viewports.find((x) => x.id === vpDrag.current!.id);
      const p = toSheet(e.clientX, e.clientY);
      const dx = p.x - vpDrag.current.x;
      const dy = p.y - vpDrag.current.y;
      vpDrag.current = null;
      setDragVp(null);
      if (v && Math.hypot(dx, dy) > 0.5) onMoveViewport?.(v.id, [Math.round(v.x + v.w / 2 + dx), Math.round(v.y + v.h / 2 + dy)]);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-id]");
    const id = target ? Number(target.getAttribute("data-id")) : null;
    onSelect(id != null && Number.isFinite(id) ? [id] : [], e.ctrlKey || e.metaKey || e.shiftKey);
  };

  // Destaque da seleção por CSS, sem regenerar o desenho.
  const highlight = useMemo(
    () =>
      selection.length
        ? `${selection.map((id) => `#prancha [data-id="${id}"]`).join(",")}{stroke:#00a3c4 !important;stroke-width:0.6px !important}` +
          `${selection.map((id) => `#prancha text[data-id="${id}"]`).join(",")}{fill:#00a3c4 !important;stroke:#ffffff !important}`
        : "",
    [selection],
  );

  return (
    <div
      ref={host}
      className="plan-view"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => {
        const id = !moveMode && onOpenViewport && viewports.length > 1 ? vpAt(e.clientX, e.clientY) : null;
        if (id) onOpenViewport!(id);
        else fit();
      }}
    >
      <style>
        {highlight}
        {dragVp ? `#prancha [data-vp="${dragVp.id.replace(/"/g, "")}"]{transform:translate(${dragVp.dx}px,${dragVp.dy}px);opacity:.75}` : ""}
        {moveMode ? `#prancha [data-vp]{cursor:move}` : ""}
      </style>
      <svg id="prancha" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" height="100%" dangerouslySetInnerHTML={{ __html: sheet.inner }} />
      <div className="plan-hint">
        {moveMode
          ? "Arraste uma vista para reposicioná-la na folha"
          : `Roda do mouse: zoom · arrastar: mover · duplo clique: ${viewports.length > 1 ? "abrir a vista / " : ""}enquadrar a folha · clique: selecionar`}
      </div>
    </div>
  );
}
