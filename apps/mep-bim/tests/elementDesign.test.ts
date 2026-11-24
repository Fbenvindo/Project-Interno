import { describe, expect, it } from "vitest";
import { checkDesign, designComponent, designMesh, newDesign, profilePolygon, triangulate, type DesignSolid } from "../src/core/elementDesign";
import { COMPONENT_BY_ID } from "../src/core/library";

const box = (vista: DesignSolid["vista"], x0: number, y0: number, x1: number, y1: number, de: number, ate: number): DesignSolid => ({
  id: Math.random().toString(36),
  vista,
  perfil: { t: "ret", x0, y0, x1, y1 },
  de,
  ate,
  cor: "#808080",
});

function volume(m: { positions: Float32Array; indices: Uint32Array }) {
  const p = m.positions;
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

describe("elementos criados no app", () => {
  it("extrusão de retângulo em cada vista dá o volume e o tamanho certos, com faces para fora", () => {
    for (const vista of ["planta", "frente", "lateral"] as const) {
      const r = designMesh([box(vista, 0, 0, 200, 100, 0, 50)])!;
      expect(volume(r.mesh)).toBeCloseTo(200 * 100 * 50, -1);
      const dims = [...r.size].sort((a, b) => a - b);
      expect(dims).toEqual([50, 100, 200]);
    }
    // Planta: perfil X×Z, extrusão em Y (altura).
    expect(designMesh([box("planta", 0, 0, 200, 100, 0, 50)])!.size).toEqual([200, 100, 50]);
    // Frente: X×Y, extrusão em Z (profundidade).
    expect(designMesh([box("frente", 0, 0, 200, 100, 0, 50)])!.size).toEqual([200, 50, 100]);
  });

  it("polígono côncavo (L) é triangulado sem sobras", () => {
    const L: [number, number][] = [
      [0, 0],
      [300, 0],
      [300, 100],
      [100, 100],
      [100, 300],
      [0, 300],
    ];
    const t = triangulate(profilePolygon({ t: "poli", pts: L }));
    expect(t.length).toBe(4 * 3);
    const r = designMesh([{ id: "a", vista: "planta", perfil: { t: "poli", pts: L }, de: 0, ate: 10, cor: "#ff0000" }])!;
    expect(volume(r.mesh)).toBeCloseTo(50000 * 10, -1);
    expect(r.mesh.triColors![0]).toBe(255);
  });

  it("círculo e polígono desenhado no sentido horário também ficam fechados", () => {
    const c = designMesh([{ id: "c", vista: "frente", perfil: { t: "circ", cx: 0, cy: 0, r: 100 }, de: 0, ate: 20, cor: "#000000" }])!;
    expect(volume(c.mesh)).toBeGreaterThan(0.98 * Math.PI * 100 * 100 * 20 * 0.99);
    const cw: [number, number][] = [
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 0],
    ];
    const r = designMesh([{ id: "p", vista: "lateral", perfil: { t: "poli", pts: cw }, de: 0, ate: 10, cor: "#000000" }])!;
    expect(volume(r.mesh)).toBeCloseTo(100000, -1);
  });

  it("vira componente de malha, centrado, com símbolo de planta e parâmetros da base", () => {
    const d = newDesign(COMPONENT_BY_ID["tomada-media"], "x1");
    d.label = "Tomada especial";
    d.solids = [box("frente", -50, 0, 50, 120, 0, 40)];
    d.params.push({ name: "Grau de proteção", default: "IP44" });
    const c = designComponent(d);
    expect(c.shape).toBe("malha");
    expect(c.size).toEqual([100, 40, 120]);
    expect(c.mounting).toBe("parede");
    expect(c.ifcType).toBe("IFCOUTLET");
    expect(c.params.map((p) => p.name)).toContain("Grau de proteção");
    expect(c.params.map((p) => p.name)).toContain("Potência");
    // Contorno de planta centrado: x de −50 a 50, z de −20 a 20.
    const xs = c.planLines![0].map((q) => q[0]);
    const zs = c.planLines![0].map((q) => q[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]).toEqual([-50, 50, -20, 20]);
    expect(c.source?.kind).toBe("proprio");
  });

  it("aponta o que falta antes de salvar", () => {
    const d = newDesign(undefined, "x2");
    expect(checkDesign(d).map((p) => p.text).join(" ")).toMatch(/nome.*sólido/);
    d.label = "Caixa";
    d.solids = [box("planta", 0, 0, 100, 100, 0, 0)];
    d.params = [{ name: "A", default: 1 }, { name: "a", default: 2 }];
    const t = checkDesign(d).map((p) => p.text).join(" ");
    expect(t).toMatch(/sem espessura/);
    expect(t).toMatch(/repetido/);
  });
});

describe("vistas do editor", () => {
  it("silhueta nas outras vistas e mover em qualquer vista", async () => {
    const { solidSilhouette, moveSolid } = await import("../src/core/elementDesign");
    const s = box("planta", 0, 0, 200, 100, 10, 60); // X 0–200, Z 0–100, Y 10–60
    expect(solidSilhouette(s, "frente")).toEqual([[0, 10], [200, 10], [200, 60], [0, 60]]);
    expect(solidSilhouette(s, "lateral")).toEqual([[0, 10], [100, 10], [100, 60], [0, 60]]);
    const m = moveSolid(s, [5, 20, 30]); // +X, +Y (altura), +Z
    expect(m.perfil).toEqual({ t: "ret", x0: 5, y0: 30, x1: 205, y1: 130 });
    expect([m.de, m.ate]).toEqual([30, 80]);
  });
});
