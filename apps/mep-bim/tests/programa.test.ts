import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IfcAPI } from "web-ifc";
import { DEFAULT_CATALOG, detectType, roomInventory, roomRequests, countPoints, type ProgramState } from "../src/core/program";
import { COMPONENT_BY_ID } from "../src/core/library";
import { deserializeProject, serializeProject } from "../src/core/project";
import { loadIfc, type LoadedModel } from "../src/ifc/loadIfc";

let model: LoadedModel;
beforeAll(async () => {
  const api = new IfcAPI();
  await api.Init();
  model = loadIfc(api, new Uint8Array(readFileSync(join(__dirname, "..", "samples", "exemplo-apartamento.ifc"))));
});

const toPlan = (v: [number, number, number]) => {
  const p = model.coordinates.worldToIfc(v);
  return [p[0], p[1]] as [number, number];
};

describe("catálogo padrão", () => {
  it("todas as instalações usam componentes da biblioteca", () => {
    for (const t of DEFAULT_CATALOG) for (const r of t.reqs) expect(COMPONENT_BY_ID[r.componentId], `${t.id}: ${r.componentId}`).toBeDefined();
  });

  it("reconhece o equipamento pelo nome e tipo do objeto (sem acento, palavra mais longa vence)", () => {
    const d = (name: string, objectType: string | null = null) => detectType({ name, objectType, predefinedType: null }, DEFAULT_CATALOG);
    expect(d("Bacia sanitária com caixa acoplada")).toBe("bacia");
    expect(d("M_Toilet-Domestic-3D:Standard")).toBe("bacia");
    expect(d("Pia de cozinha 1,20 m")).toBe("pia-cozinha");
    expect(d("Tanque de louça")).toBe("tanque");
    expect(d("Máquina de lavar roupa")).toBe("maquina-lavar-roupa");
    expect(d("Máquina de lavar louça")).toBe("lava-loucas");
    expect(d("Chuveiro elétrico")).toBe("chuveiro");
    expect(d("Ducha higiênica")).toBe("ducha-higienica");
    expect(d("Smart TV 55")).toBe("televisao");
    expect(d("Estante")).toBeNull();
    expect(d("Tvx-300")).toBeNull(); // "tv" só como palavra inteira
  });
});

describe("levantamento por ambiente (IFC do apartamento)", () => {
  it("lista os equipamentos de cada ambiente e reconhece o tipo", () => {
    expect(model.spaces).toHaveLength(5);
    const inv = roomInventory(model.elements, model.spaces, toPlan, DEFAULT_CATALOG);
    const byName = (n: string) => model.spaces.find((s) => s.name === n)!.globalId;
    const types = (n: string) => inv.get(byName(n))!.map((i) => i.detected).sort();
    expect(types("Banheiro")).toEqual(["bacia", "chuveiro", "lavatorio"]);
    expect(types("Cozinha")).toEqual(["fogao", "geladeira", "pia-cozinha"]);
    expect(types("Área de serviço")).toEqual(["maquina-lavar-roupa", "tanque"]);
    expect(types("Escritório")).toEqual(["estacao-trabalho"]);
    // Sofá fica listado sem tipo (pode ser classificado à mão)
    expect(types("Sala")).toEqual(["televisao", null].sort());
  });

  it("gera os pedidos de pontos do padrão, com personalização por equipamento e do ambiente", () => {
    const inv = roomInventory(model.elements, model.spaces, toPlan, DEFAULT_CATALOG);
    const bath = model.spaces.find((s) => s.name === "Banheiro")!.globalId;
    const items = inv.get(bath)!;
    const base = roomRequests(bath, undefined, items, DEFAULT_CATALOG);
    // bacia (AF + esgoto) + lavatório (AF + esgoto) + chuveiro (AF + tomada + ralo)
    expect(countPoints(base)).toBe(7);
    const bacia = items.find((i) => i.detected === "bacia")!;
    const program: ProgramState = {
      rooms: {
        [bath]: {
          equipment: {
            [bacia.key]: { typeId: "bacia", include: true, reqs: [{ id: "x", componentId: "ponto-agua-fria", qty: 1, height: 250 }] },
            "manual-1": { typeId: "ducha-higienica", include: true, manual: { label: "Ducha higiênica" } },
          },
          extras: [{ id: "e", componentId: "tomada-media", qty: 1, height: 1100 }],
        },
      },
    };
    const custom = roomRequests(bath, program.rooms[bath], items, DEFAULT_CATALOG);
    expect(countPoints(custom)).toBe(1 + 2 + 3 + 1 + 1);
    expect(custom.find((r) => r.source.startsWith("Bacia"))!.req.height).toBe(250);
    expect(custom.filter((r) => r.center == null).map((r) => r.source)).toEqual(["Ducha higiênica", "Ambiente"]);
  });

  it("o programa é salvo e reaberto com o projeto", () => {
    const program: ProgramState = { rooms: { abc: { equipment: { k: { typeId: "bacia", include: false } }, extras: [] } } };
    const json = JSON.parse(JSON.stringify(serializeProject({ points: [], runs: [], circuits: [], program }, model.coordinates, "a.ifc")));
    expect(json.versao).toBe(4);
    expect(deserializeProject(json, model.coordinates).program).toEqual(program);
  });
});
