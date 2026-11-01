import { useEffect, useState } from "react";
import { detectClashes, type Clash } from "../../../core/clash";
import { DISCIPLINES, DISCIPLINE_BY_ID, MEP_DISCIPLINES } from "../../../core/disciplines";
import { formatNumber, toCsv } from "../../../core/format";
import type { TriangleMesh } from "../../../core/obb";
import type { Discipline, ElementInfo } from "../../../core/types";
import { saveFile } from "../platform";

interface Props {
  elements: ElementInfo[];
  elementById: Map<number, ElementInfo>;
  fileName: string | null;
  /** Malhas do IFC por expressID, para a verificação exata. */
  meshes: Map<number, TriangleMesh>;
  /** Pares conectados (trecho × equipamento, trecho × trecho) a ignorar. */
  ignorePair?: (a: number, b: number) => boolean;
  onFocus: (ids: number[]) => void;
  onClear: () => void;
}

function DisciplinePicker({ value, onChange }: { value: Discipline[]; onChange: (v: Discipline[]) => void }) {
  return (
    <div className="chips">
      {DISCIPLINES.map((d) => {
        const on = value.includes(d.id);
        return (
          <button
            key={d.id}
            className={`chip ${on ? "on" : ""}`}
            style={on ? { borderColor: d.color, background: d.color + "33" } : undefined}
            onClick={() => onChange(on ? value.filter((x) => x !== d.id) : [...value, d.id])}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export function ClashPanel({ elements, elementById, fileName, meshes, ignorePair, onFocus, onClear }: Props) {
  const [groupA, setGroupA] = useState<Discipline[]>(MEP_DISCIPLINES);
  const [groupB, setGroupB] = useState<Discipline[]>(DISCIPLINES.map((d) => d.id));
  const [clearanceMm, setClearanceMm] = useState(0);
  const [toleranceMm, setToleranceMm] = useState(1);
  const [ignoreSameSystem, setIgnoreSameSystem] = useState(true);
  const [clashes, setClashes] = useState<Clash[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Remove o destaque ao sair da aba.
  useEffect(() => onClear, [onClear]);

  const run = () => {
    const t0 = performance.now();
    const items = elements
      .filter((e) => e.bbox)
      .map((e) => ({ id: e.expressID, discipline: e.discipline, bbox: e.bbox!, systems: e.systems, obb: e.obb, mesh: meshes.get(e.expressID) }));
    setClashes(
      detectClashes(items, {
        groupA,
        groupB,
        clearance: clearanceMm / 1000,
        tolerance: toleranceMm / 1000,
        ignoreSameSystem,
        ignorePair,
      }),
    );
    setElapsed(performance.now() - t0);
    setActive(null);
    onClear();
  };

  const focus = (i: number) => {
    const c = clashes![i];
    setActive(i);
    onFocus([c.a, c.b]);
  };

  const label = (id: number) => elementById.get(id)?.name ?? `#${id}`;

  const exportCsv = async () => {
    if (!clashes) return;
    const csv = toCsv(
      ["Nº", "Tipo", "Elemento A", "Disciplina A", "GlobalId A", "Elemento B", "Disciplina B", "GlobalId B", "Penetração/distância (mm)", "Pavimento", "X (m)", "Y (m)", "Z (m)"],
      clashes.map((c, i) => {
        const a = elementById.get(c.a)!;
        const b = elementById.get(c.b)!;
        return [
          i + 1,
          c.kind === "fisica" ? "Física" : "Folga",
          a.name,
          DISCIPLINE_BY_ID[a.discipline].label,
          a.globalId,
          b.name,
          DISCIPLINE_BY_ID[b.discipline].label,
          b.globalId,
          c.distance < 0 ? `< ${clearanceMm}` : c.distance * 1000,
          a.storey ?? b.storey ?? "",
          ...c.point,
        ];
      }),
    );
    const base = (fileName ?? "modelo").replace(/\.ifc$/i, "");
    await saveFile({ defaultName: `${base}-interferencias.csv`, content: csv, filters: [{ name: "CSV (Excel)", extensions: ["csv"] }] });
  };

  const fisicas = clashes?.filter((c) => c.kind === "fisica").length ?? 0;

  return (
    <div className="panel-body">
      <div className="panel-head">
        <h2>Interferências</h2>
        {clashes && clashes.length > 0 && (
          <button className="btn" onClick={exportCsv}>
            Exportar CSV
          </button>
        )}
      </div>
      <p className="muted small">
        Elementos visíveis. Pontos e trechos criados no app são verificados contra a geometria real do IFC; entre dois elementos do IFC a
        verificação é por caixas envolventes (pode haver falsos positivos em peças inclinadas ou em anel).
      </p>

      <div className="field-label">Grupo A</div>
      <DisciplinePicker value={groupA} onChange={setGroupA} />
      <div className="field-label">contra Grupo B</div>
      <DisciplinePicker value={groupB} onChange={setGroupB} />

      <div className="form-grid">
        <label>
          Tolerância de penetração (mm)
          <input type="number" min={0} value={toleranceMm} onChange={(e) => setToleranceMm(Number(e.target.value))} />
        </label>
        <label>
          Folga mínima exigida (mm)
          <input type="number" min={0} value={clearanceMm} onChange={(e) => setClearanceMm(Number(e.target.value))} />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={ignoreSameSystem} onChange={(e) => setIgnoreSameSystem(e.target.checked)} />
        Ignorar elementos do mesmo sistema (conexões e terminais)
      </label>
      <button className="btn primary block" onClick={run} disabled={!groupA.length || !groupB.length}>
        Verificar interferências
      </button>

      {clashes && (
        <>
          <div className="status">
            {clashes.length === 0
              ? "Nenhuma interferência encontrada."
              : `${fisicas} física(s) e ${clashes.length - fisicas} de folga · ${formatNumber(elapsed, 0)} ms`}
          </div>
          <ol className="clash-list">
            {clashes.map((c, i) => {
              const a = elementById.get(c.a)!;
              const b = elementById.get(c.b)!;
              return (
                <li key={`${c.a}-${c.b}`} className={`clash ${active === i ? "active" : ""}`} onClick={() => focus(i)}>
                  <span className={`badge ${c.kind}`}>{c.kind === "fisica" ? "Física" : "Folga"}</span>
                  <div className="grow">
                    <div>
                      <span className="swatch" style={{ background: DISCIPLINE_BY_ID[a.discipline].color }} /> {label(c.a)}
                    </div>
                    <div>
                      <span className="swatch" style={{ background: DISCIPLINE_BY_ID[b.discipline].color }} /> {label(c.b)}
                    </div>
                    <div className="muted small">
                      {c.kind === "fisica"
                        ? `Penetração: ${formatNumber(c.distance * 1000, 0)} mm`
                        : c.distance < 0
                          ? `Distância livre abaixo de ${formatNumber(clearanceMm, 0)} mm`
                          : `Distância livre: ${formatNumber(c.distance * 1000, 0)} mm`}
                      {(a.storey || b.storey) && ` · ${a.storey ?? b.storey}`}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {active != null && (
            <button
              className="btn block"
              onClick={() => {
                setActive(null);
                onClear();
              }}
            >
              Limpar destaque
            </button>
          )}
        </>
      )}
    </div>
  );
}
