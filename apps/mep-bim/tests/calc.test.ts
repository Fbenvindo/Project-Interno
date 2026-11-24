import { describe, expect, it } from "vitest";
import { correnteDeProjeto, quedaDeTensao, resistenciaOhmKm, secaoPorQuedaDeTensao } from "../src/core/calc/eletrica";
import {
  perdaCargaFairWhippleHsiao,
  perdaCargaHazenWilliams,
  trechoAguaFria,
  vazaoPorPesos,
  velocidade,
} from "../src/core/calc/hidraulica";
import { areaRetangular, diametroEquivalente, velocidadeDuto } from "../src/core/calc/hvac";

describe("elétrica", () => {
  it("resistência do cobre a 20 °C", () => {
    // 2,5 mm² de cobre ≈ 6,9 Ω/km a 20 °C
    expect(resistenciaOhmKm(2.5, "cobre", 20)).toBeCloseTo(6.896, 2);
  });

  it("queda de tensão monofásica puramente resistiva", () => {
    const r = quedaDeTensao({
      sistema: "monofasico",
      tensao: 127,
      corrente: 10,
      comprimento: 20,
      secao: 2.5,
      fatorPotencia: 1,
      temperatura: 20,
    });
    // 2 · 10 A · 20 m · 0,0068964 Ω/m = 2,7586 V
    expect(r.quedaVolts).toBeCloseTo(2.7586, 3);
    expect(r.quedaPercentual).toBeCloseTo(2.172, 2);
    expect(r.atende).toBe(true);
  });

  it("trifásico usa √3", () => {
    const base = { tensao: 380, corrente: 30, comprimento: 50, secao: 6, fatorPotencia: 1, temperatura: 20 } as const;
    const mono = quedaDeTensao({ ...base, sistema: "bifasico" });
    const tri = quedaDeTensao({ ...base, sistema: "trifasico" });
    expect(tri.quedaVolts / mono.quedaVolts).toBeCloseTo(Math.sqrt(3) / 2, 6);
  });

  it("escolhe a menor seção que atende", () => {
    const r = secaoPorQuedaDeTensao({ sistema: "monofasico", tensao: 220, corrente: 20, comprimento: 40, tipoCircuito: "forca" })!;
    expect(r.resultado.atende).toBe(true);
    // 4 mm² a 70 °C: ΔV ≈ 7,65 V (3,5%); 2,5 mm² passaria de 5%
    expect(r.secao).toBe(4);
    expect(r.resultado.quedaPercentual).toBeCloseTo(3.48, 1);
    const menor = quedaDeTensao({ sistema: "monofasico", tensao: 220, corrente: 20, comprimento: 40, secao: 2.5 });
    expect(menor.atende).toBe(false);
  });

  it("respeita seção mínima de iluminação", () => {
    const r = secaoPorQuedaDeTensao({ sistema: "monofasico", tensao: 220, corrente: 1, comprimento: 5, tipoCircuito: "iluminacao" })!;
    expect(r.secao).toBe(1.5);
  });

  it("corrente de projeto", () => {
    expect(correnteDeProjeto(2200, 220, "monofasico", 1)).toBeCloseTo(10);
  });
});

describe("hidráulica", () => {
  it("vazão pelos pesos", () => {
    expect(vazaoPorPesos(4)).toBeCloseTo(0.6);
  });

  it("velocidade", () => {
    // 1 L/s em 25 mm ≈ 2,04 m/s
    expect(velocidade(1, 25)).toBeCloseTo(2.037, 2);
  });

  it("Fair-Whipple-Hsiao tubo liso", () => {
    expect(perdaCargaFairWhippleHsiao(1, 50, "pvc")).toBeCloseTo(8.69e6 * 50 ** -4.75, 10);
    expect(perdaCargaFairWhippleHsiao(1, 50, "pvc")).toBeCloseTo(0.0739, 3);
    expect(perdaCargaFairWhippleHsiao(1, 50, "aco_galvanizado")).toBeGreaterThan(perdaCargaFairWhippleHsiao(1, 50, "pvc"));
  });

  it("Hazen-Williams", () => {
    // 10 L/s, DN100, C=120 ≈ 0,022 m/m (≈ 2,2 m/100 m)
    expect(perdaCargaHazenWilliams(10, 100, 120)).toBeCloseTo(0.022, 3);
  });

  it("trecho de água fria", () => {
    const r = trechoAguaFria({ vazaoLs: 1, diametroInternoMm: 25, comprimento: 10, comprimentoEquivalente: 2 });
    expect(r.velocidadeAtende).toBe(true);
    expect(r.perdaTotal).toBeCloseTo(r.perdaUnitaria * 12);
  });
});

describe("HVAC", () => {
  it("diâmetro equivalente de Huebscher", () => {
    expect(diametroEquivalente(400, 300)).toBeCloseTo(377.5, 0);
  });

  it("velocidade no duto", () => {
    expect(velocidadeDuto(3600, areaRetangular(500, 400))).toBeCloseTo(5);
  });
});
