import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import type { Prim } from "../src/core/plan/drawing";
import { buildSection } from "../src/core/plan/elevation";
import { renderSheetViews } from "../src/core/plan/sheet";
import { deserializeProject, serializeProject } from "../src/core/project";
import { CoordinateSystem } from "../src/core/math";
import { viewDrawing } from "../src/core/viewDrawing";
import {
  applyHalftone,
  clipPrims,
  docPlanOf,
  migrateViews,
  nextViewName,
  viewFilter,
  viewMarkers,
  type ViewDef,
} from "../src/core/views";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

const line = (layer: string, a: [number, number], b: [number, number]): Prim => ({ t: "line", a, b, weight: 0.25, layer, color: "#d35400" });

describe("vistas: trabalho e documentação", () => {
  it("trabalho mostra tudo; documentação só as disciplinas do projeto e as de referência em meio-tom", () => {
    const work = viewFilter(null, ["eletrica"]);
    expect(work.show.has("hidraulica")).toBe(true);
    const doc = docPlanOf([], "Térreo");
    expect(doc.section).toBe("documentacao");
    const f = viewFilter({ ...doc, refDisciplines: ["hidraulica"] }, ["eletrica"]);
    expect([...f.show].sort()).toEqual(["arquitetura", "eletrica", "estrutura", "hidraulica", "outros"]);
    expect(f.show.has("hvac")).toBe(false);
    const out = applyHalftone([line("ELE-TRECHOS", [0, 0], [1, 0]), line("HID-TRECHOS", [0, 0], [1, 0]), line("ARQ-CORTE", [0, 0], [1, 0])], f);
    expect(out.map((p) => p.color)).toEqual(["#d35400", "#9aa0a6", "#8c8c8c"]);
    // Sem disciplinas definidas: todas as de instalações são do projeto.
    expect(viewFilter(doc, []).show.has("hvac")).toBe(true);
  });

  it("recorta linhas e hachuras na área da ampliação", () => {
    const r = { min: [0, 0] as [number, number], max: [2, 2] as [number, number] };
    const out = clipPrims(
      [
        line("ELE-TRECHOS", [-1, 1], [3, 1]),
        line("ELE-TRECHOS", [5, 5], [6, 6]),
        { t: "poly", pts: [[1, 1], [4, 1], [4, 3], [1, 3]], closed: true, fill: "#aaa", weight: 0.35, layer: "ARQ-CORTE", color: "#222" },
      ],
      r,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ a: [0, 1], b: [2, 1] });
    const poly = out[1] as Extract<Prim, { t: "poly" }>;
    expect(poly.pts.every(([x, y]) => x >= 0 && x <= 2 && y >= 0 && y <= 2)).toBe(true);
  });

  it("marca ampliações e cortes de documentação na planta e numera os cortes", () => {
    const views: ViewDef[] = [
      { id: "a", name: "Ampliação 1 — Térreo", kind: "ampliacao", section: "documentacao", storey: "Térreo", scale: 25, region: { min: [0, 0], max: [2, 2] } },
      { id: "c", name: "Corte A", kind: "corte", section: "documentacao", storey: "Térreo", scale: 50, cut: { a: [0, 0], b: [5, 0], side: 1, depth: 4 } },
      { id: "w", name: "Corte B", kind: "corte", section: "trabalho", storey: "Térreo", scale: 50, cut: { a: [0, 0], b: [5, 0], side: 1, depth: 4 } },
    ];
    const marks = viewMarkers(views, "Térreo", 50);
    expect(marks.filter((p) => p.t === "text").map((p) => (p as { text: string }).text)).toEqual(["Ampliação 1 — Térreo", "A", "A"]);
    expect(nextViewName(views, "corte")).toBe("Corte C");
  });

  it("lê vistas 3D de arquivos antigos e grava folhas e disciplinas no projeto", () => {
    expect(migrateViews([{ id: "v1", name: "Vista", eye: [0, 1, 0], target: [1, 1, 0] }])[0]).toMatchObject({ kind: "3d", section: "trabalho" });
    const cs = new CoordinateSystem();
    const file = serializeProject(
      {
        points: [],
        runs: [],
        circuits: [],
        views: [docPlanOf([], "Térreo")],
        sheets: [{ id: "f1", name: "ELE-01", format: "A1", titleBlockId: null, info: { projeto: "", conteudo: "", responsavel: "", data: "", folha: "", revisao: "" }, viewports: [{ viewId: "doc-planta:Térreo" }] }],
        disciplines: ["eletrica"],
        links: [{ id: "l1", name: "arq.ifc", path: null, discipline: "auto", visible: true, translucent: false, align: { mode: "manual", dx: 1, dy: 2, dz: 0, rotDeg: 0 } }],
      },
      cs,
      "m.ifc",
    );
    const back = deserializeProject(JSON.parse(JSON.stringify(file)), cs);
    expect(back.sheets?.[0].viewports[0].viewId).toBe("doc-planta:Térreo");
    expect(back.disciplines).toEqual(["eletrica"]);
    expect(back.views?.[0].section).toBe("documentacao");
    expect(back.links?.[0].align).toMatchObject({ mode: "manual", dx: 1 });
  });

  it("monta folha com várias vistas lado a lado e escala 'indicadas'", () => {
    const d = (scale: number) => ({ prims: [line("ELE-TRECHOS", [0, 0], [4, 2])], bounds: { min: [0, 0] as [number, number], max: [4, 2] as [number, number] }, legend: [], scale, storey: "T", cutHeight: 1.2 });
    const r = renderSheetViews(
      [
        { id: "p", title: "PLANTA", drawing: d(50) },
        { id: "a", title: "AMPLIAÇÃO", drawing: d(25) },
      ],
      "A1",
      { projeto: "P", conteudo: "", responsavel: "", data: "", folha: "", revisao: "" },
    );
    expect(r.viewports).toHaveLength(2);
    expect(r.viewports[1].x).toBeGreaterThan(r.viewports[0].x + r.viewports[0].w);
    expect(r.viewports[1].w).toBeCloseTo(160);
    expect(r.svg).toContain("INDICADAS");
    expect(r.svg).toContain('data-vp="a"');
  });
});

describe("corte vertical no modelo de exemplo", () => {
  let model: LoadedModel;
  beforeAll(async () => {
    const api = new IfcAPI();
    await api.Init();
    model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-apartamento.ifc"))));
  });

  it("corta paredes e lajes (hachura) e mostra os níveis", () => {
    const bb = model.elements.filter((e) => e.bbox).reduce(
      (acc, e) => {
        const a = model.coordinates.worldToIfc(e.bbox!.min);
        const b = model.coordinates.worldToIfc(e.bbox!.max);
        return { minX: Math.min(acc.minX, a[0], b[0]), maxX: Math.max(acc.maxX, a[0], b[0]), minY: Math.min(acc.minY, a[1], b[1]), maxY: Math.max(acc.maxY, a[1], b[1]) };
      },
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    const y = (bb.minY + bb.maxY) / 2;
    const meshes = new Map(model.meshes.map((m) => [m.expressID, m]));
    const d = buildSection({
      elements: model.elements,
      meshes,
      cs: model.coordinates,
      storeyLevels: model.storeyLevels,
      points: [],
      runs: [],
      disciplines: new Set(["arquitetura", "estrutura", "outros"]),
      cut: { a: [bb.minX - 1, y], b: [bb.maxX + 1, y], side: 1, depth: 10 },
      scale: 50,
      name: "Corte A",
    });
    const cut = d.prims.filter((p) => p.layer.endsWith("-CORTE") && p.t === "poly" && p.fill);
    expect(cut.length).toBeGreaterThan(2);
    expect(d.prims.some((p) => p.layer.endsWith("-VISTA"))).toBe(true);
    const levels = d.prims.filter((p) => p.layer === "ANOT-NIVEIS" && p.t === "text");
    expect(levels).toHaveLength(model.storeyLevels.length);
    // Cotas verticais em metros do IFC: tudo entre o piso e alguns metros acima.
    expect(d.bounds!.max[1] - d.bounds!.min[1]).toBeLessThan(15);

    const view: ViewDef = { id: "c1", name: "Corte A", kind: "corte", section: "documentacao", scale: 50, cut: { a: [bb.minX - 1, y], b: [bb.maxX + 1, y], side: 1, depth: 10 } };
    const vd = viewDrawing(view, {
      elements: model.elements,
      meshes,
      cs: model.coordinates,
      storeyLevels: model.storeyLevels,
      points: [],
      runs: [],
      drafts: [{ id: -800_500, storey: "", view: "c1", kind: "texto", p: [1, 1], text: "NOTA", size: 2.5, rot: 0 }],
      views: [view],
      projectDisciplines: ["eletrica"],
    });
    expect(vd!.prims.some((p) => p.t === "text" && p.text === "NOTA")).toBe(true);
    // Documentação: fundo em meio-tom.
    expect(vd!.prims.filter((p) => p.layer === "ARQ-CORTE").every((p) => p.color === "#8c8c8c")).toBe(true);
  });
});
