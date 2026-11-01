import { describe, expect, it } from "vitest";
import {
  boxSitesForRun,
  boxSpec,
  conduitElevation,
  curveEquivalent,
  longestStretch,
  maxLengthFor,
  nominalInches,
  pullBoxes,
  rowLength,
  typeAllowed,
  type ConduitInstall,
} from "../src/core/conduits";
import { newGuid } from "../src/core/points";
import { newRunId, RUN_TYPE_BY_ID, runFittings, type Run } from "../src/core/runs";
import type { Vec3 } from "../src/core/types";

function conduit(vertices: Vec3[], typeId = "eletroduto-pvc", sizeLabel?: string, install?: ConduitInstall): Run {
  const t = RUN_TYPE_BY_ID[typeId];
  const size = t.sizes.find((s) => s.label === (sizeLabel ?? t.defaultSize))!;
  return { id: newRunId(), guid: newGuid(), typeId, tag: "ELD-1", size, system: "", slope: 0, vertices, params: {}, install };
}
const size = (typeId: string, label: string) => RUN_TYPE_BY_ID[typeId].sizes.find((s) => s.label === label)!;
const T = (id: string) => RUN_TYPE_BY_ID[id];

describe("limites entre caixas de passagem", () => {
  it("15 m reto, 12 m com 1 curva, 9 m com 2", () => {
    expect([0, 1, 2].map(maxLengthFor)).toEqual([15, 12, 9]);
    expect(curveEquivalent(90)).toBe(1);
    expect(curveEquivalent(45)).toBe(0.5);
  });

  it("trecho reto de 40 m: caixas a cada 15 m", () => {
    const r = conduit([[0, 3, 0], [40, 3, 0]]);
    const sites = boxSitesForRun(r);
    expect(sites.map((s) => s.position[0])).toEqual([15, 30]);
    expect(longestStretch(r, sites).length).toBeCloseTo(15);
  });

  it("com uma curva o limite cai para 12 m", () => {
    // 5 m, curva, 10 m: total 15 m > 12 m com 1 curva → caixa na curva
    const r = conduit([[0, 3, 0], [5, 3, 0], [5, 3, 10]]);
    const sites = boxSitesForRun(r);
    expect(sites).toHaveLength(1);
    expect(sites[0].position).toEqual([5, 3, 0]);
    // 4 m, curva, 7 m = 11 m ≤ 12 m: não precisa
    expect(boxSitesForRun(conduit([[0, 3, 0], [4, 3, 0], [4, 3, 7]]))).toHaveLength(0);
  });

  it("no máximo 2 curvas: a 3ª curva leva caixa", () => {
    const r = conduit([[0, 3, 0], [1, 3, 0], [1, 3, 1], [2, 3, 1], [2, 3, 2]]); // 3 curvas em 4 m
    const sites = boxSitesForRun(r);
    expect(sites).toHaveLength(1);
    expect(sites[0].position).toEqual([2, 3, 1]);
  });

  it("subida da tomada até o teto conta como curva", () => {
    // sobe 2,5 m, curva, anda 10 m: 12,5 m > 12 m → caixa no teto, no canto da subida
    const r = conduit([[0, 0.3, 0], [0, 2.8, 0], [10, 2.8, 0]]);
    const sites = boxSitesForRun(r);
    expect(sites).toHaveLength(1);
    expect(sites[0].position).toEqual([0, 2.8, 0]);
    // sobe 2,5 m e anda 9 m = 11,5 m com 1 curva: sem caixa
    expect(boxSitesForRun(conduit([[0, 0.3, 0], [0, 2.8, 0], [9, 2.8, 0]]))).toHaveLength(0);
  });
});

describe("dimensão das caixas", () => {
  it("afastamento de metade da maior bitola, arredondado a 10 mm; meia bitola nas pontas", () => {
    // 50 + 75: 25 + 50 + 40 + 75 + 37,5 = 227,5
    expect(rowLength([50, 75])).toBeCloseTo(227.5);
    expect(rowLength([25])).toBe(50);
  });

  it("laje: octogonal 4×4 quando cabe; senão caixa maior", () => {
    const one = boxSpec([{ size: size("eletroduto-flexivel", "Ø25"), type: T("eletroduto-flexivel") }], { mode: "laje" });
    expect(one.kind).toBe("octogonal-pvc");
    const two = boxSpec(
      [
        { size: size("eletroduto-pvc", "Ø50"), type: T("eletroduto-pvc") },
        { size: size("eletroduto-pvc", "Ø75"), type: T("eletroduto-pvc") },
      ],
      { mode: "laje" },
    );
    expect(two.kind).toBe("pvc-embutir");
    expect(two.dims[0]).toBe(250);
  });

  it("piso interno: ferro fundido 4×4 até 1\"; acima, alvenaria (mín. 30×30×30)", () => {
    expect(boxSpec([{ size: size("eletroduto-pvc", "Ø32"), type: T("eletroduto-pvc") }], { mode: "piso" }).kind).toBe("ferro-fundido");
    const big = boxSpec([{ size: size("eletroduto-pvc", "Ø40"), type: T("eletroduto-pvc") }], { mode: "piso" });
    expect(big.kind).toBe("alvenaria");
    expect(big.dims).toEqual([300, 300, 300]);
    expect(boxSpec([{ size: size("eletroduto-pvc", "Ø40"), type: T("eletroduto-pvc") }], { mode: "piso", floorLarge: "parede" }).kind).toBe("parede");
  });

  it("externa em alvenaria com matriz de tubos", () => {
    const tubos = Array.from({ length: 6 }, () => ({ size: size("eletroduto-pead", "Ø110"), type: T("eletroduto-pead") }));
    const linha = boxSpec(tubos, { mode: "piso", external: true });
    const matriz = boxSpec(tubos, { mode: "piso", external: true, matrix: { cols: 3, rows: 2 } });
    expect(linha.dims[0]).toBeGreaterThan(matriz.dims[0]);
    expect(matriz.dims[1]).toBeGreaterThan(linha.dims[1] - 1);
    expect(Math.min(...matriz.dims)).toBeGreaterThanOrEqual(300);
  });

  it("aparente: PVC de sobrepor; aço até 1\" condulete, até 2\" caixa metálica", () => {
    const ap: ConduitInstall = { mode: "aparente" };
    expect(boxSpec([{ size: size("eletroduto-pvc", "Ø25"), type: T("eletroduto-pvc") }], ap).kind).toBe("pvc-sobrepor");
    const c = boxSpec([{ size: size("eletroduto-aco", '1"'), type: T("eletroduto-aco") }, { size: size("eletroduto-aco", '3/4"'), type: T("eletroduto-aco") }], ap);
    expect(c.kind).toBe("condulete");
    expect(c.count).toBe(2);
    expect(boxSpec([{ size: size("eletroduto-aco", '2"'), type: T("eletroduto-aco") }], ap).kind).toBe("metalica");
  });

  it("caixa de teto com tubos na vertical troca largura e altura", () => {
    const tubos = [
      { size: size("eletroduto-pvc", "Ø50"), type: T("eletroduto-pvc") },
      { size: size("eletroduto-pvc", "Ø75"), type: T("eletroduto-pvc") },
    ];
    const h = boxSpec(tubos, { mode: "aparente", layout: "horizontal" });
    const v = boxSpec(tubos, { mode: "aparente", layout: "vertical" });
    expect(h.required).toEqual([v.required[1], v.required[0]]);
  });

  it("polegadas nominais", () => {
    expect(nominalInches(size("eletroduto-aco", '1.1/2"'))).toBe(1.5);
    expect(nominalInches(size("eletroduto-aco", '3/4"'))).toBe(0.75);
    expect(nominalInches(size("eletroduto-pvc", "Ø32"))).toBe(1);
  });
});

describe("instalação", () => {
  it("flexível só embutido; aparente exige rígido", () => {
    expect(typeAllowed(T("eletroduto-flexivel"), "aparente")).toBe(false);
    expect(typeAllowed(T("eletroduto-pead"), "piso")).toBe(true);
    expect(typeAllowed(T("eletroduto-aco"), "aparente")).toBe(true);
  });

  it("cota do eixo por instalação", () => {
    expect(conduitElevation({ mode: "piso" }, 0, 2.9, 25, 2.6)).toBeCloseTo(-0.05);
    expect(conduitElevation({ mode: "laje" }, 0, 2.9, 25, 2.6)).toBeCloseTo(2.95);
    expect(conduitElevation({ mode: "aparente" }, 0, 2.9, 40, 2.6)).toBeCloseTo(2.88);
    expect(conduitElevation({ mode: "aparente", apparentRef: "entreforro" }, 0, 2.9, 40, 2.6)).toBeCloseTo(2.6);
  });

  it("flexível não leva curva em mudança de direção na horizontal, só na subida", () => {
    const r = conduit([[0, 0.3, 0], [0, 2.9, 0], [3, 2.9, 1], [6, 2.9, 0]], "eletroduto-flexivel");
    const curvas = runFittings([r]).filter((f) => f.kind === "curva");
    expect(curvas).toHaveLength(1);
    expect(curvas[0].position).toEqual([0, 2.9, 0]);
  });
});

describe("caixas do projeto", () => {
  it("une eletrodutos paralelos na mesma caixa e cria caixa na derivação", () => {
    const a = conduit([[0, 3, 0], [20, 3, 0]], "eletroduto-pvc", "Ø25", { mode: "aparente" });
    const b = conduit([[0, 3, 0.1], [20, 3, 0.1]], "eletroduto-pvc", "Ø32", { mode: "aparente" });
    const ramal = conduit([[5, 3, 4], [5, 3, 0]], "eletroduto-pvc", "Ø25", { mode: "aparente" });
    const boxes = pullBoxes([a, b, ramal], []);
    const at15 = boxes.find((x) => Math.abs(x.position[0] - 15) < 0.01)!;
    expect(at15.runIds.sort()).toEqual([a.id, b.id].sort());
    expect(boxes.some((x) => x.reasons.includes("derivacao") && Math.abs(x.position[0] - 5) < 0.01)).toBe(true);
    // A ponta livre do ramal (sem ponto locado) também leva caixa.
    expect(boxes.some((x) => x.reasons.includes("extremidade"))).toBe(true);
  });
});

describe("exportação IFC das caixas", () => {
  it("gera IfcJunctionBox que reabre no web-ifc", async () => {
    const { IfcAPI } = await import("web-ifc");
    const { exportPointsIfc } = await import("../src/core/ifcExport");
    const { loadIfc } = await import("../src/ifc/loadIfc");
    const { CoordinateSystem } = await import("../src/core/math");
    const api = new IfcAPI();
    await api.Init();
    const cs = new CoordinateSystem([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const r = conduit([[0, 2.9, 0], [20, 2.9, 0]], "eletroduto-pvc", "Ø25", { mode: "aparente" });
    const text = exportPointsIfc([], { modelName: "t.ifc", storeys: [{ name: "Térreo", level: 0 }], cs, runs: [r] });
    expect(text).toContain("IFCJUNCTIONBOX(");
    const m = loadIfc(api, new TextEncoder().encode(text));
    const boxes = m.elements.filter((e) => e.ifcType === "IFCJUNCTIONBOX");
    expect(boxes.length).toBe(3); // 2 pontas livres + 1 aos 15 m
    expect(m.elements.some((e) => e.ifcType === "IFCCABLECARRIERSEGMENT")).toBe(true);
    m.close();
  });
});
