import { describe, expect, it } from "vitest";
import { towerSummary } from "../src/core/building";
import { blockStorey, blockTower, busStoreys, checkFlow } from "../src/core/flow";
import { exampleTwoTowersBusway } from "../src/core/flowExamples";

describe("exemplo: 2 torres com medição nos andares por barramento", () => {
  const { profile, flow } = exampleTwoTowersBusway();
  it("perfil: subsolos e térreo comuns, torres de 12 e 16 andares", () => {
    expect(profile.floors.filter((f) => f.common).map((f) => f.name)).toEqual(["2º Subsolo", "1º Subsolo", "Térreo"]);
    expect(towerSummary(profile, "torre-a").floors).toBe(3 + 12);
    expect(towerSummary(profile, "torre-b").floors).toBe(3 + 16);
    expect(flow.storeys[0]).toBe("16º Pavimento");
  });
  it("uma MEC IV por andar em cada torre, barramentos até o último andar, sem erros", () => {
    const mecs = flow.blocks.filter((b) => b.kind === "mec-iv");
    expect(mecs.length).toBe(28);
    for (const m of mecs) expect(blockTower(flow, m)?.id).toBe(m.tag.startsWith("MEC-A") ? "torre-a" : "torre-b");
    const busB = flow.blocks.find((b) => b.tag === "BB-B")!;
    expect(busStoreys(flow, busB)[0]).toBe("16º Pavimento");
    expect(busStoreys(flow, busB)).toContain("1º Subsolo");
    const busA = flow.blocks.find((b) => b.tag === "BB-A")!;
    expect(busStoreys(flow, busA)[0]).toBe("12º Pavimento");
    expect(blockStorey(flow, flow.blocks.find((b) => b.tag === "MEC-B16")!)).toBe("16º Pavimento");
    const issues = checkFlow(flow, { boards: [] });
    expect(issues.filter((i) => i.level !== "info")).toEqual([]);
  });
});

describe("exemplo de água fria: 2 torres", async () => {
  const { exampleTwoTowersWater } = await import("../src/core/flowExamples");
  const { waterPressure, waterBalance, blockZ } = await import("../src/core/flow");
  const { profile, flow } = exampleTwoTowersWater();
  it("cobertura de cada torre na cota da própria torre", () => {
    const rsA = flow.blocks.find((b) => b.tag === "RS-A")!;
    const rsB = flow.blocks.find((b) => b.tag === "RS-B")!;
    expect(blockZ(flow, rsA)?.low).toBeCloseTo(4.5 + 12 * 2.88);
    expect(blockZ(flow, rsB)?.low).toBeCloseTo(4.5 + 16 * 2.88);
    expect(profile.floors.filter((f) => f.name.startsWith("Cobertura")).length).toBe(2);
  });
  it("pressões dentro de 1 a 40 mca (VRP na Torre B), reservação e recalque sem avisos", () => {
    const issues = checkFlow(flow, { boards: [] });
    expect(issues.filter((i) => i.level !== "info").map((i) => i.text)).toEqual([]);
    const b1 = flow.blocks.find((b) => b.tag === "AP-B1")!;
    const p = waterPressure(flow, b1)!;
    expect(p.max).toBeLessThanOrEqual(40);
    expect(flow.blocks.find((b) => b.id === p.from)?.tag).toBe("VRP-B");
    const bal = waterBalance(flow);
    expect(bal.consumo).toBe((12 + 16) * 4 * 4 * 200 + 5000);
    expect(bal.dias).toBeGreaterThan(1.9);
  });
  it("sem VRP, os andares de baixo da Torre B passam de 40 mca", () => {
    const vrp = flow.blocks.find((b) => b.tag === "VRP-B")!;
    const no = { ...flow, blocks: flow.blocks.map((b) => (b.id === vrp.id ? { ...b, params: { ...b.params, saida: 60 } } : b)) };
    expect(checkFlow(no, { boards: [] }).some((i) => i.text.includes("passa de 40 mca"))).toBe(true);
  });
});
