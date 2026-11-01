import { useMemo, useState, type ReactNode } from "react";
import {
  correnteDeProjeto,
  quedaDeTensao,
  secaoPorQuedaDeTensao,
  SECOES_PADRAO,
  type MaterialCondutor,
  type SistemaEletrico,
  type TipoCircuito,
} from "../../../core/calc/eletrica";
import { trechoAguaFria, vazaoPorPesos, type MaterialTubo } from "../../../core/calc/hidraulica";
import { areaRetangular, diametroEquivalente, razaoAspecto, velocidadeDuto } from "../../../core/calc/hvac";
import { formatNumber } from "../../../core/format";
import type { ElementInfo } from "../../../core/types";

interface Props {
  selected: ElementInfo | null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, step = "any" }: { value: number; onChange: (v: number) => void; step?: string }) {
  return <input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />;
}

function Result({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return <div className={`result ${ok == null ? "" : ok ? "ok" : "fail"}`}>{children}</div>;
}

function safe<T>(fn: () => T): T | Error {
  try {
    return fn();
  } catch (e) {
    return e as Error;
  }
}

function parseSize(size: string | null): { diameter?: number; width?: number; height?: number } {
  if (!size) return {};
  const d = size.match(/^Ø([\d.]+)/);
  if (d) return { diameter: Number(d[1]) };
  const r = size.match(/^([\d.]+)x([\d.]+)/);
  if (r) return { width: Number(r[1]), height: Number(r[2]) };
  return {};
}

function SelectedHint({ selected, onUse, what }: { selected: ElementInfo | null; onUse: () => void; what: string }) {
  if (!selected || selected.category !== "segmento") return null;
  return (
    <button className="link" onClick={onUse}>
      Usar {what} de “{selected.name}”
    </button>
  );
}

function QuedaTensaoCard({ selected }: Props) {
  const [sistema, setSistema] = useState<SistemaEletrico>("monofasico");
  const [tipo, setTipo] = useState<TipoCircuito>("forca");
  const [material, setMaterial] = useState<MaterialCondutor>("cobre");
  const [tensao, setTensao] = useState(220);
  const [potencia, setPotencia] = useState(2200);
  const [fp, setFp] = useState(0.92);
  const [comprimento, setComprimento] = useState(25);
  const [secao, setSecao] = useState(2.5);
  const [limite, setLimite] = useState(4);

  const corrente = correnteDeProjeto(potencia, tensao, sistema, fp);
  const base = { sistema, tensao, corrente, comprimento, material, fatorPotencia: fp, limitePercentual: limite };
  const res = safe(() => quedaDeTensao({ ...base, secao }));
  const sugerida = safe(() => secaoPorQuedaDeTensao({ ...base, tipoCircuito: tipo }));

  return (
    <section className="card">
      <h3>Queda de tensão (NBR 5410)</h3>
      <div className="form-grid">
        <Field label="Sistema">
          <select value={sistema} onChange={(e) => setSistema(e.target.value as SistemaEletrico)}>
            <option value="monofasico">Monofásico (F+N)</option>
            <option value="bifasico">Bifásico (F+F)</option>
            <option value="trifasico">Trifásico</option>
          </select>
        </Field>
        <Field label="Circuito">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoCircuito)}>
            <option value="iluminacao">Iluminação</option>
            <option value="forca">Força / TUG / TUE</option>
            <option value="sinalizacao">Sinalização / controle</option>
          </select>
        </Field>
        <Field label="Tensão (V)">
          <NumberInput value={tensao} onChange={setTensao} />
        </Field>
        <Field label="Potência (W)">
          <NumberInput value={potencia} onChange={setPotencia} />
        </Field>
        <Field label="Fator de potência">
          <NumberInput value={fp} onChange={setFp} step="0.01" />
        </Field>
        <Field label="Comprimento (m)">
          <NumberInput value={comprimento} onChange={setComprimento} />
        </Field>
        <Field label="Seção (mm²)">
          <select value={secao} onChange={(e) => setSecao(Number(e.target.value))}>
            {SECOES_PADRAO.map((s) => (
              <option key={s} value={s}>
                {formatNumber(s, s % 1 ? 1 : 0)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condutor">
          <select value={material} onChange={(e) => setMaterial(e.target.value as MaterialCondutor)}>
            <option value="cobre">Cobre</option>
            <option value="aluminio">Alumínio</option>
          </select>
        </Field>
        <Field label="Limite (%)">
          <NumberInput value={limite} onChange={setLimite} />
        </Field>
      </div>
      <SelectedHint selected={selected} what="o comprimento" onUse={() => selected?.length && setComprimento(Math.round(selected.length * 100) / 100)} />
      {res instanceof Error ? (
        <Result ok={false}>{res.message}</Result>
      ) : (
        <Result ok={res.atende}>
          Corrente de projeto: <b>{formatNumber(corrente, 2)} A</b>
          <br />
          Queda: <b>{formatNumber(res.quedaVolts, 2)} V</b> ({formatNumber(res.quedaPercentual, 2)}%) —{" "}
          {res.atende ? "atende" : "não atende"} ao limite de {formatNumber(res.limitePercentual, 1)}%
          <br />
          {!(sugerida instanceof Error) &&
            (sugerida ? (
              <>
                Menor seção por queda de tensão: <b>{formatNumber(sugerida.secao, sugerida.secao % 1 ? 1 : 0)} mm²</b>
              </>
            ) : (
              "Nenhuma seção comercial atende: divida o circuito ou reduza o comprimento."
            ))}
        </Result>
      )}
      <p className="muted small">
        Considera condutor a 70 °C e reatância de 0,10 Ω/km. A capacidade de condução de corrente (tabelas 36–39) ainda precisa ser verificada à
        parte.
      </p>
    </section>
  );
}

function AguaFriaCard({ selected }: Props) {
  const [modoVazao, setModoVazao] = useState<"pesos" | "vazao">("pesos");
  const [pesos, setPesos] = useState(2.5);
  const [vazaoDireta, setVazaoDireta] = useState(0.5);
  const [diametro, setDiametro] = useState(21.6);
  const [comprimento, setComprimento] = useState(10);
  const [equivalente, setEquivalente] = useState(3);
  const [material, setMaterial] = useState<MaterialTubo>("pvc");

  const vazao = modoVazao === "pesos" ? vazaoPorPesos(pesos) : vazaoDireta;
  const res = safe(() => trechoAguaFria({ vazaoLs: vazao, diametroInternoMm: diametro, comprimento, comprimentoEquivalente: equivalente, material }));

  return (
    <section className="card">
      <h3>Trecho de água fria (NBR 5626)</h3>
      <div className="form-grid">
        <Field label="Vazão por">
          <select value={modoVazao} onChange={(e) => setModoVazao(e.target.value as "pesos" | "vazao")}>
            <option value="pesos">Soma dos pesos</option>
            <option value="vazao">Vazão direta (L/s)</option>
          </select>
        </Field>
        {modoVazao === "pesos" ? (
          <Field label="Σ pesos">
            <NumberInput value={pesos} onChange={setPesos} />
          </Field>
        ) : (
          <Field label="Vazão (L/s)">
            <NumberInput value={vazaoDireta} onChange={setVazaoDireta} />
          </Field>
        )}
        <Field label="Diâmetro interno (mm)">
          <NumberInput value={diametro} onChange={setDiametro} />
        </Field>
        <Field label="Material">
          <select value={material} onChange={(e) => setMaterial(e.target.value as MaterialTubo)}>
            <option value="pvc">PVC (liso)</option>
            <option value="cobre">Cobre (liso)</option>
            <option value="aco_galvanizado">Aço galvanizado (rugoso)</option>
          </select>
        </Field>
        <Field label="Comprimento real (m)">
          <NumberInput value={comprimento} onChange={setComprimento} />
        </Field>
        <Field label="Compr. equivalente (m)">
          <NumberInput value={equivalente} onChange={setEquivalente} />
        </Field>
      </div>
      <SelectedHint selected={selected} what="comprimento e diâmetro" onUse={() => {
        if (!selected) return;
        if (selected.length) setComprimento(Math.round(selected.length * 100) / 100);
        const { diameter } = parseSize(selected.size);
        if (diameter) setDiametro(diameter);
      }} />
      {res instanceof Error ? (
        <Result ok={false}>{res.message}</Result>
      ) : (
        <Result ok={res.velocidadeAtende}>
          Vazão: <b>{formatNumber(vazao, 3)} L/s</b> · Velocidade: <b>{formatNumber(res.velocidade, 2)} m/s</b>{" "}
          {res.velocidadeAtende ? "(≤ 3 m/s)" : "(acima de 3 m/s)"}
          <br />
          Perda unitária: <b>{formatNumber(res.perdaUnitaria, 4)} kPa/m</b>
          <br />
          Perda no trecho: <b>{formatNumber(res.perdaTotal, 2)} kPa</b> ({formatNumber(res.perdaTotalMca, 3)} m.c.a.)
        </Result>
      )}
      <p className="muted small">Fair-Whipple-Hsiao. Ao usar o elemento selecionado, confira se a dimensão é o diâmetro interno.</p>
    </section>
  );
}

function DutoCard({ selected }: Props) {
  const [vazao, setVazao] = useState(2000);
  const [largura, setLargura] = useState(400);
  const [altura, setAltura] = useState(300);
  const out = useMemo(
    () =>
      safe(() => ({
        v: velocidadeDuto(vazao, areaRetangular(largura, altura)),
        de: diametroEquivalente(largura, altura),
        ar: razaoAspecto(largura, altura),
      })),
    [vazao, largura, altura],
  );
  return (
    <section className="card">
      <h3>Duto retangular</h3>
      <div className="form-grid">
        <Field label="Vazão (m³/h)">
          <NumberInput value={vazao} onChange={setVazao} />
        </Field>
        <Field label="Largura (mm)">
          <NumberInput value={largura} onChange={setLargura} />
        </Field>
        <Field label="Altura (mm)">
          <NumberInput value={altura} onChange={setAltura} />
        </Field>
      </div>
      <SelectedHint selected={selected} what="a seção" onUse={() => {
        const { width, height } = parseSize(selected?.size ?? null);
        if (width && height) {
          setLargura(width);
          setAltura(height);
        }
      }} />
      {out instanceof Error ? (
        <Result ok={false}>{out.message}</Result>
      ) : (
        <Result ok={out.ar <= 4}>
          Velocidade: <b>{formatNumber(out.v, 2)} m/s</b>
          <br />
          Diâmetro equivalente: <b>{formatNumber(out.de, 0)} mm</b>
          <br />
          Razão de aspecto: <b>{formatNumber(out.ar, 2)}</b> {out.ar > 4 && "(acima de 4:1, evite)"}
        </Result>
      )}
    </section>
  );
}

export function CalcPanel({ selected }: Props) {
  return (
    <div className="panel-body">
      <h2>Dimensionamento</h2>
      <p className="muted small">
        Calculadoras de verificação rápida. Selecione um segmento no modelo para aproveitar comprimento e dimensão.
      </p>
      <QuedaTensaoCard selected={selected} />
      <AguaFriaCard selected={selected} />
      <DutoCard selected={selected} />
    </div>
  );
}
