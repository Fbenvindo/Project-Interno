import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DISCIPLINE_BY_ID, DISCIPLINES, getTypeLabel } from "../../core/disciplines";
import { COMPONENT_BY_ID } from "../../core/library";
import { sizeMeters } from "../../core/placement";
import { pointProperties, pointToElement, type PlacedPoint } from "../../core/points";
import type { Circuit } from "../../core/circuits";
import type { Discipline, ElementInfo, Vec3 } from "../../core/types";
import { loadIfc, type LoadedModel } from "../../ifc/loadIfc";
import { desktop, getIfcApi, openIfc } from "./platform";
import { Viewer, type ColorMode } from "./viewer/Viewer";
import { PropertiesPanel } from "./components/PropertiesPanel";
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
import { PlantaPanel, type PlanSettings } from "./planta/PlantaPanel";
import { buildPlan } from "../../core/plan/build";
import { renderSheet } from "../../core/plan/sheet";
import { connectedPairs, runElements, runFittings, runIdOfElement, runProperties, runSegments, RUN_TYPE_BY_ID, segmentElementId, fittingElementId } from "../../core/runs";
import { usePointsStore } from "./locacao/usePointsStore";
import { defaultTitleBlockId, titleBlockById, useTitleBlocks } from "./planta/titleBlocks";
import { useProjectFiles } from "./locacao/useProjectFiles";
import { EMPTY_FILTERS, Navigator, NO_STOREY, type Filters } from "./shell/Navigator";
import { Ribbon } from "./shell/Ribbon";
import { Icon, LogoMark } from "./shell/icons";
import { DISCIPLINE_TABS, TOP_TABS, type ActionId, type DisciplineTab, type Tool, type ToolSpec, type TopTab } from "./shell/ribbonConfig";

type View = "planta" | "3d" | "prancha";
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
  propriedades: "Clique para selecionar · Ctrl+clique para somar · duplo clique para enquadrar",
  locacao: "Clique na planta para locar · Esc cancela",
  tracado: "Clique para inserir vértices · duplo clique ou Enter termina · Esc cancela",
  circuitos: "Selecione pontos na vista e atribua ao circuito",
  calc: "Selecione um segmento para aproveitar comprimento e dimensão",
  quantitativos: "Clique em uma linha para localizar os elementos",
  interferencias: "Clique em uma interferência para enquadrá-la",
  pranchas: "Roda do mouse: zoom · arrastar: mover · duplo clique: enquadrar a folha",
};

export function App() {
  const viewerHost = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<number[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>("disciplina");
  const [planSettings, setPlanSettings] = useState<PlanSettings | null>(null);

  // Casca: aba superior, ferramenta ativa, vista central, painéis e tema.
  const [top, setTop] = useState<TopTab>("arquivo");
  const toolCounter = useRef(0);
  const [tool, setToolState] = useState<Tool>({ kind: "propriedades", n: 0 });
  /** Disciplina em que a ferramenta foi escolhida (filtra biblioteca e tipos de trecho). */
  const [toolDisc, setToolDisc] = useState<DisciplineTab | null>(null);
  const [view, setView] = useState<View>("3d");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [fitSignal, setFitSignal] = useState(0);

  // Pavimento ativo (planta e prancha), vista 3D isolada e cortes.
  const [storey, setStorey] = useState<string>("");
  const [storeyView, setStoreyView] = useState<string | null>(null);
  const [editorCut, setEditorCut] = useState(1.2);
  const [section, setSection] = useState<SectionState>(NO_SECTION);
  const [sectionOpen, setSectionOpen] = useState(false);

  const store = usePointsStore();
  const files = useProjectFiles(store, model, fileName, () => setSelection([]));
  const pointElements = useMemo(() => store.points.map(pointToElement), [store.points]);
  const runElementList = useMemo(() => (model ? runElements(store.runs, model.storeyLevels) : []), [store.runs, model]);
  const allElements = useMemo(() => (model ? [...model.elements, ...pointElements, ...runElementList] : []), [model, pointElements, runElementList]);
  const elementById = useMemo(() => new Map(allElements.map((e) => [e.expressID, e])), [allElements]);
  const connected = useMemo(() => connectedPairs(store.runs, store.points), [store.runs, store.points]);
  const meshById = useMemo(() => new Map(model?.meshes.map((m) => [m.expressID, m]) ?? []), [model]);

  const chooseTool = useCallback(
    (spec: ToolSpec, disc: DisciplineTab | null = null) => {
      setToolState({ ...spec, n: ++toolCounter.current } as Tool);
      setToolDisc(disc);
      if (spec.kind === "pranchas") setView("prancha");
      else if (spec.kind === "locacao" || spec.kind === "tracado") setView("planta");
      setRightOpen(true);
    },
    [],
  );

  const chooseTop = useCallback(
    (t: TopTab) => {
      setTop(t);
      // Arquivo mantém a ferramenta (salvar no meio da edição); as demais abas começam pela consulta.
      if (t === "pranchas") chooseTool({ kind: "pranchas" });
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
    if (!model || planSettings) return;
    // Pavimento padrão: o que tem mais pontos e trechos; senão, o que tem mais paredes.
    const score = new Map<string, number>();
    for (const p of store.points) if (p.storey) score.set(p.storey, (score.get(p.storey) ?? 0) + 10);
    for (const e of model.elements) if (e.storey && e.ifcType.startsWith("IFCWALL")) score.set(e.storey, (score.get(e.storey) ?? 0) + 1);
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? model.storeys[0] ?? "";
    setStorey(best);
    setPlanSettings({
      storey: best,
      cutHeight: 1.2,
      scale: 50,
      format: "A1",
      disciplines: DISCIPLINES.map((d) => d.id),
      labels: { tags: true, circuits: true, power: true, sizes: true },
      info: {
        projeto: (fileName ?? "").replace(/\.ifc$/i, ""),
        conteudo: "",
        responsavel: "",
        data: new Date().toLocaleDateString("pt-BR"),
        revisao: "R00",
        folha: "01/01",
      },
      titleBlockId: titleBlockById(defaultTitleBlockId())?.id ?? null,
    });
  }, [model, planSettings, store.points, fileName]);

  const titleBlocks = useTitleBlocks();
  const sheetSettings = useMemo(() => (planSettings ? { ...planSettings, storey } : null), [planSettings, storey]);
  const planDrawing = useMemo(() => {
    if (view !== "prancha" || !model || !sheetSettings) return null;
    return buildPlan({
      elements: model.elements,
      meshes: meshById,
      cs: model.coordinates,
      storeyLevels: model.storeyLevels,
      storey: sheetSettings.storey,
      cutHeight: sheetSettings.cutHeight,
      points: store.points,
      runs: store.runs,
      scale: sheetSettings.scale,
      disciplines: new Set(sheetSettings.disciplines),
      labels: sheetSettings.labels,
      spaces: model.spaces,
    });
  }, [view, model, meshById, sheetSettings, store.points, store.runs]);

  const planSheet = useMemo(() => {
    if (!planDrawing || !sheetSettings) return null;
    const info = { ...sheetSettings.info, conteudo: sheetSettings.info.conteudo || `Instalações MEP — Planta ${sheetSettings.storey}` };
    return renderSheet(planDrawing, sheetSettings.format, info, titleBlocks.find((t) => t.id === sheetSettings.titleBlockId) ?? null);
  }, [planDrawing, sheetSettings, titleBlocks]);

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
      if (id < 0) {
        const p = store.points.find((x) => x.id === id);
        return p ? pointProperties(p) : [];
      }
      return model?.getProperties(id) ?? [];
    },
    [model, store.points, store.runs],
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
        return { id: p.id, shape: def.shape, size: sizeMeters(def), position: p.position, rotation: p.rotation, color: DISCIPLINE_BY_ID[def.discipline].color };
      }),
    );
  }, [store.points, model]);

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
    viewerRef.current?.setExtras("runs", [...visuals, ...fittings]);
  }, [store.runs, model]);

  // Ganchos para testes automatizados da interface (somente em desenvolvimento).
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __mep: { viewer: viewerRef.current, model, store } });
  }, [model, store]);

  const dirtyRef = useRef(false);
  dirtyRef.current = store.dirty && !store.isEmpty;

  // ---- Abertura de arquivos ------------------------------------------------
  const openFile = useCallback(async (file: OpenedFile) => {
    if (dirtyRef.current && !window.confirm("Há pontos e trechos não salvos neste modelo. Abrir outro modelo e descartá-los?")) return;
    setError(null);
    setProgress("Inicializando leitor IFC…");
    // Deixa a interface pintar a mensagem antes do processamento pesado.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const api = await getIfcApi();
      modelRef.current?.close();
      const loaded = loadIfc(api, file.data, (stage) => setProgress(stage));
      modelRef.current = loaded;
      const disciplineOf = new Map(loaded.elements.map((e) => [e.expressID, e.discipline]));
      viewerRef.current!.load(loaded.meshes, (id) => DISCIPLINE_BY_ID[disciplineOf.get(id) ?? "outros"].color);
      store.reset([], []);
      setPlanSettings(null);
      setModel(loaded);
      setFileName(file.name);
      setFilters(EMPTY_FILTERS);
      setSelection([]);
      setStoreyView(null);
      setSection(NO_SECTION);
      setView("3d");
      setTop((t) => (t === "arquivo" ? "modelo" : t));
      document.title = `${file.name} — SmartEasyBIM`;
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }, []);

  const handleOpen = useCallback(async () => {
    const file = await openIfc();
    if (file) await openFile(file);
  }, [openFile]);

  const handleSample = useCallback(async () => {
    const res = await fetch(new URL("samples/exemplo-mep.ifc", document.baseURI));
    await openFile({ name: "exemplo-mep.ifc", path: null, data: new Uint8Array(await res.arrayBuffer()) });
  }, [openFile]);

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
    return allElements.filter((e) => {
      if (filters.hiddenDisciplines.has(e.discipline)) return false;
      if (filters.hiddenStoreys.has(e.storey ?? NO_STOREY)) return false;
      if (filters.systems.size && !e.systems.some((s) => filters.systems.has(s))) return false;
      if (q) {
        const hay = `${e.name} ${e.objectType ?? ""} ${getTypeLabel(e.ifcType)} ${e.ifcType} ${e.size ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [model, allElements, filters]);

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
      if (name) setStorey(name);
      else setView("3d");
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
        case "abrirProjeto":
          return void files.open();
        case "salvarProjeto":
          return void files.save();
        case "exportarIfc":
          return void files.exportIfc();
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
      }
    },
    [handleOpen, handleSample, files, view],
  );

  const pressed: Partial<Record<ActionId, boolean>> = {
    temaClaro: theme === "claro",
    temaEscuro: theme === "escuro",
    cores: colorMode === "disciplina",
    vistaPlanta: view === "planta",
    vista3d: view === "3d",
    corte: view === "3d" && (sectionOpen || sectionActive),
  };

  // Mensagens dos arquivos de projeto somem sozinhas.
  useEffect(() => {
    if (!files.message) return;
    const t = setTimeout(() => files.setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [files.message, files.setMessage]);

  const disc = toolDisc ? DISCIPLINE_TABS[toolDisc] : null;
  const selectedOne = selection.length === 1 ? (elementById.get(selection[0]) ?? null) : null;
  const viewer = viewerRef.current;
  const rightWidth = tool.kind === "propriedades" ? 340 : tool.kind === "pranchas" ? 400 : 460;
  const projectName = (fileName ?? "").replace(/\.ifc$/i, "");

  const rightPanel = () => {
    if (tool.kind === "calc") return <CalcPanel selected={selectedOne} which={tool.which} />;
    if (!model || !viewer) return <div className="empty-side">Abra um modelo IFC em Arquivo › Abrir IFC.</div>;
    switch (tool.kind) {
      case "propriedades":
        return <PropertiesPanel elements={selection.map((id) => elementById.get(id)).filter(Boolean) as ElementInfo[]} getProperties={getProperties} onFrame={selectAndFrame} />;
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
            preset={{ typeId: tool.typeId, n: tool.n }}
          />
        );
      case "circuitos":
        return <CircuitosPanel model={model} fileName={fileName} store={store} selection={selection} onSelect={selectPoints} />;
      case "quantitativos":
        return <QuantitiesPanel elements={visibleElements} fileName={fileName} onSelect={selectAndFrame} />;
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
      case "pranchas":
        if (!sheetSettings || !planDrawing || !planSheet)
          return <div className="empty-side">Abra a vista Prancha para configurar a folha.</div>;
        return (
          <PlantaPanel
            settings={sheetSettings}
            onChange={(s) => {
              setPlanSettings(s);
              if (s.storey !== storey) setStorey(s.storey);
            }}
            storeys={model.storeys}
            drawing={planDrawing}
            sheet={planSheet}
            fileName={fileName}
            available={planAvailable}
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

      <main className="workspace" style={{ gridTemplateColumns: `${leftOpen ? 260 : 0}px minmax(0, 1fr) ${rightOpen ? rightWidth : 0}px` }}>
        <aside className={`sidebar ${leftOpen ? "" : "collapsed"}`} aria-hidden={!leftOpen}>
          {model ? (
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
                <button className={`view-tab ${view === "planta" ? "active" : ""}`} onClick={() => setView("planta")}>
                  Planta · {storey}
                </button>
                <button className={`view-tab ${view === "3d" ? "active" : ""}`} onClick={() => setView("3d")}>
                  3D · {storeyView ?? "Modelo completo"}
                </button>
                <button className={`view-tab ${view === "prancha" ? "active" : ""}`} onClick={() => chooseTool({ kind: "pranchas" })}>
                  Prancha
                </button>
              </>
            )}
            <div className="spacer" />
            {model && view === "planta" && (
              <label className="cut-input" title="Altura do plano de corte acima do piso">
                corte
                <input type="number" step={0.1} min={0.2} value={editorCut} onChange={(e) => setEditorCut(Math.max(0.2, Number(e.target.value)))} />m
              </label>
            )}
            <button className="icon-btn" onClick={() => setRightOpen(!rightOpen)} title={rightOpen ? "Ocultar painel direito" : "Mostrar painel direito"} aria-pressed={rightOpen}>
              <Icon name="painelDir" size={18} />
            </button>
          </div>

          <div className="viewport">
            <div ref={viewerHost} className="viewer-host" />
            {view === "planta" && model && viewer && storey && (
              <PlanEditor
                viewer={viewer}
                model={model}
                store={store}
                storey={storey}
                cutHeight={editorCut}
                selection={selection}
                elementById={elementById}
                onPick={pick}
                dark={theme === "escuro"}
                fitSignal={fitSignal}
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
            {view === "prancha" && planSheet && (
              <PlanView sheet={planSheet} selection={selection} onSelect={(ids, additive) => setSelection((cur) => (additive ? [...new Set([...cur, ...ids])] : ids))} fitSignal={fitSignal} />
            )}
            {!model && !progress && (
              <div className="welcome">
                <LogoMark size={72} light={theme === "escuro"} />
                <h1>
                  Smart<span>Easy</span>BIM
                </h1>
                <p>Projetos de instalações MEP sobre modelos IFC. Abra um modelo (Revit, Archicad etc.) ou arraste o arquivo para esta janela.</p>
                <div className="welcome-actions">
                  <button className="btn primary" onClick={handleOpen}>
                    Abrir IFC…
                  </button>
                  <button className="btn" onClick={handleSample}>
                    Abrir modelo de exemplo
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
            <span>{TOOL_HINT[tool.kind]}</span>
          </>
        )}
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
