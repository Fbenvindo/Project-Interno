import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { ifcDataBuffers } from "../src/ifc/ifcDataBuffers";
import { extractIfc, modelFromData, type IfcData } from "../src/ifc/loadIfc";
import { chunksOfMeshes, meshesOfChunks } from "../src/ifc/meshChunks";
import { entriesToEvict } from "../src/renderer/src/ifc/modelCache";

let data: IfcData;

beforeAll(async () => {
  const api = new IfcAPI();
  await api.Init();
  data = extractIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
});

describe("dados do IFC para o worker e o cache", () => {
  it("sobrevivem à cópia estruturada (worker/IndexedDB) com geometria e propriedades", () => {
    // O que vai do worker para a interface: clone estruturado com os blocos transferidos.
    const copy = structuredClone(data, { transfer: [] });
    const m = modelFromData(copy);
    expect(m.elements).toHaveLength(27);
    expect(m.meshes).toHaveLength(data.geometry.reduce((n, g) => n + g.ids.length, 0));
    expect(m.storeys).toEqual(["Térreo", "1º Pavimento"]);
    const tubo = m.elements.find((e) => e.name === "Tubo SPK DN25")!;
    expect(m.getProperties(tubo.expressID).length).toBeGreaterThan(0);
    // Cena ⇄ IFC continua igual.
    const p = m.coordinates.ifcToWorld([1, 2, 3]);
    expect(m.coordinates.worldToIfc(p).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 2, 3]);
    // Poucos blocos para transferir, não um por malha.
    expect(ifcDataBuffers(copy).length).toBeLessThanOrEqual(7 * copy.geometry.length);
    expect(copy.geometry.length).toBe(1);
  });

  it("divide a geometria em blocos (pequenos, para testar) sem perder nada", () => {
    const meshes = meshesOfChunks(data.geometry);
    const chunks = chunksOfMeshes(meshes, 300);
    expect(chunks.length).toBeGreaterThan(3);
    const again = meshesOfChunks(chunks);
    expect(again.length).toBe(meshes.length);
    for (let i = 0; i < meshes.length; i++) {
      expect(again[i].expressID).toBe(meshes[i].expressID);
      expect(Array.from(again[i].indices)).toEqual(Array.from(meshes[i].indices));
      expect(Array.from(again[i].positions)).toEqual(Array.from(meshes[i].positions));
      expect(Array.from(again[i].normals)).toEqual(Array.from(meshes[i].normals));
      expect(again[i].color).toEqual(meshes[i].color);
    }
  });

  it("limites do cache: sai o usado há mais tempo; o mais recente sempre fica", () => {
    const e = (key: string, bytes: number, usedAt: number) => ({ key, name: key, bytes, usedAt });
    expect(entriesToEvict([e("a", 10, 1), e("b", 10, 3), e("c", 10, 2)], 25, 10)).toEqual(["a"]);
    expect(entriesToEvict([e("a", 10, 1), e("b", 10, 3), e("c", 10, 2)], 100, 2)).toEqual(["a"]);
    expect(entriesToEvict([e("grande", 500, 5), e("b", 10, 3)], 100, 10)).toEqual(["b"]);
  });
});
