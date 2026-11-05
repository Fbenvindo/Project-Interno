import { describe, expect, it } from "vitest";
import { DEFAULT_SNAPS, findSnap, inArc, orthoPoint, orthoSnap, snapGeometry, type SnapGeometry } from "../src/core/osnap";
import type { DraftEntity } from "../src/core/draft";

const only = (k: keyof typeof DEFAULT_SNAPS) => ({ [k]: true });
const geo = (drafts: DraftEntity[]): SnapGeometry => snapGeometry([], drafts);
const line = (a: [number, number], b: [number, number]): DraftEntity => ({ id: -800001, storey: "P", kind: "linha", a, b });
const circle = (c: [number, number], r: number): DraftEntity => ({ id: -800002, storey: "P", kind: "circulo", c, r });

describe("encaixe a objetos", () => {
  const g = geo([line([0, 0], [4, 0]), line([2, -1], [2, 1]), circle([10, 0], 1)]);

  it("ponto final, médio, centro e quadrante", () => {
    expect(findSnap([3.95, 0.05], g, only("fim"), 0.2)).toEqual({ p: [4, 0], kind: "fim" });
    expect(findSnap([2.1, 0.03], g, only("meio"), 0.2)).toEqual({ p: [2, 0], kind: "meio" });
    expect(findSnap([10.1, 0.1], g, only("centro"), 0.2)?.kind).toBe("centro");
    const q = findSnap([10.05, 0.95], g, only("quadrante"), 0.2)!;
    expect(q.kind).toBe("quadrante");
    expect(q.p[0]).toBeCloseTo(10);
    expect(q.p[1]).toBeCloseTo(1);
  });

  it("interseção e prioridade sobre “ao longo”", () => {
    const s = findSnap([2.08, 0.05], g, { intersecao: true, proximo: true }, 0.2)!;
    expect(s.kind).toBe("intersecao");
    expect(s.p).toEqual([2, 0]);
    const n = findSnap([3.1, 0.07], g, { proximo: true }, 0.2)!;
    expect(n.kind).toBe("proximo");
    expect(n.p[1]).toBeCloseTo(0);
    expect(n.p[0]).toBeCloseTo(3.1);
    // Ao longo de um círculo
    const c = findSnap([11.1, 0.1], g, { proximo: true }, 0.2)!;
    expect(Math.hypot(c.p[0] - 10, c.p[1])).toBeCloseTo(1);
  });

  it("tangente e perpendicular a partir do ponto anterior", () => {
    const from: [number, number] = [10, 3];
    const t = findSnap([10.9, 0.4], g, only("tangente"), 0.3, from)!;
    expect(t.kind).toBe("tangente");
    // Raio perpendicular à reta do ponto anterior até a tangência.
    const r = [t.p[0] - 10, t.p[1]];
    const v = [t.p[0] - from[0], t.p[1] - from[1]];
    expect(r[0] * v[0] + r[1] * v[1]).toBeCloseTo(0, 6);
    const p = findSnap([1.2, 0.1], g, only("perpendicular"), 0.3, [1, 5])!;
    expect(p).toEqual({ p: [1, 0], kind: "perpendicular" });
    expect(findSnap([1.2, 0.1], g, only("tangente"), 0.3, null)).toBeNull();
  });

  it("arcos: só os quadrantes dentro do arco; extremidades como ponto final", () => {
    const a: DraftEntity = { id: -800003, storey: "P", kind: "arco", c: [0, 0], r: 1, a0: 0, a1: Math.PI / 2 };
    const ga = geo([a]);
    expect(inArc({ c: [0, 0], r: 1, a0: 0, a1: Math.PI / 2 }, Math.PI)).toBe(false);
    expect(findSnap([-1, 0.05], ga, only("quadrante"), 0.2)).toBeNull();
    expect(findSnap([0.05, 1], ga, only("quadrante"), 0.2)?.kind).toBe("quadrante");
    const m = findSnap([0.7, 0.72], ga, only("meio"), 0.2)!;
    expect(m.p[0]).toBeCloseTo(Math.SQRT1_2);
  });

  it("modo desligado não encaixa", () => {
    expect(findSnap([3.95, 0.05], g, {}, 0.2)).toBeNull();
  });
});

describe("ortogonal", () => {
  it("prende no eixo dominante a partir da âncora", () => {
    expect(orthoPoint([3, 0.4], [0, 0])).toEqual({ p: [3, 0], axis: "x" });
    expect(orthoPoint([0.2, -2], [0, 0])).toEqual({ p: [0, -2], axis: "y" });
  });
  it("com encaixe: alinha com o ponto encaixado e, ao longo, cruza o elemento", () => {
    const g = geo([line([4, 1], [4, 3]), line([6, -2], [6, 2])]);
    // Indo para a direita a partir de (0, 0): o fim (4, 1) dá o X, o Y fica 0.
    const r = orthoSnap([3.98, 0.95], [0, 0], g, { fim: true }, 0.2);
    expect(r.p).toEqual([4, 0]);
    expect(r.snap?.kind).toBe("fim");
    // Ao longo: a horizontal y = 0 cruza a linha x = 6.
    const s = orthoSnap([5.9, 0.1], [0, 0], g, { proximo: true }, 0.2);
    expect(s.p[0]).toBeCloseTo(6);
    expect(s.p[1]).toBeCloseTo(0);
  });
});
