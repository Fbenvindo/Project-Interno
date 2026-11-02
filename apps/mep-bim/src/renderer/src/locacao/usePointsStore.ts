import { useCallback, useMemo, useState } from "react";
import type { PlacedPoint } from "../../../core/points";
import type { Run } from "../../../core/runs";
import type { Circuit } from "../../../core/circuits";
import { EMPTY_PROGRAM, type ProgramState } from "../../../core/program";
import type { LinkMeta } from "../../../ifc/federate";
import type { GeorefSettings } from "../../../core/georef";

interface ProjectState {
  points: PlacedPoint[];
  runs: Run[];
  circuits: Circuit[];
  program: ProgramState;
  links: LinkMeta[];
  georef: GeorefSettings | null;
}

interface History {
  past: ProjectState[];
  present: ProjectState;
  future: ProjectState[];
  saved: ProjectState;
  /** Chave da última edição, para agrupar alterações seguidas do mesmo campo. */
  lastKey: string | null;
}

const LIMIT = 200;
const EMPTY: ProjectState = { points: [], runs: [], circuits: [], program: EMPTY_PROGRAM, links: [], georef: null };

type Patch<T> = (item: T) => Partial<T>;

function patchList<T extends { id: number }>(list: T[], ids: number[], patch: Patch<T>): T[] {
  const set = new Set(ids);
  return list.some((x) => set.has(x.id)) ? list.map((x) => (set.has(x.id) ? { ...x, ...patch(x) } : x)) : list;
}

function removeFrom<T extends { id: number }>(list: T[], ids: number[]): T[] {
  const set = new Set(ids);
  const next = list.filter((x) => !set.has(x.id));
  return next.length === list.length ? list : next;
}

/**
 * Estado do projeto do app (pontos locados e trechos), com um único
 * histórico de desfazer/refazer e controle de alterações não salvas.
 */
export function usePointsStore() {
  const [h, setH] = useState<History>({ past: [], present: EMPTY, future: [], saved: EMPTY, lastKey: null });

  const commit = useCallback((fn: (cur: ProjectState) => ProjectState, key: string | null = null) => {
    setH((s) => {
      const next = fn(s.present);
      if (next.points === s.present.points && next.runs === s.present.runs && next.circuits === s.present.circuits && next.program === s.present.program && next.links === s.present.links && next.georef === s.present.georef) return s;
      if (key && key === s.lastKey) return { ...s, present: next, future: [] };
      return { ...s, past: [...s.past.slice(-LIMIT + 1), s.present], present: next, future: [], lastKey: key };
    });
  }, []);

  // ---- Pontos -----------------------------------------------------------------
  const add = useCallback((pts: PlacedPoint[]) => pts.length && commit((cur) => ({ ...cur, points: [...cur.points, ...pts] })), [commit]);
  const update = useCallback(
    (ids: number[], patch: Patch<PlacedPoint>, key: string | null = null) =>
      commit((cur) => ({ ...cur, points: patchList(cur.points, ids, patch) }), key && `p:${key}:${ids.join(",")}`),
    [commit],
  );
  const remove = useCallback((ids: number[]) => commit((cur) => ({ ...cur, points: removeFrom(cur.points, ids) })), [commit]);

  // ---- Trechos ------------------------------------------------------------------
  const addRuns = useCallback((runs: Run[]) => runs.length && commit((cur) => ({ ...cur, runs: [...cur.runs, ...runs] })), [commit]);
  const updateRuns = useCallback(
    (ids: number[], patch: Patch<Run>, key: string | null = null) =>
      commit((cur) => ({ ...cur, runs: patchList(cur.runs, ids, patch) }), key && `r:${key}:${ids.join(",")}`),
    [commit],
  );
  const removeRuns = useCallback((ids: number[]) => commit((cur) => ({ ...cur, runs: removeFrom(cur.runs, ids) })), [commit]);

  // ---- Circuitos -----------------------------------------------------------------
  /** Mantém o parâmetro "Circuito" (nome exibido e exportado) igual ao nome do circuito. */
  const syncNames = (st: ProjectState): ProjectState => {
    const byUid = new Map(st.circuits.map((c) => [c.uid, c.name]));
    const fix = <T extends { circuit?: string | null; params: Record<string, string | number> }>(list: T[]): T[] => {
      let changed = false;
      const next = list.map((x) => {
        if (!x.circuit) return x;
        const name = byUid.get(x.circuit);
        if (name === undefined) {
          changed = true;
          const { Circuito: _drop, ...params } = x.params;
          return { ...x, circuit: null, params };
        }
        if (x.params.Circuito === name) return x;
        changed = true;
        return { ...x, params: { ...x.params, Circuito: name } };
      });
      return changed ? next : list;
    };
    return { ...st, points: fix(st.points), runs: fix(st.runs) };
  };

  const addCircuits = useCallback((cs: Circuit[]) => cs.length && commit((cur) => ({ ...cur, circuits: [...cur.circuits, ...cs] })), [commit]);
  const updateCircuits = useCallback(
    (ids: number[], patch: Patch<Circuit>, key: string | null = null) =>
      commit((cur) => syncNames({ ...cur, circuits: patchList(cur.circuits, ids, patch) }), key && `c:${key}:${ids.join(",")}`),
    [commit],
  );
  const removeCircuits = useCallback((ids: number[]) => commit((cur) => syncNames({ ...cur, circuits: removeFrom(cur.circuits, ids) })), [commit]);
  /** Liga pontos a um circuito (uid) ou os desliga (null). */
  const assignPoints = useCallback(
    (pointIds: number[], circuitUid: string | null) =>
      commit((cur) => {
        const set = new Set(pointIds);
        const points = cur.points.map((p) => {
          if (!set.has(p.id)) return p;
          if (circuitUid) return { ...p, circuit: circuitUid };
          const { Circuito: _drop, ...params } = p.params;
          return { ...p, circuit: null, params };
        });
        return syncNames({ ...cur, points });
      }),
    [commit],
  );
  /** Aplica uma alteração livre ao projeto inteiro (um passo de desfazer). */
  const mutate = useCallback((fn: (cur: ProjectState) => ProjectState) => commit((cur) => syncNames(fn(cur))), [commit]);

  /** Programa de necessidades (agrupa digitação seguida no mesmo campo). */
  const setProgram = useCallback((fn: (p: ProgramState) => ProgramState, key: string | null = null) => commit((cur) => ({ ...cur, program: fn(cur.program) }), key && `prog:${key}`), [commit]);

  /** Vínculos IFC (lista salva no projeto). */
  const setLinks = useCallback((fn: (l: LinkMeta[]) => LinkMeta[]) => commit((cur) => ({ ...cur, links: fn(cur.links) })), [commit]);

  /** Coordenadas do projeto. */
  const setGeoref = useCallback((g: GeorefSettings | null) => commit((cur) => ({ ...cur, georef: g }), "georef"), [commit]);

  /** Substitui todo o projeto e zera o histórico (abrir arquivo ou novo modelo). */
  const reset = useCallback(
    (points: PlacedPoint[], runs: Run[] = [], circuits: Circuit[] = [], program: ProgramState = EMPTY_PROGRAM, links: LinkMeta[] = [], georef: GeorefSettings | null = null) => {
    const state = { points, runs, circuits, program, links, georef };
    setH({ past: [], present: state, future: [], saved: state, lastKey: null });
  },
    [],
  );

  const markSaved = useCallback(() => setH((s) => ({ ...s, saved: s.present })), []);

  const undo = useCallback(
    () =>
      setH((s) =>
        s.past.length
          ? { ...s, past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], lastKey: null }
          : s,
      ),
    [],
  );

  const redo = useCallback(
    () =>
      setH((s) =>
        s.future.length ? { ...s, past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), lastKey: null } : s,
      ),
    [],
  );

  return useMemo(
    () => ({
      points: h.present.points,
      runs: h.present.runs,
      circuits: h.present.circuits,
      program: h.present.program,
      links: h.present.links,
      georef: h.present.georef,
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
      dirty: h.present !== h.saved,
      isEmpty: !h.present.points.length && !h.present.runs.length && !h.present.circuits.length && !Object.keys(h.present.program.rooms).length,
      add,
      update,
      remove,
      addRuns,
      updateRuns,
      removeRuns,
      addCircuits,
      updateCircuits,
      removeCircuits,
      assignPoints,
      mutate,
      setProgram,
      setLinks,
      setGeoref,
      reset,
      markSaved,
      undo,
      redo,
    }),
    [h, add, update, remove, addRuns, updateRuns, removeRuns, addCircuits, updateCircuits, removeCircuits, assignPoints, mutate, setProgram, setLinks, setGeoref, reset, markSaved, undo, redo],
  );
}

export type PointsStore = ReturnType<typeof usePointsStore>;
