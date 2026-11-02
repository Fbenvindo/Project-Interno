import { describe, expect, it } from "vitest";
import { newDraftId, type DraftEntity } from "../src/core/draft";
import { deleteItems, insertCopies, moveItems, splitSelection, toClipboard, type EditState } from "../src/core/editOps";
import type { PlacedPoint } from "../src/core/points";
import { segmentElementId, type Run } from "../src/core/runs";
import type { Vec3 } from "../src/core/types";

// Planta (x, y) → cena (x, 0, −y), como o CoordinateSystem identidade.
const toWorld = (d: [number, number]): Vec3 => [d[0], 0, -d[1]];

const point = (id: number, tag: string, position: Vec3): PlacedPoint => ({
  id,
  guid: `g${id}`,
  componentId: "tomada-baixa",
  tag,
  position,
  rotation: 0,
  height: 300,
  refLevel: 0,
  storey: "Térreo",
  system: "Tomadas",
  params: { Circuito: "C1" },
  circuit: "c1",
});

const run = (id: number): Run => ({
  id,
  guid: `r${id}`,
  typeId: "eletroduto-pvc",
  tag: "ELD-1",
  size: { label: "Ø25", width: 25, height: 25 } as Run["size"],
  system: "Tomadas",
  slope: 0,
  vertices: [
    [0, 2.8, 0],
    [3, 2.8, 0],
  ],
  params: {},
});

function sample(): EditState {
  const line: DraftEntity = { id: newDraftId(), storey: "Térreo", kind: "linha", a: [0, 0], b: [1, 0] };
  return { points: [point(-1000, "T1", [1, 0.3, -1])], runs: [run(7)], drafts: [line] };
}

describe("operações de modificação", () => {
  it("separa a seleção por tipo (trecho por qualquer segmento)", () => {
    const st = sample();
    const sel = splitSelection([-1000, segmentElementId(7, 0), segmentElementId(7, 1), st.drafts[0].id, 12345], st);
    expect(sel).toEqual({ points: [-1000], runs: [7], drafts: [st.drafts[0].id] });
  });

  it("move pontos, trechos e desenhos pelo mesmo deslocamento", () => {
    const st = sample();
    const sel = splitSelection([-1000, segmentElementId(7, 0), st.drafts[0].id], st);
    const r = moveItems(st, sel, [2, 1], toWorld);
    expect(r.points[0].position).toEqual([3, 0.3, -2]);
    expect(r.runs[0].vertices[1]).toEqual([5, 2.8, -1]);
    expect(r.drafts[0]).toMatchObject({ a: [2, 1], b: [3, 1] });
  });

  it("copia com ids, GUIDs e etiquetas novos e sem circuito; cola em outro pavimento", () => {
    const st = sample();
    const sel = splitSelection([-1000, segmentElementId(7, 0), st.drafts[0].id], st);
    const clip = toClipboard(st, sel, [0, 0], "Térreo", 0);
    const r = insertCopies(st, clip, { d: [10, 0], storey: "1º Pavimento", dy: 3 }, toWorld);
    expect(r.ids).toHaveLength(3);
    expect(r.state.points).toHaveLength(2);
    const p = r.state.points[1];
    expect(p.id).not.toBe(-1000);
    expect(p.guid).not.toBe("g-1000");
    expect(p.tag).toBe("T2");
    expect(p.circuit).toBeNull();
    expect(p.params.Circuito).toBeUndefined();
    expect(p.position).toEqual([11, 3.3, -1]);
    expect(p.storey).toBe("1º Pavimento");
    expect(r.state.runs[1].tag).toBe("ELD-2");
    expect(r.state.runs[1].vertices[0]).toEqual([10, 5.8, 0]);
    expect(r.state.drafts[1]).toMatchObject({ storey: "1º Pavimento", a: [10, 0], b: [11, 0] });
  });

  it("apaga só o que foi escolhido", () => {
    const st = sample();
    const r = deleteItems(st, { points: [-1000], runs: [], drafts: [st.drafts[0].id] });
    expect(r.points).toHaveLength(0);
    expect(r.drafts).toHaveLength(0);
    expect(r.runs).toHaveLength(1);
  });
});
