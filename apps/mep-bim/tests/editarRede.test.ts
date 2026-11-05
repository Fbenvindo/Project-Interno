import { describe, expect, it } from "vitest";
import { applyOffset, moveNetwork } from "../src/core/runEdit";
import type { PlacedPoint } from "../src/core/points";
import { RUN_TYPE_BY_ID, type Run } from "../src/core/runs";
import type { Vec3 } from "../src/core/types";

let seq = 1;
const run = (vertices: Vec3[], typeId = "eletroduto-pvc", tag = `R${seq}`): Run => {
  const t = RUN_TYPE_BY_ID[typeId];
  return { id: seq++, guid: `g${seq}`, typeId, tag, size: t.sizes.find((s) => s.label === t.defaultSize)!, system: t.system, slope: 0, vertices, params: {} };
};
const tomada = (position: Vec3): PlacedPoint => ({ id: -77, guid: "p", componentId: "tomada-baixa", tag: "T1", position, rotation: 0, height: 300, refLevel: 0, storey: "T", system: "", params: {} });

describe("desvio", () => {
  const r = run([[0, 3, 0], [10, 3, 0]]);
  it("sobe 30 cm entre os pontos, com curvas de 90°", () => {
    const res = applyOffset(r, 0, 0.2, 0.6, { height: 0.3, up: true, angle: 90 });
    expect(res.ok && res.vertices).toEqual([[0, 3, 0], [2, 3, 0], [2, 3.3, 0], [6, 3.3, 0], [6, 3, 0], [10, 3, 0]]);
  });
  it("desce a 45° (avança a mesma distância da altura)", () => {
    const res = applyOffset(r, 0, 0.6, 0.2, { height: 0.3, up: false, angle: 45 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.vertices[2][0]).toBeCloseTo(2.3);
      expect(res.vertices[2][1]).toBeCloseTo(2.7);
      expect(res.vertices[3][0]).toBeCloseTo(5.7);
    }
  });
  it("recusa: pontos próximos demais, segmento vertical, flexível e derivação no meio", () => {
    expect(applyOffset(r, 0, 0.2, 0.22, { height: 0.3, up: true, angle: 45 }).ok).toBe(false);
    expect(applyOffset(run([[0, 0, 0], [0, 3, 0]]), 0, 0.2, 0.8, { height: 0.3, up: true, angle: 90 }).ok).toBe(false);
    expect(applyOffset(run([[0, 3, 0], [10, 3, 0]], "eletroduto-flexivel"), 0, 0.2, 0.8, { height: 0.3, up: true, angle: 90 }).ok).toBe(false);
    const ramal = run([[4, 3, 5], [4, 3, 0]]);
    const res = applyOffset(r, 0, 0.2, 0.6, { height: 0.3, up: true, angle: 90 }, [r, ramal]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("derivação");
  });
});

describe("mover com os elementos ligados", () => {
  it("segmento movido na direção do vizinho: o vizinho encurta", () => {
    const l = run([[0, 3, 0], [5, 3, 0], [5, 3, 4]]);
    const res = moveNetwork([l], [], { points: [], segments: [{ runId: l.id, index: 0 }] }, [0, 0, 1]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.runs.get(l.id)).toEqual([[0, 3, 1], [5, 3, 1], [5, 3, 4]]);
  });
  it("curva impede mover ao longo do segmento (o vizinho mudaria de ângulo)", () => {
    const l = run([[0, 3, 0], [5, 3, 0], [5, 3, 4]], "eletroduto-pvc", "ELD-9");
    const res = moveNetwork([l], [], { points: [], segments: [{ runId: l.id, index: 0 }] }, [1, 0, 0]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("ELD-9");
    // Flexível: curva livre, pode.
    const f = run([[0, 3, 0], [5, 3, 0], [5, 3, 4]], "eletroduto-flexivel");
    expect(moveNetwork([f], [], { points: [], segments: [{ runId: f.id, index: 0 }] }, [1, 0, 0]).ok).toBe(true);
  });
  it("ponto locado leva a subida junto; o trecho horizontal estica se for na mesma direção", () => {
    const pt = tomada([0, 0.3, 0]);
    const r = run([[0, 0.3, 0], [0, 3, 0], [5, 3, 0]]);
    const ok = moveNetwork([r], [pt], { points: [pt.id], segments: [] }, [1, 0, 0]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.points.get(pt.id)).toEqual([1, 0.3, 0]);
      expect(ok.runs.get(r.id)).toEqual([[1, 0.3, 0], [1, 3, 0], [5, 3, 0]]);
    }
    expect(moveNetwork([r], [pt], { points: [pt.id], segments: [] }, [0, 0, 1]).ok).toBe(false);
  });
  it("trecho movido leva o ponto locado da ponta e o trecho que continua no mesmo vértice", () => {
    const pt = tomada([0, 3, 0]);
    const a = run([[0, 3, 0], [5, 3, 0]]);
    const b = run([[5, 3, 0], [5, 3, 0.0001], [5, 6, 0.0001]]);
    const res = moveNetwork([a, b], [pt], { points: [], segments: [{ runId: a.id, index: 0 }] }, [0, 0, 0.5]);
    // b segue a ponta de a; seu segmento curtíssimo acompanha e a subida (vertical) também.
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.points.has(pt.id)).toBe(true);
      expect(res.runs.get(b.id)![0]).toEqual([5, 3, 0.5]);
    }
  });
  it("derivação no meio de outro trecho só desliza ao longo dele", () => {
    const tronco = run([[0, 3, 0], [10, 3, 0]]);
    const ramal = run([[4, 3, 0], [4, 3, 5]]);
    expect(moveNetwork([tronco, ramal], [], { points: [], segments: [{ runId: ramal.id, index: 0 }] }, [1, 0, 0]).ok).toBe(true);
    const bad = moveNetwork([tronco, ramal], [], { points: [], segments: [{ runId: ramal.id, index: 0 }] }, [0, 0.5, 0]);
    expect(bad.ok).toBe(false);
  });
});
