import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import type { P2 } from "../src/core/plan/section";
import {
  centroid,
  distanceToEdges,
  gridInSpace,
  lumenCount,
  lumenIlluminance,
  perimeter,
  perimeterPoints,
  pointInPolygon,
  polygonArea,
  spaceFrame,
} from "../src/core/spaces";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

const rect = (x0: number, y0: number, x1: number, y1: number): P2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rotate = (poly: P2[], a: number): P2[] => poly.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);

describe("ambientes do IFC", () => {
  let model: LoadedModel;
  beforeAll(async () => {
    const api = new IfcAPI();
    await api.Init();
    model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
  });

  it("lê contorno, cotas, número, nome e pavimento", () => {
    expect(model.spaces.map((s) => `${s.number} ${s.name}`)).toEqual(["101 Sala técnica", "102 Depósito"]);
    const [sala, dep] = model.spaces;
    expect(sala.storey).toBe("Térreo");
    expect(sala.area).toBeCloseTo(6.85 * 5.85, 4);
    expect(dep.area).toBeCloseTo(2.925 * 5.85, 4);
    expect(polygonArea(sala.polygon)).toBeGreaterThan(0); // anti-horário
    expect(sala.topY - sala.floorY).toBeCloseTo(3, 4);
    expect(model.coordinates.worldToIfc([0, sala.floorY, 0])[2]).toBeCloseTo(0, 4);
    const xs = sala.polygon.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0.075, 4);
    expect(Math.max(...xs)).toBeCloseTo(6.925, 4);
    // Ambientes não entram como elementos comuns
    expect(model.elements.some((e) => e.ifcType === "IFCSPACE")).toBe(false);
  });
});

describe("geometria de polígonos", () => {
  it("área, perímetro, centroide e ponto interno", () => {
    const r = rect(0, 0, 4, 3);
    expect(polygonArea(r)).toBe(12);
    expect(perimeter(r)).toBe(14);
    expect(centroid(r)).toEqual([2, 1.5]);
    expect(pointInPolygon([1, 1], r)).toBe(true);
    expect(pointInPolygon([5, 1], r)).toBe(false);
    expect(distanceToEdges([1, 1], r)).toBeCloseTo(1);
  });

  it("referencial alinhado à maior aresta", () => {
    const f = spaceFrame(rotate(rect(0, 0, 10, 6), 0.5));
    expect(f.angle).toBeCloseTo(0.5);
    expect(f.maxU - f.minU).toBeCloseTo(10);
    expect(f.maxV - f.minV).toBeCloseTo(6);
  });
});

describe("grade no ambiente", () => {
  it("por espaçamento: metade do espaçamento até a parede", () => {
    const g = gridInSpace(rect(0, 0, 10, 6), { mode: "espacamento", spacing: 2.5 });
    expect([g.cols, g.rows]).toEqual([4, 3]);
    expect(g.points).toHaveLength(12);
    expect(g.spacingU).toBeCloseTo(2.5);
    expect(g.spacingV).toBeCloseTo(2);
    expect(Math.min(...g.points.map((p) => p[0]))).toBeCloseTo(1.25);
  });

  it("acompanha ambientes girados", () => {
    const poly = rotate(rect(0, 0, 8, 4), Math.PI / 6);
    const g = gridInSpace(poly, { mode: "linhas", rows: 2, cols: 4 });
    expect(g.points).toHaveLength(8);
    expect(g.angle).toBeCloseTo(Math.PI / 6);
    for (const p of g.points) expect(distanceToEdges(p, poly)).toBeCloseTo(1, 6);
  });

  it("ambiente em L: descarta pontos fora e perto demais das paredes", () => {
    const L: P2[] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
    const g = gridInSpace(L, { mode: "espacamento", spacing: 2 });
    expect(g.cols * g.rows).toBe(9);
    expect(g.points).toHaveLength(5);
    expect(g.points.every((p) => pointInPolygon(p, L))).toBe(true);
    expect(gridInSpace(L, { mode: "espacamento", spacing: 2 }, 1.2).points).toHaveLength(0);
  });

  it("por quantidade: proporção do ambiente e ao menos N pontos", () => {
    const g = gridInSpace(rect(0, 0, 10, 6), { mode: "quantidade", count: 7 });
    expect([g.cols, g.rows]).toEqual([3, 3]);
    expect(g.points.length).toBeGreaterThanOrEqual(7);
  });
});

describe("perímetro e iluminação", () => {
  it("pontos por aresta, afastados dos cantos, com normal para dentro", () => {
    const r = rect(0, 0, 4, 3);
    const pts = perimeterPoints(r, 1.5, 0.3);
    expect(pts).toHaveLength(4 + 3 + 4 + 3);
    for (const p of pts) {
      const inside: P2 = [p.point[0] + p.inward[0] * 0.1, p.point[1] + p.inward[1] * 0.1];
      expect(pointInPolygon(inside, r)).toBe(true);
    }
    const bottom = pts.filter((p) => p.edge === 0).map((p) => p.point[0]);
    expect(bottom[0]).toBeCloseTo(0.3);
    expect(bottom[bottom.length - 1]).toBeCloseTo(3.7);
    // Sentido horário dá o mesmo resultado
    expect(perimeterPoints([...r].reverse(), 1.5, 0.3)).toHaveLength(14);
  });

  it("método dos lúmens", () => {
    const input = { illuminance: 300, area: 40, flux: 3600, utilization: 0.6, maintenance: 0.8 };
    expect(lumenCount(input)).toBe(7); // 300·40 / (3600·0,6·0,8) = 6,94
    expect(lumenIlluminance(7, input)).toBeCloseTo(302.4);
    expect(() => lumenCount({ ...input, flux: 0 })).toThrow();
  });
});
