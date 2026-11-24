import { useEffect, useMemo, useState } from "react";
import {
  balancePhases,
  calcCircuit,
  CIRCUIT_TYPE_LABEL,
  imbalance,
  isCircuitable,
  isPanel,
  newCircuitId,
  nextCircuitName,
  PANEL_SYSTEMS,
  panelSystem,
  phaseLoads,
  suggestType,
  type Circuit,
  type CircuitCalc,
  type CircuitType,
} from "../../../core/circuits";
import { formatNumber, toCsv } from "../../../core/format";
import { newGuid, storeyAt } from "../../../core/points";
import { applySlope, autoRoute, newRunId, nextRunTag, RUN_TYPES, RUN_TYPE_BY_ID, type Run } from "../../../core/runs";
import type { LoadedModel } from "../../../ifc/loadIfc";
import type { PointsStore } from "../locacao/usePointsStore";
import { saveFile } from "../platform";

interface Props {
  model: LoadedModel;
  fileName: string | null;
  store: PointsStore;
  selection: number[];
  onSelect: (ids: number[], frame?: boolean) => void;
}

const CONDUIT_TYPES = RUN_TYPES.filter((t) => t.segmentType === "IFCCABLECARRIERSEGMENT" && t.profile === "circular");
const PHASE_OPTIONS: Record<1 | 2 | 3, string[]> = { 1: ["A", "B", "C"], 2: ["AB", "BC", "CA"], 3: ["ABC"] };
const fmtA = (v: number) => formatNumber(v, 1);
const num = (v: string) => Number(v.replace(",", "."));

export function CircuitosPanel({ model, fileName, store, selection, onSelect }: Props) {
  const panels = store.points.filter(isPanel);
  const [panelGuid, setPanelGuid] = useState<string | null>(panels[0]?.guid ?? null);
  const panel = panels.find((p) => p.guid === panelGuid) ?? panels[0] ?? null;
  const [activeId, setActiveId] = useState<number | null>(null);
  const [conduitType, setConduitType] = useState("eletroduto-pvc");
  const [conduitSize, setConduitSize] = useState("Ø25");
  const [elevation, setElevation] = useState(2.8);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!panelGuid && panels[0]) setPanelGuid(panels[0].guid);
  }, [panelGuid, panels]);

  const sys = panelSystem(panel?.params.Sistema);
  const circuits = useMemo(() => store.circuits.filter((c) => c.panel === panel?.guid), [store.circuits, panel?.guid]);
  const calcs: CircuitCalc[] = useMemo(
    () =>
      panel
        ? circuits.map((c) => calcCircuit(c, sys, panel.position, store.points.filter((p) => p.circuit === c.uid), store.runs))
        : [],
    [circuits, sys, panel, store.points, store.runs],
  );
  const active = circuits.find((c) => c.id === activeId) ?? null;
  const loads = phaseLoads(calcs);
  const total = calcs.reduce((s, c) => s + c.powerVA, 0);
  const selectedPoints = store.points.filter((p) => selection.includes(p.id) && isCircuitable(p));
  const unassigned = store.points.filter((p) => isCircuitable(p) && !p.circuit && (!panel || p.storey === panel.storey));

  if (!panel) {
    return (
      <div className="panel-body">
        <h2>Circuitos</h2>
        <p className="muted">
          Loque um <b>Quadro de distribuição</b> na aba Locação (grupo "Tomadas e comandos"). Os circuitos são criados por quadro.
        </p>
      </div>
    );
  }

  const createCircuit = (fromSelection: boolean) => {
    const pts = fromSelection ? selectedPoints : [];
    const c: Circuit = {
      id: newCircuitId(),
      uid: newGuid(),
      panel: panel.guid,
      name: nextCircuitName(store.circuits, panel.guid),
      description: "",
      type: suggestType(pts),
      poles: 1,
      phases: "A",
      powerFactor: 0.92,
      correction: 1,
      dropLimit: 4,
    };
    store.mutate((cur) => ({
      ...cur,
      circuits: [...cur.circuits, c],
      points: cur.points.map((p) => (pts.some((x) => x.id === p.id) ? { ...p, circuit: c.uid } : p)),
    }));
    setActiveId(c.id);
    setMessage(pts.length ? `${c.name} criado com ${pts.length} ponto(s).` : `${c.name} criado. Selecione pontos e use "Atribuir seleção".`);
  };

  const balance = () => {
    const map = balancePhases(calcs, sys.phases);
    store.mutate((cur) => ({ ...cur, circuits: cur.circuits.map((c) => (map.has(c.id) ? { ...c, phases: map.get(c.id)! } : c)) }));
    setMessage("Fases redistribuídas do circuito mais carregado para o menos carregado.");
  };

  /** Traçado em cadeia dos pontos do circuito até o quadro, na elevação informada. */
  const routeToPanel = (c: Circuit) => {
    const pts = store.points.filter((p) => p.circuit === c.uid);
    if (!pts.length) return;
    const t = RUN_TYPE_BY_ID[conduitType];
    const size = t.sizes.find((s) => s.label === conduitSize) ?? t.sizes.find((s) => s.label === t.defaultSize)!;
    const floorName = storeyAt(panel.position[1], model.storeyLevels);
    const floor = model.storeyLevels.find((s) => s.name === floorName)?.level ?? 0;
    const paths = autoRoute(
      pts.map((p) => p.position),
      panel.position,
      floor + elevation,
      "cadeia",
    );
    let all = [...store.runs];
    const created: Run[] = paths.map((path) => {
      const run: Run = {
        id: newRunId(),
        guid: newGuid(),
        typeId: t.id,
        tag: nextRunTag(all, t.tagPrefix),
        size,
        system: c.type === "iluminacao" ? "Iluminação" : "Tomadas",
        slope: 0,
        vertices: applySlope(path, 0),
        params: { Circuito: c.name },
        circuit: c.uid,
      };
      all = [...all, run];
      return run;
    });
    store.addRuns(created);
    setMessage(`${created.length} trecho(s) de ${t.label} ${size.label} gerado(s) para ${c.name}.`);
  };

  const exportCsv = async () => {
    const csv = toCsv(
      ["Circuito", "Descrição", "Tipo", "Fases", "Ligação", "Pontos", "Potência (VA)", "Tensão (V)", "Corrente (A)", "Comprimento (m)", "Seção (mm²)", "Critério", "Disjuntor (A)", "Queda (%)", "Observações"],
      calcs.map((k) => [
        k.circuit.name,
        k.circuit.description,
        CIRCUIT_TYPE_LABEL[k.circuit.type],
        k.circuit.poles,
        k.circuit.phases,
        k.points.length,
        Math.round(k.powerVA),
        k.voltage,
        k.current,
        k.length,
        k.section,
        k.criterion,
        k.breaker,
        k.drop,
        k.warnings.join(" "),
      ]),
    );
    const base = (fileName ?? "modelo").replace(/\.ifc$/i, "");
    const saved = await saveFile({ defaultName: `${base}-quadro-de-cargas-${panel.tag}.csv`, content: csv, filters: [{ name: "CSV (Excel)", extensions: ["csv"] }] });
    if (saved) setMessage(`Quadro de cargas exportado: ${saved}`);
  };

  return (
    <div className="panel-body locacao">
      <div className="panel-head">
        <h2>Circuitos</h2>
        <div className="btn-row">
          <button className="btn" onClick={store.undo} disabled={!store.canUndo} title="Desfazer (Ctrl+Z)">
            ↶
          </button>
          <button className="btn" onClick={store.redo} disabled={!store.canRedo} title="Refazer (Ctrl+Y)">
            ↷
          </button>
        </div>
      </div>

      <section className="card">
        <div className="form-grid">
          <label>
            Quadro
            <select value={panel.guid} onChange={(e) => (setPanelGuid(e.target.value), setActiveId(null))}>
              {panels.map((p) => (
                <option key={p.guid} value={p.guid}>
                  {p.tag} {p.storey ? `· ${p.storey}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sistema
            <select value={sys.id} onChange={(e) => store.update([panel.id], (p) => ({ params: { ...p.params, Sistema: e.target.value } }))}>
              {PANEL_SYSTEMS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Potência instalada
            <input readOnly value={`${formatNumber(total, 0)} VA`} />
          </label>
        </div>
        <div className="btn-row wrap">
          <button className="btn primary" onClick={() => createCircuit(true)} disabled={!selectedPoints.length}>
            Novo circuito com a seleção ({selectedPoints.length})
          </button>
          <button className="btn" onClick={() => createCircuit(false)}>
            Novo circuito vazio
          </button>
          <button className="btn" onClick={() => onSelect(unassigned.map((p) => p.id), true)} disabled={!unassigned.length}>
            Selecionar sem circuito ({unassigned.length})
          </button>
        </div>
      </section>

      {circuits.length > 0 && (
        <>
          <table className="grid-table loads">
            <thead>
              <tr>
                <th>Circ.</th>
                <th>Lig.</th>
                <th className="num">VA</th>
                <th className="num">Ib (A)</th>
                <th className="num">L (m)</th>
                <th className="num">mm²</th>
                <th className="num">Disj.</th>
                <th className="num">ΔV %</th>
              </tr>
            </thead>
            <tbody>
              {calcs.map((k) => (
                <tr
                  key={k.circuit.id}
                  className={`clickable ${k.circuit.id === activeId ? "active-row" : ""}`}
                  onClick={() => {
                    setActiveId(k.circuit.id);
                    onSelect(k.points.map((p) => p.id), true);
                  }}
                >
                  <td>
                    <b>{k.circuit.name}</b> {k.warnings.length > 0 && <span title={k.warnings.join("\n")}>⚠</span>}
                    <div className="muted small">
                      {CIRCUIT_TYPE_LABEL[k.circuit.type]} · {k.points.length} pt{k.circuit.description ? ` · ${k.circuit.description}` : ""}
                    </div>
                  </td>
                  <td>{k.circuit.phases}</td>
                  <td className="num">{formatNumber(k.powerVA, 0)}</td>
                  <td className="num">{fmtA(k.current)}</td>
                  <td className="num" title={k.lengthSource === "tracado" ? "pelo traçado" : "estimado"}>
                    {formatNumber(k.length, 1)}
                    {k.lengthSource !== "tracado" && k.points.length > 0 ? "*" : ""}
                  </td>
                  <td className="num" title={k.criterion ? `critério: ${k.criterion}` : ""}>
                    {k.section != null ? formatNumber(k.section, k.section % 1 ? 1 : 0) : "—"}
                  </td>
                  <td className="num">{k.breaker ?? "—"}</td>
                  <td className="num">{k.drop != null ? formatNumber(k.drop, 2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="phase-bar">
            {(["A", "B", "C"] as const).slice(0, sys.phases).map((f) => (
              <span key={f}>
                Fase {f}: <b>{formatNumber(loads[f], 0)} VA</b> ({fmtA(loads[f] / sys.vFN)} A)
              </span>
            ))}
            {sys.phases > 1 && <span>Desequilíbrio: {formatNumber(imbalance(loads, sys.phases) * 100, 0)}%</span>}
          </div>
          <div className="btn-row wrap">
            {sys.phases > 1 && (
              <button className="btn" onClick={balance}>
                Balancear fases
              </button>
            )}
            <button className="btn" onClick={exportCsv}>
              Exportar quadro de cargas (CSV)
            </button>
          </div>
        </>
      )}

      {active && (
        <CircuitEditor
          circuit={active}
          calc={calcs.find((k) => k.circuit.id === active.id)!}
          panelPhases={sys.phases}
          store={store}
          selectedCount={selectedPoints.length}
          onAssign={() => store.assignPoints(selectedPoints.map((p) => p.id), active.uid)}
          onUnassign={() => store.assignPoints(selectedPoints.filter((p) => p.circuit === active.uid).map((p) => p.id), null)}
          onDelete={() => {
            store.removeCircuits([active.id]);
            setActiveId(null);
          }}
          onRoute={() => routeToPanel(active)}
          route={{ conduitType, setConduitType, conduitSize, setConduitSize, elevation, setElevation }}
        />
      )}

      {message && <div className="status small">{message}</div>}
      <p className="muted small">
        Seção: maior entre a mínima (1,5 mm² iluminação, 2,5 mm² força), a capacidade de condução — NBR 5410 tabela 36, método B1, cobre/PVC
        70 °C, 30 °C, multiplicada pelo FCA (agrupamento e temperatura) — com In do disjuntor ≤ Iz, e a queda de tensão até o ponto mais
        distante. * Comprimento estimado (pontos sem eletroduto até o quadro). Confira com a norma e o padrão do escritório.
      </p>
    </div>
  );
}

interface EditorProps {
  circuit: Circuit;
  calc: CircuitCalc;
  panelPhases: 1 | 2 | 3;
  store: PointsStore;
  selectedCount: number;
  onAssign: () => void;
  onUnassign: () => void;
  onDelete: () => void;
  onRoute: () => void;
  route: {
    conduitType: string;
    setConduitType: (v: string) => void;
    conduitSize: string;
    setConduitSize: (v: string) => void;
    elevation: number;
    setElevation: (v: number) => void;
  };
}

function CircuitEditor({ circuit: c, calc, panelPhases, store, selectedCount, onAssign, onUnassign, onDelete, onRoute, route }: EditorProps) {
  const set = (patch: Partial<Circuit>, key?: string) => store.updateCircuits([c.id], () => patch, key ?? null);
  const t = RUN_TYPE_BY_ID[route.conduitType];
  return (
    <section className="card editor">
      <h3>
        {c.name} — {CIRCUIT_TYPE_LABEL[c.type]}
      </h3>
      <div className="muted small">
        {calc.points.length} ponto(s) · {formatNumber(calc.powerVA, 0)} VA · {calc.voltage} V · {fmtA(calc.current)} A
        {calc.section != null && ` · ${formatNumber(calc.section, calc.section % 1 ? 1 : 0)} mm² (${calc.criterion}) · Iz ${fmtA(calc.iz!)} A · disjuntor ${calc.breaker} A`}
      </div>
      {calc.warnings.map((w) => (
        <div key={w} className="status warn small">
          {w}
        </div>
      ))}
      <div className="form-grid">
        <label>
          Nome
          <input value={c.name} onChange={(e) => set({ name: e.target.value }, "name")} />
        </label>
        <label>
          Descrição
          <input value={c.description} placeholder="ex.: Tomadas sala de painéis" onChange={(e) => set({ description: e.target.value }, "desc")} />
        </label>
        <label>
          Tipo
          <select value={c.type} onChange={(e) => set({ type: e.target.value as CircuitType })}>
            {(Object.keys(CIRCUIT_TYPE_LABEL) as CircuitType[]).map((k) => (
              <option key={k} value={k}>
                {CIRCUIT_TYPE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fases do circuito
          <select
            value={c.poles}
            onChange={(e) => {
              const poles = Number(e.target.value) as 1 | 2 | 3;
              set({ poles, phases: PHASE_OPTIONS[poles][0] });
            }}
          >
            {([1, 2, 3] as const)
              .filter((n) => n <= panelPhases)
              .map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Monofásico (F+N)" : n === 2 ? "Bifásico (F+F)" : "Trifásico"}
                </option>
              ))}
          </select>
        </label>
        <label>
          Ligação
          <select value={c.phases} onChange={(e) => set({ phases: e.target.value })}>
            {PHASE_OPTIONS[c.poles]
              .filter((ph) => [...ph].every((f) => "ABC".indexOf(f) < panelPhases))
              .map((ph) => (
                <option key={ph} value={ph}>
                  {ph}
                </option>
              ))}
          </select>
        </label>
        <label>
          Fator de potência
          <input type="number" step={0.01} min={0.5} max={1} value={c.powerFactor} onChange={(e) => set({ powerFactor: num(e.target.value) }, "fp")} />
        </label>
        <label>
          FCA (agrup. × temp.)
          <input type="number" step={0.05} min={0.3} max={1} value={c.correction} onChange={(e) => set({ correction: num(e.target.value) }, "fca")} />
        </label>
        <label>
          Queda máx. (%)
          <input type="number" step={0.5} min={0.5} value={c.dropLimit} onChange={(e) => set({ dropLimit: num(e.target.value) }, "dv")} />
        </label>
      </div>
      <div className="btn-row wrap">
        <button className="btn primary" onClick={onAssign} disabled={!selectedCount}>
          Atribuir seleção ({selectedCount})
        </button>
        <button className="btn" onClick={onUnassign} disabled={!selectedCount}>
          Retirar seleção
        </button>
        <button className="btn danger" onClick={onDelete}>
          Excluir circuito
        </button>
      </div>
      <div className="field-label">Ligar ao quadro (traçado em cadeia)</div>
      <div className="form-grid">
        <label>
          Eletroduto
          <select value={route.conduitType} onChange={(e) => (route.setConduitType(e.target.value), route.setConduitSize(RUN_TYPE_BY_ID[e.target.value].defaultSize))}>
            {CONDUIT_TYPES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bitola
          <select value={route.conduitSize} onChange={(e) => route.setConduitSize(e.target.value)}>
            {t.sizes.map((s) => (
              <option key={s.label} value={s.label}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Elevação (m, acima do piso)
          <input type="number" step={0.05} value={route.elevation} onChange={(e) => route.setElevation(num(e.target.value))} />
        </label>
      </div>
      <button className="btn block" onClick={onRoute} disabled={!calc.points.length}>
        Gerar traçado de {c.name} até o quadro
      </button>
    </section>
  );
}
