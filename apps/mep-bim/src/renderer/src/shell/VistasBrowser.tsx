// Navegador de vistas (como o do Revit): Trabalho, Documentação e Folhas.
import { useState } from "react";
import { DISCIPLINES } from "../../../core/disciplines";
import type { Discipline } from "../../../core/types";
import type { SheetDef } from "../../../core/viewDrawing";
import { docPlanId, isDocPlanId, KIND_LABEL, PLAN_TYPE_LABEL, SECTION_LABEL, type PlanType, type ViewDef, type ViewKind, type ViewSection } from "../../../core/views";

/**
 * Chave da vista aberta: "trab:<pavimento>", "trab-teto:<pavimento>", "doc:<pavimento>",
 * "doc-teto:<pavimento>", "view:<id>" ou "sheet:<id>".
 */
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
              const custom = views.filter((v) => v.section === sec && v.kind === kind && !(kind === "planta" && isDocPlanId(v.id)));
              // Plantas de piso e de teto de todos os pavimentos.
              const typeGroup = (type: PlanType) => {
                const tk = `${kk}:${type}`;
                const hint = `${PLAN_TYPE_LABEL[type]} · ${sec === "trabalho" ? "tudo visível" : "só as disciplinas do projeto"}${type === "teto" ? " · vigas do pavimento de cima" : " · vigas da laje de baixo"}`;
                return (
                  <li key={tk} className="vb-group">
                    <button className="vb-head sub" onClick={() => toggle(tk)}>
                      <span className={`caret ${closed[tk] ? "" : "open"}`}>▸</span> {PLAN_TYPE_LABEL[type]} <span className="muted">({storeys.length})</span>
                    </button>
                    {!closed[tk] && <ul>{storeys.map((s) => item(planKeyOf(sec, type, s), s, { hint }))}</ul>}
                  </li>
                );
              };
              const list =
                kind === "planta"
                  ? [typeGroup("piso"), typeGroup("teto"), ...custom.map((v) => item(`view:${v.id}`, v.name, { id: v.id, deletable: true }))]
                  : custom.map((v) => item(`view:${v.id}`, v.name, { id: v.id, deletable: true }));
              const count = kind === "planta" ? storeys.length * 2 + custom.length : list.length;
              return (
                <li key={kk} className="vb-group">
                  <button className="vb-head sub" onClick={() => toggle(kk)}>
                    <span className={`caret ${closed[kk] ? "" : "open"}`}>▸</span> {KIND_LABEL[kind]} <span className="muted">({count})</span>
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

/** Prefixo da planta de pavimento por seção e tipo. */
export const PLAN_PREFIX = { trabalho: { piso: "trab", teto: "trab-teto" }, documentacao: { piso: "doc", teto: "doc-teto" } } as const;
export const planKeyOf = (sec: ViewSection, type: PlanType, storey: string) => `${PLAN_PREFIX[sec][type]}:${storey}`;
/** Planta de pavimento pela chave: seção, tipo e pavimento (null se não for). */
export function parsePlanKey(key: ViewKey): { section: ViewSection; type: PlanType; storey: string } | null {
  const i = key.indexOf(":");
  const p = i < 0 ? key : key.slice(0, i);
  const storey = i < 0 ? "" : key.slice(i + 1);
  if (p === "trab") return { section: "trabalho", type: "piso", storey };
  if (p === "trab-teto") return { section: "trabalho", type: "teto", storey };
  if (p === "doc") return { section: "documentacao", type: "piso", storey };
  if (p === "doc-teto") return { section: "documentacao", type: "teto", storey };
  return null;
}
export const viewIdOfKey = (key: ViewKey): string | null => {
  if (key.startsWith("view:")) return key.slice(5);
  const p = parsePlanKey(key);
  return p && p.section === "documentacao" ? docPlanId(p.storey, p.type) : null;
};
