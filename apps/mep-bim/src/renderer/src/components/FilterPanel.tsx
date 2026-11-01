import { useMemo } from "react";
import { DISCIPLINES } from "../../../core/disciplines";
import type { Discipline, ElementInfo } from "../../../core/types";

export const NO_STOREY = "(sem pavimento)";

export interface Filters {
  hiddenDisciplines: Set<Discipline>;
  hiddenStoreys: Set<string>;
  /** Vazio = todos os sistemas. */
  systems: Set<string>;
  search: string;
}

interface Props {
  elements: ElementInfo[];
  storeys: string[];
  systems: string[];
  filters: Filters;
  onChange: (f: Filters) => void;
  visibleCount: number;
  onIsolate: (d: Discipline) => void;
}

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function FilterPanel({ elements, storeys, systems, filters, onChange, visibleCount, onIsolate }: Props) {
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

  const storeyList = [...storeys.filter((s) => counts.storeys.has(s)), ...(counts.storeys.has(NO_STOREY) ? [NO_STOREY] : [])];

  return (
    <div className="filters">
      <input
        className="search"
        type="search"
        placeholder="Buscar elemento, tipo ou dimensão…"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
      />
      <div className="muted small">
        {visibleCount} de {elements.length} elementos visíveis
      </div>

      <section>
        <div className="section-title">
          Disciplinas
          <button className="link" onClick={() => onChange({ ...filters, hiddenDisciplines: new Set() })}>
            todas
          </button>
        </div>
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
      </section>

      <section>
        <div className="section-title">
          Pavimentos
          <button className="link" onClick={() => onChange({ ...filters, hiddenStoreys: new Set() })}>
            todos
          </button>
        </div>
        {storeyList.map((s) => (
          <label key={s} className="check-row">
            <input
              type="checkbox"
              checked={!filters.hiddenStoreys.has(s)}
              onChange={() => onChange({ ...filters, hiddenStoreys: toggle(filters.hiddenStoreys, s) })}
            />
            <span className="grow">{s}</span>
            <span className="count">{counts.storeys.get(s)}</span>
          </label>
        ))}
      </section>

      {counts.systems.size > 0 && (
        <section>
          <div className="section-title">
            Sistemas
            {filters.systems.size > 0 && (
              <button className="link" onClick={() => onChange({ ...filters, systems: new Set() })}>
                limpar
              </button>
            )}
          </div>
          {systems.map((s) => (
            <label key={s} className="check-row">
              <input type="checkbox" checked={filters.systems.has(s)} onChange={() => onChange({ ...filters, systems: toggle(filters.systems, s) })} />
              <span className="grow">{s}</span>
              <span className="count">{counts.systems.get(s)}</span>
            </label>
          ))}
          <div className="muted small">Nenhum marcado = todos os sistemas.</div>
        </section>
      )}
    </div>
  );
}
