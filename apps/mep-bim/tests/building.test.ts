import { describe, expect, it } from "vitest";
import { checkProfile, elevationText, floorElevations, floorElevText, profileFromModel, towerSummary, typicalProfile, type BuildingProfile } from "../src/core/building";
import { applyProfile, blockStorey, blockTower, checkFlow, flowPrims, HEADER_H, newFlow, type FlowBlock } from "../src/core/flow";

// 2 torres: subsolo e térreo comuns; Torre A com 10 tipos, Torre B com 4; cobertura nas duas.
const profile = (): BuildingProfile => ({
  towers: [
    { id: "a", name: "Torre A" },
    { id: "b", name: "Torre B" },
  ],
  baseElevation: -3,
  floors: [
    { id: "s1", name: "Subsolo", height: 3, repeat: 1, common: true, towers: [] },
    { id: "t", name: "Térreo", height: 4.5, repeat: 1, common: true, towers: [] },
    { id: "ta", name: "Tipo A (1º ao 10º)", height: 2.9, repeat: 10, common: false, towers: ["a"] },
    { id: "tb", name: "Tipo B (1º ao 4º)", height: 2.9, repeat: 4, common: false, towers: ["b"] },
    { id: "c", name: "Cobertura", height: 3, repeat: 1, common: false, towers: ["a", "b"] },
  ],
});

describe("perfil do empreendimento", () => {
  it("cotas acumuladas com repetição e resumo por torre", () => {
    const p = profile();
    // Cotas por torre: o tipo da Torre B começa sobre o térreo; a cobertura difere entre as torres.
    expect(floorElevations(p)).toEqual([-3, 0, 4.5, 4.5, 33.5]);
    expect(floorElevText(p, 4)).toBe("A +33,50 · B +16,10");
    expect(elevationText(p.floors[2], 4.5)).toBe("+4,50 a +30,60");
    expect(towerSummary(p, "a").floors).toBe(1 + 1 + 10 + 1);
    expect(towerSummary(p, "b").floors).toBe(1 + 1 + 4 + 1);
    expect(checkProfile(p)).toEqual([]);
    expect(checkProfile({ ...p, floors: [...p.floors, { id: "x", name: "Lazer", height: 3, repeat: 1, common: false, towers: [] }] })[0]).toMatch(/não pertence a nenhuma torre/);
  });

  it("do modelo e perfil típico", () => {
    const m = profileFromModel([
      { name: "Térreo", elevation: 0 },
      { name: "1º", elevation: 3.2 },
      { name: "Cobertura", elevation: 6.2 },
    ]);
    expect(m.floors.map((f) => f.height)).toEqual([3.2, 3, 3]);
    const t = typicalProfile(2, 2, 18);
    expect(t.towers.length).toBe(2);
    expect(t.floors.filter((f) => f.common).map((f) => f.name)).toEqual(["2º Subsolo", "1º Subsolo", "Térreo"]);
    expect(t.baseElevation).toBe(-6);
    expect(towerSummary(t, "torre-a").floors).toBe(2 + 1 + 18 + 2);
  });
});

describe("fluxograma pelo perfil", () => {
  it("faixas, cotas, comuns, células sem pavimento e aviso de bloco na torre errada", () => {
    const f = newFlow("eletrica", [], profile());
    expect(f.storeys).toEqual(["Cobertura", "Tipo B (1º ao 4º) ×4", "Tipo A (1º ao 10º) ×10", "Térreo", "Subsolo"]);
    expect(f.towers.map((t) => t.name)).toEqual(["Torre A", "Torre B"]);
    expect(f.levels?.[2].elevation).toBe("+4,50 a +30,60");
    const prims = flowPrims(f);
    expect(prims.some((p) => p.t === "text" && p.text === "Torre B não tem este pavimento")).toBe(true);
    expect(prims.some((p) => p.t === "text" && p.text === "comum às torres")).toBe(true);
    // Bloco na faixa do Tipo B, mas na coluna da Torre A
    const yB = HEADER_H + 1 * f.bandH + 1;
    const q: FlowBlock = { id: "q", kind: "qd", tag: "QD-1", x: 5, y: yB, params: {} };
    f.blocks = [q];
    expect(blockTower(f, q)?.id).toBe("a");
    expect(checkFlow(f, { boards: [] }).map((i) => i.text).join("\n")).toMatch(/Torre A não tem esse pavimento/);
  });

  it("aplicar o perfil mantém os blocos no mesmo pavimento e torre", () => {
    const f = newFlow("eletrica", ["Subsolo", "Térreo", "Cobertura"]);
    // sem perfil: Cobertura, Térreo, Subsolo (uma torre "t1")
    const q: FlowBlock = { id: "q", kind: "qgbt", tag: "QGBT", x: 6, y: HEADER_H + 1 * f.bandH + 0.4, params: {} };
    f.blocks = [q];
    expect(blockStorey(f, q)).toBe("Térreo");
    const p = profile();
    p.towers[0].id = "t1"; // mesma torre
    const g = applyProfile(f, p);
    const nq = g.blocks[0];
    expect(blockStorey(g, nq)).toBe("Térreo");
    expect(nq.y - (HEADER_H + g.storeys.indexOf("Térreo") * g.bandH)).toBeCloseTo(0.4);
    expect(nq.x).toBe(6);
  });
});
