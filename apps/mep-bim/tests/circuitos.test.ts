import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import {
  ampacity,
  balancePhases,
  calcCircuit,
  circuitCurrent,
  conduitDistances,
  imbalance,
  nextCircuitName,
  panelSystem,
  phaseLoads,
  pointPowerVA,
  suggestType,
  type Circuit,
} from "../src/core/circuits";
import { exportPointsIfc } from "../src/core/ifcExport";
import { COMPONENT_BY_ID } from "../src/core/library";
import { CoordinateSystem } from "../src/core/math";
import { defaultParams, newGuid, newPointId, type PlacedPoint } from "../src/core/points";
import { deserializeProject, serializeProject } from "../src/core/project";
import { newRunId, RUN_TYPE_BY_ID, type Run } from "../src/core/runs";
import type { Vec3 } from "../src/core/types";
import { loadIfc } from "../src/ifc/loadIfc";

function pt(componentId: string, position: Vec3, params: Record<string, string | number> = {}, tag = "X"): PlacedPoint {
  const def = COMPONENT_BY_ID[componentId];
  return { id: newPointId(), guid: newGuid(), componentId, tag, position, rotation: 0, height: def.defaultHeight, refLevel: 0, storey: "Térreo", system: def.system, params: { ...defaultParams(def), ...params } };
}
function conduit(vertices: Vec3[], typeId = "eletroduto-pvc"): Run {
  const t = RUN_TYPE_BY_ID[typeId];
  return { id: newRunId(), guid: newGuid(), typeId, tag: "ELD-1", size: t.sizes[1], system: t.system, slope: 0, vertices, params: {} };
}
function circuit(over: Partial<Circuit> = {}): Circuit {
  return { id: 1, uid: newGuid(), panel: "P", name: "C1", description: "", type: "tug", poles: 1, phases: "A", powerFactor: 0.92, correction: 1, dropLimit: 4, ...over };
}
const sys = panelSystem("3F-127/220");

describe("potência e corrente", () => {
  it("VA direto e W convertido pelo fator de potência", () => {
    expect(pointPowerVA(pt("tomada-baixa", [0, 0, 0], { Potência: 100 }), 0.92)).toBe(100);
    expect(pointPowerVA(pt("lum-embutir-6060", [0, 0, 0], { Potência: 46 }), 0.92)).toBeCloseTo(50);
    expect(pointPowerVA(pt("interruptor-simples", [0, 0, 0]), 0.92)).toBe(0);
  });

  it("corrente mono/bi e trifásica", () => {
    expect(circuitCurrent(1270, 127, 1)).toBeCloseTo(10);
    expect(circuitCurrent(3810, 220, 3)).toBeCloseTo(10, 1);
  });

  it("tabela de capacidade (B1, cobre/PVC)", () => {
    expect(ampacity(2.5, 2)).toBe(24);
    expect(ampacity(2.5, 3)).toBe(21);
    expect(ampacity(6, 2)).toBe(41);
  });
});

describe("comprimento pelo traçado", () => {
  const panel: Vec3 = [0, 1.5, 0];
  const t1: Vec3 = [5, 0.3, 0];
  const t2: Vec3 = [3, 0.3, 2];
  const r1 = conduit([t1, [5, 2.8, 0], [0, 2.8, 0], panel]);
  const r2 = conduit([t2, [3, 2.8, 2], [3, 2.8, 0]]); // tê no meio de r1

  it("segue os eletrodutos e passa pelos tês", () => {
    const [d1, d2, d3] = conduitDistances([r1, r2], panel, [t1, t2, [9, 0.3, 9]]);
    expect(d1).toBeCloseTo(1.3 + 5 + 2.5);
    expect(d2).toBeCloseTo(1.3 + 3 + 2 + 2.5);
    expect(d3).toBeNull();
  });

  it("ignora tubulações que não são eletrodutos", () => {
    const water = conduit([t1, [5, 2.8, 0], [0, 2.8, 0], panel], "agua-fria");
    expect(conduitDistances([water], panel, [t1])).toEqual([null]);
  });
});

describe("dimensionamento", () => {
  const tomadas = (n: number, x0 = 1) => Array.from({ length: n }, (_, i) => pt("tomada-baixa", [x0 + i, 0.3, 0], { Potência: 100 }));
  const panel: Vec3 = [0, 1.5, 0];

  it("seção mínima quando corrente e queda são pequenas", () => {
    const pts = tomadas(10);
    const run = conduit([[10, 0.3, 0], [10, 2.8, 0], [0, 2.8, 0], panel]);
    const c = calcCircuit(circuit(), sys, panel, pts, [run, ...pts.slice(0, -1).map((p) => conduit([p.position, [p.position[0], 2.8, 0]]))]);
    expect(c.powerVA).toBe(1000);
    expect(c.current).toBeCloseTo(7.87, 2);
    expect(c.breaker).toBe(10);
    expect(c.section).toBe(2.5);
    expect(c.criterion).toBe("mínima");
  });

  it("queda de tensão define a seção em circuito longo", () => {
    const pts = [pt("tomada-baixa", [40, 0.3, 0], { Potência: 1000 })];
    const c = calcCircuit(circuit(), sys, [0, 0.3, 10], pts, []); // estimado: 40 + 10 = 50 m
    expect(c.lengthSource).toBe("estimado");
    expect(c.length).toBeCloseTo(50);
    expect(c.section).toBe(4);
    expect(c.criterion).toBe("queda");
    expect(c.drop!).toBeLessThanOrEqual(4);
  });

  it("capacidade de condução e fator de correção", () => {
    const tue = [pt("tomada-alta", [1, 2, 0], { Potência: 5000 })];
    const c = calcCircuit(circuit({ type: "tue", poles: 2, phases: "AB" }), sys, [0, 2, 0], tue, []);
    expect(c.voltage).toBe(220);
    expect(c.current).toBeCloseTo(22.7, 1);
    expect(c.breaker).toBe(25);
    expect(c.section).toBe(4); // 2,5 mm² = 24 A < 25 A
    expect(c.criterion).toBe("capacidade");
    expect(calcCircuit(circuit({ type: "tue", poles: 2, phases: "AB", correction: 0.7 }), sys, [0, 2, 0], tue, []).section).toBe(6);
  });

  it("iluminação parte de 1,5 mm²", () => {
    const c = calcCircuit(circuit({ type: "iluminacao" }), sys, [0, 3, 0], [pt("lum-embutir-6060", [2, 3, 0], { Potência: 40 })], []);
    expect(c.section).toBe(1.5);
  });

  it("avisa quando o circuito pede mais fases que o quadro tem", () => {
    const c = calcCircuit(circuit({ poles: 3, phases: "ABC" }), panelSystem("1F-127"), [0, 0, 0], [], []);
    expect(c.warnings.join(" ")).toMatch(/não tem 3 fases/);
  });
});

describe("fases do quadro", () => {
  const calc = (id: number, va: number, poles: 1 | 2 | 3 = 1, phases = "A") => ({ circuit: circuit({ id, poles, phases }), powerVA: va });

  it("distribui do maior para o menor na fase menos carregada", () => {
    const calcs = [calc(1, 3000), calc(2, 2000), calc(3, 1500), calc(4, 1000)];
    const map = balancePhases(calcs, 3);
    expect([...map.values()]).toEqual(["A", "B", "C", "C"]);
    const loads = phaseLoads(calcs.map((c) => ({ ...c, circuit: { ...c.circuit, phases: map.get(c.circuit.id)! } })));
    expect(loads).toEqual({ A: 3000, B: 2000, C: 2500 });
    expect(imbalance(loads, 3)).toBeCloseTo(1 / 3);
  });

  it("circuitos bi e trifásicos dividem a carga", () => {
    const loads = phaseLoads([calc(1, 3000, 3, "ABC"), calc(2, 2000, 2, "BC")]);
    expect(loads).toEqual({ A: 1000, B: 2000, C: 2000 });
    const map = balancePhases([calc(1, 3000, 3), calc(2, 2000, 2)], 3);
    expect(map.get(1)).toBe("ABC");
    expect(["AB", "BC", "CA"]).toContain(map.get(2));
  });

  it("numeração e tipo sugerido", () => {
    expect(nextCircuitName([circuit({ name: "C1" }), circuit({ name: "C4" }), circuit({ name: "C9", panel: "Q2" })], "P")).toBe("C5");
    expect(suggestType([pt("lum-embutir-6060", [0, 0, 0]), pt("interruptor-simples", [0, 0, 0])])).toBe("iluminacao");
    expect(suggestType([pt("tomada-baixa", [0, 0, 0]), pt("tomada-media", [0, 0, 0])])).toBe("tug");
    expect(suggestType([pt("tomada-alta", [0, 0, 0], { Potência: 1500 })])).toBe("tue");
  });
});

describe("arquivo e IFC", () => {
  let api: IfcAPI;
  beforeAll(async () => {
    api = new IfcAPI();
    await api.Init();
  });

  it("salva e reabre circuitos e a ligação dos pontos (versão 3)", () => {
    const cs = new CoordinateSystem();
    const c = circuit({ name: "C7", description: "Tomadas sala" });
    const p = { ...pt("tomada-baixa", [1, 0.3, 0], { Circuito: "C7" }), circuit: c.uid };
    const json = JSON.parse(JSON.stringify(serializeProject({ points: [p], runs: [{ ...conduit([[0, 0, 0], [1, 0, 0]]), circuit: c.uid }], circuits: [c] }, cs, "m.ifc")));
    expect(json.versao).toBe(3);
    const back = deserializeProject(json, cs);
    expect(back.circuits[0]).toMatchObject({ uid: c.uid, name: "C7", description: "Tomadas sala", poles: 1 });
    expect(back.points[0].circuit).toBe(c.uid);
    expect(back.runs[0].circuit).toBe(c.uid);
  });

  it("exporta IfcDistributionCircuit com pontos e trechos", () => {
    const model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
    const cs = model.coordinates;
    const quadro = pt("quadro-distribuicao", cs.ifcToWorld([9.5, 5.8, 1.5]), {}, "QD1");
    const c = circuit({ panel: quadro.guid, name: "C2", type: "iluminacao" });
    const lum = { ...pt("lum-embutir-6060", cs.ifcToWorld([3, 3, 2.96]), { Circuito: "C2" }, "L1"), circuit: c.uid };
    const run = { ...conduit([cs.ifcToWorld([3, 3, 2.9]), cs.ifcToWorld([9.5, 3, 2.9])]), circuit: c.uid };
    const text = exportPointsIfc([quadro, lum], { modelName: "x", storeys: model.storeyLevels, cs, runs: [run], circuits: [c] });
    expect(text).toContain("IFCDISTRIBUTIONCIRCUIT(");
    expect(text).toContain(".LIGHTING.");
    const out = loadIfc(api, new TextEncoder().encode(text));
    try {
      const l1 = out.elements.find((e) => e.name.startsWith("L1 "))!;
      expect(l1.systems).toEqual(expect.arrayContaining(["Iluminação", "QD1-C2"]));
      expect(out.elements.find((e) => e.ifcType === "IFCCABLECARRIERSEGMENT")!.systems).toContain("QD1-C2");
      expect(out.elements.find((e) => e.name.startsWith("QD1"))!.systems).not.toContain("QD1-C2");
    } finally {
      out.close();
    }
  });
});
