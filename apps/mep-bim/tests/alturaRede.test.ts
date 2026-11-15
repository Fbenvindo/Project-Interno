import { describe, expect, it } from "vitest";
import { changeRunsHeight, networkAtLevel, runLevel, runsConnected } from "../src/core/runHeight";
import type { Run } from "../src/core/runs";
import type { Vec3 } from "../src/core/types";

const run = (id: number, vertices: Vec3[]): Run => ({ id, guid: `g${id}`, typeId: "eletrocalha", tag: `ELC-${id}`, size: { label: "200x100", width: 200, height: 100 } as Run["size"], system: "", slope: 0, vertices, params: {} });

// Rede no teto a 2,80 m: tronco A (0→10) e ramal B saindo do meio de A (5,0 → 5,4) que desce a um quadro.
const A = run(1, [[0, 2.8, 0], [10, 2.8, 0]]);
const B = run(2, [[5, 2.8, 0], [5, 2.8, 4], [5, 1.5, 4]]);
const C = run(3, [[0, 1.0, 20], [8, 1.0, 20]]); // outra rede, noutra altura e solta

describe("altura das redes", () => {
  it("altura do trecho e rede ligada na mesma altura", () => {
    expect(runLevel(A)).toBeCloseTo(2.8);
    expect(runLevel(B)).toBeCloseTo(2.8);
    expect(runsConnected(A, B)).toBe(true);
    expect(networkAtLevel([A, B, C], 2).sort()).toEqual([1, 2]);
  });

  it("toda a rede: tronco e ramal sobem juntos; a descida ao quadro continua no quadro", () => {
    const out = changeRunsHeight([A, B, C], [1, 2], 0.3);
    const a = out.find((r) => r.id === 1)!;
    const b = out.find((r) => r.id === 2)!;
    expect(a.vertices.map((v) => v[1])).toEqual([3.1, 3.1]);
    expect(b.vertices.map((v) => +v[1].toFixed(3))).toEqual([3.1, 3.1, 1.5]);
    expect(runsConnected(a, b)).toBe(true);
    expect(out.find((r) => r.id === 3)).toBe(C);
  });

  it("só o trecho: o ramal que chega nele ganha uma vertical e continua ligado", () => {
    const out = changeRunsHeight([A, B], [1], -0.4);
    const a = out.find((r) => r.id === 1)!;
    const b = out.find((r) => r.id === 2)!;
    expect(a.vertices.map((v) => +v[1].toFixed(3))).toEqual([2.4, 2.4]);
    expect(b.vertices[0]).toEqual([5, 2.4, 0]);
    expect(b.vertices[1]).toEqual([5, 2.8, 0]);
    expect(runsConnected(a, b)).toBe(true);
  });

  it("só o ramal: a ponta no tronco fica e sobe na vertical", () => {
    const out = changeRunsHeight([A, B], [2], 0.5);
    const b = out.find((r) => r.id === 2)!;
    expect(b.vertices[0]).toEqual([5, 2.8, 0]);
    expect(b.vertices[1]).toEqual([5, 3.3, 0]);
    expect(runsConnected(out.find((r) => r.id === 1)!, b)).toBe(true);
  });
});
