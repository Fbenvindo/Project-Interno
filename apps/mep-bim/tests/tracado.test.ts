import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { buildQuantities } from "../src/core/quantities";
import { exportPointsIfc } from "../src/core/ifcExport";
import { CoordinateSystem } from "../src/core/math";
import { deserializeProject, serializeProject } from "../src/core/project";
import {
  applySlope,
  autoRoute,
  derivedGuid,
  manhattanPath,
  nearestRun,
  newRunId,
  nextRunTag,
  orthoSnap,
  runElements,
  runFittings,
  runIdOfElement,
  runLength,
  RUN_TYPE_BY_ID,
  RUN_TYPES,
  segmentBBox,
  segmentElementId,
  fittingElementId,
  simplify,
  connectedPairs,
  type Run,
} from "../src/core/runs";
import { newGuid } from "../src/core/points";
import type { Vec3 } from "../src/core/types";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

const close = (a: number[], b: number[], d = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

function makeRun(typeId: string, vertices: Vec3[], sizeLabel?: string): Run {
  const t = RUN_TYPE_BY_ID[typeId];
  const size = t.sizes.find((s) => s.label === (sizeLabel ?? t.defaultSize))!;
  return { id: newRunId(), guid: newGuid(), typeId, tag: `${t.tagPrefix}-1`, size, system: t.system, slope: 0, vertices, params: {} };
}

describe("geometria do traçado", () => {
  it("simplifica vértices repetidos e colineares", () => {
    const v = simplify([[0, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 0, 1], [2, 0, 1.0001]]);
    expect(v).toEqual([[0, 0, 0], [2, 0, 0], [2, 0, 1]]);
  });

  it("restringe ao eixo horizontal dominante mantendo a cota", () => {
    expect(orthoSnap([0, 3, 0], [5, 1, 1])).toEqual([5, 3, 0]);
    expect(orthoSnap([0, 3, 0], [1, 1, -4])).toEqual([0, 3, -4]);
  });

  it("caminho ortogonal sobe, anda em X, em Z e desce", () => {
    expect(manhattanPath([0, 0.3, 0], [4, 1.5, 2], 3)).toEqual([[0, 0.3, 0], [0, 3, 0], [4, 3, 0], [4, 3, 2], [4, 1.5, 2]]);
    // Mesmo X: sem trecho em X
    expect(manhattanPath([0, 0.3, 0], [0, 0.3, 2], 3)).toEqual([[0, 0.3, 0], [0, 3, 0], [0, 3, 2], [0, 0.3, 2]]);
  });

  it("aplica declividade só no deslocamento horizontal", () => {
    const v = applySlope([[0, 3, 0], [10, 3, 0], [10, 0, 0]], 1);
    close(v[1], [10, 2.9, 0]);
    close(v[2], [10, -0.1, 0]);
  });

  it("caixa envolvente segue a orientação do perfil", () => {
    const size = { label: "200x100", width: 200, height: 100 };
    const h = segmentBBox([0, 3, 0], [5, 3, 0], size); // horizontal em X: largura em Z, altura em Y
    close(h.min, [0, 2.95, -0.1]);
    close(h.max, [5, 3.05, 0.1]);
    const v = segmentBBox([0, 0, 0], [0, 3, 0], size); // vertical: largura em X
    close(v.min, [-0.1, 0, -0.05]);
  });
});

describe("conexões", () => {
  it("conta curvas por ângulo e tês em derivações do mesmo tipo de rede", () => {
    const tronco = makeRun("eletroduto-pvc", [[0, 3, 0], [6, 3, 0], [6, 3, 4]]);
    const ramal = makeRun("eletroduto-pvc", [[3, 0.3, 2], [3, 3, 2], [3, 3, 0]]);
    const agua = makeRun("agua-fria", [[2, 3, 0.5], [2, 3, 0]]); // toca o eletroduto, mas é outra rede
    const f = runFittings([tronco, ramal, agua]);
    expect(f.filter((x) => x.kind === "curva").map((x) => x.angle)).toEqual([90, 90]);
    const tes = f.filter((x) => x.kind === "te");
    expect(tes).toHaveLength(1);
    close(tes[0].position, [3, 3, 0]);
    expect(tes[0].size.label).toBe(tronco.size.label);
  });

  it("emenda ponta com ponta não é tê", () => {
    const a = makeRun("agua-fria", [[0, 3, 0], [2, 3, 0]]);
    const b = makeRun("agua-fria", [[2, 3, 0], [4, 3, 0]]);
    expect(runFittings([a, b]).filter((x) => x.kind === "te")).toHaveLength(0);
  });

  it("encontra o trecho mais próximo", () => {
    const a = makeRun("agua-fria", [[0, 3, 0], [4, 3, 0]]);
    const hit = nearestRun([1, 3.02, 0.01], [a], 0.05)!;
    expect(hit.runId).toBe(a.id);
    close(hit.point, [1, 3, 0]);
    expect(nearestRun([1, 3.5, 0], [a], 0.05)).toBeNull();
  });
});

describe("traçado automático", () => {
  const target: Vec3 = [0, 1.5, 0];
  const pts: Vec3[] = [[5, 0.3, 0], [1, 0.3, 0], [3, 0.3, 0]];

  it("individual liga cada ponto ao destino", () => {
    const paths = autoRoute(pts, target, 3, "individual");
    expect(paths).toHaveLength(3);
    for (const p of paths) expect(p[p.length - 1]).toEqual(target);
  });

  it("em cadeia liga ao mais próximo, sucessivamente", () => {
    const paths = autoRoute(pts, target, 3, "cadeia");
    expect(paths.map((p) => p[0][0])).toEqual([1, 3, 5]);
    expect(paths[1][paths[1].length - 1]).toEqual([1, 0.3, 0]);
    const total = paths.reduce((s, p) => s + runLength({ vertices: p } as Run), 0);
    const homeRuns = autoRoute(pts, target, 3, "individual").reduce((s, p) => s + runLength({ vertices: p } as Run), 0);
    expect(total).toBeLessThan(homeRuns);
  });
});

describe("elementos, etiquetas e ids", () => {
  it("gera segmentos e conexões para quantitativos", () => {
    const r1 = makeRun("eletroduto-pvc", [[0, 0.3, 0], [0, 3, 0], [4, 3, 0], [4, 3, 2]]);
    const r2 = makeRun("eletroduto-pvc", [[0, 3, 1], [0, 3, 0.5], [2, 3, 0.5], [2, 3, 0]]);
    const els = runElements([r1, r2], [{ name: "Térreo", level: 0 }]);
    const rows = buildQuantities(els, { groupByStorey: false, groupBySystem: false });
    const seg = rows.find((r) => r.category === "segmento")!;
    expect(seg.quantity).toBeCloseTo(2.7 + 4 + 2 + 0.5 + 2 + 0.5);
    expect(seg.size).toBe("Ø25");
    const curvas = rows.find((r) => r.description === "Curva 90°")!;
    expect(curvas.quantity).toBe(4);
    expect(rows.find((r) => r.description === "Tê")!.quantity).toBe(1);
    expect(els.every((e) => e.discipline === "eletrica" && e.storey === "Térreo")).toBe(true);
  });

  it("ids da cena identificam o trecho", () => {
    expect(runIdOfElement(segmentElementId(7, 3))).toBe(7);
    expect(runIdOfElement(fittingElementId(7, 2))).toBe(7);
    expect(runIdOfElement(-5)).toBeNull();
    expect(new Set([segmentElementId(1, 0), fittingElementId(1, 0), segmentElementId(2, 0)]).size).toBe(3);
  });

  it("GlobalIds derivados são válidos e distintos", () => {
    const g = newGuid();
    const ds = [0, 1, 2, 500, 501].map((n) => derivedGuid(g, n));
    expect(new Set([...ds, g]).size).toBe(6);
    for (const d of ds) expect(d).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
  });

  it("etiquetas por prefixo", () => {
    expect(nextRunTag([{ tag: "ELD-1" }, { tag: "ELD-4" }, { tag: "AF-9" }] as Run[], "ELD")).toBe("ELD-5");
  });

  it("catálogo consistente", () => {
    for (const t of RUN_TYPES) {
      expect(t.sizes.some((s) => s.label === t.defaultSize)).toBe(true);
    }
    expect(RUN_TYPE_BY_ID["esgoto"].slopeFor!({ label: "Ø75", width: 75, height: 75 })).toBe(2);
    expect(RUN_TYPE_BY_ID["esgoto"].slopeFor!({ label: "Ø100", width: 100, height: 100 })).toBe(1);
  });
});

describe("conexões não são interferências", () => {
  it("trecho × equipamento onde termina e trechos ligados por tê", () => {
    const quadro = {
      id: -900, guid: newGuid(), componentId: "quadro-distribuicao", tag: "QD1", position: [0, 1.5, 0] as Vec3,
      rotation: 0, height: 1500, refLevel: 0, storey: null, system: "Distribuição", params: {},
    };
    const chega = makeRun("eletroduto-pvc", [[3, 2.8, 0], [0, 2.8, 0], [0, 1.5, 0]]);
    const longe = makeRun("eletroduto-pvc", [[3, 2.5, 2], [5, 2.5, 2]]);
    const ramal = makeRun("eletroduto-pvc", [[1.5, 0.3, 1], [1.5, 2.8, 1], [1.5, 2.8, 0]]); // tê no meio de "chega"
    const ignore = connectedPairs([chega, longe, ramal], [quadro]);
    expect(ignore(segmentElementId(chega.id, 1), -900)).toBe(true);
    expect(ignore(-900, segmentElementId(chega.id, 0))).toBe(true);
    expect(ignore(segmentElementId(longe.id, 0), -900)).toBe(false);
    expect(ignore(segmentElementId(ramal.id, 1), segmentElementId(chega.id, 0))).toBe(true);
    expect(ignore(segmentElementId(ramal.id, 0), segmentElementId(longe.id, 0))).toBe(false);
  });
});

describe("arquivo e IFC", () => {
  let api: IfcAPI;
  let model: LoadedModel;
  beforeAll(async () => {
    api = new IfcAPI();
    await api.Init();
    model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
  });

  it("salva e reabre trechos em coordenadas do projeto (lê também a versão 1)", () => {
    const cs = model.coordinates;
    const r = makeRun("esgoto", [cs.ifcToWorld([1, 1, 0.5]), cs.ifcToWorld([1, 1, 2.5]), cs.ifcToWorld([4, 1, 2.5])], "Ø100");
    const json = JSON.parse(JSON.stringify(serializeProject({ points: [], runs: [r], circuits: [] }, cs, "x.ifc")));
    expect(json.versao).toBe(3);
    close(json.trechos[0].vertices[2], [4, 1, 2.5]);
    const other = new CoordinateSystem([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, 1, 1]);
    const back = deserializeProject(json, other);
    close(other.worldToIfc(back.runs[0].vertices[2]), [4, 1, 2.5]);
    expect(back.runs[0].size.label).toBe("Ø100");
    expect(deserializeProject({ ...json, versao: 1, trechos: undefined }, other).runs).toEqual([]);
  });

  it("exporta segmentos e conexões que reabrem com comprimento, bitola e disciplina", () => {
    const cs = model.coordinates;
    const ifc = (v: Vec3) => cs.ifcToWorld(v);
    const eld = makeRun("eletroduto-pvc", [ifc([1, 1, 0.3]), ifc([1, 1, 2.8]), ifc([5, 1, 2.8]), ifc([5, 3, 2.8])]);
    eld.params = { Circuito: "C2" };
    const calha = makeRun("eletrocalha", [ifc([0.5, 4, 2.6]), ifc([6, 4, 2.6])]);
    const text = exportPointsIfc([], { modelName: "x.ifc", storeys: model.storeyLevels, cs, runs: [eld, calha] });
    const out = loadIfc(api, new TextEncoder().encode(text));
    try {
      const segs = out.elements.filter((e) => e.category === "segmento");
      expect(segs).toHaveLength(4);
      expect(segs.every((e) => e.discipline === "eletrica")).toBe(true);
      const lens = segs.map((e) => Math.round(e.length! * 1000) / 1000).sort((a, b) => a - b);
      expect(lens).toEqual([2, 2.5, 4, 5.5]);
      expect(segs.find((e) => e.length! > 5)!.size).toBe("200x100");
      expect(segs.find((e) => Math.abs(e.length! - 4) < 0.01)!.size).toBe("Ø25");
      // Posição: segmento de 4 m entre x=1 e x=5 a 2,8 m
      const s4 = segs.find((e) => Math.abs(e.length! - 4) < 0.01)!;
      const c = out.coordinates.worldToIfc(s4.bbox!.min.map((v, i) => (v + s4.bbox!.max[i]) / 2) as Vec3);
      close(c, [3, 1, 2.8], 3);
      const curvas = out.elements.filter((e) => e.ifcType === "IFCCABLECARRIERFITTING");
      expect(curvas).toHaveLength(2);
      expect(out.elements.find((e) => e.ifcType === "IFCCABLECARRIERSEGMENT" && e.name.startsWith("ELD"))!.systems).toEqual(["Tomadas"]);
    } finally {
      out.close();
    }
  });
});
