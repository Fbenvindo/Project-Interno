// Tabela de instalações (pontos) de um equipamento ou ambiente.
import { COMPONENTS, COMPONENT_BY_ID, COMPONENT_GROUPS } from "../../../core/library";
import { reqId, TECH_FIELDS, type Requirement, type TechData } from "../../../core/program";

const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));

/** Parâmetro principal mostrado na tabela (potência para elétrica, diâmetro para hidráulica). */
function mainParam(componentId: string): { name: string; unit?: string } | null {
  const def = COMPONENT_BY_ID[componentId];
  const p = def?.params.find((x) => x.name === "Potência") ?? def?.params.find((x) => x.name === "Diâmetro") ?? def?.params.find((x) => x.name === "Vazão");
  return p ? { name: p.name, unit: p.unit } : null;
}

export function reqSummary(reqs: Requirement[]): string {
  if (!reqs.length) return "nenhuma instalação";
  return reqs
    .map((r) => {
      const def = COMPONENT_BY_ID[r.componentId];
      const mp = mainParam(r.componentId);
      const v = mp && r.params?.[mp.name] != null ? ` ${r.params[mp.name]}${mp.unit ? " " + mp.unit : ""}` : "";
      const h = def?.mounting === "parede" ? ` h ${r.height ?? def.defaultHeight}` : "";
      return `${r.qty > 1 ? r.qty + "× " : ""}${def?.label ?? r.componentId}${v}${h}`;
    })
    .join(" · ");
}

export function ReqTable({ reqs, onChange }: { reqs: Requirement[]; onChange: (reqs: Requirement[]) => void }) {
  const set = (i: number, patch: Partial<Requirement>) => onChange(reqs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const setParam = (i: number, name: string, v: number | undefined) => {
    const params = { ...(reqs[i].params ?? {}) };
    if (v == null || !Number.isFinite(v)) delete params[name];
    else params[name] = v;
    set(i, { params });
  };
  return (
    <div className="req-table">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Ponto</th>
            <th className="num" title="Quantidade">Qtd</th>
            <th className="num" title="Altura do eixo acima do piso (parede)">Altura mm</th>
            <th className="num" title="Parede: deslocamento lateral a partir do equipamento. Piso: afastamento da parede.">Desl. m</th>
            <th className="num">Valor</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {reqs.map((r, i) => {
            const def = COMPONENT_BY_ID[r.componentId];
            const mp = mainParam(r.componentId);
            const wall = def?.mounting === "parede";
            return (
              <tr key={r.id}>
                <td>
                  <select value={r.componentId} onChange={(e) => set(i, { componentId: e.target.value, params: undefined, height: undefined })}>
                    {!def && <option value={r.componentId}>{r.componentId} (não encontrado)</option>}
                    {COMPONENT_GROUPS.map((g) => (
                      <optgroup key={g} label={g}>
                        {COMPONENTS.filter((c) => c.group === g).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <input type="number" min={0} value={r.qty} onChange={(e) => set(i, { qty: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                </td>
                <td className="num">
                  {wall ? (
                    <input type="number" step={50} placeholder={String(def?.defaultHeight ?? "")} value={r.height ?? ""} onChange={(e) => set(i, { height: num(e.target.value) })} />
                  ) : (
                    <span className="muted small">{def?.mounting === "teto" ? "teto" : "piso"}</span>
                  )}
                </td>
                <td className="num">
                  {wall ? (
                    <input type="number" step={0.05} placeholder="0" value={r.lateral ?? ""} onChange={(e) => set(i, { lateral: num(e.target.value) })} title="Deslocamento lateral (m)" />
                  ) : (
                    <input type="number" step={0.05} placeholder="centro" value={r.recuo ?? ""} onChange={(e) => set(i, { recuo: num(e.target.value) })} title="Afastamento da parede (m)" />
                  )}
                </td>
                <td className="num">
                  {mp ? (
                    <span className="with-unit">
                      <input
                        type="number"
                        placeholder={String(def?.params.find((x) => x.name === mp.name)?.default ?? "")}
                        value={(r.params?.[mp.name] as number | undefined) ?? ""}
                        onChange={(e) => setParam(i, mp.name, num(e.target.value))}
                        title={mp.name}
                      />
                      <span className="muted small">{mp.unit}</span>
                    </span>
                  ) : (
                    <span className="muted small">—</span>
                  )}
                </td>
                <td>
                  <button className="link" onClick={() => onChange(reqs.filter((_, k) => k !== i))} title="Remover">
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="link" onClick={() => onChange([...reqs, { id: reqId(), componentId: "tomada-baixa", qty: 1 }])}>
        + adicionar ponto
      </button>
    </div>
  );
}

/** Dados técnicos do equipamento (potência, tensão, pesos, UHC, Ø esgoto). */
export function TechEditor({ tech, base, onChange }: { tech: TechData; base?: TechData; onChange: (t: TechData) => void }) {
  return (
    <div className="tech-editor">
      {TECH_FIELDS.map((f) => (
        <label key={f.key} title={f.unit}>
          <span>
            {f.label} <span className="muted">({f.unit})</span>
          </span>
          <input
            type="number"
            step={f.step}
            placeholder={base?.[f.key] != null ? String(base[f.key]) : ""}
            value={tech[f.key] ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim() === "" ? undefined : Number(e.target.value.replace(",", "."));
              const next = { ...tech };
              if (v == null || !Number.isFinite(v)) delete next[f.key];
              else next[f.key] = v;
              onChange(next);
            }}
          />
        </label>
      ))}
    </div>
  );
}

const fmtN = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ","));

export function techSummary(t: TechData): string {
  const parts: string[] = [];
  if (t.potencia != null) parts.push(`${fmtN(t.potencia)} W/VA`);
  if (t.tensao != null) parts.push(`${t.tensao} V`);
  if (t.pesoAF != null) parts.push(`peso AF ${fmtN(t.pesoAF)}`);
  if (t.pesoAQ != null) parts.push(`peso AQ ${fmtN(t.pesoAQ)}`);
  if (t.uhc != null) parts.push(`${fmtN(t.uhc)} UHC`);
  if (t.diamEsgoto != null) parts.push(`esgoto Ø${t.diamEsgoto}`);
  return parts.join(" · ");
}
