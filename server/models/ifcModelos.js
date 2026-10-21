const { pool } = require('../db/pool');

// Mesma definição de db/schema.sql. Garantida aqui também porque uma falha anterior no
// schema.sql interrompe as migrações antes de chegar nesta tabela.
let ensurePromise = null;
function ensureTable() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ifc_modelos (
          id SERIAL PRIMARY KEY,
          empreendimento_id INTEGER NOT NULL REFERENCES empreendimentos(id) ON DELETE CASCADE,
          nome VARCHAR(255) NOT NULL,
          descricao TEXT,
          tamanho_bytes BIGINT NOT NULL,
          tamanho_comprimido BIGINT NOT NULL,
          conteudo BYTEA NOT NULL,
          enviado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
          enviado_por_nome VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_ifc_modelos_empreendimento ON ifc_modelos(empreendimento_id)');
      await pool.query('ALTER TABLE ifc_modelos ADD COLUMN IF NOT EXISTS levantamento JSONB');
      await pool.query('ALTER TABLE ifc_modelos ADD COLUMN IF NOT EXISTS levantamento_em TIMESTAMPTZ');
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

// Colunas de listagem: nunca inclui o conteúdo binário
const LIST_COLUMNS = 'id, empreendimento_id, nome, descricao, tamanho_bytes, tamanho_comprimido, enviado_por, enviado_por_nome, created_at, levantamento_em';

async function listByEmpreendimento(empreendimentoId) {
  await ensureTable();
  const res = await pool.query(
    `SELECT ${LIST_COLUMNS} FROM ifc_modelos WHERE empreendimento_id = $1 ORDER BY created_at DESC`,
    [empreendimentoId]
  );
  return res.rows;
}

async function getById(id) {
  await ensureTable();
  const res = await pool.query(`SELECT ${LIST_COLUMNS} FROM ifc_modelos WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

async function getConteudo(id) {
  await ensureTable();
  const res = await pool.query('SELECT nome, conteudo FROM ifc_modelos WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function createModelo({ empreendimento_id, nome, descricao = null, tamanho_bytes, conteudo, enviado_por = null, enviado_por_nome = null }) {
  await ensureTable();
  const res = await pool.query(
    `INSERT INTO ifc_modelos (empreendimento_id, nome, descricao, tamanho_bytes, tamanho_comprimido, conteudo, enviado_por, enviado_por_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${LIST_COLUMNS}`,
    [empreendimento_id, nome, descricao, tamanho_bytes, conteudo.length, conteudo, enviado_por, enviado_por_nome]
  );
  return res.rows[0];
}

async function getLevantamento(id) {
  await ensureTable();
  const res = await pool.query('SELECT levantamento, levantamento_em FROM ifc_modelos WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function saveLevantamento(id, levantamento) {
  await ensureTable();
  const res = await pool.query(
    'UPDATE ifc_modelos SET levantamento = $2, levantamento_em = NOW() WHERE id = $1 RETURNING levantamento_em',
    [id, levantamento]
  );
  return res.rows[0] || null;
}

async function deleteModelo(id) {
  await ensureTable();
  const res = await pool.query('DELETE FROM ifc_modelos WHERE id = $1', [id]);
  return res.rowCount > 0;
}

module.exports = { listByEmpreendimento, getById, getConteudo, createModelo, deleteModelo, getLevantamento, saveLevantamento };
