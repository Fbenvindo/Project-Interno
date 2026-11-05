// Auxílios de desenho válidos em todo o app: ortogonal (movimentos só em X, Y ou Z) e
// encaixe a objetos (ponto final, médio, tangente…). Ficam salvos neste computador.
import { useSyncExternalStore } from "react";
import { DEFAULT_SNAPS, type SnapMode } from "../../../core/osnap";

export interface DrawAids {
  /** Ortogonal: criar e modificar só na horizontal/vertical (e na vertical Z no 3D). */
  ortho: boolean;
  /** Encaixe a objetos ligado. */
  snapOn: boolean;
  snaps: Record<SnapMode, boolean>;
}

const KEY = "smarteasybim.drawAids";

function load(): DrawAids {
  const base: DrawAids = { ortho: false, snapOn: true, snaps: { ...DEFAULT_SNAPS } };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s && typeof s === "object") return { ortho: !!s.ortho, snapOn: s.snapOn !== false, snaps: { ...base.snaps, ...(s.snaps ?? {}) } };
  } catch {
    /* sem armazenamento: usa o padrão */
  }
  return base;
}

let state = load();
const listeners = new Set<() => void>();

export const getDrawAids = () => state;

export function setDrawAids(fn: (s: DrawAids) => DrawAids) {
  state = fn(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignora */
  }
  listeners.forEach((l) => l());
}

export function useDrawAids(): DrawAids {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => state,
    () => state,
  );
}

/** Modos de encaixe efetivos (nenhum com o encaixe desligado). */
export const activeSnaps = (a: DrawAids): Partial<Record<SnapMode, boolean>> => (a.snapOn ? a.snaps : {});
