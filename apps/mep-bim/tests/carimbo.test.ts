import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dxfDecodeText, extraFields, fillTemplate, parseDxfTemplate, parseSvgTemplate, sanitizeSvg, type TitleBlock } from "../src/core/plan/titleBlock";
import { renderSheet } from "../src/core/plan/sheet";
import type { PlanDrawing } from "../src/core/plan/drawing";

const dxf = readFileSync(join(__dirname, "..", "samples", "carimbo-exemplo.dxf"), "utf8");

describe("carimbo DXF", () => {
  const t = parseDxfTemplate(dxf);
  const tb: TitleBlock = { id: "x", name: "ex", kind: "svg", ...t };

  it("converte o desenho em mm com o tamanho real", () => {
    expect(t.width).toBeGreaterThan(180);
    expect(t.width).toBeLessThan(183);
    expect(t.height).toBeGreaterThan(60);
    expect(t.height).toBeLessThan(63);
    expect(t.content).toContain("<polygon");
    expect((t.content.match(/<line /g) ?? []).length).toBe(6);
  });

  it("traz textos, acentos e atributos de blocos", () => {
    expect(t.content).toContain("CONTEÚDO");
    expect(t.content).toContain("ART {{art}}");
    expect(t.content).not.toContain(">ART<"); // ATTDEF do bloco não aparece
  });

  it("lista campos extras e preenche os padrão", () => {
    expect(extraFields(tb)).toEqual(["cliente", "art"]);
    const filled = fillTemplate(t.content, { projeto: "Torre A & B", cliente: "ACME", escala: "1:50" });
    expect(filled).toContain("Torre A &amp; B");
    expect(filled).toContain("ACME");
    expect(filled).not.toContain("{{projeto}}");
  });

  it("entra na folha no canto inferior direito, com os campos", () => {
    const drawing: PlanDrawing = { prims: [], legend: [], bounds: null, scale: 50, storey: "Térreo", cutHeight: 1.2 } as unknown as PlanDrawing;
    const info = { projeto: "Edifício X", conteudo: "Elétrica", responsavel: "Eng.", data: "01/11/2026", revisao: "R01", folha: "02/05", extras: { cliente: "ACME" } };
    const sheet = renderSheet(drawing, "A1", info, tb);
    expect(sheet.svg).toContain("Edifício X");
    expect(sheet.svg).toContain("ACME");
    expect(sheet.svg).toContain("1:50");
    const m = sheet.svg.match(/<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!;
    const [x, y, w, h] = m.slice(1).map(Number);
    expect(x + w).toBeCloseTo(841 - 10, 0);
    expect(y + h).toBeCloseTo(594 - 10, 0);
  });
});

describe("carimbo SVG", () => {
  it("lê viewBox e tamanho em mm e remove scripts", () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="170mm" height="40mm" viewBox="0 0 170 40"><script>alert(1)</script><rect width="170" height="40" onclick="x()"/><text>{{projeto}}</text></svg>`;
    const t = parseSvgTemplate(svg);
    expect(t.viewBox).toEqual([0, 0, 170, 40]);
    expect(t.width).toBe(170);
    expect(t.height).toBe(40);
    expect(t.content).not.toContain("script");
    expect(t.content).not.toContain("onclick");
    expect(sanitizeSvg(`<a href="javascript:alert(1)">`)).not.toContain("javascript");
  });
  it("decodifica textos do DXF", () => {
    expect(dxfDecodeText("%%c25 \\U+00E7")).toBe("Ø25 ç");
    expect(dxfDecodeText("{\\fArial|b1;ÁREA}\\PLINHA 2", true)).toBe("ÁREA\nLINHA 2");
  });
});
