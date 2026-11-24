// Elementos criados no próprio app: geometria desenhada por sólidos de extrusão (perfil 2D
// numa vista + profundidade) e parâmetros definidos pelo usuário.
// Eixos do elemento (mm), os mesmos das malhas importadas: X largura, Y altura, Z para fora
// (para o ambiente, nos itens de parede).
import type { ComponentDef, ComponentMesh, ComponentParam, Mounting } from "./library";
import type { Discipline } from "./types";

/** Vista em que o perfil é desenhado; a extrusão segue o eixo perpendicular a ela. */
export type DesignView = "planta" | "frente" | "lateral";

export type Profile2 =
  | { t: "ret"; x0: number; y0: number; x1: number; y1: number }
  | { t: "circ"; cx: number; cy: number; r: number }
  | { t: "poli"; pts: [number, number][] };

export interface DesignSolid {
  id: string;
  vista: DesignView;
  perfil: Profile2;
  /** Início e fim da extrusão (mm), no eixo perpendicular à vista. */
  de: number;
  ate: number;
  /** Cor (#rrggbb). */
  cor: string;
}

export interface ElementDesign {
  uid: string;
  label: string;
  group: string;
  discipline: Discipline;
  ifcType: string;
  predefinedType: string;
  mounting: Mounting;
  defaultHeight: number;
  system: string;
  systemType: string;
  tagPrefix: string;
  funcao?: string;
  brand?: string;
  model?: string;
  /** Componente de fábrica usado como base da classificação (símbolo, sistema…). */
  like?: string;
  params: ComponentParam[];
  solids: DesignSolid[];
  createdAt: string;
  updatedAt: string;
}

/** Nomes dos eixos de cada vista: [horizontal, vertical, extrusão]. */
export const VIEW_AXES: Record<DesignView, [string, string, string]> = {
  planta: ["X (largura)", "Z (para fora)", "Y (altura)"],
  frente: ["X (largura)", "Y (altura)", "Z (para fora)"],
  lateral: ["Z (para fora)", "Y (altura)", "X (largura)"],
};

export const VIEW_LABEL: Record<DesignView, string> = { planta: "Planta (de cima)", frente: "Frente", lateral: "Lateral" };

type V3 = [number, number, number];

/** (u, v) da vista + w da extrusão → eixos do elemento. */
export function viewToElement(view: DesignView, u: number, v: number, w: number): V3 {
  if (view === "planta") return [u, w, v];
  if (view === "frente") return [u, v, w];
  return [w, v, u];
}

/** Eixos do elemento → (u, v) da vista + w (profundidade). */
export function elementToView(view: DesignView, p: V3): V3 {
  if (view === "planta") return [p[0], p[2], p[1]];
  if (view === "frente") return [p[0], p[1], p[2]];
  return [p[2], p[1], p[0]];
}

/**
 * Silhueta do sólido numa vista: o próprio perfil na vista em que foi desenhado; nas outras,
 * o retângulo que o prisma ocupa (exato para extrusões vistas de lado).
 */
export function solidSilhouette(s: DesignSolid, view: DesignView): [number, number][] {
  const poly = profilePolygon(s.perfil);
  if (s.vista === view) return poly;
  let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [u, v] of poly)
    for (const w of [s.de, s.ate]) {
      const q = elementToView(view, viewToElement(s.vista, u, v, w));
      u0 = Math.min(u0, q[0]);
      u1 = Math.max(u1, q[0]);
      v0 = Math.min(v0, q[1]);
      v1 = Math.max(v1, q[1]);
    }
  return [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
}

/** Desloca um sólido por d (eixos do elemento, mm). */
export function moveSolid(s: DesignSolid, d: V3): DesignSolid {
  const [du, dv, dw] = elementToView(s.vista, d);
  const p = s.perfil;
  const perfil: Profile2 =
    p.t === "ret"
      ? { t: "ret", x0: p.x0 + du, y0: p.y0 + dv, x1: p.x1 + du, y1: p.y1 + dv }
      : p.t === "circ"
        ? { t: "circ", cx: p.cx + du, cy: p.cy + dv, r: p.r }
        : { t: "poli", pts: p.pts.map(([u, v]) => [u + du, v + dv]) };
  return { ...s, perfil, de: s.de + dw, ate: s.ate + dw };
}

/** Contorno do perfil (polígono, sentido anti-horário). Círculos viram 32 lados. */
export function profilePolygon(p: Profile2): [number, number][] {
  let pts: [number, number][];
  if (p.t === "ret") {
    const [x0, x1] = [Math.min(p.x0, p.x1), Math.max(p.x0, p.x1)];
    const [y0, y1] = [Math.min(p.y0, p.y1), Math.max(p.y0, p.y1)];
    pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  } else if (p.t === "circ") {
    const n = 32;
    pts = Array.from({ length: n }, (_, i): [number, number] => [p.cx + p.r * Math.cos((2 * Math.PI * i) / n), p.cy + p.r * Math.sin((2 * Math.PI * i) / n)]);
  } else {
    pts = p.pts.filter((q, i) => i === 0 || Math.hypot(q[0] - p.pts[i - 1][0], q[1] - p.pts[i - 1][1]) > 1e-6);
    if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
  }
  return signedArea(pts) < 0 ? pts.reverse() : pts;
}

export function signedArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Triangulação por orelhas de um polígono simples anti-horário (índices no polígono). */
export function triangulate(pts: [number, number][]): number[] {
  const idx = pts.map((_, i) => i);
  const out: number[] = [];
  const cross = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) =>
    cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const [a, b, c] = [pts[i0], pts[i1], pts[i2]];
      if (cross(a, b, c) <= 1e-9) continue; // reflexo ou degenerado
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c))) continue;
      out.push(i0, i1, i2);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) {
      // Polígono que se cruza: fecha em leque para não perder a forma.
      for (let k = 1; k + 1 < idx.length; k++) out.push(idx[0], idx[k], idx[k + 1]);
      return out;
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

export interface DesignProblem {
  solidId?: string;
  text: string;
}

/** Confere o elemento antes de salvar. */
export function checkDesign(d: ElementDesign): DesignProblem[] {
  const out: DesignProblem[] = [];
  if (!d.label.trim()) out.push({ text: "Dê um nome ao elemento." });
  if (!d.solids.length) out.push({ text: "Desenhe ao menos um sólido (retângulo, círculo ou polígono numa das vistas)." });
  for (const s of d.solids) {
    const poly = profilePolygon(s.perfil);
    if (poly.length < 3 || Math.abs(signedArea(poly)) < 1) out.push({ solidId: s.id, text: "Perfil sem área." });
    if (Math.abs(s.ate - s.de) < 0.5) out.push({ solidId: s.id, text: "Extrusão sem espessura: ajuste “de” e “até”." });
  }
  const names = new Set<string>();
  for (const p of d.params) {
    const n = p.name.trim();
    if (!n) out.push({ text: "Há um parâmetro sem nome." });
    else if (names.has(n.toLowerCase())) out.push({ text: `Parâmetro repetido: ${n}.` });
    names.add(n.toLowerCase());
  }
  return out;
}

const hexRgb = (h: string): V3 => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16) || 0) as V3;

/** Malha do elemento (mm, centrada na caixa envolvente) e tamanho [largura X, profundidade Z, altura Y]. */
export function designMesh(solids: DesignSolid[]): { mesh: ComponentMesh; size: [number, number, number]; center: V3 } | null {
  const pos: number[] = [];
  const ind: number[] = [];
  const cols: number[] = [];
  for (const s of solids) {
    const poly = profilePolygon(s.perfil);
    if (poly.length < 3 || Math.abs(s.ate - s.de) < 0.5) continue;
    const tris = triangulate(poly);
    const [w0, w1] = [Math.min(s.de, s.ate), Math.max(s.de, s.ate)];
    const rgb = hexRgb(s.cor);
    const start = ind.length;
    const base = pos.length / 3;
    const n = poly.length;
    for (const w of [w0, w1]) for (const [u, v] of poly) pos.push(...viewToElement(s.vista, u, v, w));
    // Tampas: embaixo (w0) invertida, em cima (w1) no sentido do perfil.
    for (let t = 0; t < tris.length; t += 3) {
      ind.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
      ind.push(base + n + tris[t], base + n + tris[t + 1], base + n + tris[t + 2]);
    }
    // Laterais: vértices próprios (arestas vivas).
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const b = pos.length / 3;
      for (const [k, w] of [
        [i, w0],
        [j, w0],
        [j, w1],
        [i, w1],
      ] as const)
        pos.push(...viewToElement(s.vista, poly[k][0], poly[k][1], w));
      ind.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    // A vista lateral e a planta espelham os eixos: confere o volume e vira as faces se preciso.
    let vol = 0;
    for (let t = start; t < ind.length; t += 3) {
      const a = ind[t] * 3;
      const b = ind[t + 1] * 3;
      const c = ind[t + 2] * 3;
      vol +=
        pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) -
        pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) +
        pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    }
    if (vol < 0) for (let t = start; t < ind.length; t += 3) [ind[t + 1], ind[t + 2]] = [ind[t + 2], ind[t + 1]];
    for (let t = start; t < ind.length; t += 3) cols.push(...rgb);
  }
  if (!ind.length) return null;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  const c: V3 = [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as V3;
  const p = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) p[i] = pos[i] - c[i % 3];
  const ext = [0, 1, 2].map((k) => Math.max(1, Math.round(max[k] - min[k])));
  return { mesh: { positions: p, indices: Uint32Array.from(ind), triColors: Uint8Array.from(cols) }, size: [ext[0], ext[2], ext[1]], center: c };
}

/**
 * Símbolo de planta: contorno de cada sólido visto de cima (X, Z), centrado como a malha.
 * Sólidos desenhados em planta mostram o próprio perfil; os de frente/lateral, o retângulo
 * que ocupam.
 */
export function designPlanLines(solids: DesignSolid[], center: V3): [number, number][][] {
  const out: [number, number][][] = [];
  const r = (v: number) => Math.round(v * 10) / 10;
  for (const s of solids) {
    const poly = profilePolygon(s.perfil);
    if (poly.length < 3) continue;
    let pts: [number, number][];
    if (s.vista === "planta") pts = poly.map(([u, v]) => [u, v]);
    else {
      const us = poly.map((q) => q[0]);
      const [u0, u1] = [Math.min(...us), Math.max(...us)];
      const [w0, w1] = [Math.min(s.de, s.ate), Math.max(s.de, s.ate)];
      // frente: u = X, w = Z; lateral: u = Z, w = X.
      pts =
        s.vista === "frente"
          ? [
              [u0, w0],
              [u1, w0],
              [u1, w1],
              [u0, w1],
            ]
          : [
              [w0, u0],
              [w1, u0],
              [w1, u1],
              [w0, u1],
            ];
    }
    out.push([...pts, pts[0]].map(([x, z]) => [r(x - center[0]), r(z - center[2])]));
  }
  return out;
}

export const OWN_PACKAGE_ID = "proprio";
export const designComponentId = (uid: string) => `el-${uid}`;

/** Elemento criado no app como componente da biblioteca (aparece na locação). */
export function designComponent(d: ElementDesign): ComponentDef {
  const m = designMesh(d.solids);
  return {
    id: designComponentId(d.uid),
    group: d.group || "Elementos criados",
    label: d.label || "Elemento sem nome",
    discipline: d.discipline,
    ifcType: d.ifcType,
    predefinedType: d.predefinedType,
    mounting: d.mounting,
    defaultHeight: d.defaultHeight,
    size: m?.size ?? [300, 300, 300],
    shape: m ? "malha" : "caixa",
    mesh: m?.mesh,
    system: d.system,
    systemType: d.systemType,
    tagPrefix: d.tagPrefix || "EL",
    params: d.params.filter((p) => p.name.trim()),
    planLines: m ? designPlanLines(d.solids, m.center) : undefined,
    funcao: d.funcao || d.label,
    brand: d.brand || undefined,
    model: d.model || undefined,
    source: { kind: "proprio", packageId: OWN_PACKAGE_ID, familyUid: d.uid, family: d.label, type: d.label },
  };
}

/** Elemento novo a partir de um componente de fábrica (classificação, fixação, parâmetros). */
export function newDesign(base: ComponentDef | undefined, uid: string): ElementDesign {
  const now = new Date().toISOString();
  return {
    uid,
    label: "",
    group: base?.group ?? "Elementos criados",
    discipline: base?.discipline ?? "eletrica",
    ifcType: base?.ifcType ?? "IFCBUILDINGELEMENTPROXY",
    predefinedType: base?.predefinedType ?? "NOTDEFINED",
    mounting: base?.mounting ?? "parede",
    defaultHeight: base?.defaultHeight ?? 1100,
    system: base?.system ?? "",
    systemType: base?.systemType ?? "NOTDEFINED",
    tagPrefix: base?.tagPrefix ?? "EL",
    like: base?.id,
    params: (base?.params ?? []).map((p) => ({ ...p })),
    solids: [],
    createdAt: now,
    updatedAt: now,
  };
}
