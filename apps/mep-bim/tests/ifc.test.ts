import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { detectClashes } from "../src/core/clash";
import { MEP_DISCIPLINES, DISCIPLINES } from "../src/core/disciplines";
import { buildQuantities } from "../src/core/quantities";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

let model: LoadedModel;

beforeAll(async () => {
  const api = new IfcAPI();
  await api.Init();
  model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
});

const byName = (name: string) => model.elements.filter((e) => e.name === name);

describe("modelo de exemplo", () => {
  it("lê unidades, pavimentos e sistemas", () => {
    expect(model.schema).toBe("IFC4");
    expect(model.unitToMeters).toBe(0.001);
    expect(model.storeys).toEqual(["Térreo", "1º Pavimento"]);
    expect(model.systems).toContain("Água Fria");
    expect(model.elements).toHaveLength(27);
  });

  it("classifica as disciplinas", () => {
    expect(byName("Tubo SPK DN25")[0].discipline).toBe("incendio");
    expect(byName("Tubo AF DN50")[0].discipline).toBe("hidraulica");
    expect(byName("Duto 400x300")[0].discipline).toBe("hvac");
    expect(byName("Ponto de dados RJ45")[0].discipline).toBe("telecom");
    expect(byName("Laje 1º pavimento")[0]).toMatchObject({ discipline: "estrutura", storey: "1º Pavimento" });
  });

  it("gera geometria em metros", () => {
    const duto = byName("Duto 400x300")[0];
    const d = duto.bbox!.max.map((v, i) => v - duto.bbox!.min[i]).sort((a, b) => a - b);
    expect(d[0]).toBeCloseTo(0.3, 3);
    expect(d[1]).toBeCloseTo(0.4, 3);
    expect(d[2]).toBeCloseTo(5.6, 3);
  });

  it("extrai comprimento e dimensão", () => {
    expect(byName("Tubo AF DN50")[0]).toMatchObject({ size: "Ø50" });
    expect(byName("Tubo AF DN50")[0].length).toBeCloseTo(9);
    expect(byName("Duto 400x300")[0].size).toBe("400x300");
    // Sem Qto: comprimento pela geometria
    expect(byName("Tubo SPK DN25")[0].length).toBeCloseTo(9, 2);
  });

  it("monta quantitativos", () => {
    const rows = buildQuantities(model.elements.filter((e) => MEP_DISCIPLINES.includes(e.discipline)), { groupByStorey: false });
    const lum = rows.find((r) => r.ifcType === "IFCLIGHTFIXTURE")!;
    expect(lum.quantity).toBe(6);
    const tomadas = rows.find((r) => r.ifcType === "IFCOUTLET" && r.discipline === "eletrica")!;
    expect(tomadas.quantity).toBe(4);
  });

  it("lê propriedades sob demanda", () => {
    const props = model.getProperties(byName("Tubo AF DN50")[0].expressID);
    expect(props.map((p) => p.name)).toEqual(["Pset_MEP_Exemplo", "Qto_PipeSegmentBaseQuantities"]);
    expect(props[0].values).toContainEqual({ name: "Material", value: "PVC soldável" });
  });

  it("detecta as interferências propositais", () => {
    const items = model.elements.map((e) => ({ id: e.expressID, discipline: e.discipline, bbox: e.bbox!, systems: e.systems }));
    const clashes = detectClashes(items, { groupA: MEP_DISCIPLINES, groupB: DISCIPLINES.map((d) => d.id), clearance: 0.05 });
    const name = (id: number) => model.elements.find((e) => e.expressID === id)!.name;
    const pairs = clashes.filter((c) => c.kind === "fisica").map((c) => [name(c.a), name(c.b)].sort().join(" x "));
    expect(pairs.sort()).toEqual(
      [
        "Duto 400x300 x Tubo AF DN50",
        "Duto 400x300 x Eletrocalha 200x100",
        "Parede interna x Tubo AF DN50",
        "Parede interna x Tubo SPK DN25",
        "Eletrocalha 200x100 x Parede interna",
      ].sort(),
    );
    const folgas = clashes.filter((c) => c.kind === "folga").map((c) => [name(c.a), name(c.b)].sort().join(" x "));
    expect(folgas).toContain("Duto 400x300 x Tubo SPK DN25");
  });
});
