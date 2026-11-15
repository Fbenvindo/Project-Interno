// Editor de visibilidade (como "Visibilidade/Gráficos" do Revit): modelos IFC, tipos de
// elemento, sistemas e elementos ocultos. Marcado = visível. Usado em cada vista (só nela) e no
// projeto inteiro (todas as vistas, folhas e o 3D).
import { useMemo, useState } from "react";
import { getTypeLabel } from "../../../core/disciplines";
import type { ElementInfo } from "../../../core/types";
import { elementKey, toggleRule, type HideRules } from "../../../core/visibility";

export interface VisibilityCatalog {
  models: { key: string; label: string; count: number }[];
  elements: ElementInfo[];
}

interface Props {
  title: string;
  hint: string;
  rules: HideRules | undefined;
  onChange: (r: HideRules) => void;
  catalog: VisibilityCatalog;
}

export function VisibilityEditor({ title, hint, rules, onChange, catalog }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ models: true });
  const [q, setQ] = useState("");
  const r = rules ?? {};
  const { types, systems, byKey } = useMemo(() => {
    const types = new Map<string, number>();
    const systems = new Map<string, number>();
    const byKey = new Map<string, ElementInfo>();
    for (const e of catalog.elements) {
      types.set(e.ifcType, (types.get(e.ifcType) ?? 0) + 1);
      for (const s of e.systems) systems.set(s, (systems.get(s) ?? 0) + 1);
      byKey.set(elementKey(e.expressID), e);
    }
    return {
      types: [...types.entries()].map(([k, n]) => ({ key: k, label: getTypeLabel(k), count: n })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      systems: [...systems.entries()].map(([k, n]) => ({ key: k, label: k, count: n })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      byKey,
    };
  }, [catalog.elements]);
  const ql = q.trim().toLowerCase();
  const hiddenCount = (r.models?.length ?? 0) + (r.types?.length ?? 0) + (r.systems?.length ?? 0) + (r.elements?.length ?? 0);

  const section = (k: "models" | "types" | "systems", label: string, items: { key: string; label: string; count: number }[]) => {
    const list = ql ? items.filter((i) => i.label.toLowerCase().includes(ql)) : items;
    const hidden = new Set(r[k] ?? []);
    return (
      <div className="vis-section" key={k}>
        <button className="vb-head sub" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>
          <span className={`caret ${open[k] ? "open" : ""}`}>▸</span> {label} <span className="muted">({items.length - items.filter((i) => hidden.has(i.key)).length}/{items.length} visíveis)</span>
        </button>
        {open[k] && (
          <ul className="vis-list">
            {list.map((i) => (
              <li key={i.key}>
                <label>
                  <input type="checkbox" checked={!hidden.has(i.key)} onChange={(e) => onChange(toggleRule(r, k, i.key, !e.target.checked))} />
                  <span className="grow">{i.label}</span>
                  <span className="muted small">{i.count}</span>
                </label>
              </li>
            ))}
            {!list.length && <li className="muted small">Nada encontrado.</li>}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="vis-editor">
      <div className="panel-head">
        <h3>
          {title} {hiddenCount > 0 && <span className="badge">{hiddenCount} oculto(s)</span>}
        </h3>
        {hiddenCount > 0 && (
          <button className="link" onClick={() => onChange({})} title="Mostrar tudo de novo">
            mostrar tudo
          </button>
        )}
      </div>
      <p className="muted small">{hint}</p>
      <input className="vis-search" placeholder="Buscar tipo, sistema ou modelo…" value={q} onChange={(e) => setQ(e.target.value)} />
      {section("models", "Modelos IFC", catalog.models)}
      {section("types", "Tipos de elemento", types)}
      {systems.length > 0 && section("systems", "Sistemas", systems)}
      {(r.elements?.length ?? 0) > 0 && (
        <div className="vis-section">
          <div className="vb-head sub">Elementos ocultos ({r.elements!.length})</div>
          <ul className="vis-list">
            {r.elements!.slice(0, 50).map((k) => {
              const e = byKey.get(k);
              return (
                <li key={k}>
                  <span className="grow">{e ? `${e.name} · ${getTypeLabel(e.ifcType)}` : `elemento ${k}`}</span>
                  <button className="link" onClick={() => onChange(toggleRule(r, "elements", k, false))}>
                    mostrar
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Ocultar a seleção: o elemento, o tipo ou o sistema, nesta vista ou em todas. */
export function HideSelectionBar({ count, hasView, onHide }: { count: number; hasView: boolean; onHide: (what: "elements" | "types" | "systems", where: "view" | "all") => void }) {
  const [where, setWhere] = useState<"view" | "all">(hasView ? "view" : "all");
  const w = hasView ? where : "all";
  return (
    <div className="hide-bar">
      <span className="small">Ocultar {count > 1 ? `os ${count} selecionados` : "o selecionado"}:</span>
      <div className="btn-row wrap tight">
        <button className="btn small" onClick={() => onHide("elements", w)} title="Só estes elementos">
          Elemento
        </button>
        <button className="btn small" onClick={() => onHide("types", w)} title="Todos os elementos do mesmo tipo">
          Tipo
        </button>
        <button className="btn small" onClick={() => onHide("systems", w)} title="Todos os elementos do mesmo sistema">
          Sistema
        </button>
        <select value={w} onChange={(e) => setWhere(e.target.value as "view" | "all")} disabled={!hasView} title="Onde ocultar">
          <option value="view">nesta vista</option>
          <option value="all">em todas as vistas</option>
        </select>
      </div>
    </div>
  );
}
