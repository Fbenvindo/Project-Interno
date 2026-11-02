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
  /** Texto editável (anotação) pelo id, ou null; e a gravação do texto editado. */
  textOf?: (id: number) => string | null;
  onEditText?: (id: number, text: string) => void;
}

type ViewBox = { x: number; y: number; w: number; h: number };

/** Prancha interativa: roda do mouse = zoom, arrastar = deslocar, clique = selecionar. */
export function PlanView({ sheet, selection, onSelect, fitSignal, moveMode, viewports = [], onMoveViewport, onOpenViewport, textOf, onEditText }: Props) {
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [edit, setEdit] = useState<{ id: number; left: number; top: number; value: string } | null>(null);
  /** Vista sendo arrastada e deslocamento atual (mm da folha). */
  const [dragVp, setDragVp] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const vpDrag = useRef<{ id: string; x: number; y: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: sheet.width, h: sheet.height });
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean; box?: boolean } | null>(null);

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
    if (e.button === 1) e.preventDefault();
    // Selecionar: o botão esquerdo faz janela de seleção; o do meio desloca a folha.
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false, box: e.button === 0 };
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
    if (d.moved && d.box) {
      const r0 = host.current!.getBoundingClientRect();
      setBox({ x0: d.x - r0.left, y0: d.y - r0.top, x1: e.clientX - r0.left, y1: e.clientY - r0.top });
      return;
    }
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
    if (d?.box && d.moved) {
      setBox(null);
      const [minX, maxX] = [Math.min(d.x, e.clientX), Math.max(d.x, e.clientX)];
      const [minY, maxY] = [Math.min(d.y, e.clientY), Math.max(d.y, e.clientY)];
      const crossing = e.clientX < d.x;
      // Extensão na tela de cada elemento (todas as suas partes) contra a janela.
      const ext = new Map<number, [number, number, number, number]>();
      host.current!.querySelectorAll<SVGGraphicsElement>("#prancha [data-id]").forEach((el) => {
        const id = Number(el.getAttribute("data-id"));
        if (!Number.isFinite(id)) return;
        const r = el.getBoundingClientRect();
        const b = ext.get(id);
        ext.set(id, b ? [Math.min(b[0], r.left), Math.min(b[1], r.top), Math.max(b[2], r.right), Math.max(b[3], r.bottom)] : [r.left, r.top, r.right, r.bottom]);
      });
      const ids = [...ext].filter(([, b]) => (crossing ? b[0] <= maxX && b[2] >= minX && b[1] <= maxY && b[3] >= minY : b[0] >= minX && b[2] <= maxX && b[1] >= minY && b[3] <= maxY)).map(([id]) => id);
      onSelect(ids, e.ctrlKey || e.metaKey || e.shiftKey);
      return;
    }
    if (!d || d.moved || e.button !== 0) return;
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
      className={`plan-view ${moveMode ? "" : "selecting"}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(e) => {
        // Duplo clique num texto de anotação: edição no local.
        const t = document.elementFromPoint(e.clientX, e.clientY)?.closest("text[data-id]");
        const tid = t ? Number(t.getAttribute("data-id")) : NaN;
        const value = Number.isFinite(tid) ? (textOf?.(tid) ?? null) : null;
        if (value != null && t) {
          const r = t.getBoundingClientRect();
          const h = host.current!.getBoundingClientRect();
          setEdit({ id: tid, left: r.left - h.left, top: r.top + r.height / 2 - h.top, value });
          return;
        }
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
      {box && <div className={`plan-view-box ${box.x1 < box.x0 ? "crossing" : ""}`} style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
      {edit && (
        <input
          className="inline-text"
          style={{ left: edit.left, top: edit.top }}
          autoFocus
          defaultValue={edit.value}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            const v = (e.target as HTMLInputElement).value;
            if (e.key === "Enter") {
              if (v.trim() && v !== edit.value) onEditText?.(edit.id, v);
              setEdit(null);
            } else if (e.key === "Escape") setEdit(null);
          }}
          onBlur={(e) => {
            const v = e.target.value;
            if (v.trim() && v !== edit.value) onEditText?.(edit.id, v);
            setEdit(null);
          }}
        />
      )}
      <div className="plan-hint">
        {moveMode
          ? "Arraste uma vista para reposicioná-la na folha"
          : `Clique: selecionar · arrastar: janela de seleção · botão do meio: mover · roda: zoom · duplo clique: editar texto / ${viewports.length > 1 ? "abrir a vista / " : ""}enquadrar`}
      </div>
    </div>
  );
}
