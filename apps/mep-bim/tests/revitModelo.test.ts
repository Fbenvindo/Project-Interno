import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isSebmod, readSebmodBytes, sebmodToData, withNormals, type SebModFile } from "../src/ifc/sebmod";
import { modelFromData } from "../src/ifc/loadIfc";
import { buildPlan } from "../src/core/plan/build";
import { DISCIPLINES } from "../src/core/disciplines";
import { toMap } from "../src/core/georef";

/** Caixa (m) de x0..x1, y0..y1, z0..z1 como malha triangulada. */
function box(id: number, [x0, y0, z0]: number[], [x1, y1, z1]: number[], color = "#cccccc") {
  const p = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { id, posicoes: p, indices: f, paleta: [color], cores: f.filter((_, i) => i % 3 === 0).map(() => 0) };
}

function sample(): SebModFile {
  return {
    formato: "smarteasybim/modelo",
    versao: 1,
    origem: "Revit 2024",
    arquivo: "Casa.rvt",
    unidades: "m",
    local: { leste: 330000, norte: 7390000, cota: 760, eixoX: [1, 0], pontoBase: [0, 0, 0] },
    niveis: [
      { id: 1, nome: "Térreo", cota: 0 },
      { id: 2, nome: "Cobertura", cota: 3 },
    ],
    tipos: [
      {
        id: 10,
        familia: "Porta de abrir",
        nome: "80x210",
        parametros: [{ nome: "Largura", valor: 0.8, texto: "800 mm", unidade: "mm", grupo: "Dimensões" }],
        // Folha aberta e arco (coordenadas da família: dobradiça em x = −0,4, abre para +y).
        planta: [
          [-0.4, 0.075, -0.4, 0.875],
          [0.4, 0.075, 0.2, 0.62, -0.4, 0.875],
        ],
      },
    ],
    malhas: [
      box(1, [0, -0.075, 0], [2, 0.075, 2.8], "#d9d4c7"),
      box(2, [2.8, -0.075, 0], [5, 0.075, 2.8], "#d9d4c7"),
      box(3, [-0.4, -0.075, 0], [0.4, 0.075, 2.1], "#8b5a2b"),
    ],
    elementos: [
      { id: 1001, guid: "0wallGuid0000000000001", categoria: "Paredes", categoriaRevit: "OST_Walls", nome: "Parede básica: Alvenaria 15", nivel: "Térreo", malhas: [{ malha: 1 }, { malha: 2 }], parametros: [{ nome: "Comprimento", valor: 5, texto: "5000" }] },
      {
        id: 1002,
        guid: "0doorGuid0000000000001",
        categoria: "Portas",
        categoriaRevit: "OST_Doors",
        tipo: 10,
        nivel: "Térreo",
        // Instância em x = 2,4 (centro do vão de 2,0 a 2,8), sem rotação.
        malhas: [{ malha: 3, matriz: [1, 0, 0, 0, 1, 0, 0, 0, 1, 2.4, 0, 0] }],
        porta: { origem: [2.4, 0, 0], x: [1, 0, 0], y: [0, 1, 0], matriz: [1, 0, 0, 0, 1, 0, 0, 0, 1, 2.4, 0, 0], hospedeiro: 1001 },
      },
    ],
    ambientes: [{ id: 2001, nome: "Sala", numero: "01", nivel: "Térreo", area: 20, cotaPiso: 0, altura: 2.8, contorno: [0, 0, 5, 0, 5, 4, 0, 4] }],
    eixos: [{ nome: "A", pontos: [0, -1, 0, 5] }],
  };
}

describe("modelo exportado do Revit (.sebmod)", () => {
  it("reconhece o arquivo e lê o gzip", async () => {
    const bytes = new Uint8Array(gzipSync(JSON.stringify(sample())));
    expect(isSebmod("Casa.sebmod", bytes)).toBe(true);
    expect(isSebmod("x.ifc", new TextEncoder().encode("ISO-10303-21;"))).toBe(false);
    const f = await readSebmodBytes(bytes);
    expect(f.elementos).toHaveLength(2);
    await expect(readSebmodBytes(new TextEncoder().encode('{"formato":"outro"}'))).rejects.toThrow();
  });

  it("vira um modelo do app: classes, níveis, propriedades, ambientes e coordenadas", () => {
    const model = modelFromData(sebmodToData(sample()));
    expect(model.elements.map((e) => e.ifcType)).toEqual(["IFCWALL", "IFCDOOR"]);
    const wall = model.elements[0];
    expect(wall.discipline).toBe("arquitetura");
    expect(wall.storey).toBe("Térreo");
    expect(wall.bbox!.max[1]).toBeCloseTo(2.8, 6);
    // Porta: instância colocada pela matriz.
    const door = model.elements[1];
    const ifcMin = model.coordinates.worldToIfc(door.bbox!.min);
    const ifcMax = model.coordinates.worldToIfc(door.bbox!.max);
    expect(Math.min(ifcMin[0], ifcMax[0])).toBeCloseTo(2.0, 6);
    expect(Math.max(ifcMin[0], ifcMax[0])).toBeCloseTo(2.8, 6);
    expect(door.objectType).toBe("Porta de abrir: 80x210");
    expect(door.planSymbol![0]).toEqual([2.0, 0.075, 2.0, 0.875]);
    expect(model.storeyLevels.map((l) => l.level)).toEqual([0, 3]);
    expect(model.spaces[0].area).toBe(20);
    const props = model.getProperties(door.expressID);
    expect(props.find((g) => g.name === "Revit")!.values.find((v) => v.name === "Família")!.value).toBe("Porta de abrir");
    expect(props.some((g) => g.values.some((v) => v.name === "Largura" && v.value === "800 mm"))).toBe(true);
    expect(toMap(model.georef.map!, [1, 2, 0])).toEqual([330001, 7390002, 760]);
  });

  it("3D: normais calculadas (sem elas o modelo fica preto) e quinas vivas", () => {
    const model = modelFromData(sebmodToData(sample()));
    for (const m of model.meshes) {
      expect(m.normals.length).toBe(m.positions.length);
      for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 4);
    }
    // Caixa com 8 vértices compartilhados: 6 faces planas → 24 vértices (4 por face), normais retas.
    const b = box(9, [0, 0, 0], [1, 1, 1]);
    const r = withNormals(Float32Array.from(b.posicoes), Uint32Array.from(b.indices));
    expect(r.positions.length / 3).toBe(24);
    const axis = [...r.normals].map((v) => Math.abs(v)).filter((v) => v > 0.999).length;
    expect(axis).toBe(24);
  });

  it("planta: parede cortada e a porta com o símbolo da família do Revit", () => {
    const model = modelFromData(sebmodToData(sample()));
    const d = buildPlan({
      elements: model.elements,
      meshes: new Map(model.meshes.map((m) => [m.expressID, m])),
      cs: model.coordinates,
      storeyLevels: model.storeyLevels,
      storey: "Térreo",
      cutHeight: 1.2,
      points: [],
      runs: [],
      scale: 50,
      disciplines: new Set(DISCIPLINES.map((x) => x.id)),
      labels: { tags: true, circuits: true, power: true, sizes: true },
    });
    const doorLines = d.prims.filter((p) => p.layer === "ARQ-PORTAS");
    expect(doorLines).toHaveLength(2);
    expect(d.prims.filter((p) => p.layer === "ARQ-CORTE").length).toBeGreaterThanOrEqual(2);
  });

  it("modelo longe da origem é trazido para perto, sem mudar as coordenadas do projeto", () => {
    const f = sample();
    for (const m of f.malhas) m.posicoes = m.posicoes.map((v, i) => (i % 3 === 0 ? v + 500_000 : i % 3 === 1 ? v + 7_000_000 : v));
    f.elementos[1].malhas![0].matriz![9] += 500_000;
    f.elementos[1].malhas![0].matriz![10] += 7_000_000;
    const model = modelFromData(sebmodToData(f));
    const b = model.elements[0].bbox!;
    expect(Math.abs(b.min[0])).toBeLessThan(2000);
    expect(model.coordinates.worldToIfc(b.min)[0]).toBeCloseTo(500_000, 3);
  });
});
