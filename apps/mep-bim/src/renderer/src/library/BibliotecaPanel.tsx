// Biblioteca de famílias do Revit: importação (.sebfam), ajustes por família e locação.
import { useRef, useState } from "react";
import { categoryProfile, defaultMounting, defaultOutAxis, OUT_AXES, revitComponentId, type OutAxis } from "../../../core/families";
import { COMPONENT_GROUPS, MOUNTING_LABEL, type Mounting } from "../../../core/library";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import type { PlacedPoint } from "../../../core/points";
import { importFamilyPackage, removeFamilyPackage, setFamilyOverride, useFamilyLibrary } from "./familyLibrary";

interface Props {
  points: PlacedPoint[];
  /** Locar um tipo (abre a ferramenta de locação com o componente). */
  onPlace: (componentId: string) => void;
}

const AXIS_HINT: Record<OutAxis, string> = {
  "+X": "+X da família",
  "-X": "−X da família",
  "+Y": "+Y da família",
  "-Y": "−Y da família (frente)",
  "+Z": "+Z da família (face)",
  "-Z": "−Z da família (para baixo)",
};

export function BibliotecaPanel({ points, onPlace }: Props) {
  const entries = useFamilyLibrary();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const importFile = async (file: File) => {
    try {
      const e = await importFamilyPackage(file.name, await file.text());
      const types = e.pkg.familias.reduce((s, f) => s + f.tipos.length, 0);
      setMessage(`${e.pkg.familias.length} família(s) e ${types} tipo(s) importados de ${file.name}.`);
    } catch (err) {
      setMessage(`Não foi possível importar: ${err instanceof Error ? err.message : err}`);
    }
  };
  const useSample = async () => {
    const res = await fetch(new URL("samples/familias-exemplo.sebfam", document.baseURI));
    await importFile(new File([await res.text()], "familias-exemplo.sebfam"));
  };
  const inUse = (entryId: string) => points.filter((p) => p.componentId.startsWith("rvt:") && entries.find((e) => e.id === entryId)?.pkg.familias.some((f) => f.tipos.some((t) => revitComponentId(f.uid, t.nome) === p.componentId))).length;

  return (
    <div className="panel-body locacao biblioteca">
      <h2>Importar elementos em IFC</h2>
      <p className="muted small">
        Famílias exportadas do Revit pelo plugin SmartEasyBIM (aba <b>SmartEasyBIM › Exportar famílias</b>). Cada tipo vira um item da biblioteca de
        locação, com a geometria 3D, os parâmetros e a classe IFC da categoria.
      </p>
      <div className="btn-row wrap tight">
        <button className="btn primary" onClick={() => input.current?.click()}>
          Importar famílias (.sebfam)…
        </button>
        {!entries.length && (
          <button className="btn" onClick={useSample}>
            Usar exemplo
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".sebfam,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />
      {message && <div className="status small">{message}</div>}

      {entries.map((e) => (
        <section key={e.id} className="card lib-package">
          <div className="panel-head">
            <h3>{e.name}</h3>
            <button
              className="btn danger small-btn"
              onClick={() => {
                const n = inUse(e.id);
                if (n) {
                  setMessage(`${n} ponto(s) locado(s) usam famílias deste arquivo: exclua-os antes de remover.`);
                  return;
                }
                if (window.confirm(`Remover "${e.name}" da biblioteca?`)) void removeFamilyPackage(e.id);
              }}
            >
              Remover
            </button>
          </div>
          <div className="muted small">
            {e.pkg.origem}
            {e.pkg.arquivo ? ` · ${e.pkg.arquivo}` : ""} · importado em {new Date(e.importedAt).toLocaleDateString("pt-BR")}
          </div>
          {e.pkg.familias.map((f) => {
            const ov = e.overrides[f.uid] ?? {};
            const profile = categoryProfile(f.categoriaRevit);
            const mounting = ov.mounting ?? defaultMounting(f);
            const out = ov.out ?? defaultOutAxis(f, mounting);
            const key = `${e.id}|${f.uid}`;
            const expanded = open === key;
            return (
              <div key={f.uid} className="lib-family">
                <button className="lib-family-head" onClick={() => setOpen(expanded ? null : key)}>
                  <span className="swatch" style={{ background: DISCIPLINE_BY_ID[profile.discipline].color }} />
                  <span className="grow">
                    <b>{f.nome}</b>
                    <span className="muted small">
                      {" "}
                      · {f.categoria ?? "sem categoria"} · {f.tipos.length} tipo(s)
                    </span>
                  </span>
                  <span className={`caret ${expanded ? "open" : ""}`}>▸</span>
                </button>
                {expanded && (
                  <div className="lib-family-body">
                    <div className="form-grid">
                      <label>
                        Grupo na biblioteca
                        <select value={ov.group ?? profile.group} onChange={(ev) => void setFamilyOverride(e.id, f.uid, { group: ev.target.value })}>
                          {[...new Set([profile.group, ...COMPONENT_GROUPS])].map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Fixação
                        <select value={mounting} onChange={(ev) => void setFamilyOverride(e.id, f.uid, { mounting: ev.target.value as Mounting, out: undefined })}>
                          {(["parede", "teto", "piso"] as Mounting[]).map((m) => (
                            <option key={m} value={m}>
                              {MOUNTING_LABEL[m]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label title="Eixo da família que aponta para fora da parede/teto/piso, para o ambiente. Ajuste se a peça aparecer virada.">
                        Lado para o ambiente
                        <select value={out} onChange={(ev) => void setFamilyOverride(e.id, f.uid, { out: ev.target.value as OutAxis })}>
                          {OUT_AXES.map((a) => (
                            <option key={a} value={a}>
                              {AXIS_HINT[a]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="muted small">
                      Revit: hospedagem {f.hospedagem}, {f.conectores.length} conector(es). IFC: {profile.ifcType}.
                      {f.avisos.length > 0 && <span className="warn-text"> {f.avisos.length} aviso(s) na exportação.</span>}
                    </div>
                    <table className="grid-table">
                      <tbody>
                        {f.tipos.map((t) => (
                          <tr key={t.nome}>
                            <td>
                              {t.nome}
                              <div className="muted small">
                                {t.min && t.max ? `${Math.round(t.max[0] - t.min[0])}×${Math.round(t.max[1] - t.min[1])}×${Math.round(t.max[2] - t.min[2])} mm` : "sem geometria"} ·{" "}
                                {t.parametros.length} parâmetros
                              </div>
                            </td>
                            <td className="num">
                              <button className="btn small-btn" onClick={() => onPlace(revitComponentId(f.uid, t.nome))}>
                                Locar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <details className="small">
        <summary>Como instalar e usar o plugin do Revit</summary>
        <ol className="muted">
          <li>Baixe o pacote do plugin (SmartEasyBIM-Revit) e clique duas vezes em <b>Instalar.bat</b>. Funciona no Revit 2022 a 2027.</li>
          <li>Abra o Revit: aparece a aba <b>SmartEasyBIM</b> com o botão <b>Exportar famílias</b>.</li>
          <li>Num projeto, marque as famílias carregadas a exportar; no editor de famílias, a família aberta é exportada.</li>
          <li>Aqui, use <b>Importar famílias</b> e escolha o arquivo .sebfam gerado.</li>
        </ol>
      </details>
    </div>
  );
}
