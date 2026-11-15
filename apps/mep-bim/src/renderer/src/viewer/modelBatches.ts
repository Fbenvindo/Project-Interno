// Desenho do modelo IFC em blocos: em vez de um objeto por elemento (dezenas de milhares de
// buffers na placa de vídeo e uma chamada de desenho por elemento), os elementos são
// agrupados em poucas malhas grandes, com a cor de cada elemento nos vértices. Cada elemento
// continua tendo o seu THREE.Mesh para seleção, medidas e encaixes, mas esse objeto só é
// desenhado quando está em destaque (selecionado, em interferência). Esconder um elemento no
// bloco é zerar os seus índices (triângulos degenerados), sem refazer o bloco.
import * as THREE from "three";
import type { ElementMesh } from "../../../ifc/loadIfc";

/** Capacidade de um bloco: 8 M floats de posição (2,7 M vértices, ~32 MB) e 12 M índices. */
const BATCH_FLOATS = 8 * 1024 * 1024;
const BATCH_INDICES = 12 * 1024 * 1024;

interface Batch {
  mesh: THREE.Mesh;
  /** Elementos pequenos (mobiliário, louças, acessórios): escondidos enquanto a câmera se move. */
  small: boolean;
  index: THREE.BufferAttribute;
  color: THREE.BufferAttribute;
  /** Faixas do índice alteradas desde o último envio à placa. */
  dirty: boolean;
  live: number;
}

interface Slot {
  batch: Batch;
  /** Primeiro vértice do elemento no bloco. */
  v0: number;
  vCount: number;
  /** Faixa do elemento no índice do bloco. */
  i0: number;
  local: ArrayLike<number>;
  shown: boolean;
}

export type RGBA = [number, number, number, number];

/** Diagonal (m) abaixo da qual o elemento conta como pequeno. */
const SMALL_DIAGONAL = 1.0;
const EMPTY = new Float32Array(0);

function diagonal(p: Float32Array): number {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

/** Normais compactadas (Int8 normalizado) a partir das normais da malha ou, sem elas, das faces. */
function packNormals(m: ElementMesh, out: Int8Array, at: number) {
  const n = m.normals;
  if (n.length === m.positions.length) {
    for (let i = 0; i < n.length; i++) out[at + i] = Math.max(-127, Math.min(127, Math.round(n[i] * 127)));
    return;
  }
  const p = m.positions;
  const idx = m.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx = Math.round((nx / len) * 127);
    ny = Math.round((ny / len) * 127);
    nz = Math.round((nz / len) * 127);
    for (const v of [a, b, c]) {
      out[at + v] = nx;
      out[at + v + 1] = ny;
      out[at + v + 2] = nz;
    }
  }
}

export class ModelBatches {
  readonly group = new THREE.Group();
  private batches: Batch[] = [];
  private slots = new Map<number, Slot>();
  private opaqueMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private transparentMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  private ghost: THREE.Material | null = null;

  constructor(private readonly ghostMaterial: THREE.Material) {
    this.group.name = "model-batches";
  }

  has(id: number) {
    return this.slots.has(id);
  }

  /**
   * Acrescenta malhas aos blocos (separando as transparentes). As posições e normais de cada
   * malha passam a ser vistas do bloco (a memória original pode ser liberada).
   */
  add(meshes: ElementMesh[], colorOf: (m: ElementMesh) => RGBA) {
    const lists: Record<string, ElementMesh[]> = { o: [], t: [], os: [], ts: [] };
    for (const m of meshes) {
      if (!m.positions.length || this.slots.has(m.expressID)) continue;
      const k = (colorOf(m)[3] < 0.999 ? "t" : "o") + (diagonal(m.positions) < SMALL_DIAGONAL ? "s" : "");
      lists[k].push(m);
    }
    this.build(lists.o, false, false, colorOf);
    this.build(lists.t, true, false, colorOf);
    this.build(lists.os, false, true, colorOf);
    this.build(lists.ts, true, true, colorOf);
  }

  private build(list: ElementMesh[], transparent: boolean, small: boolean, colorOf: (m: ElementMesh) => RGBA) {
    let i = 0;
    while (i < list.length) {
      // Quantas malhas cabem neste bloco (uma malha maior que o bloco vai sozinha).
      let floats = 0;
      let idx = 0;
      let j = i;
      while (j < list.length) {
        const f = list[j].positions.length;
        const n = list[j].indices.length;
        if (j > i && (floats + f > BATCH_FLOATS || idx + n > BATCH_INDICES)) break;
        floats += f;
        idx += n;
        j++;
      }
      const pos = new Float32Array(floats);
      const nor = new Int8Array(floats);
      const col = new Uint8Array((floats / 3) * 4);
      const ind = new Uint32Array(idx);
      const geometry = new THREE.BufferGeometry();
      const index = new THREE.BufferAttribute(ind, 1);
      const color = new THREE.BufferAttribute(col, 4, true);
      const mesh = new THREE.Mesh(geometry, transparent ? this.transparentMat : this.opaqueMat);
      const batch: Batch = { mesh, small, index, color, dirty: false, live: 0 };
      let vo = 0;
      let io = 0;
      for (let k = i; k < j; k++) {
        const m = list[k];
        const v0 = vo / 3;
        pos.set(m.positions, vo);
        packNormals(m, nor, vo);
        // As malhas do app passam a apontar para o bloco (mesmos valores, sem cópia extra); as
        // normais ficam só no bloco, compactadas (o Mesh de seleção calcula as suas se precisar).
        m.positions = pos.subarray(vo, vo + m.positions.length);
        m.normals = EMPTY;
        for (let t = 0; t < m.indices.length; t++) ind[io + t] = m.indices[t] + v0;
        const slot: Slot = { batch, v0, vCount: m.positions.length / 3, i0: io, local: m.indices, shown: true };
        this.slots.set(m.expressID, slot);
        this.paint(slot, colorOf(m));
        batch.live++;
        vo += m.positions.length;
        io += m.indices.length;
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(nor, 3, true));
      geometry.setAttribute("color", color);
      geometry.setIndex(index);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      mesh.renderOrder = transparent ? 2 : 0;
      this.batches.push(batch);
      this.group.add(mesh);
      i = j;
    }
  }

  private paint(slot: Slot, c: RGBA) {
    const col = slot.batch.color.array as Uint8Array;
    const r = Math.round(c[0] * 255), g = Math.round(c[1] * 255), b = Math.round(c[2] * 255), a = Math.round(c[3] * 255);
    for (let v = slot.v0, end = slot.v0 + slot.vCount; v < end; v++) {
      col[v * 4] = r;
      col[v * 4 + 1] = g;
      col[v * 4 + 2] = b;
      col[v * 4 + 3] = a;
    }
  }

  /** Repinta todos os elementos (troca entre cores do IFC e da disciplina). */
  recolor(colorOf: (id: number) => RGBA | null) {
    for (const [id, slot] of this.slots) {
      const c = colorOf(id);
      if (c) this.paint(slot, c);
    }
    for (const b of this.batches) b.color.needsUpdate = true;
  }

  /** Mostra ou esconde um elemento no bloco (o envio à placa é feito em `flush`). */
  setShown(id: number, shown: boolean) {
    const s = this.slots.get(id);
    if (!s || s.shown === shown) return;
    s.shown = shown;
    const ind = s.batch.index.array as Uint32Array;
    if (shown) for (let t = 0; t < s.local.length; t++) ind[s.i0 + t] = s.local[t] + s.v0;
    else ind.fill(0, s.i0, s.i0 + s.local.length);
    s.batch.dirty = true;
  }

  /** Envia à placa os índices alterados. */
  flush() {
    for (const b of this.batches)
      if (b.dirty) {
        b.index.needsUpdate = true;
        b.dirty = false;
      }
  }

  /** Esconde (true) ou mostra os blocos de elementos pequenos (durante o movimento da câmera). */
  setSmallHidden(hidden: boolean) {
    for (const b of this.batches) if (b.small) b.mesh.visible = !hidden;
  }

  /** Total de triângulos nos blocos (para decidir se vale simplificar durante o movimento). */
  get triangles() {
    let n = 0;
    for (const b of this.batches) n += b.index.count / 3;
    return n;
  }

  /** Modo "resto translúcido" (interferências): os blocos usam o material fantasma. */
  setGhost(on: boolean) {
    const g = on ? this.ghostMaterial : null;
    if (g === this.ghost) return;
    this.ghost = g;
    for (const b of this.batches) b.mesh.material = g ?? (b.mesh.renderOrder === 2 ? this.transparentMat : this.opaqueMat);
  }

  /** Tira elementos (vínculo removido); blocos que ficam vazios são descartados. */
  remove(ids: Iterable<number>) {
    for (const id of ids) {
      const s = this.slots.get(id);
      if (!s) continue;
      this.setShown(id, false);
      this.slots.delete(id);
      s.batch.live--;
      if (s.batch.live <= 0) {
        this.group.remove(s.batch.mesh);
        s.batch.mesh.geometry.dispose();
        this.batches = this.batches.filter((b) => b !== s.batch);
      }
    }
    this.flush();
  }

  clear() {
    for (const b of this.batches) b.mesh.geometry.dispose();
    this.batches = [];
    this.slots.clear();
    this.group.clear();
  }

  get batchCount() {
    return this.batches.length;
  }
}
