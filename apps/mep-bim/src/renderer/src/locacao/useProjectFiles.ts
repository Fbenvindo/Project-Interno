import { useCallback, useState } from "react";
import { disciplinesInUse, exportPointsIfc, filterByDisciplines } from "../../../core/ifcExport";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import type { Discipline } from "../../../core/types";
import { effectiveGeoref } from "../../../core/georef";
import { deserializeProject, serializeProject } from "../../../core/project";
import type { LoadedModel } from "../../../ifc/loadIfc";
import { openTextFile, saveFile } from "../platform";
import type { PointsStore } from "./usePointsStore";

const base = (name: string | null) => (name ?? "modelo").replace(/\.ifc$/i, "");
const slugDisc = (d: Discipline) => (d === "hvac" ? "climatizacao" : d === "eletrica" ? "eletrica" : d);

/** Salvar, abrir e exportar o projeto do app (pontos locados e trechos). */
export function useProjectFiles(store: PointsStore, model: LoadedModel | null, fileName: string | null, onOpened?: () => void) {
  const [message, setMessage] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!model) return;
    const json = JSON.stringify(serializeProject({ points: store.points, runs: store.runs, circuits: store.circuits, program: store.program, links: store.links, georef: store.georef, drafts: store.drafts, views: store.views, sheets: store.sheets, disciplines: store.disciplines }, model.coordinates, fileName), null, 2);
    const saved = await saveFile({
      defaultName: `${base(fileName)}.locacao.json`,
      content: json,
      filters: [{ name: "Projeto MEP (locação e traçado)", extensions: ["json"] }],
    });
    if (saved) {
      store.markSaved();
      setMessage(`Projeto salvo: ${saved}`);
    }
  }, [store, model, fileName]);

  const open = useCallback(async () => {
    if (!model) return;
    if (store.dirty && !store.isEmpty && !window.confirm("Há alterações não salvas. Substituir pelo projeto do arquivo?")) return;
    const file = await openTextFile([{ name: "Projeto MEP (locação e traçado)", extensions: ["json"] }]);
    if (!file) return;
    try {
      const json = JSON.parse(file.content);
      const d = deserializeProject(json, model.coordinates);
      store.reset(d);
      const { points, runs, circuits } = d;
      onOpened?.();
      const other = json.modeloIfc && fileName && json.modeloIfc !== fileName;
      setMessage(
        `${points.length} pontos, ${runs.length} trechos e ${circuits.length} circuitos carregados de ${file.name}.${other ? ` Atenção: salvos para o modelo "${json.modeloIfc}".` : ""}`,
      );
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

  return { save, open, exportIfc, message, setMessage };
}
