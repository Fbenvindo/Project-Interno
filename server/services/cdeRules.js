// Regras do CDE (ISO 19650): código dos documentos, revisões (P01, P02… preliminares; C01…
// contratuais, depois de publicado), estados e finalidade (código de adequação), e quem pode
// publicar/arquivar. Mesmas regras do SmartEasyBIM (apps/mep-bim/src/core/cde.ts).

const STATES = ['andamento', 'compartilhado', 'publicado', 'arquivado'];

const STATE_LABEL = {
  andamento: 'Em andamento',
  compartilhado: 'Compartilhado',
  publicado: 'Publicado',
  arquivado: 'Arquivado',
};

const SUITABILITY = {
  andamento: [{ code: 'S0', label: 'Em andamento (uso interno)' }],
  compartilhado: [
    { code: 'S1', label: 'Para coordenação' },
    { code: 'S2', label: 'Para informação' },
    { code: 'S3', label: 'Para revisão e comentários' },
    { code: 'S4', label: 'Para aprovação' },
  ],
  publicado: [
    { code: 'A1', label: 'Aprovado para construção' },
    { code: 'A2', label: 'Aprovado para licitação' },
    { code: 'A3', label: 'Aprovado para fabricação' },
    { code: 'B1', label: 'Aprovado parcialmente (com comentários)' },
  ],
  arquivado: [{ code: 'AR', label: 'Arquivado (substituído)' }],
};

/** Perfis que aprovam (publicam) e arquivam documentos. */
const APPROVERS = new Set(['admin', 'direcao', 'lider', 'gestao', 'coordenador']);

function codeField(s, fallback = 'XX') {
  const v = String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return v || fallback;
}

function padNumber(n) {
  const d = String(n ?? '').replace(/\D/g, '');
  return (d || '1').padStart(4, '0').slice(-6);
}

/** Código: Projeto-Originador-Volume-Nível-Tipo-Disciplina-Número. */
function docCode(config, doc) {
  return [
    codeField(config.projeto, 'PRJ'),
    codeField(config.originador, 'ORG'),
    codeField(doc.volume || config.volume, 'ZZ'),
    codeField(doc.nivel, 'ZZ'),
    codeField(doc.tipo, 'DR'),
    codeField(doc.disciplina, 'ZZ'),
    padNumber(doc.numero),
  ].join('-');
}

function nextRevision(rev, publishing) {
  const m = /^([PC])(\d+)$/i.exec(String(rev || '').trim());
  const kind = m ? m[1].toUpperCase() : 'P';
  const n = m ? Number(m[2]) : 0;
  if (publishing) return kind === 'C' ? `C${String(n + 1).padStart(2, '0')}` : 'C01';
  return `${kind}${String(n + 1).padStart(2, '0')}`;
}

/** A revisão já saiu (foi compartilhada ou publicada)? */
const revisionIssued = (rev, events) => events.some((e) => e.tipo === 'estado' && e.revisao === rev && (e.estado === 'compartilhado' || e.estado === 'publicado'));

/**
 * Revisão de um arquivo novo: se a revisão atual já saiu, o trabalho segue na próxima
 * (P01 compartilhada → P02; C01 publicada → C02), em andamento.
 */
function revisionForUpload(doc, events) {
  return revisionIssued(doc.revisao, events) ? nextRevision(doc.revisao, false) : doc.revisao;
}

/**
 * Nova revisão/estado ao mudar o estado. Compartilhar usa a revisão atual (se ainda não saiu);
 * publicar passa à série contratual (C01, continuando a última C). Voltar a "em andamento" ou
 * arquivar mantém a revisão.
 */
function revisionForState(doc, estado, events) {
  if (estado === 'andamento' || estado === 'arquivado') return doc.revisao;
  const issued = revisionIssued(doc.revisao, events);
  if (estado === 'publicado') {
    if (String(doc.revisao).startsWith('C') && !issued) return doc.revisao;
    const lastC = events.reduce((m, e) => {
      const r = /^C(\d+)$/.exec(e.revisao || '');
      return r ? Math.max(m, Number(r[1])) : m;
    }, 0);
    return `C${String(lastC + 1).padStart(2, '0')}`;
  }
  return issued ? nextRevision(doc.revisao, false) : doc.revisao;
}

/** Valida a mudança de estado e a permissão do perfil. Devolve a mensagem de erro, ou null. */
function stateChangeError(doc, estado, finalidade, profile) {
  if (!STATES.includes(estado)) return 'Estado inválido.';
  if (finalidade && !SUITABILITY[estado].some((s) => s.code === finalidade)) return `Finalidade ${finalidade} não vale para "${STATE_LABEL[estado]}".`;
  if ((estado === 'publicado' || estado === 'arquivado') && !APPROVERS.has(profile)) return 'Só coordenação, gestão, liderança, direção ou administrador podem publicar ou arquivar.';
  if ((estado === 'compartilhado' || estado === 'publicado') && !doc.arquivo_key) return 'Envie o arquivo do documento antes de compartilhar ou publicar.';
  if (doc.estado === 'arquivado' && estado !== 'andamento') return 'Documento arquivado: volte para "em andamento" antes.';
  return null;
}

function nextEmissionNumber(numbers) {
  const n = numbers.reduce((m, s) => Math.max(m, Number(/(\d+)\s*$/.exec(s || '')?.[1] ?? 0)), 0);
  return `GRD-${String(n + 1).padStart(3, '0')}`;
}

/** Nome de arquivo seguro para a chave de armazenamento. */
function safeFileName(name) {
  const base = String(name || 'arquivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|_+$/g, '');
  return (base || 'arquivo').slice(-120);
}

module.exports = {
  STATES,
  STATE_LABEL,
  SUITABILITY,
  APPROVERS,
  codeField,
  padNumber,
  docCode,
  nextRevision,
  revisionForUpload,
  revisionForState,
  stateChangeError,
  nextEmissionNumber,
  safeFileName,
};
