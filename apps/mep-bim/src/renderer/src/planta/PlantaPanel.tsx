import { useRef, useState } from "react";
import { DISCIPLINES } from "../../../core/disciplines";
import type { PlanDrawing } from "../../../core/plan/drawing";
import type { PlanLabels } from "../../../core/plan/build";
import { exportDxf } from "../../../core/plan/dxf";
import { SHEETS, type SheetFormat, type SheetInfo, type SheetResult } from "../../../core/plan/sheet";
import type { Discipline } from "../../../core/types";
import { saveFile, savePdf } from "../platform";
import { extraFields, STANDARD_FIELDS } from "../../../core/plan/titleBlock";
import { defaultTitleBlockId, importTitleBlock, removeTitleBlock, setDefaultTitleBlockId, upsertTitleBlock, useTitleBlocks } from "./titleBlocks";

export interface PlanSettings {
  storey: string;
  cutHeight: number;
  scale: number;
  format: SheetFormat;
  disciplines: Discipline[];
  labels: PlanLabels;
  info: SheetInfo;
  /** Carimbo personalizado (null = carimbo padrão do app). */
  titleBlockId: string | null;
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
  const setInfo = (k: Exclude<keyof SheetInfo, "extras">, v: string) => onChange({ ...settings, info: { ...settings.info, [k]: v } });
  const setExtra = (k: string, v: string) => onChange({ ...settings, info: { ...settings.info, extras: { ...settings.info.extras, [k]: v } } });
  const blocks = useTitleBlocks();
  const current = blocks.find((b) => b.id === settings.titleBlockId) ?? null;
  const extras = extraFields(current);
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDefault, setIsDefault] = useState(() => defaultTitleBlockId());
  const importFile = async (file: File) => {
    try {
      const tb = await importTitleBlock(file);
      const warn = upsertTitleBlock(tb);
      set("titleBlockId", tb.id);
      setMessage(warn ?? `Carimbo "${tb.name}" importado (${tb.width} × ${tb.height} mm).`);
    } catch (e) {
      setMessage(`Não foi possível importar o carimbo: ${e instanceof Error ? e.message : e}`);
    }
  };
  const resize = (width: number) => {
    if (!current || !(width > 0)) return;
    upsertTitleBlock({ ...current, width, height: Math.round(((width * current.height) / current.width) * 10) / 10 });
    onChange({ ...settings });
  };
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
          <label className="span-2">
            Modelo de carimbo
            <select value={settings.titleBlockId ?? ""} onChange={(e) => set("titleBlockId", e.target.value || null)}>
              <option value="">Padrão do SmartEasyBIM</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.kind === "image" ? "imagem" : "vetorial"})
                </option>
              ))}
            </select>
          </label>
          {current && (
            <label>
              Largura (mm)
              <input type="number" step={1} min={20} value={current.width} onChange={(e) => resize(Number(e.target.value))} title={`Altura: ${current.height} mm (proporcional)`} />
            </label>
          )}
        </div>
        <div className="btn-row wrap tight">
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Importar carimbo…
          </button>
          {!blocks.length && (
            <button
              className="btn"
              onClick={async () => {
                const res = await fetch(new URL("samples/carimbo-exemplo.dxf", document.baseURI));
                await importFile(new File([await res.blob()], "carimbo-exemplo.dxf"));
              }}
              title="Carimbo em DXF com campos {{...}}, para ver como funciona"
            >
              Usar exemplo
            </button>
          )}
          {current && (
            <button
              className="btn danger"
              onClick={() => {
                if (!window.confirm(`Remover o carimbo "${current.name}" da biblioteca?`)) return;
                removeTitleBlock(current.id);
                set("titleBlockId", null);
              }}
            >
              Remover
            </button>
          )}
          <label className="inline-check">
            <input
              type="checkbox"
              checked={(isDefault ?? null) === (settings.titleBlockId ?? null) && isDefault != null}
              onChange={(e) => {
                const id = e.target.checked ? settings.titleBlockId : null;
                setDefaultTitleBlockId(id);
                setIsDefault(id);
              }}
              disabled={!settings.titleBlockId}
            />
            Padrão das novas folhas
          </label>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".svg,.dxf,.png,.jpg,.jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
        <div className="form-grid">
          {(
            [
              ["projeto", "Projeto"],
              ["conteudo", "Conteúdo"],
              ["responsavel", "Responsável técnico"],
              ["data", "Data"],
              ["revisao", "Revisão"],
              ["folha", "Folha"],
            ] as [Exclude<keyof SheetInfo, "extras">, string][]
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input value={settings.info[k]} onChange={(e) => setInfo(k, e.target.value)} />
            </label>
          ))}
          {extras.map((k) => (
            <label key={k}>
              {k}
              <input value={settings.info.extras?.[k] ?? ""} onChange={(e) => setExtra(k, e.target.value)} />
            </label>
          ))}
        </div>
        <details className="small">
          <summary>Como preparar o carimbo do empreendimento</summary>
          <p className="muted">
            Importe o carimbo padrão em <b>DXF</b> (no AutoCAD: Salvar como › DXF, desenhado em mm, 1:1), <b>SVG</b> ou imagem <b>PNG/JPG</b>. Ele
            é posicionado no canto inferior direito da folha e fica guardado neste computador para as próximas folhas.
          </p>
          <p className="muted">
            Nos textos do DXF/SVG, escreva campos entre chaves duplas para preenchimento automático:{" "}
            {STANDARD_FIELDS.map((f) => `{{${f.key}}}`).join(", ")}. Qualquer outro nome, como {"{{cliente}}"} ou {"{{art}}"}, vira um campo
            para preencher aqui.
          </p>
        </details>
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
