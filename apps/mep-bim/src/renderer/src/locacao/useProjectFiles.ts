import { useCallback, useState } from "react";
import { exportPointsIfc } from "../../../core/ifcExport";
import { deserializeProject, serializeProject } from "../../../core/project";
import type { LoadedModel } from "../../../ifc/loadIfc";
import { openTextFile, saveFile } from "../platform";
import type { PointsStore } from "./usePointsStore";

const base = (name: string | null) => (name ?? "modelo").replace(/\.ifc$/i, "");

/** Salvar, abrir e exportar o projeto do app (pontos locados e trechos). */
export function useProjectFiles(store: PointsStore, model: LoadedModel | null, fileName: string | null, onOpened?: () => void) {
  const [message, setMessage] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!model) return;
    const json = JSON.stringify(serializeProject({ points: store.points, runs: store.runs, circuits: store.circuits, program: store.program, links: store.links }, model.coordinates, fileName), null, 2);
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
      const { points, runs, circuits, program, links } = deserializeProject(json, model.coordinates);
      store.reset(points, runs, circuits, program, links);
      onOpened?.();
      const other = json.modeloIfc && fileName && json.modeloIfc !== fileName;
      setMessage(
        `${points.length} pontos, ${runs.length} trechos e ${circuits.length} circuitos carregados de ${file.name}.${other ? ` Atenção: salvos para o modelo "${json.modeloIfc}".` : ""}`,
      );
    } catch (e) {
      setMessage(`Não foi possível abrir: ${e instanceof Error ? e.message : e}`);
    }
  }, [store, model, fileName, onOpened]);

  const exportIfc = useCallback(async () => {
    if (!model) return;
    const text = exportPointsIfc(store.points, { modelName: fileName, storeys: model.storeyLevels, cs: model.coordinates, runs: store.runs, circuits: store.circuits });
    const saved = await saveFile({
      defaultName: `${base(fileName)}-mep.ifc`,
      content: text,
      filters: [{ name: "IFC", extensions: ["ifc"] }],
    });
    if (saved) setMessage(`IFC exportado: ${saved}. Abra junto com o modelo original para federar.`);
  }, [store, model, fileName]);

  return { save, open, exportIfc, message, setMessage };
}
