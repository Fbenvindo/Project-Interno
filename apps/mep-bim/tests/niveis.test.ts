import { describe, expect, it } from "vitest";
import { ceilingBase, floorSubLevels, planRangeOf } from "../src/core/plan/levels";
import { floorPlanOf } from "../src/core/views";
import type { ElementInfo } from "../src/core/types";

const slab = (id: number, storey: string, x: [number, number], z: [number, number], y: [number, number]): ElementInfo =>
  ({ expressID: id, globalId: "", ifcType: "IFCSLAB", name: "Laje", objectType: null, predefinedType: null, typeObjectName: null, storey, systems: [], discipline: "estrutura", category: "outro", bbox: { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] }, length: null, size: null }) as ElementInfo;

const levels = [
  { name: "Térreo", level: 0 },
  { name: "1º", level: 3 },
];

describe("níveis das plantas de pavimento", () => {
  it("um nível de laje: o do pavimento; teto na face inferior da laje de cima", () => {
    const els = [slab(1, "Térreo", [0, 10], [0, 10], [-0.15, 0]), slab(2, "1º", [0, 10], [0, 10], [2.88, 3])];
    expect(floorSubLevels(els, levels, "Térreo")).toEqual([0]);
    expect(ceilingBase(els, levels, "Térreo", 0)).toBeCloseTo(2.88);
  });

  it("lajes em níveis diferentes no mesmo pavimento viram plantas separadas", () => {
    const els = [slab(1, "Térreo", [0, 10], [0, 10], [-0.15, 0]), slab(3, "Térreo", [10, 16], [0, 6], [0.3, 0.45]), slab(4, "Térreo", [0, 0.5], [0, 0.5], [0.2, 0.25])];
    // A laje pequena (0,25 m²) não define nível.
    expect(floorSubLevels(els, levels, "Térreo")).toEqual([0, 0.45]);
    const v = floorPlanOf([], "trabalho", "piso", "Térreo", 1);
    expect(planRangeOf(v, els, levels)).toEqual({ type: "piso", base: 0.45, below: 1, above: 1.5 });
  });

  it("pavimentos em par (osso e piso acabado, a poucos cm): o de cima é o próximo andar", () => {
    const lv = [
      { name: "Térreo - osso", level: -0.1 },
      { name: "Térreo - acabado", level: 0 },
      { name: "1º - osso", level: 4.4 },
      { name: "1º - acabado", level: 4.5 },
    ];
    const els = [slab(1, "1º - osso", [0, 10], [0, 10], [4.25, 4.4])];
    expect(ceilingBase(els, lv, "Térreo - osso", -0.1)).toBeCloseTo(4.25);
    expect(ceilingBase(els, lv, "Térreo - acabado", 0)).toBeCloseTo(4.25);
    // Sem laje modelada: o próximo andar (não o par a 10 cm).
    expect(ceilingBase([], lv, "Térreo - osso", -0.1)).toBeCloseTo(4.4 - 0.12);
  });

  it("sem laje de cima: o nível do pavimento de cima", () => {
    const v = floorPlanOf([], "documentacao", "teto", "Térreo");
    expect(planRangeOf(v, [], levels)).toEqual({ type: "teto", base: 3 - 0.12, below: 1.5, above: 0.2 });
  });
});

describe("planta de piso × planta de teto no modelo de exemplo", () => {
  it("luminárias só na de teto; tomadas só na de piso", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { IfcAPI } = await import("web-ifc");
    const { loadIfc } = await import("../src/ifc/loadIfc");
    const { buildPlan } = await import("../src/core/plan/build");
    const api = new IfcAPI();
    await api.Init();
    const model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-mep.ifc"))));
    const meshes = new Map(model.meshes.map((m) => [m.expressID, m]));
    const storey = model.storeys[0];
    const ids = (type: "piso" | "teto") => {
      const v = floorPlanOf([], "trabalho", type, storey);
      const d = buildPlan({ elements: model.elements, meshes, cs: model.coordinates, storeyLevels: model.storeyLevels, storey, cutHeight: 1.2, points: [], runs: [], scale: 50, disciplines: new Set(["arquitetura", "estrutura", "eletrica", "hidraulica", "hvac", "incendio", "telecom", "gas", "outros"] as never), labels: { tags: true, circuits: true, power: true, sizes: true }, range: planRangeOf(v, model.elements, model.storeyLevels) });
      return new Set(d.prims.map((p) => p.id).filter((x): x is number => typeof x === "number"));
    };
    const piso = ids("piso");
    const teto = ids("teto");
    const of = (t: string) => model.elements.filter((e) => e.ifcType === t && e.storey === storey).map((e) => e.expressID);
    const lights = of("IFCLIGHTFIXTURE");
    const outlets = of("IFCOUTLET");
    expect(lights.length && outlets.length).toBeTruthy();
    expect(lights.every((id) => teto.has(id) && !piso.has(id))).toBe(true);
    expect(outlets.every((id) => piso.has(id) && !teto.has(id))).toBe(true);
  });
});

describe("projeção de cima (mobiliário)", () => {
  it("mesa: o contorno do tampo aparece (o corte na meia altura só pegava os pés)", async () => {
    const { topOutline, cutMesh, chainSegments } = await import("../src/core/plan/section");
    // Caixa (cena, Y para cima) com faces por vértices próprios, como as do IFC.
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
      const pos: number[] = [];
      const idx: number[] = [];
      for (const f of faces) {
        const b = pos.length / 3;
        for (const k of f) pos.push(...c[k]);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      return { pos, idx };
    };
    const parts = [box(0, 1.6, 0.72, 0.75, 0, 0.8), box(0.05, 0.1, 0, 0.72, 0.05, 0.1), box(1.5, 1.55, 0, 0.72, 0.05, 0.1), box(0.05, 0.1, 0, 0.72, 0.7, 0.75), box(1.5, 1.55, 0, 0.72, 0.7, 0.75)];
    const pos: number[] = [];
    const idx: number[] = [];
    for (const p of parts) {
      const b = pos.length / 3;
      pos.push(...p.pos);
      idx.push(...p.idx.map((i) => i + b));
    }
    const P = new Float32Array(pos);
    const I = new Uint32Array(idx);
    const mid = cutMesh(P, I, 0.375);
    const xs = (segs: { a: number[]; b: number[] }[]) => segs.flatMap((s) => [s.a[0], s.b[0]]);
    expect(Math.max(...xs(mid)) - Math.min(...xs(mid))).toBeLessThan(1.6); // só os pés
    const top = topOutline(P, I);
    const chains = chainSegments(top.map((s) => [[s.a[0], s.a[2]], [s.b[0], s.b[2]]] as [[number, number], [number, number]]), 1e-3);
    // O tampo (1,60 × 0,80) aparece como um contorno fechado.
    const tampo = chains.find((c) => c.closed && Math.max(...c.points.map((p) => p[0])) - Math.min(...c.points.map((p) => p[0])) > 1.55);
    expect(tampo).toBeTruthy();
  });
});

describe("portas: arco só nas que abrem", () => {
  it("venezianas, janelas e portas elevadas ficam sem arco; o usuário decide", async () => {
    const { isSwingDoor } = await import("../src/core/plan/build");
    const d = (name: string, minY = 0) => ({ expressID: 1, globalId: "g", ifcType: "IFCDOOR", name, objectType: null, predefinedType: null, storey: "T", systems: [], discipline: "arquitetura", category: "outro", bbox: { min: [0, minY, 0], max: [1, minY + 2.1, 0.2] }, length: null, size: null }) as never;
    expect(isSwingDoor(d("Porta de giro 80x210"), 0)).toBe(true);
    expect(isSwingDoor(d("OCA_POR_ABRIR 2 FOLHAS VENEZIANAS:1,20 x 2,50m"), 0)).toBe(true);
    expect(isSwingDoor(d("Veneziana fachada 120"), 0)).toBe(false);
    expect(isSwingDoor(d("Janela de correr"), 0)).toBe(false);
    expect(isSwingDoor(d("Porta alta", 1.1), 0)).toBe(false);
    expect(isSwingDoor(d("Veneziana fachada 120"), 0, { force: true })).toBe(true);
    expect(isSwingDoor(d("Porta de giro 80x210"), 0, { none: true })).toBe(false);
  });
});

describe("projeção vista de cima com linhas ocultas", () => {
  it("só o tampo da mesa aparece; a cadeira some onde fica embaixo da mesa", async () => {
    const { visibleTopEdges } = await import("../src/core/plan/projection");
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
      const pos: number[] = [];
      const idx: number[] = [];
      for (const f of faces) {
        const b = pos.length / 3;
        for (const k of f) pos.push(...c[k]);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      return { pos, idx };
    };
    const merge = (parts: { pos: number[]; idx: number[] }[]) => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (const p of parts) {
        const b = pos.length / 3;
        pos.push(...p.pos);
        idx.push(...p.idx.map((i) => i + b));
      }
      return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
    };
    const mesa = merge([box(0, 1.6, 0.72, 0.75, 0, 0.8), box(0.05, 0.1, 0, 0.72, 0.05, 0.1), box(1.5, 1.55, 0, 0.72, 0.05, 0.1), box(0.05, 0.1, 0, 0.72, 0.7, 0.75), box(1.5, 1.55, 0, 0.72, 0.7, 0.75)]);
    // Assento da cadeira (0,45 m): metade sob a mesa (z de 0,5 a 1,1; a mesa vai até 0,8).
    const cadeira = merge([box(0.6, 1.0, 0.42, 0.45, 0.5, 1.1)]);
    const vis = visibleTopEdges([
      { id: 1, ...mesa },
      { id: 2, ...cadeira },
    ]);
    const m = vis.get(1)!;
    expect(m.length).toBeGreaterThan(0);
    // Nada da mesa abaixo do tampo (pés, face de baixo do tampo).
    expect(m.every((s) => Math.min(s.a[1], s.b[1]) > 0.74)).toBe(true);
    // Cadeira: só a parte fora da mesa (z > 0,8).
    const c = vis.get(2)!;
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((s) => Math.min(s.a[2], s.b[2]) > 0.78)).toBe(true);
  });
});
