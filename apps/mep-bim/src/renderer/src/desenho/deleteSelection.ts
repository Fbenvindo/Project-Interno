// Apagar direto (tecla Delete ou Modificar › Apagar): os elementos criados no app que estão na
// seleção (pontos, trechos e desenhos). Elementos dos IFCs (modelo e vínculos) não são apagados.
import { deleteItems, pickedCount, splitSelection } from "../../../core/editOps";
import type { PointsStore } from "../locacao/usePointsStore";

/** Apaga e devolve quantos elementos saíram (0 se nada da seleção pode ser apagado). */
export function deleteSelection(store: PointsStore, ids: number[]): number {
  const st = { points: store.points, runs: store.runs, drafts: store.drafts };
  const picked = splitSelection(ids, st);
  const n = pickedCount(picked);
  if (n) store.mutate((cur) => ({ ...cur, ...deleteItems(st, picked) }));
  return n;
}

export const deletedText = (n: number) => (n === 1 ? "1 elemento apagado. Ctrl+Z desfaz." : `${n} elementos apagados. Ctrl+Z desfaz.`);
