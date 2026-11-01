import { useCallback, useState } from "react";
import { exportPointsIfc } from "../../../core/ifcExport";
import { deserializeProject, serializeProject } from "../../../core/project";
import type { LoadedModel } from "../../../ifc/loadIfc";
import { openTextFile, saveFile } from "../platform";
import type { PointsStore } from "./usePointsStore";

const base = (name: string | null) => (name ?? "modelo").replace(/\.ifc$/i, "");

/** Salvar, abrir e exportar o projeto do app (pontos locados e trechos). */
export function useProjectFiles(store: PointsStore, model: LoadedModel, fileName: string | null, onOpened?: () => void) {
  const [message, setMessage] = useState<string | null>(null);

  const save = useCallback(async () => {
    const json = JSON.stringify(serializeProject({ points: store.points, runs: store.runs }, model.coordinates, fileName), null, 2);
    const saved = await saveFile({
      defaultName: `${base(fileName)}.locacao.json`,
      content: json,
      filters: [{ name: "Projeto MEP (locação e traçado)", extensions: ["json"] }],
    });
    if (saved) {
      store.markSaved();
      setMessage(`Projeto salvo: ${saved}`);
    }
  }, [store, model.coordinates, fileName]);

  const open = useCallback(async () => {
    if (store.dirty && !store.isEmpty && !window.confirm("Há alterações não salvas. Substituir pelo projeto do arquivo?")) return;
    const file = await openTextFile([{ name: "Projeto MEP (locação e traçado)", extensions: ["json"] }]);
    if (!file) return;
    try {
      const json = JSON.parse(file.content);
      const { points, runs } = deserializeProject(json, model.coordinates);
      store.reset(points, runs);
      onOpened?.();
      const other = json.modeloIfc && fileName && json.modeloIfc !== fileName;
      setMessage(
        `${points.length} pontos e ${runs.length} trechos carregados de ${file.name}.${other ? ` Atenção: salvos para o modelo "${json.modeloIfc}".` : ""}`,
      );
    } catch (e) {
      setMessage(`Não foi possível abrir: ${e instanceof Error ? e.message : e}`);
    }
  }, [store, model.coordinates, fileName, onOpened]);

  const exportIfc = useCallback(async () => {
    const text = exportPointsIfc(store.points, { modelName: fileName, storeys: model.storeyLevels, cs: model.coordinates, runs: store.runs });
    const saved = await saveFile({
      defaultName: `${base(fileName)}-mep.ifc`,
      content: text,
      filters: [{ name: "IFC", extensions: ["ifc"] }],
    });
    if (saved) setMessage(`IFC exportado: ${saved}. Abra junto com o modelo original para federar.`);
  }, [store, model, fileName]);

  return { save, open, exportIfc, message, setMessage };
}
