import { describe, expect, it } from "vitest";
import { changeState, docCode, docFileName, emissionCsv, levelCode, newDocMeta, nextEmissionNumber, nextRevision, type Emission } from "../src/core/cde";

const coding = { projeto: "Htl", originador: "seb", volume: "ZZ", autor: "Ana" };

describe("gestão da informação (ISO 19650)", () => {
  it("código e nome de arquivo", () => {
    const d = newDocMeta({ nivel: "01", tipo: "DR", disciplina: "EL", numero: "3" });
    expect(docCode(coding, d)).toBe("HTL-SEB-ZZ-01-DR-EL-0003");
    expect(docFileName(coding, d, "pdf")).toBe("HTL-SEB-ZZ-01-DR-EL-0003_P01.pdf");
    expect(docCode({ ...coding, projeto: "Edifício São João" }, d)).toBe("EDIFICIOSAOJOAO-SEB-ZZ-01-DR-EL-0003");
  });

  it("revisões: P01 → P02 compartilhando; publicar vira C01, depois C02", () => {
    expect(nextRevision("P01", false)).toBe("P02");
    expect(nextRevision("P09", true)).toBe("C01");
    expect(nextRevision("C01", true)).toBe("C02");
    let d = newDocMeta();
    d = changeState(d, "compartilhado", "S1", "Para coordenação", "Ana", "01/12/2026");
    expect(d.revisao).toBe("P01");
    d = changeState(d, "andamento", "", "", "Ana", "02/12/2026");
    expect(d.revisao).toBe("P01");
    d = changeState(d, "compartilhado", "S3", "Comentários", "Ana", "05/12/2026");
    expect(d.revisao).toBe("P02");
    d = changeState(d, "publicado", "A1", "Para obra", "Ana", "10/12/2026");
    expect(d.revisao).toBe("C01");
    d = changeState(d, "publicado", "A1", "Revisão de obra", "Ana", "20/12/2026");
    expect(d.revisao).toBe("C02");
    expect(d.historico.map((h) => h.rev)).toEqual(["P01", "P02", "C01", "C02"]);
    expect(changeState(d, "arquivado", "", "", "Ana", "").revisao).toBe("C02");
  });

  it("nível pelo pavimento, número da GRD e lista CSV", () => {
    const storeys = [{ name: "Subsolo", level: -3 }, { name: "Térreo", level: 0 }, { name: "1º", level: 3 }];
    expect(levelCode("Térreo", storeys)).toBe("00");
    expect(levelCode("1º", storeys)).toBe("01");
    expect(levelCode("Subsolo", storeys)).toBe("B1");
    expect(levelCode(null, storeys)).toBe("ZZ");
    // Sem "Térreo" no nome: o de cota mais perto de zero.
    const s2 = [{ name: "P1", level: -2.9 }, { name: "P2", level: 0.15 }, { name: "P3", level: 3.2 }];
    expect(levelCode("P2", s2)).toBe("00");
    expect(levelCode("P1", s2)).toBe("B1");
    const e: Emission = { id: "1", numero: "GRD-002", data: "01/12/2026", destinatario: "Construtora", finalidade: "S3", observacoes: "", autor: "Ana", itens: [{ docId: "f", codigo: "HTL-SEB-ZZ-01-DR-EL-0001", titulo: "Planta", revisao: "P01", estado: "compartilhado", finalidade: "S3", formato: "PDF" }] };
    expect(nextEmissionNumber([e])).toBe("GRD-003");
    expect(nextEmissionNumber([])).toBe("GRD-001");
    const csv = emissionCsv(e, coding);
    expect(csv).toContain('"HTL-SEB-ZZ-01-DR-EL-0001";"Planta";"P01";"Compartilhado"');
  });
});
