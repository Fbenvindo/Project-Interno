import { deviceMaterials, type DeviceAssembly } from "../../../core/devices";
import { useMemo, useState } from "react";
import { MEP_DISCIPLINES } from "../../../core/disciplines";
import { formatNumber, toCsv } from "../../../core/format";
import { buildQuantities } from "../../../core/quantities";
import type { ElementInfo } from "../../../core/types";
import { saveFile } from "../platform";

interface Props {
  elements: ElementInfo[];
  /** Montagens (caixas e módulos) dos pontos de tomada e comando visíveis. */
  assemblies?: DeviceAssembly[];
  fileName: string | null;
  onSelect: (ids: number[]) => void;
}

export function QuantitiesPanel({ elements, assemblies = [], fileName, onSelect }: Props) {
  const materials = useMemo(() => deviceMaterials(assemblies), [assemblies]);
  const [onlyMep, setOnlyMep] = useState(true);
  const [byStorey, setByStorey] = useState(true);
  const [bySystem, setBySystem] = useState(true);
  const [byName, setByName] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      buildQuantities(onlyMep ? elements.filter((e) => MEP_DISCIPLINES.includes(e.discipline)) : elements, {
        groupByStorey: byStorey,
        groupBySystem: bySystem,
        groupByName: byName,
      }),
    [elements, onlyMep, byStorey, bySystem, byName],
  );

  const exportCsv = async () => {
    const csv = toCsv(
      ["Disciplina", "Tipo", "Descrição", "Dimensão", "Sistema", "Pavimento", "Unidade", "Quantidade", "Nº de elementos"],
      [
        ...rows.map((r) => [r.disciplineLabel, r.typeLabel, r.description, r.size, r.system, r.storey, r.unit, r.quantity, r.count]),
        ...materials.map((m) => ["Elétrica", "Caixas e módulos", m.description, "", "", "", "un", m.quantity, m.quantity]),
      ],
    );
    const base = (fileName ?? "modelo").replace(/\.ifc$/i, "");
    const saved = await saveFile({ defaultName: `${base}-quantitativos.csv`, content: csv, filters: [{ name: "CSV (Excel)", extensions: ["csv"] }] });
    setStatus(saved ? `Exportado: ${saved}` : null);
  };

  let lastDiscipline = "";
  return (
    <div className="panel-body">
      <div className="panel-head">
        <h2>Quantitativos</h2>
        <button className="btn primary" onClick={exportCsv} disabled={!rows.length}>
          Exportar CSV
        </button>
      </div>
      <p className="muted small">Considera os elementos visíveis (filtros à esquerda). Segmentos em metros; demais em unidades.</p>
      <div className="options">
        <label>
          <input type="checkbox" checked={onlyMep} onChange={(e) => setOnlyMep(e.target.checked)} /> Somente MEP
        </label>
        <label>
          <input type="checkbox" checked={byStorey} onChange={(e) => setByStorey(e.target.checked)} /> Por pavimento
        </label>
        <label>
          <input type="checkbox" checked={bySystem} onChange={(e) => setBySystem(e.target.checked)} /> Por sistema
        </label>
        <label>
          <input type="checkbox" checked={byName} onChange={(e) => setByName(e.target.checked)} /> Por descrição
        </label>
      </div>
      {status && <div className="status">{status}</div>}
      <table className="grid-table">
        <thead>
          <tr>
            <th>Tipo / descrição</th>
            <th>Dim.</th>
            {bySystem && <th>Sistema</th>}
            {byStorey && <th>Pav.</th>}
            <th className="num">Qtd.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const header = r.disciplineLabel !== lastDiscipline;
            lastDiscipline = r.disciplineLabel;
            const cols = 3 + (bySystem ? 1 : 0) + (byStorey ? 1 : 0);
            return [
              header && (
                <tr key={r.key + ":h"} className="group-row">
                  <td colSpan={cols}>{r.disciplineLabel}</td>
                </tr>
              ),
              <tr key={r.key} className="clickable" onClick={() => onSelect(r.expressIDs)} title="Selecionar no modelo">
                <td>
                  {r.typeLabel}
                  {r.description && <div className="muted small">{r.description}</div>}
                </td>
                <td>{r.size || "—"}</td>
                {bySystem && <td className="small">{r.system || "—"}</td>}
                {byStorey && <td className="small">{r.storey || "—"}</td>}
                <td className="num">
                  {r.unit === "m" ? `${formatNumber(r.quantity, 2)} m` : `${r.quantity} un`}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      {!rows.length && <p className="muted">Nenhum elemento para quantificar com os filtros atuais.</p>}
      {materials.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>
            Caixas e módulos (tomadas e comandos)
          </div>
          <table className="grid-table">
            <tbody>
              {materials.map((m) => (
                <tr key={m.description}>
                  <td>{m.description}</td>
                  <td className="num">{m.quantity} un</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
