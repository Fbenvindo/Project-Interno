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
import { usePointsStore } from "./locacao/usePointsStore";

type Tab = "modelo" | "locacao" | "quantitativos" | "interferencias" | "dimensionamento";

const TABS: { id: Tab; label: string }[] = [
  { id: "modelo", label: "Modelo" },
  { id: "locacao", label: "Locação" },
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

  const store = usePointsStore();
  const pointElements = useMemo(() => store.points.map(pointToElement), [store.points]);
  const allElements = useMemo(() => (model ? [...model.elements, ...pointElements] : []), [model, pointElements]);
  const elementById = useMemo(() => new Map(allElements.map((e) => [e.expressID, e])), [allElements]);
  const allSystems = useMemo(
    () => [...new Set([...(model?.systems ?? []), ...store.points.map((p) => p.system).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [model, store.points],
  );
  const getProperties = useCallback(
    (id: number) => {
      if (id < 0) {
        const p = store.points.find((x) => x.id === id);
        return p ? pointProperties(p) : [];
      }
      return model?.getProperties(id) ?? [];
    },
    [model, store.points],
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

  useEffect(() => viewerRef.current?.setSelection(selection), [selection]);
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

  // Ganchos para testes automatizados da interface (somente em desenvolvimento).
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __mep: { viewer: viewerRef.current, model, store } });
  }, [model, store]);

  const dirtyRef = useRef(false);
  dirtyRef.current = store.dirty && store.points.length > 0;

  // ---- Abertura de arquivos ------------------------------------------------
  const openFile = useCallback(async (file: OpenedFile) => {
    if (dirtyRef.current && !window.confirm("Há pontos locados não salvos neste modelo. Abrir outro modelo e descartá-los?")) return;
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
      store.reset([]);
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
          {model && tab !== "locacao" && <div className="hint">Clique para selecionar · Ctrl+clique para somar · duplo clique para enquadrar</div>}
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
          {tab === "quantitativos" && model && <QuantitiesPanel elements={visibleElements} fileName={fileName} onSelect={selectAndFrame} />}
          {tab === "interferencias" && model && (
            <ClashPanel
              elements={visibleElements}
              elementById={elementById}
              fileName={fileName}
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
