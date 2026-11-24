// Vínculos IFC: modelos de outras disciplinas sobrepostos ao modelo principal.
import { DISCIPLINES, DISCIPLINE_BY_ID } from "../../../core/disciplines";
import { DEFAULT_ALIGN, type LinkAlign, type LinkData, type LinkMeta } from "../../../ifc/federate";
import { fmtCoord } from "../../../core/georef";
import type { LoadedModel } from "../../../ifc/loadIfc";

interface Props {
  hostName: string | null;
  host: LoadedModel;
  links: LinkMeta[];
  data: Map<string, LinkData>;
  status: Record<string, string>;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<LinkMeta>) => void;
  onRemove: (id: string) => void;
  onRelocate: (id: string) => void;
}

/** Disciplinas oferecidas para o vínculo (luminotécnica entra como elétrica). */
const OPTIONS: { value: LinkMeta["discipline"]; label: string }[] = [
  { value: "auto", label: "Automática (pela classe IFC)" },
  ...DISCIPLINES.filter((d) => d.id !== "mep").map((d) => ({ value: d.id, label: d.id === "eletrica" ? "Elétrica / luminotécnica" : d.label })),
];

export function VinculosPanel({ hostName, host, links, data, status, onAdd, onChange, onRemove, onRelocate }: Props) {
  return (
    <div className="panel-body vinculos">
      <div className="panel-head">
        <h2>Vínculos IFC</h2>
        <button className="btn primary" onClick={onAdd}>
          + Vincular IFC…
        </button>
      </div>
      <p className="muted small">
        Modelos de outras disciplinas (arquitetura, estrutura, luminotécnica…) sobrepostos ao principal, alinhados pelas coordenadas do projeto. Entram
        no 3D, na planta, nos cortes, nas interferências, nos ambientes e no encaixe dos pontos em paredes e lajes. O arquivo do projeto guarda o caminho
        de cada vínculo e os reabre junto.
      </p>

      <section className="card link-card host">
        <div className="link-head">
          <span className="link-badge">Principal</span>
          <b className="grow">{hostName}</b>
        </div>
        <div className="muted small">
          {host.schema} · {host.storeys.length} pavimento(s) · {host.spaces.length} ambiente(s). Pavimentos e cotas do projeto vêm deste modelo.
        </div>
      </section>

      {links.length === 0 && <p className="muted">Nenhum vínculo. Use “Vincular IFC…” (pode escolher vários arquivos de uma vez).</p>}

      {links.map((l) => {
        const d = data.get(l.id);
        const st = status[l.id];
        const counts = d
          ? Object.entries(
              d.elements.reduce<Record<string, number>>((acc, e) => {
                acc[e.discipline] = (acc[e.discipline] ?? 0) + 1;
                return acc;
              }, {}),
            ).sort((a, b) => b[1] - a[1])
          : [];
        return (
          <section key={l.id} className={`card link-card ${l.visible ? "" : "off"}`}>
            <div className="link-head">
              <label className="inline-check" title="Mostrar / ocultar o vínculo">
                <input type="checkbox" checked={l.visible} onChange={(e) => onChange(l.id, { visible: e.target.checked })} />
              </label>
              <b className="grow link-name" title={l.path ?? l.name}>
                {l.name}
              </b>
              <button className="link danger-link" onClick={() => window.confirm(`Remover o vínculo "${l.name}"?`) && onRemove(l.id)}>
                remover
              </button>
            </div>
            {st === "carregando" && <div className="muted small">Carregando…</div>}
            {st && st !== "carregando" && (
              <div className="warn-text small">
                {st === "não encontrado" ? "Arquivo não encontrado neste computador." : st}{" "}
                <button className="link" onClick={() => onRelocate(l.id)}>
                  localizar…
                </button>
              </div>
            )}
            {d && (
              <div className="muted small">
                {d.raw.schema} · {d.elements.length} elementos
                {d.spaces.length ? ` · ${d.spaces.length} ambiente(s)` : ""}
                {l.discipline === "auto" && counts.length > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    {counts.slice(0, 4).map(([k, n]) => (
                      <span key={k} className="link-disc">
                        <span className="swatch" style={{ background: DISCIPLINE_BY_ID[k as keyof typeof DISCIPLINE_BY_ID]?.color }} /> {DISCIPLINE_BY_ID[k as keyof typeof DISCIPLINE_BY_ID]?.label ?? k} {n}
                      </span>
                    ))}
                  </>
                )}
              </div>
            )}
            <div className="form-grid">
              <label>
                Disciplina
                <select value={l.discipline} onChange={(e) => onChange(l.id, { discipline: e.target.value as LinkMeta["discipline"] })}>
                  {OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label title="Como o vínculo é posicionado em relação ao modelo principal">
                Posicionamento
                <select value={(l.align ?? DEFAULT_ALIGN).mode} onChange={(e) => onChange(l.id, { align: { ...(l.align ?? DEFAULT_ALIGN), mode: e.target.value as LinkAlign["mode"] } })}>
                  <option value="projeto">Origem a origem (coordenadas do IFC)</option>
                  <option value="compartilhadas">Coordenadas compartilhadas (survey point)</option>
                  <option value="manual">Manual (deslocamento e rotação)</option>
                </select>
              </label>
              <label className="inline-check link-translucent">
                <input type="checkbox" checked={l.translucent} onChange={(e) => onChange(l.id, { translucent: e.target.checked })} /> Transparente no 3D
              </label>
            </div>
            {(l.align ?? DEFAULT_ALIGN).mode === "manual" && (
              <div className="form-grid four">
                {(["dx", "dy", "dz", "rotDeg"] as const).map((k) => (
                  <label key={k}>
                    {k === "rotDeg" ? "Rotação (°)" : `${k.slice(1).toUpperCase()} (m)`}
                    <input
                      type="number"
                      step={k === "rotDeg" ? 0.01 : 0.001}
                      value={(l.align ?? DEFAULT_ALIGN)[k]}
                      onChange={(e) => onChange(l.id, { align: { ...(l.align ?? DEFAULT_ALIGN), [k]: Number(e.target.value) || 0 } })}
                    />
                  </label>
                ))}
              </div>
            )}
            {d?.warning && <div className="warn-text small">{d.warning}</div>}
            {d && (l.align ?? DEFAULT_ALIGN).mode === "compartilhadas" && !d.warning && d.raw.georef.map && (
              <div className="muted small">
                Survey point do vínculo: E {fmtCoord(d.raw.georef.map.eastings)} · N {fmtCoord(d.raw.georef.map.northings)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
