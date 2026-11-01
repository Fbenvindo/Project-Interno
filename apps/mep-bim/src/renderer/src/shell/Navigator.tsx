// Navegador lateral: pavimentos, disciplinas, sistemas e quadros/circuitos.
import { useMemo, useState } from "react";
import type { Circuit } from "../../../core/circuits";
import { DISCIPLINES } from "../../../core/disciplines";
import type { PlacedPoint } from "../../../core/points";
import type { Discipline, ElementInfo } from "../../../core/types";

export const NO_STOREY = "(sem pavimento)";

export interface Filters {
  hiddenDisciplines: Set<Discipline>;
  hiddenStoreys: Set<string>;
  /** Vazio = todos os sistemas. */
  systems: Set<string>;
  search: string;
}

export const EMPTY_FILTERS: Filters = { hiddenDisciplines: new Set(), hiddenStoreys: new Set(), systems: new Set(), search: "" };

interface Props {
  elements: ElementInfo[];
  storeys: string[];
  systems: string[];
  filters: Filters;
  onChange: (f: Filters) => void;
  visibleCount: number;
  onIsolate: (d: Discipline) => void;
  /** Pavimento ativo (planta e prancha) e vista 3D isolada (null = modelo completo). */
  storey: string;
  storeyView: string | null;
  onStorey: (storey: string | null) => void;
  points: PlacedPoint[];
  circuits: Circuit[];
  onCircuit: (circuit: Circuit) => void;
}

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function Section({ title, children, extra, defaultOpen = true }: { title: string; children: React.ReactNode; extra?: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="nav-section">
      <div className="nav-title">
        <button className="nav-caret" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`caret ${open ? "open" : ""}`}>▸</span>
          {title}
        </button>
        {extra}
      </div>
      {open && children}
    </section>
  );
}

export function Navigator(props: Props) {
  const { elements, storeys, systems, filters, onChange, visibleCount, onIsolate, storey, storeyView, onStorey, points, circuits, onCircuit } = props;
  const counts = useMemo(() => {
    const disciplines = new Map<Discipline, number>();
    const storeys = new Map<string, number>();
    const systems = new Map<string, number>();
    for (const e of elements) {
      disciplines.set(e.discipline, (disciplines.get(e.discipline) ?? 0) + 1);
      const s = e.storey ?? NO_STOREY;
      storeys.set(s, (storeys.get(s) ?? 0) + 1);
      for (const sys of e.systems) systems.set(sys, (systems.get(sys) ?? 0) + 1);
    }
    return { disciplines, storeys, systems };
  }, [elements]);

  const panels = useMemo(() => {
    const byGuid = new Map(points.map((p) => [p.guid, p]));
    const perCircuit = new Map<string, number>();
    for (const p of points) if (p.circuit) perCircuit.set(p.circuit, (perCircuit.get(p.circuit) ?? 0) + 1);
    const groups = new Map<string, { name: string; circuits: { c: Circuit; n: number }[] }>();
    for (const c of circuits) {
      const panel = byGuid.get(c.panel);
      const g = groups.get(c.panel) ?? { name: panel?.tag || "Quadro", circuits: [] };
      g.circuits.push({ c, n: perCircuit.get(c.uid) ?? 0 });
      groups.set(c.panel, g);
    }
    return [...groups.values()];
  }, [points, circuits]);

  const storeyList = storeys.filter((s) => counts.storeys.has(s));

  return (
    <div className="navigator">
      <input
        className="search"
        type="search"
        placeholder="Buscar elemento, tipo ou dimensão…"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
      />
      <div className="muted small nav-count">
        {visibleCount} de {elements.length} elementos visíveis
      </div>

      <Section title="Pavimentos">
        <button className={`nav-item ${storeyView == null ? "on" : ""}`} onClick={() => onStorey(null)} title="Modelo completo em 3D">
          <span className="grow">Modelo completo</span>
          <span className="count">{elements.length}</span>
        </button>
        {storeyList.map((s) => (
          <button
            key={s}
            className={`nav-item ${storeyView === s || (storeyView == null && storey === s) ? (storeyView === s ? "on" : "current") : ""}`}
            onClick={() => onStorey(s)}
            title={`Planta e 3D do pavimento ${s}`}
          >
            <span className="grow">{s}</span>
            <span className="count">{counts.storeys.get(s)}</span>
          </button>
        ))}
      </Section>

      <Section
        title="Disciplinas"
        extra={
          <button className="link" onClick={() => onChange({ ...filters, hiddenDisciplines: new Set() })}>
            todas
          </button>
        }
      >
        {DISCIPLINES.filter((d) => counts.disciplines.has(d.id)).map((d) => (
          <label key={d.id} className="check-row">
            <input
              type="checkbox"
              checked={!filters.hiddenDisciplines.has(d.id)}
              onChange={() => onChange({ ...filters, hiddenDisciplines: toggle(filters.hiddenDisciplines, d.id) })}
            />
            <span className="swatch" style={{ background: d.color }} />
            <span className="grow">{d.label}</span>
            <button className="link only" onClick={(e) => (e.preventDefault(), onIsolate(d.id))} title="Mostrar somente esta disciplina">
              só
            </button>
            <span className="count">{counts.disciplines.get(d.id)}</span>
          </label>
        ))}
      </Section>

      {counts.systems.size > 0 && (
        <Section
          title="Sistemas"
          defaultOpen={false}
          extra={
            filters.systems.size > 0 && (
              <button className="link" onClick={() => onChange({ ...filters, systems: new Set() })}>
                limpar
              </button>
            )
          }
        >
          {systems.map((s) => (
            <label key={s} className="check-row">
              <input type="checkbox" checked={filters.systems.has(s)} onChange={() => onChange({ ...filters, systems: toggle(filters.systems, s) })} />
              <span className="grow">{s}</span>
              <span className="count">{counts.systems.get(s)}</span>
            </label>
          ))}
          <div className="muted small">Nenhum marcado = todos os sistemas.</div>
        </Section>
      )}

      <Section title="Quadros e circuitos">
        {panels.length === 0 && <div className="muted small">Nenhum circuito. Loque um quadro e crie circuitos em Elétrica › Circuitos.</div>}
        {panels.map((g) => (
          <div key={g.name} className="nav-panel">
            <div className="nav-panel-name">{g.name}</div>
            {g.circuits.map(({ c, n }) => (
              <button key={c.uid} className="nav-item sub" onClick={() => onCircuit(c)} title={c.description || c.name}>
                <span className="grow">
                  {c.name}
                  {c.description ? ` · ${c.description}` : ""}
                </span>
                <span className="count">{n}</span>
              </button>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}
