import { useState } from "react";
import { DISCIPLINES } from "../../../core/disciplines";
import type { PlanDrawing } from "../../../core/plan/drawing";
import type { PlanLabels } from "../../../core/plan/build";
import { exportDxf } from "../../../core/plan/dxf";
import { SHEETS, type SheetFormat, type SheetInfo, type SheetResult } from "../../../core/plan/sheet";
import type { Discipline } from "../../../core/types";
import { saveFile, savePdf } from "../platform";

export interface PlanSettings {
  storey: string;
  cutHeight: number;
  scale: number;
  format: SheetFormat;
  disciplines: Discipline[];
  labels: PlanLabels;
  info: SheetInfo;
}

export const SCALES = [20, 25, 50, 75, 100, 125, 200];

interface Props {
  settings: PlanSettings;
  onChange: (s: PlanSettings) => void;
  storeys: string[];
  drawing: PlanDrawing;
  sheet: SheetResult;
  fileName: string | null;
  /** Disciplinas presentes no modelo e no projeto. */
  available: Discipline[];
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

export function PlantaPanel({ settings, onChange, storeys, drawing, sheet, fileName, available }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof PlanSettings>(k: K, v: PlanSettings[K]) => onChange({ ...settings, [k]: v });
  const setInfo = (k: keyof SheetInfo, v: string) => onChange({ ...settings, info: { ...settings.info, [k]: v } });
  const setLabel = (k: keyof PlanLabels, v: boolean) => onChange({ ...settings, labels: { ...settings.labels, [k]: v } });
  const base = `${(fileName ?? "modelo").replace(/\.ifc$/i, "")}-planta-${slug(settings.storey)}`;

  const exportPdf = async () => {
    const f = SHEETS[settings.format];
    const saved = await savePdf({ defaultName: `${base}.pdf`, svg: sheet.svg, widthMm: f.w, heightMm: f.h });
    if (saved) setMessage(`PDF: ${saved}`);
  };
  const exportSvg = async () => {
    const saved = await saveFile({ defaultName: `${base}.svg`, content: sheet.svg, filters: [{ name: "SVG", extensions: ["svg"] }] });
    if (saved) setMessage(`SVG: ${saved}`);
  };
  const exportDxfFile = async () => {
    const saved = await saveFile({ defaultName: `${base}.dxf`, content: exportDxf(drawing), filters: [{ name: "DXF (AutoCAD)", extensions: ["dxf"] }] });
    if (saved) setMessage(`DXF: ${saved} (em mm, escala real; símbolos para 1:${settings.scale})`);
  };

  const toggleDiscipline = (d: Discipline) =>
    set("disciplines", settings.disciplines.includes(d) ? settings.disciplines.filter((x) => x !== d) : [...settings.disciplines, d]);

  return (
    <div className="panel-body locacao">
      <h2>Planta 2D</h2>
      <section className="card">
        <div className="form-grid">
          <label>
            Pavimento
            <select value={settings.storey} onChange={(e) => set("storey", e.target.value)}>
              {storeys.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Altura de corte (m)
            <input type="number" step={0.05} min={0.1} value={settings.cutHeight} onChange={(e) => set("cutHeight", Number(e.target.value))} />
          </label>
          <label>
            Escala
            <select value={settings.scale} onChange={(e) => set("scale", Number(e.target.value))}>
              {SCALES.map((s) => (
                <option key={s} value={s}>
                  1:{s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Formato
            <select value={settings.format} onChange={(e) => set("format", e.target.value as SheetFormat)}>
              {(Object.keys(SHEETS) as SheetFormat[]).map((f) => (
                <option key={f} value={f}>
                  {f} ({SHEETS[f].w}×{SHEETS[f].h} mm)
                </option>
              ))}
            </select>
          </label>
        </div>
        {!sheet.fits && (
          <div className="status warn">A planta não cabe na folha {settings.format} em 1:{settings.scale}. Aumente o formato ou reduza a escala.</div>
        )}

        <div className="field-label">Disciplinas</div>
        <div className="chips">
          {DISCIPLINES.filter((d) => available.includes(d.id)).map((d) => {
            const on = settings.disciplines.includes(d.id);
            return (
              <button key={d.id} className={`chip ${on ? "on" : ""}`} style={on ? { borderColor: d.color, background: d.color + "33" } : undefined} onClick={() => toggleDiscipline(d.id)}>
                {d.label}
              </button>
            );
          })}
        </div>

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
              <input type="checkbox" checked={settings.labels[k]} onChange={(e) => setLabel(k, e.target.checked)} /> {label}
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Carimbo</h3>
        <div className="form-grid">
          {(
            [
              ["projeto", "Projeto"],
              ["conteudo", "Conteúdo"],
              ["responsavel", "Responsável técnico"],
              ["data", "Data"],
              ["revisao", "Revisão"],
              ["folha", "Folha"],
            ] as [keyof SheetInfo, string][]
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input value={settings.info[k]} onChange={(e) => setInfo(k, e.target.value)} />
            </label>
          ))}
        </div>
      </section>

      <div className="btn-row wrap">
        <button className="btn primary" onClick={exportPdf}>
          Exportar PDF
        </button>
        <button className="btn" onClick={exportDxfFile}>
          Exportar DXF
        </button>
        <button className="btn" onClick={exportSvg}>
          Exportar SVG
        </button>
      </div>
      {message && <div className="status small">{message}</div>}
      <p className="muted small">
        {drawing.prims.length} elementos de desenho · {drawing.legend.length} itens de legenda. A simbologia elétrica segue a prática
        baseada na NBR 5444; confira com o padrão gráfico do escritório antes de emitir.
      </p>
    </div>
  );
}
