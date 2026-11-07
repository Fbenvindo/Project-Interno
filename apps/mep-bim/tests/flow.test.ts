import { describe, expect, it } from "vitest";
import { autoArrange, blockRect, blockStorey, busStoreys, checkFlow, downstreamLoad, flowPrims, HEADER_H, linkPath, newFlow, nextTag, type FlowBlock, type FlowData, type FlowLink } from "../src/core/flow";

// Pavimentos de cima para baixo: 3º, 2º, 1º, Térreo (faixas de 3 unidades a partir de HEADER_H).
const base = (): FlowData => newFlow("eletrica", ["Térreo", "1º Pavimento", "2º Pavimento", "3º Pavimento"]);
const yOf = (f: FlowData, storey: string, h = 0.9) => HEADER_H + f.storeys.indexOf(storey) * f.bandH + (f.bandH - h) / 2;
let n = 0;
const blk = (kind: string, tag: string, x: number, y: number, extra: Partial<FlowBlock> = {}): FlowBlock => ({ id: `b${n++}`, kind, tag, x, y, params: {}, ...extra });
const lnk = (a: FlowBlock, b: FlowBlock, kind: FlowLink["kind"] = "bt"): FlowLink => ({ id: `l${n++}`, from: a.id, to: b.id, kind });
const texts = (f: FlowData) => checkFlow(f, { boards: [] }).map((i) => `${i.level}: ${i.text}`);

describe("fluxograma elétrico — barramento blindado e medição", () => {
  it("caixa MEC direto no barramento: só uma por barramento", () => {
    const f = base();
    const bus = blk("barramento", "BB-1", 10, HEADER_H + 0.2, { h: 3 * 3 + 2.5 });
    const m1 = blk("mec-iv", "MEC-1", 12, yOf(f, "1º Pavimento"));
    const m2 = blk("mec-iv", "MEC-2", 12, yOf(f, "2º Pavimento"));
    f.blocks = [bus, m1, m2];
    f.links = [lnk(bus, m1), lnk(bus, m2)];
    expect(texts(f).some((t) => t.startsWith("erro") && t.includes("só pode haver uma caixa por barramento"))).toBe(true);
    f.blocks = [bus, m1];
    f.links = [lnk(bus, m1)];
    expect(texts(f).some((t) => t.includes("só pode haver uma caixa"))).toBe(false);
  });

  it("com caixa de derivação: até 2 caixas por andar no mesmo barramento", () => {
    const f = base();
    const bus = blk("barramento", "BB-1", 10, HEADER_H + 0.2, { h: 11.5 });
    const dv = blk("derivacao", "CD-1", 12, yOf(f, "2º Pavimento", 0.7));
    const ms = [0, 1, 2].map((i) => blk("mec-ii", `MEC-${i + 1}`, 14 + i * 3, yOf(f, "2º Pavimento")));
    f.blocks = [bus, dv, ...ms.slice(0, 2)];
    f.links = [lnk(bus, dv), ...ms.slice(0, 2).map((m) => lnk(dv, m))];
    expect(texts(f).filter((t) => t.startsWith("erro"))).toEqual([]);
    f.blocks.push(ms[2]);
    f.links.push(lnk(dv, ms[2]));
    const t = texts(f).join("\n");
    expect(t).toMatch(/3 caixas de medição no 2º Pavimento/);
    expect(t).toMatch(/máximo 2/);
  });

  it("derivação num andar que o barramento não alcança e capacidade de medidores", () => {
    const f = base();
    const bus = blk("barramento", "BB-1", 10, yOf(f, "1º Pavimento", 2), { h: 5 }); // 1º e Térreo
    expect(busStoreys(f, bus)).toEqual(["1º Pavimento", "Térreo"]);
    const dv = blk("derivacao", "CD-1", 12, yOf(f, "3º Pavimento", 0.7));
    const mec = blk("mec-ii", "MEC-1", 14, yOf(f, "3º Pavimento"));
    const qds = [0, 1, 2].map((i) => blk("qd", `QD-${i + 1}`, 18, yOf(f, "3º Pavimento")));
    f.blocks = [bus, dv, mec, ...qds];
    f.links = [lnk(bus, dv), lnk(dv, mec), ...qds.map((q) => lnk(mec, q))];
    const t = texts(f).join("\n");
    expect(t).toMatch(/não alcança: estique o barramento/);
    expect(t).toMatch(/MEC-1: 3 quadros ligados, mas a caixa tem 2 medidores/);
    // Quantidade num bloco só (QD Apto ×2) conta como 2 quadros
    f.blocks = [bus, dv, mec, { ...qds[0], params: { quantidade: 2 } }];
    f.links = [lnk(bus, dv), lnk(dv, mec), lnk(mec, qds[0])];
    expect(texts(f).join("\n")).not.toMatch(/medidores/);
  });

  it("mais de um barramento e mais de uma torre", () => {
    const f = base();
    f.towers = [
      { id: "a", name: "Torre A", width: 20 },
      { id: "b", name: "Torre B", width: 20 },
    ];
    const qgbt = blk("qgbt", "QGBT", 4, yOf(f, "Térreo", 1.3));
    const b1 = blk("barramento", "BB-A", 12, HEADER_H + 0.2, { h: 11.5 });
    const b2 = blk("barramento", "BB-B", 32, HEADER_H + 0.2, { h: 11.5 });
    const m1 = blk("mec-iv", "MEC-A", 14, yOf(f, "2º Pavimento"));
    const m2 = blk("mec-iv", "MEC-B", 34, yOf(f, "2º Pavimento"));
    f.blocks = [qgbt, b1, b2, m1, m2];
    f.links = [lnk(qgbt, b1), lnk(qgbt, b2), lnk(b1, m1), lnk(b2, m2)];
    expect(texts(f).filter((t) => t.includes("só pode haver"))).toEqual([]);
    // A ligação no barramento sai na altura da caixa
    const p = linkPath(b1, m1);
    expect(p[0][1]).toBeCloseTo(m1.y + blockRect(m1).h / 2);
  });
});

describe("fluxograma — alimentação, média tensão e modelo", () => {
  it("bloco sem alimentação e MT chegando em quadro", () => {
    const f = base();
    const c = blk("concessionaria-mt", "CONC", 4, yOf(f, "Térreo", 1));
    const q = blk("qgbt", "QGBT", 9, yOf(f, "Térreo", 1.3));
    const solto = blk("qd", "QD-9", 14, yOf(f, "1º Pavimento"));
    f.blocks = [c, q, solto];
    f.links = [lnk(c, q, "mt")];
    const t = texts(f).join("\n");
    expect(t).toMatch(/Média tensão chegando em QGBT/);
    expect(t).toMatch(/QD-9 não está alimentado/);
  });

  it("vínculo com quadros do modelo: carga, pavimento, quadro ausente e quadro não representado", () => {
    const f = base();
    const tr = blk("transformador", "TR-1", 4, yOf(f, "Térreo", 1.3), { params: { potencia: 15 } });
    const qd = blk("qd", "QD-1", 9, yOf(f, "1º Pavimento"), { pointGuid: "g1", params: { quantidade: 1 } });
    const qd2 = blk("qd", "QD-2", 9, yOf(f, "2º Pavimento"));
    f.blocks = [tr, qd, qd2];
    f.links = [lnk(tr, qd), lnk(tr, qd2)];
    const ctx = {
      boards: [
        { guid: "g1", tag: "QD-1", storey: "Térreo", loadVA: 9000 },
        { guid: "g2", tag: "QD-2", storey: "2º Pavimento", loadVA: 8000 },
        { guid: "g3", tag: "QD-9", storey: "3º Pavimento", loadVA: 100 },
      ],
    };
    expect(downstreamLoad(f, tr.id, ctx).va).toBe(9000);
    const issues = checkFlow(f, ctx);
    const t = issues.map((i) => i.text).join("\n");
    expect(t).toMatch(/QD-1 está no 1º Pavimento no fluxograma, mas o quadro QD-1 foi locado no Térreo/);
    expect(issues.find((i) => i.blockId === qd2.id && i.action?.kind === "vincular")).toBeTruthy();
    expect(t).toMatch(/QD-9 \(3º Pavimento\) está no modelo, mas não aparece no fluxograma/);
    // Vinculando o QD-2, a carga passa da potência do transformador.
    f.blocks[2] = { ...qd2, pointGuid: "g2" };
    expect(checkFlow(f, ctx).map((i) => i.text).join("\n")).toMatch(/TR-1: carga instalada a jusante de 17,0 kVA passa da potência de 15 kVA/);
    // Quadro apagado do modelo
    expect(checkFlow(f, { boards: [] }).some((i) => i.level === "erro" && i.text.includes("não existe mais no modelo"))).toBe(true);
  });

  it("pavimento pela faixa, etiquetas, organizar e desenho", () => {
    const f = base();
    const q = blk("qd", nextTag(f, "qd"), 5, yOf(f, "2º Pavimento") + 0.7);
    f.blocks = [q];
    expect(q.tag).toBe("QD-1");
    expect(nextTag(f, "qd")).toBe("QD-2");
    expect(blockStorey(f, q)).toBe("2º Pavimento");
    const a = autoArrange(f);
    expect(a.blocks[0].y).toBeCloseTo(yOf(f, "2º Pavimento"), 1);
    const prims = flowPrims(f, { legend: true });
    expect(prims.some((p) => p.t === "text" && p.text === "QD-1")).toBe(true);
    expect(prims.some((p) => p.t === "text" && p.text === "2º PAVIMENTO")).toBe(true);
  });
});

describe("altura da faixa por pavimento", () => {
  it("faixas com alturas diferentes e blocos que acompanham a faixa", async () => {
    const { bandTop, bandIndexAt, withBandHeights, bandsBottom } = await import("../src/core/flow");
    const f = base(); // 3º, 2º, 1º, Térreo (3 cada)
    const q3 = blk("qd", "QD-3", 5, yOf(f, "3º Pavimento"));
    const qT = blk("qgbt", "QGBT", 5, yOf(f, "Térreo", 1.6));
    const bus = blk("barramento", "BB", 12, bandTop(f, 0) + 0.3, { h: bandTop(f, 4) - 0.3 - (bandTop(f, 0) + 0.3) });
    f.blocks = [q3, qT, bus];
    // Térreo com 6 de altura e 3º com 2
    const g = withBandHeights(f, { bandHs: [2, null, null, 6] });
    expect(bandTop(g, 1)).toBeCloseTo(HEADER_H + 2);
    expect(bandsBottom(g)).toBeCloseTo(HEADER_H + 2 + 3 + 3 + 6);
    expect(bandIndexAt(g, bandTop(g, 3) + 5.5)).toBe(3);
    const nq3 = g.blocks.find((b) => b.tag === "QD-3")!;
    const nqT = g.blocks.find((b) => b.tag === "QGBT")!;
    const nbus = g.blocks.find((b) => b.tag === "BB")!;
    expect(blockStorey(g, nq3)).toBe("3º Pavimento");
    expect(blockStorey(g, nqT)).toBe("Térreo");
    expect(nqT.y - bandTop(g, 3)).toBeCloseTo(qT.y - bandTop(f, 3));
    // Barramento continua do 3º ao Térreo
    expect(busStoreys(g, nbus)).toEqual(["3º Pavimento", "2º Pavimento", "1º Pavimento", "Térreo"]);
    // Altura padrão também leva os blocos
    const h = withBandHeights(f, { bandH: 4 });
    expect(blockStorey(h, h.blocks.find((b) => b.tag === "QGBT")!)).toBe("Térreo");
    expect(flowPrims(g).some((p) => p.t === "text" && p.text === "TÉRREO")).toBe(true);
  });
});
