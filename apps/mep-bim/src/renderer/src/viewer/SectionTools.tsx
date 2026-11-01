import { useMemo, useState } from "react";
import { formatNumber } from "../../../core/format";
import type { CoordinateSystem } from "../../../core/math";
import type { Vec3 } from "../../../core/types";
import type { SectionPlanes } from "./Viewer";

/** Estado dos cortes nas coordenadas do projeto (metros): Z = altura, X e Y em planta. */
export interface SectionState {
  horizontal: { on: boolean; z: number };
  x: { on: boolean; pos: number; invert: boolean };
  y: { on: boolean; pos: number; invert: boolean };
}

export const NO_SECTION: SectionState = {
  horizontal: { on: false, z: 0 },
  x: { on: false, pos: 0, invert: false },
  y: { on: false, pos: 0, invert: false },
};

/** Converte os cortes do projeto para planos na cena (X igual; Y do projeto = −Z da cena; Z = Y da cena). */
export function sectionToPlanes(s: SectionState, cs: CoordinateSystem): SectionPlanes {
  const o = cs.ifcToWorld([0, 0, 0]);
  const yAxis = cs.ifcToWorld([0, 1, 0]); // direção do Y do projeto na cena
  const sign = yAxis[2] - o[2] < 0 ? -1 : 1;
  return {
    horizontal: s.horizontal.on ? cs.ifcToWorld([0, 0, s.horizontal.z])[1] : null,
    x: s.x.on ? { pos: cs.ifcToWorld([s.x.pos, 0, 0])[0], invert: s.x.invert } : null,
    // "Manter Y ≤ pos" no projeto corresponde a manter z ≥ pos na cena quando o Y aponta para −Z.
    z: s.y.on ? { pos: cs.ifcToWorld([0, s.y.pos, 0])[2], invert: sign < 0 ? !s.y.invert : s.y.invert } : null,
  };
}

interface Props {
  section: SectionState;
  onChange: (s: SectionState) => void;
  /** Limites do modelo na cena. */
  bounds: { min: Vec3; max: Vec3 } | null;
  cs: CoordinateSystem;
  /** Cota do pavimento ativo (Z do projeto), para atalhos de corte. */
  storeyZ: number | null;
}

export function SectionTools({ section, onChange, bounds, cs, storeyZ }: Props) {
  const [open, setOpen] = useState(false);
  const active = section.horizontal.on || section.x.on || section.y.on;
  const range = useMemo(() => {
    if (!bounds) return null;
    const a = cs.worldToIfc(bounds.min);
    const b = cs.worldToIfc(bounds.max);
    const lo = (i: number) => Math.min(a[i], b[i]);
    const hi = (i: number) => Math.max(a[i], b[i]);
    return { x: [lo(0), hi(0)], y: [lo(1), hi(1)], z: [lo(2), hi(2)] };
  }, [bounds, cs]);
  if (!range) return null;

  const enable = (k: keyof SectionState) => {
    const next = { ...section };
    if (k === "horizontal") next.horizontal = { on: !section.horizontal.on, z: section.horizontal.on ? section.horizontal.z : (storeyZ ?? range.z[0]) + 1.2 };
    if (k === "x") next.x = { ...section.x, on: !section.x.on, pos: section.x.on ? section.x.pos : (range.x[0] + range.x[1]) / 2 };
    if (k === "y") next.y = { ...section.y, on: !section.y.on, pos: section.y.on ? section.y.pos : (range.y[0] + range.y[1]) / 2 };
    onChange(next);
  };
  const step = 0.05;
  const slider = (min: number, max: number, value: number, set: (v: number) => void) => (
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
  );

  return (
    <div className="section-tools" onPointerDown={(e) => e.stopPropagation()}>
      <button className={`btn ${active ? "primary" : ""}`} onClick={() => setOpen(!open)} title="Cortes da vista 3D">
        ✂ Corte{active ? " (ativo)" : ""}
      </button>
      {open && (
        <div className="section-panel">
          <label className="check-row">
            <input type="checkbox" checked={section.horizontal.on} onChange={() => enable("horizontal")} />
            <span className="grow">Horizontal (mostra abaixo)</span>
            <span className="count">{formatNumber(section.horizontal.z, 2)} m</span>
          </label>
          {section.horizontal.on &&
            slider(range.z[0], range.z[1], section.horizontal.z, (z) => onChange({ ...section, horizontal: { on: true, z } }))}
          {section.horizontal.on && storeyZ != null && (
            <div className="btn-row">
              {[0.5, 1.2, 2.5].map((h) => (
                <button key={h} className="link" onClick={() => onChange({ ...section, horizontal: { on: true, z: storeyZ + h } })}>
                  piso + {formatNumber(h, 1)} m
                </button>
              ))}
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={section.x.on} onChange={() => enable("x")} />
            <span className="grow">Vertical em X</span>
            <span className="count">{formatNumber(section.x.pos, 2)} m</span>
          </label>
          {section.x.on && (
            <>
              {slider(range.x[0], range.x[1], section.x.pos, (pos) => onChange({ ...section, x: { ...section.x, pos } }))}
              <label className="check-row small">
                <input type="checkbox" checked={section.x.invert} onChange={(e) => onChange({ ...section, x: { ...section.x, invert: e.target.checked } })} />
                Mostrar o outro lado
              </label>
            </>
          )}
          <label className="check-row">
            <input type="checkbox" checked={section.y.on} onChange={() => enable("y")} />
            <span className="grow">Vertical em Y</span>
            <span className="count">{formatNumber(section.y.pos, 2)} m</span>
          </label>
          {section.y.on && (
            <>
              {slider(range.y[0], range.y[1], section.y.pos, (pos) => onChange({ ...section, y: { ...section.y, pos } }))}
              <label className="check-row small">
                <input type="checkbox" checked={section.y.invert} onChange={(e) => onChange({ ...section, y: { ...section.y, invert: e.target.checked } })} />
                Mostrar o outro lado
              </label>
            </>
          )}
          {active && (
            <button className="btn block" onClick={() => onChange(NO_SECTION)}>
              Remover cortes
            </button>
          )}
          <div className="muted small">Coordenadas do projeto. Os cliques respeitam o corte.</div>
        </div>
      )}
    </div>
  );
}
