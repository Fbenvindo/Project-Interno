import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { DISCIPLINES } from "../src/core/disciplines";
import { COMPONENT_BY_ID } from "../src/core/library";
import { obbMesh } from "../src/core/obb";
import { buildPlan, type PlanInput } from "../src/core/plan/build";
import type { Prim } from "../src/core/plan/drawing";
import { exportDxf } from "../src/core/plan/dxf";
import { chainSegments, cutMesh, polygonArea, type P2 } from "../src/core/plan/section";
import { renderSheet } from "../src/core/plan/sheet";
import { computePlacement, type SurfaceHit } from "../src/core/placement";
import { defaultParams, newGuid, newPointId, storeyForMounting, type PlacedPoint } from "../src/core/points";
import { newRunId, RUN_TYPE_BY_ID, type Run } from "../src/core/runs";
import type { Vec3 } from "../src/core/types";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

describe("corte de malhas", () => {
  it("corta uma caixa e fecha o contorno", () => {
    const box = obbMesh({ center: [0, 1, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [2, 1, 0.5] });
    const segs = cutMesh(box.positions, box.indices, 1.2);
    const chains = chainSegments(segs.map(({ a, b }): [P2, P2] => [[a[0], a[2]], [b[0], b[2]]]));
    expect(chains).toHaveLength(1);
    expect(chains[0].closed).toBe(true);
    expect(chains[0].points).toHaveLength(4); // vértices colineares removidos
    expect(Math.abs(polygonArea(chains[0].points))).toBeCloseTo(4 * 1);
    expect(cutMesh(box.positions, box.indices, 5)).toHaveLength(0);
  });

  it("cadeias abertas quando a malha não é fechada", () => {
    const chains = chainSegments([
      [[0, 0], [1, 0]],
      [[1, 0], [1, 1]],
    ]);
    expect(chains).toEqual([{ points: [[0, 0], [1, 0], [1, 1]], closed: false }]);
  });
});

let model: LoadedModel;
beforeAll(async () => {
  const api = new IfcAPI();
  await api.Init();
  model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
});

function point(componentId: string, ifc: Vec3, ifcNormal: Vec3, tag: string, params: Record<string, string | number> = {}): PlacedPoint {
  const cs = model.coordinates;
  const o = cs.ifcToWorld([0, 0, 0]);
  const hit: SurfaceHit = { point: cs.ifcToWorld(ifc), normal: cs.ifcToWorld(ifcNormal).map((v, i) => v - o[i]) as Vec3 };
  const def = COMPONENT_BY_ID[componentId];
  const pl = computePlacement(def, hit, { height: def.defaultHeight, rotation: 0, snap: 0, floorLevel: model.storeyLevels[0].level });
  return {
    id: newPointId(), guid: newGuid(), componentId, tag, position: pl.position, rotation: pl.rotation, height: def.defaultHeight,
    refLevel: pl.refLevel, storey: storeyForMounting(def.mounting, pl.refLevel, model.storeyLevels), system: def.system,
    params: { ...defaultParams(def), ...params },
  };
}

function run(typeId: string, ifcVertices: Vec3[], tag: string, params: Record<string, string | number> = {}): Run {
  const t = RUN_TYPE_BY_ID[typeId];
  return {
    id: newRunId(), guid: newGuid(), typeId, tag, size: t.sizes.find((s) => s.label === t.defaultSize)!, system: t.system, slope: 0,
    vertices: ifcVertices.map((v) => model.coordinates.ifcToWorld(v)), params,
  };
}

function input(extra: Partial<PlanInput> = {}): PlanInput {
  return {
    elements: model.elements,
    meshes: new Map(model.meshes.map((m) => [m.expressID, m])),
    cs: model.coordinates,
    storeyLevels: model.storeyLevels,
    storey: "Térreo",
    cutHeight: 1.2,
    points: [],
    runs: [],
    scale: 50,
    disciplines: new Set(DISCIPLINES.map((d) => d.id)),
    labels: { tags: true, circuits: true, power: true, sizes: true },
    ...extra,
  };
}

const byLayer = (prims: Prim[], layer: string) => prims.filter((p) => p.layer === layer);

describe("planta do pavimento", () => {
  it("corta as paredes com hachura nas coordenadas do projeto", () => {
    const d = buildPlan(input());
    const walls = byLayer(d.prims, "ARQ-CORTE").filter((p): p is Extract<Prim, { t: "poly" }> => p.t === "poly");
    expect(walls).toHaveLength(3);
    expect(walls.every((w) => w.closed && w.fill)).toBe(true);
    const areas = walls.map((w) => Math.abs(polygonArea(w.pts))).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(0.15 * 5.85, 3); // parede interna
    expect(areas[2]).toBeCloseTo(10 * 0.15, 3);
    // Parede sul: y entre −0,075 e 0,075 m no projeto
    const south = walls.find((w) => Math.abs(Math.abs(polygonArea(w.pts)) - 1.5) < 1e-3 && w.pts.every((p) => Math.abs(p[1]) < 0.08));
    expect(south).toBeDefined();
    // Laje do 1º pavimento (estrutura) não cruza o corte do térreo
    expect(byLayer(d.prims, "EST-CORTE")).toHaveLength(0);
  });

  it("mostra MEP do IFC do pavimento cortado na meia altura", () => {
    const d = buildPlan(input());
    const hid = byLayer(d.prims, "HID-IFC");
    expect(hid.length).toBeGreaterThan(0);
    const pav1 = buildPlan(input({ storey: "1º Pavimento" }));
    expect(byLayer(pav1.prims, "HID-IFC").length).toBeGreaterThan(0);
    expect(byLayer(pav1.prims, "HVAC-IFC")).toHaveLength(0); // duto só no térreo
  });

  it("símbolos e etiquetas dos pontos locados", () => {
    const t1 = point("tomada-alta", [6.925, 2, 1], [-1, 0, 0], "T1", { Circuito: "C3", Potência: 600 });
    const l1 = point("lum-embutir-6060", [3, 3, 3.0], [0, 0, -1], "L1", { Circuito: "C1" });
    const d = buildPlan(input({ points: [t1, l1] }));
    const pts = byLayer(d.prims, "ELE-PONTOS");
    // Tomada alta: triângulo cheio apoiado na face da parede (x = 6,925), voltado para −X
    const triangle = pts.find((p) => p.t === "poly" && p.id === t1.id && p.pts.length === 3 && p.fill) as Extract<Prim, { t: "poly" }>;
    expect(triangle).toBeDefined();
    const xs = triangle.pts.map((p) => p[0]).sort((a, b) => a - b);
    expect(xs[2]).toBeCloseTo(6.925, 3); // base na face
    expect(xs[0]).toBeLessThan(6.925 - 0.1); // vértice para dentro do ambiente (3,6 mm × 50 ≈ 0,156 m)
    // Luminária: contorno real 600 × 600 mm
    const fp = pts.find((p) => p.t === "poly" && p.id === l1.id && p.pts.length === 4) as Extract<Prim, { t: "poly" }>;
    expect(Math.abs(polygonArea(fp.pts))).toBeCloseTo(0.36, 4);
    const texts = byLayer(d.prims, "ELE-TEXTOS").map((p) => (p.t === "text" ? p.text : ""));
    expect(texts).toContain("T1 · 600VA · C3");
    expect(texts).toContain("L1 · 40W · C1");
    expect(d.legend.map((l) => l.key)).toEqual(expect.arrayContaining(["tomada-alta", "lum-embutir-6060"]));
    expect(d.legend.find((l) => l.key === "tomada-alta")!.label).toBe("Tomada alta 2P+T (h = 2000 mm)");
    // Outro pavimento não mostra os pontos do térreo
    expect(byLayer(buildPlan(input({ storey: "1º Pavimento", points: [t1] })).prims, "ELE-PONTOS")).toHaveLength(0);
  });

  it("trechos: tracejado no piso, contínuo no teto, eletrocalha com largura, subidas e descidas", () => {
    const teto = run("eletroduto-pvc", [[1, 2, 0.3], [1, 2, 2.8], [5, 2, 2.8]], "ELD-1", { Circuito: "C2" });
    const piso = run("eletroduto-pvc", [[1, 4, 0.1], [5, 4, 0.1]], "ELD-2");
    const calha = run("eletrocalha", [[0.5, 5, 2.6], [6, 5, 2.6]], "ELC-1");
    const d = buildPlan(input({ runs: [teto, piso, calha] }));
    const lines = byLayer(d.prims, "ELE-TRECHOS");
    const tetoLine = lines.find((p) => p.t === "line" && Math.abs(p.a[1] - 2) < 1e-6) as Extract<Prim, { t: "line" }>;
    const pisoLine = lines.find((p) => p.t === "line" && Math.abs(p.a[1] - 4) < 1e-6) as Extract<Prim, { t: "line" }>;
    expect(tetoLine.dashed).toBeFalsy();
    expect(pisoLine.dashed).toBe(true);
    const calhaPoly = lines.find((p) => p.t === "poly") as Extract<Prim, { t: "poly" }>;
    expect(Math.abs(polygonArea(calhaPoly.pts))).toBeCloseTo(5.5 * 0.2, 4);
    // Subida do ponto (0,3 m) até o teto: no início do trecho horizontal o eletroduto desce até a tomada
    const marks = lines.filter((p) => p.t === "circle");
    expect(marks.length).toBeGreaterThan(0);
    expect(d.legend.map((l) => l.key)).toEqual(expect.arrayContaining(["eletroduto-pvc-teto", "eletroduto-pvc-piso", "eletrocalha-teto", "riser-down"]));
    const texts = byLayer(d.prims, "ELE-TEXTOS").map((p) => (p.t === "text" ? p.text : ""));
    expect(texts).toContain("ELD-1 Ø25 C2");
  });

  it("respeita as disciplinas desligadas", () => {
    const d = buildPlan(input({ disciplines: new Set(["eletrica"]) }));
    expect(d.prims.every((p) => p.layer.startsWith("ELE"))).toBe(true);
  });
});

describe("prancha e DXF", () => {
  const info = { projeto: "Edifício Exemplo", conteudo: "Instalações elétricas — Térreo", responsavel: "Eng. Fulano", data: "01/11/2026", folha: "01/03", revisao: "R00" };

  it("gera SVG em mm com legenda, carimbo e aviso quando não cabe", () => {
    const d = buildPlan(input({ points: [point("tomada-baixa", [6.925, 2, 1], [-1, 0, 0], "T1")] }));
    const a2 = renderSheet(d, "A2", info);
    expect(a2.svg).toMatch(/^<svg [^>]*width="594mm" height="420mm"/);
    expect(a2.fits).toBe(true);
    expect(a2.svg).toContain("LEGENDA");
    expect(a2.svg).toContain("Tomada baixa 2P+T (h = 300 mm)");
    expect(a2.svg).toContain("Edifício Exemplo");
    expect(a2.svg).toContain("1:50");
    expect(a2.svg).toContain(`data-id="${d.prims.find((p) => p.layer === "ELE-PONTOS")!.id}"`);
    expect(renderSheet(d, "A4", info).fits).toBe(false);
    expect(renderSheet({ ...d, scale: 100 }, "A4", info).fits).toBe(true);
  });

  it("DXF R12 válido, em mm, com camadas e textos acentuados escapados", () => {
    const d = buildPlan(input({ points: [point("tomada-alta", [6.925, 2, 1], [-1, 0, 0], "Tomada 1")], runs: [run("eletroduto-pvc", [[1, 4, 0.1], [5, 4, 0.1]], "ELD-2")] }));
    d.prims.push({ t: "text", p: [0, 0], text: "Água", height: 0.1, anchor: "start", layer: "ARQ-TEXTOS", color: "#000" });
    const dxf = exportDxf(d);
    const lines = dxf.trimEnd().split("\r\n");
    expect(lines.length % 2).toBe(0);
    expect(lines.slice(0, 4)).toEqual(["0", "SECTION", "2", "HEADER"]);
    expect(lines.slice(-2)).toEqual(["0", "EOF"]);
    for (let i = 0; i < lines.length; i += 2) expect(Number.isInteger(Number(lines[i].trim()))).toBe(true);
    for (const layer of ["ARQ-CORTE", "ELE-PONTOS", "ELE-TRECHOS"]) expect(dxf).toContain(`\r\n2\r\n${layer}\r\n`);
    expect(dxf).toContain("\\U+00C1gua");
    expect(dxf).toContain("\r\nSOLID\r\n"); // triângulo cheio da tomada alta
    expect(dxf).toContain("\r\n6\r\nDASHED\r\n"); // eletroduto no piso
    // Coordenadas em mm: a parede sul vai de x = 0 a 10000
    expect(dxf).toMatch(/\r\n10\r\n10000\r\n/);
    expect(/[^\x00-\x7F]/.test(dxf)).toBe(false);
  });
});
