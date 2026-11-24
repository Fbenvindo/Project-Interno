// Motor de detecção de interferências entre modelos IFC.
// - Colisão física: as malhas dos dois elementos se atravessam (arestas cruzando faces) ou um
//   está dentro do outro, com sobreposição maior que a tolerância (encostar não conta).
// - Folga: elementos que não colidem, mas estão mais próximos que a distância mínima (distâncias
//   até a tolerância contam como contato e não entram).
// Fase ampla por grade espacial (caixas dos elementos); fase fina com árvore de caixas (BVH) por
// elemento. Coordenadas em metros (Y para cima), em double, relativas à origem do 1º modelo.

const CELL = 2; // m
const LEAF = 8;

// ---- Vetores (arrays de 3) -------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const addS = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// ---- Malha de um elemento -----------------------------------------------------------------------
/** Triângulos do elemento (Float64Array, 9 por triângulo), relativos à origem comum. */
function elementTris(model, el) {
  const { positions: P, indices: I, offset: o } = model;
  const n = el.in / 3;
  const t = new Float64Array(n * 9);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = I[el.i0 + i * 3 + k] * 3;
      t[i * 9 + k * 3] = P[v] + o[0];
      t[i * 9 + k * 3 + 1] = P[v + 1] + o[1];
      t[i * 9 + k * 3 + 2] = P[v + 2] + o[2];
    }
  }
  return t;
}
const vert = (t, i, k) => [t[i * 9 + k * 3], t[i * 9 + k * 3 + 1], t[i * 9 + k * 3 + 2]];

/** Árvore de caixas sobre os triângulos: nós com caixa (6 números), filhos ou faixa de triângulos. */
function buildBvh(tris) {
  const n = tris.length / 9;
  const order = new Uint32Array(n);
  const cen = new Float64Array(n * 3);
  const tb = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    order[i] = i;
    for (let k = 0; k < 3; k++) {
      const a = tris[i * 9 + k], b = tris[i * 9 + 3 + k], c = tris[i * 9 + 6 + k];
      tb[i * 6 + k] = Math.min(a, b, c);
      tb[i * 6 + 3 + k] = Math.max(a, b, c);
      cen[i * 3 + k] = (a + b + c) / 3;
    }
  }
  const box = [];
  const left = [];
  const right = [];
  const start = [];
  const count = [];
  const make = (s, e) => {
    const node = start.length;
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        if (tb[t * 6 + k] < b[k]) b[k] = tb[t * 6 + k];
        if (tb[t * 6 + 3 + k] > b[3 + k]) b[3 + k] = tb[t * 6 + 3 + k];
      }
    }
    box.push(...b);
    left.push(-1);
    right.push(-1);
    start.push(s);
    count.push(e - s);
    if (e - s > LEAF) {
      const ext = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
      const ax = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
      const sorted = Array.from(order.subarray(s, e)).sort((p, q) => cen[p * 3 + ax] - cen[q * 3 + ax]);
      order.set(sorted, s);
      const m = (s + e) >> 1;
      left[node] = make(s, m);
      right[node] = make(m, e);
      count[node] = 0;
    }
    return node;
  };
  if (n) make(0, n);
  return { tris, order, box: Float64Array.from(box), left, right, start, count, n };
}

const boxOverlap = (A, i, B, j, m) =>
  A[i * 6] - m <= B[j * 6 + 3] && A[i * 6 + 3] + m >= B[j * 6] && A[i * 6 + 1] - m <= B[j * 6 + 4] && A[i * 6 + 4] + m >= B[j * 6 + 1] && A[i * 6 + 2] - m <= B[j * 6 + 5] && A[i * 6 + 5] + m >= B[j * 6 + 2];
const boxDist2 = (A, i, B, j) => {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const g = Math.max(A[i * 6 + k] - B[j * 6 + 3 + k], B[j * 6 + k] - A[i * 6 + 3 + k], 0);
    s += g * g;
  }
  return s;
};

/** Percorre os pares de folhas cujas caixas se tocam (com margem); `fn(ta, tb)` devolve true para parar. */
function dualLeaves(A, B, margin, fn) {
  if (!A.n || !B.n) return false;
  const stack = [0, 0];
  while (stack.length) {
    const j = stack.pop();
    const i = stack.pop();
    if (!boxOverlap(A.box, i, B.box, j, margin)) continue;
    const la = A.count[i] > 0;
    const lb = B.count[j] > 0;
    if (la && lb) {
      for (let p = A.start[i]; p < A.start[i] + A.count[i]; p++)
        for (let q = B.start[j]; q < B.start[j] + B.count[j]; q++) if (fn(A.order[p], B.order[q])) return true;
    } else if (la || (!lb && A.count[i] === 0 && sizeOf(B.box, j) > sizeOf(A.box, i))) {
      stack.push(i, B.left[j], i, B.right[j]);
    } else {
      stack.push(A.left[i], j, A.right[i], j);
    }
  }
  return false;
}
const sizeOf = (b, i) => b[i * 6 + 3] - b[i * 6] + b[i * 6 + 4] - b[i * 6 + 1] + b[i * 6 + 5] - b[i * 6 + 2];

// ---- Testes entre triângulos ------------------------------------------------------------------
/** O segmento p→q atravessa o triângulo abc? (Möller–Trumbore, t em [0,1]) */
function segTri(p, q, a, b, c) {
  const d = sub(q, p);
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-14) return false;
  const f = 1 / det;
  const s = sub(p, a);
  const u = f * dot(s, h);
  if (u < 0 || u > 1) return false;
  const qq = cross(s, e1);
  const v = f * dot(d, qq);
  if (v < 0 || u + v > 1) return false;
  const t = f * dot(e2, qq);
  return t >= 0 && t <= 1;
}

function triTriIntersect(TA, i, TB, j) {
  const a = [vert(TA, i, 0), vert(TA, i, 1), vert(TA, i, 2)];
  const b = [vert(TB, j, 0), vert(TB, j, 1), vert(TB, j, 2)];
  for (let k = 0; k < 3; k++) {
    if (segTri(a[k], a[(k + 1) % 3], b[0], b[1], b[2])) return true;
    if (segTri(b[k], b[(k + 1) % 3], a[0], a[1], a[2])) return true;
  }
  return false;
}

/** Ponto do triângulo mais próximo de p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2_ = dot(ac, ap);
  if (d1 <= 0 && d2_ <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2_;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return addS(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2_ - d1 * d6;
  if (vb <= 0 && d2_ >= 0 && d6 <= 0) return addS(a, ac, d2_ / (d2_ - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return addS(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return addS(addS(a, ab, vb * den), ac, vc * den);
}

/** Pontos mais próximos entre os segmentos p1q1 e p2q2 (Ericson 5.1.9). */
function closestSegSeg(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2v = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2v, d2v), f = dot(d2v, r);
  let s, t;
  if (a <= 1e-18 && e <= 1e-18) return [p1, p2];
  if (a <= 1e-18) {
    s = 0;
    t = Math.min(Math.max(f / e, 0), 1);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-18) {
      t = 0;
      s = Math.min(Math.max(-c / a, 0), 1);
    } else {
      const b = dot(d1, d2v);
      const den = a * e - b * b;
      s = den !== 0 ? Math.min(Math.max((b * f - c * e) / den, 0), 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(Math.max(-c / a, 0), 1);
      } else if (t > 1) {
        t = 1;
        s = Math.min(Math.max((b - c) / a, 0), 1);
      }
    }
  }
  return [addS(p1, d1, s), addS(p2, d2v, t)];
}

/** Menor distância (ao quadrado) entre dois triângulos que não se cruzam, e os pontos. */
function triTriDist(TA, i, TB, j) {
  const a = [vert(TA, i, 0), vert(TA, i, 1), vert(TA, i, 2)];
  const b = [vert(TB, j, 0), vert(TB, j, 1), vert(TB, j, 2)];
  let best = Infinity;
  let pa = null;
  let pb = null;
  const consider = (x, y) => {
    const d = d2(x, y);
    if (d < best) {
      best = d;
      pa = x;
      pb = y;
    }
  };
  for (let k = 0; k < 3; k++) {
    consider(a[k], closestOnTri(a[k], b[0], b[1], b[2]));
    consider(closestOnTri(b[k], a[0], a[1], a[2]), b[k]);
    for (let m = 0; m < 3; m++) {
      const [x, y] = closestSegSeg(a[k], a[(k + 1) % 3], b[m], b[(m + 1) % 3]);
      consider(x, y);
    }
  }
  return { d2: best, pa, pb };
}

/** O ponto está dentro da malha (fechada)? Raio numa direção oblíqua, contagem de cruzamentos. */
function pointInside(bvh, p) {
  if (!bvh.n) return false;
  const root = bvh.box;
  if (p[0] < root[0] || p[0] > root[3] || p[1] < root[1] || p[1] > root[4] || p[2] < root[2] || p[2] > root[5]) return false;
  const dir = [0.8017, 0.4513, 0.3917];
  const far = addS(p, dir, sizeOf(root, 0) * 2 + 1);
  const seg = [Math.min(p[0], far[0]), Math.min(p[1], far[1]), Math.min(p[2], far[2]), Math.max(p[0], far[0]), Math.max(p[1], far[1]), Math.max(p[2], far[2])];
  let hits = 0;
  const stack = [0];
  const T = bvh.tris;
  while (stack.length) {
    const i = stack.pop();
    if (!boxOverlap(bvh.box, i, seg, 0, 0)) continue;
    if (bvh.count[i] > 0) {
      for (let k = bvh.start[i]; k < bvh.start[i] + bvh.count[i]; k++) {
        const t = bvh.order[k];
        if (segTri(p, far, vert(T, t, 0), vert(T, t, 1), vert(T, t, 2))) hits++;
      }
    } else stack.push(bvh.left[i], bvh.right[i]);
  }
  return hits % 2 === 1;
}

// ---- Análise ---------------------------------------------------------------------------------
/**
 * models: [{ docId, codigo, origem, elementos, positions, indices }]
 * opts: { ladoA: [índices de modelos], ladoB: [...], colisao: bool, tolerancia (m), folga: bool,
 *   distancia (m), ignorar: [tipos IFC] }
 * Devolve { origem, interferencias: [{ tipo, distancia, ponto, a, b, grupo }], pares, elementos }.
 */
function runClash(models, opts, onProgress = () => {}) {
  const tol = Math.max(0, Number(opts.tolerancia ?? 0.01));
  const gap = opts.folga ? Math.max(0, Number(opts.distancia ?? 0.05)) : 0;
  const doHard = opts.colisao !== false;
  if (!doHard && !opts.folga) throw new Error('Escolha colisão física e/ou folga.');
  const ignore = new Set((opts.ignorar || []).map((s) => String(s).trim().toUpperCase()).filter(Boolean));
  const O = models[0]?.origem ?? [0, 0, 0];
  models.forEach((m) => {
    m.offset = [m.origem[0] - O[0], m.origem[1] - O[1], m.origem[2] - O[2]];
  });

  // Elementos de cada lado, com caixa relativa à origem comum.
  const sideOf = (list) => {
    const out = [];
    for (const mi of list) {
      const m = models[mi];
      for (const el of m.elementos) {
        if (ignore.has(el.tipo) || !el.in) continue;
        out.push({
          mi,
          el,
          uid: `${mi}:${el.id}`,
          box: [el.min[0] - O[0], el.min[1] - O[1], el.min[2] - O[2], el.max[0] - O[0], el.max[1] - O[1], el.max[2] - O[2]],
        });
      }
    }
    return out;
  };
  const A = sideOf(opts.ladoA);
  const B = sideOf(opts.ladoB);
  const shared = new Set(opts.ladoA.filter((m) => opts.ladoB.includes(m)));

  // Fase ampla: grade espacial dos elementos de B.
  const margin = gap;
  const grid = new Map();
  const big = [];
  const key = (x, y, z) => ((x + 65536) * 131072 + (y + 65536)) * 131072 + (z + 65536);
  const cellsOf = (b, m) => [0, 1, 2].map((k) => [Math.floor((b[k] - m) / CELL), Math.floor((b[3 + k] + m) / CELL)]);
  B.forEach((e, idx) => {
    const c = cellsOf(e.box, margin);
    const nCells = (c[0][1] - c[0][0] + 1) * (c[1][1] - c[1][0] + 1) * (c[2][1] - c[2][0] + 1);
    if (nCells > 4000) return big.push(idx);
    for (let x = c[0][0]; x <= c[0][1]; x++)
      for (let y = c[1][0]; y <= c[1][1]; y++)
        for (let z = c[2][0]; z <= c[2][1]; z++) {
          const k = key(x, y, z);
          const l = grid.get(k);
          if (l) l.push(idx);
          else grid.set(k, [idx]);
        }
  });

  const bvhCache = new Map();
  const bvhOf = (e) => {
    let b = bvhCache.get(e.uid);
    if (!b) {
      b = buildBvh(elementTris(models[e.mi], e.el));
      bvhCache.set(e.uid, b);
      if (bvhCache.size > 20000) bvhCache.delete(bvhCache.keys().next().value);
    }
    return b;
  };

  const seen = new Set();
  const stamp = new Int32Array(B.length).fill(-1);
  const results = [];
  let pairs = 0;
  let lastReport = 0;
  for (let ia = 0; ia < A.length; ia++) {
    const ea = A[ia];
    const c = cellsOf(ea.box, 0);
    const cand = [];
    for (let x = c[0][0]; x <= c[0][1]; x++)
      for (let y = c[1][0]; y <= c[1][1]; y++)
        for (let z = c[2][0]; z <= c[2][1]; z++) {
          const l = grid.get(key(x, y, z));
          if (!l) continue;
          for (const ib of l)
            if (stamp[ib] !== ia) {
              stamp[ib] = ia;
              cand.push(ib);
            }
        }
    for (const ib of big)
      if (stamp[ib] !== ia) {
        stamp[ib] = ia;
        cand.push(ib);
      }

    for (const ib of cand) {
      const eb = B[ib];
      if (ea.uid === eb.uid) continue;
      if (!boxOverlap(ea.box, 0, eb.box, 0, margin)) continue;
      if (shared.has(ea.mi) && shared.has(eb.mi)) {
        const k = ea.uid < eb.uid ? `${ea.uid}|${eb.uid}` : `${eb.uid}|${ea.uid}`;
        if (seen.has(k)) continue;
        seen.add(k);
      }
      pairs++;
      const r = testPair(ea, eb);
      if (r) results.push(r);
    }
    const now = Date.now();
    if (now - lastReport > 300) {
      lastReport = now;
      onProgress((ia + 1) / A.length, `${(ia + 1).toLocaleString('pt-BR')} de ${A.length.toLocaleString('pt-BR')} elementos · ${results.length} interferência(s)`);
    }
  }

  function testPair(ea, eb) {
    const ov = [0, 1, 2].map((k) => Math.min(ea.box[3 + k], eb.box[3 + k]) - Math.max(ea.box[k], eb.box[k]));
    const ba = bvhOf(ea);
    const bb = bvhOf(eb);
    if (doHard && ov.every((v) => v > tol)) {
      let hit = dualLeaves(ba, bb, 0, (ta, tb) => triTriIntersect(ba.tris, ta, bb.tris, tb));
      // Um dentro do outro (sem faces se cruzando): o menor dentro do maior.
      if (!hit) {
        const [small, large] = sizeOf(ea.box, 0) <= sizeOf(eb.box, 0) ? [ba, bb] : [bb, ba];
        if (small.n) hit = pointInside(large, vert(small.tris, 0, 0));
      }
      if (hit) {
        const centre = [0, 1, 2].map((k) => (Math.max(ea.box[k], eb.box[k]) + Math.min(ea.box[3 + k], eb.box[3 + k])) / 2);
        return result('colisao', -Math.min(...ov), centre, ea, eb);
      }
    }
    if (gap > 0) {
      if (ov.every((v) => v > 0) && dualLeaves(ba, bb, 0, (ta, tb) => triTriIntersect(ba.tris, ta, bb.tris, tb))) return null; // já se tocam: é colisão (abaixo da tolerância)
      let best = gap * gap;
      let pts = null;
      const stack = [0, 0];
      while (stack.length) {
        const j = stack.pop();
        const i = stack.pop();
        if (boxDist2(ba.box, i, bb.box, j) > best) continue;
        const la = ba.count[i] > 0;
        const lb = bb.count[j] > 0;
        if (la && lb) {
          for (let p = ba.start[i]; p < ba.start[i] + ba.count[i]; p++)
            for (let q = bb.start[j]; q < bb.start[j] + bb.count[j]; q++) {
              const r = triTriDist(ba.tris, ba.order[p], bb.tris, bb.order[q]);
              if (r.d2 <= best) {
                best = r.d2;
                pts = r;
              }
            }
        } else if (la || (!lb && sizeOf(bb.box, j) > sizeOf(ba.box, i))) stack.push(i, bb.left[j], i, bb.right[j]);
        else stack.push(ba.left[i], j, ba.right[i], j);
      }
      if (pts) {
        const d = Math.sqrt(best);
        // Abaixo da tolerância é contato (apoio, facetamento dos círculos), não falta de folga.
        if (d > Math.max(tol, 1e-6)) return result('folga', d, [0, 1, 2].map((k) => (pts.pa[k] + pts.pb[k]) / 2), ea, eb);
      }
    }
    return null;
  }

  function result(tipo, distancia, p, ea, eb) {
    const info = (e) => ({ m: e.mi, id: e.el.id, globalId: e.el.globalId, tipo: e.el.tipo, nome: e.el.nome, pavimento: e.el.pavimento, uid: e.uid });
    return { tipo, distancia, ponto: [p[0] + O[0], p[1] + O[1], p[2] + O[2]], a: info(ea), b: info(eb) };
  }

  // Agrupamento: interferências que repetem o mesmo elemento (ex.: um tubo cruzando várias vigas).
  const countOf = new Map();
  for (const r of results) for (const e of [r.a, r.b]) countOf.set(e.uid, (countOf.get(e.uid) || 0) + 1);
  const groups = new Map();
  for (const r of results) {
    const ca = countOf.get(r.a.uid);
    const cb = countOf.get(r.b.uid);
    const lead = ca >= cb ? r.a : r.b;
    if (Math.max(ca, cb) > 1) {
      if (!groups.has(lead.uid)) groups.set(lead.uid, groups.size + 1);
      r.grupo = groups.get(lead.uid);
      r.grupoNome = `${lead.nome} (${lead.tipo.replace(/^IFC/, '')})`;
    } else {
      r.grupo = null;
      r.grupoNome = null;
    }
    delete r.a.uid;
    delete r.b.uid;
  }
  onProgress(1, `${results.length} interferência(s)`);
  return { origem: O, interferencias: results, pares: pairs, elementos: { a: A.length, b: B.length } };
}

module.exports = { runClash, buildBvh, triTriIntersect, pointInside, triTriDist };
