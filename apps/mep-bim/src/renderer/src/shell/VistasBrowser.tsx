// Navegador de vistas (como o do Revit): Vistas 3D (geral e uma por pavimento), Plantas,
// Ampliações, Cortes, Vistas específicas (fluxogramas) e Folhas. Cada pavimento (e cada nível de
// laje do pavimento) abre a planta de piso de Trabalho; piso/teto, trabalho/documentação e a faixa
// de visualização (base, corte inferior e superior) ficam na barra de vistas.
import { useState } from "react";
import { DISCIPLINES } from "../../../core/disciplines";
import type { Discipline } from "../../../core/types";
import type { SheetDef } from "../../../core/viewDrawing";
import { isFloorPlanId, type PlanType, type ViewDef, type ViewKind, type ViewSection } from "../../../core/views";

/** Chave da vista aberta: "pav:<pavimento>::<nível>", "view:<id>" ou "sheet:<id>". */
export type ViewKey = string;

/** Entrada de pavimento no navegador: um por pavimento e, se houver, por nível de laje. */
export interface FloorEntry {
  storey: string;
  sub: number;
  /** Nível da laje (ex.: "+0,45") quando o pavimento tem mais de um. */
  levelLabel: string | null;
}

interface Props {
  floors: FloorEntry[];
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
  /** Pavimentos do modelo (uma vista 3D para cada) e a vista 3D por pavimento aberta. */
  storeys: string[];
  storey3d: string | null;
  /** Vista 3D: null = geral (modelo completo). */
  onOpen3d: (storey: string | null) => void;
}

const KINDS: { kind: ViewKind; label: string }[] = [
  { kind: "ampliacao", label: "Ampliações" },
  { kind: "corte", label: "Cortes" },
  { kind: "fluxograma", label: "Vistas específicas" },
];
const MEP = DISCIPLINES.filter((d) => d.isMep);

export const floorKey = (storey: string, sub = 0) => `pav:${storey}::${sub}`;
export function parseFloorKey(key: ViewKey): { storey: string; sub: number } | null {
  if (!key.startsWith("pav:")) return null;
  const rest = key.slice(4);
  const i = rest.lastIndexOf("::");
  return i < 0 ? { storey: rest, sub: 0 } : { storey: rest.slice(0, i), sub: Number(rest.slice(i + 2)) || 0 };
}

export function VistasBrowser({ floors, views, sheets, active, disciplines, available, onDisciplines, onOpen, onRename, onDelete, onNewSheet, storeys, storey3d, onOpen3d }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = (k: string) => setClosed((c) => ({ ...c, [k]: !c[k] }));

  const item = (key: ViewKey, label: string, opts: { id?: string; deletable?: boolean; hint?: string; tag?: string } = {}) => (
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
          {opts.tag && <span className="vb-tag small">{opts.tag}</span>}
        </button>
      )}
      {opts.deletable && (
        <button className="link danger-link vb-del" title="Excluir" onClick={() => window.confirm(`Excluir "${label}"?`) && onDelete(key)}>
          ✕
        </button>
      )}
    </li>
  );

  const group = (k: string, label: string, list: JSX.Element[], empty?: string, extra?: JSX.Element) => (
    <li key={k} className="vb-group">
      <button className="vb-head" onClick={() => toggle(k)}>
        <span className={`caret ${closed[k] ? "" : "open"}`}>▸</span> {label} <span className="muted">({list.length})</span>
      </button>
      {!closed[k] && (
        <ul>
          {list.length ? list : empty ? <div className="vb-empty muted small">{empty}</div> : null}
          {extra}
        </ul>
      )}
    </li>
  );

  const tagOf = (v: ViewDef) => (v.section === "documentacao" ? "doc" : undefined);
  const custom = (kind: ViewKind) =>
    views
      .filter((v) => v.kind === kind && !isFloorPlanId(v.id))
      .map((v) => item(`view:${v.id}`, v.name, { id: v.id, deletable: true, tag: tagOf(v), hint: v.section === "documentacao" ? "Documentação (vai para as folhas)" : "Trabalho" }));

  const floorItems = floors.map((f) =>
    item(floorKey(f.storey, f.sub), f.levelLabel ? `${f.storey} (${f.levelLabel})` : f.storey, {
      hint: "Abre a planta de piso de trabalho; Piso/Teto e Trabalho/Documentação na barra de vistas",
    }),
  );
  // Plantas extras (de projetos antigos ou criadas à parte) entram junto dos pavimentos.
  const extraPlans = custom("planta");

  const toggleDisc = (d: Discipline) => onDisciplines(disciplines.includes(d) ? disciplines.filter((x) => x !== d) : [...disciplines, d]);

  return (
    <div className="vistas-browser">
      <ul className="vb-tree">
        {group("3d", "Vistas 3D", [
          <li key="3d:geral" className={`vb-item ${active === "3d:geral" ? "on" : ""}`} title="Modelo completo em 3D">
            <button className="vb-open" onClick={() => onOpen3d(null)}>
              Geral
            </button>
          </li>,
          ...storeys.map((st) => (
            <li key={`3d:${st}`} className={`vb-item ${storey3d === st && active === `3d:pav:${st}` ? "on" : ""}`} title={`3D só do pavimento ${st}`}>
              <button className="vb-open" onClick={() => onOpen3d(st)}>
                {st}
              </button>
            </li>
          )),
          ...custom("3d"),
        ])}
        {group("pav", "Plantas", [...floorItems, ...extraPlans])}
        {KINDS.map(({ kind, label }) => group(`k:${kind}`, label, custom(kind), emptyHint(kind)))}
        {group(
          "folhas",
          "Folhas",
          sheets.map((s) => item(`sheet:${s.id}`, s.name, { deletable: true })),
          undefined,
          <li>
            <button className="link vb-new" onClick={onNewSheet}>
              + Nova folha
            </button>
          </li>,
        )}
      </ul>
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

/** Prefixo da planta de pavimento aberta (estado da barra de vistas) por seção e tipo. */
export const PLAN_PREFIX = { trabalho: { piso: "trab", teto: "trab-teto" }, documentacao: { piso: "doc", teto: "doc-teto" } } as const;
/** Planta de pavimento pela chave do estado ("trab", "trab-teto", "doc", "doc-teto"). */
export function parsePlanKey(key: string): { section: ViewSection; type: PlanType } | null {
  const p = key.includes(":") ? key.slice(0, key.indexOf(":")) : key;
  if (p === "trab") return { section: "trabalho", type: "piso" };
  if (p === "trab-teto") return { section: "trabalho", type: "teto" };
  if (p === "doc") return { section: "documentacao", type: "piso" };
  if (p === "doc-teto") return { section: "documentacao", type: "teto" };
  return null;
}
