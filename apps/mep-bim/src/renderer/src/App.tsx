import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DISCIPLINE_BY_ID, DISCIPLINES, getTypeLabel } from "../../core/disciplines";
import { COMPONENT_BY_ID } from "../../core/library";
import { sizeMeters } from "../../core/placement";
import { pointProperties, pointSize, pointToElement, type PlacedPoint } from "../../core/points";
import type { Circuit } from "../../core/circuits";
import type { Discipline, ElementInfo, Vec3 } from "../../core/types";
import { loadIfc, type LoadedModel } from "../../ifc/loadIfc";
import { desktop, getIfcApi, openIfc } from "./platform";
import { Viewer, type ColorMode } from "./viewer/Viewer";
import { QuantitiesPanel } from "./components/QuantitiesPanel";
import { ClashPanel } from "./components/ClashPanel";
import { CalcPanel } from "./components/CalcPanel";
import type { OpenedFile } from "../../shared/ipc";
import { LocacaoPanel } from "./locacao/LocacaoPanel";
import { TracadoPanel } from "./tracado/TracadoPanel";
import { CircuitosPanel } from "./circuitos/CircuitosPanel";
import { PlanView } from "./planta/PlanView";
import { PlanEditor } from "./planta/PlanEditor";
import { NO_SECTION, SectionTools, sectionToPlanes, type SectionState } from "./viewer/SectionTools";
import { FolhaPanel } from "./planta/FolhaPanel";
import { renderSheetViews, type SheetViewport } from "../../core/plan/sheet";
import type { PlanDrawing } from "../../core/plan/drawing";
import { beamOptions, docPlanOf, viewFilter, type ViewDef } from "../../core/views";
import { newSheetId, viewDrawing, viewSubtitle, viewTitle, type ModelContext, type SheetDef } from "../../core/viewDrawing";
import { sectionFrame } from "../../core/plan/elevation";
import { VistasBrowser } from "./shell/VistasBrowser";
import { VistaPanel } from "./shell/VistaPanel";
import { connectedPairs, runElements, runFittings, runIdOfElement, segmentIndexOf, runProperties, runSegments, RUN_TYPE_BY_ID, segmentElementId, fittingElementId } from "../../core/runs";
import { usePointsStore } from "./locacao/usePointsStore";
import { alignKey, DEFAULT_ALIGN, federate, prepareLink, type LinkData, type LinkMeta } from "../../ifc/federate";
import { openIfcMany, readIfcPath } from "./platform";
import { moveNetwork, type MoveSelection } from "../../core/runEdit";
import { applyInstall, boxElements, boxIndexOf, boxProperties, DEFAULT_INSTALL, isConduitRun, pullBoxes, runFloorProbeY, type InstallMode } from "../../core/conduits";
import { storeyAt } from "../../core/points";
import { InstalacoesPanel } from "./tracado/InstalacoesPanel";
import { defaultTitleBlockId, titleBlockById, useTitleBlocks } from "./planta/titleBlocks";
import { setHostLoader, setProjectFile, useProjectFile, useProjectFiles } from "./locacao/useProjectFiles";
import { EMPTY_FILTERS, Navigator, NO_STOREY, type Filters } from "./shell/Navigator";
import { Ribbon } from "./shell/Ribbon";
import { ParamsPanel } from "./shell/ParamsPanel";
import { BibliotecaPanel } from "./library/BibliotecaPanel";
import { ProgramaPanel, ProgramaTiposOnly } from "./programa/ProgramaPanel";
import { VinculosPanel } from "./links/VinculosPanel";
import { CoordenadasPanel } from "./coords/CoordenadasPanel";
import { useCursor } from "./coords/cursor";
import { EMPTY_GEOREF, effectiveGeoref, fmtCoord, toMap, type Georef } from "../../core/georef";
import { loadFamilyLibrary } from "./library/familyLibrary";
import { useDraftTool, CMD_LABEL, isCreateCmd, isMeasureCmd } from "./desenho/useDraftTool";
import { DesenhoPanel } from "./desenho/DesenhoPanel";
import { CoordinateSystem } from "../../core/math";
import { color3d } from "../../core/plan/style";
import { getLibraryVersion, onLibraryChange } from "../../core/library";
import { makeCeilingResolver, makeSlabProbe } from "./locacao/ceiling";
import { Icon, LogoMark } from "./shell/icons";
import { DISCIPLINE_TABS, TOP_TABS, type ActionId, type DisciplineTab, type Tool, type ToolSpec, type TopTab } from "./shell/ribbonConfig";

type View = "planta" | "3d" | "prancha" | "vazio";
type TabView = Exclude<View, "vazio">;
const TABS: TabView[] = ["planta", "3d", "prancha"];
const TAB_LABEL: Record<TabView, string> = { planta: "Planta", "3d": "Vista 3D", prancha: "Prancha" };
const IDENTITY_CS = new CoordinateSystem();
type Theme = "claro" | "escuro";

const THEME_KEY = "smarteasybim.tema";
function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "escuro" ? "escuro" : "claro";
  } catch {
    return "claro";
  }
}

/** Direção de enquadramento para pontos: de frente para a parede ou por baixo do teto. */
function viewDirectionFor(points: PlacedPoint[]): Vec3 | undefined {
  if (!points.length) return undefined;
  const mountings = new Set(points.map((p) => COMPONENT_BY_ID[p.componentId].mounting));
  if (mountings.size !== 1) return undefined;
  const [m] = mountings;
  if (m === "teto") return [0.5, -1, 0.7];
  if (m === "piso") return [0.5, 1.2, 0.7];
  const x = points.reduce((s, p) => s + Math.sin(p.rotation), 0);
  const z = points.reduce((s, p) => s + Math.cos(p.rotation), 0);
  const len = Math.hypot(x, z);
  return len < 1e-6 ? undefined : [x / len, 0.35, z / len];
}

const TOOL_HINT: Record<ToolSpec["kind"], string> = {
  propriedades: "Clique: selecionar (Ctrl soma) · arrastar →: só o que fica inteiro na janela · arrastar ←: tudo o que ela toca · botão do meio: mover · 3D: botão direito gira · duplo clique em texto: editar · Esc: limpar",
  locacao: "Clique na planta para locar · Esc cancela",
  tracado: "Clique para inserir vértices · duplo clique ou Enter termina · Esc cancela",
  circuitos: "Selecione pontos na vista e atribua ao circuito",
  calc: "Selecione um segmento para aproveitar comprimento e dimensão",
  quantitativos: "Clique em uma linha para localizar os elementos",
  interferencias: "Clique em uma interferência para enquadrá-la",
  pranchas: "Folhas com as vistas de Documentação · roda do mouse: zoom · arrastar: mover · duplo clique: abrir a vista",
  biblioteca: "Importe elementos de IFC (ou famílias do Revit), confira a configuração e loque-os como qualquer item da biblioteca",
  programa: "Defina as instalações por tipo de equipamento e por ambiente e gere os pontos no modelo",
  vinculos: "Modelos de outras disciplinas sobrepostos ao principal, pelas coordenadas do projeto",
  coordenadas: "Ponto base, survey point, sistema de referência e norte do projeto",
  instalacoes: "Medidas de cada forma de instalação dos eletrodutos neste empreendimento",
  desenho: "Siga as instruções sobre a planta · Enter conclui · Esc cancela",
};

export function App() {
  const viewerHost = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  /** Modelo principal (o IFC aberto). O app trabalha com o federado: principal + vínculos visíveis. */
  const [hostModel, setModel] = useState<LoadedModel | null>(null);
  const [linkData, setLinkData] = useState<Map<string, LinkData>>(() => new Map());
  const [linkStatus, setLinkStatus] = useState<Record<string, string>>({});
  const linkSlot = useRef(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<number[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>("disciplina");

  // Casca: aba superior, ferramenta ativa, vista central, painéis e tema.
  const [top, setTop] = useState<TopTab>("arquivo");
  const toolCounter = useRef(0);
  const [tool, setToolState] = useState<Tool>({ kind: "propriedades", n: 0 });
  /** Disciplina em que a ferramenta foi escolhida (filtra biblioteca e tipos de trecho). */
  const [toolDisc, setToolDisc] = useState<DisciplineTab | null>(null);
  const [view, setView] = useState<View>("3d");
  /** Abas fechadas pelo usuário (reabrem ao abrir uma vista desse tipo, ou pelo "+"). */
  const [closedTabs, setClosedTabs] = useState<TabView[]>([]);
  useEffect(() => {
    if (view !== "vazio") setClosedTabs((c) => (c.includes(view) ? c.filter((x) => x !== view) : c));
  }, [view]);
  const [leftOpen, setLeftOpen] = useState(true);
  /** Coluna esquerda: Propriedades (em cima) e Navegador (embaixo), cada um recolhível. */
  const [propsOpen, setPropsOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);
  const [browserOpen, setBrowserOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [fitSignal, setFitSignal] = useState(0);

  // Pavimento ativo (planta e prancha), vista 3D isolada e cortes.
  const [storey, setStorey] = useState<string>("");
  const [storeyView, setStoreyView] = useState<string | null>(null);
  const [editorCut, setEditorCut] = useState(1.2);
  const [section, setSection] = useState<SectionState>(NO_SECTION);
  const [sectionOpen, setSectionOpen] = useState(false);

  // Famílias do Revit importadas: carregadas na abertura; mudanças redesenham o app.
  useEffect(() => void loadFamilyLibrary(), []);
  const libraryVersion = useSyncExternalStore(onLibraryChange, getLibraryVersion, getLibraryVersion);

  const store = usePointsStore();
  const fedLinks = useMemo(
    () => store.links.filter((m) => linkData.has(m.id)).map((meta) => ({ meta, data: linkData.get(meta.id)! })),
    [store.links, linkData],
  );
  const model = useMemo(() => (hostModel ? federate(hostModel, fedLinks) : null), [hostModel, fedLinks]);
  /** Coordenadas efetivas do projeto: as do IFC principal ou as informadas no projeto. */
  const georef = useMemo(() => (hostModel ? effectiveGeoref(hostModel.georef, store.georef) : EMPTY_GEOREF), [hostModel, store.georef]);
  // ---- Vistas: Trabalho / Documentação, vistas 3D e folhas ----------------------------------
  /** Planta aberta: "trab" ou "doc" do pavimento atual, ou "view:<id>" (ampliação, corte, planta extra). */
  const [planKey, setPlanKey] = useState<string>("trab");
  /** Plantas de trabalho: tipo (piso/teto) e vigas — as de documentação guardam isso na própria vista. */
  const [workDisplay, setWorkDisplay] = useState<Pick<ViewDef, "planType" | "showBeams" | "showBeamText">>({ planType: "piso", showBeams: true, showBeamText: true });
  const [view3dId, setView3dId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [moveMode, setMoveMode] = useState(false);
  const [snapshots, setSnapshots] = useState<Map<string, { href: string; aspect: number }>>(() => new Map());
  /** Vista pelo id (as plantas de documentação existem mesmo sem terem sido alteradas). */
  const resolveView = useCallback(
    (id: string): ViewDef | null => store.views.find((v) => v.id === id) ?? (id.startsWith("doc-planta:") ? docPlanOf(store.views, id.slice(11)) : null),
    [store.views],
  );
  const view3dDef = view3dId ? (store.views.find((v) => v.id === view3dId) ?? null) : null;
  /** Ações de folhas da faixa (definidas mais abaixo, depois das funções de folha). */
  const sheetActionRef = useRef<((a: "nova" | "plantas") => void) | null>(null);
  const georefRef = useRef(georef);
  georefRef.current = georef;
  const linksRef = useRef(store.links);
  linksRef.current = store.links;
  // Alinhamento do vínculo (ou o survey point do projeto) mudou: reposiciona a partir do arquivo lido.
  useEffect(() => {
    if (!hostModel) return;
    let changed = false;
    const next = new Map(linkData);
    for (const m of store.links) {
      const d = linkData.get(m.id);
      if (!d) continue;
      const align = m.align ?? DEFAULT_ALIGN;
      if (d.alignKey === alignKey(align, georef.map)) continue;
      next.set(m.id, prepareLink(m.id, d.slot, d.raw, hostModel, align, georef.map));
      changed = true;
    }
    if (changed) setLinkData(next);
  }, [hostModel, store.links, linkData, georef]);
  const [hostPath, setHostPath] = useState<string | null>(null);
  const files = useProjectFiles(store, model, fileName, () => setSelection([]), hostPath);
  const pointElements = useMemo(() => store.points.map(pointToElement), [store.points]);
  const runElementList = useMemo(() => (model ? runElements(store.runs, model.storeyLevels) : []), [store.runs, model]);
  const boxes = useMemo(() => pullBoxes(store.runs, store.points), [store.runs, store.points]);
  const boxElementList = useMemo(() => (model ? boxElements(boxes, store.runs, model.storeyLevels) : []), [boxes, store.runs, model]);
  const allElements = useMemo(
    () => (model ? [...model.elements, ...pointElements, ...runElementList, ...boxElementList] : []),
    [model, pointElements, runElementList, boxElementList],
  );
  const elementById = useMemo(() => new Map(allElements.map((e) => [e.expressID, e])), [allElements]);
  const connected = useMemo(() => connectedPairs(store.runs, store.points), [store.runs, store.points]);
  const meshById = useMemo(() => new Map(model?.meshes.map((m) => [m.expressID, m]) ?? []), [model]);

  const chooseTool = useCallback(
    (spec: ToolSpec, disc: DisciplineTab | null = null) => {
      setToolState({ ...spec, n: ++toolCounter.current } as Tool);
      setToolDisc(disc);
      if (spec.kind === "pranchas") setView("prancha");
      else if (spec.kind === "locacao" || spec.kind === "tracado") setView("planta");
      // Medir funciona na planta, nos cortes e no 3D: fica na vista atual (da folha vai para a planta).
      else if (spec.kind === "desenho" && isMeasureCmd(spec.cmd)) setView((v) => (v === "prancha" || v === "vazio" ? "planta" : v));
      else if (spec.kind === "desenho" && spec.cmd !== "corte-selecao") setView("planta");
      setRightOpen(true);
    },
    [],
  );

  const chooseTop = useCallback(
    (t: TopTab) => {
      setTop(t);
      // Arquivo mantém a ferramenta (salvar no meio da edição); as demais abas começam pela consulta.
      if (t === "pranchas") chooseTool({ kind: "pranchas" });
      else if (t === "programa" && t !== top) chooseTool({ kind: "programa", section: "ambientes" });
      else if (t !== "arquivo" && t !== top) chooseTool({ kind: "propriedades" });
    },
    [chooseTool, top],
  );

  // ---- Tema ------------------------------------------------------------------
  useEffect(() => {
    document.documentElement.dataset.theme = theme === "escuro" ? "dark" : "light";
    viewerRef.current?.setTheme(theme === "escuro");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* armazenamento indisponível */
    }
  }, [theme]);

  // ---- Planta 2D e prancha ---------------------------------------------------
  const planAvailable = useMemo(() => DISCIPLINES.map((d) => d.id).filter((d) => allElements.some((e) => e.discipline === d)), [allElements]);
  useEffect(() => {
    if (!model || model.storeys.includes(storey)) return;
    // Pavimento padrão: o que tem mais pontos e trechos; senão, o que tem mais paredes.
    const score = new Map<string, number>();
    for (const p of store.points) if (p.storey) score.set(p.storey, (score.get(p.storey) ?? 0) + 10);
    for (const e of model.elements) if (e.storey && e.ifcType.startsWith("IFCWALL")) score.set(e.storey, (score.get(e.storey) ?? 0) + 1);
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? model.storeys[0] ?? "";
    setStorey(best);
  }, [model, storey, store.points]);

  const titleBlocks = useTitleBlocks();
  const activeSheet = store.sheets.find((x) => x.id === sheetId) ?? null;
  /** Vistas de documentação que podem ir para as folhas. */
  const docViews = useMemo(
    () => [...(model?.storeys ?? []).map((st) => docPlanOf(store.views, st)), ...store.views.filter((v) => v.section === "documentacao" && !v.id.startsWith("doc-planta:"))],
    [model, store.views],
  );
  const sheetRender = useMemo(() => {
    if (view !== "prancha" || !model || !activeSheet) return null;
    const ctx: ModelContext = {
      elements: model.elements,
      meshes: meshById,
      cs: model.coordinates,
      storeyLevels: model.storeyLevels,
      points: store.points,
      runs: store.runs,
      spaces: model.spaces,
      boxes,
      drafts: store.drafts,
      views: store.views,
      projectDisciplines: store.disciplines,
    };
    const drawings = new Map<string, PlanDrawing>();
    const vps: SheetViewport[] = [];
    for (const vp of activeSheet.viewports) {
      const v = resolveView(vp.viewId);
      if (!v || v.section !== "documentacao") continue;
      if (v.kind === "3d") {
        const snap = snapshots.get(v.id);
        vps.push({ id: v.id, title: viewTitle(v), subtitle: viewSubtitle(v), image: snap ? { ...snap, widthMm: vp.widthMm ?? 150 } : undefined, pos: vp.pos });
        continue;
      }
      const d = viewDrawing(v, ctx);
      if (!d) continue;
      drawings.set(v.id, d);
      vps.push({ id: v.id, title: viewTitle(v), subtitle: viewSubtitle(v), drawing: d, pos: vp.pos });
    }
    const info = { ...activeSheet.info, conteudo: activeSheet.info.conteudo || activeSheet.name };
    const result = renderSheetViews(vps, activeSheet.format, info, titleBlocks.find((t) => t.id === activeSheet.titleBlockId) ?? null, georef.trueNorthDeg);
    return { result, drawings };
  }, [view, model, activeSheet, meshById, store.points, store.runs, store.drafts, store.views, store.disciplines, boxes, resolveView, snapshots, titleBlocks, georef.trueNorthDeg]);

  const allSystems = useMemo(
    () =>
      [...new Set([...(model?.systems ?? []), ...store.points.map((p) => p.system), ...store.runs.map((r) => r.system)].filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [model, store.points, store.runs],
  );
  const getProperties = useCallback(
    (id: number) => {
      const runId = runIdOfElement(id);
      if (runId != null) {
        const r = store.runs.find((x) => x.id === runId);
        return r ? runProperties(r) : [];
      }
      const boxIndex = boxIndexOf(id);
      if (boxIndex != null) {
        const b = boxes.find((x) => x.index === boxIndex);
        return b ? boxProperties(b, store.runs) : [];
      }
      if (id < 0) {
        const p = store.points.find((x) => x.id === id);
        return p ? pointProperties(p) : [];
      }
      return model?.getProperties(id) ?? [];
    },
    [model, store.points, store.runs, boxes],
  );

  // ---- Visualizador --------------------------------------------------------
  useEffect(() => {
    const viewer = new Viewer(viewerHost.current!);
    viewerRef.current = viewer;
    viewer.setTheme(readTheme() === "escuro");
    return () => viewer.dispose();
  }, []);

  const pick = useCallback((id: number | null, additive: boolean) => {
    setSelection((cur) => {
      if (id == null) return additive ? cur : [];
      if (!additive) return [id];
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  }, []);
  useEffect(() => {
    viewerRef.current!.onPick = pick;
    viewerRef.current!.onPickMany = (ids, additive) => setSelection((cur) => (additive ? [...new Set([...cur, ...ids])] : ids));
  }, [pick]);

  // Selecionar um segmento destaca o trecho inteiro.
  useEffect(() => {
    const runIds = new Set(selection.map(runIdOfElement).filter((x): x is number => x != null));
    if (!runIds.size) {
      viewerRef.current?.setSelection(selection);
      return;
    }
    const extra = runElementList.filter((e) => runIds.has(runIdOfElement(e.expressID)!)).map((e) => e.expressID);
    viewerRef.current?.setSelection([...new Set([...selection, ...extra])]);
  }, [selection, runElementList]);
  useEffect(() => viewerRef.current?.setColorMode(colorMode), [colorMode]);

  // Pontos locados na cena (recriados também após abrir outro modelo).
  useEffect(() => {
    viewerRef.current?.setPoints(
      store.points.map((p) => {
        const def = COMPONENT_BY_ID[p.componentId];
        return { id: p.id, shape: def.shape, size: sizeMeters({ ...def, size: pointSize(p, def) }), position: p.position, rotation: p.rotation, color: DISCIPLINE_BY_ID[def.discipline].color, mesh: def.mesh };
      }),
    );
  }, [store.points, model, libraryVersion]);

  // Trechos na cena: segmentos e conexões.
  useEffect(() => {
    const visuals = store.runs.flatMap((r) => {
      const t = RUN_TYPE_BY_ID[r.typeId];
      const color = DISCIPLINE_BY_ID[t.discipline].color;
      const w = r.size.width / 1000;
      const h = r.size.height / 1000;
      return runSegments(r).map((sg) => ({
        id: segmentElementId(r.id, sg.index),
        kind: "segmento" as const,
        profile: t.profile,
        width: w,
        height: h,
        start: sg.start,
        end: sg.end,
        color,
      }));
    });
    const fittings = runFittings(store.runs).map((f) => {
      const t = RUN_TYPE_BY_ID[f.typeId];
      return {
        id: fittingElementId(f.runId, f.index),
        kind: "no" as const,
        profile: t.profile,
        width: f.size.width / 1000,
        height: f.size.height / 1000,
        position: f.position,
        color: DISCIPLINE_BY_ID[t.discipline].color,
      };
    });
    // Caixas de passagem dos eletrodutos, alinhadas ao eletroduto principal.
    const boxVisuals = boxes.map((b) => ({
      id: -(900_000 + b.index),
      shape: "caixa" as const,
      size: [b.spec.dims[0] / 1000, b.spec.dims[1] / 1000, b.spec.dims[2] / 1000] as Vec3,
      position: b.position,
      rotation: Math.atan2(-b.dir[2], b.dir[0]),
      color: "#B45309",
    }));
    viewerRef.current?.setExtras("runs", [...visuals, ...fittings, ...boxVisuals]);
  }, [store.runs, model, boxes]);

  // Ganchos para testes automatizados da interface (somente em desenvolvimento).
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __mep: { viewer: viewerRef.current, model, store } });
  }, [model, store]);

  const dirtyRef = useRef(false);
  dirtyRef.current = store.dirty && !store.isEmpty;

  // ---- Abertura de arquivos ------------------------------------------------
  /** Abre um IFC como modelo base (somente leitura). Devolve o modelo carregado. */
  const openFile = useCallback(async (file: OpenedFile, opts: { skipConfirm?: boolean } = {}): Promise<LoadedModel | null> => {
    if (!opts.skipConfirm && dirtyRef.current && !window.confirm("Há alterações não salvas neste projeto. Continuar e descartá-las?")) return null;
    setError(null);
    setProgress("Inicializando leitor IFC…");
    // Deixa a interface pintar a mensagem antes do processamento pesado.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const api = await getIfcApi();
      modelRef.current?.close();
      // Vínculos do modelo anterior são descartados com ele.
      setLinkData((cur) => {
        cur.forEach((l) => l.raw.close());
        return new Map();
      });
      setLinkStatus({});
      const loaded = loadIfc(api, file.data, (stage) => setProgress(stage));
      modelRef.current = loaded;
      const disciplineOf = new Map(loaded.elements.map((e) => [e.expressID, e.discipline]));
      const byId = new Map(loaded.elements.map((e) => [e.expressID, e]));
      viewerRef.current!.load(loaded.meshes, (id) => {
        const e = byId.get(id);
        const c = DISCIPLINE_BY_ID[disciplineOf.get(id) ?? "outros"].color;
        return e ? color3d(e, c) : c;
      });
      store.reset();
      setPlanKey("trab");
      setView3dId(null);
      setSheetId(null);
      setSnapshots(new Map());
      setModel(loaded);
      setFileName(file.name);
      setFilters(EMPTY_FILTERS);
      setSelection([]);
      setStoreyView(null);
      setSection(NO_SECTION);
      setView("3d");
      setTop((t) => (t === "arquivo" ? "modelo" : t));
      setHostPath(file.path);
      return loaded;
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setProgress(null);
    }
  }, []);

  // Abrir projeto: carrega o IFC base indicado no arquivo (pelo caminho salvo ou pedindo para localizar).
  useEffect(() => {
    setHostLoader(async (name, path) => {
      let f = await readIfcPath(path);
      if (!f) {
        if (!window.confirm(`Este projeto usa o modelo IFC "${name ?? "?"}"${path ? ` (${path})` : ""}, que não foi encontrado. Localizar o arquivo?`)) return null;
        f = await openIfc();
      }
      return f ? openFile(f, { skipConfirm: true }) : null;
    });
    return () => setHostLoader(null);
  }, [openFile]);
  const projectFile = useProjectFile();
  useEffect(() => {
    document.title = fileName ? `${projectFile.name ?? "Projeto sem nome"}${store.dirty && !store.isEmpty ? " •" : ""} — ${fileName} — SmartEasyBIM` : "SmartEasyBIM";
  }, [fileName, projectFile.name, store.dirty, store.isEmpty]);

  // ---- Vínculos IFC ----------------------------------------------------------------
  /** Lê um IFC como vínculo do modelo principal. */
  const loadLink = useCallback(
    async (id: string, file: { name: string; data: Uint8Array }) => {
      const host = modelRef.current;
      if (!host) return;
      setLinkStatus((s) => ({ ...s, [id]: "carregando" }));
      await new Promise((r) => setTimeout(r, 20));
      try {
        const api = await getIfcApi();
        const raw = loadIfc(api, file.data);
        const meta = linksRef.current.find((m) => m.id === id);
        const data = prepareLink(id, linkSlot.current++, raw, host, meta?.align ?? DEFAULT_ALIGN, georefRef.current.map);
        setLinkData((cur) => new Map(cur).set(id, data));
        setLinkStatus((s) => {
          const { [id]: _drop, ...rest } = s;
          return rest;
        });
      } catch (e) {
        setLinkStatus((s) => ({ ...s, [id]: `erro: ${e instanceof Error ? e.message : e}` }));
      }
    },
    [],
  );

  const addLinks = useCallback(async () => {
    const files = await openIfcMany();
    for (const f of files) {
      const id = `lk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const meta: LinkMeta = { id, name: f.name, path: f.path, discipline: "auto", visible: true, translucent: false };
      store.setLinks((l) => [...l, meta]);
      await loadLink(id, f);
    }
  }, [store, loadLink]);

  const removeLink = useCallback(
    (id: string) => {
      store.setLinks((l) => l.filter((x) => x.id !== id));
      setLinkData((cur) => {
        const d = cur.get(id);
        if (!d) return cur;
        d.raw.close();
        const next = new Map(cur);
        next.delete(id);
        return next;
      });
    },
    [store],
  );

  /** Localizar de novo um vínculo (arquivo movido ou projeto aberto no navegador). */
  const relocateLink = useCallback(
    async (id: string) => {
      const [f] = await openIfcMany();
      if (!f) return;
      store.setLinks((l) => l.map((x) => (x.id === id ? { ...x, name: f.name, path: f.path } : x)));
      setLinkData((cur) => {
        const d = cur.get(id);
        if (!d) return cur;
        d.raw.close();
        const next = new Map(cur);
        next.delete(id);
        return next;
      });
      await loadLink(id, f);
    },
    [store, loadLink],
  );

  // Projeto aberto com vínculos: tenta reabrir cada um pelo caminho salvo.
  useEffect(() => {
    if (!hostModel) return;
    for (const m of store.links) {
      if (linkData.has(m.id) || linkStatus[m.id]) continue;
      setLinkStatus((s) => ({ ...s, [m.id]: "carregando" }));
      void readIfcPath(m.path).then((f) => {
        if (f) void loadLink(m.id, f);
        else setLinkStatus((s) => ({ ...s, [m.id]: "não encontrado" }));
      });
    }
  }, [hostModel, store.links, linkData, linkStatus, loadLink]);

  // Malhas dos vínculos na cena: entram quando visíveis; mudanças de disciplina/transparência recriam.
  const linkInScene = useRef(new Map<string, { sig: string; ids: number[] }>());
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const sigOf = (m: LinkMeta, d: LinkData) => `${m.discipline}|${m.translucent}|${d.alignKey}`;
    const want = new Map(fedLinks.filter((l) => l.meta.visible).map((l) => [l.meta.id, sigOf(l.meta, l.data)]));
    for (const [id, cur] of [...linkInScene.current]) {
      if (want.get(id) === cur.sig) continue;
      viewer.removeModelMeshes(cur.ids);
      linkInScene.current.delete(id);
    }
    for (const l of fedLinks) {
      if (!l.meta.visible || linkInScene.current.has(l.meta.id)) continue;
      const byId = new Map(l.data.elements.map((e) => [e.expressID, e.discipline]));
      const typeOf = new Map(l.data.elements.map((e) => [e.expressID, e]));
      const color = (id: number) => {
        const c = DISCIPLINE_BY_ID[l.meta.discipline !== "auto" ? l.meta.discipline : (byId.get(id) ?? "outros")].color;
        const e = typeOf.get(id);
        return e ? color3d(e, c) : c;
      };
      viewer.addModelMeshes(l.data.meshes, color, l.meta.translucent ? 0.3 : 1);
      linkInScene.current.set(l.meta.id, { sig: sigOf(l.meta, l.data), ids: l.data.meshes.map((m) => m.expressID) });
    }
  }, [fedLinks]);
  useEffect(() => {
    if (!hostModel) linkInScene.current.clear();
  }, [hostModel]);

  /** Novo projeto: escolhe o modelo IFC base (de terceiros, só leitura) e começa um projeto vazio. */
  const handleOpen = useCallback(async () => {
    if (dirtyRef.current && !window.confirm("Há alterações não salvas neste projeto. Começar um novo e descartá-las?")) return;
    const file = await openIfc();
    if (!file) return;
    const m = await openFile(file, { skipConfirm: true });
    if (m) {
      setProjectFile({ path: null, name: null });
      files.setMessage(`Novo projeto sobre ${file.name}. O IFC é só referência (não é alterado); salve o projeto como arquivo .seb.`);
    }
  }, [openFile, files]);

  const handleSample = useCallback(
    async (name = "exemplo-mep.ifc") => {
      const res = await fetch(new URL(`samples/${name}`, document.baseURI));
      const m = await openFile({ name, path: null, data: new Uint8Array(await res.arrayBuffer()) });
      if (m) setProjectFile({ path: null, name: null });
    },
    [openFile],
  );

  useEffect(() => {
    const d = desktop;
    if (!d) return;
    const takePending = () => d.takePendingIfc().then((f) => f && openFile(f));
    takePending();
    const offs = [
      d.on("menu:open", handleOpen),
      d.on("menu:fit", () => viewerRef.current?.fitTo()),
      d.on("ifc:pending-available", takePending),
    ];
    return () => offs.forEach((off) => off());
  }, [handleOpen, openFile]);

  // Arrastar e soltar um .ifc na janela.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file && file.name.toLowerCase().endsWith(".ifc")) {
        await openFile({ name: file.name, path: null, data: new Uint8Array(await file.arrayBuffer()) });
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [openFile]);

  // ---- Filtros -------------------------------------------------------------
  const visibleElements = useMemo<ElementInfo[]>(() => {
    if (!model) return [];
    const q = filters.search.trim().toLowerCase();
    // Vista 3D de documentação: só as disciplinas do projeto, as de referência e o fundo.
    const doc3d = view === "3d" && view3dDef?.section === "documentacao" ? viewFilter(view3dDef, store.disciplines) : null;
    return allElements.filter((e) => {
      if (doc3d && !doc3d.show.has(e.discipline)) return false;
      if (filters.hiddenDisciplines.has(e.discipline)) return false;
      if (filters.hiddenStoreys.has(e.storey ?? NO_STOREY)) return false;
      if (filters.systems.size && !e.systems.some((s) => filters.systems.has(s))) return false;
      if (q) {
        const hay = `${e.name} ${e.objectType ?? ""} ${getTypeLabel(e.ifcType)} ${e.ifcType} ${e.size ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [model, allElements, filters, view, view3dDef, store.disciplines]);

  useEffect(() => {
    if (!model) return;
    const all = visibleElements.length === allElements.length;
    viewerRef.current?.setVisible(all ? null : new Set(visibleElements.map((e) => e.expressID)));
  }, [model, allElements, visibleElements]);

  const selectAndFrame = useCallback((ids: number[]) => {
    setSelection(ids);
    viewerRef.current?.fitTo(ids);
  }, []);

  const pointsRef = useRef(store.points);
  pointsRef.current = store.points;
  const selectPoints = useCallback((ids: number[], frame = false) => {
    setSelection(ids);
    if (frame) viewerRef.current?.fitTo(ids, viewDirectionFor(pointsRef.current.filter((p) => ids.includes(p.id))));
  }, []);

  const focusClash = useCallback((ids: number[]) => {
    viewerRef.current?.setHighlight(ids, true);
    viewerRef.current?.fitTo(ids);
  }, []);
  const clearHighlight = useCallback(() => viewerRef.current?.setHighlight([]), []);

  const isolateDiscipline = useCallback(
    (d: Discipline) => {
      const all = new Set(allElements.map((e) => e.discipline));
      all.delete(d);
      setFilters((f) => ({ ...f, hiddenDisciplines: all }));
    },
    [allElements],
  );

  // Cortes aplicados à vista 3D.
  useEffect(() => {
    if (model) viewerRef.current?.setSection(sectionToPlanes(section, model.coordinates));
  }, [section, model]);

  /** Pavimento escolhido no navegador: planta e prancha passam a ele e o 3D o isola (null = modelo completo em 3D). */
  const chooseStorey = useCallback(
    (name: string | null) => {
      if (!model) return;
      setStoreyView(name);
      setFilters((f) => ({
        ...f,
        hiddenStoreys: name ? new Set([...model.storeys, NO_STOREY].filter((s) => s !== name)) : new Set(),
      }));
      if (name) {
        setStorey(name);
        setPlanKey((k) => (k.startsWith("view:") ? "trab" : k));
      } else setView("3d");
      setTimeout(() => viewerRef.current?.fitTo(), 60);
    },
    [model],
  );

  const storeyZ = useMemo(() => {
    if (!model) return null;
    const lvl = model.storeyLevels.find((s) => s.name === (storeyView ?? storey));
    return lvl ? model.coordinates.worldToIfc([0, lvl.level, 0])[2] : null;
  }, [model, storeyView, storey]);

  const showCircuit = useCallback(
    (c: Circuit) => {
      chooseTool({ kind: "circuitos" }, "eletrica");
      setTop("eletrica");
      selectPoints(
        pointsRef.current.filter((p) => p.circuit === c.uid).map((p) => p.id),
        view === "3d",
      );
    },
    [chooseTool, selectPoints, view],
  );

  // ---- Ações da faixa de ferramentas ------------------------------------------
  const sectionActive = section.horizontal.on || section.x.on || section.y.on;
  const onAction = useCallback(
    (a: ActionId) => {
      switch (a) {
        case "abrirIfc":
          return void handleOpen();
        case "exemplo":
          return void handleSample();
        case "exemploApartamento":
          return void handleSample("exemplo-apartamento.ifc");
        case "vincularIfc":
          chooseTool({ kind: "vinculos" });
          return void addLinks();
        case "abrirProjeto":
          return void files.open();
        case "salvarProjeto":
          return void files.save();
        case "salvarProjetoComo":
          return void files.saveAs();
        case "exportarIfc":
          return void files.exportIfc(false);
        case "temaClaro":
          return setTheme("claro");
        case "temaEscuro":
          return setTheme("escuro");
        case "cores":
          return setColorMode((m) => (m === "disciplina" ? "ifc" : "disciplina"));
        case "vistaPlanta":
          return setView("planta");
        case "vista3d":
          return setView("3d");
        case "enquadrar":
          if (view === "3d") viewerRef.current?.fitTo();
          else setFitSignal((n) => n + 1);
          return;
        case "corte":
          setView("3d");
          setSectionOpen((o) => !(o && view === "3d"));
          return;
        case "exportarIfcDisciplinas":
          return void files.exportIfc(true);
        case "novaFolha":
          sheetActionRef.current?.("nova");
          return;
        case "folhasPlantas":
          sheetActionRef.current?.("plantas");
          return;
        case "removerCortes":
          viewerRef.current?.setExtraClip(null);
          setExtraClip(false);
          return;
        case "propriedades":
          // Mostra/oculta a paleta de propriedades (abre a coluna esquerda se estiver fechada).
          if (!leftOpen) {
            setLeftOpen(true);
            setPropsOpen(true);
          } else setPropsOpen((o) => !o);
          return;
      }
    },
    [handleOpen, handleSample, files, view, leftOpen, addLinks, chooseTool],
  );

  const pressed: Partial<Record<ActionId, boolean>> = {
    temaClaro: theme === "claro",
    temaEscuro: theme === "escuro",
    cores: colorMode === "disciplina",
    vistaPlanta: view === "planta",
    vista3d: view === "3d",
    corte: view === "3d" && (sectionOpen || sectionActive),
    propriedades: leftOpen && propsOpen,
    removerCortes: false,
  };

  // Mensagens dos arquivos de projeto somem sozinhas.
  useEffect(() => {
    if (!files.message) return;
    const t = setTimeout(() => files.setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [files.message, files.setMessage]);

  // ---- Menus Criar / Modificar / Geral -------------------------------------------------
  const [extraClip, setExtraClip] = useState(false);
  const storeyLevel = model?.storeyLevels.find((s) => s.name === storey)?.level ?? 0;
  const storeyHeight = useMemo(() => {
    const above = (model?.storeyLevels ?? []).map((s) => s.level).filter((l) => l > storeyLevel + 0.5).sort((a, b) => a - b)[0];
    return above != null ? above - storeyLevel : 3;
  }, [model, storeyLevel]);
  // ---- Abrir vistas ----------------------------------------------------------------------
  const activeViewDef: ViewDef | null = planKey === "trab" ? null : planKey === "doc" ? docPlanOf(store.views, storey) : resolveView(planKey.slice(5));
  /** Grava a vista (as plantas de documentação passam a existir no projeto na primeira alteração). */
  const updateView = useCallback(
    (def: ViewDef) => store.setViews((l) => (l.some((x) => x.id === def.id) ? l.map((x) => (x.id === def.id ? def : x)) : [...l, def]), def.id),
    [store],
  );
  const open3D = useCallback(
    (v: ViewDef) => {
      setView("3d");
      setView3dId(v.id);
      setTimeout(() => {
        const vw = viewerRef.current;
        if (!vw) return;
        vw.setExtraClip(v.clip?.length ? v.clip : null);
        setExtraClip(!!v.clip?.length);
        if (v.eye && v.target) vw.setView(v.eye, v.target);
        else if (v.frame) vw.fitBounds(v.frame.min, v.frame.max);
      }, 60);
    },
    [],
  );
  const openViewDef = useCallback(
    (v: ViewDef) => {
      if (v.kind === "3d") return open3D(v);
      if (v.storey && model?.storeys.includes(v.storey)) setStorey(v.storey);
      setPlanKey(v.id.startsWith("doc-planta:") ? "doc" : `view:${v.id}`);
      setView("planta");
    },
    [open3D, model],
  );
  const newSheet = useCallback(
    (viewIds: string[] = []): SheetDef => {
      const n = store.sheets.length + 1;
      const s: SheetDef = {
        id: newSheetId(),
        name: `Folha ${String(n).padStart(2, "0")}`,
        format: "A1",
        titleBlockId: titleBlockById(defaultTitleBlockId())?.id ?? null,
        info: { projeto: (fileName ?? "").replace(/\.ifc$/i, ""), conteudo: "", responsavel: "", data: new Date().toLocaleDateString("pt-BR"), revisao: "R00", folha: String(n).padStart(2, "0") },
        viewports: viewIds.map((viewId) => ({ viewId })),
      };
      store.setSheets((l) => [...l, s]);
      return s;
    },
    [store, fileName],
  );
  const openSheet = useCallback(
    (id: string) => {
      setSheetId(id);
      chooseTool({ kind: "pranchas" });
    },
    [chooseTool],
  );
  const openKey = useCallback(
    (key: string) => {
      if (key.startsWith("trab:") || key.startsWith("doc:")) {
        setStorey(key.slice(key.indexOf(":") + 1));
        setPlanKey(key.startsWith("trab:") ? "trab" : "doc");
        setView("planta");
        return;
      }
      if (key.startsWith("sheet:")) return openSheet(key.slice(6));
      const v = resolveView(key.slice(5));
      if (v) openViewDef(v);
    },
    [resolveView, openViewDef, openSheet],
  );
  const addToSheet = useCallback(
    (viewId: string, target: string | null) => {
      if (target == null) {
        const s = newSheet([viewId]);
        return openSheet(s.id);
      }
      store.setSheets((l) => l.map((x) => (x.id === target && !x.viewports.some((vp) => vp.viewId === viewId) ? { ...x, viewports: [...x.viewports, { viewId }] } : x)));
      openSheet(target);
    },
    [store, newSheet, openSheet],
  );
  // Folha aberta sem folha escolhida: a primeira, ou uma nova com a planta de documentação do pavimento.
  useEffect(() => {
    if (view !== "prancha" || !model || activeSheet) return;
    if (store.sheets.length) setSheetId(store.sheets[0].id);
    else if (storey) setSheetId(newSheet([docPlanOf(store.views, storey).id]).id);
  }, [view, model, activeSheet, store.sheets, storey, store.views, newSheet]);
  // Imagens das vistas 3D colocadas na folha.
  useEffect(() => {
    if (view !== "prancha" || !activeSheet || !viewerRef.current) return;
    const missing = activeSheet.viewports.map((vp) => resolveView(vp.viewId)).filter((v): v is ViewDef => !!v && v.kind === "3d" && !snapshots.has(v.id));
    if (!missing.length) return;
    const t = setTimeout(() => {
      const next = new Map(snapshots);
      for (const v of missing) {
        const f = viewFilter(v, store.disciplines);
        const visible = v.section === "documentacao" ? new Set(allElements.filter((e) => f.show.has(e.discipline)).map((e) => e.expressID)) : null;
        next.set(v.id, viewerRef.current!.snapshotView({ ...v, visible }));
      }
      setSnapshots(next);
    }, 80);
    return () => clearTimeout(t);
  }, [view, activeSheet, resolveView, snapshots, store.disciplines, allElements]);
  // Arrastar uma vista na folha.
  const moveViewport = useCallback(
    (viewId: string, center: [number, number]) => {
      if (!activeSheet) return;
      store.setSheets((l) => l.map((x) => (x.id === activeSheet.id ? { ...x, viewports: x.viewports.map((vp) => (vp.viewId === viewId ? { ...vp, pos: center } : vp)) } : x)));
    },
    [store, activeSheet],
  );
  const showCutIn3D = useCallback(
    (v: ViewDef) => {
      if (!v.cut || !model) return;
      const f = sectionFrame(model.coordinates, v.cut);
      viewerRef.current?.setExtraClip([{ normal: f.W, point: f.o }]);
      setExtraClip(true);
      setView3dId(null);
      setView("3d");
    },
    [model],
  );

  sheetActionRef.current = (a) => {
    if (!model) return;
    if (a === "nova") return openSheet(newSheet().id);
    // Uma folha por pavimento com a planta de documentação (pula as que já estão em alguma folha).
    const used = new Set(store.sheets.flatMap((sh) => sh.viewports.map((vp) => vp.viewId)));
    const todo = model.storeys.filter((st) => !used.has(docPlanOf(store.views, st).id));
    if (!todo.length) return files.setMessage("Todas as plantas de documentação já estão em folhas.");
    const created: SheetDef[] = todo.map((st, i) => {
      const n = store.sheets.length + i + 1;
      return {
        id: newSheetId(),
        name: `Planta ${st}`,
        format: "A1",
        titleBlockId: titleBlockById(defaultTitleBlockId())?.id ?? null,
        info: { projeto: (fileName ?? "").replace(/\.ifc$/i, ""), conteudo: `Planta — ${st}`, responsavel: "", data: new Date().toLocaleDateString("pt-BR"), revisao: "R00", folha: String(n).padStart(2, "0") },
        viewports: [{ viewId: docPlanOf(store.views, st).id }],
      };
    });
    store.setSheets((l) => [...l, ...created]);
    openSheet(created[0].id);
    files.setMessage(`${created.length} folha(s) criada(s), uma por pavimento.`);
  };

  /** Fecha uma aba: o conteúdo dela volta ao padrão (planta de trabalho, modelo completo sem recortes, sem folha). */
  const closeTab = (t: TabView) => {
    if (t === "planta") setPlanKey("trab");
    if (t === "3d") {
      setView3dId(null);
      viewerRef.current?.setExtraClip(null);
      setExtraClip(false);
    }
    if (t === "prancha" && tool.kind === "pranchas") chooseTool({ kind: "propriedades" });
    const left = TABS.filter((x) => x !== t && !closedTabs.includes(x));
    setClosedTabs((c) => [...new Set([...c, t])]);
    if (view === t) setView(left[0] ?? "vazio");
  };
  const openTab = (t: TabView) => {
    if (t === "prancha") chooseTool({ kind: "pranchas" });
    else setView(t);
    if (t === "3d") setTimeout(() => viewerRef.current?.fitTo(), 60);
  };

  const draftView = activeViewDef && view === "planta" && !(activeViewDef.kind === "planta" && activeViewDef.section === "trabalho") ? activeViewDef.id : null;
  const draft = useDraftTool({
    cmd: tool.kind === "desenho" ? tool.cmd : "linha",
    n: tool.n,
    store,
    storey,
    level: storeyLevel,
    storeyHeight,
    cs: (model ?? hostModel)?.coordinates ?? IDENTITY_CS,
    georef,
    selection,
    setSelection,
    boundsOf: (ids) => viewerRef.current?.getBounds(ids) ?? null,
    ceilingAt: (p) => viewerRef.current?.castRay(p, [0, 1, 0], 20, (n, id) => n[1] < -0.7 && ["IFCSLAB", "IFCROOF", "IFCCOVERING"].includes(elementById.get(id)?.ifcType ?? ""), true)?.point[1] ?? null,
    onCreateView: openViewDef,
    draftView,
    cutHeight: activeViewDef?.cutHeight ?? editorCut,
    onDone: () => chooseTool({ kind: "propriedades" }),
    isSection: activeViewDef?.kind === "corte",
  });
  const planTool = tool.kind === "desenho" ? draft.tool : null;

  // Medição no 3D: cliques no modelo (com encaixe), Enter ou duplo clique encerra.
  const measuring3d = tool.kind === "desenho" && isMeasureCmd(tool.cmd) && view === "3d";
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    const vw = viewerRef.current;
    if (!vw) return;
    vw.setMeasureMode(measuring3d ? { onClick: (p) => draftRef.current.click3d(p), onFinish: () => draftRef.current.finish3d() } : null);
    if (!measuring3d) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Enter" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))) draftRef.current.finish3d();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measuring3d]);
  useEffect(() => {
    viewerRef.current?.setMeasures(tool.kind === "desenho" && isMeasureCmd(tool.cmd) && view === "3d" ? draft.measures3d : [], measuring3d ? draft.pending3d : null);
  }, [draft.measures3d, draft.pending3d, measuring3d, tool, view]);

  // Esc: encerra o comando em andamento (locar, traçar, desenhar, modificar) e volta a Selecionar;
  // já em Selecionar, limpa a seleção. Em campos de texto, o Esc é do campo.
  const escRef = useRef<() => void>(() => {});
  escRef.current = () => {
    if (tool.kind === "desenho") {
      if (isCreateCmd(tool.cmd)) draft.tool.finish(); // poligonal em andamento é gravada
      return chooseTool({ kind: "propriedades" });
    }
    if (tool.kind === "locacao" || tool.kind === "tracado") return chooseTool({ kind: "propriedades" });
    setSelection([]);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      // Deixa os painéis tratarem o Esc antes (ex.: o traçado grava o trecho em andamento).
      setTimeout(() => escRef.current(), 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // ---- Mover a seleção junto com o que está ligado a ela (setas do teclado e botão direito) ----------
  const moveKeyBlocked = useRef(true);
  moveKeyBlocked.current = tool.kind !== "propriedades" || !(view === "planta" || view === "3d") || selection.length === 0;
  const moveRef = useRef<(d: Vec3, label: string) => void>(() => {});
  moveRef.current = (d, label) => {
    const pointIds = new Set(store.points.map((p) => p.id));
    const sel: MoveSelection = { points: [], segments: [] };
    const seen = new Set<string>();
    for (const id of selection) {
      if (pointIds.has(id)) sel.points.push(id);
      const runId = runIdOfElement(id);
      const index = segmentIndexOf(id);
      if (runId != null && index != null && !seen.has(`${runId}:${index}`)) {
        seen.add(`${runId}:${index}`);
        sel.segments.push({ runId, index });
      }
    }
    if (!sel.points.length && !sel.segments.length) {
      files.setMessage("Selecione pontos locados ou trechos para mover (os elementos dos IFCs de referência não podem ser movidos).");
      return;
    }
    const res = moveNetwork(store.runs, store.points, sel, d);
    if (!res.ok) {
      files.setMessage(res.reason);
      return;
    }
    store.mutate((cur) => ({
      ...cur,
      points: cur.points.map((p) => {
        const np = res.points.get(p.id);
        if (!np) return p;
        // Altura do ponto acompanha o movimento vertical (teto: afastamento abaixo do teto).
        const dyMm = Math.round(d[1] * 1000);
        const teto = COMPONENT_BY_ID[p.componentId]?.mounting === "teto";
        return { ...p, position: np, ...(dyMm ? { height: p.height + (teto ? -dyMm : dyMm) } : {}) };
      }),
      runs: cur.runs.map((r) => (res.runs.has(r.id) ? { ...r, vertices: res.runs.get(r.id)! } : r)),
    }));
    files.setMessage(`Movido ${label}: ${res.movedPoints} ponto(s) e ${res.movedRuns} trecho(s), com o que está ligado a eles.`);
  };
  /** Deslocamento em planta (coordenadas do projeto) convertido para a cena. */
  const planDeltaToScene = useCallback(
    (dx: number, dy: number): Vec3 => {
      const cs = model?.coordinates;
      if (!cs) return [dx, 0, -dy];
      const o = cs.ifcToWorld([0, 0, 0]);
      const b = cs.ifcToWorld([dx, dy, 0]);
      return [b[0] - o[0], 0, b[2] - o[2]];
    },
    [model],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const keys: Record<string, [number, number, number]> = { ArrowRight: [1, 0, 0], ArrowLeft: [-1, 0, 0], ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0], PageUp: [0, 0, 1], PageDown: [0, 0, -1] };
      const k = keys[e.key];
      if (!k || moveKeyBlocked.current) return;
      e.preventDefault();
      // Passo: 50 mm; Shift = 10 mm (fino); Ctrl = 500 mm.
      const step = e.shiftKey ? 0.01 : e.ctrlKey || e.metaKey ? 0.5 : 0.05;
      const d = planDeltaToScene(k[0] * step, k[1] * step);
      d[1] = k[2] * step;
      const dir = k[2] ? (k[2] > 0 ? "para cima" : "para baixo") : e.key === "ArrowRight" ? "para +X" : e.key === "ArrowLeft" ? "para −X" : e.key === "ArrowUp" ? "para +Y" : "para −Y";
      moveRef.current(d, `${Math.round(step * 1000)} mm ${dir}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [planDeltaToScene]);
  const pickMany = useCallback((ids: number[], additive: boolean) => setSelection((cur) => (additive ? [...new Set([...cur, ...ids])] : ids)), []);

  const disc = toolDisc ? DISCIPLINE_TABS[toolDisc] : null;
  const selectedOne = selection.length === 1 ? (elementById.get(selection[0]) ?? null) : null;
  const viewer = viewerRef.current;
  // Sem ferramenta ativa (seleção), o painel da direita some: as propriedades ficam na coluna esquerda.
  const rightWidth = tool.kind === "propriedades" ? 0 : tool.kind === "pranchas" ? 400 : tool.kind === "programa" ? 620 : 460;
  const resolveCeiling = useMemo(() => (viewer && model ? makeCeilingResolver(viewer, elementById, model.storeyLevels) : null), [viewer, model, elementById]);
  const slabAt = useMemo(() => (viewer && model ? makeSlabProbe(viewer, elementById, model.storeyLevels) : null), [viewer, model, elementById]);
  const projectName = (fileName ?? "").replace(/\.ifc$/i, "");

  const rightPanel = () => {
    if (tool.kind === "calc") return <CalcPanel selected={selectedOne} which={tool.which} />;
    if (tool.kind === "biblioteca")
      return (
        <BibliotecaPanel
          points={store.points}
          choices={store.choices}
          onChoices={store.setChoices}
          onPlace={(componentId) => {
            if (!model) {
              window.alert("Abra um modelo IFC para locar a família.");
              return;
            }
            chooseTool({ kind: "locacao", componentId }, null);
          }}
        />
      );
    if (tool.kind === "programa" && tool.section === "tipos" && !(model && viewer && resolveCeiling))
      return <ProgramaTiposOnly onSection={(section) => chooseTool({ kind: "programa", section })} />;
    if (!model || !viewer) return <div className="empty-side">Abra um modelo IFC em Arquivo › Abrir IFC.</div>;
    switch (tool.kind) {
      case "propriedades":
        return null;
      case "locacao":
        return (
          <LocacaoPanel
            model={model}
            fileName={fileName}
            store={store}
            viewer={viewer}
            elementById={elementById}
            selection={selection}
            onSelect={selectPoints}
            systems={allSystems}
            groups={disc?.groups}
            preset={{ componentId: tool.componentId, n: tool.n }}
          />
        );
      case "tracado":
        return (
          <TracadoPanel
            model={model}
            fileName={fileName}
            store={store}
            viewer={viewer}
            selection={selection}
            onSelect={selectPoints}
            systems={allSystems}
            typeIds={disc?.runs}
            elementById={elementById}
            preset={{ typeId: tool.typeId, n: tool.n }}
            onConfigureInstalls={() => chooseTool({ kind: "instalacoes" }, toolDisc)}
          />
        );
      case "instalacoes": {
        const counts: Partial<Record<InstallMode, number>> = {};
        for (const r of store.runs) if (isConduitRun(r)) counts[(r.install ?? DEFAULT_INSTALL).mode] = (counts[(r.install ?? DEFAULT_INSTALL).mode] ?? 0) + 1;
        return (
          <InstalacoesPanel
            settings={store.installSettings}
            onChange={store.setInstallSettings}
            counts={counts}
            onApply={() => {
              if (!slabAt) return;
              const conduits = store.runs.filter(isConduitRun);
              const changes = new Map(
                conduits.map((r) => {
                  const name = storeyAt(runFloorProbeY(r), model.storeyLevels);
                  const floorY = model.storeyLevels.find((l) => l.name === name)?.level ?? 0;
                  const mid = r.vertices[Math.floor(r.vertices.length / 2)];
                  return [r.id, applyInstall(r, r.install ?? DEFAULT_INSTALL, { floorY, slabUnderside: slabAt(mid[0], mid[2], floorY), settings: store.installSettings, points: store.points })];
                }),
              );
              store.updateRuns([...changes.keys()], (r) => changes.get(r.id)!);
              files.setMessage(`${changes.size} eletroduto(s) levados às cotas das medidas atuais.`);
            }}
          />
        );
      }
      case "circuitos":
        return <CircuitosPanel model={model} fileName={fileName} store={store} selection={selection} onSelect={selectPoints} />;
      case "quantitativos":
        return (
          <QuantitiesPanel
            elements={visibleElements}
            assemblies={(() => {
              const visible = new Set(visibleElements.map((e) => e.expressID));
              return store.points.filter((p) => p.assembly && visible.has(p.id)).map((p) => p.assembly!);
            })()}
            fileName={fileName}
            onSelect={selectAndFrame}
          />
        );
      case "interferencias":
        return (
          <ClashPanel
            elements={visibleElements}
            elementById={elementById}
            fileName={fileName}
            meshes={meshById}
            ignorePair={connected}
            onFocus={focusClash}
            onClear={clearHighlight}
          />
        );
      case "desenho":
        return (
          <DesenhoPanel
            cmd={tool.cmd}
            ctl={draft}
            store={store}
            selection={selection}
            setSelection={setSelection}
            hasClip={extraClip}
            onClearClip={() => onAction("removerCortes")}
            elementLabel={(id) => {
              const e = elementById.get(id);
              return e ? `${e.name || e.ifcType}` : `Elemento ${id}`;
            }}
          />
        );
      case "coordenadas":
        return <CoordenadasPanel fromIfc={hostModel!.georef} settings={store.georef} effective={georef} onChange={store.setGeoref} />;
      case "vinculos":
        return (
          <VinculosPanel
            hostName={fileName}
            host={hostModel!}
            links={store.links}
            data={linkData}
            status={linkStatus}
            onAdd={() => void addLinks()}
            onChange={(id, patch) => store.setLinks((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))}
            onRemove={removeLink}
            onRelocate={(id) => void relocateLink(id)}
          />
        );
      case "programa":
        if (!resolveCeiling) return null;
        return (
          <ProgramaPanel
            section={tool.section}
            model={model}
            store={store}
            viewer={viewer}
            elementById={elementById}
            resolveCeiling={resolveCeiling}
            onSelect={selectPoints}
            onSection={(section) => chooseTool({ kind: "programa", section })}
          />
        );
      case "pranchas":
        if (!activeSheet || !sheetRender) return <div className="empty-side">Abra a vista Prancha para montar a folha.</div>;
        return (
          <FolhaPanel
            sheet={activeSheet}
            onChange={(sh) => store.setSheets((l) => l.map((x) => (x.id === sh.id ? sh : x)), sh.id)}
            docViews={docViews}
            rendered={sheetRender.result}
            drawings={sheetRender.drawings}
            fileName={fileName}
            georef={georef}
            moveMode={moveMode}
            onMoveMode={setMoveMode}
            onOpenView={(id) => {
              const v = resolveView(id);
              if (v) openViewDef(v);
            }}
            onRefreshImage={(id) =>
              setSnapshots((m) => {
                const n = new Map(m);
                n.delete(id);
                return n;
              })
            }
          />
        );
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <LogoMark size={28} />
          <span className="wordmark">
            Smart<span>Easy</span>BIM
          </span>
        </div>
        <nav className="top-nav" aria-label="Disciplinas">
          {TOP_TABS.map((t) => (
            <button key={t.id} className={`top-tab ${top === t.id ? "active" : ""}`} onClick={() => chooseTop(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="project-title" title={fileName ?? ""}>
          {model ? (
            <>
              {projectName}
              {storey && <span className="muted-on-dark"> · {storeyView ?? storey}</span>}
            </>
          ) : (
            <span className="muted-on-dark">Nenhum modelo aberto</span>
          )}
        </div>
        <button
          className="icon-btn on-dark"
          onClick={() => setTheme(theme === "claro" ? "escuro" : "claro")}
          title={theme === "claro" ? "Fundo preto" : "Fundo branco"}
          aria-label="Alternar cor de fundo"
        >
          <Icon name={theme === "claro" ? "lua" : "sol"} size={18} />
        </button>
        <button className="btn save" onClick={files.save} disabled={!model}>
          Salvar{store.dirty && !store.isEmpty ? " •" : ""}
        </button>
      </header>

      <Ribbon tab={top} tool={tool} hasModel={!!model} pressed={pressed} onTool={(t) => chooseTool(t, top in DISCIPLINE_TABS ? (top as DisciplineTab) : null)} onAction={onAction} />

      <main className="workspace" style={{ gridTemplateColumns: `${leftOpen ? 300 : 0}px minmax(0, 1fr) ${rightOpen ? rightWidth : 0}px` }}>
        <aside className={`sidebar docks ${leftOpen ? "" : "collapsed"}`} aria-hidden={!leftOpen}>
          {model && resolveCeiling && slabAt && (
            <section className={`dock ${propsOpen ? "open" : ""}`}>
              <button className="dock-head" onClick={() => setPropsOpen(!propsOpen)} aria-expanded={propsOpen}>
                <span className={`caret ${propsOpen ? "open" : ""}`}>▸</span> Propriedades
              </button>
              {propsOpen && selection.length === 0 && (view === "planta" || (view === "3d" && view3dDef)) && (
                <div className="dock-body">
                  <VistaPanel
                    view={view === "3d" ? view3dDef : activeViewDef}
                    workDisplay={workDisplay}
                    onWorkDisplay={setWorkDisplay}
                    storey={storey}
                    projectDisciplines={store.disciplines}
                    available={planAvailable}
                    sheets={store.sheets}
                    onChange={(v) => {
                      updateView(v);
                      if (v.kind === "3d") setSnapshots((m) => (m.has(v.id) ? new Map([...m].filter(([k]) => k !== v.id)) : m));
                    }}
                    onAddToSheet={(target) => {
                      const v = view === "3d" ? view3dDef : activeViewDef;
                      if (v) addToSheet(v.id, target);
                    }}
                    onShow3D={() => activeViewDef && showCutIn3D(activeViewDef)}
                    onSaveCamera={() => {
                      if (!view3dDef || !viewerRef.current) return;
                      const c = viewerRef.current.getCamera();
                      updateView({ ...view3dDef, eye: c.eye, target: c.target, frame: undefined });
                      setSnapshots((m) => new Map([...m].filter(([k]) => k !== view3dDef.id)));
                    }}
                  />
                </div>
              )}
              {propsOpen && !(selection.length === 0 && (view === "planta" || (view === "3d" && view3dDef))) && (
                <div className="dock-body">
                  <ParamsPanel
                    selection={selection}
                    elementById={elementById}
                    store={store}
                    model={model}
                    getProperties={getProperties}
                    resolveCeiling={resolveCeiling}
                    slabAt={slabAt}
                    systems={allSystems}
                    onFrame={selectAndFrame}
                    georef={georef}
                  />
                </div>
              )}
            </section>
          )}
          {model && (
            <section className={`dock ${browserOpen ? "open" : ""}`}>
              <button className="dock-head" onClick={() => setBrowserOpen(!browserOpen)} aria-expanded={browserOpen}>
                <span className={`caret ${browserOpen ? "open" : ""}`}>▸</span> Vistas e folhas
              </button>
              {browserOpen && (
                <div className="dock-body">
                  <VistasBrowser
                    storeys={model.storeys}
                    views={store.views}
                    sheets={store.sheets}
                    active={
                      view === "planta"
                        ? planKey === "trab"
                          ? `trab:${storey}`
                          : planKey === "doc"
                            ? `doc:${storey}`
                            : planKey
                        : view === "3d"
                          ? view3dId && `view:${view3dId}`
                          : view === "prancha" && sheetId
                            ? `sheet:${sheetId}`
                            : null
                    }
                    disciplines={store.disciplines}
                    available={planAvailable}
                    onDisciplines={store.setDisciplines}
                    onOpen={openKey}
                    onRename={(id, name) => {
                      const v = resolveView(id);
                      if (v) updateView({ ...v, name });
                    }}
                    onDelete={(key) => {
                      if (key.startsWith("sheet:")) {
                        const id = key.slice(6);
                        store.setSheets((l) => l.filter((x) => x.id !== id));
                        if (sheetId === id) setSheetId(null);
                        return;
                      }
                      const id = key.slice(5);
                      store.mutate((cur) => ({
                        ...cur,
                        views: cur.views.filter((v) => v.id !== id),
                        drafts: cur.drafts.filter((d) => d.view !== id),
                        sheets: cur.sheets.map((sh) => ({ ...sh, viewports: sh.viewports.filter((vp) => vp.viewId !== id) })),
                      }));
                      if (planKey === key) setPlanKey("trab");
                      if (view3dId === id) setView3dId(null);
                    }}
                    onNewSheet={() => openSheet(newSheet().id)}
                  />
                </div>
              )}
            </section>
          )}
          {model ? (
            <section className={`dock ${navOpen ? "open" : ""}`}>
              <button className="dock-head" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen}>
                <span className={`caret ${navOpen ? "open" : ""}`}>▸</span> Navegador
              </button>
              {navOpen && (
                <div className="dock-body">
            <Navigator
              elements={allElements}
              storeys={model.storeys}
              systems={allSystems}
              filters={filters}
              onChange={setFilters}
              visibleCount={visibleElements.length}
              onIsolate={isolateDiscipline}
              storey={storey}
              storeyView={storeyView}
              onStorey={chooseStorey}
              points={store.points}
              circuits={store.circuits}
              onCircuit={showCircuit}
            />
                </div>
              )}
            </section>
          ) : (
            <div className="empty-side">Abra um modelo IFC para navegar por pavimentos, disciplinas, sistemas e circuitos.</div>
          )}
        </aside>

        <section className="center">
          <div className="view-tabs">
            <button className="icon-btn" onClick={() => setLeftOpen(!leftOpen)} title={leftOpen ? "Ocultar painel esquerdo" : "Mostrar painel esquerdo"} aria-pressed={leftOpen}>
              <Icon name="painelEsq" size={18} />
            </button>
            {model && (
              <>
                {!closedTabs.includes("planta") && (
                  <span className={`view-tab-wrap ${view === "planta" ? "active" : ""}`}>
                    <button className={`view-tab ${view === "planta" ? "active" : ""}`} onClick={() => setView("planta")}>
                      {activeViewDef && planKey.startsWith("view:") ? activeViewDef.name : `Planta · ${storey}`}
                    </button>
                    <button className="tab-close" title="Fechar esta aba" aria-label="Fechar planta" onClick={() => closeTab("planta")}>
                      ×
                    </button>
                  </span>
                )}
                {!closedTabs.includes("3d") && (
                  <span className={`view-tab-wrap ${view === "3d" ? "active" : ""}`}>
                    <button className={`view-tab ${view === "3d" ? "active" : ""}`} onClick={() => setView("3d")}>
                      3D · {view3dDef ? view3dDef.name : (storeyView ?? "Modelo completo")}
                    </button>
                    <button className="tab-close" title="Fechar esta aba" aria-label="Fechar vista 3D" onClick={() => closeTab("3d")}>
                      ×
                    </button>
                  </span>
                )}
                {!closedTabs.includes("prancha") && (
                  <span className={`view-tab-wrap ${view === "prancha" ? "active" : ""}`}>
                    <button className={`view-tab ${view === "prancha" ? "active" : ""}`} onClick={() => chooseTool({ kind: "pranchas" })}>
                      Prancha{activeSheet && view === "prancha" ? ` · ${activeSheet.name}` : ""}
                    </button>
                    <button className="tab-close" title="Fechar esta aba" aria-label="Fechar prancha" onClick={() => closeTab("prancha")}>
                      ×
                    </button>
                  </span>
                )}
                {closedTabs.length > 0 && (
                  <select className="tab-reopen" value="" title="Abrir uma aba fechada" onChange={(e) => e.target.value && openTab(e.target.value as TabView)}>
                    <option value="">+</option>
                    {closedTabs.map((t) => (
                      <option key={t} value={t}>
                        {TAB_LABEL[t]}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            <div className="spacer" />
            {model && view === "planta" && (planKey === "trab" || planKey === "doc") && (
              <div className="segmented small" role="group" aria-label="Seção da planta">
                <button className={planKey === "trab" ? "on" : ""} onClick={() => setPlanKey("trab")} title="Tudo visível">
                  Trabalho
                </button>
                <button className={planKey === "doc" ? "on" : ""} onClick={() => setPlanKey("doc")} title="Só as disciplinas do projeto (vai para as folhas)">
                  Documentação
                </button>
              </div>
            )}
            {model && view === "planta" && activeViewDef?.kind !== "corte" && (
              <label className="cut-input" title="Altura do plano de corte acima do piso">
                corte
                <input
                  type="number"
                  step={0.1}
                  min={0.2}
                  value={activeViewDef?.cutHeight ?? editorCut}
                  onChange={(e) => {
                    const h = Math.max(0.2, Number(e.target.value));
                    if (activeViewDef) updateView({ ...activeViewDef, cutHeight: h });
                    else setEditorCut(h);
                  }}
                />
                m
              </label>
            )}
            <button className="icon-btn" onClick={() => setRightOpen(!rightOpen)} title={rightOpen ? "Ocultar painel direito" : "Mostrar painel direito"} aria-pressed={rightOpen}>
              <Icon name="painelDir" size={18} />
            </button>
          </div>

          <div className="viewport">
            <div ref={viewerHost} className="viewer-host" />
            {view === "vazio" && model && (
              <div className="empty-view">
                <p>Nenhuma aba aberta.</p>
                <div className="btn-row">
                  {TABS.map((t) => (
                    <button key={t} className="btn" onClick={() => openTab(t)}>
                      Abrir {TAB_LABEL[t].toLowerCase()}
                    </button>
                  ))}
                </div>
                <p className="muted small">Ou escolha uma vista ou folha no navegador “Vistas e folhas”, à esquerda.</p>
              </div>
            )}
            {view === "planta" && model && viewer && storey && (
              <PlanEditor
                viewer={viewer}
                model={model}
                store={store}
                storey={activeViewDef?.storey ?? storey}
                cutHeight={activeViewDef?.cutHeight ?? editorCut}
                selection={selection}
                elementById={elementById}
                onPick={pick}
                onPickMany={pickMany}
                dark={theme === "escuro"}
                fitSignal={fitSignal}
                planTool={planTool}
                viewDef={activeViewDef}
                projectDisciplines={store.disciplines}
                beams={beamOptions(activeViewDef ?? workDisplay)}
                onMoveBy={(d) => moveRef.current(planDeltaToScene(d[0], d[1]), `${Math.hypot(d[0], d[1]).toFixed(2).replace(".", ",")} m`)}
              />
            )}
            {view === "3d" && model && (
              <SectionTools
                section={section}
                onChange={setSection}
                bounds={viewer?.getModelBounds() ?? null}
                cs={model.coordinates}
                storeyZ={storeyZ}
                open={sectionOpen}
                onOpen={setSectionOpen}
              />
            )}
            {view === "prancha" && sheetRender && (
              <PlanView
                sheet={sheetRender.result}
                selection={selection}
                onSelect={(ids, additive) => setSelection((cur) => (additive ? [...new Set([...cur, ...ids])] : ids))}
                fitSignal={fitSignal}
                moveMode={moveMode}
                viewports={sheetRender.result.viewports}
                onMoveViewport={moveViewport}
                textOf={(id) => {
                  const d = store.drafts.find((x) => x.id === id);
                  return d?.kind === "texto" ? d.text : null;
                }}
                onEditText={(id, text) => store.setDrafts((l) => l.map((x) => (x.id === id && x.kind === "texto" ? { ...x, text } : x)))}
                onOpenViewport={(id) => {
                  const v = resolveView(id);
                  if (v) openViewDef(v);
                }}
              />
            )}
            {!model && !progress && (
              <div className="welcome">
                <LogoMark size={72} light={theme === "escuro"} />
                <h1>
                  Smart<span>Easy</span>BIM
                </h1>
                <p>
                  Projetos de instalações MEP sobre modelos IFC. Comece um <b>novo projeto</b> escolhendo o modelo IFC de referência (Revit, Archicad etc.) ou
                  abra um projeto salvo (.seb). Os IFCs de terceiros só são lidos, nunca alterados.
                </p>
                <div className="welcome-actions">
                  <button className="btn primary" onClick={handleOpen}>
                    Novo projeto…
                  </button>
                  <button className="btn" onClick={() => void files.open()}>
                    Abrir projeto…
                  </button>
                  <button className="btn" onClick={() => handleSample()}>
                    Abrir modelo de exemplo
                  </button>
                  <button className="btn" onClick={() => handleSample("exemplo-apartamento.ifc")}>
                    Exemplo de apartamento
                  </button>
                </div>
              </div>
            )}
            {progress && (
              <div className="overlay">
                <div className="spinner" />
                {progress}
              </div>
            )}
            {error && (
              <div className="error" onClick={() => setError(null)}>
                Erro ao abrir o modelo: {error}
              </div>
            )}
            {files.message && (
              <div className="toast" onClick={() => files.setMessage(null)}>
                {files.message}
              </div>
            )}
          </div>
        </section>

        <aside className={`panel ${rightOpen ? "" : "collapsed"}`} aria-hidden={!rightOpen}>
          {rightPanel()}
        </aside>
      </main>

      <footer className="status-bar">
        <span className={`dot ${progress ? "busy" : model ? "ok" : ""}`} />
        <span>{progress ?? (model ? "Pronto" : "Sem modelo")}</span>
        {model && (
          <>
            <span className="sep" />
            <span>
              {fileName} · {model.schema} · {model.elements.length} elementos
            </span>
            <span className="sep" />
            <span>{tool.kind === "desenho" ? `${CMD_LABEL[tool.cmd]} · ${TOOL_HINT.desenho}` : TOOL_HINT[tool.kind]}</span>
          </>
        )}
        {model && <CursorReadout georef={georef} />}
        <div className="spacer" />
        {model && (
          <span className="num">
            {store.points.length} pontos · {store.runs.length} trechos · {store.circuits.length} circuitos
            {selection.length > 0 && ` · ${selection.length} selecionado${selection.length > 1 ? "s" : ""}`}
          </span>
        )}
        <span className="sep" />
        <span>Fundo {theme === "claro" ? "branco" : "preto"}</span>
      </footer>
    </div>
  );
}

/** Coordenadas do cursor na planta: do projeto e, se houver survey point, do mapa (UTM). */
function CursorReadout({ georef }: { georef: Georef }) {
  const c = useCursor();
  if (!c) return null;
  const m = georef.map ? toMap(georef.map, c) : null;
  return (
    <>
      <span className="sep" />
      <span className="num" title="Coordenadas do projeto (IFC)">
        X {fmtCoord(c[0], 2)} · Y {fmtCoord(c[1], 2)}
      </span>
      {m && (
        <span className="num" title={georef.crs?.name ? `Coordenadas do mapa (${georef.crs.name})` : "Coordenadas do mapa"}>
          · E {fmtCoord(m[0], 2)} · N {fmtCoord(m[1], 2)}
        </span>
      )}
    </>
  );
}
