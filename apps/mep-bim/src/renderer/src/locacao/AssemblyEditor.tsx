// Montagem de tomadas e interruptores: embutida (caixa 4×2/4×4) ou aparente
// (condulete simples/duplo) e os módulos do conjunto.
import { useState } from "react";
import { assemblyProblem, boxLabel, capacity, MODULE_KINDS, MODULES, normalizeAssembly, slotsUsed, type DeviceAssembly, type ModuleKind } from "../../../core/devices";

export function AssemblyEditor({ value, onChange, compact }: { value: DeviceAssembly; onChange: (a: DeviceAssembly) => void; compact?: boolean }) {
  const [adding, setAdding] = useState<ModuleKind>("tomada-10a");
  const used = slotsUsed(value.modules);
  const cap = capacity(value.box);
  const problem = assemblyProblem(value);
  const set = (patch: Partial<DeviceAssembly>) => onChange({ ...value, ...patch });
  const caixa = (box: "4x2" | "4x4") =>
    value.install === "embutida" ? (box === "4x2" ? "Caixa 4×2" : "Caixa 4×4") : box === "4x2" ? "Condulete simples" : "Condulete duplo";
  return (
    <div className={`assembly ${compact ? "compact" : ""}`}>
      <div className="assembly-row">
        <span className="assembly-label">Instalação</span>
        <div className="segmented">
          <button className={value.install === "embutida" ? "on" : ""} onClick={() => set({ install: "embutida" })}>
            Embutida
          </button>
          <button className={value.install === "aparente" ? "on" : ""} onClick={() => set({ install: "aparente" })}>
            Aparente
          </button>
        </div>
      </div>
      <div className="assembly-row">
        <span className="assembly-label">Caixa</span>
        <div className="segmented">
          {(["4x2", "4x4"] as const).map((b) => (
            <button key={b} className={value.box === b ? "on" : ""} onClick={() => set({ box: b })} title={`até ${capacity(b)} módulos`}>
              {caixa(b)} <span className="muted">({capacity(b)})</span>
            </button>
          ))}
        </div>
      </div>
      <div className="assembly-row modules">
        <span className="assembly-label">
          Módulos <span className={used > cap ? "warn-text" : "muted"}>{used}/{cap}</span>
        </span>
        <div className="module-chips">
          {value.modules.map((m, i) => (
            <span key={i} className={`module-chip ${MODULES[m].kind}`} title={MODULES[m].label}>
              {MODULES[m].kind === "interruptor" ? MODULES[m].code : MODULES[m].kind === "tomada" ? `T ${MODULES[m].code}` : "cego"}
              {MODULES[m].slots > 1 && <span className="muted"> ×{MODULES[m].slots}</span>}
              <button className="link" onClick={() => set({ modules: value.modules.filter((_, k) => k !== i) })} title="Remover módulo">
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="assembly-row">
        <span className="assembly-label" />
        <select value={adding} onChange={(e) => setAdding(e.target.value as ModuleKind)}>
          {MODULE_KINDS.map((m) => (
            <option key={m} value={m}>
              {MODULES[m].label}
              {MODULES[m].slots > 1 ? ` (${MODULES[m].slots} módulos)` : ""}
            </option>
          ))}
        </select>
        <button
          className="btn small-btn"
          disabled={used + MODULES[adding].slots > 6}
          onClick={() => onChange(normalizeAssembly({ ...value, modules: [...value.modules, adding] }))}
          title="Passa para 4×4 / condulete duplo automaticamente quando passar de 3 módulos"
        >
          + módulo
        </button>
      </div>
      {problem ? <div className="warn-text small">{problem}</div> : <div className="muted small">{boxLabel(value)}</div>}
    </div>
  );
}
