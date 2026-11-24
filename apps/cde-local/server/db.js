// Banco do CDE local: SQLite (sql.js, sem dependências nativas) num arquivo da pasta de dados.
// O banco fica em memória e é gravado no disco (de forma atômica) logo depois de cada alteração.
// Ao abrir, guarda uma cópia do dia em "backups" (as 14 mais recentes).
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'colaborador',
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS empreendimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cliente TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS cde_config (
  empreendimento_id INTEGER PRIMARY KEY REFERENCES empreendimentos(id) ON DELETE CASCADE,
  projeto TEXT NOT NULL DEFAULT '',
  originador TEXT NOT NULL DEFAULT '',
  volume TEXT NOT NULL DEFAULT 'ZZ',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS cde_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empreendimento_id INTEGER NOT NULL REFERENCES empreendimentos(id) ON DELETE CASCADE,
  volume TEXT NOT NULL DEFAULT '',
  nivel TEXT NOT NULL DEFAULT 'ZZ',
  tipo TEXT NOT NULL DEFAULT 'DR',
  disciplina TEXT NOT NULL DEFAULT 'ZZ',
  numero TEXT NOT NULL,
  titulo TEXT NOT NULL,
  revisao TEXT NOT NULL DEFAULT 'P01',
  estado TEXT NOT NULL DEFAULT 'andamento',
  finalidade TEXT NOT NULL DEFAULT 'S0',
  arquivo_key TEXT,
  arquivo_nome TEXT,
  tamanho INTEGER,
  content_type TEXT,
  origem TEXT NOT NULL DEFAULT 'web',
  criado_por TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (empreendimento_id, volume, nivel, tipo, disciplina, numero)
);
CREATE INDEX IF NOT EXISTS idx_cde_documentos_emp ON cde_documentos (empreendimento_id);
CREATE TABLE IF NOT EXISTS cde_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_id INTEGER NOT NULL REFERENCES cde_documentos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  revisao TEXT NOT NULL,
  estado TEXT NOT NULL,
  finalidade TEXT NOT NULL,
  descricao TEXT,
  arquivo_key TEXT,
  arquivo_nome TEXT,
  tamanho INTEGER,
  content_type TEXT,
  sha256 TEXT,
  autor_id TEXT,
  autor_nome TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cde_eventos_doc ON cde_eventos (documento_id, id);
CREATE TABLE IF NOT EXISTS cde_emissoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empreendimento_id INTEGER NOT NULL REFERENCES empreendimentos(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT (date('now','localtime')),
  destinatario TEXT,
  finalidade TEXT NOT NULL,
  observacoes TEXT,
  autor_nome TEXT,
  itens TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (empreendimento_id, numero)
);
CREATE TABLE IF NOT EXISTS ajustes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
`;

function backup(file, dir) {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(dir, `cde-${day}.sqlite`);
  if (!fs.existsSync(target)) fs.copyFileSync(file, target);
  const old = fs.readdirSync(dir).filter((f) => /^cde-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  old.slice(0, Math.max(0, old.length - 14)).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
}

/** Abre (ou cria) o banco em `dataDir/cde.sqlite`. */
async function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'cde.sqlite');
  backup(file, path.join(dataDir, 'backups'));
  const SQL = await initSqlJs();
  const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  let dirty = false;
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    const tmp = `${file}.gravando`;
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, file);
  };
  const touch = () => {
    dirty = true;
    if (!timer) timer = setTimeout(flush, 150);
  };
  if (!fs.existsSync(file)) {
    dirty = true;
    flush();
  }

  const bind = (params) => (params || []).map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

  const api = {
    file,
    all(sql, params) {
      const st = db.prepare(sql);
      try {
        st.bind(bind(params));
        const rows = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
      } finally {
        st.free();
      }
    },
    get(sql, params) {
      return api.all(sql, params)[0] || null;
    },
    /** Executa uma alteração; devolve { id, changes }. */
    run(sql, params) {
      db.run(sql, bind(params));
      const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] ?? null;
      const changes = db.getRowsModified();
      touch();
      return { id, changes };
    },
    /** Executa SQL sem parâmetros (criação de tabelas). */
    exec(sql) {
      db.exec(sql);
      touch();
    },
    /** Executa `fn` numa transação (tudo ou nada). Síncrono: nada intercala no meio. */
    tx(fn) {
      db.run('BEGIN');
      try {
        const r = fn();
        db.run('COMMIT');
        touch();
        return r;
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    },
    setting(key, value) {
      if (value === undefined) return api.get('SELECT valor FROM ajustes WHERE chave = ?', [key])?.valor ?? null;
      api.run('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', [key, String(value)]);
      return value;
    },
    flush,
    close() {
      flush();
      db.close();
    },
  };
  return api;
}

module.exports = { openDb };
