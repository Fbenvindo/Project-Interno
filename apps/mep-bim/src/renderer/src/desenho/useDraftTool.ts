// Comandos dos menus Criar, Modificar e Geral, executados na planta.
//
// Criar: linha, arco, círculo, elipse, quadrado, retângulo, triângulo, poligonal, texto,
// cotas ortogonal, inclinada e angular, marcador de coordenada.
// Modificar: copiar, mover, recortar, colar, apagar, estender, conectar — todos começam por
// uma seleção (vários elementos, por clique ou janela) e, antes de concluí-la, o app
// pergunta se o usuário deseja remover algum elemento da seleção.
// Geral: corte pelos elementos selecionados, corte por linha e vista 3D no local indicado.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  angleDeg,
  arcFrom3,
  connectEntities,
  dist,
  draftPrims,
  draftSegments,
  draftSnapPoints,
  extendLine,
  newDraftId,
  rectFrom,
  squareFrom,
  type DraftEntity,
} from "../../../core/draft";
import {
  deleteItems,
  insertCopies,
  itemPlanPoints,
  moveItems,
  pickedCount,
  splitSelection,
  toClipboard,
  type Clipboard,
  type EditState,
} from "../../../core/editOps";
import { fmtCoord, toMap, type Georef } from "../../../core/georef";
import type { Prim } from "../../../core/plan/drawing";
import type { P2 } from "../../../core/plan/section";
import { newViewId, nextViewName, SECTION_LABEL, type ViewDef, type ViewSection } from "../../../core/views";
import type { Vec3 } from "../../../core/types";
import type { CoordinateSystem } from "../../../core/math";
import type { PointsStore } from "../locacao/usePointsStore";
import type { ClickInfo, PlanTool, ToolQuestion } from "../planta/planTool";
import { labelPoint, measureText, type Measure, type Measure3 } from "../../../core/measure";
import { applyOffset } from "../../../core/runEdit";
import { runIdOfElement, segmentIndexOf } from "../../../core/runs";

export type DraftCmd =
  | "linha"
  | "arco"
  | "circulo"
  | "elipse"
  | "quadrado"
  | "retangulo"
  | "triangulo"
  | "poligonal"
  | "texto"
  | "cota-ortogonal"
  | "cota-inclinada"
  | "cota-angular"
  | "coordenada"
  | "copiar"
  | "mover"
  | "recortar"
  | "colar"
  | "apagar"
  | "estender"
  | "conectar"
  | "corte-selecao"
  | "corte-linha"
  | "ampliacao"
  | "vista-3d"
  | "medir-distancia"
  | "medir-area"
  | "medir-angulo"
  | "desvio";

export const CMD_LABEL: Record<DraftCmd, string> = {
  linha: "Linha",
  arco: "Arco",
  circulo: "Círculo",
  elipse: "Elipse",
  quadrado: "Quadrado",
  retangulo: "Retângulo",
  triangulo: "Triângulo",
  poligonal: "Poligonal",
  texto: "Texto",
  "cota-ortogonal": "Cota ortogonal",
  "cota-inclinada": "Cota inclinada",
  "cota-angular": "Cota angular",
  coordenada: "Indicar coordenada",
  copiar: "Copiar",
  mover: "Mover",
  recortar: "Recortar",
  colar: "Colar",
  apagar: "Apagar",
  estender: "Estender",
  conectar: "Conectar",
  "corte-selecao": "Corte pela seleção",
  "corte-linha": "Corte por linha",
  ampliacao: "Ampliação",
  "medir-distancia": "Medir distância",
  "medir-area": "Medir área",
  "medir-angulo": "Medir ângulo",
  desvio: "Desvio",
  "vista-3d": "Vista 3D no local",
};

/** Comandos que começam por uma seleção. */
export const NEEDS_SELECTION = new Set<DraftCmd>(["copiar", "mover", "recortar", "apagar", "estender", "conectar", "corte-selecao"]);
export const isMeasureCmd = (c: DraftCmd) => c === "medir-distancia" || c === "medir-area" || c === "medir-angulo";
export const isCreateCmd = (c: DraftCmd) => !NEEDS_SELECTION.has(c) && c !== "colar" && c !== "corte-linha" && c !== "vista-3d" && c !== "ampliacao" && c !== "desvio" && !isMeasureCmd(c);

/** Fases de um comando com seleção. */
export type Phase = "selecionar" | "confirmar" | "remover" | "executar";

export interface ClipPlane {
  normal: Vec3;
  point: Vec3;
}

export interface ClipRequest {
  planes: ClipPlane[];
  /** Caixa para enquadrar a câmera (corte pela seleção). */
  frame?: { min: Vec3; max: Vec3 };
}

interface Args {
  cmd: DraftCmd;
  /** Muda a cada novo acionamento do comando (reinicia). */
  n: number;
  store: PointsStore;
  storey: string;
  /** Y (cena) do piso do pavimento e altura até o piso de cima. */
  level: number;
  storeyHeight: number;
  cs: CoordinateSystem;
  georef: Georef;
  selection: number[];
  setSelection: (ids: number[]) => void;
  /** Caixa (cena) dos elementos do modelo selecionados, ou null. */
  boundsOf: (ids: number[]) => { min: Vec3; max: Vec3 } | null;
  /** Y (cena) da face inferior da laje/forro acima do ponto, ou null. */
  ceilingAt: (p: Vec3) => number | null;
  /** Vista criada (já com a seção escolhida pelo usuário): abrir. */
  onCreateView: (v: ViewDef) => void;
  /** Vista ativa dona das anotações (null = planta de trabalho). */
  draftView: string | null;
  /** Altura de corte da planta ativa (ampliações herdam). */
  cutHeight: number;
  /** Vista aberta é um corte (o desvio é feito na planta). */
  isSection?: boolean;
  /** Comando terminado: voltar a Selecionar. */
  onDone: () => void;
}

export interface DraftOptions {
  text: string;
  textSize: number;
  textRot: number;
  closed: boolean;
  eyeHeight: number;
  repeat: boolean;
  /** Desvio: altura (mm), sobe ou desce, ângulo das curvas. */
  desvioAltura: number;
  desvioSobe: boolean;
  desvioAngulo: 90 | 45;
}

const PREVIEW = "#0ea5e9";
const SCALE = 50;
const recolor = (ps: Prim[], color = PREVIEW): Prim[] => ps.map((p) => ({ ...p, color, id: undefined }));
const line = (a: P2, b: P2, dashed = true): Prim => ({ t: "line", a, b, weight: 0.18, color: PREVIEW, layer: "PREVIEW", dashed });

/** Área de transferência da sessão (vale entre comandos e pavimentos). */
let clipboard: Clipboard | null = null;
export const getClipboard = () => clipboard;

export function useDraftTool(a: Args) {
  const { cmd, n, store, storey, level, cs } = a;
  const [pts, setPts] = useState<P2[]>([]);
  const [phase, setPhase] = useState<Phase>("selecionar");
  const [message, setMessage] = useState<string | null>(null);
  const [opts, setOpts] = useState<DraftOptions>({ text: "Texto", textSize: 2.5, textRot: 0, closed: false, eyeHeight: 1.6, repeat: true, desvioAltura: 300, desvioSobe: true, desvioAngulo: 90 });
  const [clipVersion, setClipVersion] = useState(0);
  /** Vista aguardando a escolha da seção (Trabalho ou Documentação). */
  const [pending, setPending] = useState<ViewDef | null>(null);
  /** Desvio: primeiro ponto (trecho, segmento e posição ao longo dele). */
  const [desvioStart, setDesvioStart] = useState<{ runId: number; index: number; t: number } | null>(null);
  /** Comando Texto: posição onde o texto está sendo digitado. */
  const [textAt, setTextAt] = useState<P2 | null>(null);
  /** Medições feitas (ficam na tela enquanto o comando de medir está ativo). */
  const [measures, setMeasures] = useState<Measure[]>([]);
  /** Medições no 3D (cena) e os pontos da que está em andamento. */
  const [measures3d, setMeasures3d] = useState<Measure3[]>([]);
  const [pending3d, setPending3d] = useState<Vec3[]>([]);
  const argsRef = useRef(a);
  argsRef.current = a;

  const editable = useCallback(
    (ids: number[]) => {
      if (cmd === "corte-selecao") return ids;
      const st = editState(store);
      const sel = splitSelection(ids, st);
      const keep = new Set<number>([...sel.points, ...sel.drafts]);
      return ids.filter((id) => keep.has(id) || (id <= -1_000_000 && sel.runs.length > 0));
    },
    [cmd, store],
  );

  // Reinício a cada acionamento: a seleção atual entra como ponto de partida.
  useEffect(() => {
    setPts([]);
    setMessage(null);
    setPhase("selecionar");
    setPending(null);
    setTextAt(null);
    setPending3d([]);
    setDesvioStart(null);
    if (!isMeasureCmd(cmd)) (setMeasures([]), setMeasures3d([]));
    if (NEEDS_SELECTION.has(cmd)) argsRef.current.setSelection(editable(argsRef.current.selection));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd, n]);

  const z = cs.worldToIfc([0, level, 0])[2];
  const planToWorld = useCallback((p: P2, y: number): Vec3 => cs.ifcToWorld([p[0], p[1], cs.worldToIfc([0, y, 0])[2]]), [cs]);
  const planDelta = useCallback(
    (d: P2): Vec3 => {
      const o = planToWorld([0, 0], 0);
      const b = planToWorld(d, 0);
      return [b[0] - o[0], 0, b[2] - o[2]];
    },
    [planToWorld],
  );
  const toPlan = useCallback((v: Vec3): P2 => {
    const p = cs.worldToIfc(v);
    return [p[0], p[1]];
  }, [cs]);

  const addDraft = useCallback((e: DraftEntity | DraftEntity[]) => store.setDrafts((d) => [...d, ...(Array.isArray(e) ? e : [e])]), [store]);
  const base = a.draftView ? { storey, view: a.draftView } : { storey };

  const coordLabel = useCallback(
    (p: P2): string => {
      const m = a.georef.map;
      const lines = [`X ${fmtCoord(p[0], 3)}  Y ${fmtCoord(p[1], 3)}`];
      if (m) {
        const e = toMap(m, [p[0], p[1], z]);
        lines.push(`E ${fmtCoord(e[0], 3)}  N ${fmtCoord(e[1], 3)}`);
      }
      return lines.join("\n");
    },
    [a.georef.map, z],
  );

  /** Entidade criada pelos pontos (o último pode ser o cursor). */
  const build = useCallback(
    (p: P2[]): DraftEntity | null => {
      const id = 0;
      switch (cmd) {
        case "linha":
          return p.length >= 2 ? { id, ...base, kind: "linha", a: p[0], b: p[1] } : null;
        case "arco": {
          if (p.length < 3) return null;
          const r = arcFrom3(p[0], p[1], p[2]);
          return r ? { id, ...base, kind: "arco", ...r } : null;
        }
        case "circulo":
          return p.length >= 2 && dist(p[0], p[1]) > 1e-4 ? { id, ...base, kind: "circulo", c: p[0], r: dist(p[0], p[1]) } : null;
        case "elipse": {
          if (p.length < 2) return null;
          const rx = dist(p[0], p[1]);
          if (rx < 1e-4) return null;
          const rot = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
          const ry = p.length >= 3 ? Math.abs(-(p[2][0] - p[0][0]) * Math.sin(rot) + (p[2][1] - p[0][1]) * Math.cos(rot)) : rx / 2;
          return ry > 1e-4 ? { id, ...base, kind: "elipse", c: p[0], rx, ry, rot } : null;
        }
        case "quadrado":
          return p.length >= 2 && dist(p[0], p[1]) > 1e-4 ? { id, ...base, kind: "poligono", pts: squareFrom(p[0], p[1]), closed: true, shape: "quadrado" } : null;
        case "retangulo":
          return p.length >= 2 && Math.abs(p[0][0] - p[1][0]) > 1e-4 && Math.abs(p[0][1] - p[1][1]) > 1e-4
            ? { id, ...base, kind: "poligono", pts: rectFrom(p[0], p[1]), closed: true, shape: "retangulo" }
            : null;
        case "triangulo":
          return p.length >= 3 ? { id, ...base, kind: "poligono", pts: p.slice(0, 3), closed: true, shape: "triangulo" } : p.length === 2 ? { id, ...base, kind: "poligono", pts: p, closed: false } : null;
        case "poligonal":
          return p.length >= 2 ? { id, ...base, kind: "poligono", pts: p, closed: opts.closed && p.length >= 3, shape: "poligonal" } : null;
        case "texto":
          return p.length >= 1 && opts.text.trim() ? { id, ...base, kind: "texto", p: p[0], text: opts.text, size: opts.textSize, rot: (opts.textRot * Math.PI) / 180 } : null;
        case "cota-ortogonal": {
          if (p.length < 2) return null;
          const at = p[2] ?? p[1];
          const mid: P2 = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
          // Linha de cota afastada na vertical → cota horizontal; na horizontal → vertical.
          const mode = p.length < 3 ? (Math.abs(p[1][0] - p[0][0]) >= Math.abs(p[1][1] - p[0][1]) ? "horizontal" : "vertical") : Math.abs(at[1] - mid[1]) >= Math.abs(at[0] - mid[0]) ? "horizontal" : "vertical";
          return { id, ...base, kind: "cota", mode, a: p[0], b: p[1], at };
        }
        case "cota-inclinada":
          return p.length >= 2 && dist(p[0], p[1]) > 1e-4 ? { id, ...base, kind: "cota", mode: "alinhada", a: p[0], b: p[1], at: p[2] ?? p[1] } : null;
        case "cota-angular":
          return p.length >= 3 ? { id, ...base, kind: "cota-angular", c: p[0], p1: p[1], p2: p[2], at: p[3] ?? p[2] } : null;
        case "coordenada":
          return p.length >= 1 ? { id, ...base, kind: "coordenada", p: p[0], at: p[1] ?? [p[0][0] + 0.5, p[0][1] + 0.5], label: coordLabel(p[0]) } : null;
        default:
          return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cmd, storey, opts, coordLabel],
  );

  /** Pontos necessários por comando de criação (poligonal: aberto, termina com Enter). */
  const needed: Partial<Record<DraftCmd, number>> = {
    linha: 2,
    arco: 3,
    circulo: 2,
    elipse: 3,
    quadrado: 2,
    retangulo: 2,
    triangulo: 3,
    texto: 1,
    "cota-ortogonal": 3,
    "cota-inclinada": 3,
    "cota-angular": 4,
    coordenada: 2,
    "corte-linha": 3,
    "vista-3d": 2,
    ampliacao: 2,
  };

  const state = () => editState(argsRef.current.store);
  const picked = useMemo(() => splitSelection(a.selection, editState(store)), [a.selection, store]);
  const count = cmd === "corte-selecao" ? a.selection.length : pickedCount(picked);

  // ---- Execução dos comandos de modificação ----------------------------------------------------
  const commitEdit = useCallback((next: EditState) => store.mutate((cur) => ({ ...cur, ...next })), [store]);

  const bboxBase = (): P2 => {
    const ps = itemPlanPoints(state(), picked, toPlan, draftSnapPoints);
    if (!ps.length) return [0, 0];
    return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1]))];
  };

  const done = (msg: string) => {
    setMessage(msg);
    setPts([]);
    setPhase("selecionar");
  };

  const execute = () => {
    const st = state();
    switch (cmd) {
      case "apagar": {
        const n0 = pickedCount(picked);
        commitEdit(deleteItems(st, picked));
        a.setSelection([]);
        return done(`${n0} elemento(s) apagado(s).`);
      }
      case "recortar": {
        clipboard = toClipboard(st, picked, bboxBase(), storey, level);
        setClipVersion((v) => v + 1);
        commitEdit(deleteItems(st, picked));
        a.setSelection([]);
        return done(`${pickedCount(picked)} elemento(s) recortado(s). Use Colar para inserir (inclusive em outro pavimento).`);
      }
      case "conectar": {
        const list = st.drafts.filter((d) => picked.drafts.includes(d.id));
        const r = connectEntities(list);
        if (!r) return setMessage("Nada a conectar: selecione duas linhas que se cruzam (canto) ou linhas/poligonais que se tocam nas pontas.");
        store.setDrafts((d) => [...d.filter((x) => !r.remove.includes(x.id)), ...r.add]);
        a.setSelection(r.add.map((x) => x.id));
        return done(r.add.length === 1 ? "Elementos unidos em uma poligonal." : "Linhas conectadas no canto.");
      }
      case "corte-selecao": {
        const ids = a.selection;
        const draftIds = new Set(picked.drafts);
        const box = a.boundsOf(ids.filter((id) => !draftIds.has(id)));
        const dps = itemPlanPoints(st, { points: [], runs: [], drafts: picked.drafts }, toPlan, draftSnapPoints);
        let min: Vec3 | null = box?.min ?? null;
        let max: Vec3 | null = box?.max ?? null;
        for (const p of dps) {
          for (const y of [level, level + a.storeyHeight - 0.05]) {
            const w = planToWorld(p, y);
            min = min ? [Math.min(min[0], w[0]), Math.min(min[1], w[1]), Math.min(min[2], w[2])] : w;
            max = max ? [Math.max(max[0], w[0]), Math.max(max[1], w[1]), Math.max(max[2], w[2])] : w;
          }
        }
        if (!min || !max) return setMessage("Não foi possível obter a extensão da seleção.");
        // Folga de 30 cm em planta; na vertical, só o necessário para não cortar faces (sem pegar a laje de cima).
        const m = 0.3;
        const mv = 0.02;
        const lo: Vec3 = [min[0] - m, min[1] - mv, min[2] - m];
        const hi: Vec3 = [max[0] + m, max[1] + mv, max[2] + m];
        // Tudo no pavimento atual: a caixa para abaixo do piso de cima (paredes que entram na laje não a trazem junto).
        const ceil = a.ceilingAt([(min[0] + max[0]) / 2, level + 1, (min[2] + max[2]) / 2]);
        const top = Math.min(level + a.storeyHeight - 0.05, ceil != null ? ceil - 0.01 : Infinity);
        if (min[1] >= level - 0.15 && hi[1] > top) hi[1] = top;
        askSection({
          id: newViewId("3d"),
          name: nextViewName(store.views, "3d", storey).replace("Vista 3D", "Corte 3D"),
          kind: "3d",
          section: "trabalho",
          storey,
          scale: 50,
          clip: [
            { normal: [1, 0, 0], point: lo },
            { normal: [0, 1, 0], point: lo },
            { normal: [0, 0, 1], point: lo },
            { normal: [-1, 0, 0], point: hi },
            { normal: [0, -1, 0], point: hi },
            { normal: [0, 0, -1], point: hi },
          ],
          frame: { min: lo, max: hi },
        });
        setPts([]);
        setPhase("selecionar");
        return;
      }
      default:
        setPhase("executar");
        setPts([]);
    }
  };

  const finishSelection = () => {
    if (!count) return setMessage("Selecione ao menos um elemento.");
    setMessage(null);
    setPhase("confirmar");
  };

  /** Pergunta a seção da vista criada e, escolhida, salva e abre. */
  const askSection = (v: ViewDef) => {
    setMessage(null);
    setPending(v);
  };
  const createIn = (section: ViewSection) => {
    if (!pending) return;
    const v: ViewDef = { ...pending, section, ...(section === "documentacao" ? { refDisciplines: [], background: true, halftoneBackground: true } : {}) };
    store.setViews((l) => [...l, v]);
    setPending(null);
    setMessage(`“${v.name}” criada em ${SECTION_LABEL[section]}.`);
    a.onCreateView(v);
  };

  const question: ToolQuestion | null = pending
    ? {
        text: `“${pending.name}”: esta vista é para Trabalho ou para Documentação (vai para as folhas)?`,
        options: [
          { label: "Trabalho", run: () => createIn("trabalho") },
          { label: "Documentação", primary: true, run: () => createIn("documentacao") },
          { label: "Cancelar", run: () => (setPending(null), setMessage("Criação cancelada.")) },
        ],
      }
    : NEEDS_SELECTION.has(cmd) && phase === "confirmar"
      ? {
          text: `${count} elemento(s) selecionado(s). Deseja remover algum elemento da seleção?`,
          options: [
            { label: "Sim, remover", run: () => setPhase("remover") },
            { label: "Não, concluir", primary: true, run: execute },
          ],
        }
      : null;

  const toggle = (id: number, remove: boolean) => {
    const cur = argsRef.current.selection;
    const ids = editable([id]);
    if (!ids.length) return;
    // Trechos: todos os segmentos do mesmo trecho contam como um elemento.
    const same = (x: number) => x === id || (id <= -1_000_000 && x <= -1_000_000 && Math.floor((-x - 1_000_000) / 1000) === Math.floor((-id - 1_000_000) / 1000));
    const has = cur.some(same);
    if (remove) a.setSelection(cur.filter((x) => !same(x)));
    else if (!has) a.setSelection([...cur, id]);
  };

  // ---- Cliques ---------------------------------------------------------------------------
  const onCreateClick = (p: P2) => {
    if (cmd === "texto") return setTextAt(p);
    const last = pts[pts.length - 1];
    if (last && dist(last, p) < 1e-6) return; // duplo clique: ignora o ponto repetido
    const next = [...pts, p];
    if (cmd === "poligonal") {
      if (next.length >= 3 && dist(next[0], p) < 1e-3) {
        addDraft({ ...(build(next.slice(0, -1)) as DraftEntity), closed: true, id: newDraftId() } as DraftEntity);
        return setPts([]);
      }
      return setPts(next);
    }
    const need = needed[cmd] ?? 2;
    if (next.length < need) return setPts(next);
    const e = build(next);
    if (e) addDraft({ ...e, id: newDraftId() } as DraftEntity);
    // Linha encadeada: o fim vira o início da próxima.
    setPts(cmd === "linha" ? [p] : []);
  };

  const onModifyClick = (p: P2, info: ClickInfo) => {
    const st = state();
    if (cmd === "colar") {
      const c = clipboard;
      if (!c) return setMessage("A área de transferência está vazia: use Copiar ou Recortar.");
      const r = insertCopies(st, c, { d: [p[0] - c.base[0], p[1] - c.base[1]], storey, dy: level - c.level, view: a.draftView }, planDelta);
      commitEdit(r.state);
      a.setSelection(r.ids);
      return setMessage(`${r.ids.length} elemento(s) colado(s)${c.storey !== storey ? ` de ${c.storey} em ${storey}` : ""}. Clique para colar novamente ou Esc.`);
    }
    if (cmd === "estender") {
      let boundary: [P2, P2][] = [];
      const hitDraft = info.id != null ? st.drafts.find((d) => d.id === info.id) : undefined;
      if (hitDraft && !picked.drafts.includes(hitDraft.id)) boundary = draftSegments(hitDraft);
      else if (info.edge) boundary = [info.edge];
      if (!boundary.length) return setMessage("Clique em um limite: outra linha/forma desenhada ou a face de uma parede.");
      let changed = 0;
      const drafts = st.drafts.map((d) => {
        if (d.kind !== "linha" || !picked.drafts.includes(d.id)) return d;
        const r = extendLine(d, boundary);
        if (r) changed++;
        return r ?? d;
      });
      if (!changed) return setMessage("Nenhuma linha selecionada alcança esse limite.");
      store.setDrafts(() => drafts);
      return setMessage(`${changed} linha(s) estendida(s). Clique em outro limite ou Esc.`);
    }
    if (cmd === "copiar" || cmd === "mover") {
      if (!pts.length) return setPts([p]);
      const d: P2 = [p[0] - pts[0][0], p[1] - pts[0][1]];
      if (cmd === "mover") {
        commitEdit(moveItems(st, picked, d, planDelta));
        return done(`${pickedCount(picked)} elemento(s) movido(s).`);
      }
      clipboard = toClipboard(st, picked, pts[0], storey, level);
      setClipVersion((v) => v + 1);
      const r = insertCopies(st, clipboard, { d, storey, dy: 0, view: a.draftView }, planDelta);
      commitEdit(r.state);
      if (!opts.repeat) {
        a.setSelection(r.ids);
        return done(`${r.ids.length} elemento(s) copiado(s).`);
      }
      return setMessage(`${r.ids.length} elemento(s) copiado(s). Clique em outro destino ou Esc para terminar.`);
    }
    if (pending) return;
    if (cmd === "corte-linha") {
      const next = [...pts, p];
      if (next.length < 3) return setPts(next);
      const [p0, p1, side] = next;
      const dir: P2 = [p1[0] - p0[0], p1[1] - p0[1]];
      const left = -dir[1] * (side[0] - p0[0]) + dir[0] * (side[1] - p0[1]) >= 0;
      setPts([]);
      return askSection({
        id: newViewId("corte"),
        name: nextViewName(store.views, "corte"),
        kind: "corte",
        section: "trabalho",
        storey,
        scale: 50,
        cut: { a: p0, b: p1, side: left ? 1 : -1, depth: Math.round(Math.max(2, Math.min(15, Math.hypot(side[0] - p0[0], side[1] - p0[1]) * 2 + 3)) * 2) / 2 },
      });
    }
    if (cmd === "ampliacao") {
      const next = [...pts, p];
      if (next.length < 2) return setPts(next);
      const [q0, q1] = next;
      setPts([]);
      if (Math.abs(q1[0] - q0[0]) < 0.2 || Math.abs(q1[1] - q0[1]) < 0.2) return setMessage("Retângulo muito pequeno.");
      return askSection({
        id: newViewId("ampliacao"),
        name: nextViewName(store.views, "ampliacao", storey),
        kind: "ampliacao",
        section: "trabalho",
        storey,
        scale: 25,
        cutHeight: a.cutHeight,
        region: { min: [Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1])], max: [Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1])] },
      });
    }
    if (cmd === "vista-3d") {
      const next = [...pts, p];
      if (next.length < 2) return setPts(next);
      const y = level + opts.eyeHeight;
      setPts([]);
      return askSection({
        id: newViewId("3d"),
        name: nextViewName(store.views, "3d", storey),
        kind: "3d",
        section: "trabalho",
        storey,
        scale: 50,
        eye: planToWorld(next[0], y),
        target: planToWorld(next[1], y),
      });
    }
  };

  // ---- Desvio ------------------------------------------------------------------------------
  /** Posição (0–1) do clique ao longo do segmento, pela projeção em planta. */
  const segParam = (runId: number, index: number, p: P2): number | null => {
    const r = store.runs.find((x) => x.id === runId);
    if (!r || !r.vertices[index + 1]) return null;
    const a0 = toPlan(r.vertices[index]);
    const b0 = toPlan(r.vertices[index + 1]);
    const ab: P2 = [b0[0] - a0[0], b0[1] - a0[1]];
    const l2 = ab[0] ** 2 + ab[1] ** 2;
    if (l2 < 1e-10) return null;
    return Math.max(0, Math.min(1, ((p[0] - a0[0]) * ab[0] + (p[1] - a0[1]) * ab[1]) / l2));
  };
  const onDesvioClick = (p: P2, info: ClickInfo) => {
    if (a.isSection) return setMessage("Faça o desvio na planta: clique nos dois pontos do trecho.");
    if (!desvioStart) {
      const runId = info.id != null ? runIdOfElement(info.id) : null;
      const index = info.id != null ? segmentIndexOf(info.id) : null;
      if (runId == null || index == null) return setMessage("Clique sobre um segmento de tubulação, eletroduto rígido, eletrocalha ou duto.");
      const t = segParam(runId, index, p);
      if (t == null) return setMessage("Segmento vertical: clique num trecho horizontal.");
      return setDesvioStart({ runId, index, t });
    }
    const t = segParam(desvioStart.runId, desvioStart.index, p);
    const r = store.runs.find((x) => x.id === desvioStart.runId);
    if (t == null || !r) return setDesvioStart(null);
    const res = applyOffset(r, desvioStart.index, desvioStart.t, t, { height: opts.desvioAltura / 1000, up: opts.desvioSobe, angle: opts.desvioAngulo }, store.runs);
    setDesvioStart(null);
    if (!res.ok) return setMessage(res.reason);
    store.updateRuns([r.id], () => ({ vertices: res.vertices }));
    setMessage(`Desvio de ${opts.desvioAltura} mm ${opts.desvioSobe ? "para cima" : "para baixo"} no trecho ${r.tag}. Clique em outro trecho para mais um desvio, ou Esc.`);
  };

  const tool: PlanTool = {
    prompt: textAt ? "Texto: digite e tecle Enter para gravar · Esc cancela" : promptFor(cmd, phase, cmd === "desvio" ? (desvioStart ? 1 : 0) : Math.max(pts.length, pending3d.length), count),
    question,
    textInput: textAt
      ? {
          at: textAt,
          value: "",
          onCommit: (v) => {
            if (v.trim()) {
              addDraft({ id: newDraftId(), ...base, kind: "texto", p: textAt, text: v, size: opts.textSize, rot: (opts.textRot * Math.PI) / 180 } as DraftEntity);
            }
            setTextAt(null);
            a.onDone();
          },
          onCancel: () => {
            setTextAt(null);
            a.onDone();
          },
        }
      : null,
    selecting: !pending && NEEDS_SELECTION.has(cmd) && phase !== "executar" && phase !== "confirmar",
    snap: !(NEEDS_SELECTION.has(cmd) && phase !== "executar") && !(cmd === "estender"),
    // Retângulo por cantos opostos: o ortogonal deixaria o segundo canto sem área.
    anchor: cmd === "retangulo" ? null : (pts[pts.length - 1] ?? null),
    preview(cursor) {
      const out: Prim[] = [];
      if (cmd === "desvio") {
        const r = desvioStart ? store.runs.find((x) => x.id === desvioStart.runId) : undefined;
        if (r && desvioStart) {
          const a0 = toPlan(r.vertices[desvioStart.index]);
          const b0 = toPlan(r.vertices[desvioStart.index + 1]);
          const at = (t: number): P2 => [a0[0] + (b0[0] - a0[0]) * t, a0[1] + (b0[1] - a0[1]) * t];
          const s0 = at(desvioStart.t);
          out.push({ t: "circle", c: s0, r: 0.06, weight: 0.3, fill: PREVIEW, color: PREVIEW, layer: "PREVIEW" });
          if (cursor) {
            const t1 = segParam(desvioStart.runId, desvioStart.index, cursor) ?? desvioStart.t;
            const e0 = at(t1);
            out.push({ t: "line", a: s0, b: e0, weight: 0.6, color: PREVIEW, layer: "PREVIEW" });
            out.push({ t: "circle", c: e0, r: 0.06, weight: 0.3, fill: PREVIEW, color: PREVIEW, layer: "PREVIEW" });
            const len = Math.hypot(e0[0] - s0[0], e0[1] - s0[1]);
            out.push({ t: "text", p: [(s0[0] + e0[0]) / 2, (s0[1] + e0[1]) / 2 + 0.15], text: `desvio ${opts.desvioSobe ? "↑" : "↓"} ${opts.desvioAltura} mm · ${len.toFixed(2).replace(".", ",")} m`, height: 0.13, anchor: "middle", color: PREVIEW, layer: "PREVIEW" });
          }
        }
        return out;
      }
      if (isMeasureCmd(cmd)) {
        const kind: Measure["kind"] = cmd === "medir-area" ? "area" : cmd === "medir-angulo" ? "angulo" : "distancia";
        const live = cursor && pts.length ? [{ kind, pts: [...pts, cursor] }] : [];
        for (const m of [...measures, ...live]) out.push(...measurePrims(m));
        return out;
      }
      if (cmd === "texto" && textAt) return out;
      if (isCreateCmd(cmd)) {
        const p = cursor ? [...pts, cursor] : pts;
        const e = build(p);
        if (e) out.push(...recolor(draftPrims(e, SCALE)));
        if (cursor && pts.length && !e) out.push(line(pts[pts.length - 1], cursor));
        if (cmd === "elipse" && cursor && pts.length === 2) out.push(line(pts[0], pts[1]));
        if (cmd === "cota-angular" && cursor && pts.length >= 1 && pts.length < 3) {
          pts.slice(1).forEach((q) => out.push(line(pts[0], q, false)));
          out.push(line(pts[0], cursor));
        }
        if (cmd === "poligonal" && cursor && pts.length >= 2 && dist(cursor, pts[0]) < 1e-3) out.push({ t: "circle", c: pts[0], r: 0.08, weight: 0.3, color: PREVIEW, layer: "PREVIEW" });
        return out;
      }
      if ((cmd === "copiar" || cmd === "mover" || cmd === "colar") && cursor) {
        const st = state();
        const src = cmd === "colar" ? clipboard : { ...toClipboard(st, picked, pts[0] ?? cursor, storey, level) };
        if (!src || (cmd !== "colar" && !pts.length)) return out;
        const d: P2 = [cursor[0] - src.base[0], cursor[1] - src.base[1]];
        if (cmd !== "colar") out.push(line(src.base, cursor));
        for (const e of src.drafts) out.push(...recolor(draftPrims({ ...e, ...shift(e, d) } as DraftEntity, SCALE)));
        for (const p of src.points) {
          const c = toPlan(p.position);
          out.push({ t: "circle", c: [c[0] + d[0], c[1] + d[1]], r: 0.12, weight: 0.25, color: PREVIEW, layer: "PREVIEW" });
        }
        for (const r of src.runs) {
          const vs = r.vertices.map(toPlan).map((q): P2 => [q[0] + d[0], q[1] + d[1]]);
          out.push({ t: "poly", pts: vs, closed: false, weight: 0.35, color: PREVIEW, layer: "PREVIEW" });
        }
        return out;
      }
      if (cmd === "ampliacao" && cursor && pts.length === 1) {
        const [q0] = pts;
        out.push({ t: "poly", pts: [q0, [cursor[0], q0[1]], cursor, [q0[0], cursor[1]]], closed: true, weight: 0.25, color: PREVIEW, layer: "PREVIEW", dashed: true });
        return out;
      }
      if ((cmd === "corte-linha" || cmd === "vista-3d") && cursor && pts.length) {
        out.push(line(pts[0], pts[1] ?? cursor, false));
        if (cmd === "vista-3d") {
          const tgt = pts[1] ?? cursor;
          const ang = Math.atan2(tgt[1] - pts[0][1], tgt[0] - pts[0][0]);
          const fov = 0.5;
          for (const s of [-1, 1]) out.push(line(pts[0], [pts[0][0] + Math.cos(ang + s * fov) * 2, pts[0][1] + Math.sin(ang + s * fov) * 2]));
          out.push({ t: "circle", c: pts[0], r: 0.15, weight: 0.3, color: PREVIEW, layer: "PREVIEW" });
        }
        if (cmd === "corte-linha" && pts.length === 2) {
          const mid: P2 = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
          out.push(line(mid, cursor));
        }
      }
      return out;
    },
    click(p, info) {
      if (pending) return;
      setMessage(null);
      if (cmd === "desvio") return onDesvioClick(p, info);
      if (isMeasureCmd(cmd)) {
        const last = pts[pts.length - 1];
        if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-6) return; // duplo clique
        const next = [...pts, p];
        // Ângulo: 3 pontos fecham a medição; área e distância continuam até Enter/duplo clique.
        if (cmd === "medir-angulo" && next.length === 3) {
          setMeasures((m) => [...m, { kind: "angulo", pts: next }]);
          return setPts([]);
        }
        return setPts(next);
      }
      if (isCreateCmd(cmd)) return onCreateClick(p);
      if (NEEDS_SELECTION.has(cmd) && (phase === "selecionar" || phase === "remover")) {
        if (info.id == null) return;
        return toggle(info.id, phase === "remover" || info.shift || info.ctrl);
      }
      if (NEEDS_SELECTION.has(cmd) && phase === "confirmar") return;
      onModifyClick(p, info);
    },
    box(ids, info) {
      if (!(phase === "selecionar" || phase === "remover")) return;
      const cur = argsRef.current.selection;
      const valid = editable(ids);
      if (phase === "remover" || info.shift || info.ctrl) {
        const rm = new Set(valid);
        const rmRuns = new Set(valid.filter((x) => x <= -1_000_000).map((x) => Math.floor((-x - 1_000_000) / 1000)));
        a.setSelection(cur.filter((x) => !rm.has(x) && !(x <= -1_000_000 && rmRuns.has(Math.floor((-x - 1_000_000) / 1000)))));
      } else a.setSelection([...new Set([...cur, ...valid])]);
    },
    finish() {
      if (isMeasureCmd(cmd)) {
        if (cmd === "medir-distancia" && pts.length >= 2) setMeasures((m) => [...m, { kind: "distancia", pts }]);
        if (cmd === "medir-area" && pts.length >= 3) setMeasures((m) => [...m, { kind: "area", pts }]);
        return setPts([]);
      }
      if (isCreateCmd(cmd)) {
        if (cmd === "poligonal" && pts.length >= 2) {
          const e = build(pts);
          if (e) addDraft({ ...e, id: newDraftId() } as DraftEntity);
        }
        return setPts([]);
      }
      if (NEEDS_SELECTION.has(cmd)) {
        if (phase === "selecionar") return finishSelection();
        if (phase === "remover") return execute();
        if (phase === "confirmar") return execute();
      }
      setPts([]);
    },
    cancel() {
      if (pts.length) return setPts([]);
      if (NEEDS_SELECTION.has(cmd) && phase !== "selecionar") {
        setPhase("selecionar");
        return setMessage(null);
      }
      if (NEEDS_SELECTION.has(cmd)) a.setSelection([]);
    },
  };

  const kind3d: Measure3["kind"] = cmd === "medir-area" ? "area" : cmd === "medir-angulo" ? "angulo" : "distancia";
  return {
    tool,
    phase,
    setPhase,
    count,
    picked,
    message,
    setMessage,
    opts,
    setOpts,
    finishSelection,
    execute,
    clipboard: clipVersion >= 0 ? clipboard : null,
    angleDeg,
    measures,
    setMeasures,
    measures3d,
    setMeasures3d,
    /** Medição em andamento no 3D (para desenhar com o ponto sob o cursor). */
    pending3d: isMeasureCmd(cmd) ? ({ kind: kind3d, pts: pending3d } as Measure3) : null,
    click3d: (q: Vec3) => {
      const last = pending3d[pending3d.length - 1];
      if (last && Math.hypot(last[0] - q[0], last[1] - q[1], last[2] - q[2]) < 1e-6) return;
      const next = [...pending3d, q];
      if (kind3d === "angulo" && next.length === 3) {
        setMeasures3d((m) => [...m, { kind: "angulo", pts: next }]);
        return setPending3d([]);
      }
      setPending3d(next);
    },
    finish3d: () => {
      if (kind3d === "distancia" && pending3d.length >= 2) setMeasures3d((m) => [...m, { kind: "distancia", pts: pending3d }]);
      if (kind3d === "area" && pending3d.length >= 3) setMeasures3d((m) => [...m, { kind: "area", pts: pending3d }]);
      setPending3d([]);
    },
    /** Grava uma medição como texto na vista (anotação permanente). */
    measureToText: (m: Measure) => addDraft({ id: newDraftId(), ...base, kind: "texto", p: labelPoint(m), text: measureText(m), size: 2.5, rot: 0 } as DraftEntity),
  };
}

export type DraftController = ReturnType<typeof useDraftTool>;

const shift = (e: DraftEntity, d: P2): Partial<DraftEntity> => {
  const t = (p: P2): P2 => [p[0] + d[0], p[1] + d[1]];
  switch (e.kind) {
    case "linha":
      return { a: t(e.a), b: t(e.b) };
    case "arco":
    case "circulo":
    case "elipse":
      return { c: t(e.c) };
    case "poligono":
      return { pts: e.pts.map(t) };
    case "texto":
      return { p: t(e.p) };
    case "cota":
      return { a: t(e.a), b: t(e.b), at: t(e.at) };
    case "cota-angular":
      return { c: t(e.c), p1: t(e.p1), p2: t(e.p2), at: t(e.at) };
    case "coordenada":
      return { p: t(e.p), at: t(e.at) };
  }
};

function editState(store: PointsStore): EditState {
  return { points: store.points, runs: store.runs, drafts: store.drafts };
}

function promptFor(cmd: DraftCmd, phase: Phase, k: number, count: number): string {
  if (NEEDS_SELECTION.has(cmd) && phase !== "executar") {
    const what = cmd === "corte-selecao" ? "os elementos que definem o corte" : cmd === "estender" ? "as linhas a estender" : cmd === "conectar" ? "as linhas/poligonais a conectar" : "os elementos";
    if (phase === "selecionar") return `${CMD_LABEL[cmd]}: selecione ${what} (clique ou janela; Shift/Ctrl+clique tira) · ${count} selecionado(s) · Enter conclui a seleção`;
    if (phase === "confirmar") return `${CMD_LABEL[cmd]}: deseja remover algum elemento da seleção?`;
    return `${CMD_LABEL[cmd]}: clique nos elementos (ou janela) a remover da seleção · ${count} restante(s) · Enter conclui`;
  }
  const steps: Partial<Record<DraftCmd, string[]>> = {
    linha: ["ponto inicial", "próximo ponto (Enter ou duplo clique termina)"],
    arco: ["ponto inicial", "ponto no arco", "ponto final"],
    circulo: ["centro", "ponto do raio"],
    elipse: ["centro", "fim do primeiro eixo", "ponto do segundo eixo"],
    quadrado: ["primeiro vértice do lado", "segundo vértice do lado"],
    retangulo: ["primeiro canto", "canto oposto"],
    triangulo: ["primeiro vértice", "segundo vértice", "terceiro vértice"],
    poligonal: ["primeiro ponto", "próximo ponto", "próximo ponto (Enter termina; clique no primeiro ponto fecha)"],
    texto: ["clique onde o texto começa (a altura e a rotação ficam no painel)"],
    "cota-ortogonal": ["primeiro ponto", "segundo ponto", "posição da linha de cota (acima/abaixo: horizontal; ao lado: vertical)"],
    "cota-inclinada": ["primeiro ponto", "segundo ponto", "posição da linha de cota"],
    "cota-angular": ["vértice do ângulo", "ponto na primeira direção", "ponto na segunda direção", "posição do arco de cota"],
    coordenada: ["ponto a indicar", "posição do texto"],
    copiar: ["ponto base", "ponto de destino"],
    mover: ["ponto base", "ponto de destino"],
    colar: ["ponto de inserção (canto inferior esquerdo do que foi copiado, ou o ponto base da cópia)"],
    estender: ["clique no limite (linha, forma ou face de parede)"],
    "corte-linha": ["primeiro ponto da linha de corte", "segundo ponto", "clique do lado que deve ficar visível"],
    "vista-3d": ["posição do observador", "direção para onde olhar"],
    ampliacao: ["primeiro canto da área a ampliar", "canto oposto"],
    "medir-distancia": ["primeiro ponto", "próximo ponto (Enter ou duplo clique encerra; vários pontos somam os trechos)"],
    "medir-area": ["primeiro vértice", "próximo vértice", "próximo vértice (Enter ou duplo clique fecha a área)"],
    "medir-angulo": ["ponto na primeira direção", "vértice do ângulo", "ponto na segunda direção"],
    desvio: ["clique no início do desvio, sobre o trecho", "clique no fim do desvio (no mesmo trecho)"],
  };
  const s = steps[cmd] ?? [];
  return `${CMD_LABEL[cmd]}: ${s[Math.min(k, s.length - 1)] ?? ""} · Esc cancela`;
}

/** Desenho de uma medição: linhas tracejadas em magenta e o valor junto. */
const MEASURE = "#db2777";
function measurePrims(m: Measure): Prim[] {
  const base = { color: MEASURE, layer: "PREVIEW" };
  const out: Prim[] = [];
  if (m.pts.length >= 2) out.push({ t: "poly", pts: m.pts, closed: m.kind === "area" && m.pts.length >= 3, weight: 0.3, dashed: true, ...base, fill: null });
  for (const q of m.pts) out.push({ t: "circle", c: q, r: 0.04, weight: 0.3, fill: MEASURE, ...base });
  const ok = m.kind === "distancia" ? m.pts.length >= 2 : m.kind === "area" ? m.pts.length >= 3 : m.pts.length >= 3;
  if (ok) {
    const at = labelPoint(m);
    out.push({ t: "text", p: [at[0], at[1] + 0.15], text: measureText(m), height: 0.14, anchor: "middle", ...base });
  }
  return out;
}
