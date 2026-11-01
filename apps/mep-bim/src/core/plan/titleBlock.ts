// Carimbos personalizados: modelo em SVG (desenho vetorial, inclusive convertido de DXF)
// ou imagem, com campos {{nome}} preenchidos a cada folha.

export interface TitleBlock {
  id: string;
  name: string;
  kind: "svg" | "image";
  /** SVG interno (sem a tag <svg>) ou data URL da imagem. */
  content: string;
  /** Sistema de coordenadas do conteúdo (SVG): x, y, largura, altura. */
  viewBox: [number, number, number, number];
  /** Tamanho impresso na folha (mm). */
  width: number;
  height: number;
}

/** Campos preenchidos automaticamente. */
export const STANDARD_FIELDS: { key: string; label: string }[] = [
  { key: "projeto", label: "Projeto" },
  { key: "conteudo", label: "Conteúdo" },
  { key: "responsavel", label: "Responsável técnico" },
  { key: "data", label: "Data" },
  { key: "revisao", label: "Revisão" },
  { key: "folha", label: "Folha" },
  { key: "escala", label: "Escala (automático)" },
  { key: "formato", label: "Formato (automático)" },
  { key: "pavimento", label: "Pavimento (automático)" },
];
const STANDARD = new Set(STANDARD_FIELDS.map((f) => f.key));

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Campos {{nome}} do modelo que não são preenchidos automaticamente (o usuário informa). */
export function extraFields(tb: TitleBlock | null): string[] {
  if (!tb || tb.kind !== "svg") return [];
  const out: string[] = [];
  for (const m of tb.content.matchAll(PLACEHOLDER)) {
    const name = m[1];
    if (!STANDARD.has(norm(name)) && !out.includes(name)) out.push(name);
  }
  return out;
}

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Substitui os campos {{nome}} (sem diferenciar acentos e maiúsculas nos campos padrão). */
export function fillTemplate(content: string, values: Record<string, string>): string {
  const byNorm = new Map(Object.entries(values).map(([k, v]) => [norm(k), v]));
  return content.replace(PLACEHOLDER, (_, name: string) => escXml(values[name] ?? byNorm.get(norm(name)) ?? ""));
}

// ---- Importação de SVG ----------------------------------------------------------------

const toMm = (v: string | undefined): number | null => {
  if (!v) return null;
  const m = v.trim().match(/^([\d.]+)\s*(mm|cm|in|pt|px|m)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? "px";
  return n * ({ mm: 1, cm: 10, m: 1000, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 } as Record<string, number>)[unit];
};

/** Remove scripts e manipuladores de eventos de um SVG de terceiros. */
export function sanitizeSvg(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
}

export function parseSvgTemplate(text: string): Pick<TitleBlock, "content" | "viewBox" | "width" | "height"> {
  const clean = sanitizeSvg(text.replace(/<\?xml[^>]*\?>/g, "").replace(/<!DOCTYPE[^>]*>/gi, ""));
  const open = clean.match(/<svg\b([^>]*)>/i);
  const close = clean.lastIndexOf("</svg>");
  if (!open || close < 0) throw new Error("Arquivo SVG inválido.");
  const attrs = open[1];
  const attr = (name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  const content = clean.slice(open.index! + open[0].length, close);
  const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const wMm = toMm(attr("width"));
  const hMm = toMm(attr("height"));
  let viewBox: [number, number, number, number];
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) viewBox = [vb[0], vb[1], vb[2], vb[3]];
  else if (wMm && hMm) viewBox = [0, 0, Number(attr("width")!.match(/[\d.]+/)![0]), Number(attr("height")!.match(/[\d.]+/)![0])];
  else throw new Error("O SVG precisa de viewBox ou de largura e altura.");
  // Tamanho impresso: o do arquivo (em mm, se houver); senão 175 mm de largura.
  const width = wMm && wMm > 10 ? wMm : 175;
  const height = hMm && wMm && wMm > 10 ? hMm : (width * viewBox[3]) / viewBox[2];
  return { content, viewBox, width: round1(width), height: round1(height) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// ---- Importação de DXF (ASCII) ------------------------------------------------------------

interface Ent {
  type: string;
  codes: [number, string][];
  /** ATTRIB de um INSERT, ou VERTEX de uma POLYLINE. */
  children: Ent[];
}

type M = [number, number, number, number, number, number]; // a b c d e f (x' = a x + c y + e)
const IDENT: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Texto DXF: \U+XXXX, %%c, %%d, %%p e códigos de formatação do MTEXT. */
export function dxfDecodeText(s: string, mtext = false): string {
  let t = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/%%[cC]/g, "Ø").replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±").replace(/%%%/g, "%");
  if (mtext) {
    t = t
      .replace(/\\P/g, "\n")
      .replace(/\\[ACcFfHhQqTtWw][^;]*;/g, "")
      .replace(/\\[LlOoKk]/g, "")
      .replace(/\\S([^;]*);/g, (_, x: string) => x.replace(/[#^]/g, "/"))
      .replace(/\\~/g, " ")
      .replace(/[{}]/g, "")
      .replace(/\\\\/g, "\\");
  }
  return t;
}

function readPairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) throw new Error("Arquivo DXF inválido (use DXF ASCII; DWG não é suportado).");
    out.push([code, lines[i + 1].replace(/\s+$/, "")]);
  }
  return out;
}

/** Agrupa os pares em entidades, ligando VERTEX e ATTRIB ao dono até o SEQEND. */
function entities(pairs: [number, string][], from: number, until: (t: string) => boolean): { list: Ent[]; end: number } {
  const list: Ent[] = [];
  let owner: Ent | null = null;
  let i = from;
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code !== 0) {
      i++;
      continue;
    }
    if (until(value)) break;
    const ent: Ent = { type: value, codes: [], children: [] };
    i++;
    while (i < pairs.length && pairs[i][0] !== 0) ent.codes.push(pairs[i++]);
    if (value === "SEQEND") owner = null;
    else if ((value === "VERTEX" || value === "ATTRIB") && owner) owner.children.push(ent);
    else {
      list.push(ent);
      const flag66 = ent.codes.find((c) => c[0] === 66)?.[1].trim() === "1";
      owner = value === "POLYLINE" || (value === "INSERT" && flag66) ? ent : null;
    }
  }
  return { list, end: i };
}

const get = (e: Ent, code: number, def = 0): number => {
  const v = e.codes.find((c) => c[0] === code)?.[1];
  return v != null && v.trim() !== "" ? Number(v) : def;
};
const getS = (e: Ent, code: number): string | undefined => e.codes.find((c) => c[0] === code)?.[1];
const all = (e: Ent, code: number): number[] => e.codes.filter((c) => c[0] === code).map((c) => Number(c[1]));

export function parseDxfTemplate(text: string): Pick<TitleBlock, "content" | "viewBox" | "width" | "height"> {
  const pairs = readPairs(text);
  // Unidades do desenho ($INSUNITS): convertidas para mm.
  let unit = 1;
  const ins = pairs.findIndex((p) => p[0] === 9 && p[1].trim() === "$INSUNITS");
  if (ins >= 0) unit = ({ 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 } as Record<number, number>)[Number(pairs[ins + 1]?.[1])] ?? 1;

  // Blocos
  const blocks = new Map<string, { base: [number, number]; ents: Ent[] }>();
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === "BLOCK") {
      const head: Ent = { type: "BLOCK", codes: [], children: [] };
      let j = i + 1;
      while (j < pairs.length && pairs[j][0] !== 0) head.codes.push(pairs[j++]);
      const { list, end } = entities(pairs, j, (t) => t === "ENDBLK");
      blocks.set(getS(head, 2) ?? "", { base: [get(head, 10), get(head, 20)], ents: list });
      i = end;
    }
  }
  const start = pairs.findIndex((p, k) => p[0] === 2 && p[1] === "ENTITIES" && pairs[k - 1]?.[1] === "SECTION");
  if (start < 0) throw new Error("O DXF não tem a seção ENTITIES.");
  const { list } = entities(pairs, start + 1, (t) => t === "ENDSEC");

  const out: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // Os limites vêm das linhas do carimbo; os textos só contam se não houver linhas.
  let textOnly = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let inText = false;
  const grow = (x: number, y: number) => {
    if (inText) {
      textOnly = { minX: Math.min(textOnly.minX, x), minY: Math.min(textOnly.minY, y), maxX: Math.max(textOnly.maxX, x), maxY: Math.max(textOnly.maxY, y) };
      return;
    }
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const scaleOf = (m: M) => Math.hypot(m[0], m[1]);
  const width = (e: Ent, m: M) => {
    const lw = get(e, 370, -1);
    return f(Math.max(0.13, lw > 0 ? lw / 100 : 0.25 * Math.min(1, scaleOf(m))));
  };
  // SVG com Y para baixo: o Y do DXF é invertido na saída.
  const P = (m: M, x: number, y: number): [number, number] => {
    const [qx, qy] = apply(m, x, y);
    const [px, py] = [qx * unit, qy * unit];
    grow(px, -py);
    return [px, -py];
  };

  const drawText = (e: Ent, m: M, value: string, mtext: boolean) => {
    if (get(e, 70) & 1 && e.type === "ATTRIB") return; // atributo invisível
    inText = true;
    try {
      drawTextInner(e, m, value, mtext);
    } finally {
      inText = false;
    }
  };
  const drawTextInner = (e: Ent, m: M, value: string, mtext: boolean) => {
    const h = get(e, 40, 2.5) * unit * scaleOf(m);
    const rot = (get(e, 50) * Math.PI) / 180 + Math.atan2(m[1], m[0]);
    let x = get(e, 10);
    let y = get(e, 20);
    let anchor = "start";
    let baseline = "alphabetic";
    if (mtext) {
      const att = get(e, 71, 1);
      anchor = ["start", "middle", "end"][(att - 1) % 3];
      baseline = att <= 3 ? "hanging" : att <= 6 ? "central" : "alphabetic";
      const dx = getS(e, 11);
      if (dx) {
        const ang = Math.atan2(get(e, 21), get(e, 11));
        const [px, py] = P(m, x, y);
        return void emitText(px, py, h, -(ang + Math.atan2(m[1], m[0])), anchor, baseline, value);
      }
    } else {
      const ha = get(e, 72);
      const va = get(e, 73);
      if (ha || va) {
        x = get(e, 11, x);
        y = get(e, 21, y);
        anchor = ha === 1 || ha === 4 ? "middle" : ha === 2 ? "end" : "start";
        baseline = ha === 4 || va === 2 ? "central" : va === 3 ? "hanging" : "alphabetic";
      }
    }
    const [px, py] = P(m, x, y);
    emitText(px, py, h, -rot, anchor, baseline, value);
  };
  const emitText = (x: number, y: number, h: number, rot: number, anchor: string, baseline: string, value: string) => {
    const size = h * 1.4; // altura de maiúscula do DXF → corpo da fonte
    const lines = value.split("\n");
    grow(x + (anchor === "start" ? 1 : anchor === "middle" ? 0.5 : 0) * size * 0.6 * Math.max(...lines.map((l) => l.length)), y);
    const deg = (rot * 180) / Math.PI;
    const tf = Math.abs(deg) > 0.01 ? ` transform="rotate(${f(deg)} ${f(x)} ${f(y)})"` : "";
    const tspans = lines.map((l, i) => `<tspan x="${f(x)}" dy="${i ? f(size * 1.25) : 0}">${escXml(l)}</tspan>`).join("");
    out.push(`<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" text-anchor="${anchor}" dominant-baseline="${baseline}" fill="#000" font-family="Arial, Helvetica, sans-serif"${tf}>${tspans}</text>`);
  };

  const draw = (ents: Ent[], m: M, depth: number) => {
    for (const e of ents) {
      const sw = () => width(e, m);
      switch (e.type) {
        case "LINE": {
          const [a, b] = [P(m, get(e, 10), get(e, 20)), P(m, get(e, 11), get(e, 21))];
          out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#000" stroke-width="${sw()}"/>`);
          break;
        }
        case "LWPOLYLINE": {
          const xs = all(e, 10);
          const ys = all(e, 20);
          const pts = xs.map((x, k) => P(m, x, ys[k]).map(f).join(",")).join(" ");
          const tag = get(e, 70) & 1 ? "polygon" : "polyline";
          out.push(`<${tag} points="${pts}" fill="none" stroke="#000" stroke-width="${sw()}"/>`);
          break;
        }
        case "POLYLINE": {
          const pts = e.children.map((v) => P(m, get(v, 10), get(v, 20)).map(f).join(",")).join(" ");
          const tag = get(e, 70) & 1 ? "polygon" : "polyline";
          if (pts) out.push(`<${tag} points="${pts}" fill="none" stroke="#000" stroke-width="${sw()}"/>`);
          break;
        }
        case "SOLID": {
          const v = [10, 11, 13, 12].map((c) => P(m, get(e, c), get(e, c + 10)).map(f).join(","));
          out.push(`<polygon points="${v.join(" ")}" fill="#000"/>`);
          break;
        }
        case "CIRCLE":
        case "ARC": {
          const r = get(e, 40);
          const cx = get(e, 10);
          const cy = get(e, 20);
          const a0 = e.type === "ARC" ? get(e, 50) : 0;
          let a1 = e.type === "ARC" ? get(e, 51) : 360;
          if (a1 <= a0) a1 += 360;
          const n = Math.max(8, Math.ceil((a1 - a0) / 6));
          const pts: string[] = [];
          for (let k = 0; k <= n; k++) {
            const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
            pts.push(P(m, cx + r * Math.cos(a), cy + r * Math.sin(a)).map(f).join(","));
          }
          out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#000" stroke-width="${sw()}"/>`);
          break;
        }
        case "TEXT":
        case "ATTRIB":
          drawText(e, m, dxfDecodeText(getS(e, 1) ?? ""), false);
          break;
        case "MTEXT": {
          const raw = [...e.codes.filter((c) => c[0] === 3).map((c) => c[1]), getS(e, 1) ?? ""].join("");
          drawText(e, m, dxfDecodeText(raw, true), true);
          break;
        }
        case "INSERT": {
          const b = blocks.get(getS(e, 2) ?? "");
          if (b && depth < 8) {
            const sx = get(e, 41, 1);
            const sy = get(e, 42, 1);
            const r = (get(e, 50) * Math.PI) / 180;
            const [c, s] = [Math.cos(r), Math.sin(r)];
            const local: M = mul([c * sx, s * sx, -s * sy, c * sy, get(e, 10), get(e, 20)], [1, 0, 0, 1, -b.base[0], -b.base[1]]);
            draw(b.ents.filter((x) => x.type !== "ATTDEF"), mul(m, local), depth + 1);
          }
          draw(e.children, m, depth + 1);
          break;
        }
      }
    }
  };
  draw(list, IDENT, 0);
  if (!Number.isFinite(minX)) ({ minX, minY, maxX, maxY } = textOnly);
  if (!out.length || !Number.isFinite(minX)) throw new Error("Nenhuma entidade desenhável no DXF.");
  const pad = 0.5;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  return { content: out.join(""), viewBox: [minX - pad, minY - pad, w, h], width: round1(w), height: round1(h) };
}
