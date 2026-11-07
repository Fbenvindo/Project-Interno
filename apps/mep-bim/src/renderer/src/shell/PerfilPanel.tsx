// Perfil do empreendimento: torres, pavimentos (comuns ou por torre), altura piso a piso,
// repetição dos pavimentos tipo e cotas. Base dos fluxogramas (faixas e colunas).
import { useState } from "react";
import {
  checkProfile,
  elevationText,
  EMPTY_PROFILE,
  floorElevations,
  newBuildingId,
  profileFromModel,
  towerSummary,
  typicalProfile,
  type BuildingFloor,
  type BuildingProfile,
} from "../../../core/building";

interface Props {
  profile: BuildingProfile | null;
  onChange: (fn: (p: BuildingProfile | null) => BuildingProfile | null, key?: string | null) => void;
  /** Pavimentos do modelo com a cota (m). */
  modelStoreys: { name: string; elevation: number }[];
  /** Fluxogramas que podem receber o perfil. */
  flowCount: number;
  onApplyToFlows: () => void;
}

const num = (v: string, d: number) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : d;
};

export function PerfilPanel({ profile, onChange, modelStoreys, flowCount, onApplyToFlows }: Props) {
  const p = profile ?? EMPTY_PROFILE;
  const set = (fn: (p: BuildingProfile) => BuildingProfile, key: string | null = "perfil") => onChange((cur) => fn(cur ?? EMPTY_PROFILE), key);
  const setFloor = (id: string, patch: Partial<BuildingFloor>, key?: string) => set((x) => ({ ...x, floors: x.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)) }), key ?? `pav:${id}`);
  const [tpl, setTpl] = useState({ towers: 2, basements: 2, typical: 18 });
  const el = floorElevations(p);
  const problems = checkProfile(p);
  const allTowers = p.towers.map((t) => t.id);
  // Exibição de cima para baixo (como num corte do prédio).
  const rows = p.floors.map((f, i) => ({ f, e: el[i], i })).reverse();
  const move = (i: number, d: -1 | 1) =>
    set((x) => {
      const j = i + d;
      if (j < 0 || j >= x.floors.length) return x;
      const floors = [...x.floors];
      [floors[i], floors[j]] = [floors[j], floors[i]];
      return { ...x, floors };
    });

  return (
    <div className="panel-body perfil">
      <h2>Perfil do empreendimento</h2>
      <p className="muted small">
        Torres, pavimentos e alturas do empreendimento. Os fluxogramas usam este perfil para as faixas de pavimento (com a cota) e as colunas das torres.
        Fica salvo no projeto (.seb).
      </p>

      <section className="card">
        <div className="panel-head">
          <h3>Torres ({p.towers.length})</h3>
          <button
            className="link"
            onClick={() =>
              set((x) => {
                const t = { id: newBuildingId("torre-"), name: `Torre ${String.fromCharCode(65 + x.towers.length)}` };
                // A torre nova recebe os pavimentos que já são de todas as torres.
                return { ...x, towers: [...x.towers, t], floors: x.floors.map((f) => (!f.common && x.towers.every((o) => f.towers.includes(o.id)) ? { ...f, towers: [...f.towers, t.id] } : f)) };
              })
            }
          >
            + torre
          </button>
        </div>
        <ul className="sel-list">
          {p.towers.map((t) => {
            const s = towerSummary(p, t.id);
            return (
              <li key={t.id}>
                <input className="grow perfil-name" value={t.name} onChange={(e) => set((x) => ({ ...x, towers: x.towers.map((o) => (o.id === t.id ? { ...o, name: e.target.value } : o)) }), `torre:${t.id}`)} />
                <span className="muted small">
                  {s.floors} pav. · {s.height.toFixed(2).replace(".", ",")} m
                </span>
                {p.towers.length > 1 && (
                  <button
                    className="link danger-link"
                    title="Remover a torre"
                    onClick={() => set((x) => ({ ...x, towers: x.towers.filter((o) => o.id !== t.id), floors: x.floors.map((f) => ({ ...f, towers: f.towers.filter((o) => o !== t.id) })) }))}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <div className="panel-head">
          <h3>Pavimentos ({p.floors.reduce((s, f) => s + Math.max(1, f.repeat), 0)})</h3>
          <button
            className="link"
            onClick={() =>
              set((x) => ({
                ...x,
                floors: [...x.floors, { id: newBuildingId("pav-"), name: `Pavimento ${x.floors.length + 1}`, height: 3, repeat: 1, common: x.towers.length < 2, towers: x.towers.map((t) => t.id) }],
              }))
            }
          >
            + pavimento no topo
          </button>
        </div>
        <label className="inline-row small">
          <span className="grow">Cota do piso do pavimento mais baixo (m)</span>
          <input type="number" step={0.5} style={{ width: 80 }} value={p.baseElevation} onChange={(e) => set((x) => ({ ...x, baseElevation: num(e.target.value, 0) }), "base")} />
        </label>
        {rows.length === 0 ? (
          <p className="muted small">Nenhum pavimento ainda: use os do modelo, um perfil típico abaixo, ou acrescente um a um.</p>
        ) : (
          <div className="perfil-table">
            <div className="perfil-row head">
              <span>Pavimento</span>
              <span title="Pavimentos iguais repetidos (tipo)">×</span>
              <span title="Altura piso a piso (m)">Altura</span>
              <span>Cota</span>
              <span title="Comum a todas as torres">Comum</span>
              <span>Torres</span>
              <span />
            </div>
            {rows.map(({ f, e, i }) => (
              <div key={f.id} className={`perfil-row ${f.common ? "common" : ""}`}>
                <input value={f.name} onChange={(ev) => setFloor(f.id, { name: ev.target.value })} />
                <input type="number" min={1} step={1} value={f.repeat} onChange={(ev) => setFloor(f.id, { repeat: Math.max(1, Math.round(num(ev.target.value, 1))) })} />
                <input type="number" min={0.5} step={0.05} value={f.height} onChange={(ev) => setFloor(f.id, { height: Math.max(0.5, num(ev.target.value, 3)) })} />
                <span className="muted small perfil-elev">{elevationText(f, e)}</span>
                <input type="checkbox" checked={f.common} onChange={(ev) => setFloor(f.id, { common: ev.target.checked, towers: ev.target.checked ? [] : allTowers })} title="Comum a todas as torres" />
                <span className="perfil-towers">
                  {f.common ? (
                    <span className="muted small">todas</span>
                  ) : (
                    p.towers.map((t) => (
                      <label key={t.id} className="perfil-tower" title={t.name}>
                        <input
                          type="checkbox"
                          checked={f.towers.includes(t.id)}
                          onChange={(ev) => setFloor(f.id, { towers: ev.target.checked ? [...f.towers, t.id] : f.towers.filter((o) => o !== t.id) })}
                        />
                        {t.name.replace(/^Torre\s+/i, "")}
                      </label>
                    ))
                  )}
                </span>
                <span className="perfil-actions">
                  <button className="link" title="Subir" onClick={() => move(i, 1)} disabled={i === p.floors.length - 1}>
                    ↑
                  </button>
                  <button className="link" title="Descer" onClick={() => move(i, -1)} disabled={i === 0}>
                    ↓
                  </button>
                  <button className="link danger-link" title="Remover" onClick={() => set((x) => ({ ...x, floors: x.floors.filter((o) => o.id !== f.id) }))}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {problems.length > 0 && (
          <ul className="small perfil-problems">
            {problems.map((t, k) => (
              <li key={k}>⚠ {t}</li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Altura = piso a piso. Nos repetidos (tipo), a cota vai do primeiro ao último. Pavimento <b>comum</b> é compartilhado por todas as torres (subsolos,
          térreo, lazer) e aparece no fluxograma atravessando as colunas; os demais ficam só nas torres marcadas.
        </p>
      </section>

      <section className="card">
        <h3>Começar a partir de</h3>
        <div className="btn-row wrap tight">
          <button
            className="btn"
            disabled={!modelStoreys.length}
            onClick={() => (!p.floors.length || window.confirm("Substituir os pavimentos pelos do modelo?")) && onChange(() => profileFromModel(modelStoreys))}
          >
            Pavimentos do modelo ({modelStoreys.length})
          </button>
        </div>
        <div className="form-grid">
          <label>
            Torres
            <input type="number" min={1} max={12} value={tpl.towers} onChange={(e) => setTpl({ ...tpl, towers: Math.max(1, Math.round(num(e.target.value, 1))) })} />
          </label>
          <label>
            Subsolos
            <input type="number" min={0} max={8} value={tpl.basements} onChange={(e) => setTpl({ ...tpl, basements: Math.max(0, Math.round(num(e.target.value, 0))) })} />
          </label>
          <label>
            Pavimentos tipo
            <input type="number" min={0} max={200} value={tpl.typical} onChange={(e) => setTpl({ ...tpl, typical: Math.max(0, Math.round(num(e.target.value, 0))) })} />
          </label>
        </div>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => (!p.floors.length || window.confirm("Substituir o perfil atual pelo perfil típico?")) && onChange(() => typicalProfile(tpl.towers, tpl.basements, tpl.typical))}
          >
            Criar perfil típico
          </button>
        </div>
        <p className="muted small">Perfil típico: subsolos e térreo comuns; pavimentos tipo, cobertura e barrilete em cada torre. Depois ajuste nomes, alturas e torres.</p>
      </section>

      <section className="card">
        <h3>Fluxogramas</h3>
        <p className="muted small">Novos fluxogramas já saem com este perfil. Para os existentes, aplique: os blocos ficam no mesmo pavimento (pelo nome) e na mesma torre.</p>
        <button className="btn primary" disabled={!flowCount || !p.floors.length} onClick={onApplyToFlows}>
          Aplicar aos {flowCount} fluxograma(s)
        </button>
      </section>
    </div>
  );
}
