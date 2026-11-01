import { useCallback, useMemo, useState } from "react";
import type { PlacedPoint } from "../../../core/points";
import type { Run } from "../../../core/runs";

interface ProjectState {
  points: PlacedPoint[];
  runs: Run[];
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
const EMPTY: ProjectState = { points: [], runs: [] };

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
      if (next.points === s.present.points && next.runs === s.present.runs) return s;
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

  /** Substitui todo o projeto e zera o histórico (abrir arquivo ou novo modelo). */
  const reset = useCallback((points: PlacedPoint[], runs: Run[] = []) => {
    const state = { points, runs };
    setH({ past: [], present: state, future: [], saved: state, lastKey: null });
  }, []);

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
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
      dirty: h.present !== h.saved,
      isEmpty: !h.present.points.length && !h.present.runs.length,
      add,
      update,
      remove,
      addRuns,
      updateRuns,
      removeRuns,
      reset,
      markSaved,
      undo,
      redo,
    }),
    [h, add, update, remove, addRuns, updateRuns, removeRuns, reset, markSaved, undo, redo],
  );
}

export type PointsStore = ReturnType<typeof usePointsStore>;
