import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { NO_SECTION, sectionToPlanes } from "../src/renderer/src/viewer/SectionTools";
import { loadIfc } from "../src/ifc/loadIfc";

describe("cortes da vista 3D", () => {
  it("converte cortes do projeto para planos da cena", async () => {
    const api = new IfcAPI();
    await api.Init();
    const model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
    const cs = model.coordinates;
    expect(sectionToPlanes(NO_SECTION, cs)).toEqual({ horizontal: null, x: null, z: null });
    const planes = sectionToPlanes(
      { horizontal: { on: true, z: 1.2 }, x: { on: true, pos: 7, invert: false }, y: { on: true, pos: 3, invert: false } },
      cs,
    );
    expect(cs.worldToIfc([0, planes.horizontal!, 0])[2]).toBeCloseTo(1.2);
    expect(cs.worldToIfc([planes.x!.pos, 0, 0])[0]).toBeCloseTo(7);
    // Manter Y do projeto ≤ 3 equivale a manter z da cena ≥ z(3), pois Y aponta para −Z.
    expect(cs.worldToIfc([0, 0, planes.z!.pos])[1]).toBeCloseTo(3);
    expect(planes.z!.invert).toBe(true);
    const keep = (ifcY: number) => {
      const z = cs.ifcToWorld([0, ifcY, 0])[2];
      return planes.z!.invert ? z >= planes.z!.pos : z <= planes.z!.pos;
    };
    expect(keep(2)).toBe(true);
    expect(keep(4)).toBe(false);
  });
});
