import { useCallback, useState, useSyncExternalStore } from "react";
import { disciplinesInUse, exportPointsIfc, filterByDisciplines } from "../../../core/ifcExport";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import type { Discipline } from "../../../core/types";
import { effectiveGeoref } from "../../../core/georef";
import { deserializeProject, serializeProject } from "../../../core/project";
import type { LoadedModel } from "../../../ifc/loadIfc";
import { desktop, openTextFile, saveFile } from "../platform";
import type { PointsStore } from "./usePointsStore";

const base = (name: string | null) => (name ?? "modelo").replace(/\.ifc$/i, "");
const slugDisc = (d: Discipline) => (d === "hvac" ? "climatizacao" : d === "eletrica" ? "eletrica" : d);

// ---- Arquivo do projeto (compartilhado por todos os painéis) -----------------------------------
// O projeto (.seb) é o arquivo do usuário: guarda pontos, trechos, desenhos, vistas, folhas e
// as referências aos IFCs (modelo base e vínculos), que são de terceiros e nunca são alterados.
export const PROJECT_EXT = "seb";
const PROJECT_FILTERS = [{ name: "Projeto SmartEasyBIM (.seb)", extensions: [PROJECT_EXT, "json"] }];

interface ProjectFileState {
  /** Caminho do .seb aberto/salvo (desktop); null = projeto ainda não salvo. */
  path: string | null;
  name: string | null;
}
let current: ProjectFileState = { path: null, name: null };
const fileListeners = new Set<() => void>();
export function setProjectFile(s: ProjectFileState) {
  current = s;
  fileListeners.forEach((l) => l());
}
export const useProjectFile = () =>
  useSyncExternalStore(
    (cb) => (fileListeners.add(cb), () => fileListeners.delete(cb)),
    () => current,
    () => current,
  );

/** Carrega o modelo base indicado no projeto (definido pelo app); devolve o modelo ou null se o usuário desistir. */
type HostLoader = (name: string | null, path: string | null) => Promise<LoadedModel | null>;
let hostLoader: HostLoader | null = null;
export const setHostLoader = (fn: HostLoader | null) => {
  hostLoader = fn;
};

/** Salvar, abrir e exportar o projeto do app. */
export function useProjectFiles(store: PointsStore, model: LoadedModel | null, fileName: string | null, onOpened?: () => void, hostPath: string | null = null) {
  const [message, setMessage] = useState<string | null>(null);
  const file = useProjectFile();

  const write = useCallback(
    async (saveAs: boolean) => {
      if (!model) return;
      const json = JSON.stringify(
        {
          ...serializeProject(
            { points: store.points, runs: store.runs, circuits: store.circuits, program: store.program, links: store.links, georef: store.georef, drafts: store.drafts, views: store.views, sheets: store.sheets, disciplines: store.disciplines, choices: store.choices, installSettings: store.installSettings },
            model.coordinates,
            fileName,
          ),
          modeloIfcCaminho: hostPath,
        },
        null,
        2,
      );
      const name = file.name ?? `${base(fileName)}.${PROJECT_EXT}`;
      const saved = await saveFile({
        defaultName: name,
        content: json,
        filters: PROJECT_FILTERS,
        ...(!saveAs && file.path ? { path: file.path } : {}),
      });
      if (saved) {
        store.markSaved();
        setProjectFile({ path: desktop ? saved : null, name: saved.split(/[\\/]/).pop() ?? name });
        setMessage(`Projeto salvo: ${saved}`);
      }
    },
    [store, model, fileName, file, hostPath],
  );
  const save = useCallback(() => write(false), [write]);
  const saveAs = useCallback(() => write(true), [write]);

  const open = useCallback(async () => {
    if (store.dirty && !store.isEmpty && !window.confirm("Há alterações não salvas. Abrir outro projeto e descartá-las?")) return;
    const f = await openTextFile(PROJECT_FILTERS);
    if (!f) return;
    try {
      const json = JSON.parse(f.content);
      const hostName: string | null = json.modeloIfc ?? null;
      let m = model;
      // O projeto é de outro modelo base (ou nenhum está aberto): abre o IFC de referência dele.
      if (!m || (hostName && hostName !== fileName)) {
        m = hostLoader ? await hostLoader(hostName, json.modeloIfcCaminho ?? null) : null;
        if (!m) {
          setMessage(`Projeto não aberto: o modelo IFC "${hostName ?? "?"}" não foi carregado.`);
          return;
        }
      }
      const d = deserializeProject(json, m.coordinates);
      store.reset(d);
      setProjectFile({ path: f.path, name: f.name });
      const { points, runs, circuits } = d;
      onOpened?.();
      setMessage(`Projeto ${f.name}: ${points.length} pontos, ${runs.length} trechos e ${circuits.length} circuitos.`);
    } catch (e) {
      setMessage(`Não foi possível abrir: ${e instanceof Error ? e.message : e}`);
    }
  }, [store, model, fileName, onOpened]);

  /**
   * IFC das instalações. Com disciplinas do projeto definidas, só elas entram (o IFC da disciplina);
   * `perDiscipline` grava um arquivo para cada disciplina com algo locado ou traçado.
   */
  const exportIfc = useCallback(
    async (perDiscipline = false) => {
      if (!model) return;
      const groups: { disc: Discipline[] | null; suffix: string; title?: string }[] = perDiscipline
        ? disciplinesInUse(store.points, store.runs).map((d) => ({ disc: [d], suffix: slugDisc(d), title: DISCIPLINE_BY_ID[d].label }))
        : store.disciplines.length
          ? [{ disc: store.disciplines, suffix: store.disciplines.map(slugDisc).join("-"), title: store.disciplines.map((d) => DISCIPLINE_BY_ID[d].label).join(", ") }]
          : [{ disc: null, suffix: "mep" }];
      if (!groups.length) return setMessage("Nada locado ou traçado para exportar.");
      const saved: string[] = [];
      for (const g of groups) {
        const sel = g.disc ? filterByDisciplines(store.points, store.runs, store.circuits, new Set(g.disc)) : { points: store.points, runs: store.runs, circuits: store.circuits };
        if (!sel.points.length && !sel.runs.length) continue;
        const text = exportPointsIfc(sel.points, {
          modelName: fileName,
          storeys: model.storeyLevels,
          cs: model.coordinates,
          runs: sel.runs,
          circuits: sel.circuits,
          georef: effectiveGeoref(model.georef, store.georef),
          title: g.title,
        });
        const path = await saveFile({ defaultName: `${base(fileName)}-${g.suffix}.ifc`, content: text, filters: [{ name: "IFC", extensions: ["ifc"] }] });
        if (path) saved.push(path);
        else if (perDiscipline) break;
      }
      if (saved.length) setMessage(`IFC exportado: ${saved.join(" · ")}. Cada disciplina pode ser vinculada nos projetos das outras (Arquivo › Vincular IFC).`);
      else if (!perDiscipline && groups[0].disc) setMessage("Nada das disciplinas do projeto para exportar.");
    },
    [store, model, fileName],
  );

  return { save, saveAs, open, exportIfc, message, setMessage, projectFile: file };
}
