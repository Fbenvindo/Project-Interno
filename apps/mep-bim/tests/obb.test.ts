import { describe, expect, it } from "vitest";
import { detectClashes, type ClashItem } from "../src/core/clash";
import { obbIntersectsMesh, obbMesh, obbToAabb, type OBB, type TriangleMesh } from "../src/core/obb";
import { segmentOBB } from "../src/core/runs";
import type { Vec3 } from "../src/core/types";

const box = (center: Vec3, half: Vec3): OBB => ({ center, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half });
const tri = (a: Vec3, b: Vec3, c: Vec3): TriangleMesh => ({ positions: new Float32Array([...a, ...b, ...c]), indices: new Uint32Array([0, 1, 2]) });

function merge(meshes: TriangleMesh[]): TriangleMesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const m of meshes) {
    const base = pos.length / 3;
    pos.push(...m.positions);
    idx.push(...Array.from(m.indices, (i) => i + base));
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

describe("caixa orientada × triângulos", () => {
  const unit = box([0, 0, 0], [1, 1, 1]);

  it("detecta triângulo que atravessa a caixa e ignora o distante", () => {
    expect(obbIntersectsMesh(unit, tri([-5, 0, -5], [5, 0, -5], [0, 0, 5]))).toBe(true); // plano y=0 corta a caixa
    expect(obbIntersectsMesh(unit, tri([-5, 2, -5], [5, 2, -5], [0, 2, 5]))).toBe(false);
    // Triângulo cujas caixas se sobrepõem mas que passa ao lado do canto (eixo de aresta separa)
    expect(obbIntersectsMesh(unit, tri([1.5, 0, 3], [3, 0, 1.5], [3, 3, 3]))).toBe(false);
  });

  it("respeita a orientação da caixa", () => {
    const s = Math.SQRT1_2;
    const rotated: OBB = { center: [0, 0, 0], axes: [[s, 0, -s], [0, 1, 0], [s, 0, s]], half: [1, 1, 0.05] };
    // Plano x = 0,5 cruza a placa girada 45°? A placa vai até |x| ≈ 0,74.
    expect(obbIntersectsMesh(rotated, tri([0.5, -5, -5], [0.5, 5, -5], [0.5, 0, 5]))).toBe(true);
    expect(obbIntersectsMesh(rotated, tri([0.9, -5, -5], [0.9, 5, -5], [0.9, 0, 5]))).toBe(false);
    const aabb = obbToAabb(rotated);
    expect(aabb.max[0]).toBeCloseTo(s + 0.05 * s);
  });

  it("caixa do segmento segue o eixo", () => {
    const o = segmentOBB([0, 3, 0], [4, 3, 0], { label: "200x100", width: 200, height: 100 });
    expect(o.center).toEqual([2, 3, 0]);
    expect(o.half).toEqual([0.1, 2, 0.05]);
    expect(Math.abs(o.axes[1][0])).toBeCloseTo(1);
  });
});

describe("interferências com verificação exata", () => {
  // Moldura em anel: quatro barras finas contornando um quadrado de 10 × 10 m.
  const ringParts = [
    box([5, 1, 0], [5, 1, 0.1]),
    box([5, 1, 10], [5, 1, 0.1]),
    box([0, 1, 5], [0.1, 1, 5]),
    box([10, 1, 5], [0.1, 1, 5]),
  ];
  const ring: ClashItem = {
    id: 1,
    discipline: "arquitetura",
    bbox: { min: [-0.1, 0, -0.1], max: [10.1, 2, 10.1] },
    mesh: merge(ringParts.map(obbMesh)),
  };
  const item = (id: number, obb: OBB): ClashItem => ({ id, discipline: "eletrica", bbox: obbToAabb(obb), obb });

  it("elemento dentro do anel não é interferência (a triagem por caixa diria que é)", () => {
    const tomada = item(2, box([5, 0.3, 5], [0.03, 0.05, 0.02]));
    const opts = { groupA: ["eletrica" as const], groupB: ["arquitetura" as const] };
    expect(detectClashes([ring, tomada], opts)).toHaveLength(0);
    // Sem a malha (só AABB), o falso positivo aparece:
    expect(detectClashes([{ ...ring, mesh: undefined }, tomada], opts)).toHaveLength(1);
  });

  it("trecho que atravessa a moldura é interferência física", () => {
    const calha = item(3, segmentOBB([5, 1, 5], [5, 1, 12], { label: "200x100", width: 200, height: 100 }));
    const res = detectClashes([ring, calha], { groupA: ["eletrica"], groupB: ["arquitetura"] });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("fisica");
  });

  it("encostado na face não conta; perto demais conta como folga", () => {
    const encostada = item(4, box([5, 1, 0.2], [0.05, 0.05, 0.1])); // face em z = 0,1 = face do anel
    const opts = { groupA: ["eletrica" as const], groupB: ["arquitetura" as const] };
    expect(detectClashes([ring, encostada], opts)).toHaveLength(0);
    const perto = item(5, box([5, 1, 0.13], [0.02, 0.02, 0.02])); // a 1 cm da face
    const res = detectClashes([ring, perto], { ...opts, clearance: 0.05 });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("folga");
  });

  it("duas caixas orientadas (criadas no app) se testam entre si", () => {
    const a = item(6, segmentOBB([0, 3, 0], [4, 3, 0], { label: "Ø25", width: 25, height: 25 }));
    const b: ClashItem = { ...item(7, segmentOBB([2, 3, -1], [2, 3, 1], { label: "Ø25", width: 25, height: 25 })), discipline: "hidraulica" };
    expect(detectClashes([a, b], { groupA: ["eletrica"], groupB: ["hidraulica"] })).toHaveLength(1);
    const c: ClashItem = { ...item(8, segmentOBB([2, 3.2, -1], [2, 3.2, 1], { label: "Ø25", width: 25, height: 25 })), discipline: "hidraulica" };
    expect(detectClashes([a, c], { groupA: ["eletrica"], groupB: ["hidraulica"] })).toHaveLength(0);
  });
});
