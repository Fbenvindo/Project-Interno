import { describe, expect, it } from "vitest";
import { classifyDiscipline, getTypeLabel } from "../src/core/disciplines";
import { buildQuantities, deriveLength, deriveSize, systemsFromProps } from "../src/core/quantities";
import { detectClashes, type ClashItem } from "../src/core/clash";
import { toCsv } from "../src/core/format";
import type { ElementInfo, PropertyGroup } from "../src/core/types";

describe("classificação por disciplina", () => {
  it("usa o tipo IFC quando ele define a disciplina", () => {
    expect(classifyDiscipline({ ifcType: "IfcDuctSegment" })).toBe("hvac");
    expect(classifyDiscipline({ ifcType: "IFCLIGHTFIXTURE" })).toBe("eletrica");
    expect(classifyDiscipline({ ifcType: "IFCWALLSTANDARDCASE" })).toBe("arquitetura");
  });

  it("reclassifica tubulação pelo sistema", () => {
    expect(classifyDiscipline({ ifcType: "IFCPIPESEGMENT" })).toBe("hidraulica");
    expect(classifyDiscipline({ ifcType: "IFCPIPESEGMENT", systems: [{ name: "Rede de Sprinklers" }] })).toBe("incendio");
    expect(classifyDiscipline({ ifcType: "IFCPIPESEGMENT", systems: [{ name: "GLP" }] })).toBe("gas");
    expect(classifyDiscipline({ ifcType: "IFCPIPESEGMENT", systems: [{ name: "Água gelada" }] })).toBe("hvac");
    expect(classifyDiscipline({ ifcType: "IFCPIPESEGMENT", systems: [{ name: "Ventilação sanitária" }] })).toBe("hidraulica");
    expect(
      classifyDiscipline({ ifcType: "IFCFLOWSEGMENT", systems: [{ name: "X", predefinedType: "FIREPROTECTION" }] }),
    ).toBe("incendio");
  });

  it("separa tomadas de dados em telecom", () => {
    expect(classifyDiscipline({ ifcType: "IFCOUTLET", predefinedType: "POWEROUTLET" })).toBe("eletrica");
    expect(classifyDiscipline({ ifcType: "IFCOUTLET", predefinedType: "DATAOUTLET" })).toBe("telecom");
  });

  it("dá rótulos em português", () => {
    expect(getTypeLabel("IFCCABLECARRIERSEGMENT")).toMatch(/Eletroduto/);
  });
});

const g = (kind: PropertyGroup["kind"], values: Record<string, string | number>): PropertyGroup => ({
  name: "Pset",
  kind,
  values: Object.entries(values).map(([name, value]) => ({ name, value })),
});

describe("extração de comprimento e dimensão", () => {
  it("prioriza quantidades IFC e converte unidades", () => {
    const groups = [g("propriedades", { Length: 1 }), g("quantidades", { Length: 2500 })];
    expect(deriveLength(groups, 0.001, null)).toBeCloseTo(2.5);
  });

  it("usa a maior dimensão da caixa como último recurso", () => {
    expect(deriveLength([], 1, { min: [0, 0, 0], max: [3, 0.05, 0.05] })).toBeCloseTo(3);
  });

  it("reconhece diâmetro, seção retangular e nomes em português", () => {
    expect(deriveSize([g("propriedades", { NominalDiameter: 50 })], 0.001)).toBe("Ø50");
    expect(deriveSize([g("propriedades", { "Diâmetro": 0.075 })], 1)).toBe("Ø75");
    expect(deriveSize([g("propriedades", { Largura: 400, Altura: 300 })], 0.001)).toBe("400x300");
    expect(deriveSize([g("propriedades", { Tamanho: '3/4"' })], 1)).toBe('3/4"');
  });

  it("lê sistema de propriedades do Revit", () => {
    expect(systemsFromProps([g("propriedades", { "Nome do sistema": "AF 1, AF 2" })])).toEqual(["AF 1", "AF 2"]);
  });
});

const el = (o: Partial<ElementInfo>): ElementInfo => ({
  expressID: 1,
  globalId: "",
  ifcType: "IFCPIPESEGMENT",
  name: "Tubo",
  objectType: null,
  predefinedType: null,
  storey: "Térreo",
  systems: ["AF"],
  discipline: "hidraulica",
  category: "segmento",
  bbox: null,
  length: 1,
  size: "Ø50",
  ...o,
});

describe("quantitativos", () => {
  it("soma comprimentos de segmentos e conta unidades", () => {
    const rows = buildQuantities([
      el({ expressID: 1, length: 2 }),
      el({ expressID: 2, length: 3.5 }),
      el({ expressID: 3, size: "Ø32", length: 1 }),
      el({ expressID: 4, ifcType: "IFCLIGHTFIXTURE", name: "Luminária", category: "terminal", discipline: "eletrica", length: null, size: null }),
      el({ expressID: 5, ifcType: "IFCLIGHTFIXTURE", name: "Luminária", category: "terminal", discipline: "eletrica", length: null, size: null }),
    ]);
    const dn50 = rows.find((r) => r.size === "Ø50")!;
    expect(dn50.unit).toBe("m");
    expect(dn50.quantity).toBeCloseTo(5.5);
    expect(dn50.count).toBe(2);
    const lum = rows.find((r) => r.ifcType === "IFCLIGHTFIXTURE")!;
    expect(lum.unit).toBe("un");
    expect(lum.quantity).toBe(2);
    expect(rows).toHaveLength(3);
  });

  it("pode agregar todos os pavimentos", () => {
    const rows = buildQuantities([el({ storey: "Térreo" }), el({ expressID: 2, storey: "1º" })], { groupByStorey: false });
    expect(rows).toHaveLength(1);
  });
});

describe("interferências", () => {
  const box = (id: number, discipline: ClashItem["discipline"], min: number[], max: number[], systems?: string[]): ClashItem => ({
    id,
    discipline,
    systems,
    bbox: { min: min as [number, number, number], max: max as [number, number, number] },
  });

  it("encontra sobreposição entre grupos e ignora o mesmo sistema", () => {
    const items = [
      box(1, "hidraulica", [0, 0, 0], [10, 0.05, 0.05], ["AF"]),
      box(2, "hvac", [5, -0.2, -0.1], [5.4, 0.2, 0.2]),
      box(3, "hidraulica", [2, 0, 0], [2.1, 0.1, 0.1], ["AF"]),
      box(4, "eletrica", [20, 0, 0], [21, 1, 1]),
    ];
    const res = detectClashes(items, { groupA: ["hidraulica"], groupB: ["hvac", "eletrica", "hidraulica"] });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ a: 1, b: 2, kind: "fisica" });
    expect(res[0].distance).toBeCloseTo(0.05);
  });

  it("reporta folga insuficiente", () => {
    const items = [box(1, "incendio", [0, 0, 0], [1, 1, 1]), box(2, "hvac", [1.03, 0, 0], [2, 1, 1])];
    expect(detectClashes(items, { groupA: ["incendio"], groupB: ["hvac"] })).toHaveLength(0);
    const res = detectClashes(items, { groupA: ["incendio"], groupB: ["hvac"], clearance: 0.05 });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("folga");
    expect(res[0].distance).toBeCloseTo(0.03);
  });
});

describe("CSV", () => {
  it("usa ponto e vírgula, vírgula decimal e BOM", () => {
    const csv = toCsv(["A", "B"], [["x;y", 1.5]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x;y";1,5');
  });
});
