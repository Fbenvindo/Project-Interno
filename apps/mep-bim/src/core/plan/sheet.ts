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

/** Vista posicionada na folha. */
export interface SheetViewport {
  id: string;
  /** Título (ex.: "PLANTA — Pavimento tipo") e subtítulo (escala, corte…). */
  title: string;
  subtitle?: string;
  /** Desenho vetorial (planta, ampliação, corte). */
  drawing?: PlanDrawing;
  /** Imagem (vista 3D): data URL, proporção largura/altura e largura na folha (mm). */
  image?: { href: string; aspect: number; widthMm: number };
  /** Centro da vista na folha (mm); ausente = posição automática. */
  pos?: [number, number];
}

export interface PlacedViewport {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Folha com uma planta só (compatível com as versões anteriores). */
export function renderSheet(drawing: PlanDrawing, format: SheetFormat, info: SheetInfo, titleBlock: TitleBlock | null = null, northDeg: number | null = null): SheetResult {
  return renderSheetViews(
    [
      {
        id: "planta",
        title: `PLANTA — ${drawing.storey}`,
        subtitle: `ESCALA 1:${drawing.scale} · corte a ${drawing.cutHeight.toFixed(2).replace(".", ",")} m do piso`,
        drawing,
      },
    ],
    format,
    info,
    titleBlock,
    northDeg,
  );
}

const CAPTION = 11; // espaço do título abaixo de cada vista (mm)
const GAP = 10;

export function renderSheetViews(
  viewports: SheetViewport[],
  format: SheetFormat,
  info: SheetInfo,
  titleBlock: TitleBlock | null = null,
  northDeg: number | null = null,
): SheetResult & { viewports: PlacedViewport[] } {
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

  const out: string[] = [];
  out.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`);
  out.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="none" stroke="#000" stroke-width="0.7"/>`);
  out.push(
    column
      ? `<line x1="${f2(legendBox.x)}" y1="${frame.y}" x2="${f2(legendBox.x)}" y2="${frame.y + frame.h}" stroke="#000" stroke-width="0.35"/>`
      : `<line x1="${frame.x}" y1="${f2(legendBox.y)}" x2="${frame.x + frame.w}" y2="${f2(legendBox.y)}" stroke="#000" stroke-width="0.35"/>`,
  );

  // ---- Vistas ---------------------------------------------------------------------------
  // Tamanho de cada vista no papel (desenho em escala ou imagem) e posição: a escolhida pelo
  // usuário ou, sem ela, em fileiras da esquerda para a direita, de cima para baixo.
  const sized = viewports.map((vp) => {
    if (vp.drawing?.bounds) {
      const k = 1000 / vp.drawing.scale;
      const { min, max } = vp.drawing.bounds;
      return { vp, w: (max[0] - min[0]) * k, h: (max[1] - min[1]) * k };
    }
    if (vp.image) return { vp, w: vp.image.widthMm, h: vp.image.widthMm / vp.image.aspect };
    return { vp, w: 40, h: 20 };
  });
  const placed: PlacedViewport[] = [];
  let fits = true;
  if (sized.length === 1 && !sized[0].vp.pos) {
    const s0 = sized[0];
    placed.push({ id: s0.vp.id, x: area.x + area.w / 2 - s0.w / 2, y: area.y + area.h / 2 - s0.h / 2, w: s0.w, h: s0.h });
    fits = s0.w <= area.w && s0.h <= area.h;
  } else {
    let cx = area.x;
    let cy = area.y;
    let rowH = 0;
    for (const s1 of sized) {
      if (s1.vp.pos) {
        placed.push({ id: s1.vp.id, x: s1.vp.pos[0] - s1.w / 2, y: s1.vp.pos[1] - s1.h / 2, w: s1.w, h: s1.h });
        continue;
      }
      if (cx > area.x && cx + s1.w > area.x + area.w) {
        cx = area.x;
        cy += rowH + CAPTION + GAP;
        rowH = 0;
      }
      placed.push({ id: s1.vp.id, x: cx, y: cy, w: s1.w, h: s1.h });
      cx += s1.w + GAP;
      rowH = Math.max(rowH, s1.h);
    }
    fits = placed.every((p) => p.x >= area.x - 0.5 && p.y >= area.y - 0.5 && p.x + p.w <= area.x + area.w + 0.5 && p.y + p.h + CAPTION <= area.y + area.h + CAPTION + 0.5);
  }
  sized.forEach(({ vp }, i) => {
    const r = placed[i];
    const parts: string[] = [];
    if (vp.drawing?.bounds) {
      const d = vp.drawing;
      const k = 1000 / d.scale;
      const { min, max } = d.bounds!;
      const T = ([x, y]: P2): P2 => [r.x + (x - min[0]) * k, r.y + (max[1] - y) * k];
      parts.push(d.prims.map((p) => primSvg(p, T, k, d.scale)).join(""));
    } else if (vp.image) {
      parts.push(`<image x="${f2(r.x)}" y="${f2(r.y)}" width="${f2(r.w)}" height="${f2(r.h)}" href="${esc(vp.image.href)}" preserveAspectRatio="xMidYMid meet"/>`);
      parts.push(`<rect x="${f2(r.x)}" y="${f2(r.y)}" width="${f2(r.w)}" height="${f2(r.h)}" fill="none" stroke="#000" stroke-width="0.18"/>`);
    }
    // Uma vista só: título no rodapé da área (como antes); várias: abaixo de cada uma.
    const single = viewports.length === 1 && !vp.pos;
    const tx = single ? area.x + area.w / 2 : r.x + r.w / 2;
    const ty = single ? captionY - 7 : r.y + r.h + 5;
    parts.push(
      `<text x="${f2(tx)}" y="${f2(ty)}" font-size="4" font-weight="bold" text-anchor="middle" ${FONT}>${esc(vp.title)}</text>`,
      vp.subtitle ? `<text x="${f2(tx)}" y="${f2(ty + 4.5)}" font-size="2.5" text-anchor="middle" ${FONT}>${esc(vp.subtitle)}</text>` : "",
    );
    if (!single) parts.push(`<line x1="${f2(tx - 25)}" y1="${f2(ty + 1)}" x2="${f2(tx + 25)}" y2="${f2(ty + 1)}" stroke="#000" stroke-width="0.35"/>`);
    out.push(`<g id="${i === 0 ? "planta" : `vista-${i}`}" data-vp="${esc(vp.id)}">${parts.join("")}</g>`);
  });
  const drawings = viewports.map((v) => v.drawing).filter((d): d is PlanDrawing => !!d);
  const scales = [...new Set(drawings.map((d) => d.scale))];
  const legendItems = [...new Map(drawings.flatMap((d) => d.legend).map((l) => [l.key, l])).values()];
  const drawing = { legend: legendItems, scale: scales.length === 1 ? scales[0] : 0, storey: drawings[0]?.storey ?? "", bounds: placed.length ? { min: [0, 0] as P2, max: [1, 1] as P2 } : null };
  const scaleText = drawing.scale ? `1:${drawing.scale}` : "INDICADAS";

  // ---- Norte verdadeiro (ângulo a partir do +Y do projeto, anti-horário) -------------------
  if (northDeg != null && drawing.bounds) {
    const cx = area.x + area.w - 10;
    const cy = area.y + 10;
    const a = (northDeg * Math.PI) / 180;
    // No papel, +Y do projeto é para cima; o ângulo gira no sentido anti-horário.
    const ux = -Math.sin(a);
    const uy = -Math.cos(a);
    const tip: P2 = [cx + ux * 7, cy + uy * 7];
    const tail: P2 = [cx - ux * 5, cy - uy * 5];
    const side = (s: number): P2 => [cx + -uy * 2.2 * s - ux * 2, cy + ux * 2.2 * s - uy * 2];
    out.push(
      `<g id="norte"><circle cx="${f2(cx)}" cy="${f2(cy)}" r="8" fill="none" stroke="#000" stroke-width="0.25"/>`,
      `<line x1="${f2(tail[0])}" y1="${f2(tail[1])}" x2="${f2(tip[0])}" y2="${f2(tip[1])}" stroke="#000" stroke-width="0.35"/>`,
      `<polygon points="${[tip, side(1), [cx, cy] as P2, side(-1)].map((p) => p.map(f2).join(",")).join(" ")}" fill="#000"/>`,
      `<text x="${f2(cx + ux * 11)}" y="${f2(cy + uy * 11)}" font-size="3.5" font-weight="bold" text-anchor="middle" dominant-baseline="central" ${FONT}>N</text></g>`,
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
    out.push(`<text x="${legendBox.x + 5}" y="${f2(rowsTop + 4)}" font-size="2.4" fill="#666" ${FONT}>Sem instalações nas vistas desta folha.</text>`);
  }
  if (drawing.legend.length > capacity) {
    out.push(`<text x="${legendBox.x + legendBox.w - 3}" y="${f2(legendBox.y + legendBox.h - 2)}" font-size="2.2" text-anchor="end" ${FONT}>… ${drawing.legend.length - capacity} item(ns) não couberam</text>`);
  }

  // ---- Carimbo -------------------------------------------------------------------------
  if (titleBlock) {
    out.push(customTitleBlock(titleBlock, tb, { ...info, format, scale: scaleText, storey: drawing.storey }));
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
      ["ESCALA", scaleText],
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
  return { svg, inner, width: w, height: h, fits, viewports: placed };
}

/** Carimbo do usuário: SVG com campos preenchidos, ou imagem, no retângulo do carimbo. */
function customTitleBlock(tbDef: TitleBlock, box: { x: number; y: number; w: number; h: number }, info: SheetInfo & { format: string; scale: string; storey: string }): string {
  const values: Record<string, string> = {
    ...(info.extras ?? {}),
    projeto: info.projeto,
    conteudo: info.conteudo,
    responsavel: info.responsavel,
    data: info.data,
    revisao: info.revisao,
    folha: info.folha,
    escala: info.scale,
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
