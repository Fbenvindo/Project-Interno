import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { exportPointsIfc, num, str } from "../src/core/ifcExport";
import { COMPONENTS, COMPONENT_BY_ID } from "../src/core/library";
import { CoordinateSystem, invert, transformPoint } from "../src/core/math";
import { ceilingPlane, computePlacement, countForSpacing, elevationFor, gridPoints, type SurfaceHit } from "../src/core/placement";
import {
  defaultParams,
  deserializePoints,
  newGuid,
  newPointId,
  nextTag,
  pointBBox,
  pointToElement,
  serializePoints,
  storeyAt,
  storeyForMounting,
  type PlacedPoint,
} from "../src/core/points";
import type { Vec3 } from "../src/core/types";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

let api: IfcAPI;
let model: LoadedModel;

beforeAll(async () => {
  api = new IfcAPI();
  await api.Init();
  model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
});

const close = (a: number[], b: number[], digits = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const center = (bb: { min: Vec3; max: Vec3 }): Vec3 => bb.min.map((v, i) => (v + bb.max[i]) / 2) as Vec3;

/** Ponto de clique em coordenadas IFC (m) convertido para a cena. */
function hitAt(ifc: Vec3, ifcNormal: Vec3): SurfaceHit {
  const cs = model.coordinates;
  const p = cs.ifcToWorld(ifc);
  const o = cs.ifcToWorld([0, 0, 0]);
  const n = cs.ifcToWorld(ifcNormal).map((v, i) => v - o[i]) as Vec3;
  return { point: p, normal: n };
}

function makePoint(componentId: string, hit: SurfaceHit, height?: number, snap = 0): PlacedPoint {
  const def = COMPONENT_BY_ID[componentId];
  const floorLevel = model.storeyLevels[0].level;
  const pl = computePlacement(def, hit, { height: height ?? def.defaultHeight, rotation: 0, snap, floorLevel });
  expect(pl.ok).toBe(true);
  return {
    id: newPointId(),
    guid: newGuid(),
    componentId,
    tag: "X1",
    position: pl.position,
    rotation: pl.rotation,
    height: height ?? def.defaultHeight,
    refLevel: pl.refLevel,
    storey: storeyForMounting(def.mounting, pl.refLevel, model.storeyLevels),
    system: def.system,
    params: defaultParams(def),
  };
}

describe("matemática e coordenadas", () => {
  it("inverte matrizes", () => {
    const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 5, 2, -3, 1];
    close(transformPoint(invert(m), transformPoint(m, [1, 2, 3])), [1, 2, 3]);
  });

  it("converte cena ⇄ IFC no modelo de exemplo", () => {
    const qdl = model.elements.find((e) => e.name === "QDL-01")!;
    // Quadro: base em (9500, 5800, 1000) mm e 800 mm de altura.
    close(model.coordinates.worldToIfc(center(qdl.bbox!)), [9.5, 5.8, 1.4]);
    close(model.coordinates.ifcToWorld(model.coordinates.worldToIfc([1, 2, 3])), [1, 2, 3]);
  });

  it("calcula a cota dos pavimentos na cena", () => {
    const [terreo, pav1] = model.storeyLevels;
    expect(model.coordinates.worldToIfc([0, terreo.level, 0])[2]).toBeCloseTo(0);
    expect(model.coordinates.worldToIfc([0, pav1.level, 0])[2]).toBeCloseTo(3);
    expect(storeyAt(pav1.level - 0.2, model.storeyLevels)).toBe("Térreo");
    expect(storeyAt(pav1.level + 0.5, model.storeyLevels)).toBe("1º Pavimento");
  });
});

describe("posicionamento", () => {
  it("tomada na parede: altura acima do piso e afastada da face", () => {
    // Face oeste da parede interna (x = 6925 mm), normal para −X.
    const p = makePoint("tomada-baixa", hitAt([6.925, 3.03, 1.0], [-1, 0, 0]), 300, 0.1);
    // Centro: 20 mm para fora da face (metade da profundidade), 300 mm acima do piso, Y arredondado.
    close(model.coordinates.worldToIfc(p.position), [6.905, 3.0, 0.3]);
  });

  it("recusa superfícies incompatíveis", () => {
    const def = COMPONENT_BY_ID["tomada-baixa"];
    const res = computePlacement(def, hitAt([2, 1, 3], [0, 0, -1]), { height: 300, rotation: 0, snap: 0, floorLevel: 0 });
    expect(res.ok).toBe(false);
    const lum = COMPONENT_BY_ID["lum-embutir-6060"];
    expect(computePlacement(lum, hitAt([6.925, 3, 1], [-1, 0, 0]), { height: 0, rotation: 0, snap: 0, floorLevel: 0 }).ok).toBe(false);
  });

  it("luminária encostada na face inferior da laje", () => {
    const p = makePoint("lum-embutir-6060", hitAt([2.0, 1.5, 3.0], [0, 0, -1]));
    close(model.coordinates.worldToIfc(p.position), [2.0, 1.5, 2.96]);
    expect(p.storey).toBe("Térreo");
    const def = COMPONENT_BY_ID["lum-embutir-6060"];
    expect(elevationFor(def, p.refLevel, 100)).toBeCloseTo(p.position[1] - 0.1);
  });

  it("grade de linhas × colunas e espaçamento", () => {
    const pts = gridPoints([0, 3, 0], [6, 3, 4], 2, 3);
    expect(pts).toHaveLength(6);
    close(pts[0], [1, 3, 1]);
    close(pts[5], [5, 3, 3]);
    expect(countForSpacing(10, 3)).toBe(4);
    expect(countForSpacing(9, 3)).toBe(3);
  });

  it("caixa envolvente considera a rotação", () => {
    const def = COMPONENT_BY_ID["evaporadora-hiwall"];
    const p = { position: [0, 0, 0] as Vec3, rotation: Math.PI / 2 } as PlacedPoint;
    const bb = pointBBox(p, def);
    expect(bb.max[0]).toBeCloseTo(0.11); // profundidade 220 mm ao longo de X
    expect(bb.max[2]).toBeCloseTo(0.45); // largura 900 mm ao longo de Z
  });
});

describe("etiquetas e biblioteca", () => {
  it("numera por prefixo", () => {
    const pts = [{ tag: "L1" }, { tag: "L7" }, { tag: "LE2" }, { tag: "T3" }] as PlacedPoint[];
    expect(nextTag(pts, "L")).toBe("L8");
    expect(nextTag(pts, "LE")).toBe("LE3");
    expect(nextTag(pts, "SPK")).toBe("SPK1");
  });

  it("componentes têm ids únicos e geram ElementInfo coerente", () => {
    expect(new Set(COMPONENTS.map((c) => c.id)).size).toBe(COMPONENTS.length);
    const p = makePoint("ponto-dados", hitAt([6.925, 2, 0.3], [-1, 0, 0]));
    const el = pointToElement({ ...p, tag: "D1" });
    expect(el).toMatchObject({ discipline: "telecom", category: "terminal", name: "D1 - Ponto de dados RJ45", origin: "locacao" });
  });

  it("GlobalId IFC válido", () => {
    const g = newGuid();
    expect(g).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
  });
});

describe("arquivo de locação", () => {
  it("salva em coordenadas IFC e reabre na mesma posição", () => {
    const pts = [makePoint("tomada-media", hitAt([6.925, 2, 0], [-1, 0, 0])), makePoint("sprinkler-pendente", hitAt([4, 4.5, 3], [0, 0, -1]))];
    const json = JSON.parse(JSON.stringify(serializePoints(pts, model.coordinates, "exemplo-mep.ifc")));
    close(json.pontos[0].posicao, [6.905, 2, 1.1]);
    // Reabrindo com um deslocamento diferente da cena, a posição IFC se mantém.
    const other = new CoordinateSystem([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, -5, 2, 1]);
    const back = deserializePoints(json, other);
    close(other.worldToIfc(back[1].position), model.coordinates.worldToIfc(pts[1].position));
    expect(back[0].guid).toBe(pts[0].guid);
    expect(() => deserializePoints({ formato: "x" }, other)).toThrow();
  });
});

describe("itens de teto: forro, entreforro e laje", () => {
  const def = COMPONENT_BY_ID["difusor-6060"];
  const found = { covering: 2.7, slab: 3.0 };
  it("forro usa o forro do modelo e, sem ele, a altura informada", () => {
    expect(ceilingPlane(def, { ref: "forro", level: 2600 }, 0, found)).toBeCloseTo(2.7);
    expect(ceilingPlane(def, { ref: "forro", level: 2600 }, 0, { covering: null, slab: 3 })).toBeCloseTo(2.6);
  });
  it("laje usa a face inferior da laje, não o forro", () => {
    expect(ceilingPlane(def, { ref: "laje", level: 0 }, 0, found)).toBeCloseTo(3.0);
  });
  it("entreforro põe o fundo do item na altura informada", () => {
    const ref = ceilingPlane(def, { ref: "entreforro", level: 2850 }, 10, found);
    const centro = elevationFor(def, ref, 0);
    expect(centro - (def.size[2] / 1000) / 2).toBeCloseTo(12.85);
  });
  it("a referência de teto é salva e reaberta", () => {
    const p = { ...makePoint("difusor-6060", hitAt([4, 4.5, 3], [0, 0, -1])), ceiling: { ref: "entreforro" as const, level: 2850 } };
    const json = JSON.parse(JSON.stringify(serializePoints([p], model.coordinates, null)));
    expect(json.pontos[0].teto).toEqual({ referencia: "entreforro", alturaMm: 2850 });
    expect(deserializePoints(json, model.coordinates)[0].ceiling).toEqual({ ref: "entreforro", level: 2850 });
  });
});

describe("exportação IFC", () => {
  it("formata reais e strings STEP", () => {
    expect(num(3)).toBe("3.");
    expect(num(-0.00001)).toBe("0.");
    expect(num(2.5)).toBe("2.5");
    expect(str("Água d'ar")).toBe("'\\X2\\00C1\\X0\\gua d''ar'");
  });

  it("gera IFC4 válido que reabre com tipos, sistemas, pavimentos e posições", () => {
    const pts: PlacedPoint[] = [
      { ...makePoint("tomada-baixa", hitAt([6.925, 2, 0], [-1, 0, 0])), tag: "T1", params: { Potência: 100, Tensão: 127, Circuito: "C3" } },
      { ...makePoint("lum-embutir-6060", hitAt([2, 1.5, 3], [0, 0, -1])), tag: "L1" },
      { ...makePoint("evaporadora-hiwall", hitAt([6.925, 4, 0], [-1, 0, 0])), tag: "EV1" },
      { ...makePoint("detector-fumaca", hitAt([5, 3, 6], [0, 0, -1])), tag: "DF1", storey: "1º Pavimento" },
    ];
    const text = exportPointsIfc(pts, { modelName: "exemplo-mep.ifc", storeys: model.storeyLevels, cs: model.coordinates });
    const out = loadIfc(api, new TextEncoder().encode(text));
    try {
      expect(out.schema).toBe("IFC4");
      expect(out.storeys).toEqual(["Térreo", "1º Pavimento"]);
      expect(out.elements).toHaveLength(4);
      const byTag = (t: string) => out.elements.find((e) => e.name.startsWith(t + " "))!;
      expect(byTag("T1")).toMatchObject({ ifcType: "IFCOUTLET", discipline: "eletrica", storey: "Térreo", systems: ["Tomadas"], predefinedType: "POWEROUTLET" });
      expect(byTag("DF1")).toMatchObject({ ifcType: "IFCSENSOR", discipline: "incendio", storey: "1º Pavimento" });
      expect(byTag("EV1").discipline).toBe("hvac");

      // Mesmas coordenadas IFC do ponto locado (tolerância de 1 mm).
      for (const p of pts) {
        const el = out.elements.find((e) => e.globalId === p.guid)!;
        const got = out.coordinates.worldToIfc(center(el.bbox!));
        const want = model.coordinates.worldToIfc(p.position);
        got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(0.001));
      }
      // Evaporadora na parede (normal −X): largura de 900 mm ao longo de Y do IFC.
      const ev = out.elements.find((e) => e.name.startsWith("EV1"))!;
      const a = out.coordinates.worldToIfc(ev.bbox!.min);
      const b = out.coordinates.worldToIfc(ev.bbox!.max);
      expect(Math.abs(a[1] - b[1])).toBeCloseTo(0.9, 3);
      expect(Math.abs(a[0] - b[0])).toBeCloseTo(0.22, 3);

      const props = out.getProperties(byTag("T1").expressID)[0];
      expect(props.name).toBe("Pset_MEP_Locacao");
      expect(props.values).toContainEqual({ name: "Circuito", value: "C3" });
      expect(props.values).toContainEqual({ name: "Potência (VA)", value: 100 });
    } finally {
      out.close();
    }
  });
});
