// Prancha em SVG (milímetros): planta em escala, legenda e carimbo.
// Formatos e margens conforme a NBR 10068 (série A, horizontal).
import type { LegendItem, PlanDrawing, Prim, SymbolPrim } from "./drawing";
import type { P2 } from "./section";
import { fillTemplate, type TitleBlock } from "./titleBlock";

export type SheetFormat = "A0" | "A1" | "A2" | "A3" | "A4";

export const SHEETS: Record<SheetFormat, { w: number; h: number; margin: number }> = {
  A0: { w: 1189, h: 841, margin: 10 },
  A1: { w: 841, h: 594, margin: 10 },
  A2: { w: 594, h: 420, margin: 7 },
  A3: { w: 420, h: 297, margin: 7 },
  A4: { w: 297, h: 210, margin: 7 },
};
const LEFT_MARGIN = 25; // margem de encadernação
const SIDE_WIDTH = 175; // coluna da legenda e do carimbo
const TITLE_HEIGHT = 50;

export interface SheetInfo {
  projeto: string;
  conteudo: string;
  responsavel: string;
  data: string;
  folha: string;
  revisao: string;
  /** Campos adicionais dos carimbos personalizados ({{nome}}). */
  extras?: Record<string, string>;
}

export interface SheetResult {
  /** Documento SVG completo, com dimensões em mm. */
  svg: string;
  /** Conteúdo interno (sem a tag <svg>), para exibição interativa. */
  inner: string;
  width: number;
  height: number;
  /** A planta coube na área de desenho na escala escolhida. */
  fits: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const FONT = "font-family=\"Arial, Helvetica, sans-serif\"";

export function renderSheet(drawing: PlanDrawing, format: SheetFormat, info: SheetInfo, titleBlock: TitleBlock | null = null): SheetResult {
  const sheet = SHEETS[format];
  const { w, h, margin } = sheet;
  const frame = { x: LEFT_MARGIN, y: margin, w: w - LEFT_MARGIN - margin, h: h - 2 * margin };
  // A0–A2: coluna à direita com legenda (em cima) e carimbo (embaixo).
  // A3–A4: faixa no rodapé com legenda (à esquerda) e carimbo (à direita).
  const column = format === "A0" || format === "A1" || format === "A2";
  // Carimbo personalizado: tamanho do modelo, reduzido se não couber na folha.
  let tbW = SIDE_WIDTH;
  let tbH = TITLE_HEIGHT;
  if (titleBlock) {
    const fit = Math.min(1, (frame.w * (column ? 0.45 : 0.6)) / titleBlock.width, (frame.h * (column ? 0.7 : 0.4)) / titleBlock.height);
    tbW = titleBlock.width * fit;
    tbH = titleBlock.height * fit;
  }
  const sideW = column ? Math.max(tbW, 120) : tbW;
  const bandH = column ? tbH : Math.max(tbH, 30);
  const tb = { x: frame.x + frame.w - tbW, y: frame.y + frame.h - tbH, w: tbW, h: tbH };
  const legendBox = column
    ? { x: frame.x + frame.w - sideW, y: frame.y, w: sideW, h: tb.y - frame.y }
    : { x: frame.x, y: frame.y + frame.h - bandH, w: tb.x - frame.x, h: bandH };
  const area = column
    ? { x: frame.x + 8, y: frame.y + 8, w: legendBox.x - frame.x - 16, h: frame.h - 24 }
    : { x: frame.x + 8, y: frame.y + 8, w: frame.w - 16, h: legendBox.y - frame.y - 24 };
  const captionY = column ? frame.y + frame.h : legendBox.y;
  const k = 1000 / drawing.scale; // mm de papel por metro

  const out: string[] = [];
  out.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`);
  out.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="none" stroke="#000" stroke-width="0.7"/>`);
  out.push(
    column
      ? `<line x1="${f2(legendBox.x)}" y1="${frame.y}" x2="${f2(legendBox.x)}" y2="${frame.y + frame.h}" stroke="#000" stroke-width="0.35"/>`
      : `<line x1="${frame.x}" y1="${f2(legendBox.y)}" x2="${frame.x + frame.w}" y2="${f2(legendBox.y)}" stroke="#000" stroke-width="0.35"/>`,
  );

  // ---- Planta -----------------------------------------------------------------------
  let fits = true;
  if (drawing.bounds) {
    const { min, max } = drawing.bounds;
    const dw = (max[0] - min[0]) * k;
    const dh = (max[1] - min[1]) * k;
    fits = dw <= area.w && dh <= area.h;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const ox = area.x + area.w / 2;
    const oy = area.y + area.h / 2;
    const T = ([x, y]: P2): P2 => [ox + (x - cx) * k, oy - (y - cy) * k];
    out.push(`<g id="planta">${drawing.prims.map((p) => primSvg(p, T, k, drawing.scale)).join("")}</g>`);
    out.push(
      `<text x="${f2(area.x + area.w / 2)}" y="${f2(captionY - 7)}" font-size="4" font-weight="bold" text-anchor="middle" ${FONT}>${esc(`PLANTA — ${drawing.storey}`)}</text>`,
      `<text x="${f2(area.x + area.w / 2)}" y="${f2(captionY - 2.5)}" font-size="2.5" text-anchor="middle" ${FONT}>${esc(`ESCALA 1:${drawing.scale} · corte a ${drawing.cutHeight.toFixed(2).replace(".", ",")} m do piso`)}</text>`,
    );
  }

  // ---- Legenda (em colunas, se preciso) ------------------------------------------------
  const rowH = column ? 7 : 6;
  const colW = column ? legendBox.w : 95;
  const top = legendBox.y + (column ? 10 : 5);
  out.push(`<text x="${legendBox.x + 5}" y="${top}" font-size="${column ? 3.5 : 3}" font-weight="bold" ${FONT}>LEGENDA</text>`);
  const rowsTop = top + 2;
  const perCol = Math.max(1, Math.floor((legendBox.y + legendBox.h - 3 - rowsTop) / rowH));
  const cols = Math.max(1, Math.floor(legendBox.w / colW));
  const capacity = perCol * cols;
  drawing.legend.slice(0, capacity).forEach((item, i) => {
    const cx = legendBox.x + Math.floor(i / perCol) * colW;
    const cy = rowsTop + (i % perCol) * rowH + rowH / 2;
    out.push(legendRow(item, cx + 12, cy, cx + 24));
  });
  if (!drawing.legend.length) {
    out.push(`<text x="${legendBox.x + 5}" y="${f2(rowsTop + 4)}" font-size="2.4" fill="#666" ${FONT}>Sem instalações locadas neste pavimento.</text>`);
  }
  if (drawing.legend.length > capacity) {
    out.push(`<text x="${legendBox.x + legendBox.w - 3}" y="${f2(legendBox.y + legendBox.h - 2)}" font-size="2.2" text-anchor="end" ${FONT}>… ${drawing.legend.length - capacity} item(ns) não couberam</text>`);
  }

  // ---- Carimbo -------------------------------------------------------------------------
  if (titleBlock) {
    out.push(customTitleBlock(titleBlock, tb, { ...info, format, scale: drawing.scale, storey: drawing.storey }));
  } else {
    const rows: [string, string][] = [
      ["PROJETO", info.projeto],
      ["CONTEÚDO", info.conteudo],
      ["RESPONSÁVEL TÉCNICO", info.responsavel],
    ];
    out.push(`<rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${tb.h}" fill="none" stroke="#000" stroke-width="0.5"/>`);
    rows.forEach(([label, value], i) => {
      const ry = tb.y + i * 11;
      out.push(
        `<line x1="${tb.x}" y1="${ry + 11}" x2="${tb.x + tb.w}" y2="${ry + 11}" stroke="#000" stroke-width="0.25"/>`,
        `<text x="${tb.x + 2}" y="${ry + 3.5}" font-size="2" ${FONT}>${label}</text>`,
        `<text x="${tb.x + 2}" y="${ry + 8.8}" font-size="3.4" ${FONT}>${esc(value || "—")}</text>`,
      );
    });
    const cells: [string, string][] = [
      ["ESCALA", `1:${drawing.scale}`],
      ["DATA", info.data],
      ["REVISÃO", info.revisao],
      ["FOLHA", info.folha],
    ];
    const cw = tb.w / cells.length;
    const cy0 = tb.y + 33;
    cells.forEach(([label, value], i) => {
      const cx = tb.x + i * cw;
      if (i) out.push(`<line x1="${cx}" y1="${cy0}" x2="${cx}" y2="${tb.y + tb.h}" stroke="#000" stroke-width="0.25"/>`);
      out.push(
        `<text x="${cx + 2}" y="${cy0 + 3.5}" font-size="2" ${FONT}>${label}</text>`,
        `<text x="${cx + 2}" y="${cy0 + 11}" font-size="3.6" ${FONT}>${esc(value || "—")}</text>`,
      );
    });
  }
  out.push(`<text x="${tb.x + tb.w - 2}" y="${tb.y + tb.h + 4.5}" font-size="2" text-anchor="end" fill="#666" ${FONT}>Gerado pelo SmartEasyBIM · formato ${format}</text>`);

  const inner = out.join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
  return { svg, inner, width: w, height: h, fits };
}

/** Carimbo do usuário: SVG com campos preenchidos, ou imagem, no retângulo do carimbo. */
function customTitleBlock(tbDef: TitleBlock, box: { x: number; y: number; w: number; h: number }, info: SheetInfo & { format: string; scale: number; storey: string }): string {
  const values: Record<string, string> = {
    ...(info.extras ?? {}),
    projeto: info.projeto,
    conteudo: info.conteudo,
    responsavel: info.responsavel,
    data: info.data,
    revisao: info.revisao,
    folha: info.folha,
    escala: `1:${info.scale}`,
    formato: info.format,
    pavimento: info.storey,
  };
  const [vx, vy, vw, vh] = tbDef.viewBox;
  const pos = `x="${f2(box.x)}" y="${f2(box.y)}" width="${f2(box.w)}" height="${f2(box.h)}"`;
  if (tbDef.kind === "image") return `<image ${pos} href="${esc(tbDef.content)}" preserveAspectRatio="xMidYMid meet"/>`;
  return `<svg ${pos} viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" overflow="hidden">${fillTemplate(tbDef.content, values)}</svg>`;
}

function primSvg(p: Prim, T: (q: P2) => P2, k: number, scale: number): string {
  const id = p.id != null ? ` data-id="${p.id}"` : "";
  const dash = "dashdot" in p && p.dashdot ? ` stroke-dasharray="3 0.8 0.6 0.8"` : "dashed" in p && p.dashed ? ` stroke-dasharray="2 1"` : "";
  if (p.t === "line") {
    const [a, b] = [T(p.a), T(p.b)];
    return `<line x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}" stroke="${p.color}" stroke-width="${p.weight}" stroke-linecap="round"${dash}${id}/>`;
  }
  if (p.t === "poly") {
    const pts = p.pts.map((q) => T(q).map(f2).join(",")).join(" ");
    const tag = p.closed ? "polygon" : "polyline";
    return `<${tag} points="${pts}" fill="${p.fill ?? "none"}" stroke="${p.color}" stroke-width="${p.weight}" stroke-linejoin="round"${dash}${id}/>`;
  }
  if (p.t === "circle") {
    const c = T(p.c);
    return `<circle cx="${f2(c[0])}" cy="${f2(c[1])}" r="${f2(p.r * k)}" fill="${p.fill ?? "none"}" stroke="${p.color}" stroke-width="${p.weight}"${id}/>`;
  }
  const at = T(p.p);
  const size = (p.height * 1000) / scale;
  const rot = p.angle ? ` transform="rotate(${f2((-p.angle * 180) / Math.PI)} ${f2(at[0])} ${f2(at[1])})"` : "";
  // Halo branco: mantém o texto legível sobre linhas e hachuras.
  return `<text x="${f2(at[0])}" y="${f2(at[1])}" font-size="${f2(size)}" text-anchor="${p.anchor}" dominant-baseline="central" fill="${p.color}" stroke="#ffffff" stroke-width="${f2(size * 0.3)}" stroke-linejoin="round" paint-order="stroke" ${FONT}${rot}${id}>${esc(p.text)}</text>`;
}

/** Símbolo da legenda (mm, Y para cima) desenhado com centro em (cx, cy). */
function legendSymbol(prims: SymbolPrim[], color: string, cx: number, cy: number, dashed = false, dashdot = false): string {
  const T = ([x, y]: P2): P2 => [cx + x, cy - y];
  const dash = dashdot ? ` stroke-dasharray="3 0.8 0.6 0.8"` : dashed ? ` stroke-dasharray="2 1"` : "";
  return prims
    .map((s) => {
      if (s.t === "line") {
        const [a, b] = [T(s.a), T(s.b)];
        return `<line x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}" stroke="${color}" stroke-width="0.35"${dash}/>`;
      }
      if (s.t === "poly") {
        const pts = s.pts.map((q) => T(q).map(f2).join(",")).join(" ");
        return `<${s.closed ? "polygon" : "polyline"} points="${pts}" fill="${s.fill ? color : "none"}" stroke="${color}" stroke-width="0.25"${dash}/>`;
      }
      if (s.t === "circle") {
        const c = T(s.c);
        return `<circle cx="${f2(c[0])}" cy="${f2(c[1])}" r="${f2(s.r)}" fill="${s.fill ? color : "none"}" stroke="${color}" stroke-width="0.25"/>`;
      }
      const at = T(s.p);
      return `<text x="${f2(at[0])}" y="${f2(at[1])}" font-size="${s.height}" text-anchor="middle" dominant-baseline="central" fill="${color}" ${FONT}>${esc(s.text)}</text>`;
    })
    .join("");
}

function legendRow(item: LegendItem, symX: number, cy: number, textX: number): string {
  return legendSymbol(item.prims, item.color, symX, cy, item.dashed, item.dashdot) + `<text x="${textX}" y="${f2(cy)}" font-size="2.6" dominant-baseline="central" ${FONT}>${esc(item.label)}</text>`;
}
