// Relatório da análise de interferências (A4), para imprimir ou salvar em PDF pelo navegador:
// resumo, modelos e regras, e cada interferência com a imagem do visualizador.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cm = (m) => `${(Math.abs(m) * 100).toFixed(1).replace('.', ',')} cm`;
export const ifcCoords = (p) => [p[0], -p[2], p[1]];
export const fmtCoords = (p) => ifcCoords(p).map((v) => v.toFixed(3).replace('.', ',')).join(' · ');
export const typeLabel = (t) => String(t || '').replace(/^IFC/, '');
export const clashMeasure = (c) => (c.tipo === 'colisao' ? `sobreposição ~${cm(c.distancia)}` : `distância ${cm(c.distancia)}`);

/** items: [{ clash, image }]. */
/** `win`: janela já aberta no clique (o navegador bloqueia janelas abertas depois de esperar). */
export function openReport({ win, empreendimento, analise, items, estados, filtroTexto }) {
  const w = win || window.open('', '_blank');
  if (!w) throw new Error('O navegador bloqueou a janela do relatório: permita pop-ups para este endereço.');
  const cfg = analise.config;
  const count = (fn) => items.filter((i) => fn(i.clash)).length;
  const byState = Object.entries(estados)
    .map(([k, l]) => `${esc(l)}: <b>${count((c) => c.estado === k)}</b>`)
    .join(' · ');
  const side = (ids) =>
    analise.modelos
      .filter((m) => ids.includes(m.documento_id))
      .map((m) => `${esc(m.codigo)} <span class="muted">(${esc(m.revisao)}${m.estado === 'andamento' ? ', em andamento' : ''})</span>`)
      .join('<br>');
  const rules = [cfg.colisao && `Colisão física (tolerância ${cm(cfg.tolerancia)})`, cfg.folga && `Folga mínima de ${cm(cfg.distancia)}`].filter(Boolean).join(' · ');
  const el = (e) => `<b>${esc(e.nome)}</b> <span class="muted">${esc(typeLabel(e.tipo))}</span><br><span class="small">${esc(e.codigo)}${e.pavimento ? ` · ${esc(e.pavimento)}` : ''}</span>`;
  const cards = items
    .map(
      ({ clash: c, image }) => `
    <div class="card">
      ${image ? `<img src="${image}">` : '<div class="noimg">sem imagem</div>'}
      <div class="info">
        <div class="title">#${c.numero} · ${c.tipo === 'colisao' ? 'Colisão' : 'Folga'} <span class="tag ${c.estado}">${esc(estados[c.estado] || c.estado)}</span></div>
        <table>
          <tr><th style="color:#dc2626">A</th><td>${el(c.a)}</td></tr>
          <tr><th style="color:#2563eb">B</th><td>${el(c.b)}</td></tr>
          <tr><th>Medida</th><td>${esc(clashMeasure(c))}</td></tr>
          <tr><th>Ponto (IFC)</th><td>${esc(fmtCoords(c.ponto))} m</td></tr>
          ${c.grupo_nome ? `<tr><th>Grupo</th><td>${esc(c.grupo_nome)}</td></tr>` : ''}
          <tr><th>Responsável</th><td>${esc(c.responsavel_nome || '—')}</td></tr>
          ${(c.comentarios || []).filter((k) => k.origem !== 'sistema').slice(-3).map((k) => `<tr><th>Comentário</th><td>${esc(k.texto)} <span class="small muted">— ${esc(k.autor)}, ${new Date(k.created_at).toLocaleDateString('pt-BR')}</span></td></tr>`).join('')}
        </table>
      </div>
    </div>`,
    )
    .join('');
  w.document.open();
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Interferências — ${esc(analise.nome)}</title>
<style>
@page { size: A4; margin: 12mm; }
body { font: 10pt Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 2mm; }
.muted { color: #666; } .small { font-size: 8.5pt; }
.head { border-bottom: 1px solid #000; padding-bottom: 3mm; margin-bottom: 4mm; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; margin-top: 2mm; }
.card { display: flex; gap: 4mm; border: 1px solid #ccc; padding: 3mm; margin-bottom: 3mm; break-inside: avoid; }
.card img, .noimg { width: 85mm; height: 56mm; object-fit: cover; border: 1px solid #ddd; background: #f3f4f6; }
.noimg { display: flex; align-items: center; justify-content: center; color: #999; }
.info { flex: 1; } .title { font-weight: bold; font-size: 11pt; margin-bottom: 2mm; }
table { border-collapse: collapse; width: 100%; } th { text-align: left; vertical-align: top; width: 24mm; color: #555; font-weight: normal; padding: 0.6mm 0; } td { padding: 0.6mm 0; }
.tag { font-size: 8pt; font-weight: normal; padding: 0.3mm 2mm; border-radius: 3mm; background: #eee; }
.tag.nova { background: #fee2e2; } .tag.ativa { background: #fef3c7; } .tag.resolvida { background: #dcfce7; } .tag.aprovada { background: #e0e7ff; }
</style></head><body>
<div class="head">
  <h1>Relatório de interferências — ${esc(analise.nome)}</h1>
  <div class="muted">${esc(empreendimento?.nome || '')} · análise de ${new Date(analise.concluida_at || analise.created_at).toLocaleString('pt-BR')} · emitido em ${new Date().toLocaleString('pt-BR')}</div>
  <div class="grid">
    <div><b>Lado A</b><br>${side(cfg.ladoA)}</div>
    <div><b>Lado B</b><br>${side(cfg.ladoB)}</div>
    <div><b>Regras</b><br>${esc(rules)}</div>
    <div><b>Interferências no relatório: ${items.length}</b>${filtroTexto ? ` <span class="muted">(${esc(filtroTexto)})</span>` : ''}<br>${byState}</div>
  </div>
</div>
${cards || '<p>Nenhuma interferência.</p>'}
<script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
</body></html>`);
  w.document.close();
}
