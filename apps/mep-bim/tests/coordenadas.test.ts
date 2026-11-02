import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { compoundToDegrees, degreesToCompound, effectiveGeoref, formatDms, fromMap, mapConversionFrom, mapRotationDeg, settingsFromGeoref, toMap } from "../src/core/georef";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

let apto: LoadedModel;
let semGeo: LoadedModel;
beforeAll(async () => {
  const api = new IfcAPI();
  await api.Init();
  const read = (f: string) => new Uint8Array(readFileSync(join(__dirname, "..", "samples", f)));
  apto = loadIfc(api, read("exemplo-apartamento.ifc"));
  semGeo = loadIfc(api, read("exemplo-mep.ifc"));
});

describe("conversões", () => {
  const m = mapConversionFrom(333000, 7394000, 760, 30);
  it("projeto ↔ mapa (ida e volta), com rotação", () => {
    const p: [number, number, number] = [10, 5, 3];
    const e = toMap(m, p);
    fromMap(m, e).forEach((v, i) => expect(v).toBeCloseTo(p[i], 9));
    // eixo X do projeto a 30° do leste
    const x1 = toMap(m, [1, 0, 0]);
    expect(x1[0] - 333000).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(x1[1] - 7394000).toBeCloseTo(Math.sin(Math.PI / 6));
    expect(mapRotationDeg(m)).toBeCloseTo(30);
  });
  it("ângulos compostos do IFC e DMS", () => {
    expect(compoundToDegrees([-23, -33, -1, -500000])).toBeCloseTo(-(23 + 33 / 60 + 1.5 / 3600), 9);
    expect(compoundToDegrees(degreesToCompound(-46.6339))).toBeCloseTo(-46.6339, 6);
    expect(formatDms(-23.55041666, "lat")).toBe('23°33\'01,5"S');
  });
});

describe("leitura do IFC", () => {
  it("lê survey point, sistema de referência, norte verdadeiro e lat/long", () => {
    const g = apto.georef;
    expect(g.map!.eastings).toBeCloseTo(333456.789, 3);
    expect(g.map!.northings).toBeCloseTo(7394123.456, 3);
    expect(g.map!.orthogonalHeight).toBeCloseTo(760);
    expect(mapRotationDeg(g.map!)).toBeCloseTo(12);
    expect(g.crs).toMatchObject({ name: "EPSG:31983", description: "SIRGAS 2000 / UTM zone 23S", mapZone: "23S" });
    expect(g.trueNorthDeg).toBeCloseTo(10);
    expect(g.site!.latitude).toBeCloseTo(-23.55041666, 5);
    expect(g.site!.longitude).toBeCloseTo(-(46 + 38 / 60 + 2 / 3600), 6);
    expect(g.site!.elevation).toBeCloseTo(760);
  });
  it("sem georreferenciamento: nulo; o projeto pode informar manualmente", () => {
    expect(semGeo.georef.map).toBeNull();
    const s = { ...settingsFromGeoref(semGeo.georef), source: "manual" as const, eastings: 500000, northings: 7000000, height: 10, rotationDeg: 0, crsName: "EPSG:31983" };
    const g = effectiveGeoref(semGeo.georef, s);
    expect(toMap(g.map!, [1, 2, 3])).toEqual([500001, 7000002, 13]);
    expect(effectiveGeoref(apto.georef, settingsFromGeoref(apto.georef))).toBe(apto.georef);
  });
});

describe("exportação georreferenciada", () => {
  it("o IFC exportado leva o mesmo survey point, sistema, norte e lat/long, e reabre igual", async () => {
    const { exportPointsIfc } = await import("../src/core/ifcExport");
    const api = new IfcAPI();
    await api.Init();
    const text = exportPointsIfc([], { modelName: "apto.ifc", storeys: apto.storeyLevels, cs: apto.coordinates, georef: apto.georef });
    expect(text).toContain("IFCMAPCONVERSION(");
    expect(text).toContain("IFCPROJECTEDCRS('EPSG:31983'");
    const back = loadIfc(api, new TextEncoder().encode(text)).georef;
    expect(back.map!.eastings).toBeCloseTo(apto.georef.map!.eastings, 3);
    expect(back.map!.northings).toBeCloseTo(apto.georef.map!.northings, 3);
    expect(back.map!.orthogonalHeight).toBeCloseTo(760, 3);
    expect(mapRotationDeg(back.map!)).toBeCloseTo(12, 6);
    expect(back.trueNorthDeg).toBeCloseTo(10, 6);
    expect(back.site!.latitude).toBeCloseTo(apto.georef.site!.latitude!, 6);
    expect(back.site!.elevation).toBeCloseTo(760, 3);
    expect(back.crs!.name).toBe("EPSG:31983");
  });
});

describe("DXF em coordenadas do mapa", () => {
  it("leva linhas e textos para E/N em metros, com a rotação do survey point", async () => {
    const { exportDxf } = await import("../src/core/plan/dxf");
    const drawing = {
      prims: [
        { t: "line", a: [0, 0], b: [10, 0], weight: 0.35, layer: "ARQ-CORTE", color: "#000" },
        { t: "text", p: [0, 0], text: "T1", height: 0.1, anchor: "start", layer: "ELE-TEXTOS", color: "#000" },
      ],
      bounds: { min: [0, 0], max: [10, 0] },
      legend: [],
      scale: 50,
      storey: "Térreo",
      cutHeight: 1.2,
    } as never;
    const m = mapConversionFrom(333000, 7394000, 760, 90);
    const dxf = exportDxf(drawing, { map: m }).split("\r\n");
    const at = (code: string, from = 0) => Number(dxf[dxf.indexOf(code, from) + 1]);
    const line = dxf.indexOf("LINE");
    expect(at("10", line)).toBeCloseTo(333000);
    expect(at("20", line)).toBeCloseTo(7394000);
    // eixo X do projeto a 90° do leste: o fim da linha vai 10 m para o norte
    expect(at("11", line)).toBeCloseTo(333000, 6);
    expect(at("21", line)).toBeCloseTo(7394010, 6);
    const text = dxf.indexOf("TEXT");
    expect(at("40", text)).toBeCloseTo(0.1);
    expect(at("50", text)).toBeCloseTo(90);
    expect(dxf[dxf.indexOf("$INSUNITS") + 2]).toBe("6");
  });
});
