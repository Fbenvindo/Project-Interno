import { describe, expect, it } from "vitest";
import {
  assemblyProblem,
  assemblySize,
  boxLabel,
  capacity,
  defaultAssembly,
  deviceMaterials,
  modulesText,
  normalizeAssembly,
  slotsUsed,
  supportsAssembly,
  switchCode,
  type DeviceAssembly,
} from "../src/core/devices";
import { COMPONENT_BY_ID } from "../src/core/library";
import { assemblySymbol } from "../src/core/plan/symbols";
import { CoordinateSystem } from "../src/core/math";
import { deserializePoints, newGuid, pointBBox, pointProperties, pointToElement, serializePoints, type PlacedPoint } from "../src/core/points";

const A = (install: DeviceAssembly["install"], box: DeviceAssembly["box"], ...modules: DeviceAssembly["modules"]): DeviceAssembly => ({ install, box, modules });

describe("caixas e módulos", () => {
  it("4×2/condulete simples até 3 módulos; 4×4/condulete duplo até 6; bipolar ocupa 2", () => {
    expect(capacity("4x2")).toBe(3);
    expect(capacity("4x4")).toBe(6);
    expect(slotsUsed(["int-bipolar", "tomada-10a"])).toBe(3);
    expect(assemblyProblem(A("embutida", "4x2", "int-bipolar", "tomada-10a"))).toBeNull();
    expect(assemblyProblem(A("embutida", "4x2", "int-bipolar", "tomada-10a", "tomada-20a"))).toMatch(/não cabem/);
    // ao passar de 3 módulos, vai para 4×4; acima de 6, corta
    expect(normalizeAssembly(A("aparente", "4x2", "tomada-10a", "tomada-10a", "tomada-10a", "int-simples")).box).toBe("4x4");
    expect(slotsUsed(normalizeAssembly(A("embutida", "4x4", ...Array(8).fill("tomada-10a"))).modules)).toBe(6);
  });

  it("nomes das caixas e dimensões (aparente sai da parede)", () => {
    expect(boxLabel(A("embutida", "4x2"))).toBe("Caixa 4×2 embutida");
    expect(boxLabel(A("embutida", "4x4"))).toBe("Caixa 4×4 embutida");
    expect(boxLabel(A("aparente", "4x2"))).toBe("Condulete simples aparente");
    expect(boxLabel(A("aparente", "4x4"))).toBe("Condulete duplo aparente");
    expect(assemblySize(A("aparente", "4x2"))[1]).toBeGreaterThan(assemblySize(A("embutida", "4x2"))[1]);
  });

  it("siglas dos interruptores (NBR 5444) e texto dos módulos", () => {
    expect(switchCode(["int-simples"])).toBe("S");
    expect(switchCode(["int-simples", "int-simples"])).toBe("S2");
    expect(switchCode(["int-paralelo"])).toBe("S3W");
    expect(switchCode(["int-intermediario"])).toBe("S4W");
    expect(switchCode(["int-bipolar"])).toBe("S2P");
    expect(switchCode(["int-simples", "int-paralelo", "tomada-10a"])).toBe("S+S3W");
    expect(modulesText(["tomada-10a", "tomada-10a", "int-paralelo"])).toBe("2× Tomada 2P+T 10 A + Interruptor paralelo (three-way)");
  });

  it("montagem padrão só para tomadas e interruptores de parede", () => {
    expect(defaultAssembly(COMPONENT_BY_ID["tomada-baixa"])).toEqual(A("embutida", "4x2", "tomada-10a"));
    expect(defaultAssembly(COMPONENT_BY_ID["interruptor-bipolar"])!.modules).toEqual(["int-bipolar"]);
    expect(supportsAssembly(COMPONENT_BY_ID["ponto-dados"])).toBe(false);
    expect(supportsAssembly(COMPONENT_BY_ID["tomada-piso"])).toBe(false);
  });

  it("quantitativo de caixas, placas e módulos", () => {
    const rows = deviceMaterials([A("embutida", "4x2", "tomada-10a", "int-simples"), A("aparente", "4x4", "tomada-20a", "tomada-20a"), A("embutida", "4x2", "tomada-10a")]);
    const q = (d: string) => rows.find((r) => r.description === d)?.quantity;
    expect(q("Caixa 4×2 embutida")).toBe(2);
    expect(q("Condulete duplo aparente")).toBe(1);
    expect(q("Módulo: Tomada 2P+T 10 A")).toBe(2);
    expect(q("Módulo: Tomada 2P+T 20 A")).toBe(2);
    expect(q("Módulo: Interruptor simples")).toBe(1);
  });
});

describe("símbolo e legenda", () => {
  it("um triângulo por tomada, 20A marcado, círculo com a sigla e moldura se aparente", () => {
    const emb = assemblySymbol(A("embutida", "4x2", "tomada-10a", "tomada-20a", "int-paralelo"), 1100);
    const tris = emb.prims.filter((p) => p.t === "poly" && p.pts.length === 3);
    expect(tris).toHaveLength(2);
    expect(emb.prims.some((p) => p.t === "text" && p.text === "20A")).toBe(true);
    expect(emb.prims.some((p) => p.t === "text" && p.text === "S3W")).toBe(true);
    expect(emb.description).toBe("Tomada 2P+T 10 A + Tomada 2P+T 20 A + Interruptor paralelo (three-way) (h = 1100 mm) — Caixa 4×2 embutida");
    const ap = assemblySymbol(A("aparente", "4x2", "tomada-10a", "tomada-20a", "int-paralelo"), 1100);
    expect(ap.prims.length).toBe(emb.prims.length + 1); // moldura
    expect(ap.description).toContain("Condulete simples aparente");
  });
});

describe("ponto com montagem", () => {
  const p: PlacedPoint = {
    id: -1,
    guid: newGuid(),
    componentId: "tomada-media",
    tag: "T1",
    position: [1, 1.1, 2],
    rotation: 0,
    height: 1100,
    refLevel: 0,
    storey: "Térreo",
    system: "Tomadas",
    params: { Potência: 600 },
    assembly: A("aparente", "4x4", "tomada-10a", "tomada-10a", "int-simples"),
  };
  it("tamanho, propriedades e elemento refletem a caixa", () => {
    const def = COMPONENT_BY_ID["tomada-media"];
    const bb = pointBBox(p, def);
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(0.055);
    const props = Object.fromEntries(pointProperties(p)[0].values.map((v) => [v.name, v.value]));
    expect(props.Caixa).toBe("Condulete duplo aparente");
    expect(props["Módulos"]).toBe("2× Tomada 2P+T 10 A + Interruptor simples (3/6)");
    expect(pointToElement(p).size).toBe("Condulete duplo aparente");
  });
  it("salva e reabre a montagem", () => {
    const cs = new CoordinateSystem([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const json = JSON.parse(JSON.stringify(serializePoints([p], cs, null)));
    expect(json.pontos[0].montagem).toEqual({ instalacao: "aparente", caixa: "4x4", modulos: ["tomada-10a", "tomada-10a", "int-simples"] });
    expect(deserializePoints(json, cs)[0].assembly).toEqual(p.assembly);
  });
});
