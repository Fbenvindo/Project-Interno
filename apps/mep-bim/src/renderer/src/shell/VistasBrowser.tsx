// Navegador de vistas (como o do Revit): Trabalho, Documentação e Folhas.
import { useState } from "react";
import { DISCIPLINES } from "../../../core/disciplines";
import type { Discipline } from "../../../core/types";
import type { SheetDef } from "../../../core/viewDrawing";
import { docPlanId, KIND_LABEL, SECTION_LABEL, type ViewDef, type ViewKind, type ViewSection } from "../../../core/views";

/** Chave da vista aberta: "trab:<pavimento>", "doc:<pavimento>", "view:<id>" ou "sheet:<id>". */
export type ViewKey = string;

interface Props {
  storeys: string[];
  views: ViewDef[];
  sheets: SheetDef[];
  active: ViewKey | null;
  /** Disciplinas do projeto (o IFC que este projeto entrega). */
  disciplines: Discipline[];
  available: Discipline[];
  onDisciplines: (d: Discipline[]) => void;
  onOpen: (key: ViewKey) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (key: ViewKey) => void;
  onNewSheet: () => void;
}

const KINDS: ViewKind[] = ["planta", "ampliacao", "corte", "3d", "fluxograma"];
const MEP = DISCIPLINES.filter((d) => d.isMep);

export function VistasBrowser({ storeys, views, sheets, active, disciplines, available, onDisciplines, onOpen, onRename, onDelete, onNewSheet }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = (k: string) => setClosed((c) => ({ ...c, [k]: !c[k] }));

  const item = (key: ViewKey, label: string, opts: { id?: string; deletable?: boolean; hint?: string } = {}) => (
    <li key={key} className={`vb-item ${active === key ? "on" : ""}`} title={opts.hint}>
      {editing === key && opts.id ? (
        <input
          className="vb-rename"
          autoFocus
          defaultValue={label}
          onBlur={(e) => (onRename(opts.id!, e.target.value.trim() || label), setEditing(null))}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <button className="vb-open" onClick={() => onOpen(key)} onDoubleClick={() => opts.id && setEditing(key)}>
          {label}
        </button>
      )}
      {opts.deletable && (
        <button className="link danger-link vb-del" title="Excluir" onClick={() => window.confirm(`Excluir "${label}"?`) && onDelete(key)}>
          ✕
        </button>
      )}
    </li>
  );

  const section = (sec: ViewSection) => {
    const k = `s:${sec}`;
    return (
      <li key={k} className="vb-group">
        <button className="vb-head" onClick={() => toggle(k)}>
          <span className={`caret ${closed[k] ? "" : "open"}`}>▸</span> {SECTION_LABEL[sec]}
          {sec === "documentacao" && <span className="vb-tag">vai para as folhas</span>}
        </button>
        {!closed[k] && (
          <ul>
            {KINDS.map((kind) => {
              const kk = `${k}:${kind}`;
              const custom = views.filter((v) => v.section === sec && v.kind === kind && !(kind === "planta" && v.id.startsWith("doc-planta:")));
              const list =
                kind === "planta"
                  ? [
                      ...storeys.map((s) => item(sec === "trabalho" ? `trab:${s}` : `doc:${s}`, s, { hint: sec === "trabalho" ? "Tudo visível" : "Só as disciplinas do projeto" })),
                      ...custom.map((v) => item(`view:${v.id}`, v.name, { id: v.id, deletable: true })),
                    ]
                  : custom.map((v) => item(`view:${v.id}`, v.name, { id: v.id, deletable: true }));
              return (
                <li key={kk} className="vb-group">
                  <button className="vb-head sub" onClick={() => toggle(kk)}>
                    <span className={`caret ${closed[kk] ? "" : "open"}`}>▸</span> {KIND_LABEL[kind]} <span className="muted">({list.length})</span>
                  </button>
                  {!closed[kk] && (list.length ? <ul>{list}</ul> : <div className="vb-empty muted small">{emptyHint(kind)}</div>)}
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  const toggleDisc = (d: Discipline) => onDisciplines(disciplines.includes(d) ? disciplines.filter((x) => x !== d) : [...disciplines, d]);

  return (
    <div className="vistas-browser">
      <div className="vb-disc">
        <div className="field-label" title="As disciplinas que o IFC deste projeto entrega. Na Documentação, só elas aparecem (as demais podem entrar em meio-tom).">
          Disciplinas do projeto (IFC)
        </div>
        <div className="chips">
          {MEP.filter((d) => available.includes(d.id) || disciplines.includes(d.id) || ["eletrica", "hidraulica", "hvac", "incendio"].includes(d.id)).map((d) => {
            const on = disciplines.includes(d.id);
            return (
              <button key={d.id} className={`chip small ${on ? "on" : ""}`} style={on ? { borderColor: d.color, background: d.color + "33" } : undefined} onClick={() => toggleDisc(d.id)}>
                {d.label.replace(" / Climatização", "").replace(" / Dados", "")}
              </button>
            );
          })}
        </div>
        {!disciplines.length && <div className="muted small">Nenhuma marcada: a documentação mostra todas as instalações.</div>}
      </div>
      <ul className="vb-tree">
        {section("trabalho")}
        {section("documentacao")}
        <li className="vb-group">
          <button className="vb-head" onClick={() => toggle("folhas")}>
            <span className={`caret ${closed.folhas ? "" : "open"}`}>▸</span> Folhas <span className="muted">({sheets.length})</span>
          </button>
          {!closed.folhas && (
            <ul>
              {sheets.map((s) => item(`sheet:${s.id}`, s.name, { deletable: true }))}
              <li>
                <button className="link vb-new" onClick={onNewSheet}>
                  + Nova folha
                </button>
              </li>
            </ul>
          )}
        </li>
      </ul>
    </div>
  );
}

function emptyHint(kind: ViewKind): string {
  if (kind === "ampliacao") return "Geral › Ampliação";
  if (kind === "corte") return "Geral › Corte por linha";
  if (kind === "3d") return "Geral › Vista 3D no local ou Corte pela seleção";
  if (kind === "fluxograma") return "Elétrica › Novo fluxograma";
  return "";
}

export const docKey = (storey: string) => `doc:${storey}`;
export const viewIdOfKey = (key: ViewKey, views: ViewDef[]): string | null =>
  key.startsWith("view:") ? key.slice(5) : key.startsWith("doc:") ? docPlanId(key.slice(4)) : views.length ? null : null;
