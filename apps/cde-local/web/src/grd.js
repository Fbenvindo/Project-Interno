// GRD (guia de remessa de documentos) em A4, para imprimir ou salvar em PDF pelo navegador.
// Mesmo layout da GRD do SmartEasyBIM.
const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function grdSvg(e, cfg, estados, finalidadeLabel) {
  const W = 210, H = 297, M = 15;
  const F = 'font-family="Arial, sans-serif"';
  const out = [`<rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" fill="none" stroke="#000" stroke-width="0.4"/>`];
  const t = (x, y, s, size = 3, extra = '') => out.push(`<text x="${x}" y="${y}" font-size="${size}" ${F} ${extra}>${xml(s)}</text>`);
  t(M + 4, M + 10, 'GUIA DE REMESSA DE DOCUMENTOS (GRD)', 5, 'font-weight="bold"');
  t(W - M - 4, M + 10, e.numero, 5, 'text-anchor="end" font-weight="bold"');
  const data = e.data ? new Date(e.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
  [
    ['Projeto', cfg.projeto],
    ['Originador', cfg.originador],
    ['Data', data],
    ['Destinatário', e.destinatario || '—'],
    ['Finalidade', `${e.finalidade} — ${finalidadeLabel(e.finalidade)}`],
    ['Emitido por', e.autor_nome || '—'],
  ].forEach(([k, v], i) => {
    t(M + 4, M + 20 + i * 6, `${k}:`, 3, 'fill="#555"');
    t(M + 34, M + 20 + i * 6, v, 3.2);
  });
  const cols = [62, 54, 12, 24, 10, 18];
  const heads = ['Código', 'Título', 'Rev.', 'Estado', 'Fin.', 'Arquivo'];
  const y = M + 62;
  out.push(`<rect x="${M + 2}" y="${y - 5}" width="${W - 2 * M - 4}" height="7" fill="#e5e7eb"/>`);
  let x = M + 2;
  heads.forEach((h, k) => {
    t(x + 1.5, y, h, 2.8, 'font-weight="bold"');
    x += cols[k];
  });
  const maxRows = Math.floor((H - M - 40 - y) / 6);
  const itens = e.itens || [];
  itens.slice(0, maxRows).forEach((it, i) => {
    const ry = y + (i + 1) * 6;
    out.push(`<line x1="${M + 2}" y1="${ry - 4.5}" x2="${W - M - 2}" y2="${ry - 4.5}" stroke="#bbb" stroke-width="0.2"/>`);
    const ext = (it.arquivo || '').includes('.') ? it.arquivo.split('.').pop().toUpperCase() : '—';
    const vals = [it.codigo, it.titulo.length > 34 ? `${it.titulo.slice(0, 33)}…` : it.titulo, it.revisao, estados[it.estado] || it.estado, it.finalidade, ext];
    let cx = M + 2;
    vals.forEach((v, k) => {
      t(cx + 1.5, ry, v, k === 0 ? 2.5 : 2.7);
      cx += cols[k];
    });
  });
  if (itens.length > maxRows) t(M + 4, y + (maxRows + 1) * 6, `… e mais ${itens.length - maxRows} documento(s)`, 2.7, 'fill="#555"');
  const by = H - M - 30;
  out.push(`<line x1="${M}" y1="${by}" x2="${W - M}" y2="${by}" stroke="#000" stroke-width="0.3"/>`);
  t(M + 4, by + 6, `Observações: ${e.observacoes || '—'}`, 3);
  t(M + 4, by + 22, 'Recebido por: ______________________________     Data: ____/____/______', 3);
  t(W - M - 2, H - M + 5, 'Gerado pelo SmartEasyBIM CDE · ISO 19650', 2.2, 'text-anchor="end" fill="#666"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${out.join('')}</svg>`;
}

/** Abre a GRD numa janela para imprimir/salvar em PDF. */
export function printGrd(svg, title) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${xml(title)}</title><style>@page{size:A4;margin:0}body{margin:0}svg{width:210mm;height:297mm}</style></head><body>${svg}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
