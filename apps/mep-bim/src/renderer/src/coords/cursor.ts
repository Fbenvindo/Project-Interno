// Posição do cursor na planta (coordenadas do projeto, m), para a barra de status.
import { useSyncExternalStore } from "react";
import type { Vec3 } from "../../../core/types";

let current: Vec3 | null = null;
const listeners = new Set<() => void>();

export function setCursor(p: Vec3 | null): void {
  if (p === current || (p && current && p[0] === current[0] && p[1] === current[1] && p[2] === current[2])) return;
  current = p;
  listeners.forEach((l) => l());
}

export function useCursor(): Vec3 | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
    () => current,
  );
}
