import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appBasis, categoryProfile, defaultOutAxis, familyComponents, packageComponents, parseFamilyPackage, revitComponentId } from "../src/core/families";
import { BUILTIN_COUNT, COMPONENTS, COMPONENT_BY_ID, COMPONENT_GROUPS, registerComponents } from "../src/core/library";
import { symbolFor } from "../src/core/plan/symbols";

const text = readFileSync(join(__dirname, "..", "samples", "familias-exemplo.sebfam"), "utf8");
const pkg = parseFamilyPackage(text);
const fam = (bic: string) => pkg.familias.find((f) => f.categoriaRevit === bic)!;

describe("pacote de famílias do Revit", () => {
  it("valida o formato", () => {
    expect(pkg.familias).toHaveLength(3);
    expect(() => parseFamilyPackage("{}")).toThrow();
    expect(() => parseFamilyPackage("x")).toThrow();
  });

  it("categorias do Revit levam a disciplina, classe IFC e peça de referência existentes", () => {
    for (const bic of ["OST_LightingFixtures", "OST_LightingDevices", "OST_ElectricalFixtures", "OST_ElectricalEquipment", "OST_DataDevices", "OST_SecurityDevices", "OST_FireAlarmDevices", "OST_Sprinklers", "OST_FireProtection", "OST_PlumbingFixtures", "OST_PipeAccessory", "OST_MechanicalEquipment", "OST_DuctTerminal"]) {
      const p = categoryProfile(bic);
      expect(COMPONENT_BY_ID[p.like], bic).toBeDefined();
    }
    expect(categoryProfile("OST_Furniture").discipline).toBe("mep");
  });

  it("orientação padrão: teto mantém o +Z para cima; tomada na parede avança em +Y; quadro solto olha para −Y", () => {
    expect(defaultOutAxis(fam("OST_LightingFixtures"), "teto")).toBe("-Z");
    expect(defaultOutAxis(fam("OST_ElectricalFixtures"), "parede")).toBe("+Y");
    expect(defaultOutAxis(fam("OST_ElectricalEquipment"), "parede")).toBe("-Y");
    expect(defaultOutAxis({ ...fam("OST_LightingFixtures"), hospedagem: "face" }, "teto")).toBe("-Z"); // geometria abaixo da face
  });

  it("bases do app são ortonormais e destras", () => {
    for (const out of ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const) {
      for (const m of ["parede", "teto", "piso"] as const) {
        const { x, y, z } = appBasis(out, m);
        const c = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
        c.forEach((v, i) => expect(v).toBeCloseTo(z[i])); // x × y = z
      }
    }
  });

  it("converte cada tipo num componente com malha centrada, tamanho e parâmetros", () => {
    const [l600, l625] = familyComponents("p1", fam("OST_LightingFixtures"));
    expect(l600.id).toBe(revitComponentId("OST_LightingFixtures:Luminária de embutir LED", "600x600 - 36W"));
    expect(l600).toMatchObject({ mounting: "teto", discipline: "eletrica", ifcType: "IFCLIGHTFIXTURE", group: "Iluminação", shape: "malha", tagPrefix: "L", symbolOf: "lum-embutir-6060" });
    expect(l600.size).toEqual([600, 600, 78]);
    expect(l625.size[0]).toBe(625);
    const params = Object.fromEntries(l600.params.map((p) => [p.name, p.default]));
    expect(params).toMatchObject({ Potência: 36, "Fluxo luminoso": 4000, Tensão: 220, Fabricante: "Exemplo Iluminação", Modelo: "LX-600", Circuito: "" });
    expect(params.Altura).toBeUndefined(); // nativos de dimensão ficam de fora
    // centrada na caixa envolvente
    const ys = Array.from(l600.mesh!.positions).filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(-39);
    expect(Math.max(...ys)).toBeCloseTo(39);

    const [tomada] = familyComponents("p1", fam("OST_ElectricalFixtures"));
    expect(tomada).toMatchObject({ mounting: "parede", defaultHeight: 300, tagPrefix: "T" });
    expect(tomada.size[1]).toBeGreaterThan(20); // profundidade (para fora da parede)
    expect(tomada.params.find((p) => p.name === "Potência")).toMatchObject({ unit: "VA", default: 100 });

    const [qd] = familyComponents("p1", fam("OST_ElectricalEquipment"), { mounting: "parede" });
    expect(qd.size).toEqual([400, 126, 500]);
    expect(symbolFor(qd).description).toContain("Quadro de distribuição de sobrepor");
  });

  it("registra e substitui os componentes de um pacote sem tocar nos de fábrica", () => {
    const defs = packageComponents("pkg-x", pkg);
    registerComponents("pkg-x", defs);
    expect(COMPONENTS.length).toBe(BUILTIN_COUNT + defs.length);
    expect(COMPONENT_BY_ID[defs[0].id]).toBe(defs[0]);
    expect(COMPONENT_GROUPS).toContain("Iluminação");
    registerComponents("pkg-x", defs.slice(0, 2));
    expect(COMPONENTS.length).toBe(BUILTIN_COUNT + 2);
    registerComponents("pkg-x", []);
    expect(COMPONENTS.length).toBe(BUILTIN_COUNT);
    expect(COMPONENT_BY_ID[defs[0].id]).toBeUndefined();
  });
});

describe("exportação IFC de família importada", () => {
  it("gera IfcTriangulatedFaceSet que reabre no web-ifc com o tamanho da peça", async () => {
    const { IfcAPI } = await import("web-ifc");
    const { exportPointsIfc } = await import("../src/core/ifcExport");
    const { loadIfc } = await import("../src/ifc/loadIfc");
    const { CoordinateSystem } = await import("../src/core/math");
    const { newGuid } = await import("../src/core/points");
    const defs = packageComponents("pkg-ifc", pkg);
    registerComponents("pkg-ifc", defs);
    const qd = defs.find((d) => d.ifcType === "IFCELECTRICDISTRIBUTIONBOARD")!;
    const api = new IfcAPI();
    await api.Init();
    const cs = new CoordinateSystem([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const point = { id: -1, guid: newGuid(), componentId: qd.id, tag: "QD1", position: [2, 1.5, 3] as [number, number, number], rotation: 0, height: 1500, refLevel: 0, storey: "Térreo", system: "", params: {} };
    const text = exportPointsIfc([point], { modelName: "t.ifc", storeys: [{ name: "Térreo", level: 0 }], cs });
    expect(text).toContain("IFCTRIANGULATEDFACESET(");
    expect(text).toContain("Familia Revit");
    const m = loadIfc(api, new TextEncoder().encode(text));
    const el = m.elements.find((e) => e.ifcType === "IFCELECTRICDISTRIBUTIONBOARD")!;
    expect(el).toBeDefined();
    const bb = el.bbox!;
    const ext = [0, 1, 2].map((i) => Math.round((bb.max[i] - bb.min[i]) * 1000)).sort((a, b) => a - b);
    expect(ext).toEqual([126, 400, 500]);
    m.close();
    registerComponents("pkg-ifc", []);
  });
});
