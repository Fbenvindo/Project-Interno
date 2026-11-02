import { describe, expect, it } from "vitest";
import { angleDeg, arcFrom3, connectEntities, draftDistance, draftPrims, extendLine, isDraftId, newDraftId, squareFrom, translateDraft, type DraftEntity } from "../src/core/draft";
import { runIdOfElement } from "../src/core/runs";
import { boxIndexOf } from "../src/core/conduits";

const L = (a: [number, number], b: [number, number]): DraftEntity => ({ id: newDraftId(), storey: "T", kind: "linha", a, b });

describe("entidades de desenho", () => {
  it("ids próprios, sem confundir com trechos e caixas", () => {
    const id = newDraftId();
    expect(isDraftId(id)).toBe(true);
    expect(runIdOfElement(id)).toBeNull();
    expect(boxIndexOf(id)).toBeNull();
    expect(isDraftId(-5)).toBe(false);
  });

  it("arco por 3 pontos, quadrado pelo lado e ângulo", () => {
    const a = arcFrom3([1, 0], [0, 1], [-1, 0])!;
    expect(a.c[0]).toBeCloseTo(0);
    expect(a.c[1]).toBeCloseTo(0);
    expect(a.r).toBeCloseTo(1);
    expect(arcFrom3([0, 0], [1, 1], [2, 2])).toBeNull();
    expect(squareFrom([0, 0], [2, 0])).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
    expect(angleDeg([0, 0], [1, 0], [0, 1])).toBeCloseTo(90);
  });

  it("cota ortogonal mede só a projeção; alinhada mede a distância", () => {
    const h: DraftEntity = { id: newDraftId(), storey: "T", kind: "cota", mode: "horizontal", a: [0, 0], b: [3, 4], at: [0, -1] };
    const al: DraftEntity = { ...h, id: newDraftId(), mode: "alinhada" };
    const txt = (e: DraftEntity) => draftPrims(e, 50).find((p) => p.t === "text")!;
    expect((txt(h) as { text: string }).text).toBe("3,00");
    expect((txt(al) as { text: string }).text).toBe("5,00");
  });

  it("seleção por distância e deslocamento", () => {
    const l = L([0, 0], [10, 0]);
    expect(draftDistance(l, [5, 0.2], 50)).toBeCloseTo(0.2);
    const m = translateDraft(l, [1, 2]) as Extract<DraftEntity, { kind: "linha" }>;
    expect(m.a).toEqual([1, 2]);
    expect(m.b).toEqual([11, 2]);
  });

  it("estender até o limite e conectar (canto e união)", () => {
    const l = L([0, 0], [2, 0]) as Extract<DraftEntity, { kind: "linha" }>;
    const ext = extendLine(l, [[[5, -1], [5, 1]]])!;
    expect(ext.b).toEqual([5, 0]);
    expect(extendLine(l, [[[5, 1], [6, 1]]])).toBeNull();
    // canto: duas linhas que não se tocam vão até a interseção
    const r = connectEntities([L([0, 0], [4, 0]), L([5, 1], [5, 4])])!;
    const pts = r.add.flatMap((e) => (e.kind === "linha" ? [e.a, e.b] : []));
    expect(pts).toContainEqual([5, 0]);
    // união: três linhas encadeadas viram uma poligonal
    const u = connectEntities([L([0, 0], [1, 0]), L([1, 0], [1, 1]), L([2, 1], [1, 1])])!;
    expect(u.remove).toHaveLength(3);
    expect(u.add[0]).toMatchObject({ kind: "poligono", closed: false });
    expect((u.add[0] as { pts: unknown[] }).pts).toHaveLength(4);
  });
});
