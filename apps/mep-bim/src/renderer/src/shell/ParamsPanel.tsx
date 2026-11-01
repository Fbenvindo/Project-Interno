// Paleta de propriedades no estilo do Revit: seletor de tipo, grupos de parâmetros
// (Restrições, disciplina, Dimensões, Identidade, Dados IFC) editáveis para os
// objetos criados no app e somente leitura para os elementos do IFC.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { applyInstall, boxIndexOf, DEFAULT_INSTALL, isConduitRun, isConduitType, runFloorProbeY, typeAllowed, type ConduitInstall, type InstallMode } from "../../../core/conduits";
import { DISCIPLINE_BY_ID, getTypeLabel } from "../../../core/disciplines";
import { formatNumber } from "../../../core/format";
import { COMPONENTS, COMPONENT_BY_ID, MOUNTING_LABEL } from "../../../core/library";
import { CEILING_REF_LABEL, DEFAULT_CEILING, elevationFor, type CeilingRef } from "../../../core/placement";
import { defaultParams, heightLabel, nextTag, storeyAt, type PlacedPoint } from "../../../core/points";
import { runIdOfElement, runLength, runSegments, RUN_TYPES, RUN_TYPE_BY_ID, type Run } from "../../../core/runs";
import type { Discipline, ElementInfo, PropertyGroup, PropertyValue } from "../../../core/types";
import type { LoadedModel } from "../../../ifc/loadIfc";
import { reseatCeiling, type CeilingResolver } from "../locacao/ceiling";
import { assemblyKey, assemblySize, defaultAssembly, supportsAssembly, type DeviceAssembly } from "../../../core/devices";
import { AssemblyEditor } from "../locacao/AssemblyEditor";
import { pointSize } from "../../../core/points";
import type { PointsStore } from "../locacao/usePointsStore";

interface Props {
  selection: number[];
  elementById: Map<number, ElementInfo>;
  store: PointsStore;
  model: LoadedModel;
  getProperties: (id: number) => PropertyGroup[];
  resolveCeiling: CeilingResolver;
  slabAt: (x: number, z: number, floorY: number) => number;
  systems: string[];
  onFrame: (ids: number[]) => void;
}

const DISCIPLINE_GROUP: Record<Discipline, string> = {
  eletrica: "Elétrica",
  telecom: "Telecom",
  hidraulica: "Hidráulica",
  incendio: "Proteção contra incêndio",
  gas: "Gás",
  hvac: "Mecânica",
  mep: "MEP",
  estrutura: "Estrutural",
  arquitetura: "Arquitetura",
  outros: "Outros",
};

type Kind = "ponto" | "trecho" | "caixa" | "ifc";
interface Item {
  id: number;
  kind: Kind;
  /** Chave de agrupamento do filtro (tipo). */
  key: string;
  label: string;
  point?: PlacedPoint;
  run?: Run;
  el?: ElementInfo;
}

const VARIES = "(vários)";
const fmt = (v: PropertyValue | undefined) =>
  typeof v === "number" ? formatNumber(v, Number.isInteger(v) ? 0 : 3) : v === true ? "Sim" : v === false ? "Não" : v == null || v === "" ? "—" : String(v);
const num = (s: string) => Number(s.replace(",", "."));

/** Valor comum de uma lista (ou null se variar). */
function common<T, V>(list: T[], f: (x: T) => V): { value: V | null; varies: boolean } {
  if (!list.length) return { value: null, varies: false };
  const first = f(list[0]);
  const varies = list.some((x) => f(x) !== first);
  return { value: varies ? null : first, varies };
}

// ---- Campos -------------------------------------------------------------------------------

function TextCell({ value, varies, onCommit, list }: { value: string; varies?: boolean; onCommit: (v: string) => void; list?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <input
      className="pcell"
      value={draft}
      list={list}
      placeholder={varies ? VARIES : ""}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

function NumberCell({ value, varies, onCommit, step = 1 }: { value: number | null; varies?: boolean; onCommit: (v: number) => void; step?: number }) {
  const text = value == null ? "" : String(Math.round(value * 1000) / 1000);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const commit = () => {
    if (draft === text || draft.trim() === "") return;
    const v = num(draft);
    if (Number.isFinite(v)) onCommit(v);
    else setDraft(text);
  };
  return (
    <input
      className="pcell num"
      inputMode="decimal"
      value={draft}
      step={step}
      placeholder={varies ? VARIES : ""}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(text);
      }}
    />
  );
}

function SelectCell({ value, options, onChange, varies }: { value: string; options: [string, string][]; onChange: (v: string) => void; varies?: boolean }) {
  return (
    <select className="pcell" value={varies ? "" : value} onChange={(e) => e.target.value && onChange(e.target.value)}>
      {varies && <option value="">{VARIES}</option>}
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <tr className="pgroup" onClick={() => setOpen(!open)}>
        <th colSpan={2}>
          <span className={`caret ${open ? "open" : ""}`}>▸</span> {title}
        </th>
      </tr>
      {open && children}
    </>
  );
}

const Row = ({ label, children, title }: { label: string; children: ReactNode; title?: string }) => (
  <tr className="prow">
    <th title={title ?? label}>{label}</th>
    <td>{children}</td>
  </tr>
);
const RO = ({ children }: { children: ReactNode }) => <span className="pro">{children}</span>;

// ---- Painel ---------------------------------------------------------------------------------

export function ParamsPanel({ selection, elementById, store, model, getProperties, resolveCeiling, slabAt, systems, onFrame }: Props) {
  const levels = model.storeyLevels;
  const items = useMemo<Item[]>(() => {
    const pointById = new Map(store.points.map((p) => [p.id, p]));
    const runById = new Map(store.runs.map((r) => [r.id, r]));
    const seenRuns = new Set<number>();
    const out: Item[] = [];
    for (const id of selection) {
      const p = pointById.get(id);
      if (p) {
        const def = COMPONENT_BY_ID[p.componentId];
        out.push({ id, kind: "ponto", key: `p:${def.id}`, label: def.label, point: p });
        continue;
      }
      const rid = runIdOfElement(id);
      if (rid != null) {
        const r = runById.get(rid);
        if (r && !seenRuns.has(r.id)) {
          seenRuns.add(r.id);
          out.push({ id, kind: "trecho", key: `r:${r.typeId}`, label: RUN_TYPE_BY_ID[r.typeId].label, run: r });
        }
        continue;
      }
      const el = elementById.get(id);
      if (!el) continue;
      if (boxIndexOf(id) != null) out.push({ id, kind: "caixa", key: "caixa", label: "Caixas de passagem", el });
      else out.push({ id, kind: "ifc", key: `i:${el.ifcType}`, label: getTypeLabel(el.ifcType), el });
    }
    return out;
  }, [selection, store.points, store.runs, elementById]);

  const categories = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const it of items) m.set(it.key, { label: it.label, n: (m.get(it.key)?.n ?? 0) + 1 });
    return [...m.entries()];
  }, [items]);
  const [filter, setFilter] = useState<string>("");
  useEffect(() => setFilter(""), [selection]);
  const shown = filter ? items.filter((i) => i.key === filter) : items;
  const kinds = new Set(shown.map((i) => i.kind));
  const only = kinds.size === 1 ? [...kinds][0] : null;

  if (!items.length) {
    return (
      <div className="params empty">
        <div className="ptype">
          <div className="ptype-name">Nenhum elemento selecionado</div>
          <div className="muted small">Clique num elemento da planta ou do 3D. Ctrl+clique soma à seleção.</div>
        </div>
      </div>
    );
  }

  const discColor = (d: Discipline) => DISCIPLINE_BY_ID[d].color;
  const headerColor = only === "ponto" ? discColor(COMPONENT_BY_ID[shown[0].point!.componentId].discipline) : only === "trecho" ? discColor(RUN_TYPE_BY_ID[shown[0].run!.typeId].discipline) : shown[0].el ? discColor(shown[0].el.discipline) : "#94a3b8";

  return (
    <div className="params">
      <div className="ptype">
        <span className="ptype-swatch" style={{ background: headerColor }} />
        <div className="ptype-body">
          {only === "ponto" ? (
            <PointTypeSelector points={shown.map((i) => i.point!)} store={store} />
          ) : only === "trecho" ? (
            <RunTypeSelector runs={shown.map((i) => i.run!)} store={store} />
          ) : (
            <div className="ptype-name">{shown.length === 1 ? (shown[0].el?.objectType ?? shown[0].label) : `${shown[0].label}${kinds.size > 1 ? " e outros" : ""}`}</div>
          )}
        </div>
      </div>
      <div className="pfilter">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">{categories.length > 1 ? `Vários (${items.length})` : `${categories[0][1].label} (${items.length})`}</option>
          {categories.length > 1 &&
            categories.map(([k, c]) => (
              <option key={k} value={k}>
                {c.label} ({c.n})
              </option>
            ))}
        </select>
        <button className="btn small-btn" onClick={() => onFrame(shown.map((i) => i.id))} title="Enquadrar a seleção">
          Enquadrar
        </button>
      </div>
      <table className="ptable">
        <tbody>
          {only === "ponto" && <PointRows points={shown.map((i) => i.point!)} store={store} levels={levels} resolveCeiling={resolveCeiling} />}
          {only === "trecho" && <RunRows runs={shown.map((i) => i.run!)} store={store} model={model} slabAt={slabAt} />}
          {(only === "ifc" || only === "caixa") && <ElementRows els={shown.map((i) => i.el!)} getProperties={getProperties} />}
          {!only && <MixedRows items={shown} />}
        </tbody>
      </table>
      <datalist id="params-systems">
        {systems.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {only && only !== "ifc" && only !== "caixa" && <div className="muted small pnote">Enter ou sair do campo aplica · Esc desfaz · Ctrl+Z volta.</div>}
    </div>
  );
}

// ---- Seletor de tipo -------------------------------------------------------------------------

function PointTypeSelector({ points, store }: { points: PlacedPoint[]; store: PointsStore }) {
  const defs = points.map((p) => COMPONENT_BY_ID[p.componentId]);
  const same = common(defs, (d) => d.id);
  const mounting = common(defs, (d) => d.mounting);
  const disc = common(defs, (d) => d.discipline);
  if (mounting.varies || disc.varies) return <div className="ptype-name">{points.length} pontos de tipos diferentes</div>;
  const options = COMPONENTS.filter((c) => c.mounting === mounting.value && c.discipline === disc.value);
  const change = (id: string) => {
    const nd = COMPONENT_BY_ID[id];
    const ids = new Set(points.map((p) => p.id));
    store.mutate((cur) => {
      const all = [...cur.points];
      const next = cur.points.map((p) => {
        if (!ids.has(p.id) || p.componentId === id) return p;
        const od = COMPONENT_BY_ID[p.componentId];
        // Mantém os valores de parâmetros que existem nos dois tipos.
        const params = { ...defaultParams(nd), ...Object.fromEntries(Object.entries(p.params).filter(([k]) => nd.params.some((x) => x.name === k) || !od.params.some((x) => x.name === k))) };
        let position = p.position;
        // Montagem (tomadas/interruptores): mantém caixa e instalação; troca os módulos se eram os de fábrica.
        let assembly: DeviceAssembly | undefined;
        if (supportsAssembly(nd)) {
          const nda = defaultAssembly(nd)!;
          const oda = defaultAssembly(od);
          assembly = p.assembly
            ? { ...p.assembly, modules: oda && p.assembly.modules.join() === oda.modules.join() ? nda.modules : p.assembly.modules }
            : nda;
        }
        const newSize = assembly ? assemblySize(assembly) : nd.size;
        if (nd.mounting === "parede") {
          const shift = (newSize[1] - pointSize(p, od)[1]) / 2000;
          position = [p.position[0] + Math.sin(p.rotation) * shift, p.position[1], p.position[2] + Math.cos(p.rotation) * shift];
        } else position = [p.position[0], elevationFor(nd, p.refLevel, p.height), p.position[2]];
        const tag = nd.tagPrefix === od.tagPrefix ? p.tag : nextTag(all, nd.tagPrefix);
        const updated: PlacedPoint = { ...p, componentId: id, params, position, tag, assembly };
        all.push(updated);
        return updated;
      });
      return { ...cur, points: next };
    });
  };
  return (
    <>
      <div className="ptype-family">{same.varies ? `${points.length} pontos` : defs[0].group}</div>
      <select className="ptype-select" value={same.value ?? ""} onChange={(e) => e.target.value && change(e.target.value)}>
        {same.varies && <option value="">{VARIES}</option>}
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </>
  );
}

function RunTypeSelector({ runs, store }: { runs: Run[]; store: PointsStore }) {
  const types = runs.map((r) => RUN_TYPE_BY_ID[r.typeId]);
  const same = common(types, (t) => t.id);
  const disc = common(types, (t) => t.discipline);
  const profile = common(types, (t) => t.profile);
  if (disc.varies || profile.varies) return <div className="ptype-name">{runs.length} trechos de tipos diferentes</div>;
  const modes = runs.map((r) => r.install?.mode).filter(Boolean) as InstallMode[];
  const options = RUN_TYPES.filter((t) => t.discipline === disc.value && t.profile === profile.value);
  const change = (id: string) => {
    const nt = RUN_TYPE_BY_ID[id];
    store.updateRuns(
      runs.map((r) => r.id),
      (r) => {
        const size = nt.sizes.find((s) => s.label === r.size.label) ?? nt.sizes.find((s) => s.width >= r.size.width - 1e-6) ?? nt.sizes[nt.sizes.length - 1];
        const ot = RUN_TYPE_BY_ID[r.typeId];
        return {
          typeId: id,
          size,
          slope: nt.slopeFor?.(size) ?? 0,
          tag: nt.tagPrefix === ot.tagPrefix ? r.tag : r.tag.replace(/^[^-]+/, nt.tagPrefix),
          ...(isConduitType(nt) && !r.install ? { install: DEFAULT_INSTALL } : {}),
        };
      },
    );
  };
  return (
    <>
      <div className="ptype-family">{same.varies ? `${runs.length} trechos` : types[0].group}</div>
      <select className="ptype-select" value={same.value ?? ""} onChange={(e) => e.target.value && change(e.target.value)}>
        {same.varies && <option value="">{VARIES}</option>}
        {options.map((t) => {
          const ok = modes.every((m) => typeAllowed(t, m));
          return (
            <option key={t.id} value={t.id} disabled={!ok}>
              {t.label}
              {ok ? "" : " (só embutido)"}
            </option>
          );
        })}
      </select>
    </>
  );
}

// ---- Pontos locados -----------------------------------------------------------------------------

function PointRows({
  points,
  store,
  levels,
  resolveCeiling,
}: {
  points: PlacedPoint[];
  store: PointsStore;
  levels: LoadedModel["storeyLevels"];
  resolveCeiling: CeilingResolver;
}) {
  const ids = points.map((p) => p.id);
  const defs = points.map((p) => COMPONENT_BY_ID[p.componentId]);
  const single = points.length === 1 ? points[0] : null;
  const def0 = defs[0];
  const sameDef = !common(defs, (d) => d.id).varies;
  const mounting = common(defs, (d) => d.mounting);
  const teto = mounting.value === "teto";
  const ref = common(points, (p) => (p.ceiling ?? DEFAULT_CEILING).ref);
  const level = common(points, (p) => (p.ceiling ?? DEFAULT_CEILING).level);
  const height = common(points, (p) => p.height);
  const rot = common(points, (p) => Math.round((p.rotation * 180) / Math.PI) % 360);
  const sys = common(points, (p) => p.system);
  const storey = common(points, (p) => p.storey ?? "—");
  const comment = common(points, (p) => String(p.params["Comentários"] ?? ""));

  const reseat = (mount: { ref: CeilingRef; level: number } | null, h?: number) =>
    store.update(ids, (p) => {
      const d = COMPONENT_BY_ID[p.componentId];
      if (d.mounting !== "teto") return {};
      const m = mount ?? p.ceiling ?? DEFAULT_CEILING;
      return reseatCeiling(p, d, m, resolveCeiling, levels, h ?? p.height);
    });
  const setHeight = (h: number) => {
    if (teto) return reseat(null, h);
    store.update(ids, (p) => ({ height: h, position: [p.position[0], elevationFor(COMPONENT_BY_ID[p.componentId], p.refLevel, h), p.position[2]] }), "height");
  };
  const setParam = (name: string, v: string | number) => store.update(ids, (p) => ({ params: { ...p.params, [name]: v } }), `param:${name}`);
  const asmKey = common(points, (p) => (p.assembly ? assemblyKey(p.assembly) : ""));
  const commonAssembly = !asmKey.varies && points[0].assembly ? points[0].assembly : null;
  /** Nova montagem: a peça avança/recua da parede conforme a profundidade (caixa embutida × condulete). */
  const setAssembly = (a: DeviceAssembly) =>
    store.update(ids, (p) => {
      const d = COMPONENT_BY_ID[p.componentId];
      const shift = (assemblySize(a)[1] - pointSize(p, d)[1]) / 2000;
      return {
        assembly: { ...a, modules: [...a.modules] },
        position: [p.position[0] + Math.sin(p.rotation) * shift, p.position[1], p.position[2] + Math.cos(p.rotation) * shift],
      };
    });

  // Parâmetros da disciplina: os que existem em todos os pontos selecionados.
  const paramNames = def0.params.map((x) => x.name).filter((n) => defs.every((d) => d.params.some((x) => x.name === n)));
  const unitOf = new Map(def0.params.map((x) => [x.name, x.unit]));
  const isNumber = new Map(def0.params.map((x) => [x.name, typeof x.default === "number"]));
  const circuitUid = common(points, (p) => p.circuit ?? "");
  const panelTag = new Map(store.points.map((p) => [p.guid, p.tag]));
  const discLabel = !common(defs, (d) => d.discipline).varies ? DISCIPLINE_GROUP[def0.discipline] : "Parâmetros";

  return (
    <>
      <Group title="Restrições">
        <Row label="Pavimento">
          <RO>{storey.varies ? VARIES : storey.value}</RO>
        </Row>
        <Row label="Fixação">
          <RO>{mounting.varies ? VARIES : MOUNTING_LABEL[mounting.value!]}</RO>
        </Row>
        {teto && (
          <Row label="Referência no teto">
            <SelectCell
              value={ref.value ?? ""}
              varies={ref.varies}
              options={(Object.keys(CEILING_REF_LABEL) as CeilingRef[]).map((r) => [r, CEILING_REF_LABEL[r]])}
              onChange={(r) => reseat({ ref: r as CeilingRef, level: r === "entreforro" ? 2800 : (level.value ?? 2600) })}
            />
          </Row>
        )}
        {teto && ref.value && ref.value !== "laje" && (
          <Row label={ref.value === "forro" ? "Altura do forro (m)" : "Altura do fundo (m)"} title="Acima do piso acabado">
            <NumberCell value={level.value == null ? null : level.value / 1000} varies={level.varies} step={0.05} onCommit={(v) => reseat({ ref: ref.value!, level: Math.round(v * 1000) })} />
          </Row>
        )}
        {!(teto && ref.value === "entreforro") && !mounting.varies && (
          <Row label={`${heightLabel(def0)} (mm)`}>
            <NumberCell value={height.value} varies={height.varies} onCommit={setHeight} step={10} />
          </Row>
        )}
        {mounting.value && mounting.value !== "parede" && (
          <Row label="Rotação (°)">
            <NumberCell
              value={rot.value}
              varies={rot.varies}
              onCommit={(deg) => store.update(ids, () => ({ rotation: (deg * Math.PI) / 180 }), "rotation")}
            />
          </Row>
        )}
        {single && (
          <Row label="Cota do centro (m)" title="Em relação ao piso do pavimento">
            <RO>{formatNumber(single.position[1] - (levels.find((s) => s.name === single.storey)?.level ?? 0), 3)}</RO>
          </Row>
        )}
      </Group>

      {paramNames.length > 0 && (
        <Group title={discLabel}>
          {paramNames.map((name) => {
            if (name === "Circuito" && store.circuits.length) {
              return (
                <Row key={name} label="Circuito">
                  <SelectCell
                    value={circuitUid.value || "-"}
                    varies={circuitUid.varies}
                    options={[["-", "(nenhum)"], ...store.circuits.map((c): [string, string] => [c.uid, `${panelTag.get(c.panel) ?? "QD"} · ${c.name}${c.description ? ` — ${c.description}` : ""}`])]}
                    onChange={(v) => store.assignPoints(ids, v === "-" ? null : v)}
                  />
                </Row>
              );
            }
            const c = common(points, (p) => p.params[name] ?? "");
            const unit = unitOf.get(name);
            return (
              <Row key={name} label={unit ? `${name} (${unit})` : name}>
                {isNumber.get(name) ? (
                  <NumberCell value={c.varies || c.value === "" ? null : Number(c.value)} varies={c.varies} onCommit={(v) => setParam(name, v)} />
                ) : (
                  <TextCell value={c.varies ? "" : String(c.value ?? "")} varies={c.varies} onCommit={(v) => setParam(name, v)} />
                )}
              </Row>
            );
          })}
        </Group>
      )}

      {defs.every((d) => supportsAssembly(d)) && (
        <Group title="Montagem">
          <tr>
            <td colSpan={2} className="pcell-wide">
              <AssemblyEditor
                compact
                value={commonAssembly ?? points[0].assembly ?? defaultAssembly(def0)!}
                onChange={setAssembly}
              />
              {!commonAssembly && points.length > 1 && <div className="muted small">Montagens diferentes: a alteração vale para todos os selecionados.</div>}
            </td>
          </tr>
        </Group>
      )}

      {sameDef && (
        <Group title="Dimensões">
          <Row label="Largura (mm)">
            <RO>{pointSize(points[0], def0)[0]}</RO>
          </Row>
          <Row label="Profundidade (mm)">
            <RO>{pointSize(points[0], def0)[1]}</RO>
          </Row>
          <Row label="Altura (mm)">
            <RO>{pointSize(points[0], def0)[2]}</RO>
          </Row>
        </Group>
      )}

      <Group title="Identidade">
        {single && (
          <Row label="Marca (etiqueta)">
            <TextCell value={single.tag} onCommit={(v) => v.trim() && store.update(ids, () => ({ tag: v.trim() }), "tag")} />
          </Row>
        )}
        <Row label="Sistema">
          <TextCell value={sys.varies ? "" : (sys.value ?? "")} varies={sys.varies} list="params-systems" onCommit={(v) => store.update(ids, () => ({ system: v.trim() }), "system")} />
        </Row>
        <Row label="Comentários">
          <TextCell value={comment.varies ? "" : (comment.value ?? "")} varies={comment.varies} onCommit={(v) => setParam("Comentários", v)} />
        </Row>
        {single?.params["Ambiente"] != null && (
          <Row label="Ambiente">
            <RO>{String(single.params["Ambiente"])}</RO>
          </Row>
        )}
      </Group>

      <Group title="Dados IFC" defaultOpen={false}>
        <Row label="Classe IFC">
          <RO>{sameDef ? `${def0.ifcType} · ${def0.predefinedType}` : VARIES}</RO>
        </Row>
        {single && (
          <Row label="GlobalId">
            <RO>{single.guid}</RO>
          </Row>
        )}
      </Group>
    </>
  );
}

// ---- Trechos ------------------------------------------------------------------------------------

function RunRows({
  runs,
  store,
  model,
  slabAt,
}: {
  runs: Run[];
  store: PointsStore;
  model: LoadedModel;
  slabAt: (x: number, z: number, floorY: number) => number;
}) {
  const ids = runs.map((r) => r.id);
  const single = runs.length === 1 ? runs[0] : null;
  const types = runs.map((r) => RUN_TYPE_BY_ID[r.typeId]);
  const t0 = types[0];
  const sameType = !common(types, (t) => t.id).varies;
  const conduits = runs.every(isConduitRun);
  const mode = common(runs, (r) => r.install?.mode ?? "laje");
  const apparentRef = common(runs, (r) => r.install?.apparentRef ?? "laje");
  const size = common(runs, (r) => r.size.label);
  const sys = common(runs, (r) => r.system);
  const slope = common(runs, (r) => r.slope);
  const circuit = common(runs, (r) => String(r.params.Circuito ?? ""));
  const comment = common(runs, (r) => String(r.params["Comentários"] ?? ""));
  const total = runs.reduce((s, r) => s + runLength(r), 0);
  const floorOf = (r: Run) => {
    const name = storeyAt(runFloorProbeY(r), model.storeyLevels);
    return model.storeyLevels.find((s) => s.name === name)?.level ?? 0;
  };
  const storey = common(runs, (r) => storeyAt(runFloorProbeY(r), model.storeyLevels) ?? "—");

  const reinstall = (patch: Partial<ConduitInstall>) => {
    const changes = new Map(
      runs.map((r) => {
        const inst = { ...(r.install ?? DEFAULT_INSTALL), ...patch };
        const floorY = floorOf(r);
        const mid = r.vertices[Math.floor(r.vertices.length / 2)];
        const ent = r.install?.apparentRef === "entreforro" ? mid[1] - floorY : 2.8;
        return [r.id, applyInstall(r, inst, { floorY, slabUnderside: slabAt(mid[0], mid[2], floorY), entreforroHeight: ent, points: store.points })];
      }),
    );
    store.updateRuns(ids, (r) => changes.get(r.id)!);
  };
  const setParam = (name: string, v: string) => store.updateRuns(ids, (r) => ({ params: { ...r.params, [name]: v } }), `param:${name}`);

  return (
    <>
      <Group title="Restrições">
        <Row label="Pavimento">
          <RO>{storey.varies ? VARIES : storey.value}</RO>
        </Row>
        {conduits && (
          <Row label="Instalação">
            <SelectCell
              value={mode.value ?? ""}
              varies={mode.varies}
              options={[
                ["piso", "Embutido no piso"],
                ["laje", "Embutido na laje"],
                ["aparente", "Aparente no teto"],
              ]}
              onChange={(m) => reinstall({ mode: m as InstallMode })}
            />
          </Row>
        )}
        {conduits && mode.value === "aparente" && (
          <Row label="Fixação">
            <SelectCell
              value={apparentRef.value ?? "laje"}
              varies={apparentRef.varies}
              options={[
                ["laje", "Sob a laje"],
                ["entreforro", "No entreforro"],
              ]}
              onChange={(v) => reinstall({ apparentRef: v as "laje" | "entreforro" })}
            />
          </Row>
        )}
        {!conduits && (
          <Row label="Declividade (%)">
            <NumberCell value={slope.value} varies={slope.varies} onCommit={(v) => store.updateRuns(ids, () => ({ slope: Math.max(0, v) }), "slope")} step={0.5} />
          </Row>
        )}
      </Group>

      <Group title="Dimensões">
        <Row label="Bitola">
          {sameType ? (
            <SelectCell
              value={size.value ?? ""}
              varies={size.varies}
              options={t0.sizes.map((s): [string, string] => [s.label, s.label])}
              onChange={(label) => {
                const s = t0.sizes.find((x) => x.label === label);
                if (s) store.updateRuns(ids, () => ({ size: s }));
              }}
            />
          ) : (
            <RO>{size.varies ? VARIES : size.value}</RO>
          )}
        </Row>
        <Row label="Comprimento (m)">
          <RO>{formatNumber(total, 2)}</RO>
        </Row>
        {single && (
          <Row label="Segmentos">
            <RO>{runSegments(single).length}</RO>
          </Row>
        )}
      </Group>

      {types.every((t) => t.circuit) && (
        <Group title="Elétrica">
          <Row label="Circuito">
            <TextCell value={circuit.varies ? "" : (circuit.value ?? "")} varies={circuit.varies} onCommit={(v) => setParam("Circuito", v.trim())} />
          </Row>
          {conduits && (
            <Row label="Eletroduto">
              <RO>{common(types, (t) => !!t.flexible).varies ? VARIES : t0.flexible ? "Flexível (curvatura livre)" : "Rígido (curvas 45°/90°)"}</RO>
            </Row>
          )}
        </Group>
      )}

      <Group title="Identidade">
        {single && (
          <Row label="Marca (etiqueta)">
            <TextCell value={single.tag} onCommit={(v) => v.trim() && store.updateRuns(ids, () => ({ tag: v.trim() }), "tag")} />
          </Row>
        )}
        <Row label="Sistema">
          <TextCell value={sys.varies ? "" : (sys.value ?? "")} varies={sys.varies} list="params-systems" onCommit={(v) => store.updateRuns(ids, () => ({ system: v.trim() }), "system")} />
        </Row>
        <Row label="Material">
          <RO>{sameType ? t0.material : VARIES}</RO>
        </Row>
        <Row label="Comentários">
          <TextCell value={comment.varies ? "" : (comment.value ?? "")} varies={comment.varies} onCommit={(v) => setParam("Comentários", v)} />
        </Row>
      </Group>

      <Group title="Dados IFC" defaultOpen={false}>
        <Row label="Classe IFC">
          <RO>{sameType ? `${t0.segmentType} · ${t0.segmentPredefined}` : VARIES}</RO>
        </Row>
        {single && (
          <Row label="GlobalId">
            <RO>{single.guid}</RO>
          </Row>
        )}
      </Group>
    </>
  );
}

// ---- Elementos do IFC e caixas (somente leitura) -------------------------------------------------

function ElementRows({ els, getProperties }: { els: ElementInfo[]; getProperties: (id: number) => PropertyGroup[] }) {
  const single = els.length === 1 ? els[0] : null;
  const c = <V,>(f: (e: ElementInfo) => V) => {
    const r = common(els, f);
    return r.varies ? VARIES : fmt(r.value as PropertyValue);
  };
  const groups = single ? getProperties(single.expressID) : [];
  return (
    <>
      <Group title="Identidade">
        <Row label="Nome">
          <RO>{single ? single.name : c((e) => e.name)}</RO>
        </Row>
        <Row label="Tipo">
          <RO>{c((e) => e.objectType)}</RO>
        </Row>
        <Row label="Classe IFC">
          <RO>{c((e) => e.ifcType)}</RO>
        </Row>
        <Row label="Tipo pré-definido">
          <RO>{c((e) => e.predefinedType)}</RO>
        </Row>
        <Row label="Disciplina">
          <RO>{c((e) => DISCIPLINE_BY_ID[e.discipline].label)}</RO>
        </Row>
        {single && (
          <Row label="GlobalId">
            <RO>{single.globalId}</RO>
          </Row>
        )}
      </Group>
      <Group title="Restrições">
        <Row label="Pavimento">
          <RO>{c((e) => e.storey)}</RO>
        </Row>
        <Row label="Sistemas">
          <RO>{c((e) => e.systems.join(", "))}</RO>
        </Row>
      </Group>
      <Group title="Dimensões">
        <Row label="Dimensão">
          <RO>{c((e) => e.size)}</RO>
        </Row>
        <Row label="Comprimento (m)">
          <RO>{single ? (single.length != null ? formatNumber(single.length, 2) : "—") : formatNumber(els.reduce((s, e) => s + (e.length ?? 0), 0), 2)}</RO>
        </Row>
      </Group>
      {groups.map((g, i) => (
        <Group key={`${g.name}-${i}`} title={g.kind === "quantidades" ? `${g.name} (quantidades)` : g.name} defaultOpen={i < 2}>
          {g.values.map((v, j) => (
            <Row key={j} label={v.name}>
              <RO>{fmt(v.value)}</RO>
            </Row>
          ))}
        </Group>
      ))}
      {!single && (
        <tr>
          <td colSpan={2} className="muted small pnote">
            Os conjuntos de propriedades (Psets) aparecem com um único elemento selecionado.
          </td>
        </tr>
      )}
    </>
  );
}

function MixedRows({ items }: { items: Item[] }) {
  return (
    <Group title="Seleção">
      {[...new Map(items.map((i) => [i.key, i])).values()].map((i) => (
        <Row key={i.key} label={i.label}>
          <RO>{items.filter((x) => x.key === i.key).length}</RO>
        </Row>
      ))}
      <tr>
        <td colSpan={2} className="muted small pnote">
          Escolha um tipo na lista acima para editar os parâmetros em conjunto.
        </td>
      </tr>
    </Group>
  );
}
