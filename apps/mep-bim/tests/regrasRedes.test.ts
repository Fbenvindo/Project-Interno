import { describe, expect, it } from "vitest";
import { allowedModes, ceilingClearance, DEFAULT_INSTALL_SETTINGS, defaultInstallFor, modeLabel, runElevation, withCeilingClearance } from "../src/core/conduits";
import { RUN_TYPE_BY_ID } from "../src/core/runs";

const T = (id: string) => RUN_TYPE_BY_ID[id];
const S = (id: string, label: string) => T(id).sizes.find((x) => x.label === label)!;
const s = DEFAULT_INSTALL_SETTINGS;
// Piso acabado em 0, face inferior da laje em 2,90.

describe("regras de rota das redes", () => {
  it("formas permitidas: laje só gás em cobre; ar condicionado sem piso; nada solto sem pedir", () => {
    expect(allowedModes(T("agua-fria"))).not.toContain("laje");
    expect(allowedModes(T("gas-cobre"))).toContain("laje");
    expect(modeLabel(T("gas-cobre"), "laje")).toMatch(/contrapiso/);
    expect(allowedModes(T("duto-retangular"))).not.toContain("piso");
    expect(allowedModes(T("eletrocalha"))).not.toContain("piso");
    for (const id of ["agua-fria", "esgoto", "duto-retangular", "eletrocalha"]) expect(defaultInstallFor(T(id)).mode).toBe("laje-aparente");
    expect(defaultInstallFor(T("eletroduto-pvc")).mode).toBe("laje");
  });

  it("hidráulica: teto 20 cm da laje; terra 60 cm (esgoto, pluvial) e 30 cm (demais); contrapiso do gás", () => {
    expect(runElevation(T("agua-fria"), { mode: "laje-aparente" }, 0, 2.9, S("agua-fria", "Ø50"), s)).toBeCloseTo(2.9 - 0.2 - 0.025);
    expect(runElevation(T("esgoto"), { mode: "piso" }, 0, 2.9, S("esgoto", "Ø100"), s)).toBeCloseTo(-0.6 - 0.05);
    expect(runElevation(T("agua-fria"), { mode: "piso" }, 0, 2.9, S("agua-fria", "Ø50"), s)).toBeCloseTo(-0.3 - 0.025);
    expect(runElevation(T("gas-cobre"), { mode: "laje" }, 0, 2.9, S("gas-cobre", "Ø22"), s)).toBeCloseTo(-0.02 - 0.011);
  });

  it("ar condicionado: duto no teto com a face superior a 20 cm da laje (pela altura do duto)", () => {
    expect(runElevation(T("duto-retangular"), { mode: "laje-aparente" }, 0, 2.9, S("duto-retangular", "400x300"), s)).toBeCloseTo(2.9 - 0.2 - 0.15);
  });

  it("elétrica: eletrocalha no teto a 10 cm; a distância mudada pelo usuário vale para as próximas da família", () => {
    expect(runElevation(T("eletrocalha"), { mode: "laje-aparente" }, 0, 2.9, S("eletrocalha", "200x100"), s)).toBeCloseTo(2.9 - 0.1 - 0.05);
    const s2 = withCeilingClearance(T("eletrocalha"), s, 250);
    expect(ceilingClearance(T("eletroduto-pvc"), s2)).toBe(250);
    expect(ceilingClearance(T("agua-fria"), s2)).toBe(200);
    const s3 = withCeilingClearance(T("esgoto"), s, 350);
    expect(ceilingClearance(T("incendio-aco"), s3)).toBe(350);
    expect(ceilingClearance(T("duto-retangular"), s3)).toBe(200);
  });

  it("altura livre só quando o usuário informa", () => {
    expect(runElevation(T("agua-fria"), { mode: "livre", height: 1.1 }, 0, 2.9, S("agua-fria", "Ø25"), s)).toBeCloseTo(1.1);
  });
});
