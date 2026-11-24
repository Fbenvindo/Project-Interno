// Editor de elementos: desenha a geometria por sólidos de extrusão (retângulo, círculo ou
// polígono numa vista + profundidade) e define classificação e parâmetros. O elemento salvo
// entra na biblioteca e pode ser locado como os demais.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  checkDesign,
  designMesh,
  moveSolid,
  profilePolygon,
  solidSilhouette,
  VIEW_AXES,
  VIEW_LABEL,
  viewToElement,
  type DesignSolid,
  type DesignView,
  type ElementDesign,
  type Profile2,
} from "../../../core/elementDesign";
import { BUILTIN_COUNT, COMPONENTS, MOUNTING_LABEL, type ComponentParam, type Mounting } from "../../../core/library";
import { DISCIPLINES } from "../../../core/disciplines";
import { findSnap, orthoPoint, orthoSnap, SNAP_LABEL, type SnapGeometry, type SnapMode } from "../../../core/osnap";
import { activeSnaps, useDrawAids } from "../desenho/drawAids";
import { DrawAidsBar } from "../shell/DrawAidsBar";
import type { Discipline } from "../../../core/types";

type P2 = [number, number];
type DrawTool = "sel" | "ret" | "circ" | "poli";

interface Props {
  initial: ElementDesign;
  onCancel: () => void;
  onSave: (d: ElementDesign, place: boolean) => void;
}

const IFC_TYPES = [
  "IFCBUILDINGELEMENTPROXY",
  "IFCLIGHTFIXTURE",
  "IFCOUTLET",
  "IFCSWITCHINGDEVICE",
  "IFCELECTRICDISTRIBUTIONBOARD",
  "IFCJUNCTIONBOX",
  "IFCELECTRICAPPLIANCE",
  "IFCCOMMUNICATIONSAPPLIANCE",
  "IFCALARM",
  "IFCSENSOR",
  "IFCSANITARYTERMINAL",
  "IFCVALVE",
  "IFCPUMP",
  "IFCTANK",
  "IFCFLOWMETER",
  "IFCFIRESUPPRESSIONTERMINAL",
  "IFCAIRTERMINAL",
  "IFCUNITARYEQUIPMENT",
  "IFCFAN",
  "IFCFURNITURE",
];
const SYSTEM_TYPES = ["NOTDEFINED", "ELECTRICAL", "LIGHTING", "COMMUNICATION", "SECURITY", "DOMESTICCOLDWATER", "DOMESTICHOTWATER", "SEWAGE", "RAINWATER", "FIREPROTECTION", "GAS", "VENTILATION", "AIRCONDITIONING"];
const PARAM_PRESETS: ComponentParam[] = [
  { name: "Potência", unit: "W", default: 0 },
  { name: "Potência", unit: "VA", default: 0 },
  { name: "Tensão", unit: "V", default: 220 },
  { name: "Corrente", unit: "A", default: 0 },
  { name: "Circuito", default: "" },
  { name: "Vazão", unit: "m³/h", default: 0 },
  { name: "Diâmetro", unit: "mm", default: 0 },
  { name: "Capacidade", unit: "BTU/h", default: 0 },
  { name: "Grau de proteção", default: "IP20" },
];
const COLORS = ["#9aa3ad", "#e5e7eb", "#475569", "#f59e0b", "#2563eb", "#16a34a", "#dc2626", "#7c3aed"];

const snapTo = (v: number, g: number) => Math.round(v / g) * g;
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
const newSolidId = () => Math.random().toString(36).slice(2, 9);

function pointInPoly(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shapeLabel(s: DesignSolid): string {
  const t = s.perfil.t === "ret" ? "Retângulo" : s.perfil.t === "circ" ? "Círculo" : "Polígono";
  return `${t} · ${VIEW_LABEL[s.vista]}`;
}

export function ElementEditor({ initial, onCancel, onSave }: Props) {
  const [d, setD] = useState<ElementDesign>(initial);
  const [view, setView] = useState<DesignView>("frente");
  const [tool, setTool] = useState<DrawTool>(initial.solids.length ? "sel" : "ret");
  const [grid, setGrid] = useState(10);
  const [depth, setDepth] = useState(50);
  const [color, setColor] = useState(COLORS[0]);
  const [sel, setSel] = useState<string | null>(null);
  const [pts, setPts] = useState<P2[]>([]);
  const [cursor, setCursor] = useState<{ p: P2; snapped: boolean; kind?: SnapMode } | null>(null);
  const aids = useDrawAids();
  const [vb, setVb] = useState({ x: -250, y: -250, w: 500, h: 500 });
  const [tried, setTried] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "pan" | "move"; start: P2; client: P2; vb: typeof vb; solids?: DesignSolid[]; moved: boolean } | null>(null);

  const patch = (p: Partial<ElementDesign>) => setD((cur) => ({ ...cur, ...p }));
  const setSolids = (fn: (s: DesignSolid[]) => DesignSolid[]) => setD((cur) => ({ ...cur, solids: fn(cur.solids) }));
  const problems = useMemo(() => checkDesign(d), [d]);
  const flip = view !== "planta"; // Y para cima nas vistas de frente e lateral
  const toSvg = ([u, v]: P2): P2 => [u, flip ? -v : v];
  const silhouettes = useMemo(() => d.solids.map((s) => ({ s, poly: solidSilhouette(s, view) as P2[] })), [d.solids, view]);

  // ---- Conversões e encaixe ----
  const toModel = (clientX: number, clientY: number): P2 => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const q = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [q.x, flip ? -q.y : q.y];
  };
  const pxToMm = () => {
    const m = svgRef.current?.getScreenCTM();
    return m ? 1 / m.a : 1;
  };
  // Encaixe a objetos e ortogonal (os mesmos da barra de status); sem encaixe, a grade.
  const snapGeom = useMemo((): SnapGeometry => {
    const g: SnapGeometry = { segs: [], circles: [], points: [[0, 0]], centers: [], quads: [] };
    for (const { s, poly } of silhouettes) {
      if (s.perfil.t === "circ" && s.vista === view) {
        g.circles.push({ c: [s.perfil.cx, s.perfil.cy], r: s.perfil.r });
        continue;
      }
      poly.forEach((q, i) => g.segs.push([q, poly[(i + 1) % poly.length]]));
    }
    return g;
  }, [silhouettes, view]);
  const resolve = (clientX: number, clientY: number, shift = false): { p: P2; snapped: boolean; kind?: SnapMode } => {
    const raw = toModel(clientX, clientY);
    const tol = 8 * pxToMm();
    const modes = activeSnaps(aids);
    // Retângulo por cantos opostos fica fora do ortogonal (o segundo canto ficaria sem área).
    const anchor = tool === "ret" ? undefined : pts[pts.length - 1];
    const g: SnapGeometry = { ...snapGeom, points: [...snapGeom.points, ...pts], segs: [...snapGeom.segs, ...pts.slice(1).map((q, i): [P2, P2] => [pts[i], q])] };
    const grid2 = (q: P2): P2 => [snapTo(q[0], grid), snapTo(q[1], grid)];
    if (anchor && aids.ortho !== shift) {
      const r = orthoSnap(raw, anchor, g, modes, tol);
      return r.snap ? { p: r.p, snapped: true, kind: r.snap.kind } : { p: orthoPoint(grid2(raw), anchor).p, snapped: false };
    }
    const sn = findSnap(raw, g, modes, tol, anchor);
    return sn ? { p: sn.p, snapped: true, kind: sn.kind } : { p: grid2(raw), snapped: false };
  };
  const hitSolid = (p: P2): string | null => {
    // Os desenhados nesta vista têm prioridade sobre as silhuetas dos outros.
    const order = [...silhouettes].reverse().sort((a, b) => Number(b.s.vista === view) - Number(a.s.vista === view));
    return order.find((x) => pointInPoly(p, x.poly))?.s.id ?? null;
  };

  const addSolid = (perfil: Profile2) => {
    const s: DesignSolid = { id: newSolidId(), vista: view, perfil, de: 0, ate: depth, cor: color };
    setSolids((l) => [...l, s]);
    setSel(s.id);
  };
  const finishPoly = () => {
    if (pts.length >= 3) addSolid({ t: "poli", pts });
    setPts([]);
  };

  // ---- Enquadrar ----
  const fit = () => {
    const all = silhouettes.flatMap((x) => x.poly.map(toSvg));
    if (!all.length) return setVb({ x: -250, y: -250, w: 500, h: 500 });
    const xs = all.map((q) => q[0]);
    const ys = all.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs, 0), Math.max(...xs, 0), Math.min(...ys, 0), Math.max(...ys, 0)];
    const s = Math.max(x1 - x0, y1 - y0, 100) * 1.4;
    setVb({ x: (x0 + x1) / 2 - s / 2, y: (y0 + y1) / 2 - s / 2, w: s, h: s });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [view]);

  // ---- Ponteiro ----
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    svgRef.current?.setPointerCapture(e.pointerId);
    const raw = toModel(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      drag.current = { kind: "pan", start: raw, client: [e.clientX, e.clientY], vb, moved: false };
      return;
    }
    if (e.button !== 0) return;
    if (tool === "sel") {
      const id = hitSolid(raw);
      setSel(id);
      if (id) drag.current = { kind: "move", start: raw, client: [e.clientX, e.clientY], vb, solids: d.solids, moved: false };
      else drag.current = { kind: "pan", start: raw, client: [e.clientX, e.clientY], vb, moved: false };
      return;
    }
    const { p } = resolve(e.clientX, e.clientY, e.shiftKey);
    if (tool === "ret" || tool === "circ") {
      if (!pts.length) return setPts([p]);
      const a = pts[0];
      if (tool === "ret" && Math.abs(p[0] - a[0]) > 0.5 && Math.abs(p[1] - a[1]) > 0.5) addSolid({ t: "ret", x0: a[0], y0: a[1], x1: p[0], y1: p[1] });
      if (tool === "circ" && Math.hypot(p[0] - a[0], p[1] - a[1]) > 0.5) addSolid({ t: "circ", cx: a[0], cy: a[1], r: Math.round(Math.hypot(p[0] - a[0], p[1] - a[1]) * 10) / 10 });
      return setPts([]);
    }
    // Polígono: clicar no primeiro ponto fecha.
    if (pts.length >= 3 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 1e-6) return finishPoly();
    if (pts.length && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) < 1e-6) return;
    setPts([...pts, p]);
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const g = drag.current;
    if (g && e.buttons) {
      if (Math.hypot(e.clientX - g.client[0], e.clientY - g.client[1]) > 3) g.moved = true;
      if (!g.moved) return;
      if (g.kind === "pan") {
        const k = pxToMm();
        setVb({ ...g.vb, x: g.vb.x - (e.clientX - g.client[0]) * k, y: g.vb.y - (e.clientY - g.client[1]) * k });
      } else {
        const raw = toModel(e.clientX, e.clientY);
        let du = snapTo(raw[0] - g.start[0], grid);
        let dv = snapTo(raw[1] - g.start[1], grid);
        if (aids.ortho !== e.shiftKey) Math.abs(du) >= Math.abs(dv) ? (dv = 0) : (du = 0);
        const dd = viewToElement(view, du, dv, 0);
        setD((cur) => ({ ...cur, solids: g.solids!.map((s) => (s.id === sel ? moveSolid(s, dd) : s)) }));
      }
      return;
    }
    setCursor(tool === "sel" ? null : resolve(e.clientX, e.clientY, e.shiftKey));
  };
  const onUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const k = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(Math.max(vb.w * k, 20), 20000);
    const s = w / vb.w;
    setVb({ x: q.x - (q.x - vb.x) * s, y: q.y - (q.y - vb.y) * s, w, h: vb.h * s });
  };

  // ---- Teclado (o editor fica por cima do app: as teclas não vão para a planta) ----
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) {
      if (e.key === "Escape") (t as HTMLInputElement).blur();
      return;
    }
    e.stopImmediatePropagation();
    if (e.key === "Escape") {
      if (pts.length) setPts([]);
      else if (tool !== "sel") setTool("sel");
      else setSel(null);
    } else if (e.key === "Enter" && tool === "poli") finishPoly();
    else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      setSolids((l) => l.filter((s) => s.id !== sel));
      setSel(null);
    } else if (e.key.startsWith("Arrow") && sel) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : grid;
      const [du, dv] = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, flip ? step : -step] : [0, flip ? -step : step];
      const dd = viewToElement(view, du, dv, 0);
      setSolids((l) => l.map((s) => (s.id === sel ? moveSolid(s, dd) : s)));
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  // ---- Base (classificação de um componente de fábrica) ----
  const builtins = COMPONENTS.slice(0, BUILTIN_COUNT);
  const applyBase = (id: string) => {
    const b = builtins.find((c) => c.id === id);
    if (!b) return patch({ like: undefined });
    setD((cur) => {
      const names = new Set(cur.params.map((p) => `${p.name}|${p.unit ?? ""}`));
      return {
        ...cur,
        like: b.id,
        group: b.group,
        discipline: b.discipline,
        ifcType: b.ifcType,
        predefinedType: b.predefinedType,
        mounting: b.mounting,
        defaultHeight: b.defaultHeight,
        system: b.system,
        systemType: b.systemType,
        tagPrefix: b.tagPrefix,
        params: [...cur.params, ...b.params.filter((p) => !names.has(`${p.name}|${p.unit ?? ""}`)).map((p) => ({ ...p }))],
      };
    });
  };
  const setParam = (i: number, p: Partial<ComponentParam>) => patch({ params: d.params.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const selSolid = d.solids.find((s) => s.id === sel) ?? null;
  const [ua, va, wa] = VIEW_AXES[view];
  const save = (place: boolean) => {
    setTried(true);
    if (problems.length) return;
    onSave(
      {
        ...d,
        label: d.label.trim(),
        params: d.params.map((p) => {
          const n = typeof p.default === "string" && p.default.trim() !== "" && !Number.isNaN(Number(p.default.replace(",", "."))) ? Number(p.default.replace(",", ".")) : p.default;
          return { ...p, name: p.name.trim(), unit: p.unit?.trim() || undefined, default: n };
        }),
      },
      place,
    );
  };

  // ---- Desenho ----
  const tolPx = pxToMm();
  const sw = 1.5 * tolPx;
  const gridLines = useMemo(() => {
    const g = grid * (vb.w / grid > 120 ? Math.ceil(vb.w / grid / 120) : 1);
    const out: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    const big = vb.w * 2;
    for (let x = Math.floor((vb.x - vb.w) / g) * g; x <= vb.x + big; x += g) out.push({ x1: x, y1: vb.y - vb.h, x2: x, y2: vb.y + big, major: Math.abs(x / (g * 5) - Math.round(x / (g * 5))) < 1e-6 });
    for (let y = Math.floor((vb.y - vb.h) / g) * g; y <= vb.y + big; y += g) out.push({ x1: vb.x - vb.w, y1: y, x2: vb.x + big, y2: y, major: Math.abs(y / (g * 5) - Math.round(y / (g * 5))) < 1e-6 });
    return out;
  }, [grid, vb]);
  const previewPoly = (): P2[] | null => {
    const c = cursor?.p;
    if (!c || !pts.length) return null;
    const a = pts[0];
    if (tool === "ret") return [a, [c[0], a[1]], c, [a[0], c[1]]];
    if (tool === "circ") return profilePolygon({ t: "circ", cx: a[0], cy: a[1], r: Math.hypot(c[0] - a[0], c[1] - a[1]) }) as P2[];
    if (tool === "poli") return [...pts, c];
    return null;
  };
  const pv = previewPoly();
  const wallGuide = d.mounting === "parede" && (view === "planta" || view === "lateral");

  return (
    <div className="element-editor" role="dialog" aria-label="Editor de elemento">
      <header className="ee-head">
        <h2>{initial.label ? `Editar elemento: ${initial.label}` : "Novo elemento"}</h2>
        <div className="spacer" />
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn" onClick={() => save(false)}>
          Salvar
        </button>
        <button className="btn primary" onClick={() => save(true)}>
          Salvar e locar
        </button>
      </header>
      <div className="ee-body">
        {/* ---- Identificação e parâmetros ---- */}
        <aside className="ee-side panel-body">
          <section className="card">
            <h3>Identificação</h3>
            <div className="form-grid one">
              <label>
                Nome
                <input autoFocus value={d.label} placeholder="ex.: Tomada industrial 3P+T" onChange={(e) => patch({ label: e.target.value })} />
              </label>
              <label title="Copia a classificação IFC, o sistema, a fixação e os parâmetros de um elemento de fábrica">
                Basear em
                <select value={d.like ?? ""} onChange={(e) => applyBase(e.target.value)}>
                  <option value="">(genérico)</option>
                  {[...new Set(builtins.map((c) => c.group))].map((g) => (
                    <optgroup key={g} label={g}>
                      {builtins
                        .filter((c) => c.group === g)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>
                Grupo da biblioteca
                <input value={d.group} onChange={(e) => patch({ group: e.target.value })} />
              </label>
              <label>
                Disciplina
                <select value={d.discipline} onChange={(e) => patch({ discipline: e.target.value as Discipline })}>
                  {DISCIPLINES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fixação
                <select value={d.mounting} onChange={(e) => patch({ mounting: e.target.value as Mounting })}>
                  {(["parede", "teto", "piso"] as Mounting[]).map((m) => (
                    <option key={m} value={m}>
                      {MOUNTING_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label title={d.mounting === "parede" ? "Altura do centro acima do piso" : d.mounting === "teto" ? "Afastamento abaixo do teto/forro" : "Altura da base acima do piso"}>
                {d.mounting === "parede" ? "Altura do centro (mm)" : d.mounting === "teto" ? "Abaixo do teto (mm)" : "Base acima do piso (mm)"}
                <input type="number" step={10} value={d.defaultHeight} onChange={(e) => patch({ defaultHeight: Number(e.target.value) || 0 })} />
              </label>
              <label>
                Prefixo da etiqueta
                <input value={d.tagPrefix} onChange={(e) => patch({ tagPrefix: e.target.value.toUpperCase() })} />
              </label>
              <label>
                Função (equivalentes)
                <input value={d.funcao ?? ""} placeholder={d.label || "igual ao nome"} onChange={(e) => patch({ funcao: e.target.value })} />
              </label>
              <label>
                Fabricante
                <input value={d.brand ?? ""} onChange={(e) => patch({ brand: e.target.value })} />
              </label>
              <label>
                Modelo
                <input value={d.model ?? ""} onChange={(e) => patch({ model: e.target.value })} />
              </label>
            </div>
          </section>
          <section className="card">
            <h3>IFC e sistema</h3>
            <div className="form-grid one">
              <label>
                Entidade IFC
                <input list="ee-ifc" value={d.ifcType} onChange={(e) => patch({ ifcType: e.target.value.toUpperCase() })} />
                <datalist id="ee-ifc">
                  {[...new Set([...IFC_TYPES, ...COMPONENTS.map((c) => c.ifcType)])].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label>
                Tipo predefinido
                <input value={d.predefinedType} onChange={(e) => patch({ predefinedType: e.target.value.toUpperCase() })} />
              </label>
              <label>
                Sistema
                <input value={d.system} onChange={(e) => patch({ system: e.target.value })} />
              </label>
              <label>
                Tipo de sistema (IFC)
                <select value={d.systemType} onChange={(e) => patch({ systemType: e.target.value })}>
                  {[...new Set([d.systemType, ...SYSTEM_TYPES])].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="card">
            <div className="panel-head">
              <h3>Parâmetros ({d.params.length})</h3>
              <button className="link" onClick={() => patch({ params: [...d.params, { name: "", default: "" }] })}>
                + parâmetro
              </button>
            </div>
            {d.params.length > 0 && (
              <div className="ee-params">
                <span className="muted small">Nome</span>
                <span className="muted small">Unid.</span>
                <span className="muted small">Valor padrão</span>
                <span />
                {d.params.map((p, i) => (
                  <ParamRow key={i} p={p} onChange={(x) => setParam(i, x)} onRemove={() => patch({ params: d.params.filter((_, j) => j !== i) })} />
                ))}
              </div>
            )}
            <div className="chip-row">
              {PARAM_PRESETS.filter((p) => !d.params.some((x) => x.name === p.name && (x.unit ?? "") === (p.unit ?? ""))).map((p) => (
                <button key={`${p.name}${p.unit}`} className="chip" onClick={() => patch({ params: [...d.params, { ...p }] })}>
                  + {p.name}
                  {p.unit ? ` (${p.unit})` : ""}
                </button>
              ))}
            </div>
            <p className="muted small">Os parâmetros aparecem nas propriedades de cada ponto locado, nos quantitativos e no IFC exportado.</p>
          </section>
        </aside>

        {/* ---- Desenho 2D ---- */}
        <main className="ee-draw">
          <div className="ee-toolbar">
            <div className="segmented small">
              {(["planta", "frente", "lateral"] as DesignView[]).map((v) => (
                <button key={v} className={view === v ? "on" : ""} onClick={() => (setView(v), setPts([]))}>
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
            <div className="segmented small">
              {(
                [
                  ["sel", "Selecionar"],
                  ["ret", "Retângulo"],
                  ["circ", "Círculo"],
                  ["poli", "Polígono"],
                ] as [DrawTool, string][]
              ).map(([k, l]) => (
                <button key={k} className={tool === k ? "on" : ""} onClick={() => (setTool(k), setPts([]))}>
                  {l}
                </button>
              ))}
            </div>
            <label className="inline-row small">
              Profundidade
              <input type="number" step={5} min={1} value={depth} onChange={(e) => setDepth(Math.max(1, Number(e.target.value) || 1))} />
              mm
            </label>
            <label className="inline-row small">
              Grade
              <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
                {[1, 5, 10, 25, 50, 100].map((g) => (
                  <option key={g} value={g}>
                    {g} mm
                  </option>
                ))}
              </select>
            </label>
            <span className="ee-colors">
              {COLORS.map((c) => (
                <button key={c} className={`swatch ${color === c ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => (setColor(c), selSolid && setSolids((l) => l.map((s) => (s.id === sel ? { ...s, cor: c } : s))))} />
              ))}
            </span>
            <button className="btn small-btn" onClick={fit}>
              Enquadrar
            </button>
            <DrawAidsBar up={false} />
          </div>
          <div className="ee-canvas">
            <svg
              ref={svgRef}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              width="100%"
              height="100%"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => setCursor(null)}
              onWheel={onWheel}
              onDoubleClick={() => tool === "poli" && finishPoly()}
              onContextMenu={(e) => e.preventDefault()}
              className={tool === "sel" ? "sel" : "draw"}
            >
              {gridLines.map((l, i) => (
                <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.major ? "#cbd5e1" : "#eef2f6"} strokeWidth={sw * 0.5} />
              ))}
              <line x1={vb.x - vb.w} y1={0} x2={vb.x + vb.w * 2} y2={0} stroke="#ef4444" strokeWidth={sw * 0.6} strokeDasharray={`${8 * tolPx} ${4 * tolPx}`} />
              <line x1={0} y1={vb.y - vb.h} x2={0} y2={vb.y + vb.h * 2} stroke="#22c55e" strokeWidth={sw * 0.6} strokeDasharray={`${8 * tolPx} ${4 * tolPx}`} />
              {wallGuide && (
                <>
                  {view === "planta" ? (
                    <rect x={vb.x - vb.w} y={-30 * tolPx} width={vb.w * 3} height={30 * tolPx} fill="url(#ee-hatch)" />
                  ) : (
                    <rect x={-30 * tolPx} y={vb.y - vb.h} width={30 * tolPx} height={vb.h * 3} fill="url(#ee-hatch)" />
                  )}
                  <text x={view === "planta" ? vb.x + 8 * tolPx : -26 * tolPx} y={view === "planta" ? -10 * tolPx : vb.y + 20 * tolPx} fontSize={11 * tolPx} fill="#64748b">
                    parede
                  </text>
                </>
              )}
              <defs>
                <pattern id="ee-hatch" width={8 * tolPx} height={8 * tolPx} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1={0} y1={0} x2={0} y2={8 * tolPx} stroke="#94a3b8" strokeWidth={sw * 0.6} />
                </pattern>
              </defs>
              {silhouettes.map(({ s, poly }) => {
                const own = s.vista === view;
                return (
                  <polygon
                    key={s.id}
                    points={poly.map((q) => toSvg(q).join(",")).join(" ")}
                    fill={s.cor}
                    fillOpacity={own ? 0.55 : 0.18}
                    stroke={s.id === sel ? "#2563eb" : own ? "#1e293b" : "#64748b"}
                    strokeWidth={s.id === sel ? sw * 1.6 : sw}
                    strokeDasharray={own ? undefined : `${5 * tolPx} ${3 * tolPx}`}
                    data-solid={s.id}
                  />
                );
              })}
              {pv && <polygon points={pv.map((q) => toSvg(q).join(",")).join(" ")} fill={color} fillOpacity={0.3} stroke="#7c3aed" strokeWidth={sw} strokeDasharray={`${4 * tolPx} ${3 * tolPx}`} />}
              {pts.map((q, i) => (
                <circle key={i} cx={toSvg(q)[0]} cy={toSvg(q)[1]} r={3 * tolPx} fill="#7c3aed" />
              ))}
              {cursor && (
                <rect
                  x={toSvg(cursor.p)[0] - 4 * tolPx}
                  y={toSvg(cursor.p)[1] - 4 * tolPx}
                  width={8 * tolPx}
                  height={8 * tolPx}
                  fill="none"
                  stroke={cursor.snapped ? "#f59e0b" : "#7c3aed"}
                  strokeWidth={sw}
                />
              )}
              {cursor?.kind && (
                <text x={toSvg(cursor.p)[0] + 8 * tolPx} y={toSvg(cursor.p)[1] + 18 * tolPx} fontSize={11 * tolPx} fill="#b45309" stroke="#fff" strokeWidth={3 * tolPx} paintOrder="stroke">
                  {SNAP_LABEL[cursor.kind]}
                </text>
              )}
            </svg>
            <div className="ee-hint muted small">
              {tool === "ret"
                ? pts.length
                  ? "Clique no canto oposto"
                  : "Clique no primeiro canto do retângulo"
                : tool === "circ"
                  ? pts.length
                    ? "Clique para definir o raio"
                    : "Clique no centro do círculo"
                  : tool === "poli"
                    ? "Clique nos vértices; Enter, duplo clique ou clique no primeiro ponto fecha"
                    : "Clique num sólido para selecionar e arraste para mover (setas: passo da grade; Delete apaga)"}
              {" · "}
              {VIEW_LABEL[view]}: horizontal {ua}, vertical {va}, profundidade {wa} · botão direito ou do meio: deslocar · roda: zoom · Esc
              {cursor && ` · ${fmt(cursor.p[0])} ; ${fmt(cursor.p[1])} mm`}
            </div>
          </div>
        </main>

        {/* ---- 3D e sólidos ---- */}
        <aside className="ee-side right panel-body">
          <Preview3D solids={d.solids} selected={sel} />
          <section className="card">
            <h3>Sólidos ({d.solids.length})</h3>
            {d.solids.length === 0 && <p className="muted small">Escolha uma vista e desenhe um retângulo, círculo ou polígono: ele vira um sólido com a profundidade indicada na barra.</p>}
            <ul className="sel-list">
              {d.solids.map((s, i) => (
                <li key={s.id} className={s.id === sel ? "on" : ""} onClick={() => (setSel(s.id), setView(s.vista))}>
                  <span className="dot" style={{ background: s.cor }} />
                  <span className="grow">
                    {i + 1}. {shapeLabel(s)}
                  </span>
                  <button
                    className="link"
                    title="Duplicar"
                    onClick={(e) => {
                      e.stopPropagation();
                      const c = { ...moveSolid(s, viewToElement(s.vista, grid * 2, 0, 0)), id: newSolidId() };
                      setSolids((l) => [...l, c]);
                      setSel(c.id);
                    }}
                  >
                    duplicar
                  </button>
                  <button
                    className="link danger-link"
                    title="Apagar"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSolids((l) => l.filter((x) => x.id !== s.id));
                      if (sel === s.id) setSel(null);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {selSolid && <SolidFields s={selSolid} onChange={(n) => setSolids((l) => l.map((x) => (x.id === n.id ? n : x)))} />}
          </section>
          {tried && problems.length > 0 && (
            <section className="card warn-card">
              <h3>Antes de salvar</h3>
              <ul className="small">
                {problems.map((p, i) => (
                  <li key={i}>{p.text}</li>
                ))}
              </ul>
            </section>
          )}
          <SizeSummary solids={d.solids} />
        </aside>
      </div>
    </div>
  );
}

function ParamRow({ p, onChange, onRemove }: { p: ComponentParam; onChange: (p: Partial<ComponentParam>) => void; onRemove: () => void }) {
  return (
    <>
      <input value={p.name} placeholder="nome" onChange={(e) => onChange({ name: e.target.value })} />
      <input value={p.unit ?? ""} placeholder="—" onChange={(e) => onChange({ unit: e.target.value })} />
      <input value={String(p.default)} onChange={(e) => onChange({ default: e.target.value })} />
      <button className="link danger-link" title="Remover parâmetro" onClick={onRemove}>
        ✕
      </button>
    </>
  );
}

function Num({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label>
      {label}
      <input type="number" step={1} min={min} value={Math.round(value * 10) / 10} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

function SolidFields({ s, onChange }: { s: DesignSolid; onChange: (s: DesignSolid) => void }) {
  const [ua, va, wa] = VIEW_AXES[s.vista].map((a) => a.split(" ")[0]);
  const p = s.perfil;
  const set = (perfil: Profile2) => onChange({ ...s, perfil });
  return (
    <div className="form-grid">
      {p.t === "ret" && (
        <>
          <Num label={`${ua} início`} value={Math.min(p.x0, p.x1)} onChange={(v) => set({ ...p, x0: v, x1: Math.max(p.x0, p.x1) })} />
          <Num label={`${ua} fim`} value={Math.max(p.x0, p.x1)} onChange={(v) => set({ ...p, x0: Math.min(p.x0, p.x1), x1: v })} />
          <Num label={`${va} início`} value={Math.min(p.y0, p.y1)} onChange={(v) => set({ ...p, y0: v, y1: Math.max(p.y0, p.y1) })} />
          <Num label={`${va} fim`} value={Math.max(p.y0, p.y1)} onChange={(v) => set({ ...p, y0: Math.min(p.y0, p.y1), y1: v })} />
        </>
      )}
      {p.t === "circ" && (
        <>
          <Num label={`Centro ${ua}`} value={p.cx} onChange={(v) => set({ ...p, cx: v })} />
          <Num label={`Centro ${va}`} value={p.cy} onChange={(v) => set({ ...p, cy: v })} />
          <Num label="Raio" min={1} value={p.r} onChange={(v) => set({ ...p, r: Math.max(0.5, v) })} />
        </>
      )}
      {p.t === "poli" && <p className="muted small span2">Polígono de {p.pts.length} vértices: mova arrastando na vista.</p>}
      <Num label={`${wa} de (mm)`} value={s.de} onChange={(v) => onChange({ ...s, de: v })} />
      <Num label={`${wa} até (mm)`} value={s.ate} onChange={(v) => onChange({ ...s, ate: v })} />
      <label>
        Cor
        <input type="color" value={s.cor} onChange={(e) => onChange({ ...s, cor: e.target.value })} />
      </label>
    </div>
  );
}

function SizeSummary({ solids }: { solids: DesignSolid[] }) {
  const m = useMemo(() => designMesh(solids), [solids]);
  if (!m) return null;
  return (
    <p className="muted small">
      Tamanho: {m.size[0]} × {m.size[1]} × {m.size[2]} mm (largura × profundidade × altura). O símbolo de planta é o contorno visto de cima.
    </p>
  );
}

/** Prévia 3D do elemento (gira com o mouse). */
function Preview3D({ solids, selected }: { solids: DesignSolid[]; selected: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group; render: () => void } | null>(null);
  const fitted = useRef(false);
  const [fitN, setFitN] = useState(0);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf8fafc);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 100000);
    camera.position.set(600, 450, 800);
    const controls = new OrbitControls(camera, renderer.domElement);
    const group = new THREE.Group();
    scene.add(group, new THREE.AxesHelper(100));
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    ctx.current = { renderer, scene, camera, controls, group, render };
    resize();
    return () => {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    c.group.clear();
    // Cada sólido em separado, para destacar o selecionado; posições sem centralizar (como no desenho).
    for (const s of solids) {
      const m = designMesh([s]);
      if (!m) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.mesh.positions, 3));
      g.setIndex(new THREE.BufferAttribute(m.mesh.indices, 1));
      const flat = g.toNonIndexed();
      g.dispose();
      flat.computeVertexNormals();
      const mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ color: s.cor, roughness: 0.7, metalness: 0.05, emissive: s.id === selected ? 0x1d4ed8 : 0x000000, emissiveIntensity: 0.35 }));
      mesh.position.set(...m.center);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(flat, 25), new THREE.LineBasicMaterial({ color: s.id === selected ? 0x1d4ed8 : 0x1e293b }));
      edges.position.copy(mesh.position);
      c.group.add(mesh, edges);
    }
    const box = new THREE.Box3().setFromObject(c.group);
    if (!box.isEmpty() && !fitted.current) {
      fitted.current = true;
      const center = box.getCenter(new THREE.Vector3());
      const r = Math.max(box.getSize(new THREE.Vector3()).length(), 100);
      c.controls.target.copy(center);
      c.camera.position.copy(center).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(r * 1.6));
      c.controls.update();
    }
    c.render();
  }, [solids, selected, fitN]);

  return (
    <section className="card">
      <div className="panel-head">
        <h3>3D</h3>
        <button className="link" onClick={() => ((fitted.current = false), setFitN((n) => n + 1))}>
          enquadrar
        </button>
      </div>
      <div ref={host} className="ee-3d" />
      <p className="muted small">X vermelho (largura), Y verde (altura), Z azul (para fora). Arraste para girar.</p>
    </section>
  );
}
