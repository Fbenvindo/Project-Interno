// Menu superior (por disciplina) e faixa de ferramentas de cada um.
import type { DraftCmd } from "../desenho/useDraftTool";

export type TopTab = "arquivo" | "criar" | "modificar" | "geral" | "modelo" | "programa" | "eletrica" | "hidraulica" | "incendio" | "climatizacao" | "pranchas";
export type DisciplineTab = "eletrica" | "hidraulica" | "incendio" | "climatizacao";

export const TOP_TABS: { id: TopTab; label: string }[] = [
  { id: "arquivo", label: "Arquivo" },
  { id: "criar", label: "Criar" },
  { id: "modificar", label: "Modificar" },
  { id: "geral", label: "Geral" },
  { id: "modelo", label: "Modelo" },
  { id: "programa", label: "Programa" },
  { id: "eletrica", label: "Elétrica" },
  { id: "hidraulica", label: "Hidráulica" },
  { id: "incendio", label: "Incêndio" },
  { id: "climatizacao", label: "Climatização" },
  { id: "pranchas", label: "Pranchas" },
];

/** Ferramenta ativa: define o painel da direita e o modo de edição. */
export type ToolSpec =
  | { kind: "propriedades" }
  | { kind: "locacao"; componentId: string }
  | { kind: "tracado"; typeId: string }
  | { kind: "circuitos" }
  | { kind: "calc"; which: "eletrica" | "hidraulica" | "hvac" }
  | { kind: "quantitativos" }
  | { kind: "interferencias" }
  | { kind: "pranchas" }
  | { kind: "biblioteca" }
  | { kind: "vinculos" }
  | { kind: "coordenadas" }
  | { kind: "desenho"; cmd: DraftCmd }
  | { kind: "programa"; section: "tipos" | "ambientes" };

export type Tool = ToolSpec & { n: number };

export type ActionId =
  | "abrirIfc"
  | "exemplo"
  | "exemploApartamento"
  | "vincularIfc"
  | "abrirProjeto"
  | "salvarProjeto"
  | "salvarProjetoComo"
  | "exportarIfc"
  | "temaClaro"
  | "temaEscuro"
  | "cores"
  | "vistaPlanta"
  | "vista3d"
  | "enquadrar"
  | "corte"
  | "removerCortes"
  | "exportarIfcDisciplinas"
  | "novaFolha"
  | "folhasPlantas"
  | "propriedades";

export interface RibbonButton {
  key: string;
  label: string;
  icon: string;
  tool?: ToolSpec;
  action?: ActionId;
  /** Exige um modelo aberto. */
  needsModel?: boolean;
}

export interface RibbonGroup {
  label: string;
  buttons: RibbonButton[];
}

export interface DisciplineCfg {
  label: string;
  /** Cor da disciplina (ícones e destaque) e cor de texto com contraste. */
  color: string;
  text: string;
  /** Grupos da biblioteca de componentes. */
  groups: string[];
  /** Tipos de trecho. */
  runs: string[];
}

export const DISCIPLINE_TABS: Record<DisciplineTab, DisciplineCfg> = {
  eletrica: {
    label: "Elétrica",
    color: "#F59E0B",
    text: "#B45309",
    groups: ["Iluminação", "Tomadas e comandos", "Telecom e segurança"],
    runs: ["eletroduto-pvc", "eletroduto-aco", "eletroduto-flexivel", "eletroduto-pead", "eletrocalha", "eletroduto-dados"],
  },
  hidraulica: {
    label: "Hidráulica",
    color: "#0284C7",
    text: "#0369A1",
    groups: ["Hidráulica"],
    runs: ["agua-fria", "agua-quente", "esgoto", "pluvial", "gas-cobre"],
  },
  incendio: {
    label: "Incêndio",
    color: "#DC2626",
    text: "#B91C1C",
    groups: ["Incêndio"],
    runs: ["incendio-aco"],
  },
  climatizacao: {
    label: "Climatização",
    color: "#0D9488",
    text: "#0F766E",
    groups: ["Climatização"],
    runs: ["duto-retangular"],
  },
};

const draw = (cmd: DraftCmd, label: string, icon: string): RibbonButton => ({ key: `d-${cmd}`, label, icon, tool: { kind: "desenho", cmd }, needsModel: true });
const loc = (key: string, label: string, icon: string, componentId: string): RibbonButton => ({ key, label, icon, tool: { kind: "locacao", componentId }, needsModel: true });
const run = (key: string, label: string, icon: string, typeId: string): RibbonButton => ({ key, label, icon, tool: { kind: "tracado", typeId }, needsModel: true });

export const RIBBON: Record<TopTab, RibbonGroup[]> = {
  arquivo: [
    {
      label: "Projeto",
      buttons: [
        { key: "novo-projeto", label: "Novo projeto", icon: "importar", action: "abrirIfc" },
        { key: "abrir-projeto", label: "Abrir projeto", icon: "abrir", action: "abrirProjeto" },
        { key: "salvar-projeto", label: "Salvar", icon: "salvar", action: "salvarProjeto", needsModel: true },
        { key: "salvar-como", label: "Salvar como", icon: "salvar", action: "salvarProjetoComo", needsModel: true },
      ],
    },
    {
      label: "Referências (IFC de terceiros)",
      buttons: [
        { key: "vincular", label: "Vincular IFC", icon: "vinculo", action: "vincularIfc", needsModel: true },
        { key: "exemplo", label: "Exemplo", icon: "exemplo", action: "exemplo" },
        { key: "exemplo-apto", label: "Exemplo apartamento", icon: "planta", action: "exemploApartamento" },
      ],
    },
    {
      label: "Exportar",
      buttons: [
        { key: "exportar-ifc", label: "Exportar IFC", icon: "exportar", action: "exportarIfc", needsModel: true },
        { key: "exportar-ifc-disc", label: "IFC por disciplina", icon: "exportar", action: "exportarIfcDisciplinas", needsModel: true },
      ],
    },
    {
      label: "Biblioteca",
      buttons: [{ key: "familias", label: "Importar elementos em IFC", icon: "familia", tool: { kind: "biblioteca" } }],
    },
    {
      label: "Fundo",
      buttons: [
        { key: "tema-claro", label: "Branco", icon: "sol", action: "temaClaro" },
        { key: "tema-escuro", label: "Preto", icon: "lua", action: "temaEscuro" },
      ],
    },
  ],
  criar: [
    {
      label: "Desenho",
      buttons: [
        draw("linha", "Linha", "dLinha"),
        draw("arco", "Arco", "dArco"),
        draw("circulo", "Círculo", "dCirculo"),
        draw("elipse", "Elipse", "dElipse"),
      ],
    },
    {
      label: "Formas",
      buttons: [
        draw("quadrado", "Quadrado", "dQuadrado"),
        draw("retangulo", "Retângulo", "dRetangulo"),
        draw("triangulo", "Triângulo", "dTriangulo"),
        draw("poligonal", "Poligonal", "dPoligonal"),
      ],
    },
    {
      label: "Anotação",
      buttons: [
        draw("texto", "Texto", "dTexto"),
        draw("cota-ortogonal", "Cota ortogonal", "dCotaOrto"),
        draw("cota-inclinada", "Cota inclinada", "dCotaInclinada"),
        draw("cota-angular", "Cota angular", "dCotaAngular"),
        draw("coordenada", "Indicar coordenada", "gIndicar"),
      ],
    },
  ],
  modificar: [
    {
      label: "Área de transferência",
      buttons: [draw("copiar", "Copiar", "mCopiar"), draw("recortar", "Recortar", "mRecortar"), draw("colar", "Colar", "mColar")],
    },
    {
      label: "Modificar",
      buttons: [draw("mover", "Mover", "mMover"), draw("apagar", "Apagar", "mApagar"), draw("estender", "Estender", "mEstender"), draw("conectar", "Conectar", "mConectar")],
    },
  ],
  geral: [
    {
      label: "Corte",
      buttons: [
        draw("corte-selecao", "Corte pela seleção", "corte"),
        draw("corte-linha", "Corte por linha", "gCorteLinha"),
        { key: "remover-cortes", label: "Remover cortes", icon: "gSemCorte", action: "removerCortes", needsModel: true },
      ],
    },
    {
      label: "Vistas",
      buttons: [draw("ampliacao", "Ampliação", "gAmpliacao"), draw("vista-3d", "Vista 3D no local", "gVista3d")],
    },
    {
      label: "Medir",
      buttons: [draw("medir-distancia", "Distância", "gMedDist"), draw("medir-area", "Área", "gMedArea"), draw("medir-angulo", "Ângulo", "gMedAng")],
    },
  ],
  modelo: [
    {
      label: "Vistas",
      buttons: [
        { key: "vista-planta", label: "Planta", icon: "planta", action: "vistaPlanta", needsModel: true },
        { key: "vista-3d", label: "3D", icon: "3d", action: "vista3d", needsModel: true },
        { key: "enquadrar", label: "Enquadrar", icon: "enquadrar", action: "enquadrar", needsModel: true },
        { key: "corte", label: "Corte", icon: "corte", action: "corte", needsModel: true },
        { key: "cores", label: "Cores", icon: "cores", action: "cores", needsModel: true },
      ],
    },
    {
      label: "Referências",
      buttons: [
        { key: "vinculos", label: "Vínculos IFC", icon: "vinculo", tool: { kind: "vinculos" }, needsModel: true },
        { key: "coordenadas", label: "Coordenadas", icon: "coordenadas", tool: { kind: "coordenadas" }, needsModel: true },
      ],
    },
    {
      label: "Consulta",
      buttons: [
        { key: "selecionar", label: "Selecionar", icon: "selecionar", tool: { kind: "propriedades" }, needsModel: true },
        { key: "propriedades", label: "Propriedades", icon: "propriedades", action: "propriedades", needsModel: true },
        { key: "quantitativos", label: "Quantitativos", icon: "quantitativos", tool: { kind: "quantitativos" }, needsModel: true },
        { key: "interferencias", label: "Interferências", icon: "interferencias", tool: { kind: "interferencias" }, needsModel: true },
      ],
    },
  ],
  programa: [
    {
      label: "Padrão do escritório",
      buttons: [{ key: "prog-tipos", label: "Equipamentos", icon: "equipamento", tool: { kind: "programa", section: "tipos" } }],
    },
    {
      label: "Projeto",
      buttons: [{ key: "prog-ambientes", label: "Ambientes", icon: "planta", tool: { kind: "programa", section: "ambientes" }, needsModel: true }],
    },
  ],
  eletrica: [
    {
      label: "Pontos",
      buttons: [
        loc("tomada", "Tomada", "tomada", "tomada-baixa"),
        loc("interruptor", "Interruptor simples", "interruptor", "interruptor-simples"),
        loc("interruptor-paralelo", "Paralelo", "interruptor", "interruptor-paralelo"),
        loc("interruptor-intermediario", "Intermediário", "interruptor", "interruptor-intermediario"),
        loc("interruptor-bipolar", "Bipolar", "interruptor", "interruptor-bipolar"),
        loc("luminaria", "Luminária", "luminaria", "lum-embutir-6060"),
        loc("quadro", "Quadro", "quadro", "quadro-distribuicao"),
      ],
    },
    {
      label: "Telecom",
      buttons: [
        loc("dados", "Dados / TV", "dados", "ponto-dados"),
        loc("wifi", "Wi-Fi", "wifi", "access-point"),
        loc("cftv", "CFTV", "camera", "camera-cftv"),
      ],
    },
    {
      label: "Infraestrutura",
      buttons: [
        run("eletroduto", "Eletroduto rígido", "eletroduto", "eletroduto-pvc"),
        run("eletroduto-flex", "Eletroduto flexível", "eletrodutoFlex", "eletroduto-flexivel"),
        run("eletrocalha", "Eletrocalha", "eletrocalha", "eletrocalha"),
      ],
    },
    {
      label: "Circuitos",
      buttons: [
        { key: "circuitos", label: "Circuitos", icon: "circuito", tool: { kind: "circuitos" }, needsModel: true },
        { key: "queda", label: "Queda de tensão", icon: "calculo", tool: { kind: "calc", which: "eletrica" } },
      ],
    },
  ],
  hidraulica: [
    {
      label: "Pontos",
      buttons: [
        loc("lavatorio", "Lavatório", "lavatorio", "lavatorio"),
        loc("bacia", "Bacia", "bacia", "bacia-sanitaria"),
        loc("chuveiro", "Chuveiro", "chuveiro", "chuveiro"),
        loc("pia", "Pia", "pia", "pia-cozinha"),
        loc("registro", "Registro", "registro", "registro-gaveta"),
        loc("ralo", "Ralo", "ralo", "ralo-sifonado"),
      ],
    },
    {
      label: "Tubulações",
      buttons: [
        run("agua-fria", "Água fria", "tubulacao", "agua-fria"),
        run("agua-quente", "Água quente", "tubulacao", "agua-quente"),
        run("esgoto", "Esgoto", "tubulacao", "esgoto"),
        run("pluvial", "Pluvial", "gota", "pluvial"),
        run("gas", "Gás", "tubulacao", "gas-cobre"),
      ],
    },
    {
      label: "Cálculo",
      buttons: [{ key: "calc-af", label: "Água fria", icon: "calculo", tool: { kind: "calc", which: "hidraulica" } }],
    },
  ],
  incendio: [
    {
      label: "Pontos",
      buttons: [
        loc("sprinkler", "Sprinkler", "sprinkler", "sprinkler-pendente"),
        loc("detector", "Detector", "detector", "detector-fumaca"),
        loc("acionador", "Acionador", "acionador", "acionador-manual"),
        loc("sirene", "Sirene", "sirene", "sirene"),
        loc("hidrante", "Hidrante", "hidrante", "abrigo-hidrante"),
      ],
    },
    {
      label: "Tubulações",
      buttons: [run("rede-incendio", "Rede", "tubulacao", "incendio-aco")],
    },
  ],
  climatizacao: [
    {
      label: "Distribuição de ar",
      buttons: [
        loc("difusor", "Difusor", "difusor", "difusor-6060"),
        loc("grelha", "Grelha", "grelha", "grelha-retorno"),
        run("duto", "Duto", "duto", "duto-retangular"),
      ],
    },
    {
      label: "Equipamentos",
      buttons: [
        loc("hiwall", "Hi-wall", "evaporadora", "evaporadora-hiwall"),
        loc("cassete", "Cassete", "equipamento", "evaporadora-cassete"),
        loc("condensadora", "Condensadora", "condensadora", "condensadora"),
        loc("exaustor", "Exaustor", "exaustor", "exaustor"),
      ],
    },
    {
      label: "Cálculo",
      buttons: [{ key: "calc-duto", label: "Dutos", icon: "calculo", tool: { kind: "calc", which: "hvac" } }],
    },
  ],
  pranchas: [
    {
      label: "Prancha",
      buttons: [
        { key: "prancha", label: "Folhas", icon: "prancha", tool: { kind: "pranchas" }, needsModel: true },
        { key: "nova-folha", label: "Nova folha", icon: "prancha", action: "novaFolha", needsModel: true },
        { key: "folhas-plantas", label: "Folhas das plantas", icon: "planta", action: "folhasPlantas", needsModel: true },
      ],
    },
  ],
};

/** Disciplina da faixa (para cores e filtros) a partir da aba superior. */
export const disciplineOfTab = (t: TopTab): DisciplineCfg | null => (t in DISCIPLINE_TABS ? DISCIPLINE_TABS[t as DisciplineTab] : null);

/** Chave do botão que corresponde à ferramenta ativa (para destacá-lo). */
export function sameTool(a: ToolSpec, b: ToolSpec | undefined): boolean {
  if (!b || a.kind !== b.kind) return false;
  if (a.kind === "locacao" && b.kind === "locacao") return a.componentId === b.componentId;
  if (a.kind === "tracado" && b.kind === "tracado") return a.typeId === b.typeId;
  if (a.kind === "calc" && b.kind === "calc") return a.which === b.which;
  if (a.kind === "programa" && b.kind === "programa") return a.section === b.section;
  if (a.kind === "desenho" && b.kind === "desenho") return a.cmd === b.cmd;
  return true;
}
