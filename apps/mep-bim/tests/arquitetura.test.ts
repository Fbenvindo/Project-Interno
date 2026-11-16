import { describe, expect, it } from "vitest";
import {
  archElementId,
  archIdOf,
  archQuantities,
  buildArch,
  newArch,
  readArch,
  copyArch,
  moveArch,
  removeArch,
  signedArea,
  triangulate,
  wallAt,
  wallFootprints,
  worldMesh,
  writeArch,
  type ArchElement,
  type Opening,
  type Slab,
  type Wall,
} from "../src/core/arch";
import { CoordinateSystem } from "../src/core/math";
import { DISCIPLINES } from "../src/core/disciplines";
import { buildPlan } from "../src/core/plan/build";
import type { Prim } from "../src/core/plan/drawing";
import { polygonArea } from "../src/core/plan/section";
import { exportPointsIfc } from "../src/core/ifcExport";
import { IfcAPI } from "web-ifc";
import { loadIfc } from "../src/ifc/loadIfc";

const cs = new CoordinateSystem();
const wall = (a: [number, number], b: [number, number], t = 0.15): Wall =>
  newArch<Wall>({ kind: "parede", storey: "T", name: "Alvenaria", a, b, base: 0, height: 2.8, thickness: t });

describe("arquitetura e estrutura modeladas no app", () => {
  it("ids próprios da cena", () => {
    expect(archIdOf(archElementId(7))).toBe(7);
    expect(archIdOf(-5)).toBeNull();
    expect(archIdOf(-850_001)).toBeNull();
    expect(archIdOf(-1_000_000)).toBeNull();
  });

  it("canto em L em esquadria (sem fresta nem sobreposição)", () => {
    const w1 = wall([0, 0], [4, 0]);
    const w2 = wall([4, 0], [4, 3]);
    const fp = wallFootprints([w1, w2]);
    const f1 = fp.get(w1.id)!;
    const f2 = fp.get(w2.id)!;
    // Lado de fora (direita de w1, y = −0,075) vai até x = 4,075; o de dentro para em 3,925.
    expect(f1.er[0]).toBeCloseTo(4.075, 6);
    expect(f1.er[1]).toBeCloseTo(-0.075, 6);
    expect(f1.el[0]).toBeCloseTo(3.925, 6);
    // A segunda parede começa nos mesmos cantos.
    expect(f2.sr[0]).toBeCloseTo(4.075, 6);
    expect(f2.sr[1]).toBeCloseTo(-0.075, 6);
    expect(f2.sl[0]).toBeCloseTo(3.925, 6);
    expect(f2.sl[1]).toBeCloseTo(0.075, 6);
  });

  it("encontro em T termina na face da outra parede", () => {
    const host = wall([0, 0], [6, 0], 0.2);
    const t = wall([3, 0], [3, 4]);
    const f = wallFootprints([host, t]).get(t.id)!;
    expect(f.sl[1]).toBeCloseTo(0.1, 6);
    expect(f.sr[1]).toBeCloseTo(0.1, 6);
  });

  it("triangula polígonos côncavos (laje em L)", () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    const tris = triangulate(L);
    expect(tris).toHaveLength(4);
    const area = tris.reduce((s, [a, b, c]) => s + signedArea([L[a], L[b], L[c]]), 0);
    expect(area).toBeCloseTo(12, 6);
  });

  it("porta e janela abrem vão na parede e descontam a área", () => {
    const w = wall([0, 0], [5, 0]);
    const door = newArch<Opening>({ kind: "porta", storey: "T", name: "Porta de madeira", host: w.guid, offset: 1, width: 0.8, height: 2.1, sill: 0 });
    const win = newArch<Opening>({ kind: "janela", storey: "T", name: "Janela de correr", host: w.guid, offset: 3.5, width: 1.2, height: 1.2, sill: 1.1 });
    const all: ArchElement[] = [w, door, win];
    const q = archQuantities(w, all);
    expect(q.area).toBeCloseTo(5 * 2.8 - 0.8 * 2.1 - 1.2 * 1.2, 6);
    const pieces = buildArch(all, cs);
    expect(pieces.map((p) => p.info.ifcType)).toEqual(["IFCWALL", "IFCDOOR", "IFCWINDOW"]);
    const d = pieces[1].info;
    expect(d.frame).toBeDefined();
    expect(d.operation).toBe("SINGLE_SWING_LEFT");
    expect(d.discipline).toBe("arquitetura");
    // Malha da parede: 3 trechos cheios + 1 abaixo da janela + 2 acima dos vãos = 6 prismas.
    expect(pieces[0].mesh.indices.length / 3).toBe(6 * 12);
    const m = worldMesh(pieces[0], cs);
    expect(m.positions.length).toBe(m.normals.length);

    // Planta: parede cortada em dois trechos no vão da porta e arco de abertura.
    const meshes = new Map(pieces.map((p) => [p.info.expressID, worldMesh(p, cs)]));
    const plan = buildPlan({
      elements: pieces.map((p) => p.info),
      meshes,
      cs,
      storeyLevels: [{ name: "T", level: 0 }],
      storey: "T",
      cutHeight: 1.2,
      points: [],
      runs: [],
      scale: 50,
      disciplines: new Set(DISCIPLINES.map((x) => x.id)),
      labels: { tags: true, circuits: true, power: true, sizes: true },
    });
    const cut = plan.prims.filter((p): p is Extract<Prim, { t: "poly" }> => p.t === "poly" && p.layer === "ARQ-CORTE" && p.id === archElementId(w.id));
    expect(cut.length).toBe(3);
    expect(cut.reduce((s, p) => s + Math.abs(polygonArea(p.pts)), 0)).toBeCloseTo((5 - 0.8 - 1.2) * 0.15, 3);
    expect(plan.prims.some((p) => p.layer === "ARQ-PORTAS")).toBe(true);
    // Remover a parede leva junto as aberturas.
    expect(removeArch(all, new Set([w.id]))).toHaveLength(0);
  });

  it("laje, pilar e viga vão para a estrutura", () => {
    const slab = newArch<Slab>({ kind: "laje", storey: "T", name: "Laje maciça", outline: [[0, 0], [5, 0], [5, 4], [0, 4]], top: 3, thickness: 0.12 });
    const pieces = buildArch([slab], cs);
    expect(pieces[0].info.discipline).toBe("estrutura");
    expect(pieces[0].info.bbox!.max[1]).toBeCloseTo(3, 6);
    expect(archQuantities(slab, [slab]).volume).toBeCloseTo(20 * 0.12, 6);
  });

  it("acha a parede sob o cursor e grava/lê o projeto", () => {
    const w = wall([0, 0], [5, 0]);
    expect(wallAt([w], [2, 0.2])?.offset).toBeCloseTo(2, 6);
    expect(wallAt([w], [2, 0.2])?.side).toBe(1);
    expect(wallAt([w], [2, 1])).toBeNull();
    const back = readArch(JSON.parse(JSON.stringify(writeArch([w]))));
    expect(back[0].guid).toBe(w.guid);
    expect((back[0] as Wall).thickness).toBe(0.15);
  });

  it("mover e copiar: aberturas acompanham a parede ou deslizam nela", () => {
    const w = wall([0, 0], [5, 0]);
    const door = newArch<Opening>({ kind: "porta", storey: "T", name: "Porta", host: w.guid, offset: 1, width: 0.8, height: 2.1, sill: 0 });
    const moved = moveArch(door, [0.5, 3], [w, door]) as Opening;
    expect(moved.offset).toBeCloseTo(1.5, 6); // só a parte ao longo da parede
    const c = copyArch([w, door], [w, door], [0, 4], 3, "1º Pavimento");
    expect(c.added).toHaveLength(2);
    const cw = c.added.find((e) => e.kind === "parede") as Wall;
    const cd = c.added.find((e) => e.kind === "porta") as Opening;
    expect(cd.host).toBe(cw.guid);
    expect(cw.a[1]).toBeCloseTo(4, 6);
    expect(cw.base).toBeCloseTo(3, 6);
    expect(cw.storey).toBe("1º Pavimento");
    expect(cw.guid).not.toBe(w.guid);
  });

  it("exporta para IFC com as classes certas", () => {
    const w = wall([0, 0], [5, 0]);
    const door = newArch<Opening>({ kind: "porta", storey: "T", name: "Porta", host: w.guid, offset: 1, width: 0.8, height: 2.1, sill: 0 });
    const ifc = exportPointsIfc([], { modelName: "x", storeys: [{ name: "T", level: 0 }], cs, arch: [w, door] });
    expect(ifc).toMatch(/IFCWALL\('/);
    expect(ifc).toMatch(/IFCDOOR\('/);
    expect(ifc).toMatch(/IFCTRIANGULATEDFACESET/);
  });

  it("o IFC exportado abre de novo com as paredes e portas", async () => {
    const w = wall([0, 0], [5, 0]);
    const door = newArch<Opening>({ kind: "porta", storey: "T", name: "Porta", host: w.guid, offset: 1, width: 0.8, height: 2.1, sill: 0 });
    const ifc = exportPointsIfc([], { modelName: "x", storeys: [{ name: "T", level: 0 }], cs, arch: [w, door] });
    const api = new IfcAPI();
    await api.Init();
    const m = loadIfc(api, new TextEncoder().encode(ifc));
    const types = m.elements.map((e) => e.ifcType).sort();
    expect(types).toEqual(["IFCDOOR", "IFCWALL"]);
    expect(m.meshes.every((x) => x.indices.length > 0)).toBe(true);
    const wallEl = m.elements.find((e) => e.ifcType === "IFCWALL")!;
    expect(wallEl.bbox!.max[0] - wallEl.bbox!.min[0]).toBeCloseTo(5, 2);
  });
});
