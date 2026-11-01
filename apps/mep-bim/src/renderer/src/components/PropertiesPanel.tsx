import { DISCIPLINE_BY_ID, getTypeLabel } from "../../../core/disciplines";
import { formatNumber } from "../../../core/format";
import type { ElementInfo, PropertyGroup } from "../../../core/types";

interface Props {
  elements: ElementInfo[];
  getProperties: (id: number) => PropertyGroup[];
  onFrame: (ids: number[]) => void;
}

const fmt = (v: unknown) => (typeof v === "number" ? formatNumber(v, Number.isInteger(v) ? 0 : 3) : v === true ? "Sim" : v === false ? "Não" : String(v ?? "—"));

export function PropertiesPanel({ elements, getProperties, onFrame }: Props) {
  if (!elements.length) {
    return (
      <div className="panel-body">
        <h2>Propriedades</h2>
        <p className="muted">Selecione um elemento no modelo para ver suas propriedades.</p>
      </div>
    );
  }
  if (elements.length > 1) {
    return (
      <div className="panel-body">
        <h2>{elements.length} elementos selecionados</h2>
        <button className="btn" onClick={() => onFrame(elements.map((e) => e.expressID))}>
          Enquadrar seleção
        </button>
        <ul className="plain-list">
          {elements.map((e) => (
            <li key={e.expressID}>
              <span className="swatch" style={{ background: DISCIPLINE_BY_ID[e.discipline].color }} /> {e.name}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const el = elements[0];
  const d = DISCIPLINE_BY_ID[el.discipline];
  const summary: [string, string][] = [
    ["Disciplina", d.label],
    ["Tipo", `${getTypeLabel(el.ifcType)} (${el.ifcType})`],
    ["Tipo pré-definido", el.predefinedType ?? "—"],
    ["Pavimento", el.storey ?? "—"],
    ["Sistema(s)", el.systems.join(", ") || "—"],
    ["Dimensão", el.size ?? "—"],
    ["Comprimento", el.length != null ? `${formatNumber(el.length, 2)} m` : "—"],
    ["GlobalId", el.globalId],
  ];

  return (
    <div className="panel-body">
      <h2 className="el-title">
        <span className="swatch" style={{ background: d.color }} />
        {el.name}
      </h2>
      {el.objectType && <div className="muted">{el.objectType}</div>}
      <button className="btn small-btn" onClick={() => onFrame([el.expressID])}>
        Enquadrar
      </button>
      <table className="props">
        <tbody>
          {summary.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {getProperties(el.expressID).map((g, i) => (
        <details key={i} open={i < 3}>
          <summary>
            {g.name} <span className="muted small">{g.kind === "quantidades" ? "quantidades" : ""}</span>
          </summary>
          <table className="props">
            <tbody>
              {g.values.map((v, j) => (
                <tr key={j}>
                  <th>{v.name}</th>
                  <td>{fmt(v.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
