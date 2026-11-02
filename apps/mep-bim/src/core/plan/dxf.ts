// Exportação da planta em DXF (R12, ASCII), em milímetros na escala real,
// com camadas por disciplina. Símbolos e textos já dimensionados para a
// escala de impressão escolhida. Preenchimentos com até 4 vértices viram
// SOLID (ex.: paredes retas cortadas, símbolos); os demais, só o contorno.
import type { PlanDrawing, Prim } from "./drawing";
import type { P2 } from "./section";
import { toMap, type MapConversion } from "../georef";

/** Cor ACI por prefixo de camada. */
const ACI: Record<string, number> = { ARQ: 8, EST: 8, ELE: 30, HID: 5, INC: 1, TEL: 6, HVAC: 3, GAS: 2, MEP: 4, OUT: 9 };

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
/** Texto DXF em ASCII: caracteres fora do ASCII como \U+XXXX (entendido pelo AutoCAD). */
const dxfText = (s: string) => s.replace(/[^\x20-\x7E]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);

/**
 * Coordenadas do DXF: "projeto" (mm, coordenadas do IFC) ou "mapa" (m, E/N da IfcMapConversion,
 * para sobrepor a levantamentos e bases georreferenciadas).
 */
export interface DxfOptions {
  map?: MapConversion | null;
}

export function exportDxf(drawing: PlanDrawing, opts: DxfOptions = {}): string {
  const geo = opts.map ?? null;
  /** Fator de comprimento (mm no projeto; m no mapa) e rotação do mapa para textos. */
  const k = geo ? geo.scale : 1000;
  const rot = geo ? Math.atan2(geo.xAxisOrdinate, geo.xAxisAbscissa) : 0;
  const mm = (p: P2): P2 => {
    if (!geo) return [p[0] * 1000, p[1] * 1000];
    const q = toMap(geo, [p[0], p[1], 0]);
    return [q[0], q[1]];
  };
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === "number" ? n(value) : value);

  const layers = [...new Set(drawing.prims.map((p) => p.layer))].sort();
  const paper = geo ? drawing.scale / 1000 : drawing.scale; // 1 mm de papel em unidades do DXF
  const dash = 2 * paper; // 2 mm de papel
  const gap = 1 * paper;

  // Cabeçalho
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$LTSCALE");
  g(40, 1);
  g(9, "$INSUNITS");
  g(70, geo ? 6 : 4); // 6 = metros (mapa), 4 = milímetros
  if (drawing.bounds && !geo) {
    const [a, b] = [mm(drawing.bounds.min), mm(drawing.bounds.max)];
    g(9, "$EXTMIN");
    g(10, a[0]);
    g(20, a[1]);
    g(30, 0);
    g(9, "$EXTMAX");
    g(10, b[0]);
    g(20, b[1]);
    g(30, 0);
  }
  g(0, "ENDSEC");

  // Tabelas: tipos de linha e camadas
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LTYPE");
  g(70, 3);
  g(0, "LTYPE");
  g(2, "CONTINUOUS");
  g(70, 0);
  g(3, "Solid line");
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, "LTYPE");
  g(2, "DASHDOT");
  g(70, 0);
  g(3, "__ . __ . __");
  g(72, 65);
  g(73, 4);
  g(40, 3 * paper + 0.6 * paper + 1.6 * paper);
  g(49, 3 * paper);
  g(49, -0.8 * paper);
  g(49, 0);
  g(49, -0.8 * paper);
  g(0, "LTYPE");
  g(2, "DASHED");
  g(70, 0);
  g(3, "__ __ __");
  g(72, 65);
  g(73, 2);
  g(40, dash + gap);
  g(49, dash);
  g(49, -gap);
  g(0, "ENDTAB");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, layers.length);
  for (const name of layers) {
    g(0, "LAYER");
    g(2, name);
    g(70, 0);
    g(62, name.endsWith("-CORTE") ? 7 : (ACI[name.split("-")[0]] ?? 7));
    g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  // Entidades
  g(0, "SECTION");
  g(2, "ENTITIES");
  for (const p of drawing.prims) entity(p);
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";

  function head(type: string, p: Prim) {
    g(0, type);
    g(8, p.layer);
    if ("dashdot" in p && p.dashdot) g(6, "DASHDOT");
    else if ("dashed" in p && p.dashed) g(6, "DASHED");
  }

  function entity(p: Prim) {
    if (p.t === "line") {
      const [a, b] = [mm(p.a), mm(p.b)];
      head("LINE", p);
      g(10, a[0]);
      g(20, a[1]);
      g(30, 0);
      g(11, b[0]);
      g(21, b[1]);
      g(31, 0);
    } else if (p.t === "poly") {
      if (p.fill && p.closed && p.pts.length >= 3 && p.pts.length <= 4) {
        // SOLID: ordem 1, 2, 4, 3 (triângulo repete o último vértice).
        const q = p.pts.map(mm);
        const order = q.length === 3 ? [q[0], q[1], q[2], q[2]] : [q[0], q[1], q[3], q[2]];
        g(0, "SOLID");
        g(8, p.layer);
        order.forEach((v, i) => {
          g(10 + i, v[0]);
          g(20 + i, v[1]);
          g(30 + i, 0);
        });
      }
      head("POLYLINE", p);
      g(66, 1);
      g(70, p.closed ? 1 : 0);
      g(10, 0);
      g(20, 0);
      g(30, 0);
      for (const v of p.pts.map(mm)) {
        g(0, "VERTEX");
        g(8, p.layer);
        g(10, v[0]);
        g(20, v[1]);
        g(30, 0);
      }
      g(0, "SEQEND");
      g(8, p.layer);
    } else if (p.t === "circle") {
      const c = mm(p.c);
      head("CIRCLE", p);
      g(10, c[0]);
      g(20, c[1]);
      g(30, 0);
      g(40, p.r * k);
    } else {
      const at = mm(p.p);
      head("TEXT", p);
      g(10, at[0]);
      g(20, at[1]);
      g(30, 0);
      g(40, p.height * k);
      g(1, dxfText(p.text));
      const ang = (p.angle ?? 0) + rot;
      if (ang) g(50, (ang * 180) / Math.PI);
      const h = p.anchor === "middle" ? 1 : p.anchor === "end" ? 2 : 0;
      if (h) g(72, h);
      g(73, 2); // alinhamento vertical: meio
      g(11, at[0]);
      g(21, at[1]);
      g(31, 0);
    }
  }
}
