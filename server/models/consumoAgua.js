const { pool } = require('../db/pool');

const UPDATABLE_FIELDS = new Set([
  'nome',
  'itens',
  'dias_autonomia',
  'reserva_incendio_litros',
  'percentual_reservatorio_inferior',
  'observacoes'
]);

function normalizeItens(itens) {
  if (Array.isArray(itens)) return JSON.stringify(itens);
  if (typeof itens === 'string') return itens;
  return '[]';
}

async function createCalculo(payload = {}) {
  const {
    empreendimento_id,
    nome = 'Cálculo de Consumo de Água',
    itens = [],
    dias_autonomia = 1,
    reserva_incendio_litros = 0,
    percentual_reservatorio_inferior = 40,
    observacoes = null
  } = payload;

  const res = await pool.query(
    `INSERT INTO consumo_agua_calculos
      (empreendimento_id, nome, itens, dias_autonomia, reserva_incendio_litros, percentual_reservatorio_inferior, observacoes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [empreendimento_id, nome, normalizeItens(itens), dias_autonomia, reserva_incendio_litros, percentual_reservatorio_inferior, observacoes]
  );
  return res.rows[0];
}

async function listCalculosByEmpreendimento(empreendimentoId) {
  const res = await pool.query(
    'SELECT * FROM consumo_agua_calculos WHERE empreendimento_id = $1 ORDER BY id',
    [empreendimentoId]
  );
  return res.rows;
}

async function getCalculo(id) {
  const res = await pool.query('SELECT * FROM consumo_agua_calculos WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function updateCalculo(id, fields = {}) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE_FIELDS.has(k));
  if (!keys.length) return getCalculo(id);

  const values = keys.map((k) => (k === 'itens' ? normalizeItens(fields[k]) : fields[k]));
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const q = `UPDATE consumo_agua_calculos SET ${sets}, updated_at = now() WHERE id = $${keys.length + 1} RETURNING *`;
  const res = await pool.query(q, [...values, id]);
  return res.rows[0] || null;
}

async function deleteCalculo(id) {
  await pool.query('DELETE FROM consumo_agua_calculos WHERE id = $1', [id]);
}

module.exports = {
  createCalculo,
  listCalculosByEmpreendimento,
  getCalculo,
  updateCalculo,
  deleteCalculo
};
