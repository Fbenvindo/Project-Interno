// Vistas do projeto, separadas em duas seções:
// - Trabalho: tudo visível (modelo principal, vínculos e todas as disciplinas);
// - Documentação: só as disciplinas do projeto (as do IFC que este projeto entrega), com
//   a opção de trazer outras disciplinas em meio-tom como informação. É o que vai para as folhas.
// Tipos: planta do pavimento, ampliação (recorte de uma planta em escala maior), corte e vista 3D.
import { DISCIPLINES, MEP_DISCIPLINES } from "./disciplines";
import type { LegendItem, Prim } from "./plan/drawing";
import { PRINT_COLOR, LAYER_PREFIX } from "./plan/drawing";
import type { PlanLabels } from "./plan/build";
import type { P2 } from "./plan/section";
import type { Discipline, Vec3 } from "./types";

export type ViewSection = "trabalho" | "documentacao";
export type ViewKind = "planta" | "ampliacao" | "corte" | "3d";

export const SECTION_LABEL: Record<ViewSection, string> = { trabalho: "Trabalho", documentacao: "Documentação" };
export const KIND_LABEL: Record<ViewKind, string> = { planta: "Plantas", ampliacao: "Ampliações", corte: "Cortes", "3d": "Vistas 3D" };

export interface ClipPlaneDef {
  normal: Vec3;
  point: Vec3;
}

/** Corte vertical: linha a→b na planta (coordenadas do projeto); olha para o lado `side` da linha. */
export interface CutDef {
  a: P2;
  b: P2;
  /** +1: lado esquerdo de a→b; −1: lado direito. */
  side: 1 | -1;
  /** Profundidade de vista além do plano de corte (m). */
  depth: number;
}

export interface ViewDef {
  id: string;
  name: string;
  kind: ViewKind;
  section: ViewSection;
  /** Pavimento (plantas e ampliações). */
  storey?: string;
  /** Escala (denominador) na folha. */
  scale: number;
  /** Altura do plano de corte da planta (m acima do piso). */
  cutHeight?: number;
  /** Ampliação: retângulo da planta (coordenadas do projeto). */
  region?: { min: P2; max: P2 };
  cut?: CutDef;
  /** Vista 3D (coordenadas da cena) e planos de recorte. */
  eye?: Vec3;
  target?: Vec3;
  clip?: ClipPlaneDef[];
  /** Vista 3D sem câmera definida: enquadra esta caixa (cena). */
  frame?: { min: Vec3; max: Vec3 };
  /** Documentação: outras disciplinas exibidas como informação (meio-tom). */
  refDisciplines?: Discipline[];
  /** Documentação: arquitetura/estrutura como fundo (padrão: sim, em meio-tom). */
  background?: boolean;
  halftoneBackground?: boolean;
  /** Textos da planta. */
  labels?: PlanLabels;
  /** Documentação: inclui também as anotações feitas na planta de trabalho. */
  workNotes?: boolean;
  /** Plantas: de piso (vigas da laje de baixo) ou de teto (vigas do pavimento de cima). */
  planType?: "piso" | "teto";
  /** Vigas em projeção e o texto de cada uma (podem ser ocultados separadamente). */
  showBeams?: boolean;
  showBeamText?: boolean;
}

export const DEFAULT_LABELS: PlanLabels = { tags: true, circuits: true, power: true, sizes: true };

let seq = 0;
export const newViewId = (kind: ViewKind) => `${kind}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Planta de documentação de um pavimento: id fixo, criada com valores padrão quando ainda não existe. */
export const docPlanId = (storey: string) => `doc-planta:${storey}`;
export function docPlanOf(views: ViewDef[], storey: string): ViewDef {
  return (
    views.find((v) => v.id === docPlanId(storey)) ?? {
      id: docPlanId(storey),
      name: `Planta — ${storey}`,
      kind: "planta",
      section: "documentacao",
      storey,
      scale: 50,
      cutHeight: 1.2,
      refDisciplines: [],
      background: true,
      halftoneBackground: true,
      labels: DEFAULT_LABELS,
    }
  );
}

/** Lê vistas de arquivos antigos (vistas 3D sem tipo nem seção). */
export function migrateViews(raw: unknown): ViewDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string")
    .map((v) => {
      const kind = (v.kind as ViewKind) ?? "3d";
      return { scale: kind === "ampliacao" ? 25 : 50, ...v, kind, section: (v.section as ViewSection) ?? "trabalho" } as ViewDef;
    });
}

// ---- Disciplinas exibidas -------------------------------------------------------------------

const BACKGROUND: Discipline[] = ["arquitetura", "estrutura", "outros"];

/**
 * Disciplinas do projeto (as que o IFC deste projeto entrega). Vazio = todas as de instalações.
 */
export function primaryDisciplines(project: Discipline[]): Discipline[] {
  return project.length ? project : MEP_DISCIPLINES;
}

export interface ViewFilter {
  /** Disciplinas desenhadas. */
  show: Set<Discipline>;
  /** Desenhadas em meio-tom (informação de outras disciplinas). */
  halftone: Set<Discipline>;
  /** Fundo (arquitetura/estrutura) em meio-tom. */
  halftoneBackground: boolean;
  /** Disciplinas principais (legenda). */
  primary: Set<Discipline>;
}

export function viewFilter(view: ViewDef | null, project: Discipline[]): ViewFilter {
  const all = new Set(DISCIPLINES.map((d) => d.id));
  if (!view || view.section === "trabalho") return { show: all, halftone: new Set(), halftoneBackground: false, primary: all };
  const primary = new Set(primaryDisciplines(project));
  const refs = new Set((view.refDisciplines ?? []).filter((d) => !primary.has(d)));
  const show = new Set<Discipline>([...primary, ...refs, ...(view.background === false ? [] : BACKGROUND)]);
  return { show, halftone: refs, halftoneBackground: view.background !== false && view.halftoneBackground !== false, primary };
}

const PREFIX_TO_DISC = new Map(Object.entries(LAYER_PREFIX).map(([d, p]) => [p, d as Discipline]));
export const disciplineOfLayer = (layer: string): Discipline | null => PREFIX_TO_DISC.get(layer.split("-")[0]) ?? null;

const HALF = "#9aa0a6";
const HALF_FILL = "#e3e3e3";
const HALF_BG = "#8c8c8c";

/** Aplica meio-tom às disciplinas de referência e, se pedido, ao fundo de arquitetura/estrutura. */
export function applyHalftone(prims: Prim[], f: ViewFilter): Prim[] {
  if (!f.halftone.size && !f.halftoneBackground) return prims;
  return prims.map((p) => {
    const d = disciplineOfLayer(p.layer);
    if (!d || p.layer.includes("VIGAS")) return p;
    if (f.halftone.has(d)) return { ...p, color: HALF, ...("fill" in p && p.fill ? { fill: HALF_FILL } : {}) } as Prim;
    if (f.halftoneBackground && BACKGROUND.includes(d)) return { ...p, color: HALF_BG, ...("fill" in p && p.fill ? { fill: HALF_FILL } : {}) } as Prim;
    return p;
  });
}

/** Legenda só das disciplinas principais (as de referência não entram). */
export function filterLegend(items: LegendItem[], f: ViewFilter): LegendItem[] {
  const refColors = new Set([...f.halftone].map((d) => PRINT_COLOR[d]));
  const primColors = new Set([...f.primary].map((d) => PRINT_COLOR[d]));
  return items.filter((i) => !refColors.has(i.color) || primColors.has(i.color));
}

// ---- Recorte em retângulo (ampliações) ---------------------------------------------------------

type Rect = { min: P2; max: P2 };

function clipSegment(a: P2, b: P2, r: Rect): [P2, P2] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const tests: [number, number][] = [
    [-dx, a[0] - r.min[0]],
    [dx, r.max[0] - a[0]],
    [-dy, a[1] - r.min[1]],
    [dy, r.max[1] - a[1]],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-15) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

const inside = (p: P2, r: Rect) => p[0] >= r.min[0] && p[0] <= r.max[0] && p[1] >= r.min[1] && p[1] <= r.max[1];

/** Polígono fechado recortado pelo retângulo (Sutherland–Hodgman). */
function clipPolygon(pts: P2[], r: Rect): P2[] {
  let out = pts;
  const edges: [(p: P2) => boolean, (a: P2, b: P2) => P2][] = [
    [(p) => p[0] >= r.min[0], (a, b) => lerpX(a, b, r.min[0])],
    [(p) => p[0] <= r.max[0], (a, b) => lerpX(a, b, r.max[0])],
    [(p) => p[1] >= r.min[1], (a, b) => lerpY(a, b, r.min[1])],
    [(p) => p[1] <= r.max[1], (a, b) => lerpY(a, b, r.max[1])],
  ];
  for (const [ins, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i];
      const prev = src[(i + src.length - 1) % src.length];
      if (ins(cur)) {
        if (!ins(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (ins(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
const lerpX = (a: P2, b: P2, x: number): P2 => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1e-12)];
const lerpY = (a: P2, b: P2, y: number): P2 => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12), y];

/** Primitivas recortadas pelo retângulo (linhas e contornos cortados; símbolos e textos pelo ponto de inserção). */
export function clipPrims(prims: Prim[], r: Rect): Prim[] {
  const out: Prim[] = [];
  for (const p of prims) {
    if (p.t === "line") {
      const s = clipSegment(p.a, p.b, r);
      if (s) out.push({ ...p, a: s[0], b: s[1] });
    } else if (p.t === "poly") {
      if (p.pts.every((q) => inside(q, r))) out.push(p);
      else if (p.closed && p.fill) {
        const pts = clipPolygon(p.pts, r);
        if (pts.length >= 3) out.push({ ...p, pts });
      } else {
        const n = p.pts.length;
        for (let i = 0; i < (p.closed ? n : n - 1); i++) {
          const s = clipSegment(p.pts[i], p.pts[(i + 1) % n], r);
          if (s) out.push({ t: "line", a: s[0], b: s[1], weight: p.weight, layer: p.layer, color: p.color, id: p.id, dashed: p.dashed, dashdot: p.dashdot });
        }
      }
    } else if (p.t === "circle") {
      if (inside(p.c, r)) out.push(p);
    } else if (inside(p.p, r)) out.push(p);
  }
  return out;
}

// ---- Marcas de ampliação e de corte nas plantas ---------------------------------------------------

const MARK = "#111827";

/**
 * Indicações, na planta de documentação de um pavimento, das ampliações (retângulo tracejado
 * com o nome) e dos cortes (linha traço-ponto com setas de direção e o nome) de documentação.
 */
export function viewMarkers(views: ViewDef[], storey: string, scale: number): Prim[] {
  const m = scale / 1000;
  const out: Prim[] = [];
  const base = { layer: "ANOT-VISTAS", color: MARK };
  for (const v of views) {
    if (v.section !== "documentacao") continue;
    if (v.kind === "ampliacao" && v.region && v.storey === storey) {
      const { min, max } = v.region;
      out.push({ t: "poly", pts: [min, [max[0], min[1]], max, [min[0], max[1]]], closed: true, weight: 0.25, dashed: true, ...base });
      out.push({ t: "text", p: [min[0], max[1] + 2.5 * m], text: v.name, height: 2.5 * m, anchor: "start", ...base });
    }
    if (v.kind === "corte" && v.cut && (!v.storey || v.storey === storey)) {
      const { a, b, side } = v.cut;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const n: P2 = [-u[1] * side, u[0] * side];
      const ext = 4 * m;
      const a2: P2 = [a[0] - u[0] * ext, a[1] - u[1] * ext];
      const b2: P2 = [b[0] + u[0] * ext, b[1] + u[1] * ext];
      out.push({ t: "line", a: a2, b: b2, weight: 0.35, dashdot: true, ...base });
      for (const e of [a2, b2]) {
        const tip: P2 = [e[0] + n[0] * 6 * m, e[1] + n[1] * 6 * m];
        out.push({ t: "line", a: e, b: tip, weight: 0.35, ...base });
        out.push({
          t: "poly",
          pts: [tip, [tip[0] - n[0] * 2 * m + u[0] * 1 * m, tip[1] - n[1] * 2 * m + u[1] * 1 * m], [tip[0] - n[0] * 2 * m - u[0] * 1 * m, tip[1] - n[1] * 2 * m - u[1] * 1 * m]],
          closed: true,
          weight: 0.18,
          fill: MARK,
          ...base,
        });
        out.push({ t: "text", p: [e[0] - u[0] * 3 * m * (e === a2 ? 1 : -1), e[1] - u[1] * 3 * m * (e === a2 ? 1 : -1)], text: shortName(v.name), height: 3 * m, anchor: "middle", ...base });
      }
    }
  }
  return out;
}

/** "Corte A — …" → "A". */
export const shortName = (name: string) => name.replace(/^corte\s+/i, "").split(/\s+[—-]\s+/)[0].slice(0, 6);

/** Próximo nome livre ("Corte A", "Corte B"…, "Ampliação 1"…). */
export function nextViewName(views: ViewDef[], kind: ViewKind, storey?: string): string {
  if (kind === "corte") {
    const used = new Set(views.filter((v) => v.kind === "corte").map((v) => shortName(v.name)));
    for (let i = 0; i < 26 * 27; i++) {
      const s = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
      if (!used.has(s)) return `Corte ${s}`;
    }
  }
  const label = kind === "ampliacao" ? "Ampliação" : kind === "3d" ? "Vista 3D" : "Planta";
  const n = views.filter((v) => v.kind === kind).length + 1;
  return `${label} ${n}${storey ? ` — ${storey}` : ""}`;
}

/** Opções de vigas de uma planta (padrão: planta de piso, vigas e textos visíveis). */
export const beamOptions = (v: Pick<ViewDef, "planType" | "showBeams" | "showBeamText"> | null) => ({
  mode: v?.planType ?? ("piso" as const),
  show: v?.showBeams !== false,
  text: v?.showBeamText !== false,
});
