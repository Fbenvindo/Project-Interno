import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { analyzeIfcElements, ifcElementComponent, typeLabel, type IfcElementDef } from "../src/core/ifcElements";
import { loadIfc } from "../src/ifc/loadIfc";

let els: IfcElementDef[];
beforeAll(async () => {
  const api = new IfcAPI();
  await api.Init();
  const model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-apartamento.ifc"))));
  els = analyzeIfcElements(model);
});

const byName = (s: string) => els.find((e) => e.name.toLowerCase().includes(s.toLowerCase()))!;

describe("importar elementos de um IFC", () => {
  it("agrupa por tipo e ignora a construção (paredes, lajes, vigas, pilares)", () => {
    expect(els.length).toBeGreaterThan(3);
    expect(els.some((e) => ["IFCWALL", "IFCSLAB", "IFCBEAM", "IFCCOLUMN"].includes(e.ifcType))).toBe(false);
    expect(typeLabel({ name: "x", objectType: "Pia:Inox 1,20 m:123456", typeObjectName: null, ifcType: "IFCSANITARYTERMINAL" } as never)).toBe("Pia : Inox 1,20 m");
  });

  it("deduz a fixação e a altura pelo uso no modelo", () => {
    const tv = byName("Televisão");
    expect(tv.usage.mounting).toBe("parede");
    expect(tv.usage.height.median).toBeCloseTo(1360, -1);
    const sofa = byName("Sofá");
    expect(sofa.usage.mounting).toBe("piso");
    expect(sofa.usage.clear).toBe(true);
    const pia = byName("Pia");
    expect(pia.usage.mounting).toBe("parede");
    // Malha nos eixos do app: Z (para o ambiente) é a profundidade da pia (550 mm).
    expect(pia.size[1]).toBeCloseTo(550, -1);
    expect(pia.size[0]).toBeCloseTo(1200, -1);
  });

  it("vira componente de locação com os ajustes do usuário", () => {
    const pia = byName("Pia");
    const c = ifcElementComponent("pk", pia, { height: 900, brand: "Tramontina", funcao: "Pia de cozinha" });
    expect(c.id.startsWith("ifc:")).toBe(true);
    expect(c).toMatchObject({ mounting: "parede", defaultHeight: 900, brand: "Tramontina", funcao: "Pia de cozinha", shape: "malha" });
    expect(c.mesh!.positions.length).toBeGreaterThan(0);
  });
});

describe("alternativas por função e marca de referência", async () => {
  const { paletteItems, findExisting, brandsByGroup } = await import("../src/core/alternatives");
  const base = { group: "Climatização", discipline: "hvac", ifcType: "IFCUNITARYEQUIPMENT", predefinedType: "SPLITSYSTEM", mounting: "parede", defaultHeight: 2200, size: [800, 200, 300], shape: "caixa", system: "", systemType: "", tagPrefix: "EV", params: [] } as const;
  const mk = (id: string, label: string, brand?: string) => ({ ...base, size: [...base.size] as [number, number, number], params: [], id, label, funcao: "Evaporadora hi-wall 12000 BTU/h", brand, source: { kind: "ifc" as const, packageId: "p", familyUid: id, family: label, type: label } });
  const daikin = mk("ifc:d", "Daikin FTXS35", "Daikin");
  const lg = mk("ifc:l", "LG S4-Q12", "LG");
  const outro = { ...mk("ifc:x", "Cassete 4 vias"), funcao: "Cassete" };

  it("uma entrada por função, resolvida pela marca do projeto ou pela escolha", () => {
    let items = paletteItems([daikin, lg, outro], { brands: {}, variants: {} });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ def: { id: "ifc:d" }, by: "padrão" });
    expect(items[0].alternatives).toHaveLength(2);
    items = paletteItems([daikin, lg, outro], { brands: { Climatização: "LG" }, variants: {} });
    expect(items[0]).toMatchObject({ def: { id: "ifc:l" }, by: "marca" });
    items = paletteItems([daikin, lg, outro], { brands: { Climatização: "LG" }, variants: { "hvac|evaporadora hi-wall 12000 btu/h": "ifc:d" } });
    expect(items[0]).toMatchObject({ def: { id: "ifc:d" }, by: "escolha" });
    expect(brandsByGroup([daikin, lg, outro]).get("Climatização")).toEqual(["Daikin", "LG"]);
  });

  it("acha o existente pelo nome ou por fabricante + modelo", () => {
    expect(findExisting([daikin, lg], { name: "lg s4-q12", brand: null, model: null })?.id).toBe("ifc:l");
    expect(findExisting([{ ...daikin, model: "FTXS35" }], { name: "Outro nome", brand: "DAIKIN", model: "ftxs35" })?.id).toBe("ifc:d");
    expect(findExisting([daikin], { name: "Nada", brand: null, model: null })).toBeNull();
  });
});
