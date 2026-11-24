// Usuários e sessões do CDE local: senhas com scrypt e tokens assinados (HMAC) com validade.
// A chave de assinatura é criada no primeiro uso e fica no próprio banco.
const crypto = require('crypto');

const PERFIS = ['admin', 'coordenador', 'colaborador'];
const TOKEN_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, got);
}

function secretOf(db) {
  let s = db.setting('segredo');
  if (!s) s = db.setting('segredo', crypto.randomBytes(32).toString('base64url'));
  return s;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

function issueToken(db, userId) {
  const payload = b64(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  return `${payload}.${sign(secretOf(db), payload)}`;
}

const publicUser = (u) => ({ id: u.id, name: u.nome, email: u.email, perfil: u.perfil, ativo: !!u.ativo });

/** Usuário ativo do token (Authorization: Bearer), ou null. */
function userFromToken(db, token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(secretOf(db), payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.uid || data.exp < Date.now()) return null;
  const u = db.get('SELECT id, nome, email, perfil, ativo FROM usuarios WHERE id = ?', [data.uid]);
  return u && u.ativo ? publicUser(u) : null;
}

module.exports = { PERFIS, hashPassword, checkPassword, issueToken, userFromToken, publicUser, secretOf };
