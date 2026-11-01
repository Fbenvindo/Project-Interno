// Programa de necessidades: padrão por tipo de equipamento e instalações por ambiente.
import { useMemo, useRef, useState } from "react";
import { formatNumber } from "../../../core/format";
import {
  countPoints,
  effectiveReqs,
  effectiveTech,
  expandRequests,
  totalsOf,
  type ProgramTotals,
  type TechData,
  reqId,
  roomEquipment,
  roomInventory,
  roomRequests,
  type EquipmentInstance,
  type EquipmentType,
  type RoomEquipment,
  type RoomProgram,
} from "../../../core/program";
import { spaceLabel, type Space } from "../../../core/spaces";
import type { ElementInfo } from "../../../core/types";
import type { LoadedModel } from "../../../ifc/loadIfc";
import type { CeilingResolver } from "../locacao/ceiling";
import type { PointsStore } from "../locacao/usePointsStore";
import { saveFile, openTextFile } from "../platform";
import type { Viewer } from "../viewer/Viewer";
import { catalogFromJson, catalogToJson, resetCatalog, saveCatalog, useCatalog } from "./catalogStore";
import { generateProgramPoints } from "./generate";
import { ReqTable, reqSummary, TechEditor, techSummary } from "./ReqTable";
import { COMPONENT_BY_ID } from "../../../core/library";

const defOf = (id: string) => COMPONENT_BY_ID[id];
function TotalsLine({ t }: { t: ProgramTotals }) {
  const parts: string[] = [];
  if (t.potencia) parts.push(`Σ potência ${formatNumber(t.potencia, 0)} W/VA`);
  if (t.pesosAF) parts.push(`Σ pesos AF ${formatNumber(t.pesosAF, 1)} (Q ≈ ${formatNumber(t.vazaoAF, 2)} L/s)`);
  if (t.pesosAQ) parts.push(`Σ pesos AQ ${formatNumber(t.pesosAQ, 1)}`);
  if (t.uhc) parts.push(`Σ ${formatNumber(t.uhc, 0)} UHC`);
  return parts.length ? <div className="totals small">{parts.join(" · ")}</div> : null;
}

interface Props {
  section: "tipos" | "ambientes";
  model: LoadedModel;
  store: PointsStore;
  viewer: Viewer;
  elementById: Map<number, ElementInfo>;
  resolveCeiling: CeilingResolver;
  onSelect: (ids: number[], frame?: boolean) => void;
  onSection: (s: "tipos" | "ambientes") => void;
}

const EMPTY_ROOM: RoomProgram = { equipment: {}, extras: [] };

export function ProgramaPanel(props: Props) {
  const { section, onSection } = props;
  return (
    <div className="panel-body programa">
      <div className="panel-head">
        <h2>Programa de necessidades</h2>
        <div className="segmented">
          <button className={section === "tipos" ? "on" : ""} onClick={() => onSection("tipos")}>
            Equipamentos (padrão)
          </button>
          <button className={section === "ambientes" ? "on" : ""} onClick={() => onSection("ambientes")}>
            Ambientes
          </button>
        </div>
      </div>
      {section === "tipos" ? <TiposSection /> : <AmbientesSection {...props} />}
    </div>
  );
}

/** Só o padrão por tipo (sem modelo aberto). */
export function ProgramaTiposOnly({ onSection }: { onSection: (s: "tipos" | "ambientes") => void }) {
  return (
    <div className="panel-body programa">
      <div className="panel-head">
        <h2>Programa de necessidades</h2>
        <div className="segmented">
          <button className="on">Equipamentos (padrão)</button>
          <button onClick={() => onSection("ambientes")} disabled title="Abra um modelo IFC com ambientes">
            Ambientes
          </button>
        </div>
      </div>
      <TiposSection />
    </div>
  );
}

// ---- Padrão por tipo de equipamento ------------------------------------------------------

function TiposSection() {
  const catalog = useCatalog();
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const update = (id: string, patch: Partial<EquipmentType>) => saveCatalog(catalog.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addType = () => {
    const id = `tipo-${Date.now().toString(36)}`;
    saveCatalog([...catalog, { id, label: "Novo equipamento", keywords: [], reqs: [] }]);
    setOpen(id);
  };

  return (
    <>
      <p className="muted small">
        O que cada tipo de equipamento pede de instalações. É o ponto de partida de todos os ambientes (e pode ser alterado em cada um). O
        equipamento é reconhecido no IFC pelas palavras-chave no nome ou no tipo do objeto. Este padrão fica salvo neste computador.
      </p>
      <div className="btn-row wrap tight">
        <button className="btn" onClick={addType}>
          + Novo tipo
        </button>
        <button
          className="btn"
          onClick={async () => {
            const saved = await saveFile({ defaultName: "padrao-equipamentos.json", content: catalogToJson(catalog), filters: [{ name: "Padrão de equipamentos", extensions: ["json"] }] });
            if (saved) setMessage(`Padrão exportado: ${saved}`);
          }}
        >
          Exportar padrão…
        </button>
        <button
          className="btn"
          onClick={async () => {
            const f = await openTextFile([{ name: "Padrão de equipamentos", extensions: ["json"] }]);
            if (!f) return;
            try {
              saveCatalog(catalogFromJson(f.content));
              setMessage(`Padrão importado de ${f.name}.`);
            } catch (e) {
              setMessage(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Importar padrão…
        </button>
        <button className="btn" onClick={() => window.confirm("Voltar ao padrão inicial do SmartEasyBIM? Suas alterações no padrão serão perdidas.") && resetCatalog()}>
          Restaurar padrão inicial
        </button>
      </div>
      {message && <div className="status small">{message}</div>}
      {catalog.map((t) => {
        const expanded = open === t.id;
        return (
          <section key={t.id} className="card eq-type">
            <button className="lib-family-head" onClick={() => setOpen(expanded ? null : t.id)}>
              <span className="grow">
                <b>{t.label}</b>
                <div className="muted small">{reqSummary(t.reqs)}</div>
                {t.tech && techSummary(t.tech) && <div className="muted small tech-line">{techSummary(t.tech)}</div>}
              </span>
              <span className={`caret ${expanded ? "open" : ""}`}>▸</span>
            </button>
            {expanded && (
              <>
                <div className="form-grid">
                  <label>
                    Nome
                    <input value={t.label} onChange={(e) => update(t.id, { label: e.target.value })} />
                  </label>
                  <label title="Separadas por vírgula; sem diferença de acentos e maiúsculas">
                    Palavras-chave no IFC
                    <input
                      defaultValue={t.keywords.join(", ")}
                      onBlur={(e) => update(t.id, { keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
                    />
                  </label>
                </div>
                <div className="field-label">Dados técnicos</div>
                <TechEditor tech={t.tech ?? {}} onChange={(tech) => update(t.id, { tech })} />
                <p className="muted small">
                  Potência e tensão vão para a primeira tomada do equipamento (a que o alimenta) e daí para o quadro de cargas; peso AF/AQ para o
                  ponto de água fria/quente; UHC e Ø para a saída de esgoto.
                </p>
                <div className="field-label">Pontos</div>
                <ReqTable reqs={t.reqs} onChange={(reqs) => update(t.id, { reqs })} />
                <div className="btn-row">
                  <button className="link danger-link" onClick={() => window.confirm(`Excluir o tipo "${t.label}" do padrão?`) && saveCatalog(catalog.filter((x) => x.id !== t.id))}>
                    excluir tipo
                  </button>
                </div>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

// ---- Ambientes ----------------------------------------------------------------------------

function AmbientesSection({ model, store, viewer, elementById, resolveCeiling, onSelect }: Props) {
  const catalog = useCatalog();
  const [storey, setStorey] = useState<string>("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; warnings: string[] } | null>(null);
  const cs = model.coordinates;
  const toPlan = (v: [number, number, number]) => {
    const p = cs.worldToIfc(v);
    return [p[0], p[1]] as [number, number];
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inventory = useMemo(() => roomInventory(model.elements, model.spaces, toPlan, catalog), [model, catalog]);
  const program = store.program;
  const storeys = [...new Set(model.spaces.map((s) => s.storey ?? ""))];
  const q = search.trim().toLowerCase();
  const rooms = model.spaces.filter((s) => (!storey || s.storey === storey) && (!q || spaceLabel(s).toLowerCase().includes(q)));
  const typeLabel = (id: string | null) => catalog.find((t) => t.id === id)?.label ?? "—";

  const setRoom = (roomId: string, fn: (r: RoomProgram) => RoomProgram, key: string | null = null) =>
    store.setProgram((p) => ({ rooms: { ...p.rooms, [roomId]: fn(p.rooms[roomId] ?? EMPTY_ROOM) } }), key && `${roomId}:${key}`);
  const setEquip = (roomId: string, key: string, base: RoomEquipment, patch: Partial<RoomEquipment>, editKey: string | null = null) =>
    setRoom(roomId, (r) => ({ ...r, equipment: { ...r.equipment, [key]: { ...(r.equipment[key] ?? base), ...patch } } }), editKey);

  const generate = (targets: Space[]) => {
    const res = generateProgramPoints({ model, viewer, elementById, resolveCeiling, catalog, program, inventory, points: store.points, rooms: targets });
    const existing = store.points.filter((p) => res.removeIds.includes(p.id)).length;
    if (existing && !window.confirm(`${existing} ponto(s) gerados antes pelo programa nestes ambientes serão substituídos (inclusive se você os moveu). Continuar?`)) return;
    const remove = new Set(res.removeIds);
    store.mutate((cur) => ({ ...cur, points: [...cur.points.filter((p) => !remove.has(p.id)), ...res.add] }));
    setMessage({ text: `${res.add.length} ponto(s) gerado(s) em ${targets.length} ambiente(s).`, warnings: res.warnings });
    onSelect(res.add.map((p) => p.id));
  };

  if (!model.spaces.length) {
    return <p className="muted">Este IFC não tem ambientes (IfcSpace). Exporte o modelo com os ambientes (no Revit: exportar “Ambientes” no IFC) para usar o programa.</p>;
  }

  const allReqs = rooms.flatMap((r) => roomRequests(r.globalId, program.rooms[r.globalId], inventory.get(r.globalId) ?? [], catalog));
  const total = countPoints(allReqs);
  const overall = totalsOf(expandRequests(allReqs, defOf), defOf);

  return (
    <>
      <p className="muted small">
        Equipamentos encontrados no IFC em cada ambiente, com as instalações do padrão. Personalize por equipamento ou acrescente instalações do
        ambiente; depois gere os pontos no modelo (junto ao equipamento, na parede mais próxima).
      </p>
      <div className="btn-row wrap tight">
        <select value={storey} onChange={(e) => setStorey(e.target.value)}>
          <option value="">Todos os pavimentos</option>
          {storeys.map((s) => (
            <option key={s} value={s}>
              {s || "(sem pavimento)"}
            </option>
          ))}
        </select>
        <input className="search inline" type="search" placeholder="Buscar ambiente…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn primary" onClick={() => generate(rooms)} disabled={!total}>
          Gerar pontos ({total})
        </button>
      </div>
      <TotalsLine t={overall} />
      {message && (
        <div className="status small">
          {message.text}
          {message.warnings.length > 0 && (
            <ul className="plain-list warn-text">
              {message.warnings.slice(0, 8).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {message.warnings.length > 8 && <li>… e mais {message.warnings.length - 8}</li>}
            </ul>
          )}
        </div>
      )}

      {rooms.map((s) => {
        const room = program.rooms[s.globalId];
        const items = inventory.get(s.globalId) ?? [];
        const reqs = roomRequests(s.globalId, room, items, catalog);
        const known = items.filter((i) => room?.equipment[i.key] || i.detected);
        const others = items.filter((i) => !room?.equipment[i.key] && !i.detected);
        const manual = Object.entries(room?.equipment ?? {}).filter(([, e]) => e.manual);
        const expanded = open === s.globalId;
        const generated = store.points.filter((p) => p.params.Origem === "Programa de necessidades" && p.params.Ambiente === spaceLabel(s)).length;
        return (
          <section key={s.globalId} className={`card room ${expanded ? "open" : ""}`}>
            <button className="lib-family-head" onClick={() => setOpen(expanded ? null : s.globalId)}>
              <span className="grow">
                <b>{spaceLabel(s)}</b>
                <span className="muted small">
                  {" "}
                  · {formatNumber(s.area, 2)} m² · {s.storey}
                </span>
                <div className="muted small">
                  {known.filter((i) => roomEquipment(room, i).include).length + manual.length} equipamento(s) · {countPoints(reqs)} ponto(s) previstos
                  {generated ? ` · ${generated} gerados` : ""}
                </div>
                <TotalsLine t={totalsOf(expandRequests(reqs, defOf), defOf)} />
              </span>
              <span className={`caret ${expanded ? "open" : ""}`}>▸</span>
            </button>
            {expanded && (
              <div className="room-body">
                <div className="field-label">Equipamentos do IFC</div>
                {known.length === 0 && <p className="muted small">Nenhum equipamento reconhecido neste ambiente.</p>}
                {known.map((inst) => (
                  <EquipmentRow
                    key={inst.key}
                    inst={inst}
                    eq={roomEquipment(room, inst)}
                    catalog={catalog}
                    onChange={(patch, key) => setEquip(s.globalId, inst.key, roomEquipment(room, inst), patch, key)}
                    onShow={() => onSelect([inst.expressID], true)}
                  />
                ))}
                {others.length > 0 && (
                  <details className="small">
                    <summary>Outros objetos no ambiente ({others.length})</summary>
                    {others.map((inst) => (
                      <div key={inst.key} className="eq-row other">
                        <span className="grow" title={inst.ifcType}>
                          {inst.name}
                        </span>
                        <select
                          value=""
                          onChange={(e) => e.target.value && setEquip(s.globalId, inst.key, roomEquipment(room, inst), { typeId: e.target.value, include: true })}
                        >
                          <option value="">classificar como…</option>
                          {catalog.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <button className="link" onClick={() => onSelect([inst.expressID], true)}>
                          ver
                        </button>
                      </div>
                    ))}
                  </details>
                )}

                <div className="field-label">Equipamentos incluídos (sem objeto no IFC)</div>
                {manual.map(([key, eq]) => (
                  <EquipmentRow
                    key={key}
                    eq={eq}
                    catalog={catalog}
                    label={eq.manual!.label}
                    onChange={(patch, k) => setEquip(s.globalId, key, eq, patch, k)}
                    onRemove={() =>
                      setRoom(s.globalId, (r) => {
                        const { [key]: _drop, ...rest } = r.equipment;
                        return { ...r, equipment: rest };
                      })
                    }
                  />
                ))}
                <AddManual
                  catalog={catalog}
                  onAdd={(typeId) =>
                    setEquip(s.globalId, `manual-${Date.now().toString(36)}`, { typeId, include: true }, { typeId, include: true, manual: { label: typeLabel(typeId) } })
                  }
                />

                <div className="field-label">Instalações do ambiente</div>
                <p className="muted small">Pontos que não dependem de equipamento (tomadas de uso geral, dados…): distribuídos pelas paredes do ambiente.</p>
                <ReqTable reqs={room?.extras ?? []} onChange={(extras) => setRoom(s.globalId, (r) => ({ ...r, extras }), "extras")} />

                <div className="btn-row wrap tight">
                  <button className="btn primary small-btn" onClick={() => generate([s])} disabled={!countPoints(reqs)}>
                    Gerar pontos deste ambiente ({countPoints(reqs)})
                  </button>
                  {room && (
                    <button className="link" onClick={() => window.confirm("Voltar este ambiente ao padrão?") && store.setProgram((p) => {
                      const { [s.globalId]: _drop, ...rest } = p.rooms;
                      return { rooms: rest };
                    })}>
                      voltar ao padrão
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function EquipmentRow({
  inst,
  eq,
  catalog,
  label,
  onChange,
  onShow,
  onRemove,
}: {
  inst?: EquipmentInstance;
  eq: RoomEquipment;
  catalog: EquipmentType[];
  label?: string;
  onChange: (patch: Partial<RoomEquipment>, key?: string | null) => void;
  onShow?: () => void;
  onRemove?: () => void;
}) {
  const reqs = effectiveReqs(eq, catalog);
  const custom = !!eq.reqs;
  const tech = effectiveTech(eq, catalog);
  const base = catalog.find((t) => t.id === eq.typeId)?.tech ?? {};
  const [editTech, setEditTech] = useState(false);
  return (
    <div className={`eq-row ${eq.include ? "" : "off"}`}>
      <div className="eq-head">
        <input type="checkbox" checked={eq.include} onChange={(e) => onChange({ include: e.target.checked })} title="Considerar este equipamento" />
        <span className="grow eq-name" title={inst?.ifcType}>
          {label ?? inst?.name}
        </span>
        <select value={eq.typeId ?? ""} onChange={(e) => onChange({ typeId: e.target.value || null, reqs: undefined, include: !!e.target.value })}>
          <option value="">— sem tipo —</option>
          {catalog.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {custom ? (
          <button className="link" onClick={() => onChange({ reqs: undefined })} title="Descartar a personalização e usar o padrão do tipo">
            usar padrão
          </button>
        ) : (
          <button className="link" onClick={() => onChange({ reqs: reqs.map((r) => ({ ...r, id: reqId() })) })} disabled={!eq.typeId} title="Copiar o padrão para este equipamento e editar">
            personalizar
          </button>
        )}
        <button className={`link ${eq.tech ? "strong" : ""}`} onClick={() => setEditTech(!editTech)} title="Potência, tensão, pesos e UHC deste equipamento">
          dados
        </button>
        {onShow && (
          <button className="link" onClick={onShow}>
            ver
          </button>
        )}
        {onRemove && (
          <button className="link" onClick={onRemove} title="Remover">
            ✕
          </button>
        )}
      </div>
      {eq.include && techSummary(tech) && (
        <div className="muted small eq-summary tech-line">
          {eq.tech ? <span className="tag-padrao custom">ajustado</span> : null}
          {techSummary(tech)}
        </div>
      )}
      {editTech && (
        <div className="eq-tech">
          <TechEditor tech={eq.tech ?? {}} base={base} onChange={(t: TechData) => onChange({ tech: Object.keys(t).length ? t : undefined }, "tech")} />
          <div className="muted small">Vazio = valor do padrão do tipo (em cinza).</div>
        </div>
      )}
      {eq.include &&
        (custom ? (
          <ReqTable reqs={eq.reqs!} onChange={(next) => onChange({ reqs: next }, "reqs")} />
        ) : (
          <div className="muted small eq-summary">
            <span className="tag-padrao">padrão</span> {reqSummary(reqs)}
          </div>
        ))}
    </div>
  );
}

function AddManual({ catalog, onAdd }: { catalog: EquipmentType[]; onAdd: (typeId: string) => void }) {
  const sel = useRef<HTMLSelectElement>(null);
  return (
    <div className="btn-row tight">
      <select ref={sel} defaultValue={catalog[0]?.id}>
        {catalog.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <button className="btn small-btn" onClick={() => sel.current?.value && onAdd(sel.current.value)}>
        + Incluir equipamento
      </button>
    </div>
  );
}
