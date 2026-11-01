import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DISCIPLINE_BY_ID, getTypeLabel } from "../../core/disciplines";
import { COMPONENT_BY_ID } from "../../core/library";
import { sizeMeters } from "../../core/placement";
import { pointProperties, pointToElement, type PlacedPoint } from "../../core/points";
import type { Discipline, ElementInfo, Vec3 } from "../../core/types";
import { loadIfc, type LoadedModel } from "../../ifc/loadIfc";
import { desktop, getIfcApi, openIfc } from "./platform";
import { Viewer, type ColorMode } from "./viewer/Viewer";
import { FilterPanel, NO_STOREY, type Filters } from "./components/FilterPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { QuantitiesPanel } from "./components/QuantitiesPanel";
import { ClashPanel } from "./components/ClashPanel";
import { CalcPanel } from "./components/CalcPanel";
import type { OpenedFile } from "../../shared/ipc";
import { LocacaoPanel } from "./locacao/LocacaoPanel";
import { TracadoPanel } from "./tracado/TracadoPanel";
import { PlanView } from "./planta/PlanView";
import { PlantaPanel, type PlanSettings } from "./planta/PlantaPanel";
import { buildPlan } from "../../core/plan/build";
import { renderSheet } from "../../core/plan/sheet";
import { DISCIPLINES } from "../../core/disciplines";
import { connectedPairs, runElements, runFittings, runIdOfElement, runProperties, runSegments, RUN_TYPE_BY_ID, segmentElementId, fittingElementId } from "../../core/runs";
import { usePointsStore } from "./locacao/usePointsStore";

type Tab = "modelo" | "locacao" | "tracado" | "planta" | "quantitativos" | "interferencias" | "dimensionamento";

const TABS: { id: Tab; label: string }[] = [
  { id: "modelo", label: "Modelo" },
  { id: "locacao", label: "Locação" },
  { id: "tracado", label: "Traçado" },
  { id: "planta", label: "Planta 2D" },
  { id: "quantitativos", label: "Quantitativos" },
  { id: "interferencias", label: "Interferências" },
  { id: "dimensionamento", label: "Dimensionamento" },
];

const EMPTY_FILTERS: Filters = { hiddenDisciplines: new Set(), hiddenStoreys: new Set(), systems: new Set(), search: "" };

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

export function App() {
  const viewerHost = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("modelo");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<number[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>("disciplina");
  const [planSettings, setPlanSettings] = useState<PlanSettings | null>(null);

  const store = usePointsStore();
  const pointElements = useMemo(() => store.points.map(pointToElement), [store.points]);
  const runElementList = useMemo(() => (model ? runElements(store.runs, model.storeyLevels) : []), [store.runs, model]);
  const allElements = useMemo(() => (model ? [...model.elements, ...pointElements, ...runElementList] : []), [model, pointElements, runElementList]);
  const elementById = useMemo(() => new Map(allElements.map((e) => [e.expressID, e])), [allElements]);
  const connected = useMemo(() => connectedPairs(store.runs, store.points), [store.runs, store.points]);
  const meshById = useMemo(() => new Map(model?.meshes.map((m) => [m.expressID, m]) ?? []), [model]);

  // ---- Planta 2D ---------------------------------------------------------------
  const planAvailable = useMemo(() => DISCIPLINES.map((d) => d.id).filter((d) => allElements.some((e) => e.discipline === d)), [allElements]);
  useEffect(() => {
    if (!model || planSettings) return;
    // Pavimento padrão: o que tem mais pontos e trechos; senão, o que tem mais paredes.
    const score = new Map<string, number>();
    for (const p of store.points) if (p.storey) score.set(p.storey, (score.get(p.storey) ?? 0) + 10);
    for (const e of model.elements) if (e.storey && e.ifcType.startsWith("IFCWALL")) score.set(e.storey, (score.get(e.storey) ?? 0) + 1);
    const storey = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? model.storeys[0] ?? "";
    setPlanSettings({
      storey,
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
    });
  }, [model, planSettings, store.points, fileName]);

  const planDrawing = useMemo(() => {
    if (tab !== "planta" || !model || !planSettings) return null;
    return buildPlan({
      elements: model.elements,
      meshes: meshById,
      cs: model.coordinates,
      storeyLevels: model.storeyLevels,
      storey: planSettings.storey,
      cutHeight: planSettings.cutHeight,
      points: store.points,
      runs: store.runs,
      scale: planSettings.scale,
      disciplines: new Set(planSettings.disciplines),
      labels: planSettings.labels,
      spaces: model.spaces,
    });
  }, [tab, model, meshById, planSettings, store.points, store.runs]);

  const planSheet = useMemo(() => {
    if (!planDrawing || !planSettings) return null;
    const info = { ...planSettings.info, conteudo: planSettings.info.conteudo || `Instalações MEP — Planta ${planSettings.storey}` };
    return renderSheet(planDrawing, planSettings.format, info);
  }, [planDrawing, planSettings]);
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
    return () => viewer.dispose();
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current!;
    viewer.onPick = (id, additive) => {
      setSelection((cur) => {
        if (id == null) return additive ? cur : [];
        if (!additive) return [id];
        return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      });
    };
  }, []);

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
      document.title = `${file.name} — MEP BIM`;
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
      const all = new Set(model?.elements.map((e) => e.discipline));
      all.delete(d);
      setFilters((f) => ({ ...f, hiddenDisciplines: all }));
    },
    [model],
  );

  const wide = tab !== "modelo";

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="logo">MEP</span>
          <span className="brand-name">BIM</span>
        </div>
        <button className="btn primary" onClick={handleOpen}>
          Abrir IFC
        </button>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)} disabled={!model && t.id !== "dimensionamento"}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {model && (
          <>
            <label className="toggle">
              <input type="checkbox" checked={colorMode === "disciplina"} onChange={(e) => setColorMode(e.target.checked ? "disciplina" : "ifc")} />
              Cores por disciplina
            </label>
            <button className="btn" onClick={() => viewerRef.current?.fitTo()} title="Enquadrar (F)">
              Enquadrar
            </button>
          </>
        )}
        <span className="file-name" title={fileName ?? ""}>
          {fileName ? `${fileName} · ${model?.schema} · ${model?.elements.length} elementos` : "Nenhum modelo aberto"}
        </span>
      </header>

      <main className={`workspace ${wide ? "wide" : ""}`}>
        <aside className="sidebar">
          {model ? (
            <FilterPanel
              elements={allElements}
              storeys={model.storeys}
              systems={allSystems}
              filters={filters}
              onChange={setFilters}
              visibleCount={visibleElements.length}
              onIsolate={isolateDiscipline}
            />
          ) : (
            <div className="empty-side">Abra um modelo IFC para ver disciplinas, pavimentos e sistemas.</div>
          )}
        </aside>

        <section className="viewport">
          <div ref={viewerHost} className="viewer-host" />
          {tab === "planta" && planSheet && (
            <PlanView
              sheet={planSheet}
              selection={selection}
              onSelect={(ids, additive) =>
                setSelection((cur) => (additive ? [...new Set([...cur, ...ids])] : ids))
              }
            />
          )}
          {!model && !progress && (
            <div className="welcome">
              <h1>Projetos MEP em BIM</h1>
              <p>Abra um modelo IFC (Revit, Archicad, etc.) ou arraste o arquivo para esta janela.</p>
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
          {model && tab !== "locacao" && tab !== "tracado" && tab !== "planta" && <div className="hint">Clique para selecionar · Ctrl+clique para somar · duplo clique para enquadrar</div>}
        </section>

        <aside className="panel">
          {tab === "modelo" && model && (
            <PropertiesPanel elements={selection.map((id) => elementById.get(id)).filter(Boolean) as ElementInfo[]} getProperties={getProperties} onFrame={selectAndFrame} />
          )}
          {tab === "locacao" && model && viewerRef.current && (
            <LocacaoPanel
              model={model}
              fileName={fileName}
              store={store}
              viewer={viewerRef.current}
              elementById={elementById}
              selection={selection}
              onSelect={selectPoints}
              systems={allSystems}
            />
          )}
          {tab === "tracado" && model && viewerRef.current && (
            <TracadoPanel
              model={model}
              fileName={fileName}
              store={store}
              viewer={viewerRef.current}
              selection={selection}
              onSelect={selectPoints}
              systems={allSystems}
            />
          )}
          {tab === "planta" && model && planSettings && planDrawing && planSheet && (
            <PlantaPanel
              settings={planSettings}
              onChange={setPlanSettings}
              storeys={model.storeys}
              drawing={planDrawing}
              sheet={planSheet}
              fileName={fileName}
              available={planAvailable}
            />
          )}
          {tab === "quantitativos" && model && <QuantitiesPanel elements={visibleElements} fileName={fileName} onSelect={selectAndFrame} />}
          {tab === "interferencias" && model && (
            <ClashPanel
              elements={visibleElements}
              elementById={elementById}
              fileName={fileName}
              meshes={meshById}
              ignorePair={connected}
              onFocus={focusClash}
              onClear={clearHighlight}
            />
          )}
          {tab === "dimensionamento" && <CalcPanel selected={selection.length === 1 ? (elementById.get(selection[0]) ?? null) : null} />}
        </aside>
      </main>
    </div>
  );
}
