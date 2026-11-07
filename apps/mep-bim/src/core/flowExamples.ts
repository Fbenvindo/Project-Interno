// Exemplos prontos de fluxograma (para conhecer a ferramenta e partir de um modelo).
import { newBuildingId, type BuildingFloor, type BuildingProfile } from "./building";
import { applyProfile, bandHeight, bandTop, blockRect, FLOW_BLOCK_BY_ID, newFlowId, type FlowBlock, type FlowData, type FlowLink, type FlowLinkKind } from "./flow";

/**
 * Edifício com 2 torres (A: 1º ao 12º; B: 1º ao 16º), 2º subsolo, 1º subsolo e térreo comuns,
 * entrada de energia em baixa tensão e medição nos andares por barramento blindado: em cada
 * andar, caixa de derivação → caixa MEC IV → 4 quadros de apartamento.
 */
export function exampleTwoTowersBusway(): { profile: BuildingProfile; flow: FlowData } {
  const towers = [
    { id: "torre-a", name: "Torre A", floors: 12 },
    { id: "torre-b", name: "Torre B", floors: 16 },
  ];
  const floor = (name: string, height: number, common: boolean, ts: string[] = []): BuildingFloor => ({ id: newBuildingId("pav-"), name, height, repeat: 1, common, towers: ts });
  const floors: BuildingFloor[] = [floor("2º Subsolo", 3, true), floor("1º Subsolo", 3, true), floor("Térreo", 4.5, true)];
  for (let n = 1; n <= Math.max(...towers.map((t) => t.floors)); n++)
    floors.push(floor(`${n}º Pavimento`, 2.88, false, towers.filter((t) => n <= t.floors).map((t) => t.id)));
  const profile: BuildingProfile = { towers: towers.map(({ id, name }) => ({ id, name })), floors, baseElevation: -6 };

  const base: FlowData = { discipline: "eletrica", layout: "pavimentos", storeys: [], bandH: 3, towers: [], blocks: [], links: [] };
  let flow = applyProfile(base, profile);
  // Mais espaço nas faixas com mais blocos (térreo e 1º subsolo).
  flow = { ...flow, towers: flow.towers.map((t) => ({ ...t, width: 18 })), bandHs: flow.storeys.map((s) => (s === "Térreo" || s === "1º Subsolo" ? 4.5 : null)) };

  const blocks: FlowBlock[] = [];
  const links: FlowLink[] = [];
  const band = (name: string) => flow.storeys.indexOf(name);
  const top = (name: string) => bandTop(flow, band(name));
  const height = (name: string) => bandHeight(flow, band(name));
  const add = (kind: string, tag: string, x: number, storey: string, params: Record<string, string | number> = {}, extra: Partial<FlowBlock> = {}): FlowBlock => {
    const d = FLOW_BLOCK_BY_ID[kind];
    const b: FlowBlock = { id: newFlowId("b"), kind, tag, x, y: 0, params: { ...Object.fromEntries(d.params.map((p) => [p.key, p.default])), ...params }, ...extra };
    b.y = Math.round((top(storey) + (height(storey) - blockRect(b).h) / 2) * 100) / 100;
    blocks.push(b);
    return b;
  };
  const link = (a: FlowBlock, b: FlowBlock, kind: FlowLinkKind = "bt", label?: string) => links.push({ id: newFlowId("l"), from: a.id, to: b.id, kind, ...(label ? { label } : {}) });

  // Áreas comuns: entrada BT no térreo, QGBT no 1º subsolo, bombas no 2º subsolo.
  const conc = add("concessionaria-bt", "CONC", 7, "Térreo", { tensao: "380/220" });
  const ent = add("entrada-bt", "ENT", 12.5, "Térreo", { disjuntor: 1600 });
  const qgbt = add("qgbt", "QGBT", 12.5, "1º Subsolo", { corrente: 2000, tensao: "380/220" });
  const qdc = add("qd", "QDC", 26, "Térreo", { tipo: "QD", quantidade: 1, uso: "áreas comuns" });
  const qfb = add("qfb", "QFB", 12.5, "2º Subsolo", { uso: "recalque e incêndio", potencia: "2×7,5" });
  link(conc, ent, "bt", "ramal de entrada BT");
  link(ent, qgbt, "bt", "alimentador geral");
  link(qgbt, qdc);
  link(qgbt, qfb);

  // Cada torre: barramento no shaft, do 1º subsolo ao último andar; por andar, derivação → MEC IV → QDs.
  let x0 = 3.2;
  for (const t of towers) {
    const busX = x0 + 1.5;
    const y0 = top(`${t.floors}º Pavimento`) + 0.3;
    const y1 = top("1º Subsolo") + height("1º Subsolo") - 0.3;
    const bus = add("barramento", `BB-${t.name.slice(-1)}`, busX, "1º Subsolo", { corrente: t.floors > 12 ? 800 : 630, material: "alumínio" });
    bus.y = Math.round(y0 * 100) / 100;
    bus.h = Math.round((y1 - y0) * 100) / 100;
    link(qgbt, bus, "bt", `${bus.params.corrente} A`);
    for (let n = 1; n <= t.floors; n++) {
      const s = `${n}º Pavimento`;
      const cd = add("derivacao", `CD-${t.name.slice(-1)}${n}`, x0 + 3, s, { corrente: 125 });
      const mec = add("mec-iv", `MEC-${t.name.slice(-1)}${n}`, x0 + 5.8, s, { disjuntor: 125 });
      const qd = add("qd", `QD-${t.name.slice(-1)}${n}`, x0 + 10, s, { tipo: "QD", quantidade: 4, uso: "aptos" });
      link(bus, cd);
      link(cd, mec);
      link(mec, qd);
    }
    x0 += 18;
  }
  return { profile, flow: { ...flow, blocks, links } };
}
