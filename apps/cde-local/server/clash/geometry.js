// Geometria dos modelos IFC para a análise de interferências: lê o arquivo com o web-ifc (em
// metros, Y para cima, sem mover para a origem, para os modelos das disciplinas ficarem
// alinhados entre si) e guarda num cache binário por arquivo, usado também pelo visualizador 3D.
//
// Formato do cache: "SEBGEO1\0" + uint32 (tamanho do cabeçalho) + cabeçalho JSON (UTF-8) +
// posições Float32 (relativas a `origem`) + índices Uint32, alinhados a 4 bytes.
const fs = require('fs');
const path = require('path');
const W = require('web-ifc');

const MAGIC = 'SEBGEO1\0';
const CACHE_VERSION = 1;

/** Tipos sem interesse para interferências (nunca entram na análise). */
const NEVER = new Set(['IFCSPACE', 'IFCOPENINGELEMENT', 'IFCANNOTATION', 'IFCGRID', 'IFCVIRTUALELEMENT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCZONE']);

let apiPromise = null;
function ifcApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = new W.IfcAPI();
      api.SetWasmPath(path.dirname(require.resolve('web-ifc')) + path.sep, true);
      await api.Init();
      return api;
    })();
  }
  return apiPromise;
}

/**
 * Lê o IFC. Devolve { origem:[x,y,z], elementos:[{id, globalId, tipo, nome, pavimento, v0, vn, i0, in, min, max}],
 * positions: Float32Array (relativas à origem), indices: Uint32Array (índices globais) }.
 */
async function extractGeometry(bytes, onProgress = () => {}) {
  const api = await ifcApi();
  const modelID = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 12 });
  if (modelID < 0) throw new Error('Não foi possível abrir o arquivo IFC.');
  try {
    const val = (a) => (a && typeof a === 'object' && 'value' in a ? a.value : a);
    const refs = (a) => (Array.isArray(a) ? a.map(val).filter((v) => typeof v === 'number') : []);
    const line = (id) => api.GetLine(modelID, id);
    const idsOf = (t) => Array.from(api.GetLineIDsWithType(modelID, t));
    const typeName = (id) => api.GetNameFromTypeCode(api.GetLineType(modelID, id)).toUpperCase();

    // Malhas em coordenadas de mundo (double), por elemento.
    const parts = [];
    let vTotal = 0;
    let iTotal = 0;
    const min = [Infinity, Infinity, Infinity];
    let count = 0;
    api.StreamAllMeshes(modelID, (flat) => {
      const n = flat.geometries.size();
      const pos = [];
      const idx = [];
      let base = 0;
      for (let g = 0; g < n; g++) {
        const placed = flat.geometries.get(g);
        const geom = api.GetGeometry(modelID, placed.geometryExpressID);
        const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const index = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const m = placed.flatTransformation;
        const vc = verts.length / 6;
        const p = new Float64Array(vc * 3);
        for (let i = 0; i < vc; i++) {
          const x = verts[i * 6], y = verts[i * 6 + 1], z = verts[i * 6 + 2];
          p[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          p[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          p[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        pos.push(p);
        const ix = new Uint32Array(index.length);
        for (let i = 0; i < index.length; i++) ix[i] = index[i] + base;
        idx.push(ix);
        base += vc;
        geom.delete();
      }
      if (!base) return;
      const P = concat(pos, Float64Array);
      const I = concat(idx, Uint32Array);
      for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) if (P[i + k] < min[k]) min[k] = P[i + k];
      parts.push({ id: flat.expressID, P, I });
      vTotal += P.length / 3;
      iTotal += I.length;
      if (++count % 500 === 0) onProgress(count);
    });

    // Pavimento de cada elemento (contido em / agregado a).
    const parent = new Map();
    for (const t of [W.IFCRELAGGREGATES, W.IFCRELNESTS]) {
      for (const rid of idsOf(t)) {
        const rel = line(rid);
        for (const c of refs(rel.RelatedObjects)) parent.set(c, val(rel.RelatingObject));
      }
    }
    for (const rid of idsOf(W.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const rel = line(rid);
      for (const c of refs(rel.RelatedElements)) if (!parent.has(c)) parent.set(c, val(rel.RelatingStructure));
    }
    const storeys = new Map();
    for (const sid of idsOf(W.IFCBUILDINGSTOREY)) {
      const s = line(sid);
      storeys.set(sid, val(s.Name) || val(s.LongName) || `Pavimento #${sid}`);
    }
    const storeyOf = (id) => {
      let cur = id;
      for (let g = 0; cur != null && g < 50; g++) {
        if (storeys.has(cur)) return storeys.get(cur);
        cur = parent.get(cur);
      }
      return null;
    };

    // Origem arredondada ao metro (coordenadas UTM ficam pequenas e precisas em Float32).
    const origem = min.map((v) => (Number.isFinite(v) ? Math.floor(v) : 0));
    const positions = new Float32Array(vTotal * 3);
    const indices = new Uint32Array(iTotal);
    const elementos = [];
    let vo = 0;
    let io = 0;
    for (const { id, P, I } of parts) {
      let tipo = 'IFC';
      let nome = `#${id}`;
      let globalId = '';
      try {
        tipo = typeName(id);
        const d = line(id);
        nome = val(d.Name) || val(d.ObjectType) || nome;
        globalId = val(d.GlobalId) || '';
      } catch {
        /* elemento ilegível: fica com os dados padrão */
      }
      if (NEVER.has(tipo)) continue;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      const v0 = vo / 3;
      for (let i = 0; i < P.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = P[i + k];
          if (v < lo[k]) lo[k] = v;
          if (v > hi[k]) hi[k] = v;
          positions[vo + i + k] = v - origem[k];
        }
      }
      for (let i = 0; i < I.length; i++) indices[io + i] = I[i] + v0;
      elementos.push({ id, globalId, tipo, nome: String(nome).slice(0, 200), pavimento: storeyOf(id), v0, vn: P.length / 3, i0: io, in: I.length, min: lo, max: hi });
      vo += P.length;
      io += I.length;
    }
    return { origem, elementos, positions: positions.subarray(0, vo), indices: indices.subarray(0, io) };
  } finally {
    api.CloseModel(modelID);
  }
}

function concat(list, Type) {
  if (list.length === 1) return list[0];
  const out = new Type(list.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of list) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function writeCache(file, g) {
  const header = Buffer.from(JSON.stringify({ versao: CACHE_VERSION, origem: g.origem, elementos: g.elementos, nPos: g.positions.length, nIdx: g.indices.length }), 'utf8');
  const pad = (4 - ((8 + 4 + header.length) % 4)) % 4;
  const head = Buffer.alloc(8 + 4 + header.length + pad);
  head.write(MAGIC, 0, 'latin1');
  head.writeUInt32LE(header.length + pad, 8);
  header.copy(head, 12);
  head.fill(0x20, 12 + header.length);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.gravando`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, head);
    fs.writeSync(fd, Buffer.from(g.positions.buffer, g.positions.byteOffset, g.positions.byteLength));
    fs.writeSync(fd, Buffer.from(g.indices.buffer, g.indices.byteOffset, g.indices.byteLength));
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readCache(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 8) !== MAGIC) return null;
  const hl = buf.readUInt32LE(8);
  const h = JSON.parse(buf.toString('utf8', 12, 12 + hl));
  if (h.versao !== CACHE_VERSION) return null;
  const off = 12 + hl;
  // Cópias alinhadas (o Buffer do Node pode não estar alinhado a 4 bytes).
  const positions = new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + h.nPos * 4));
  const indices = new Uint32Array(buf.buffer.slice(buf.byteOffset + off + h.nPos * 4, buf.byteOffset + off + h.nPos * 4 + h.nIdx * 4));
  return { origem: h.origem, elementos: h.elementos, positions, indices };
}

/** Geometria do arquivo, do cache se já processado. */
async function geometryOf(ifcPath, cachePath, onProgress) {
  try {
    if (fs.existsSync(cachePath)) {
      const g = readCache(cachePath);
      if (g) return g;
    }
  } catch {
    /* cache corrompido: processa de novo */
  }
  const g = await extractGeometry(new Uint8Array(fs.readFileSync(ifcPath)), onProgress);
  writeCache(cachePath, g);
  return g;
}

module.exports = { extractGeometry, writeCache, readCache, geometryOf, NEVER, MAGIC };
