// Gera samples/familias-exemplo.sebfam no mesmo formato do plugin SmartEasyBIM para Revit
// (coordenadas da família em mm, eixos do Revit: X, Y, Z para cima).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function mesh() {
  const posicoes = [];
  const indices = [];
  const box = (x0, y0, z0, x1, y1, z1) => {
    const b = posicoes.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) posicoes.push(x, y, z);
    for (const f of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) indices.push(...f.map((i) => b + i));
  };
  const cyl = (cx, cy, z0, z1, r, n = 24) => {
    const b = posicoes.length / 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      posicoes.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z0, cx + r * Math.cos(a), cy + r * Math.sin(a), z1);
    }
    posicoes.push(cx, cy, z0, cx, cy, z1);
    const c0 = b + 2 * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(b + 2 * i, b + 2 * j, b + 2 * j + 1, b + 2 * i, b + 2 * j + 1, b + 2 * i + 1, c0, b + 2 * j, b + 2 * i, c0 + 1, b + 2 * i + 1, b + 2 * j + 1);
    }
  };
  const done = () => {
    const min = [0, 1, 2].map((k) => Math.min(...posicoes.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...posicoes.filter((_, i) => i % 3 === k)));
    return { malha: { posicoes: posicoes.map((v) => Math.round(v * 10) / 10), indices }, min, max };
  };
  return { box, cyl, done };
}

const p = (nome, valor, extra = {}) => ({ nome, instancia: false, valor, ...extra });

// Luminária de embutir hospedada no forro: corpo abaixo do plano do forro (Z ≤ 0).
const lum = (lado, potencia, fluxo) => {
  const m = mesh();
  const h = lado / 2;
  m.box(-h, -h, -70, h, h, 0);
  m.box(-h + 40, -h + 40, -78, h - 40, h - 40, -70);
  return { nome: `${lado}x${lado} - ${potencia}W`, parametros: [p("Potência", potencia, { nativo: "FBX_LIGHT_WATTAGE", texto: `${potencia} W`, unidade: "W" }), p("Fluxo luminoso", fluxo, { nativo: "FBX_LIGHT_LIMUNOUS_FLUX", unidade: "lm" }), p("Tensão", 220, { nativo: "RBS_ELEC_VOLTAGE", unidade: "V" }), p("Fabricante", "Exemplo Iluminação"), p("Modelo", `LX-${lado}`), p("Altura", 70, { nativo: "GENERIC_HEIGHT", unidade: "mm" })], ...m.done() };
};

// Tomada hospedada na parede: placa e caixa avançando para +Y a partir da face da parede.
const tomada = (nome, alt) => {
  const m = mesh();
  m.box(-37.5, 0, -60, 37.5, 8, 60);
  m.cyl(0, 8, -20, 20, 14, 16);
  const done = m.done();
  // cilindro deitado: troca Y/Z do cilindro (simplificação: mantém a peça pequena)
  return { nome, parametros: [p("Carga aparente", 100, { nativo: "RBS_ELEC_APPARENT_LOAD", unidade: "VA" }), p("Tensão", 127, { nativo: "RBS_ELEC_VOLTAGE", unidade: "V" }), p("Altura de montagem", alt, { instancia: true, unidade: "mm" }), p("Linha", "Exemplo 4x2")], ...done };
};

// Quadro sem hospedeiro: frente voltada para −Y (vista Frontal do Revit).
const quadro = (nome, w, h, d, disj) => {
  const m = mesh();
  m.box(-w / 2, 0, 0, w / 2, d, h);
  m.box(-w / 2 + 20, -6, 20, w / 2 - 20, 0, h - 20);
  return { nome, parametros: [p("Tensão", 220, { nativo: "RBS_ELEC_VOLTAGE", unidade: "V" }), p("Disjuntores", disj), p("Grau de proteção", "IP40")], ...m.done() };
};

const pkg = {
  formato: "smarteasybim/familias",
  versao: 1,
  origem: "Revit 2024 (exemplo gerado)",
  arquivo: "Biblioteca exemplo.rvt",
  exportadoEm: "2026-11-01T12:00:00Z",
  unidades: "mm",
  familias: [
    {
      uid: "OST_LightingFixtures:Luminária de embutir LED",
      nome: "Luminária de embutir LED",
      categoria: "Luminárias",
      categoriaRevit: "OST_LightingFixtures",
      hospedagem: "teto",
      posicionamento: "OneLevelBasedHosted",
      conectores: [{ dominio: "DomainElectrical", forma: "Round", sistema: "PowerCircuit", origem: [0, 0, 0], direcao: [0, 0, 1] }],
      tipos: [lum(600, 36, 4000), lum(625, 40, 4400)],
      avisos: [],
    },
    {
      uid: "OST_ElectricalFixtures:Tomada 2P+T 10A",
      nome: "Tomada 2P+T 10A",
      categoria: "Dispositivos elétricos",
      categoriaRevit: "OST_ElectricalFixtures",
      hospedagem: "parede",
      posicionamento: "OneLevelBasedHosted",
      conectores: [{ dominio: "DomainElectrical", forma: "Round", sistema: "PowerCircuit", origem: [0, 0, 0], direcao: [0, -1, 0] }],
      tipos: [tomada("Baixa", 300), tomada("Média", 1100)],
      avisos: [],
    },
    {
      uid: "OST_ElectricalEquipment:Quadro de distribuição de sobrepor",
      nome: "Quadro de distribuição de sobrepor",
      categoria: "Equipamento elétrico",
      categoriaRevit: "OST_ElectricalEquipment",
      hospedagem: "nenhuma",
      posicionamento: "OneLevelBased",
      conectores: [],
      tipos: [quadro("12 disjuntores", 400, 500, 120, 12), quadro("24 disjuntores", 500, 700, 140, 24)],
      avisos: [],
    },
  ],
};

writeFileSync(join(root, "samples", "familias-exemplo.sebfam"), JSON.stringify(pkg));
console.log("samples/familias-exemplo.sebfam");
