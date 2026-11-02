// Corte vertical (vista em corte) do modelo: elementos cortados pelo plano (hachurados) e,
// além dele até a profundidade de vista, as arestas visíveis em projeção. Pontos locados e
// trechos aparecem pelo contorno (ou pela seção do tubo, quando cortados).
// Coordenadas do desenho: u = distância ao longo da linha de corte (m), v = cota do IFC (m).
import { MEP_DISCIPLINES } from "../disciplines";
import { COMPONENT_BY_ID } from "../library";
import type { CoordinateSystem } from "../math";
import type { TriangleMesh } from "../obb";
import type { PlacedPoint, StoreyLevel } from "../points";
import { runSegments, RUN_TYPE_BY_ID, segmentElementId, type Run } from "../runs";
import type { Discipline, ElementInfo, Vec3 } from "../types";
import type { CutDef } from "../views";
import { boundsOf } from "./build";
import { LAYER_PREFIX, PEN, PRINT_COLOR, type PlanDrawing, type Prim } from "./drawing";
import { chainSegments, cutMesh, type P2 } from "./section";

export interface SectionInput {
  elements: ElementInfo[];
  meshes: Map<number, TriangleMesh>;
  cs: CoordinateSystem;
  storeyLevels: StoreyLevel[];
  points: PlacedPoint[];
  runs: Run[];
  disciplines: Set<Discipline>;
  cut: CutDef;
  scale: number;
  name: string;
  labels?: { tags: boolean; sizes: boolean };
}

const POCHE = new Set(["IFCWALL", "IFCWALLSTANDARDCASE", "IFCCOLUMN", "IFCSLAB", "IFCBEAM", "IFCROOF", "IFCCURTAINWALL", "IFCMEMBER", "IFCPILE", "IFCFOOTING"]);
const POCHE_FILL = "#a6a6a6";

export interface SectionFrame {
  /** Origem (cena) e eixos horizontais: U ao longo do corte, W para onde se olha. */
  o: Vec3;
  U: Vec3;
  W: Vec3;
  length: number;
  /** cota IFC = y da cena + zOffset. */
  zOffset: number;
}

export function sectionFrame(cs: CoordinateSystem, cut: CutDef): SectionFrame {
  const o = cs.ifcToWorld([cut.a[0], cut.a[1], 0]);
  const b = cs.ifcToWorld([cut.b[0], cut.b[1], 0]);
  const d: Vec3 = [b[0] - o[0], 0, b[2] - o[2]];
  const length = Math.hypot(d[0], d[2]) || 1;
  const U: Vec3 = [d[0] / length, 0, d[2] / length];
  // Normal à esquerda de a→b na planta (IFC): (−dy, dx); levada para a cena.
  const pdir: P2 = [-(cut.b[1] - cut.a[1]) * cut.side, (cut.b[0] - cut.a[0]) * cut.side];
  const q = cs.ifcToWorld([cut.a[0] + pdir[0], cut.a[1] + pdir[1], 0]);
  const wv: Vec3 = [q[0] - o[0], 0, q[2] - o[2]];
  const wl = Math.hypot(wv[0], wv[2]) || 1;
  return { o, U, W: [wv[0] / wl, 0, wv[2] / wl], length, zOffset: cs.worldToIfc([0, 0, 0])[2] };
}

export function toSection(f: SectionFrame, p: Vec3): { u: number; w: number; v: number } {
  const dx = p[0] - f.o[0];
  const dz = p[2] - f.o[2];
  return { u: dx * f.U[0] + dz * f.U[2], w: dx * f.W[0] + dz * f.W[2], v: p[1] + f.zOffset };
}

const key3 = (x: number, y: number, z: number) => `${Math.round(x * 1e4)}|${Math.round(y * 1e4)}|${Math.round(z * 1e4)}`;

export function buildSection(input: SectionInput): PlanDrawing {
  const { cut, scale, cs } = input;
  const m = scale / 1000;
  const f = sectionFrame(cs, cut);
  const L = f.length;
  const depth = Math.max(0, cut.depth);
  const prims: Prim[] = [];
  const seen = new Set<string>();
  const uRange = (u: number) => u >= -1e-6 && u <= L + 1e-6;

  const pushEdge = (a: P2, b: P2, layer: string, color: string, weight: number, id?: number) => {
    // Limita ao comprimento do corte.
    let [p, q] = [a, b];
    if (p[0] > q[0]) [p, q] = [q, p];
    if (q[0] < 0 || p[0] > L) return;
    const clip = (r: P2, s: P2, u: number): P2 => [u, r[1] + ((s[1] - r[1]) * (u - r[0])) / (s[0] - r[0] || 1e-12)];
    if (p[0] < 0) p = clip(p, q, 0);
    if (q[0] > L) q = clip(p, q, L);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.002) return;
    const k = [p, q].map(([x, y]) => `${Math.round(x * 500)}|${Math.round(y * 500)}`).sort().join("/");
    if (seen.has(k)) return;
    seen.add(k);
    prims.push({ t: "line", a: p, b: q, weight, layer, color, id });
  };

  // ---- Modelo IFC --------------------------------------------------------------------------
  for (const e of input.elements) {
    if (!input.disciplines.has(e.discipline) || !e.bbox) continue;
    const mesh = input.meshes.get(e.expressID);
    if (!mesh) continue;
    // Faixa do elemento no sistema do corte (pelos 4 cantos horizontais da caixa).
    const corners = [
      [e.bbox.min[0], e.bbox.min[2]],
      [e.bbox.max[0], e.bbox.min[2]],
      [e.bbox.min[0], e.bbox.max[2]],
      [e.bbox.max[0], e.bbox.max[2]],
    ].map(([x, z]) => toSection(f, [x, 0, z]));
    const wMin = Math.min(...corners.map((c) => c.w));
    const wMax = Math.max(...corners.map((c) => c.w));
    const uMin = Math.min(...corners.map((c) => c.u));
    const uMax = Math.max(...corners.map((c) => c.u));
    if (wMax < 0 || wMin > depth || uMax < 0 || uMin > L) continue;

    const isMep = MEP_DISCIPLINES.includes(e.discipline);
    const prefix = LAYER_PREFIX[e.discipline];
    const color = isMep ? PRINT_COLOR[e.discipline] : "#222222";
    const { positions, indices } = mesh;
    const n = positions.length / 3;
    // Posições no sistema do corte: (u, w, v) — o plano de corte vira w = 0.
    const t = new Float32Array(positions.length);
    for (let i = 0; i < n; i++) {
      const s = toSection(f, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
      t[i * 3] = s.u;
      t[i * 3 + 1] = s.w;
      t[i * 3 + 2] = s.v;
    }

    // Arestas visíveis além do plano: contorno e quinas (ângulo entre faces > 20°) voltadas ao observador.
    if (wMax > 0) {
      const edges = new Map<string, { a: number; b: number; normals: Vec3[] }>();
      const vk = (i: number) => key3(t[i * 3], t[i * 3 + 1], t[i * 3 + 2]);
      for (let k = 0; k < indices.length; k += 3) {
        const ia = indices[k];
        const ib = indices[k + 1];
        const ic = indices[k + 2];
        const P = (i: number): Vec3 => [t[i * 3], t[i * 3 + 1], t[i * 3 + 2]];
        const [pa, pb, pc] = [P(ia), P(ib), P(ic)];
        const e1: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const e2: Vec3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const nn: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const nl = Math.hypot(...nn);
        if (nl < 1e-12) continue;
        const nrm: Vec3 = [nn[0] / nl, nn[1] / nl, nn[2] / nl];
        for (const [x, y] of [
          [ia, ib],
          [ib, ic],
          [ic, ia],
        ]) {
          const [kx, ky] = [vk(x), vk(y)];
          const kk = kx < ky ? `${kx}/${ky}` : `${ky}/${kx}`;
          const cur = edges.get(kk);
          if (cur) cur.normals.push(nrm);
          else edges.set(kk, { a: x, b: y, normals: [nrm] });
        }
      }
      for (const { a, b, normals } of edges.values()) {
        // Faces voltadas ao observador têm normal com componente w negativa (olhamos para +w).
        if (!normals.some((q) => q[1] < 0.05)) continue;
        if (normals.length === 2) {
          const [p, q] = normals;
          if (p[0] * q[0] + p[1] * q[1] + p[2] * q[2] > Math.cos((20 * Math.PI) / 180)) continue;
        }
        let A: Vec3 = [t[a * 3], t[a * 3 + 1], t[a * 3 + 2]];
        let B: Vec3 = [t[b * 3], t[b * 3 + 1], t[b * 3 + 2]];
        // Trecho da aresta entre o plano (w = 0) e a profundidade de vista.
        if ((A[1] < 0 && B[1] < 0) || (A[1] > depth && B[1] > depth)) continue;
        const at = (P: Vec3, Q: Vec3, w: number): Vec3 => {
          const s = (w - P[1]) / (Q[1] - P[1] || 1e-12);
          return [P[0] + (Q[0] - P[0]) * s, w, P[2] + (Q[2] - P[2]) * s];
        };
        if (A[1] < 0) A = at(A, B, 0);
        if (B[1] < 0) B = at(B, A, 0);
        if (A[1] > depth) A = at(A, B, depth);
        if (B[1] > depth) B = at(B, A, depth);
        pushEdge([A[0], A[2]], [B[0], B[2]], isMep ? `${prefix}-IFC` : `${prefix}-VISTA`, color, PEN.vista, e.expressID);
      }
    }

    // Seção no plano de corte (w = 0): contornos fechados, hachurados nos elementos de vedação/estrutura.
    if (wMin <= 0 && wMax >= 0) {
      const segs = cutMesh(t, indices, 0).map(({ a, b }): [P2, P2] => [
        [a[0], a[2]],
        [b[0], b[2]],
      ]);
      const poche = !isMep && POCHE.has(e.ifcType);
      for (const ch of chainSegments(segs)) {
        if (!ch.points.some((p) => uRange(p[0]))) continue;
        prims.push({
          t: "poly",
          pts: ch.points.map((p): P2 => [Math.min(Math.max(p[0], 0), L), p[1]]),
          closed: ch.closed,
          weight: isMep ? PEN.mep : PEN.corte,
          fill: poche && ch.closed ? POCHE_FILL : null,
          layer: isMep ? `${prefix}-IFC` : `${prefix}-CORTE`,
          color,
          id: e.expressID,
        });
      }
    }
  }

  // ---- Pontos locados ------------------------------------------------------------------------
  for (const p of input.points) {
    const def = COMPONENT_BY_ID[p.componentId];
    if (!def || !input.disciplines.has(def.discipline)) continue;
    const s = toSection(f, p.position);
    const half = Math.max(def.size[0], def.size[1]) / 2000;
    if (s.w < -half || s.w > depth || s.u < -half || s.u > L + half) continue;
    const h = def.size[2] / 2000;
    const prefix = LAYER_PREFIX[def.discipline];
    const color = PRINT_COLOR[def.discipline];
    const cutNow = Math.abs(s.w) <= half;
    prims.push({
      t: "poly",
      pts: [
        [s.u - half, s.v - h],
        [s.u + half, s.v - h],
        [s.u + half, s.v + h],
        [s.u - half, s.v + h],
      ],
      closed: true,
      weight: cutNow ? PEN.mep : PEN.simbolo,
      fill: cutNow ? color : null,
      layer: `${prefix}-PONTOS`,
      color,
      id: p.id,
    });
    if (input.labels?.tags !== false) prims.push({ t: "text", p: [s.u, s.v + h + 2 * m], text: p.tag, height: 1.8 * m, anchor: "middle", layer: `${prefix}-TEXTOS`, color, id: p.id });
  }

  // ---- Trechos -------------------------------------------------------------------------------
  for (const run of input.runs) {
    const t = RUN_TYPE_BY_ID[run.typeId];
    if (!t || !input.disciplines.has(t.discipline)) continue;
    const prefix = LAYER_PREFIX[t.discipline];
    const color = PRINT_COLOR[t.discipline];
    const rect = t.profile === "retangular";
    const wd = run.size.width / 1000;
    const ht = (rect ? run.size.height : run.size.width) / 1000;
    runSegments(run).forEach((sg, i) => {
      const A = toSection(f, sg.start);
      const B = toSection(f, sg.end);
      const id = segmentElementId(run.id, i);
      // Atravessa o plano: seção do tubo/duto no ponto de cruzamento.
      if ((A.w < 0 && B.w > 0) || (A.w > 0 && B.w < 0)) {
        const s = A.w / (A.w - B.w);
        const c: P2 = [A.u + (B.u - A.u) * s, A.v + (B.v - A.v) * s];
        if (!uRange(c[0])) return;
        if (rect)
          prims.push({ t: "poly", pts: [[c[0] - wd / 2, c[1] - ht / 2], [c[0] + wd / 2, c[1] - ht / 2], [c[0] + wd / 2, c[1] + ht / 2], [c[0] - wd / 2, c[1] + ht / 2]], closed: true, weight: PEN.mep, layer: `${prefix}-TRECHOS`, color, id });
        else prims.push({ t: "circle", c, r: Math.max(wd / 2, 0.4 * m), weight: PEN.mep, fill: color, layer: `${prefix}-TRECHOS`, color, id });
        if (input.labels?.sizes !== false)
          prims.push({ t: "text", p: [c[0] + Math.max(wd, 1.5 * m), c[1] + Math.max(ht, 1.5 * m)], text: `${run.tag} ${run.size.label}`, height: 1.6 * m, anchor: "start", layer: `${prefix}-TEXTOS`, color, id });
        return;
      }
      const wMin = Math.min(A.w, B.w);
      if (wMin < 0 || wMin > depth) return;
      const a: P2 = [A.u, A.v];
      const b: P2 = [B.u, B.v];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-4) {
        // Trecho perpendicular ao plano: aparece como a seção do tubo.
        if (uRange(a[0])) prims.push({ t: "circle", c: a, r: Math.max(wd / 2, 0.4 * m), weight: PEN.mep, layer: `${prefix}-TRECHOS`, color, id });
        return;
      }
      const n: P2 = [(-(b[1] - a[1]) / len) * (ht / 2), ((b[0] - a[0]) / len) * (ht / 2)];
      if (ht >= 2 * m) {
        pushEdge([a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], `${prefix}-TRECHOS`, color, PEN.mep, id);
        pushEdge([a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], `${prefix}-TRECHOS`, color, PEN.mep, id);
      } else pushEdge(a, b, `${prefix}-TRECHOS`, color, PEN.mep, id);
    });
  }

  // ---- Níveis dos pavimentos ---------------------------------------------------------------------
  const vb = boundsOf(prims);
  const x0 = Math.min(vb?.min[0] ?? 0, 0) - 1;
  const x1 = Math.max(vb?.max[0] ?? L, L) + 0.5;
  for (const s of input.storeyLevels) {
    const z = s.level + f.zOffset;
    prims.push({ t: "line", a: [x0, z], b: [x1, z], weight: 0.18, dashdot: true, layer: "ANOT-NIVEIS", color: "#374151" });
    const txt = `${s.name}  ${z >= 0 ? "+" : ""}${z.toFixed(2).replace(".", ",")}`;
    prims.push({ t: "text", p: [x0, z + 1.6 * m], text: txt, height: 2 * m, anchor: "start", layer: "ANOT-NIVEIS", color: "#374151" });
    prims.push({ t: "poly", pts: [[x0 + 0.2, z], [x0 + 0.2 - 1.2 * m, z + 1.6 * m], [x0 + 0.2 + 1.2 * m, z + 1.6 * m]], closed: true, weight: 0.18, fill: "#374151", layer: "ANOT-NIVEIS", color: "#374151" });
  }

  const rank = (layer: string) => (layer.endsWith("-TEXTOS") || layer.startsWith("ANOT") ? 3 : layer.endsWith("-PONTOS") ? 2 : layer.endsWith("-TRECHOS") ? 1 : layer.endsWith("-CORTE") ? 0.5 : 0);
  prims.sort((a, b) => rank(a.layer) - rank(b.layer));
  return { prims, bounds: boundsOf(prims), legend: [], scale, storey: input.name, cutHeight: 0 };
}
