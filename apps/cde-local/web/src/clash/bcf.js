// BCF 2.1 (BIM Collaboration Format): exporta as interferências como tópicos (com ponto de vista,
// elementos pelo GlobalId e imagem) para Revit, Navisworks, Solibri, BIMcollab…, e lê de volta o
// status e os comentários feitos nesses softwares.
import { strToU8, unzipSync, zipSync } from 'fflate';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Estado do CDE → TopicStatus do BCF. */
export const BCF_STATUS = { nova: 'Open', ativa: 'In Progress', resolvida: 'Resolved', aprovada: 'Closed' };

const v3 = (tag, p) => `<${tag}><X>${p[0]}</X><Y>${p[1]}</Y><Z>${p[2]}</Z></${tag}>`;
/** Cena (Y para cima) → IFC (Z para cima). */
const toIfc = (p) => [p[0], -p[2], p[1]];

function dataUrlBytes(url) {
  const b64 = url.split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * items: [{ clash, image (data URL PNG), camera: { pos, target } (cena, absolutas) }].
 * users: [{ id, name, email }] (responsável → AssignedTo).
 */
export function buildBcf({ empreendimento, analise, items, users, author }) {
  const files = {
    'bcf.version': strToU8(`${XML}<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>`),
    'project.bcfp': strToU8(`${XML}<ProjectExtension><Project ProjectId="${crypto.randomUUID()}"><Name>${esc(empreendimento?.nome || 'Empreendimento')}</Name></Project><ExtensionSchema></ExtensionSchema></ProjectExtension>`),
  };
  const email = new Map(users.map((u) => [u.id, u.email || u.name]));
  const now = new Date().toISOString();
  for (const { clash: c, image, camera } of items) {
    const g = c.guid;
    const vp = crypto.randomUUID();
    const kind = c.tipo === 'colisao' ? 'Colisão' : 'Folga';
    const desc = [
      `${kind} entre ${c.a.nome} (${c.a.tipo}, ${c.a.codigo}) e ${c.b.nome} (${c.b.tipo}, ${c.b.codigo}).`,
      c.tipo === 'colisao' ? `Sobreposição aproximada: ${(Math.abs(c.distancia) * 100).toFixed(1)} cm.` : `Distância: ${(c.distancia * 100).toFixed(1)} cm.`,
      c.pavimento ? `Pavimento: ${c.pavimento}.` : '',
      `Análise: ${analise.nome} (CDE).`,
    ]
      .filter(Boolean)
      .join(' ');
    const comments = (c.comentarios || [])
      .map(
        (k) =>
          `<Comment Guid="${esc(k.bcf_guid || crypto.randomUUID())}"><Date>${esc(new Date(k.created_at).toISOString())}</Date><Author>${esc(k.autor || 'CDE')}</Author><Comment>${esc(k.texto)}</Comment><Viewpoint Guid="${vp}"/></Comment>`,
      )
      .join('');
    const markup = `${XML}<Markup>
<Topic Guid="${esc(g)}" TopicType="Clash" TopicStatus="${BCF_STATUS[c.estado] || 'Open'}">
<Title>${esc(`#${c.numero} ${kind}: ${c.a.nome} × ${c.b.nome}`)}</Title>
<Labels>${esc(c.tipo === 'colisao' ? 'Colisão' : 'Folga')}</Labels>
${c.pavimento ? `<Labels>${esc(c.pavimento)}</Labels>` : ''}
<CreationDate>${esc(new Date(analise.concluida_at || analise.created_at || now).toISOString())}</CreationDate>
<CreationAuthor>${esc(author || 'CDE')}</CreationAuthor>
<ModifiedDate>${esc(new Date(c.updated_at || now).toISOString())}</ModifiedDate>
${c.responsavel_id ? `<AssignedTo>${esc(email.get(c.responsavel_id) || c.responsavel_nome)}</AssignedTo>` : ''}
<Description>${esc(desc)}</Description>
</Topic>
${comments}
<Viewpoints Guid="${vp}"><Viewpoint>viewpoint.bcfv</Viewpoint>${image ? '<Snapshot>snapshot.png</Snapshot>' : ''}</Viewpoints>
</Markup>`;
    const comp = (e) => (e.globalId ? `<Component IfcGuid="${esc(e.globalId)}"/>` : '');
    let view = '';
    if (camera) {
      const pos = toIfc(camera.pos);
      const tgt = toIfc(camera.target);
      const d = [tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]];
      const l = Math.hypot(...d) || 1;
      view = `<PerspectiveCamera>${v3('CameraViewPoint', pos)}${v3('CameraDirection', d.map((x) => x / l))}${v3('CameraUpVector', [0, 0, 1])}<FieldOfView>45</FieldOfView></PerspectiveCamera>`;
    }
    const viewpoint = `${XML}<VisualizationInfo Guid="${vp}"><Components><Selection>${comp(c.a)}${comp(c.b)}</Selection><Visibility DefaultVisibility="true"/><Coloring><Color Color="FFEF4444">${comp(c.a)}</Color><Color Color="FF2563EB">${comp(c.b)}</Color></Coloring></Components>${view}</VisualizationInfo>`;
    files[`${g}/markup.bcf`] = strToU8(markup);
    files[`${g}/viewpoint.bcfv`] = strToU8(viewpoint);
    if (image) files[`${g}/snapshot.png`] = dataUrlBytes(image);
  }
  return zipSync(files, { level: 6 });
}

/** Lê um arquivo BCF (2.0/2.1/3.0): tópicos com GUID, status e comentários. */
export function readBcf(bytes) {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const topics = [];
  const parser = new DOMParser();
  const text = (el, tag) => el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  for (const [name, data] of Object.entries(files)) {
    if (!/(^|\/)markup\.bcf$/i.test(name)) continue;
    const doc = parser.parseFromString(new TextDecoder().decode(data), 'application/xml');
    const topic = doc.getElementsByTagName('Topic')[0];
    if (!topic) continue;
    const comentarios = [...doc.getElementsByTagName('Comment')]
      .filter((k) => k.getAttribute('Guid'))
      .map((k) => ({ guid: k.getAttribute('Guid'), data: text(k, 'Date'), autor: text(k, 'Author'), texto: k.getElementsByTagName('Comment')[0]?.textContent?.trim() || '' }))
      .filter((k) => k.texto);
    topics.push({ guid: topic.getAttribute('Guid'), status: topic.getAttribute('TopicStatus') || text(topic, 'TopicStatus'), titulo: text(topic, 'Title'), comentarios });
  }
  if (!topics.length) throw new Error('Nenhum tópico encontrado: o arquivo não parece ser um BCF.');
  return topics;
}

export function downloadBytes(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
