// Folha (prancha): formato, carimbo e as vistas de documentação colocadas nela.
import { useRef, useState } from "react";
import type { Georef } from "../../../core/georef";
import type { PlanDrawing } from "../../../core/plan/drawing";
import { exportDxf } from "../../../core/plan/dxf";
import { SHEETS, type SheetFormat, type SheetInfo, type SheetResult } from "../../../core/plan/sheet";
import type { SheetDef } from "../../../core/viewDrawing";
import { SECTION_LABEL, type ViewDef } from "../../../core/views";
import { saveFile, savePdf } from "../platform";
import { extraFields, STANDARD_FIELDS } from "../../../core/plan/titleBlock";
import { defaultTitleBlockId, importTitleBlock, removeTitleBlock, setDefaultTitleBlockId, upsertTitleBlock, useTitleBlocks } from "./titleBlocks";

interface Props {
  sheet: SheetDef;
  onChange: (s: SheetDef) => void;
  /** Vistas de documentação disponíveis (plantas de todos os pavimentos, ampliações, cortes e 3D). */
  docViews: ViewDef[];
  rendered: SheetResult;
  /** Desenho de cada vista da folha (DXF). */
  drawings: Map<string, PlanDrawing>;
  fileName: string | null;
  georef?: Georef;
  moveMode: boolean;
  onMoveMode: (on: boolean) => void;
  onOpenView: (viewId: string) => void;
  onRefreshImage: (viewId: string) => void;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

export function FolhaPanel({ sheet, onChange, docViews, rendered, drawings, fileName, georef, moveMode, onMoveMode, onOpenView, onRefreshImage }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const set = <K extends keyof SheetDef>(k: K, v: SheetDef[K]) => onChange({ ...sheet, [k]: v });
  const setInfo = (k: Exclude<keyof SheetInfo, "extras">, v: string) => onChange({ ...sheet, info: { ...sheet.info, [k]: v } });
  const setExtra = (k: string, v: string) => onChange({ ...sheet, info: { ...sheet.info, extras: { ...sheet.info.extras, [k]: v } } });
  const blocks = useTitleBlocks();
  const current = blocks.find((b) => b.id === sheet.titleBlockId) ?? null;
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
    onChange({ ...sheet });
  };
  const base = `${(fileName ?? "modelo").replace(/\.ifc$/i, "")}-${slug(sheet.name)}`;
  const byId = new Map(docViews.map((v) => [v.id, v]));
  const free = docViews.filter((v) => !sheet.viewports.some((vp) => vp.viewId === v.id));

  const exportPdf = async () => {
    const f = SHEETS[sheet.format];
    const saved = await savePdf({ defaultName: `${base}.pdf`, svg: rendered.svg, widthMm: f.w, heightMm: f.h });
    if (saved) setMessage(`PDF: ${saved}`);
  };
  const exportSvg = async () => {
    const saved = await saveFile({ defaultName: `${base}.svg`, content: rendered.svg, filters: [{ name: "SVG", extensions: ["svg"] }] });
    if (saved) setMessage(`SVG: ${saved}`);
  };
  const [dxfCoords, setDxfCoords] = useState<"projeto" | "mapa">("projeto");
  const exportDxfOf = async (viewId: string) => {
    const d = drawings.get(viewId);
    const v = byId.get(viewId);
    if (!d || !v) return;
    const utm = dxfCoords === "mapa" && georef?.map && v.kind !== "corte";
    const saved = await saveFile({
      defaultName: `${base}-${slug(v.name)}${utm ? "-utm" : ""}.dxf`,
      content: exportDxf(d, { map: utm ? georef!.map : null }),
      filters: [{ name: "DXF (AutoCAD)", extensions: ["dxf"] }],
    });
    if (saved) setMessage(`DXF: ${saved} (em mm, escala real; símbolos para 1:${d.scale})`);
  };
  const updateVp = (viewId: string, patch: Partial<SheetDef["viewports"][number]>) =>
    set("viewports", sheet.viewports.map((vp) => (vp.viewId === viewId ? { ...vp, ...patch } : vp)));

  return (
    <div className="panel-body locacao folha">
      <h2>Folha</h2>
      <section className="card">
        <div className="form-grid">
          <label>
            Nome / número
            <input value={sheet.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            Formato
            <select value={sheet.format} onChange={(e) => set("format", e.target.value as SheetFormat)}>
              {(Object.keys(SHEETS) as SheetFormat[]).map((f) => (
                <option key={f} value={f}>
                  {f} ({SHEETS[f].w}×{SHEETS[f].h} mm)
                </option>
              ))}
            </select>
          </label>
        </div>
        {!rendered.fits && <div className="status warn">As vistas não cabem na área de desenho da folha {sheet.format}. Aumente o formato, reduza a escala ou reposicione as vistas.</div>}
      </section>

      <section className="card">
        <div className="panel-head">
          <h3>Vistas na folha</h3>
          <label className="inline-check" title="Arraste as vistas na folha para posicioná-las">
            <input type="checkbox" checked={moveMode} onChange={(e) => onMoveMode(e.target.checked)} /> Mover vistas
          </label>
        </div>
        {!sheet.viewports.length && <p className="muted small">Nenhuma vista. Só vistas de Documentação podem ir para as folhas.</p>}
        <ul className="sel-list">
          {sheet.viewports.map((vp) => {
            const v = byId.get(vp.viewId);
            return (
              <li key={vp.viewId}>
                <button className="link grow vb-open" onClick={() => onOpenView(vp.viewId)} title="Abrir a vista">
                  {v ? v.name : `(vista removida ou de trabalho)`} {v && <span className="muted">· {v.kind === "3d" ? "3D" : `1:${v.scale}`}</span>}
                </button>
                {v?.kind === "3d" && (
                  <>
                    <input
                      className="narrow"
                      type="number"
                      min={30}
                      step={10}
                      value={vp.widthMm ?? 150}
                      title="Largura da imagem na folha (mm)"
                      onChange={(e) => updateVp(vp.viewId, { widthMm: Math.max(30, Number(e.target.value) || 150) })}
                    />
                    <button className="link" title="Atualizar a imagem da vista 3D" onClick={() => onRefreshImage(vp.viewId)}>
                      ⟳
                    </button>
                  </>
                )}
                {v && v.kind !== "3d" && (
                  <button className="link" title="Exportar esta vista em DXF" onClick={() => void exportDxfOf(vp.viewId)}>
                    DXF
                  </button>
                )}
                {vp.pos && (
                  <button className="link" title="Voltar à posição automática" onClick={() => updateVp(vp.viewId, { pos: undefined })}>
                    auto
                  </button>
                )}
                <button className="link danger-link" title="Tirar da folha" onClick={() => set("viewports", sheet.viewports.filter((x) => x.viewId !== vp.viewId))}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        <select value="" onChange={(e) => e.target.value && set("viewports", [...sheet.viewports, { viewId: e.target.value }])}>
          <option value="">+ Adicionar vista de documentação…</option>
          {free.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.kind === "planta" ? "planta" : v.kind === "ampliacao" ? "ampliação" : v.kind === "corte" ? "corte" : "3D"})
            </option>
          ))}
        </select>
        <p className="muted small">{SECTION_LABEL.documentacao}: só as disciplinas do projeto, com as de referência em meio-tom. A legenda junta os itens das vistas da folha.</p>
      </section>

      <section className="card">
        <h3>Carimbo</h3>
        <div className="form-grid">
          <label className="span-2">
            Modelo de carimbo
            <select value={sheet.titleBlockId ?? ""} onChange={(e) => set("titleBlockId", e.target.value || null)}>
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
              checked={(isDefault ?? null) === (sheet.titleBlockId ?? null) && isDefault != null}
              onChange={(e) => {
                const id = e.target.checked ? sheet.titleBlockId : null;
                setDefaultTitleBlockId(id);
                setIsDefault(id);
              }}
              disabled={!sheet.titleBlockId}
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
              <input value={sheet.info[k]} onChange={(e) => setInfo(k, e.target.value)} />
            </label>
          ))}
          {extras.map((k) => (
            <label key={k}>
              {k}
              <input value={sheet.info.extras?.[k] ?? ""} onChange={(e) => setExtra(k, e.target.value)} />
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
        <button className="btn" onClick={exportSvg}>
          Exportar SVG
        </button>
        {georef?.map && (
          <select value={dxfCoords} onChange={(e) => setDxfCoords(e.target.value as "projeto" | "mapa")} title="Coordenadas do DXF das plantas">
            <option value="projeto">DXF em coordenadas do projeto (mm)</option>
            <option value="mapa">DXF das plantas em coordenadas do mapa / UTM (m)</option>
          </select>
        )}
      </div>
      {message && <div className="status small">{message}</div>}
      <p className="muted small">O DXF é exportado por vista (botão DXF de cada uma), em escala real. A simbologia elétrica segue a prática baseada na NBR 5444; confira com o padrão gráfico do escritório antes de emitir.</p>
    </div>
  );
}
