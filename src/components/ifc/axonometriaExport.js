import * as THREE from 'three';

// Exportação das vistas do visualizador: PNG, PDF (A3 com carimbo e escala) e BCF 2.1.
// O BCF (BIM Collaboration Format) é o formato padrão para levar uma vista para outro
// programa BIM: câmera, planos de corte, elementos visíveis/selecionados (por GUID IFC) e
// imagem. No Revit ele abre pelos plugins de BCF (BIMcollab, Revizto, Autodesk Docs/ACC).

const ESCALAS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 750, 1000, 1250, 2000, 2500, 5000];

const nomeArquivo = (s) => String(s || 'vista').replace(/\.ifc$/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9-_ ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'vista';

const baixar = (blob, nome) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const dataUrlParaBytes = (dataUrl) => {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// Tudo que uma vista precisa para ser exportada ou restaurada, capturado no momento em que é salva
export function capturarVista(engine, { nome, nivelNome, selecionado }) {
  const estado = engine.estadoVista();
  const imagem = engine.capturarImagem(2);
  const cam = engine.camera;
  cam.updateMatrixWorld(true);
  const direcao = new THREE.Vector3();
  cam.getWorldDirection(direcao);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const visiveis = engine.idsVisiveis();
  const conjuntoVisiveis = new Set(visiveis);
  const totalComGeometria = engine.meshesById.size;
  return {
    id: crypto.randomUUID(),
    nome,
    criadaEm: new Date().toISOString(),
    nivelNome,
    estado,
    imagem,
    alturaVisivel: estado.projecao === 'ortografica' ? engine.alturaVisivelOrtho() : null,
    bcf: {
      ortografica: estado.projecao === 'ortografica',
      ponto: engine.paraCoordenadasIfc(cam.position),
      direcao: engine.direcaoParaIfc(direcao),
      up: engine.direcaoParaIfc(up),
      escala: estado.projecao === 'ortografica' ? engine.alturaVisivelOrtho() : null,
      fov: estado.projecao === 'ortografica' ? null : cam.fov,
      cortes: engine.planosCorte.map((p) => {
        const ponto = p.coplanarPoint(new THREE.Vector3());
        // No BCF a direção aponta para o lado que fica oculto (o oposto da normal do three.js)
        return { local: engine.paraCoordenadasIfc(ponto), direcao: engine.direcaoParaIfc(p.normal.clone().negate()) };
      }),
      visiveis: visiveis.map((id) => engine.globalIdDe(id)).filter(Boolean),
      ocultos: totalComGeometria - visiveis.length,
      ocultosGuids: totalComGeometria - visiveis.length < visiveis.length
        ? [...engine.meshesById.keys()].filter((id) => !conjuntoVisiveis.has(id)).map((id) => engine.globalIdDe(id)).filter(Boolean)
        : null,
      selecao: selecionado != null ? [engine.globalIdDe(selecionado)].filter(Boolean) : [],
    },
  };
}

export function exportarPng(vista, arquivo) {
  baixar(new Blob([dataUrlParaBytes(vista.imagem.dataUrl)], { type: 'image/png' }), `${nomeArquivo(arquivo)} - ${nomeArquivo(vista.nome)}.png`);
}

// Uma página A3 paisagem por vista, com carimbo e escala (nas vistas ortográficas)
export async function exportarPdf(vistas, arquivo) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const W = 420;
  const H = 297;
  const margem = 10;
  const alturaCarimbo = 28;
  vistas.forEach((vista, i) => {
    if (i > 0) pdf.addPage('a3', 'landscape');
    const areaL = W - 2 * margem;
    const areaA = H - 2 * margem - alturaCarimbo - 4;
    const { largura, altura, dataUrl } = vista.imagem;
    let fator = Math.min(areaL / largura, areaA / altura);
    let escalaTexto = 'Sem escala (perspectiva)';
    if (vista.alturaVisivel) {
      // Ajusta a imagem para cair exatamente numa escala padrão
      const exata = (vista.alturaVisivel * 1000) / (altura * fator);
      const padrao = ESCALAS.find((e) => e >= exata) || Math.ceil(exata / 100) * 100;
      fator *= exata / padrao;
      const axo = !/Elevação|Planta/.test(vista.nome);
      escalaTexto = `1:${padrao}${axo ? ' (no plano da vista)' : ''}`;
    }
    const iw = largura * fator;
    const ih = altura * fator;
    pdf.addImage(dataUrl, 'PNG', margem + (areaL - iw) / 2, margem + (areaA - ih) / 2, iw, ih);

    pdf.setDrawColor(30, 41, 59);
    pdf.setLineWidth(0.5);
    pdf.rect(margem, margem, W - 2 * margem, H - 2 * margem);
    const yc = H - margem - alturaCarimbo;
    pdf.line(margem, yc, W - margem, yc);
    const colunas = [margem, margem + 150, margem + 250, margem + 320, W - margem];
    colunas.slice(1, -1).forEach((x) => pdf.line(x, yc, x, H - margem));
    const campo = (x, rotulo, valor) => {
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text(rotulo.toUpperCase(), x + 3, yc + 6);
      pdf.setFontSize(11);
      pdf.setTextColor(15, 23, 42);
      pdf.text(pdf.splitTextToSize(String(valor || '—'), colunas[colunas.indexOf(x) + 1] - x - 6).slice(0, 2), x + 3, yc + 13);
    };
    campo(colunas[0], 'Vista', vista.nome);
    campo(colunas[1], 'Nível', vista.nivelNome || 'Todos');
    campo(colunas[2], 'Escala', escalaTexto);
    campo(colunas[3], 'Data', new Date(vista.criadaEm).toLocaleDateString('pt-BR'));
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Modelo: ${arquivo} · gerado pelo Project Interno a partir do IFC`, margem + 3, H - margem - 3);

    if (/Planta/.test(vista.nome)) {
      // Seta do norte de projeto
      const x = W - margem - 15;
      const y = margem + 20;
      pdf.setFillColor(15, 23, 42);
      pdf.triangle(x, y - 10, x - 4, y + 4, x + 4, y + 4, 'F');
      pdf.setFontSize(10);
      pdf.setTextColor(15, 23, 42);
      pdf.text('N', x - 1.5, y + 10);
      pdf.setFontSize(6);
      pdf.text('norte de projeto', x - 8, y + 14);
    }
  });
  pdf.save(`${nomeArquivo(arquivo)} - vistas.pdf`);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const vecXml = (tag, v) => `<${tag}><X>${v[0].toFixed(6)}</X><Y>${v[1].toFixed(6)}</Y><Z>${v[2].toFixed(6)}</Z></${tag}>`;

function viewpointXml(vista, guidViewpoint) {
  const b = vista.bcf;
  const componentes = (guids) => guids.map((g) => `<Component IfcGuid="${xmlEsc(g)}"/>`).join('');
  // Lista a menor das duas: os visíveis (padrão oculto) ou os ocultos (padrão visível)
  const visibilidade = b.ocultosGuids
    ? `<Visibility DefaultVisibility="true">${b.ocultosGuids.length ? `<Exceptions>${componentes(b.ocultosGuids)}</Exceptions>` : ''}</Visibility>`
    : `<Visibility DefaultVisibility="false"><Exceptions>${componentes(b.visiveis)}</Exceptions></Visibility>`;
  const camera = b.ortografica
    ? `<OrthogonalCamera>${vecXml('CameraViewPoint', b.ponto)}${vecXml('CameraDirection', b.direcao)}${vecXml('CameraUpVector', b.up)}<ViewToWorldScale>${b.escala.toFixed(6)}</ViewToWorldScale></OrthogonalCamera>`
    : `<PerspectiveCamera>${vecXml('CameraViewPoint', b.ponto)}${vecXml('CameraDirection', b.direcao)}${vecXml('CameraUpVector', b.up)}<FieldOfView>${b.fov.toFixed(3)}</FieldOfView></PerspectiveCamera>`;
  const cortes = b.cortes.length
    ? `<ClippingPlanes>${b.cortes.map((c) => `<ClippingPlane>${vecXml('Location', c.local)}${vecXml('Direction', c.direcao)}</ClippingPlane>`).join('')}</ClippingPlanes>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${guidViewpoint}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<Components><ViewSetupHints SpacesVisible="false" SpaceBoundariesVisible="false" OpeningsVisible="false"/>${b.selecao.length ? `<Selection>${componentes(b.selecao)}</Selection>` : ''}${visibilidade}</Components>
${camera}
${cortes}
</VisualizationInfo>
`;
}

function markupXml(vista, { guidTopico, guidViewpoint, arquivo, ifcProjeto, autor }) {
  const data = new Date(vista.criadaEm).toISOString();
  const descricao = [
    vista.nivelNome ? `Nível: ${vista.nivelNome}` : null,
    vista.estado.explosao ? 'Vista explodida no Project Interno (o BCF leva só câmera, corte e visibilidade)' : null,
  ].filter(Boolean).join('. ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<Header><File${ifcProjeto ? ` IfcProject="${xmlEsc(ifcProjeto)}"` : ''} isExternal="true"><Filename>${xmlEsc(arquivo)}</Filename><Date>${data}</Date></File></Header>
<Topic Guid="${guidTopico}" TopicType="Information" TopicStatus="Open">
<Title>${xmlEsc(vista.nome)}</Title>
<CreationDate>${data}</CreationDate>
<CreationAuthor>${xmlEsc(autor || 'Project Interno')}</CreationAuthor>
${descricao ? `<Description>${xmlEsc(descricao)}</Description>` : ''}
</Topic>
<Viewpoints Guid="${guidViewpoint}"><Viewpoint>viewpoint.bcfv</Viewpoint><Snapshot>snapshot.png</Snapshot></Viewpoints>
</Markup>
`;
}

// Um tópico BCF por vista, todos num único .bcfzip
export async function exportarBcf(vistas, { arquivo, ifcProjeto, autor }) {
  const { zipSync, strToU8 } = await import('fflate');
  const entradas = {
    'bcf.version': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><DetailedVersion>2.1</DetailedVersion></Version>\n'),
  };
  for (const vista of vistas) {
    const guidTopico = crypto.randomUUID();
    const guidViewpoint = crypto.randomUUID();
    entradas[`${guidTopico}/markup.bcf`] = strToU8(markupXml(vista, { guidTopico, guidViewpoint, arquivo, ifcProjeto, autor }));
    entradas[`${guidTopico}/viewpoint.bcfv`] = strToU8(viewpointXml(vista, guidViewpoint));
    entradas[`${guidTopico}/snapshot.png`] = dataUrlParaBytes(vista.imagem.dataUrl);
  }
  baixar(new Blob([zipSync(entradas, { level: 6 })], { type: 'application/octet-stream' }), `${nomeArquivo(arquivo)} - vistas.bcfzip`);
}
