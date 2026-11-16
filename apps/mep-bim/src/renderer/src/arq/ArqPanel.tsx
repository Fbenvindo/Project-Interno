// Arquitetura e estrutura: ferramenta de desenho na planta (paredes, portas, janelas, lajes,
// pilares e vigas) e o painel com as medidas do que vai ser criado. Os cliques usam o encaixe e o
// ortogonal da planta; as medidas ficam guardadas entre uma sessão e outra.
import { useEffect, useMemo, useState } from "react";
import {
  ARCH_LABEL,
  newArch,
  wallAt,
  wallLength,
  type ArchElement,
  type ArchKind,
  type Beam,
  type Column,
  type Opening,
  type Slab,
  type Wall,
} from "../../../core/arch";
import type { Prim } from "../../../core/plan/drawing";
import type { P2 } from "../../../core/plan/section";
import type { PlanTool } from "../planta/planTool";
import type { PointsStore } from "../locacao/usePointsStore";

/** Medidas de criação (m; rotação em graus). */
export interface ArchParams {
  wallType: string;
  wallThickness: number;
  /** Altura da parede; null = até o pavimento de cima. */
  wallHeight: number | null;
  /** Linha de referência da parede: eixo, face esquerda ou face direita (no sentido do desenho). */
  wallLine: "eixo" | "esquerda" | "direita";
  doorType: string;
  doorWidth: number;
  doorHeight: number;
  doorRight: boolean;
  windowType: string;
  windowWidth: number;
  windowHeight: number;
  windowSill: number;
  slabType: string;
  slabThickness: number;
  /** Laje do piso (topo no nível do pavimento) ou do teto (topo no pavimento de cima). */
  slabAt: "piso" | "teto";
  columnType: string;
  columnWidth: number;
  columnDepth: number;
  columnRotation: number;
  beamType: string;
  beamWidth: number;
  beamHeight: number;
}

export const DEFAULT_ARCH_PARAMS: ArchParams = {
  wallType: "Alvenaria",
  wallThickness: 0.15,
  wallHeight: null,
  wallLine: "eixo",
  doorType: "Porta de abrir",
  doorWidth: 0.8,
  doorHeight: 2.1,
  doorRight: false,
  windowType: "Janela de correr",
  windowWidth: 1.2,
  windowHeight: 1.2,
  windowSill: 1.1,
  slabType: "Laje maciça",
  slabThickness: 0.12,
  slabAt: "teto",
  columnType: "Pilar de concreto",
  columnWidth: 0.2,
  columnDepth: 0.4,
  columnRotation: 0,
  beamType: "Viga de concreto",
  beamWidth: 0.15,
  beamHeight: 0.5,
};

const KEY = "smarteasybim.arquitetura";
export function readArchParams(): ArchParams {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v === "object" ? { ...DEFAULT_ARCH_PARAMS, ...v } : DEFAULT_ARCH_PARAMS;
  } catch {
    return DEFAULT_ARCH_PARAMS;
  }
}
export function saveArchParams(p: ArchParams) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* armazenamento indisponível */
  }
}

interface ToolArgs {
  kind: ArchKind;
  structural: boolean;
  params: ArchParams;
  store: PointsStore;
  storey: string;
  /** Cota (z do IFC) do piso da planta e do pavimento de cima. */
  baseZ: number;
  nextZ: number;
  onNotice: (msg: string) => void;
}

const PREVIEW = "#2563eb";
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const left = (d: P2): P2 => [-d[1], d[0]];
const at = (o: P2, d: P2, s: number, n: P2 = [0, 0], t = 0): P2 => [o[0] + d[0] * s + n[0] * t, o[1] + d[1] * s + n[1] * t];

function barPoly(a: P2, b: P2, w: number, shift = 0): P2[] {
  const d = unit(sub(b, a));
  const n = left(d);
  return [at(a, d, 0, n, shift - w / 2), at(b, d, 0, n, shift - w / 2), at(b, d, 0, n, shift + w / 2), at(a, d, 0, n, shift + w / 2)];
}
const poly = (pts: P2[], closed = true, dashed = false): Prim => ({ t: "poly", pts, closed, weight: 0.35, color: PREVIEW, layer: "PREVIA", fill: closed ? "rgba(37,99,235,0.18)" : null, dashed });

/** Ferramenta de desenho na planta para o elemento escolhido. */
export function useArchTool({ kind, structural, params: p, store, storey, baseZ, nextZ, onNotice }: ToolArgs): PlanTool & { busy: boolean } {
  const [pts, setPts] = useState<P2[]>([]);
  useEffect(() => setPts([]), [kind, storey, structural]);
  const walls = useMemo(() => store.arch.filter((e): e is Wall => e.kind === "parede" && e.storey === storey), [store.arch, storey]);
  const storeyH = Math.max(0.5, nextZ - baseZ);
  const add = (e: ArchElement | ArchElement[]) => store.setArch((l) => [...l, ...(Array.isArray(e) ? e : [e])]);
  /** Deslocamento do eixo em relação à linha desenhada (face esquerda/direita). */
  const wallShift = p.wallLine === "esquerda" ? -p.wallThickness / 2 : p.wallLine === "direita" ? p.wallThickness / 2 : 0;

  const makeWall = (a: P2, b: P2): Wall => {
    const n = left(unit(sub(b, a)));
    return newArch<Wall>({
      kind: "parede",
      storey,
      name: structural ? "Parede de concreto" : p.wallType,
      a: at(a, n, 0, n, wallShift),
      b: at(b, n, 0, n, wallShift),
      base: baseZ,
      height: p.wallHeight ?? storeyH,
      thickness: p.wallThickness,
      ...(structural ? { structural: true } : {}),
    });
  };
  const makeBeam = (a: P2, b: P2): Beam => newArch<Beam>({ kind: "viga", storey, name: p.beamType, a, b, top: nextZ, width: p.beamWidth, height: p.beamHeight });
  const makeColumn = (c: P2): Column =>
    newArch<Column>({ kind: "pilar", storey, name: p.columnType, at: c, base: baseZ, height: storeyH, width: p.columnWidth, depth: p.columnDepth, rotation: (p.columnRotation * Math.PI) / 180 });
  const openingAt = (c: P2) => {
    const hit = wallAt(walls, c, 0.4);
    if (!hit) return null;
    const door = kind === "porta";
    const width = door ? p.doorWidth : p.windowWidth;
    const L = wallLength(hit.wall);
    if (width > L - 0.02) return { hit, error: "A parede é mais curta que o vão." };
    const offset = Math.max(width / 2, Math.min(L - width / 2, hit.offset));
    return { hit, offset, width };
  };

  const finishSlab = (list: P2[]) => {
    if (list.length < 3) return false;
    add(
      newArch<Slab>({
        kind: "laje",
        storey,
        name: p.slabType,
        outline: list,
        top: p.slabAt === "teto" ? nextZ : baseZ,
        thickness: p.slabThickness,
      }),
    );
    onNotice(`Laje criada (${p.slabAt === "teto" ? "teto do pavimento" : "piso do pavimento"}).`);
    return true;
  };

  const chain = kind === "parede" || kind === "viga";
  const prompt =
    kind === "parede"
      ? pts.length
        ? "Próximo ponto da parede · Enter, botão direito ou Esc termina"
        : "Clique no início da parede (encaixe e ortogonal valem)"
      : kind === "viga"
        ? pts.length
          ? "Fim da viga · Enter termina a sequência"
          : "Clique no início da viga"
        : kind === "laje"
          ? pts.length < 3
            ? `Clique nos cantos da laje (${pts.length} de pelo menos 3)`
            : "Próximo canto · Enter ou clique no primeiro canto fecha a laje"
          : kind === "pilar"
            ? "Clique onde vai o pilar (centro)"
            : `Clique sobre a parede onde vai a ${ARCH_LABEL[kind].toLowerCase()} (o lado do clique é o lado para onde ${kind === "porta" ? "abre" : "fica a face"})`;

  return {
    busy: pts.length > 0,
    prompt,
    selecting: false,
    snap: true,
    anchor: pts.length ? pts[pts.length - 1] : null,
    preview(cursor) {
      const out: Prim[] = [];
      if (chain) {
        const w = kind === "parede" ? p.wallThickness : p.beamWidth;
        const shift = kind === "parede" ? wallShift : 0;
        const all = cursor && pts.length ? [...pts, cursor] : pts;
        for (let i = 0; i < all.length - 1; i++) if (len(sub(all[i + 1], all[i])) > 1e-3) out.push(poly(barPoly(all[i], all[i + 1], w, shift), true, kind === "viga"));
        if (cursor && pts.length) {
          const l = len(sub(cursor, pts[pts.length - 1]));
          out.push({ t: "text", p: [(cursor[0] + pts[pts.length - 1][0]) / 2, (cursor[1] + pts[pts.length - 1][1]) / 2 + 0.3], text: `${l.toFixed(2).replace(".", ",")} m`, height: 0.22, anchor: "middle", color: PREVIEW, layer: "PREVIA" });
        }
        return out;
      }
      if (kind === "laje") {
        const all = cursor ? [...pts, cursor] : pts;
        if (all.length >= 2) out.push(poly(all, all.length >= 3));
        return out;
      }
      if (!cursor) return out;
      if (kind === "pilar") {
        const r = (p.columnRotation * Math.PI) / 180;
        const X: P2 = [Math.cos(r), Math.sin(r)];
        const Y = left(X);
        const hw = p.columnWidth / 2;
        const hd = p.columnDepth / 2;
        out.push(poly([at(cursor, X, -hw, Y, -hd), at(cursor, X, hw, Y, -hd), at(cursor, X, hw, Y, hd), at(cursor, X, -hw, Y, hd)]));
        return out;
      }
      const o = openingAt(cursor);
      if (!o || !("offset" in o) || o.offset == null) return out;
      const w = o.hit.wall;
      const d = unit(sub(w.b, w.a));
      const n = left(d);
      const c = at(w.a, d, o.offset!);
      const half = o.width! / 2;
      const t = w.thickness / 2;
      out.push(poly([at(c, d, -half, n, -t), at(c, d, half, n, -t), at(c, d, half, n, t), at(c, d, -half, n, t)]));
      if (kind === "porta") {
        // Folha aberta e arco, do lado do clique.
        const s = o.hit.side;
        const hinge = p.doorRight !== (s < 0) ? half : -half;
        const dir = hinge > 0 ? -1 : 1;
        const face = s * t;
        const arc: P2[] = [];
        for (let k = 0; k <= 12; k++) {
          const a = ((Math.PI / 2) * k) / 12;
          arc.push(at(c, d, hinge + dir * o.width! * Math.sin(a), n, face + s * o.width! * Math.cos(a)));
        }
        out.push(poly(arc, false, true), poly([at(c, d, hinge, n, face), at(c, d, hinge, n, face + s * o.width!)], false));
      }
      return out;
    },
    click(q) {
      if (chain) {
        if (!pts.length) return setPts([q]);
        const a = pts[pts.length - 1];
        if (len(sub(q, a)) < 0.05) return;
        add(kind === "parede" ? makeWall(a, q) : makeBeam(a, q));
        // Fechou no ponto de partida: termina a sequência.
        if (pts.length > 1 && len(sub(q, pts[0])) < 0.01) return setPts([]);
        return setPts([...pts, q]);
      }
      if (kind === "laje") {
        if (pts.length >= 3 && len(sub(q, pts[0])) < 0.05) {
          finishSlab(pts);
          return setPts([]);
        }
        return setPts([...pts, q]);
      }
      if (kind === "pilar") return add(makeColumn(q));
      const o = openingAt(q);
      if (!o) return onNotice("Clique sobre uma parede criada no app (ou bem perto dela).");
      if ("error" in o && o.error) return onNotice(o.error);
      const door = kind === "porta";
      add(
        newArch<Opening>({
          kind,
          storey,
          name: door ? p.doorType : p.windowType,
          host: o.hit.wall.guid,
          offset: o.offset!,
          width: o.width!,
          height: door ? p.doorHeight : p.windowHeight,
          sill: door ? 0 : p.windowSill,
          ...(door && o.hit.side < 0 ? { flip: true } : {}),
          ...(door && p.doorRight !== o.hit.side < 0 ? { right: true } : {}),
        }),
      );
    },
    finish() {
      if (kind === "laje") finishSlab(pts);
      setPts([]);
    },
    cancel() {
      if (kind === "laje") finishSlab(pts);
      setPts([]);
    },
  };
}

// ---- Painel ----------------------------------------------------------------------------------------

const Num = ({ label, value, onChange, step = 0.01, title, unit = "m" }: { label: string; value: number; onChange: (v: number) => void; step?: number; title?: string; unit?: string }) => (
  <label title={title}>
    {label} ({unit})
    <input type="number" step={step} value={value} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
  </label>
);
const Txt = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label>
    {label}
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

export function ArqPanel({
  kind,
  structural,
  params: p,
  onChange,
  storey,
  storeyHeight,
  count,
}: {
  kind: ArchKind;
  structural: boolean;
  params: ArchParams;
  onChange: (p: ArchParams) => void;
  storey: string;
  storeyHeight: number;
  count: number;
}) {
  const set = (patch: Partial<ArchParams>) => onChange({ ...p, ...patch });
  const title = structural && kind === "parede" ? "Parede estrutural" : kind === "laje" && !structural ? "Piso / laje" : ARCH_LABEL[kind];
  return (
    <div className="panel-body arq-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {count > 0 && <span className="badge">{count} no projeto</span>}
      </div>
      <p className="muted small">
        Pavimento <b>{storey || "—"}</b> · pé-direito {storeyHeight.toFixed(2).replace(".", ",")} m. Desenhe na planta: encaixe e ortogonal (barra de status) valem para os cliques.
      </p>
      <section className="card">
        <div className="form-grid">
          {kind === "parede" && (
            <>
              {!structural && <Txt label="Tipo" value={p.wallType} onChange={(v) => set({ wallType: v })} />}
              <Num label="Espessura" value={p.wallThickness} onChange={(v) => set({ wallThickness: Math.max(0.03, v) })} />
              <label>
                Altura
                <select value={p.wallHeight == null ? "topo" : "fixa"} onChange={(e) => set({ wallHeight: e.target.value === "topo" ? null : Math.round(storeyHeight * 100) / 100 })}>
                  <option value="topo">até o pavimento de cima</option>
                  <option value="fixa">altura fixa</option>
                </select>
              </label>
              {p.wallHeight != null && <Num label="Altura" value={p.wallHeight} onChange={(v) => set({ wallHeight: Math.max(0.1, v) })} />}
              <label>
                Linha de referência
                <select value={p.wallLine} onChange={(e) => set({ wallLine: e.target.value as ArchParams["wallLine"] })}>
                  <option value="eixo">eixo da parede</option>
                  <option value="esquerda">face à esquerda do desenho</option>
                  <option value="direita">face à direita do desenho</option>
                </select>
              </label>
            </>
          )}
          {kind === "porta" && (
            <>
              <Txt label="Tipo" value={p.doorType} onChange={(v) => set({ doorType: v })} />
              <Num label="Largura" value={p.doorWidth} onChange={(v) => set({ doorWidth: Math.max(0.3, v) })} />
              <Num label="Altura" value={p.doorHeight} onChange={(v) => set({ doorHeight: Math.max(0.5, v) })} />
              <label>
                Dobradiça
                <select value={p.doorRight ? "d" : "e"} onChange={(e) => set({ doorRight: e.target.value === "d" })}>
                  <option value="e">à esquerda</option>
                  <option value="d">à direita</option>
                </select>
              </label>
            </>
          )}
          {kind === "janela" && (
            <>
              <Txt label="Tipo" value={p.windowType} onChange={(v) => set({ windowType: v })} />
              <Num label="Largura" value={p.windowWidth} onChange={(v) => set({ windowWidth: Math.max(0.2, v) })} />
              <Num label="Altura" value={p.windowHeight} onChange={(v) => set({ windowHeight: Math.max(0.2, v) })} />
              <Num label="Peitoril" value={p.windowSill} onChange={(v) => set({ windowSill: Math.max(0, v) })} />
            </>
          )}
          {kind === "laje" && (
            <>
              <Txt label="Tipo" value={p.slabType} onChange={(v) => set({ slabType: v })} />
              <Num label="Espessura" value={p.slabThickness} onChange={(v) => set({ slabThickness: Math.max(0.02, v) })} />
              <label>
                Posição
                <select value={p.slabAt} onChange={(e) => set({ slabAt: e.target.value as ArchParams["slabAt"] })}>
                  <option value="teto">teto do pavimento (topo no pavimento de cima)</option>
                  <option value="piso">piso do pavimento (topo neste nível)</option>
                </select>
              </label>
            </>
          )}
          {kind === "pilar" && (
            <>
              <Txt label="Tipo" value={p.columnType} onChange={(v) => set({ columnType: v })} />
              <Num label="Largura" value={p.columnWidth} onChange={(v) => set({ columnWidth: Math.max(0.05, v) })} />
              <Num label="Profundidade" value={p.columnDepth} onChange={(v) => set({ columnDepth: Math.max(0.05, v) })} />
              <Num label="Rotação" unit="°" step={15} value={p.columnRotation} onChange={(v) => set({ columnRotation: v })} />
            </>
          )}
          {kind === "viga" && (
            <>
              <Txt label="Tipo" value={p.beamType} onChange={(v) => set({ beamType: v })} />
              <Num label="Largura" value={p.beamWidth} onChange={(v) => set({ beamWidth: Math.max(0.05, v) })} />
              <Num label="Altura" value={p.beamHeight} onChange={(v) => set({ beamHeight: Math.max(0.05, v) })} />
            </>
          )}
        </div>
        <p className="muted small">
          {kind === "parede" && "Clique ponto a ponto; cada trecho vira uma parede. Paredes que se encontram nas pontas fecham o canto; ponta no meio de outra parede termina na face dela."}
          {kind === "porta" && "Clique sobre a parede: o vão abre na parede e a porta abre para o lado do clique. Dobradiça e lado podem ser trocados depois nas Propriedades."}
          {kind === "janela" && "Clique sobre a parede: o vão abre na parede com o peitoril indicado."}
          {kind === "laje" && "Clique nos cantos; Enter ou clique no primeiro canto fecha a laje."}
          {kind === "pilar" && "Cada clique cria um pilar do piso ao pavimento de cima."}
          {kind === "viga" && "Clique ponto a ponto; o topo da viga fica no nível do pavimento de cima."}
        </p>
      </section>
    </div>
  );
}
