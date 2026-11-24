// Apagar direto (tecla Delete ou Modificar › Apagar): os elementos criados no app que estão na
// seleção (pontos, trechos, desenhos, paredes, portas, janelas, lajes, pilares e vigas).
// Elementos dos IFCs (modelo e vínculos) não são apagados.
import { deleteItems, pickedCount, splitSelection } from "../../../core/editOps";
import { archIdOf, removeArch } from "../../../core/arch";
import type { PointsStore } from "../locacao/usePointsStore";

/** Apaga e devolve quantos elementos saíram (0 se nada da seleção pode ser apagado). */
export function deleteSelection(store: PointsStore, ids: number[]): number {
  const st = { points: store.points, runs: store.runs, drafts: store.drafts };
  const picked = splitSelection(ids, st);
  const archIds = new Set(ids.map(archIdOf).filter((x): x is number => x != null));
  const archN = store.arch.filter((e) => archIds.has(e.id)).length;
  const n = pickedCount(picked);
  if (n || archN)
    store.mutate((cur) => ({ ...cur, ...(n ? deleteItems(st, picked) : {}), ...(archN ? { arch: removeArch(cur.arch, archIds) } : {}) }));
  return n + archN;
}

export const deletedText = (n: number) => (n === 1 ? "1 elemento apagado. Ctrl+Z desfaz." : `${n} elementos apagados. Ctrl+Z desfaz.`);
