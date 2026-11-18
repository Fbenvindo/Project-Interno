import { describe, expect, it } from "vitest";
import { autoRotation, displayTransform, transformPrims, viewAngle } from "../src/core/plan/orient";
import type { Prim } from "../src/core/plan/drawing";
import type { P2 } from "../src/core/plan/section";

/** Paredes de um retângulo 40 × 12 m girado `deg` graus, longe da origem (coordenadas de mapa). */
function building(deg: number, o: P2 = [330_000, 7_390_000]): Prim[] {
  const a = (deg * Math.PI) / 180;
  const R = ([x, y]: P2): P2 => [o[0] + Math.cos(a) * x - Math.sin(a) * y, o[1] + Math.sin(a) * x + Math.cos(a) * y];
  const wall = (x0: number, y0: number, x1: number, y1: number): Prim => ({ t: "poly", pts: [R([x0, y0]), R([x1, y0]), R([x1, y1]), R([x0, y1])], closed: true, weight: 0.5, layer: "ARQ-CORTE", color: "#000", fill: "#ccc" });
  return [wall(0, 0, 40, 0.2), wall(0, 11.8, 40, 12), wall(0, 0, 0.2, 12), wall(39.8, 0, 40, 12), wall(20, 0, 20.15, 12)];
}

describe("rotação das plantas", () => {
  it("alinha o maior eixo na horizontal", () => {
    expect(autoRotation(building(23)) * (180 / Math.PI)).toBeCloseTo(-23, 1);
    expect(autoRotation(building(-15)) * (180 / Math.PI)).toBeCloseTo(15, 1);
    // Maior eixo na vertical (girado 100°): gira para deitar.
    expect(Math.abs(autoRotation(building(100)) * (180 / Math.PI))).toBeCloseTo(80, 1);
    expect(autoRotation(building(0))).toBe(0);
    expect(viewAngle(0, building(23))).toBe(0);
    expect(viewAngle(90, building(23))).toBeCloseTo(Math.PI / 2, 9);
  });

  it("exibição com origem local: coordenadas pequenas e ida e volta exata", () => {
    const prims = building(23);
    const T = displayTransform([330_000, 7_390_000], autoRotation(prims));
    const shown = transformPrims(prims, T);
    const pts = shown.flatMap((p) => (p.t === "poly" ? p.pts : []));
    expect(Math.max(...pts.map((q) => Math.hypot(q[0], q[1])))).toBeLessThan(100);
    // Paredes longas na horizontal depois de girar.
    const long = shown[0] as Extract<Prim, { t: "poly" }>;
    expect(Math.abs(long.pts[1][1] - long.pts[0][1])).toBeLessThan(1e-6);
    const p: P2 = [330_012.345, 7_390_006.789];
    const back = T.from(T.to(p));
    expect(back[0]).toBeCloseTo(p[0], 6);
    expect(back[1]).toBeCloseTo(p[1], 6);
  });

  it("textos horizontais continuam horizontais; inclinados giram e ficam legíveis", () => {
    const T = displayTransform([0, 0], (-23 * Math.PI) / 180);
    const [a, b] = transformPrims(
      [
        { t: "text", p: [1, 1], text: "SALA", height: 0.2, anchor: "middle", color: "#000", layer: "T" },
        { t: "text", p: [1, 1], text: "Ø50", height: 0.2, anchor: "middle", color: "#000", layer: "T", angle: (100 * Math.PI) / 180 },
      ],
      T,
    ) as Extract<Prim, { t: "text" }>[];
    expect(a.angle ?? 0).toBe(0);
    expect((b.angle! * 180) / Math.PI).toBeCloseTo(77, 6);
  });
});
