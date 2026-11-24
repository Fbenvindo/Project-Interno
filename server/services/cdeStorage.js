// Armazenamento dos arquivos do CDE.
// - S3 (Amazon S3, Cloudflare R2, Backblaze B2, MinIO…): quando S3_BUCKET está definido. O
//   navegador/app envia e baixa direto do S3 por URLs assinadas (o arquivo não passa pelo
//   servidor; IFCs grandes não pesam na API).
// - Disco local (desenvolvimento): sem S3, os arquivos vão para CDE_LOCAL_DIR (padrão
//   server/storage/cde) por rotas do próprio servidor, com o mesmo formato de URL assinada.
//
// Variáveis: S3_BUCKET, S3_REGION (padrão "auto"), S3_ENDPOINT (R2/B2/MinIO),
// S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE ("true" para MinIO),
// CDE_LOCAL_DIR, CDE_PUBLIC_URL (endereço público da API, para as URLs locais).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET = process.env.CDE_SIGNING_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET || 'project-oficial-local-auth';
const EXPIRES_S = 60 * 60; // 1 hora

function s3Configured() {
  return !!process.env.S3_BUCKET;
}

let s3 = null;
function s3Client() {
  if (s3) return s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
    ...(process.env.S3_ACCESS_KEY_ID
      ? { credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' } }
      : {}),
  });
  return s3;
}

// ---- Disco local -------------------------------------------------------------------------

function localDir() {
  return path.resolve(process.env.CDE_LOCAL_DIR || path.join(__dirname, '..', 'storage', 'cde'));
}

/** Caminho no disco de uma chave (sem sair da pasta do CDE). */
function localPath(key) {
  const base = localDir();
  const p = path.resolve(base, key);
  if (!p.startsWith(base + path.sep)) throw new Error('Chave de arquivo inválida.');
  return p;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

/** Token assinado para uma operação local (put/get) numa chave, com validade. */
function localToken(op, key, extra = {}) {
  const payload = b64(JSON.stringify({ op, key, exp: Date.now() + EXPIRES_S * 1000, ...extra }));
  return `${payload}.${sign(payload)}`;
}

function readLocalToken(token, op) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(unb64(payload));
    if (data.op !== op || !data.key || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// ---- Interface comum ---------------------------------------------------------------------

/**
 * URL para enviar o arquivo (PUT com o corpo = arquivo). `baseUrl`: endereço da API, para o modo
 * local.
 */
async function uploadUrl(key, contentType, baseUrl) {
  if (s3Configured()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(s3Client(), new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType || 'application/octet-stream' }), { expiresIn: EXPIRES_S });
    return { url, method: 'PUT', headers: { 'Content-Type': contentType || 'application/octet-stream' }, storage: 's3' };
  }
  const base = process.env.CDE_PUBLIC_URL || baseUrl;
  return { url: `${base}/api/cde/arquivos/${localToken('put', key)}`, method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, storage: 'local' };
}

/** URL para baixar o arquivo, com o nome de arquivo indicado. */
async function downloadUrl(key, fileName, baseUrl) {
  if (s3Configured()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(fileName || 'arquivo')}`;
    return getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ResponseContentDisposition: disposition }), { expiresIn: EXPIRES_S });
  }
  const base = process.env.CDE_PUBLIC_URL || baseUrl;
  return `${base}/api/cde/arquivos/${localToken('get', key, { name: fileName || 'arquivo' })}`;
}

/** O arquivo existe? Devolve o tamanho (bytes), ou null. */
async function stat(key) {
  if (s3Configured()) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    try {
      const r = await s3Client().send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      return Number(r.ContentLength ?? 0);
    } catch {
      return null;
    }
  }
  try {
    return fs.statSync(localPath(key)).size;
  } catch {
    return null;
  }
}

/** Rotas do modo local: PUT grava o corpo no disco (em fluxo), GET devolve o arquivo. */
function registerLocalRoutes(app) {
  app.put('/api/cde/arquivos/:token', (req, res) => {
    if (s3Configured()) return res.status(404).end();
    const t = readLocalToken(req.params.token, 'put');
    if (!t) return res.status(403).json({ error: 'Link de envio inválido ou expirado.' });
    let file;
    try {
      file = localPath(t.key);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.parcial`;
    const out = fs.createWriteStream(tmp);
    req.pipe(out);
    out.on('finish', () => {
      fs.renameSync(tmp, file);
      res.status(200).json({ ok: true });
    });
    out.on('error', (err) => res.status(500).json({ error: err.message }));
    req.on('error', () => fs.rmSync(tmp, { force: true }));
  });
  app.get('/api/cde/arquivos/:token', (req, res) => {
    if (s3Configured()) return res.status(404).end();
    const t = readLocalToken(req.params.token, 'get');
    if (!t) return res.status(403).json({ error: 'Link de download inválido ou expirado.' });
    let file;
    try {
      file = localPath(t.key);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    res.download(file, t.name);
  });
}

module.exports = { s3Configured, uploadUrl, downloadUrl, stat, registerLocalRoutes, readLocalToken, localToken };
