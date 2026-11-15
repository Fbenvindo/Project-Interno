import { describe, expect, it } from "vitest";
import { addToRule, elementKey, hiddenIds, isHidden, toggleRule, MODEL_HOST, MODEL_PROJECT } from "../src/core/visibility";
import { segmentElementId } from "../src/core/runs";
import type { ElementInfo } from "../src/core/types";

const el = (id: number, ifcType: string, systems: string[] = []): ElementInfo => ({ expressID: id, globalId: "", ifcType, name: `#${id}`, objectType: null, predefinedType: null, storey: "T", systems, discipline: "outros", category: "outro", bbox: null, length: null, size: null }) as ElementInfo;
const modelOf = (id: number) => (id < 0 ? MODEL_PROJECT : id >= 100_000_000 ? "vinc-1" : MODEL_HOST);
const els = [el(1, "IFCWALL"), el(2, "IFCDOOR"), el(100_000_005, "IFCWALL"), el(-7, "IFCOUTLET", ["Tomadas"]), el(segmentElementId(3, 0), "IFCPIPESEGMENT", ["Esgoto"]), el(segmentElementId(3, 1), "IFCPIPESEGMENT", ["Esgoto"])];

describe("visibilidade", () => {
  it("por modelo, tipo, sistema e elemento (trecho inteiro)", () => {
    expect([...hiddenIds(els, modelOf, { models: ["vinc-1"] })]).toEqual([100_000_005]);
    expect([...hiddenIds(els, modelOf, { types: ["IFCWALL"] })].sort()).toEqual([1, 100_000_005]);
    expect([...hiddenIds(els, modelOf, { systems: ["Esgoto"] })].length).toBe(2);
    expect([...hiddenIds(els, modelOf, { models: [MODEL_PROJECT] })].length).toBe(3);
    // Ocultar um segmento oculta o trecho inteiro.
    expect(elementKey(segmentElementId(3, 1))).toBe("r3");
    expect([...hiddenIds(els, modelOf, { elements: [elementKey(segmentElementId(3, 0))] })].length).toBe(2);
  });

  it("regras da vista somam com as gerais; toggle e addToRule", () => {
    const geral = { types: ["IFCDOOR"] };
    const vista = toggleRule(undefined, "elements", "1", true);
    expect(isHidden(els[0], modelOf, geral, vista)).toBe(true);
    expect(isHidden(els[1], modelOf, geral, vista)).toBe(true);
    expect(isHidden(els[2], modelOf, geral, vista)).toBe(false);
    expect(toggleRule(vista, "elements", "1", false).elements).toEqual([]);
    expect(addToRule({ systems: ["A"] }, "systems", ["A", "B"]).systems).toEqual(["A", "B"]);
    expect(hiddenIds(els, modelOf, {}, undefined).size).toBe(0);
  });
});
