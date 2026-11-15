import { describe, expect, it } from "vitest";
import { ceilingBase, floorSubLevels, planRangeOf } from "../src/core/plan/levels";
import { floorPlanOf } from "../src/core/views";
import type { ElementInfo } from "../src/core/types";

const slab = (id: number, storey: string, x: [number, number], z: [number, number], y: [number, number]): ElementInfo =>
  ({ expressID: id, globalId: "", ifcType: "IFCSLAB", name: "Laje", objectType: null, predefinedType: null, typeObjectName: null, storey, systems: [], discipline: "estrutura", category: "outro", bbox: { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] }, length: null, size: null }) as ElementInfo;

const levels = [
  { name: "Térreo", level: 0 },
  { name: "1º", level: 3 },
];

describe("níveis das plantas de pavimento", () => {
  it("um nível de laje: o do pavimento; teto na face inferior da laje de cima", () => {
    const els = [slab(1, "Térreo", [0, 10], [0, 10], [-0.15, 0]), slab(2, "1º", [0, 10], [0, 10], [2.88, 3])];
    expect(floorSubLevels(els, levels, "Térreo")).toEqual([0]);
    expect(ceilingBase(els, levels, "Térreo", 0)).toBeCloseTo(2.88);
  });

  it("lajes em níveis diferentes no mesmo pavimento viram plantas separadas", () => {
    const els = [slab(1, "Térreo", [0, 10], [0, 10], [-0.15, 0]), slab(3, "Térreo", [10, 16], [0, 6], [0.3, 0.45]), slab(4, "Térreo", [0, 0.5], [0, 0.5], [0.2, 0.25])];
    // A laje pequena (0,25 m²) não define nível.
    expect(floorSubLevels(els, levels, "Térreo")).toEqual([0, 0.45]);
    const v = floorPlanOf([], "trabalho", "piso", "Térreo", 1);
    expect(planRangeOf(v, els, levels)).toEqual({ type: "piso", base: 0.45, below: 1, above: 1.5 });
  });

  it("pavimentos em par (osso e piso acabado, a poucos cm): o de cima é o próximo andar", () => {
    const lv = [
      { name: "Térreo - osso", level: -0.1 },
      { name: "Térreo - acabado", level: 0 },
      { name: "1º - osso", level: 4.4 },
      { name: "1º - acabado", level: 4.5 },
    ];
    const els = [slab(1, "1º - osso", [0, 10], [0, 10], [4.25, 4.4])];
    expect(ceilingBase(els, lv, "Térreo - osso", -0.1)).toBeCloseTo(4.25);
    expect(ceilingBase(els, lv, "Térreo - acabado", 0)).toBeCloseTo(4.25);
    // Sem laje modelada: o próximo andar (não o par a 10 cm).
    expect(ceilingBase([], lv, "Térreo - osso", -0.1)).toBeCloseTo(4.4 - 0.12);
  });

  it("sem laje de cima: o nível do pavimento de cima", () => {
    const v = floorPlanOf([], "documentacao", "teto", "Térreo");
    expect(planRangeOf(v, [], levels)).toEqual({ type: "teto", base: 3 - 0.12, below: 1.5, above: 0.2 });
  });
});

describe("planta de piso × planta de teto no modelo de exemplo", () => {
  it("luminárias só na de teto; tomadas só na de piso", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { IfcAPI } = await import("web-ifc");
    const { loadIfc } = await import("../src/ifc/loadIfc");
    const { buildPlan } = await import("../src/core/plan/build");
    const api = new IfcAPI();
    await api.Init();
    const model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
    const meshes = new Map(model.meshes.map((m) => [m.expressID, m]));
    const storey = model.storeys[0];
    const ids = (type: "piso" | "teto") => {
      const v = floorPlanOf([], "trabalho", type, storey);
      const d = buildPlan({ elements: model.elements, meshes, cs: model.coordinates, storeyLevels: model.storeyLevels, storey, cutHeight: 1.2, points: [], runs: [], scale: 50, disciplines: new Set(["arquitetura", "estrutura", "eletrica", "hidraulica", "hvac", "incendio", "telecom", "gas", "outros"] as never), labels: { tags: true, circuits: true, power: true, sizes: true }, range: planRangeOf(v, model.elements, model.storeyLevels) });
      return new Set(d.prims.map((p) => p.id).filter((x): x is number => typeof x === "number"));
    };
    const piso = ids("piso");
    const teto = ids("teto");
    const of = (t: string) => model.elements.filter((e) => e.ifcType === t && e.storey === storey).map((e) => e.expressID);
    const lights = of("IFCLIGHTFIXTURE");
    const outlets = of("IFCOUTLET");
    expect(lights.length && outlets.length).toBeTruthy();
    expect(lights.every((id) => teto.has(id) && !piso.has(id))).toBe(true);
    expect(outlets.every((id) => piso.has(id) && !teto.has(id))).toBe(true);
  });
});
