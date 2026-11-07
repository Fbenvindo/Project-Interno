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
