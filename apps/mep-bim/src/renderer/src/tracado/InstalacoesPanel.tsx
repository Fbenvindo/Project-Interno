// Medidas das formas de instalação da infraestrutura no empreendimento: onde fica o eixo do
// eletroduto em cada caso (abaixo do piso, na parede, no entreforro, na laje).
import type { ReactNode } from "react";
import { DEFAULT_INSTALL_SETTINGS, INSTALL_LABEL, installSummary, INSTALL_MODES, type InstallMode, type InstallSettings } from "../../../core/conduits";

interface Props {
  settings: InstallSettings;
  onChange: (fn: (s: InstallSettings) => InstallSettings) => void;
  /** Quantos eletrodutos existem por forma de instalação. */
  counts: Partial<Record<InstallMode, number>>;
  /** Leva os eletrodutos já traçados para as cotas das medidas atuais. */
  onApply: () => void;
}

const Mm = ({ label, value, onChange, title, min = 0 }: { label: string; value: number; onChange: (v: number) => void; title?: string; min?: number }) => (
  <label title={title}>
    {label}
    <input type="number" step={5} min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} />
  </label>
);

function Card({ mode, counts, children, note }: { mode: InstallMode; counts: Props["counts"]; children: ReactNode; note?: string }) {
  const n = counts[mode] ?? 0;
  return (
    <section className="card inst-card">
      <h3>
        {INSTALL_LABEL[mode].charAt(0).toUpperCase() + INSTALL_LABEL[mode].slice(1)}
        {n > 0 && <span className="badge">{n} trecho(s)</span>}
      </h3>
      <div className="form-grid">{children}</div>
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}

export function InstalacoesPanel({ settings: s, onChange, counts, onApply }: Props) {
  const set = <K extends keyof InstallSettings>(k: K, patch: Partial<InstallSettings[K]>) => onChange((cur) => ({ ...cur, [k]: { ...cur[k], ...patch } }));
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <div className="panel-body instalacoes">
      <h2>Instalações do empreendimento</h2>
      <p className="muted small">
        Medidas usadas pelo traçado para posicionar o eixo dos eletrodutos em cada forma de instalação (mm). Valem para todo o projeto e ficam salvas no
        arquivo .seb.
      </p>

      <h4 className="inst-zone">Piso</h4>
      <Card mode="piso" counts={counts} note="Na terra (sob o piso): a face superior do tubo fica abaixo do piso acabado (padrão 600 mm).">
        <Mm label="Face superior abaixo do piso acabado" value={s.piso.profundidade} onChange={(v) => set("piso", { profundidade: v })} />
      </Card>
      <Card mode="canaleta" counts={counts} note="Canaleta de piso (embutida) ou perimetral, fixada na parede (rodapé).">
        <label>
          Canaleta
          <select value={s.canaleta.local} onChange={(e) => set("canaleta", { local: e.target.value as "piso" | "parede" })}>
            <option value="piso">de piso</option>
            <option value="parede">perimetral, na parede</option>
          </select>
        </label>
        {s.canaleta.local === "piso" ? (
          <Mm label="Eixo abaixo do piso acabado" value={s.canaleta.profundidade} onChange={(v) => set("canaleta", { profundidade: v })} />
        ) : (
          <>
            <Mm label="Altura do eixo (acima do piso)" value={s.canaleta.altura} onChange={(v) => set("canaleta", { altura: v })} />
            <Mm label="Eixo a partir da face da parede" value={s.canaleta.afastamento} onChange={(v) => set("canaleta", { afastamento: v })} />
          </>
        )}
      </Card>

      <h4 className="inst-zone">Parede</h4>
      <Card mode="alvenaria" counts={counts} note="Trechos horizontais embutidos na parede; as descidas até os pontos continuam pela parede.">
        <Mm label="Altura do eixo (acima do piso)" value={s.alvenaria.altura} onChange={(v) => set("alvenaria", { altura: v })} />
        <Mm label="Eixo dentro da parede (a partir da face)" value={s.alvenaria.profundidade} onChange={(v) => set("alvenaria", { profundidade: v })} />
      </Card>
      <Card mode="alvenaria-aparente" counts={counts} note="Fixado na face da parede com abraçadeiras; o eixo fica a raio + folga da face.">
        <Mm label="Altura do eixo (acima do piso)" value={s.alvenariaAparente.altura} onChange={(v) => set("alvenariaAparente", { altura: v })} />
        <Mm label="Folga entre o tubo e a parede" value={s.alvenariaAparente.afastamento} onChange={(v) => set("alvenariaAparente", { afastamento: v })} />
      </Card>

      <h4 className="inst-zone">Teto</h4>
      <Card mode="entreforro" counts={counts} note="Aparente no espaço entre o forro e a laje.">
        <label>
          Referência
          <select value={s.entreforro.referencia} onChange={(e) => set("entreforro", { referencia: e.target.value as "laje" | "forro" })}>
            <option value="laje">abaixo da laje</option>
            <option value="forro">acima do forro</option>
          </select>
        </label>
        <Mm label={s.entreforro.referencia === "laje" ? "Eixo abaixo da face da laje" : "Eixo acima do forro"} value={s.entreforro.distancia} onChange={(v) => set("entreforro", { distancia: v })} />
        {s.entreforro.referencia === "forro" && (
          <Mm label="Altura do forro (acima do piso)" value={s.entreforro.forroAltura} onChange={(v) => set("entreforro", { forroAltura: v })} />
        )}
      </Card>
      <Card mode="laje-aparente" counts={counts} note="Aparente no teto, fixado sob a laje (padrão 100 mm). Mudando a altura de uma rede no teto, a nova distância passa a valer para as próximas.">
        <Mm label="Face superior abaixo da laje" value={s.lajeAparente.afastamento} onChange={(v) => set("lajeAparente", { afastamento: v })} />
      </Card>
      <Card mode="laje" counts={counts} note="Na laje de teto: a face inferior do tubo fica acima da face inferior da laje (padrão 30 mm).">
        <Mm label="Face inferior acima da face inferior da laje" value={s.laje.profundidade} onChange={(v) => set("laje", { profundidade: v })} />
      </Card>

      <h4 className="inst-zone">Hidráulica, incêndio, gás e ar condicionado</h4>
      <section className="card inst-card">
        <h3>Tubulações e dutos</h3>
        <div className="form-grid">
          <Mm label="Teto (hidráulica, incêndio, gás): face superior abaixo da laje" value={s.redes.tetoHidraulica} onChange={(v) => set("redes", { tetoHidraulica: v })} />
          <Mm label="Teto (ar condicionado): face superior abaixo da laje" value={s.redes.tetoHvac} onChange={(v) => set("redes", { tetoHvac: v })} />
          <Mm label="Terra, esgoto e pluvial: face superior abaixo do piso" value={s.redes.terraEsgoto} onChange={(v) => set("redes", { terraEsgoto: v })} />
          <Mm label="Terra, demais redes: face superior abaixo do piso" value={s.redes.terra} onChange={(v) => set("redes", { terra: v })} />
          <Mm label="Contrapiso (gás em cobre): face superior abaixo do piso" value={s.redes.contrapiso} onChange={(v) => set("redes", { contrapiso: v })} />
        </div>
        <p className="muted small">
          Embutido na laje só para gás em cobre (no contrapiso). Ar condicionado não tem rede no piso. Na parede, as tubulações acompanham as conexões.
        </p>
      </section>

      <section className="card">
        <h3>Resumo</h3>
        <ul className="sel-list">
          {INSTALL_MODES.map((m) => (
            <li key={m}>
              <span className="grow">
                <b>{INSTALL_LABEL[m]}:</b> {installSummary(m, s)}
              </span>
            </li>
          ))}
        </ul>
        <div className="btn-row wrap tight">
          <button className="btn primary" disabled={!total} onClick={onApply} title="Leva os eletrodutos já traçados para as cotas das medidas atuais">
            Atualizar os {total} trecho(s) existentes
          </button>
          <button className="btn" onClick={() => onChange(() => DEFAULT_INSTALL_SETTINGS)}>
            Voltar ao padrão
          </button>
        </div>
        <p className="muted small">
          Novos traçados já usam as medidas atuais. "Atualizar" ajusta a altura dos eletrodutos existentes; nos de parede, a distância até a face da parede
          continua como foi desenhada.
        </p>
      </section>
    </div>
  );
}
