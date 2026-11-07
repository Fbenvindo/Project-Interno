// Fluxograma: desenho (centro), paleta de blocos e lista (esquerda) e propriedades com a
// conferência com o modelo (direita). O usuário monta o fluxograma livremente; as regras e o
// modelo só são conferidos e avisados.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  autoArrange,
  blockRect,
  blockStorey,
  blockTower,
  busStoreys,
  defaultLinkKind,
  downstreamLoad,
  FLOW_BLOCK_BY_ID,
  FLOW_BLOCKS,
  FLOW_GROUPS,
  flowPrims,
  HEADER_H,
  isBus,
  LINK_LABEL,
  LINK_STYLE,
  linkPath,
  newFlowId,
  nextTag,
  type FlowBlock,
  type FlowContext,
  type FlowData,
  type FlowIssue,
  type FlowLink,
  type FlowLinkKind,
} from "../../../core/flow";
import type { Prim } from "../../../core/plan/drawing";
import type { P2 } from "../../../core/plan/section";
import type { ViewDef } from "../../../core/views";

export type FlowMode = { kind: "sel" } | { kind: "place"; block: string } | { kind: "link"; from?: string };
export type FlowSel = { kind: "block"; id: string } | { kind: "link"; id: string } | null;
export type FlowUpdate = (fn: (f: FlowData) => FlowData, key?: string | null) => void;

const DRAG_TYPE = "application/x-sebflow-block";
const TEXT_SCALE = 1; // as alturas de texto já vêm em unidades de desenho
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Primitivas → SVG (Y para baixo na tela). */
function primsSvg(prims: Prim[]): string {
  let s = "";
  for (const p of prims) {
    const sw = `stroke-width="${f3(Math.max(0.8, p.t === "text" ? 0 : p.weight * 3.2))}" vector-effect="non-scaling-stroke"`;
    const dash = "dashed" in p && p.dashed ? ` stroke-dasharray="6 4"` : "";
    if (p.t === "line") s += `<line x1="${f3(p.a[0])}" y1="${f3(-p.a[1])}" x2="${f3(p.b[0])}" y2="${f3(-p.b[1])}" stroke="${p.color}" ${sw}${dash}/>`;
    else if (p.t === "poly") {
      const pts = p.pts.map((q) => `${f3(q[0])},${f3(-q[1])}`).join(" ");
      const tag = p.closed ? "polygon" : "polyline";
      const fill = p.closed && p.fill ? p.fill : "none";
      s += p.weight === 0 ? `<${tag} points="${pts}" fill="${fill}" stroke="none"/>` : `<${tag} points="${pts}" fill="${fill}" stroke="${p.color}" ${sw}${dash} stroke-linejoin="round"/>`;
    } else if (p.t === "circle") s += `<circle cx="${f3(p.c[0])}" cy="${f3(-p.c[1])}" r="${f3(p.r)}" fill="${p.fill ?? "none"}" stroke="${p.color}" ${sw}/>`;
    else {
      const h = p.height * TEXT_SCALE;
      const rot = p.angle ? ` transform="rotate(${f3((-p.angle * 180) / Math.PI)} ${f3(p.p[0])} ${f3(-p.p[1])})"` : "";
      s += `<text x="${f3(p.p[0])}" y="${f3(-p.p[1])}" font-size="${f3(h)}" text-anchor="${p.anchor}" dominant-baseline="middle" font-family="Arial, sans-serif" fill="${p.color}"${rot}>${esc(p.text)}</text>`;
    }
  }
  return s;
}

const snap = (v: number) => Math.round(v * 10) / 10;

// ---- Desenho -------------------------------------------------------------------------------------

interface CanvasProps {
  view: ViewDef;
  flow: FlowData;
  update: FlowUpdate;
  sel: FlowSel;
  setSel: (s: FlowSel) => void;
  mode: FlowMode;
  setMode: (m: FlowMode) => void;
  issues: FlowIssue[];
  onPlaceOnSheet: () => void;
}

export function FlowCanvas({ view, flow, update, sel, setSel, mode, setMode, issues, onPlaceOnSheet }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: -1, y: -1, w: 40, h: 25 });
  const [cursor, setCursor] = useState<P2 | null>(null);
  const drag = useRef<
    | { kind: "pan"; client: P2; vb: typeof vb; moved: boolean }
    | { kind: "move"; id: string; start: P2; orig: { x: number; y: number }; moved: boolean }
    | { kind: "resize"; id: string; edge: "top" | "bottom"; start: P2; orig: { y: number; h: number } }
    | null
  >(null);

  const prims = useMemo(() => flowPrims(flow, { legend: true }), [flow]);
  const svg = useMemo(() => primsSvg(prims), [prims]);
  const byId = useMemo(() => new Map(flow.blocks.map((b) => [b.id, b])), [flow.blocks]);
  const issueOf = useMemo(() => {
    const m = new Map<string, FlowIssue["level"]>();
    for (const i of issues) if (i.blockId && i.level !== "info" && (!m.has(i.blockId) || i.level === "erro")) m.set(i.blockId, i.level);
    return m;
  }, [issues]);

  const toModel = (cx: number, cy: number): P2 => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return [0, 0];
    const q = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [q.x, q.y];
  };
  const pxToU = () => {
    const m = svgRef.current?.getScreenCTM();
    return m ? 1 / m.a : 0.05;
  };

  const fit = () => {
    const xs: number[] = [0];
    const ys: number[] = [0];
    for (const p of prims) {
      const pts = p.t === "line" ? [p.a, p.b] : p.t === "poly" ? p.pts : p.t === "circle" ? [p.c] : [p.p];
      for (const q of pts) (xs.push(q[0]), ys.push(-q[1]));
    }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs, 20), Math.min(...ys), Math.max(...ys, 12)];
    const r = svgRef.current?.getBoundingClientRect();
    const aspect = r ? r.width / Math.max(1, r.height) : 1.6;
    let w = (x1 - x0) * 1.06 + 1;
    let h = (y1 - y0) * 1.06 + 1;
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    setVb({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [view.id]);

  const hitBlock = (p: P2): FlowBlock | null => {
    const pad = 4 * pxToU();
    for (let i = flow.blocks.length - 1; i >= 0; i--) {
      const b = flow.blocks[i];
      const r = blockRect(b);
      const extra = isBus(b) ? pad : 0;
      if (p[0] >= r.x - extra && p[0] <= r.x + r.w + extra && p[1] >= r.y && p[1] <= r.y + r.h) return b;
    }
    return null;
  };
  const hitLink = (p: P2): FlowLink | null => {
    const tol = 6 * pxToU();
    let best: { l: FlowLink; d: number } | null = null;
    for (const l of flow.links) {
      const a = byId.get(l.from);
      const b = byId.get(l.to);
      if (!a || !b) continue;
      const pts = linkPath(a, b);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [s, e] = [pts[i], pts[i + 1]];
        const dx = e[0] - s[0];
        const dy = e[1] - s[1];
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2));
        const d = Math.hypot(s[0] + dx * t - p[0], s[1] + dy * t - p[1]);
        if (d < tol && (!best || d < best.d)) best = { l, d };
      }
    }
    return best?.l ?? null;
  };

  const addBlock = (kind: string, at: P2) => {
    const d = FLOW_BLOCK_BY_ID[kind];
    if (!d) return;
    const h = d.symbol === "barramento" && flow.layout === "pavimentos" ? Math.max(3, flow.storeys.length * flow.bandH - 0.4) : undefined;
    const b: FlowBlock = {
      id: newFlowId("b"),
      kind,
      tag: nextTag(flow, kind),
      x: snap(at[0] - d.w / 2),
      y: snap(h ? HEADER_H + 0.2 : at[1] - d.h / 2),
      ...(h ? { h } : {}),
      params: Object.fromEntries(d.params.map((p) => [p.key, p.default])),
      ...(d.symbol === "texto" ? { text: "Texto" } : {}),
    };
    update((f) => ({ ...f, blocks: [...f.blocks, b] }));
    setSel({ kind: "block", id: b.id });
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toModel(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      drag.current = { kind: "pan", client: [e.clientX, e.clientY], vb, moved: false };
      return;
    }
    if (e.button !== 0) return;
    if (mode.kind === "place") {
      addBlock(mode.block, p);
      if (!e.shiftKey) setMode({ kind: "sel" });
      return;
    }
    const b = hitBlock(p);
    if (mode.kind === "link") {
      if (!b) return setMode({ kind: "link" });
      if (!mode.from) return setMode({ kind: "link", from: b.id });
      if (mode.from === b.id) return;
      const from = byId.get(mode.from)!;
      if (flow.links.some((l) => l.from === from.id && l.to === b.id)) return setMode({ kind: "link" });
      const l: FlowLink = { id: newFlowId("l"), from: from.id, to: b.id, kind: defaultLinkKind(from, b) };
      update((f) => ({ ...f, links: [...f.links, l] }));
      setSel({ kind: "link", id: l.id });
      // Continua ligando a partir do destino (encadeado); Esc encerra.
      setMode({ kind: "link", from: b.id });
      return;
    }
    if (b) {
      setSel({ kind: "block", id: b.id });
      const r = blockRect(b);
      const edgeTol = 6 * pxToU();
      if (isBus(b) && (Math.abs(p[1] - r.y) < edgeTol || Math.abs(p[1] - (r.y + r.h)) < edgeTol)) {
        drag.current = { kind: "resize", id: b.id, edge: Math.abs(p[1] - r.y) < edgeTol ? "top" : "bottom", start: p, orig: { y: r.y, h: r.h } };
        return;
      }
      drag.current = { kind: "move", id: b.id, start: p, orig: { x: b.x, y: b.y }, moved: false };
      return;
    }
    const l = hitLink(p);
    if (l) return setSel({ kind: "link", id: l.id });
    setSel(null);
    drag.current = { kind: "pan", client: [e.clientX, e.clientY], vb, moved: false };
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toModel(e.clientX, e.clientY);
    setCursor(p);
    const g = drag.current;
    if (!g || !e.buttons) return;
    if (g.kind === "pan") {
      const k = pxToU();
      if (Math.hypot(e.clientX - g.client[0], e.clientY - g.client[1]) > 3) g.moved = true;
      setVb({ ...g.vb, x: g.vb.x - (e.clientX - g.client[0]) * k, y: g.vb.y - (e.clientY - g.client[1]) * k });
    } else if (g.kind === "move") {
      const dx = p[0] - g.start[0];
      const dy = p[1] - g.start[1];
      if (!g.moved && Math.hypot(dx, dy) < 3 * pxToU()) return;
      g.moved = true;
      update(
        (f) => ({ ...f, blocks: f.blocks.map((b) => (b.id === g.id ? { ...b, x: snap(g.orig.x + dx), y: snap(g.orig.y + dy) } : b)) }),
        `mover:${g.id}`,
      );
    } else {
      const dy = p[1] - g.start[1];
      update(
        (f) => ({
          ...f,
          blocks: f.blocks.map((b) => {
            if (b.id !== g.id) return b;
            if (g.edge === "top") {
              const y = snap(Math.min(g.orig.y + dy, g.orig.y + g.orig.h - 1));
              return { ...b, y, h: snap(g.orig.y + g.orig.h - y) };
            }
            return { ...b, h: snap(Math.max(1, g.orig.h + dy)) };
          }),
        }),
        `esticar:${g.id}`,
      );
    }
  };
  const onUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const q = toModel(e.clientX, e.clientY);
    const k = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(Math.max(vb.w * k, 4), 2000);
    const s = w / vb.w;
    setVb({ x: q[0] - (q[0] - vb.x) * s, y: q[1] - (q[1] - vb.y) * s, w, h: vb.h * s });
  };

  // Teclado: Delete apaga a seleção; Esc volta a Selecionar.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Escape" && mode.kind !== "sel") {
      e.stopImmediatePropagation();
      setMode({ kind: "sel" });
    } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (sel.kind === "block") update((f) => ({ ...f, blocks: f.blocks.filter((b) => b.id !== sel.id), links: f.links.filter((l) => l.from !== sel.id && l.to !== sel.id) }));
      else update((f) => ({ ...f, links: f.links.filter((l) => l.id !== sel.id) }));
      setSel(null);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  // Destaques: seleção, origem da ligação, avisos e bloco em locação (fantasma).
  const px = pxToU();
  const overlay: JSX.Element[] = [];
  if (sel?.kind === "block") {
    const b = byId.get(sel.id);
    if (b) {
      const r = blockRect(b);
      overlay.push(<rect key="sel" x={r.x - 0.12} y={r.y - 0.12} width={r.w + 0.24} height={r.h + 0.24} fill="none" stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />);
      if (isBus(b))
        for (const yy of [r.y, r.y + r.h]) overlay.push(<rect key={`h${yy}`} x={r.x + r.w / 2 - 4 * px} y={yy - 4 * px} width={8 * px} height={8 * px} fill="#06b6d4" />);
    }
  }
  if (sel?.kind === "link") {
    const l = flow.links.find((x) => x.id === sel.id);
    const a = l && byId.get(l.from);
    const b = l && byId.get(l.to);
    if (a && b) overlay.push(<polyline key="sl" points={linkPath(a, b).map((q) => q.join(",")).join(" ")} fill="none" stroke="#06b6d4" strokeWidth={6} strokeOpacity={0.45} vectorEffect="non-scaling-stroke" />);
  }
  if (mode.kind === "link" && mode.from) {
    const a = byId.get(mode.from);
    if (a) {
      const r = blockRect(a);
      overlay.push(<rect key="from" x={r.x - 0.1} y={r.y - 0.1} width={r.w + 0.2} height={r.h + 0.2} fill="none" stroke="#7c3aed" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />);
      if (cursor) overlay.push(<line key="rub" x1={r.x + r.w / 2} y1={r.y + r.h / 2} x2={cursor[0]} y2={cursor[1]} stroke="#7c3aed" strokeDasharray="5 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />);
    }
  }
  for (const [id, lvl] of issueOf) {
    const b = byId.get(id);
    if (!b) continue;
    const r = blockRect(b);
    overlay.push(<circle key={`i${id}`} cx={r.x + r.w} cy={r.y} r={5 * px} fill={lvl === "erro" ? "#dc2626" : "#f59e0b"} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />);
  }
  if (mode.kind === "place" && cursor) {
    const d = FLOW_BLOCK_BY_ID[mode.block];
    if (d) overlay.push(<rect key="ghost" x={cursor[0] - d.w / 2} y={cursor[1] - d.h / 2} width={d.w} height={d.h} fill={d.color} fillOpacity={0.12} stroke={d.color} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />);
  }

  const setLayout = (layout: FlowData["layout"]) => update((f) => ({ ...f, layout }));
  const hint =
    mode.kind === "place"
      ? `Clique no desenho para colocar: ${FLOW_BLOCK_BY_ID[mode.block]?.label} (Shift: vários) · Esc cancela`
      : mode.kind === "link"
        ? mode.from
          ? "Clique no bloco que recebe a energia (segue ligando a partir dele) · Esc encerra"
          : "Clique no bloco de onde sai a energia"
        : "Arraste os blocos da paleta para o desenho · clique para selecionar e arrastar · barramento: puxe as pontas para vencer os pavimentos · Delete apaga · botão do meio/direito ou área vazia: deslocar · roda: zoom";

  return (
    <div className="flow-editor">
      <div className="flow-toolbar">
        <div className="segmented small">
          <button className={mode.kind === "sel" ? "on" : ""} onClick={() => setMode({ kind: "sel" })}>
            Selecionar
          </button>
          <button className={mode.kind === "link" ? "on" : ""} onClick={() => setMode({ kind: "link" })} title="Ligar: clique na origem e depois no destino">
            Ligar
          </button>
          <button className={mode.kind === "place" && mode.block === "texto" ? "on" : ""} onClick={() => setMode({ kind: "place", block: "texto" })}>
            Texto
          </button>
        </div>
        <div className="segmented small">
          <button className={flow.layout === "pavimentos" ? "on" : ""} onClick={() => setLayout("pavimentos")} title="Faixas por pavimento e colunas por torre">
            Por pavimento
          </button>
          <button className={flow.layout === "livre" ? "on" : ""} onClick={() => setLayout("livre")} title="Sem faixas">
            Livre
          </button>
        </div>
        <button className="btn small-btn" disabled={flow.layout !== "pavimentos"} onClick={() => update(autoArrange)} title="Centraliza cada bloco na faixa do pavimento e afasta os sobrepostos">
          Auto-organizar
        </button>
        <div className="spacer" />
        <button className="btn small-btn" onClick={fit}>
          Enquadrar
        </button>
        <button className="btn primary small-btn" onClick={onPlaceOnSheet} title="Coloca o fluxograma numa folha (PDF e DXF pela prancha)">
          Colocar na prancha
        </button>
      </div>
      <div
        className="flow-canvas"
        onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
        onDrop={(e) => {
          const kind = e.dataTransfer.getData(DRAG_TYPE);
          if (!kind) return;
          e.preventDefault();
          addBlock(kind, toModel(e.clientX, e.clientY));
          setMode({ kind: "sel" });
        }}
      >
        <svg
          ref={svgRef}
          id="flow-svg"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          width="100%"
          height="100%"
          className={mode.kind === "sel" ? "" : "drawing"}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setCursor(null)}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="#ffffff" />
          <g dangerouslySetInnerHTML={{ __html: svg }} />
          {overlay}
        </svg>
        <div className="flow-hint muted small">{hint}</div>
      </div>
    </div>
  );
}

// ---- Paleta e lista (painel esquerdo) -------------------------------------------------------------

export function FlowSidebar({
  flows,
  activeId,
  onOpen,
  onNew,
  onExample,
  mode,
  setMode,
}: {
  flows: ViewDef[];
  activeId: string | null;
  onOpen: (v: ViewDef) => void;
  onNew: () => void;
  onExample: () => void;
  mode: FlowMode;
  setMode: (m: FlowMode) => void;
}) {
  const groups = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div className="flow-side">
      <div className="panel-head">
        <h3>Fluxogramas da Elétrica</h3>
        <button className="link" onClick={onNew}>
          + novo
        </button>
      </div>
      <ul className="sel-list">
        {flows.map((v) => (
          <li key={v.id} className={v.id === activeId ? "on" : ""} onClick={() => onOpen(v)} style={{ cursor: "pointer" }}>
            <span className="grow">{v.name}</span>
            <span className="muted small">{v.section === "documentacao" ? "Documentação" : "Trabalho"}</span>
          </li>
        ))}
      </ul>
      <button className="link small" onClick={onExample} title="Cria o perfil e o fluxograma de exemplo: 2 torres (12 e 16 andares), 2 subsolos e térreo comuns, entrada BT e medição nos andares por barramento blindado">
        + exemplo: 2 torres com medição nos andares
      </button>
      <div className="panel-head">
        <h3>Blocos</h3>
        <span className="muted small">arraste ou clique e coloque</span>
      </div>
      {groups.map((g) => (
        <div key={g} className="flow-group">
          <div className="flow-group-head">
            <i>{g}</i>
            {FLOW_GROUPS[g]}
          </div>
          <div className="chips">
            {FLOW_BLOCKS.filter((b) => b.group === g).map((b) => (
              <button
                key={b.id}
                className={`chip flow-chip ${mode.kind === "place" && mode.block === b.id ? "on" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, b.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => setMode({ kind: "place", block: b.id })}
                title={b.label}
                style={{ borderLeftColor: b.color }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="muted small">
        Barramento blindado: a caixa MEC pode ir direto no barramento (uma só por barramento) ou em caixas de derivação (até 2 caixas por andar no mesmo
        barramento). Use mais de um barramento e mais de uma torre quando precisar (colunas em Propriedades).
      </p>
    </div>
  );
}

// ---- Propriedades e conferência (painel direito) ------------------------------------------------------

interface PanelProps {
  view: ViewDef;
  flow: FlowData;
  update: FlowUpdate;
  onRename: (name: string) => void;
  onSection: (s: ViewDef["section"]) => void;
  onScale: (scale: number) => void;
  hasProfile: boolean;
  onApplyProfile: () => void;
  onEditProfile: () => void;
  sel: FlowSel;
  setSel: (s: FlowSel) => void;
  issues: FlowIssue[];
  ctx: FlowContext;
  modelStoreys: string[];
  onLocate: (blockId: string) => void;
  onShowBoard: (guid: string) => void;
}

const fmtKva = (va: number) => `${(va / 1000).toFixed(1).replace(".", ",")} kVA`;
const LEVEL_ICON = { erro: "⛔", aviso: "⚠", info: "ℹ" } as const;

export function FlowPanel({ view, flow, update, onRename, onSection, onScale, hasProfile, onApplyProfile, onEditProfile, sel, setSel, issues, ctx, modelStoreys, onLocate, onShowBoard }: PanelProps) {
  const block = sel?.kind === "block" ? flow.blocks.find((b) => b.id === sel.id) : undefined;
  const link = sel?.kind === "link" ? flow.links.find((l) => l.id === sel.id) : undefined;
  const setBlock = (patch: Partial<FlowBlock>, key?: string | null) => block && update((f) => ({ ...f, blocks: f.blocks.map((b) => (b.id === block.id ? { ...b, ...patch } : b)) }), key === undefined ? `bloco:${block.id}` : key);
  const setLink = (patch: Partial<FlowLink>) => link && update((f) => ({ ...f, links: f.links.map((l) => (l.id === link.id ? { ...l, ...patch } : l)) }), `lig:${link.id}`);
  const tagOf = (id: string) => flow.blocks.find((b) => b.id === id)?.tag || FLOW_BLOCK_BY_ID[flow.blocks.find((b) => b.id === id)?.kind ?? ""]?.label || "?";

  return (
    <div className="panel-body flow-panel">
      {block ? (
        <BlockProps
          flow={flow}
          b={block}
          set={setBlock}
          ctx={ctx}
          tagOf={tagOf}
          onSelectLink={(id) => setSel({ kind: "link", id })}
          onLocate={() => onLocate(block.id)}
          onShowBoard={onShowBoard}
          onDelete={() => {
            update((f) => ({ ...f, blocks: f.blocks.filter((b) => b.id !== block.id), links: f.links.filter((l) => l.from !== block.id && l.to !== block.id) }));
            setSel(null);
          }}
        />
      ) : link ? (
        <section className="card">
          <h3>
            Ligação · {tagOf(link.from)} → {tagOf(link.to)}
          </h3>
          <div className="form-grid">
            <label>
              Tipo
              <select value={link.kind} onChange={(e) => setLink({ kind: e.target.value as FlowLinkKind })}>
                {(Object.keys(LINK_LABEL) as FlowLinkKind[]).map((k) => (
                  <option key={k} value={k}>
                    {LINK_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cabo / barramento
              <input value={link.label ?? ""} placeholder="ex.: 4×(1×120) mm²" onChange={(e) => setLink({ label: e.target.value })} />
            </label>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => setLink({ from: link.to, to: link.from })}>
              Inverter sentido
            </button>
            <button
              className="btn danger"
              onClick={() => {
                update((f) => ({ ...f, links: f.links.filter((l) => l.id !== link.id) }));
                setSel(null);
              }}
            >
              Apagar ligação
            </button>
          </div>
        </section>
      ) : (
        <FlowSettings view={view} flow={flow} update={update} onRename={onRename} onSection={onSection} onScale={onScale} modelStoreys={modelStoreys} hasProfile={hasProfile} onApplyProfile={onApplyProfile} onEditProfile={onEditProfile} />
      )}

      <section className="card">
        <div className="panel-head">
          <h3>Conferência ({issues.filter((i) => i.level !== "info").length})</h3>
          <span className="muted small">
            {issues.filter((i) => i.level === "erro").length} erro(s) · {issues.filter((i) => i.level === "aviso").length} aviso(s)
          </span>
        </div>
        {issues.length === 0 ? (
          <p className="muted small">Tudo confere com as regras e com o modelo.</p>
        ) : (
          <ul className="flow-issues">
            {issues.map((i, k) => (
              <li key={k} className={i.level} onClick={() => i.blockId && setSel({ kind: "block", id: i.blockId })}>
                <span className="ico">{LEVEL_ICON[i.level]}</span>
                <span className="grow">{i.text}</span>
                {i.action?.kind === "vincular" && (
                  <button
                    className="link"
                    onClick={(e) => {
                      e.stopPropagation();
                      const a = i.action as { blockId: string; pointGuid: string };
                      update((f) => ({ ...f, blocks: f.blocks.map((b) => (b.id === a.blockId ? { ...b, pointGuid: a.pointGuid } : b)) }));
                    }}
                  >
                    vincular
                  </button>
                )}
                {i.action?.kind === "locar" && (
                  <button
                    className="link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLocate(i.action!.blockId);
                    }}
                  >
                    locar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">O fluxograma é livre: as regras só avisam. Os quadros vinculados trazem a carga dos circuitos do projeto.</p>
      </section>
    </div>
  );
}

function BlockProps({
  flow,
  b,
  set,
  ctx,
  tagOf,
  onSelectLink,
  onLocate,
  onShowBoard,
  onDelete,
}: {
  flow: FlowData;
  b: FlowBlock;
  set: (p: Partial<FlowBlock>, key?: string | null) => void;
  ctx: FlowContext;
  tagOf: (id: string) => string;
  onSelectLink: (id: string) => void;
  onLocate: () => void;
  onShowBoard: (guid: string) => void;
  onDelete: () => void;
}) {
  const d = FLOW_BLOCK_BY_ID[b.kind];
  if (!d) return null;
  const inc = flow.links.filter((l) => l.to === b.id);
  const out = flow.links.filter((l) => l.from === b.id);
  const board = b.pointGuid ? ctx.boards.find((x) => x.guid === b.pointGuid) : undefined;
  const load = downstreamLoad(flow, b.id, ctx);
  const storey = blockStorey(flow, b);
  const tower = blockTower(flow, b);
  return (
    <>
      <section className="card">
        <h3>
          {b.tag || d.label} · <span className="muted">{d.label}</span>
        </h3>
        <div className="form-grid">
          {d.symbol === "texto" ? (
            <label className="span2">
              Texto
              <input value={b.text ?? ""} onChange={(e) => set({ text: e.target.value })} autoFocus />
            </label>
          ) : (
            <label>
              Etiqueta
              <input value={b.tag} onChange={(e) => set({ tag: e.target.value })} />
            </label>
          )}
          {d.params.map((p) => (
            <label key={p.key}>
              {p.label}
              {p.unit ? ` (${p.unit})` : ""}
              {p.options ? (
                <select value={String(b.params[p.key] ?? p.default)} onChange={(e) => set({ params: { ...b.params, [p.key]: e.target.value } })}>
                  {p.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={String(b.params[p.key] ?? "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    const n = Number(v.replace(",", "."));
                    set({ params: { ...b.params, [p.key]: typeof p.default === "number" && v.trim() !== "" && !Number.isNaN(n) ? n : v } });
                  }}
                />
              )}
            </label>
          ))}
        </div>
        {flow.layout === "pavimentos" && d.symbol !== "texto" && (
          <p className="muted small">
            {isBus(b) ? `Atravessa: ${busStoreys(flow, b).join(", ") || "—"}` : `Pavimento: ${storey ?? "fora das faixas"}`}
            {tower ? ` · ${tower.name}` : ""}
          </p>
        )}
        {d.meters && <p className="muted small">Caixa de medição com {d.meters} medidores.</p>}
      </section>

      {d.symbol !== "texto" && (
        <section className="card">
          <h3>Ligações</h3>
          {!inc.length && !out.length && <p className="muted small">Use “Ligar” na barra do desenho: clique na origem e depois no destino.</p>}
          <ul className="sel-list">
            {inc.map((l) => (
              <li key={l.id} onClick={() => onSelectLink(l.id)} style={{ cursor: "pointer" }}>
                <span className="grow">← {tagOf(l.from)}</span>
                <span className="muted small" style={{ color: LINK_STYLE[l.kind].color }}>
                  {l.label || LINK_LABEL[l.kind]}
                </span>
              </li>
            ))}
            {out.map((l) => (
              <li key={l.id} onClick={() => onSelectLink(l.id)} style={{ cursor: "pointer" }}>
                <span className="grow">→ {tagOf(l.to)}</span>
                <span className="muted small" style={{ color: LINK_STYLE[l.kind].color }}>
                  {l.label || LINK_LABEL[l.kind]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.board && (
        <section className="card">
          <h3>Vínculo com o modelo</h3>
          <label className="inline-row small">
            <span className="grow">Quadro locado</span>
            <select value={b.pointGuid ?? ""} onChange={(e) => set({ pointGuid: e.target.value || undefined }, null)}>
              <option value="">(sem vínculo)</option>
              {ctx.boards.map((m) => (
                <option key={m.guid} value={m.guid}>
                  {m.tag}
                  {m.storey ? ` · ${m.storey}` : ""}
                </option>
              ))}
            </select>
          </label>
          {board ? (
            <>
              <div className="row-kv">
                <span>Carga dos circuitos</span>
                <b>{fmtKva(board.loadVA)}</b>
              </div>
              <div className="btn-row">
                <button className="btn" onClick={() => onShowBoard(board.guid)}>
                  Mostrar no modelo
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button className="btn primary" onClick={onLocate} title="Abre a locação do quadro na planta; o quadro locado fica vinculado a este bloco com a mesma etiqueta">
                Locar no modelo
              </button>
            </div>
          )}
        </section>
      )}

      {d.symbol !== "texto" && (load.boards > 0 || b.kind === "transformador" || b.kind === "gerador") && (
        <section className="card">
          <h3>Carga a jusante</h3>
          <div className="row-kv">
            <span>Quadros vinculados</span>
            <b>{load.boards}</b>
          </div>
          <div className="row-kv">
            <span>Carga instalada</span>
            <b>{fmtKva(load.va)}</b>
          </div>
          {(b.kind === "transformador" || b.kind === "gerador") && Number(b.params.potencia) > 0 && (
            <>
              <div className="row-kv">
                <span>Carregamento (sem demanda)</span>
                <b>{Math.round((load.va / (Number(b.params.potencia) * 1000)) * 100)} %</b>
              </div>
              <div className="flow-bar">
                <i style={{ width: `${Math.min(100, (load.va / (Number(b.params.potencia) * 1000)) * 100)}%` }} />
              </div>
            </>
          )}
          <p className="muted small">Soma da carga instalada dos circuitos dos quadros vinculados abaixo deste bloco.</p>
        </section>
      )}
      <div className="btn-row">
        <button className="btn danger" onClick={onDelete}>
          Apagar bloco
        </button>
      </div>
    </>
  );
}

function FlowSettings({
  view,
  flow,
  update,
  onRename,
  onSection,
  onScale,
  modelStoreys,
  hasProfile,
  onApplyProfile,
  onEditProfile,
}: {
  view: ViewDef;
  flow: FlowData;
  update: FlowUpdate;
  onRename: (n: string) => void;
  onSection: (s: ViewDef["section"]) => void;
  onScale: (scale: number) => void;
  modelStoreys: string[];
  hasProfile: boolean;
  onApplyProfile: () => void;
  onEditProfile: () => void;
}) {
  const [newStorey, setNewStorey] = useState("");
  const setTowers = (fn: (t: FlowData["towers"]) => FlowData["towers"]) => update((f) => ({ ...f, towers: fn(f.towers) }), "torres");
  const setStoreys = (fn: (s: string[]) => string[]) => update((f) => ({ ...f, storeys: fn(f.storeys) }), "pavimentos");
  /** Altera faixas e os dados do perfil junto (mesma ordem). */
  type Row = { s: string; lv?: NonNullable<FlowData["levels"]>[number] };
  const setRows = (fn: (rows: Row[]) => Row[]) =>
    update((f) => {
      const rows = fn(f.storeys.map((s, i) => ({ s, lv: f.levels?.[i] })));
      return { ...f, storeys: rows.map((r) => r.s), levels: f.levels ? rows.map((r) => r.lv ?? { floor: r.s }) : undefined };
    }, "pavimentos");
  return (
    <>
      <section className="card">
        <h3>Fluxograma</h3>
        <div className="form-grid">
          <label className="span2">
            Nome
            <input value={view.name} onChange={(e) => onRename(e.target.value)} />
          </label>
          <label>
            Seção
            <select value={view.section} onChange={(e) => onSection(e.target.value as ViewDef["section"])}>
              <option value="trabalho">Trabalho</option>
              <option value="documentacao">Documentação</option>
            </select>
          </label>
          <label title="Tamanho na folha">
            Escala na prancha
            <select value={view.scale} onChange={(e) => onScale(Number(e.target.value))}>
              {[25, 50, 75, 100, 200].map((k) => (
                <option key={k} value={k}>
                  1:{k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Altura da faixa
            <input type="number" step={0.5} min={1.5} value={flow.bandH} onChange={(e) => update((f) => ({ ...f, bandH: Math.max(1.5, Number(e.target.value) || 3) }), "faixa")} />
          </label>
        </div>
        <p className="muted small">{flow.blocks.length} bloco(s) · {flow.links.length} ligação(ões). Selecione um bloco ou ligação para editar.</p>
      </section>
      <section className="card">
        <div className="panel-head">
          <h3>Torres ({flow.towers.length})</h3>
          <button className="link" onClick={() => setTowers((t) => [...t, { id: newFlowId("t"), name: `Torre ${String.fromCharCode(65 + t.length)}`, width: 20 }])}>
            + torre
          </button>
        </div>
        <ul className="sel-list">
          {flow.towers.map((t) => (
            <li key={t.id}>
              <input className="grow flow-name" value={t.name} onChange={(e) => setTowers((l) => l.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))} />
              <input
                type="number"
                step={2}
                min={6}
                style={{ width: 58 }}
                title="Largura da coluna"
                value={t.width}
                onChange={(e) => setTowers((l) => l.map((x) => (x.id === t.id ? { ...x, width: Math.max(6, Number(e.target.value) || 20) } : x)))}
              />
              {flow.towers.length > 1 && (
                <button className="link danger-link" onClick={() => setTowers((l) => l.filter((x) => x.id !== t.id))}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <div className="panel-head">
          <h3>Pavimentos ({flow.storeys.length})</h3>
          <span>
            <button className="link" title="Faixas e torres pelo perfil do empreendimento (torres, pavimentos comuns, alturas)" disabled={!hasProfile} onClick={onApplyProfile}>
              do perfil
            </button>
            {" · "}
            <button className="link" title="Usa os pavimentos do modelo, de cima para baixo" onClick={() => update((f) => ({ ...f, storeys: [...modelStoreys].reverse(), levels: undefined }), "pavimentos")}>
              do modelo
            </button>
          </span>
        </div>
        <ul className="sel-list">
          {flow.storeys.map((s, i) => (
            <li key={`${s}${i}`}>
              <input className="grow flow-name" value={s} onChange={(e) => setStoreys((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="link" title="Subir" disabled={i === 0} onClick={() => setRows((l) => (i ? [...l.slice(0, i - 1), l[i], l[i - 1], ...l.slice(i + 1)] : l))}>
                ↑
              </button>
              <button className="link danger-link" onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="flow-add">
          <input placeholder="novo pavimento (ex.: 4º ao 20º Pavimento)" value={newStorey} onChange={(e) => setNewStorey(e.target.value)} />
          <button
            className="btn small-btn"
            disabled={!newStorey.trim()}
            onClick={() => {
              setRows((l) => [{ s: newStorey.trim() }, ...l]);
              setNewStorey("");
            }}
          >
            + no topo
          </button>
        </div>
        <p className="muted small">
          Faixas de cima para baixo. Os blocos ficam no pavimento da faixa em que estão. Torres, pavimentos comuns e alturas vêm do{" "}
          <button className="link" onClick={onEditProfile}>
            perfil do empreendimento
          </button>
          .
        </p>
      </section>
    </>
  );
}
