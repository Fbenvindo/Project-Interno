import { describe, expect, it } from "vitest";
import { sebmodToData, type SebModFile } from "../src/ifc/sebmod";
import { modelFromData } from "../src/ifc/loadIfc";
import { buildPlan } from "../src/core/plan/build";
import { DISCIPLINES } from "../src/core/disciplines";
import { isLayoutElement, LAYOUT_GRAY } from "../src/core/plan/style";
import type { ElementInfo } from "../src/core/types";

function box(id: number, [x0, y0, z0]: number[], [x1, y1, z1]: number[]) {
  const p = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { id, posicoes: p, indices: f, paleta: ["#cccccc"] };
}

function plan(f: SebModFile) {
  const model = modelFromData(sebmodToData(f));
  const d = buildPlan({
    elements: model.elements,
    meshes: new Map(model.meshes.map((m) => [m.expressID, m])),
    cs: model.coordinates,
    storeyLevels: model.storeyLevels,
    storey: "T",
    cutHeight: 1.5,
    points: [],
    runs: [],
    scale: 50,
    disciplines: new Set(DISCIPLINES.map((x) => x.id)),
    labels: { tags: true, circuits: true, power: true, sizes: true },
    range: { type: "piso", base: 0, below: 1, above: 1.5 },
  });
  return { model, d };
}

const file = (elementos: SebModFile["elementos"], malhas: SebModFile["malhas"], tipos: SebModFile["tipos"] = []): SebModFile => ({
  formato: "smarteasybim/modelo",
  versao: 1,
  niveis: [{ id: 1, nome: "T", cota: 0 }, { id: 2, nome: "S", cota: 3 }],
  tipos,
  malhas,
  elementos,
});

describe("layout nas plantas", () => {
  it("louça exportada como elemento genérico é layout (cinza), não rede de hidráulica", () => {
    const e = { ifcType: "IFCBUILDINGELEMENTPROXY", name: "Cuba de embutir oval", objectType: null, typeObjectName: null } as unknown as ElementInfo;
    expect(isLayoutElement(e)).toBe(true);
    expect(isLayoutElement({ ...e, name: "Caixa de passagem" })).toBe(false);
    expect(isLayoutElement({ ...e, ifcType: "IFCSANITARYTERMINAL", name: "x" })).toBe(true);
    const { d } = plan(file([{ id: 1, categoria: "Peças hidráulicas", categoriaRevit: "OST_PlumbingFixtures", nivel: "T", malhas: [{ malha: 0 }], sistemas: ["Água fria"] }], [box(0, [0, 0, 0.6], [0.5, 0.4, 0.85])]));
    const lines = d.prims.filter((p) => p.id === 1);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((p) => p.color === LAYOUT_GRAY && p.layer === "ARQ-LAYOUT")).toBe(true);
  });

  it("móvel que atravessa o plano de corte aparece inteiro (vista de cima), não só o recorte", () => {
    // Cama: colchão até 0,5 m e cabeceira até 1,8 m (atravessa o corte a 1,5 m).
    const { d } = plan(
      file([{ id: 2, categoria: "Mobiliário", categoriaRevit: "OST_Furniture", nivel: "T", malhas: [{ malha: 0 }, { malha: 1 }] }], [box(0, [0, 0, 0], [1.6, 2, 0.5]), box(1, [0, 0, 0], [1.6, 0.1, 1.8])]),
    );
    const pts = d.prims.filter((p) => p.id === 1).flatMap((p) => (p.t === "poly" ? p.pts : p.t === "line" ? [p.a, p.b] : []));
    // O colchão (y até 2 m) aparece; só o corte da cabeceira ficaria em y ≤ 0,1.
    expect(Math.max(...pts.map((q) => q[1]))).toBeCloseTo(2, 3);
  });

  it("família só com símbolo de planta: desenha o símbolo e não o 3D", () => {
    const tipos = [{ id: 7, familia: "Sofá", nome: "3 lugares", planta: [[0, 0, 2, 0, 2, 0.9, 0, 0.9, 0, 0]], solidosEmPlanta: false }];
    const { d } = plan(file([{ id: 3, categoria: "Mobiliário", categoriaRevit: "OST_Furniture", nivel: "T", tipo: 7, malhas: [{ malha: 0 }], matriz: [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 5, 0] }], [box(0, [10, 5, 0], [12, 5.9, 0.8])], tipos));
    const mine = d.prims.filter((p) => p.id === 1);
    expect(mine).toHaveLength(1);
    expect(mine[0].t === "poly" && mine[0].pts[2]).toEqual([12, 5.9]);
  });
});
