import { useCallback, useMemo, useState } from "react";
import type { PlacedPoint } from "../../../core/points";

interface History {
  past: PlacedPoint[][];
  present: PlacedPoint[];
  future: PlacedPoint[][];
  saved: PlacedPoint[];
  /** Chave da última edição, para agrupar alterações seguidas do mesmo campo. */
  lastKey: string | null;
}

const LIMIT = 200;

/** Estado dos pontos locados, com desfazer/refazer e controle de alterações não salvas. */
export function usePointsStore() {
  const [h, setH] = useState<History>({ past: [], present: [], future: [], saved: [], lastKey: null });

  const commit = useCallback((fn: (cur: PlacedPoint[]) => PlacedPoint[], key: string | null = null) => {
    setH((s) => {
      const next = fn(s.present);
      if (next === s.present) return s;
      if (key && key === s.lastKey) return { ...s, present: next, future: [] };
      return { ...s, past: [...s.past.slice(-LIMIT + 1), s.present], present: next, future: [], lastKey: key };
    });
  }, []);

  const add = useCallback((pts: PlacedPoint[]) => pts.length && commit((cur) => [...cur, ...pts]), [commit]);

  const update = useCallback(
    (ids: number[], patch: (p: PlacedPoint) => Partial<PlacedPoint>, key: string | null = null) =>
      commit((cur) => {
        const set = new Set(ids);
        return cur.some((p) => set.has(p.id)) ? cur.map((p) => (set.has(p.id) ? { ...p, ...patch(p) } : p)) : cur;
      }, key && `${key}:${ids.join(",")}`),
    [commit],
  );

  const remove = useCallback(
    (ids: number[]) =>
      commit((cur) => {
        const set = new Set(ids);
        const next = cur.filter((p) => !set.has(p.id));
        return next.length === cur.length ? cur : next;
      }),
    [commit],
  );

  /** Substitui todos os pontos e zera o histórico (abrir arquivo ou novo modelo). */
  const reset = useCallback((pts: PlacedPoint[]) => setH({ past: [], present: pts, future: [], saved: pts, lastKey: null }), []);

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
      points: h.present,
      canUndo: h.past.length > 0,
      canRedo: h.future.length > 0,
      dirty: h.present !== h.saved,
      add,
      update,
      remove,
      reset,
      markSaved,
      undo,
      redo,
    }),
    [h, add, update, remove, reset, markSaved, undo, redo],
  );
}

export type PointsStore = ReturnType<typeof usePointsStore>;
