import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { libraryForProject, mergeEntry, type LibraryEntry } from "../src/renderer/src/library/familyLibrary";
import { packageComponents, parseFamilyPackage } from "../src/core/families";
import { designComponentId, type ElementDesign } from "../src/core/elementDesign";
import { ifcComponentId, type IfcElementDef } from "../src/core/ifcElements";

const pkg = parseFamilyPackage(readFileSync(join(__dirname, "..", "samples", "familias-exemplo.sebfam"), "utf8"));
const design = (uid: string) => ({ uid, name: uid }) as unknown as ElementDesign;
const element = (uid: string) => ({ uid, name: uid }) as unknown as IfcElementDef;

const own: LibraryEntry = { id: "proprio", name: "Elementos criados no app", importedAt: "", kind: "proprio", overrides: {}, designs: [design("a"), design("b")] };
const ifc: LibraryEntry = { id: "ifc-1", name: "x.ifc", importedAt: "", kind: "ifc", overrides: {}, elements: [element("u1"), element("u2")], ifcOverrides: { u1: { funcao: "Lavatório" } } };
const fam: LibraryEntry = { id: "pkg-1", name: "f.sebfam", importedAt: "", kind: "sebfam", pkg, overrides: {} };

describe("biblioteca levada no projeto", () => {
  it("grava só o que o projeto usa (elementos criados, de IFC e famílias)", () => {
    const famIds = packageComponents("pkg-1", pkg).map((c) => c.id);
    const used = new Set([designComponentId("b"), ifcComponentId("ifc-1", "u1"), famIds[0]]);
    const out = libraryForProject(used, [own, ifc, fam]);
    expect(out.find((e) => e.id === "proprio")!.designs!.map((d) => d.uid)).toEqual(["b"]);
    const i = out.find((e) => e.id === "ifc-1")!;
    expect(i.elements!.map((e) => e.uid)).toEqual(["u1"]);
    expect(i.ifcOverrides?.u1?.funcao).toBe("Lavatório");
    const f = out.find((e) => e.id === "pkg-1")!;
    expect(f.pkg!.familias.length).toBe(1);
    expect(f.pkg!.familias.length).toBeLessThan(pkg.familias.length);
    // Nada usado: nada gravado.
    expect(libraryForProject(new Set(), [own, ifc, fam])).toEqual([]);
    // Sobrevive ao JSON do arquivo .seb.
    expect(JSON.parse(JSON.stringify(out)).length).toBe(3);
  });

  it("ao abrir, acrescenta o que falta e mantém o local; ao importar a biblioteca, o arquivo substitui", () => {
    const local: LibraryEntry = { ...own, designs: [{ ...design("a"), name: "local" } as ElementDesign] };
    const incoming: LibraryEntry = { ...own, designs: [{ ...design("a"), name: "do projeto" } as ElementDesign, design("c")] };
    const keep = mergeEntry(local, incoming, "local");
    expect(keep.designs!.map((d) => `${d.uid}:${(d as unknown as { name: string }).name}`)).toEqual(["a:local", "c:c"]);
    const take = mergeEntry(local, incoming, "incoming");
    expect((take.designs!.find((d) => d.uid === "a") as unknown as { name: string }).name).toBe("do projeto");
  });
});
