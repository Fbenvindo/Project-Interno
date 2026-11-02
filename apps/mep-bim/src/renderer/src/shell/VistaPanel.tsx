// Propriedades da vista aberta (aparece na paleta de Propriedades quando nada está selecionado).
import { DISCIPLINES } from "../../../core/disciplines";
import type { PlanLabels } from "../../../core/plan/build";
import type { Discipline } from "../../../core/types";
import type { SheetDef } from "../../../core/viewDrawing";
import { DEFAULT_LABELS, primaryDisciplines, SECTION_LABEL, type ViewDef } from "../../../core/views";

const SCALES = [10, 20, 25, 50, 75, 100, 125, 200];

interface Props {
  /** null = planta de trabalho do pavimento. */
  view: ViewDef | null;
  storey: string;
  projectDisciplines: Discipline[];
  available: Discipline[];
  sheets: SheetDef[];
  onChange: (v: ViewDef) => void;
  onAddToSheet: (sheetId: string | null) => void;
  /** Corte: recorta o 3D pelo plano do corte. */
  onShow3D?: () => void;
  /** Vista 3D: grava a câmera atual na vista. */
  onSaveCamera?: () => void;
}

export function VistaPanel({ view, storey, projectDisciplines, available, sheets, onChange, onAddToSheet, onShow3D, onSaveCamera }: Props) {
  if (!view)
    return (
      <div className="vista-panel">
        <div className="vp-title">
          <span className="vp-sec trabalho">Trabalho</span> Planta — {storey}
        </div>
        <p className="muted small">
          Vista de trabalho: tudo visível (modelo, vínculos e todas as disciplinas). Para as folhas, use a planta deste pavimento em Documentação.
        </p>
      </div>
    );
  const set = (patch: Partial<ViewDef>) => onChange({ ...view, ...patch });
  const doc = view.section === "documentacao";
  const primary = new Set(primaryDisciplines(projectDisciplines));
  const refs = view.refDisciplines ?? [];
  const labels = view.labels ?? DEFAULT_LABELS;
  const onSheets = sheets.filter((s) => s.viewports.some((vp) => vp.viewId === view.id));
  return (
    <div className="vista-panel">
      <div className="vp-title">
        <span className={`vp-sec ${view.section}`}>{SECTION_LABEL[view.section]}</span> {view.name}
      </div>
      <table className="props">
        <tbody>
          <tr>
            <th>Nome</th>
            <td>
              <input value={view.name} onChange={(e) => set({ name: e.target.value })} />
            </td>
          </tr>
          <tr>
            <th>Seção</th>
            <td>
              <select value={view.section} onChange={(e) => set({ section: e.target.value as ViewDef["section"] })} disabled={view.id.startsWith("doc-planta:")}>
                <option value="trabalho">Trabalho (tudo visível)</option>
                <option value="documentacao">Documentação (folhas)</option>
              </select>
            </td>
          </tr>
          {view.kind !== "3d" && (
            <tr>
              <th>Escala</th>
              <td>
                <select value={view.scale} onChange={(e) => set({ scale: Number(e.target.value) })}>
                  {SCALES.map((s) => (
                    <option key={s} value={s}>
                      1:{s}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          )}
          {(view.kind === "planta" || view.kind === "ampliacao") && (
            <tr>
              <th>Altura de corte (m)</th>
              <td>
                <input type="number" step={0.05} min={0.1} value={view.cutHeight ?? 1.2} onChange={(e) => set({ cutHeight: Math.max(0.1, Number(e.target.value) || 1.2) })} />
              </td>
            </tr>
          )}
          {view.kind === "corte" && view.cut && (
            <tr>
              <th>Profundidade (m)</th>
              <td>
                <input type="number" step={0.5} min={0} value={view.cut.depth} onChange={(e) => set({ cut: { ...view.cut!, depth: Math.max(0, Number(e.target.value) || 0) } })} />
              </td>
            </tr>
          )}
          {view.kind === "corte" && view.cut && (
            <tr>
              <th>Sentido</th>
              <td>
                <button className="btn small" onClick={() => set({ cut: { ...view.cut!, side: view.cut!.side === 1 ? -1 : 1 } })}>
                  Inverter direção
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {doc && (
        <>
          <div className="field-label">Disciplinas do projeto</div>
          <div className="muted small">
            {[...primary].map((d) => DISCIPLINES.find((x) => x.id === d)?.label).join(", ")} — definidas no topo do navegador de vistas.
          </div>
          <div className="field-label">Informação de outras disciplinas (meio-tom)</div>
          <div className="chips">
            {DISCIPLINES.filter((d) => d.isMep && !primary.has(d.id) && available.includes(d.id)).map((d) => {
              const on = refs.includes(d.id);
              return (
                <button key={d.id} className={`chip small ${on ? "on" : ""}`} onClick={() => set({ refDisciplines: on ? refs.filter((x) => x !== d.id) : [...refs, d.id] })}>
                  {d.label}
                </button>
              );
            })}
            {!DISCIPLINES.some((d) => d.isMep && !primary.has(d.id) && available.includes(d.id)) && <span className="muted small">Nenhuma outra disciplina no modelo.</span>}
          </div>
          {view.kind !== "3d" && (
            <div className="options">
              <label>
                <input type="checkbox" checked={view.background !== false} onChange={(e) => set({ background: e.target.checked })} /> Arquitetura/estrutura como fundo
              </label>
              <label>
                <input type="checkbox" checked={view.halftoneBackground !== false} disabled={view.background === false} onChange={(e) => set({ halftoneBackground: e.target.checked })} /> Fundo em meio-tom
              </label>
              {view.kind === "planta" && (
                <label>
                  <input type="checkbox" checked={!!view.workNotes} onChange={(e) => set({ workNotes: e.target.checked })} /> Incluir anotações da planta de trabalho
                </label>
              )}
            </div>
          )}
        </>
      )}

      {view.kind !== "3d" && (
        <>
          <div className="field-label">Textos</div>
          <div className="options">
            {(
              [
                ["tags", "Etiquetas"],
                ["circuits", "Circuitos"],
                ["power", "Potências"],
                ["sizes", "Bitolas"],
              ] as [keyof PlanLabels, string][]
            ).map(([k, label]) => (
              <label key={k}>
                <input type="checkbox" checked={labels[k]} onChange={(e) => set({ labels: { ...labels, [k]: e.target.checked } })} /> {label}
              </label>
            ))}
          </div>
        </>
      )}

      <div className="btn-row wrap tight">
        {view.kind === "corte" && onShow3D && (
          <button className="btn small" onClick={onShow3D}>
            Ver o corte no 3D
          </button>
        )}
        {view.kind === "3d" && onSaveCamera && (
          <button className="btn small" onClick={onSaveCamera} title="Grava a posição atual da câmera nesta vista">
            Salvar câmera atual
          </button>
        )}
      </div>

      {doc ? (
        <>
          <div className="field-label">Folhas</div>
          {onSheets.length ? <div className="small">Nesta(s) folha(s): {onSheets.map((s) => s.name).join(", ")}</div> : <div className="muted small">Ainda não está em nenhuma folha.</div>}
          <div className="btn-row wrap tight">
            <select value="" onChange={(e) => e.target.value && onAddToSheet(e.target.value === "nova" ? null : e.target.value)}>
              <option value="">Colocar na folha…</option>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="nova">+ Nova folha</option>
            </select>
          </div>
        </>
      ) : (
        <p className="muted small">Vistas de trabalho não vão para as folhas. Mude a seção para Documentação para colocá-la numa folha.</p>
      )}
    </div>
  );
}
