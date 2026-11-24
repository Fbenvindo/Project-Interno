import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { federate, LINK_ID_BASE, linkSlotOf, prepareLink, type LinkMeta } from "../src/ifc/federate";
import { mapConversionFrom, toMap } from "../src/core/georef";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";
import type { Vec3 } from "../src/core/types";

let host: LoadedModel;
let other: LoadedModel;
beforeAll(async () => {
  const api = new IfcAPI();
  await api.Init();
  const read = (f: string) => new Uint8Array(readFileSync(join(__dirname, "..", "samples", f)));
  host = loadIfc(api, read("exemplo-apartamento.ifc"));
  other = loadIfc(api, read("exemplo-mep.ifc"));
});

const center = (b: { min: Vec3; max: Vec3 }): Vec3 => b.min.map((v, i) => (v + b.max[i]) / 2) as Vec3;
const meta = (over: Partial<LinkMeta> = {}): LinkMeta => ({ id: "l1", name: "mep.ifc", path: null, discipline: "auto", visible: true, translucent: false, ...over });

describe("vínculos IFC", () => {
  it("alinha o vínculo pelas coordenadas do projeto (IFC), mesmo com origens de cena diferentes", () => {
    const link = prepareLink("l1", 1, other, host);
    for (let i = 0; i < 5; i++) {
      const raw = other.elements.find((e) => e.bbox)!;
      const mine = link.elements.find((e) => e.expressID === LINK_ID_BASE + raw.expressID)!;
      const a = other.coordinates.worldToIfc(center(raw.bbox!));
      const b = host.coordinates.worldToIfc(center(mine.bbox!));
      a.forEach((v, k) => expect(b[k]).toBeCloseTo(v, 4));
    }
    // malhas também
    const m0 = other.meshes[0];
    const m1 = link.meshes.find((m) => m.expressID === LINK_ID_BASE + m0.expressID)!;
    const p0 = other.coordinates.worldToIfc([m0.positions[0], m0.positions[1], m0.positions[2]]);
    const p1 = host.coordinates.worldToIfc([m1.positions[0], m1.positions[1], m1.positions[2]]);
    p0.forEach((v, k) => expect(p1[k]).toBeCloseTo(v, 3));
  });

  it("ids próprios, pavimentos do principal e ambientes do vínculo", () => {
    const link = prepareLink("l1", 2, other, host);
    expect(link.elements.every((e) => linkSlotOf(e.expressID) === 2)).toBe(true);
    expect(linkSlotOf(12345)).toBe(0);
    const hostStoreys = new Set(host.storeys);
    expect(link.elements.filter((e) => e.storey).every((e) => hostStoreys.has(e.storey!))).toBe(true);
    expect(link.spaces).toHaveLength(other.spaces.length);
  });

  it("modelo federado: soma elementos, malhas e ambientes visíveis; disciplina forçada; propriedades da origem", () => {
    const link = prepareLink("l1", 1, other, host);
    const fed = federate(host, [{ data: link, meta: meta() }]);
    expect(fed.elements.length).toBe(host.elements.length + other.elements.length);
    expect(fed.meshes.length).toBe(host.meshes.length + other.meshes.length);
    expect(fed.spaces.length).toBe(host.spaces.length + other.spaces.length);
    expect(fed.storeys).toEqual(host.storeys);
    const arch = federate(host, [{ data: link, meta: meta({ discipline: "arquitetura" }) }]);
    expect(arch.elements.filter((e) => linkSlotOf(e.expressID)).every((e) => e.discipline === "arquitetura")).toBe(true);
    const hidden = federate(host, [{ data: link, meta: meta({ visible: false }) }]);
    expect(hidden).toBe(host);
    const wall = other.elements.find((e) => e.ifcType === "IFCWALL")!;
    const props = fed.getProperties(LINK_ID_BASE + wall.expressID);
    expect(props[0].values[0].value).toBe("mep.ifc");
  });
});

describe("alinhamento dos vínculos", () => {
  it("coordenadas compartilhadas: o mesmo ponto no mapa (E, N, cota) nos dois arquivos", () => {
    const hostMap = host.georef.map!;
    expect(hostMap).toBeTruthy();
    // Vínculo com outro survey point e outra rotação (como um modelo de outro parceiro).
    const linkMap = mapConversionFrom(333500, 7394100, 761.5, 40);
    const raw = { ...other, georef: { ...other.georef, map: linkMap } };
    const link = prepareLink("l1", 1, raw, host, { mode: "compartilhadas", dx: 0, dy: 0, dz: 0, rotDeg: 0 });
    expect(link.warning).toBeNull();
    const e = other.elements.find((x) => x.ifcType === "IFCWALL")!;
    const mine = link.elements.find((x) => x.expressID === LINK_ID_BASE + e.expressID)!;
    const a = toMap(linkMap, other.coordinates.worldToIfc(center(e.bbox!)));
    const b = toMap(hostMap, host.coordinates.worldToIfc(center(mine.bbox!)));
    a.forEach((v, k) => expect(b[k]).toBeCloseTo(v, 3));
  });

  it("sem survey point no vínculo: avisa e alinha origem a origem", () => {
    const link = prepareLink("l1", 1, other, host, { mode: "compartilhadas", dx: 0, dy: 0, dz: 0, rotDeg: 0 });
    expect(link.warning).toMatch(/survey point/);
  });

  it("manual: deslocamento e rotação nas coordenadas do projeto", () => {
    const link = prepareLink("l1", 1, other, host, { mode: "manual", dx: 10, dy: -2, dz: 0.5, rotDeg: 90 });
    const e = other.elements.find((x) => x.ifcType === "IFCWALL")!;
    const mine = link.elements.find((x) => x.expressID === LINK_ID_BASE + e.expressID)!;
    const [x, y, z] = other.coordinates.worldToIfc(center(e.bbox!));
    const b = host.coordinates.worldToIfc(center(mine.bbox!));
    expect(b[0]).toBeCloseTo(-y + 10, 3);
    expect(b[1]).toBeCloseTo(x - 2, 3);
    expect(b[2]).toBeCloseTo(z + 0.5, 3);
  });
});
