// Geometria dos elementos em blocos de tamanho limitado (pedaços de ~64 MB): cada malha é
// escrita direto no bloco, sem cópias intermediárias, e as malhas do app são vistas desses
// blocos. Assim um IFC muito grande não exige um único ArrayBuffer gigante nem dobra a
// memória ao juntar tudo, e os blocos podem ir para a interface e para o cache um a um.
import type { ElementMesh } from "./loadIfc";

export interface MeshChunk {
  ids: Int32Array;
  /** RGBA de cada malha. */
  colors: Float32Array;
  /** Início de cada malha em positions/normals (em floats) e em indices; n+1 valores. */
  vertexStart: Uint32Array;
  indexStart: Uint32Array;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Capacidade padrão de um bloco: 16 M floats (64 MB) em posições e normais, 16 M índices. */
export const CHUNK_FLOATS = 16 * 1024 * 1024;

/** Parte de uma malha antes da escrita: vértices intercalados (x,y,z,nx,ny,nz) e matriz. */
export interface MeshPart {
  verts: Float32Array;
  index: ArrayLike<number>;
  /** Matriz 4x4 column-major (identidade se ausente). */
  matrix?: ArrayLike<number>;
}

export class MeshChunkBuilder {
  readonly chunks: MeshChunk[] = [];
  private pos!: Float32Array;
  private nor!: Float32Array;
  private idx!: Uint32Array;
  private vUsed = 0;
  private iUsed = 0;
  private ids: number[] = [];
  private colors: number[] = [];
  private vStart: number[] = [0];
  private iStart: number[] = [0];
  private open = false;
  count = 0;

  constructor(private readonly capacity = CHUNK_FLOATS) {}

  private start(vFloats: number, iCount: number) {
    const cap = Math.max(this.capacity, vFloats);
    const icap = Math.max(this.capacity, iCount);
    this.pos = new Float32Array(cap);
    this.nor = new Float32Array(cap);
    this.idx = new Uint32Array(icap);
    this.vUsed = 0;
    this.iUsed = 0;
    this.ids = [];
    this.colors = [];
    this.vStart = [0];
    this.iStart = [0];
    this.open = true;
  }

  private finish() {
    if (!this.open) return;
    this.open = false;
    if (!this.ids.length) return;
    // Bloco pouco ocupado: copia só a parte usada (libera o resto).
    const trim = <T extends Float32Array | Uint32Array>(a: T, used: number): T => (used < a.length * 0.9 ? (a.slice(0, used) as T) : (a.subarray(0, used) as T));
    this.chunks.push({
      ids: Int32Array.from(this.ids),
      colors: Float32Array.from(this.colors),
      vertexStart: Uint32Array.from(this.vStart),
      indexStart: Uint32Array.from(this.iStart),
      positions: trim(this.pos, this.vUsed),
      normals: trim(this.nor, this.vUsed),
      indices: trim(this.idx, this.iUsed),
    });
    this.pos = this.nor = new Float32Array(0);
    this.idx = new Uint32Array(0);
  }

  /** Escreve uma malha (várias partes, já transformadas para o mundo) no bloco atual. */
  add(expressID: number, color: ArrayLike<number>, parts: MeshPart[]) {
    let vFloats = 0;
    let iCount = 0;
    for (const p of parts) {
      vFloats += (p.verts.length / 6) * 3;
      iCount += p.index.length;
    }
    if (!this.open || this.vUsed + vFloats > this.pos.length || this.iUsed + iCount > this.idx.length) {
      this.finish();
      this.start(vFloats, iCount);
    }
    let vo = this.vUsed;
    let io = this.iUsed;
    const vBase = this.vUsed;
    for (const p of parts) {
      const base = (vo - vBase) / 3;
      writeTransformed(p.verts, p.matrix, this.pos, this.nor, vo);
      for (let i = 0; i < p.index.length; i++) this.idx[io + i] = p.index[i] + base;
      vo += (p.verts.length / 6) * 3;
      io += p.index.length;
    }
    this.vUsed = vo;
    this.iUsed = io;
    this.ids.push(expressID);
    this.colors.push(color[0] ?? 0.8, color[1] ?? 0.8, color[2] ?? 0.8, color[3] ?? 1);
    this.vStart.push(vo);
    this.iStart.push(io);
    this.count++;
  }

  /** Fecha o último bloco e devolve todos. */
  done(): MeshChunk[] {
    this.finish();
    return this.chunks;
  }
}

/** Aplica a matriz (column-major) ao array intercalado [x,y,z,nx,ny,nz], escrevendo em pos/nor a partir de `at`. */
function writeTransformed(verts: Float32Array, m: ArrayLike<number> | undefined, pos: Float32Array, nor: Float32Array, at: number) {
  const count = verts.length / 6;
  for (let i = 0; i < count; i++) {
    const x = verts[i * 6], y = verts[i * 6 + 1], z = verts[i * 6 + 2];
    const nx = verts[i * 6 + 3], ny = verts[i * 6 + 4], nz = verts[i * 6 + 5];
    const o = at + i * 3;
    if (!m) {
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      nor[o] = nx;
      nor[o + 1] = ny;
      nor[o + 2] = nz;
      continue;
    }
    pos[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
    pos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    pos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const tx = m[0] * nx + m[4] * ny + m[8] * nz;
    const ty = m[1] * nx + m[5] * ny + m[9] * nz;
    const tz = m[2] * nx + m[6] * ny + m[10] * nz;
    const len = Math.hypot(tx, ty, tz) || 1;
    nor[o] = tx / len;
    nor[o + 1] = ty / len;
    nor[o + 2] = tz / len;
  }
}

/** Malhas do app como vistas dos blocos (sem copiar). */
export function meshesOfChunks(chunks: MeshChunk[]): ElementMesh[] {
  const out: ElementMesh[] = [];
  for (const g of chunks) {
    const c = g.colors;
    for (let i = 0; i < g.ids.length; i++) {
      out.push({
        expressID: g.ids[i],
        positions: g.positions.subarray(g.vertexStart[i], g.vertexStart[i + 1]),
        normals: g.normals.subarray(g.vertexStart[i], g.vertexStart[i + 1]),
        indices: g.indices.subarray(g.indexStart[i], g.indexStart[i + 1]),
        color: [c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3]],
      });
    }
  }
  return out;
}

/** Junta malhas soltas em blocos (usado nos testes e onde as malhas já existem). */
export function chunksOfMeshes(meshes: ElementMesh[], capacity = CHUNK_FLOATS): MeshChunk[] {
  const b = new MeshChunkBuilder(capacity);
  for (const m of meshes) {
    const verts = new Float32Array((m.positions.length / 3) * 6);
    for (let i = 0; i < m.positions.length / 3; i++) {
      verts.set(m.positions.subarray(i * 3, i * 3 + 3), i * 6);
      verts.set(m.normals.subarray(i * 3, i * 3 + 3), i * 6 + 3);
    }
    b.add(m.expressID, m.color, [{ verts, index: m.indices }]);
  }
  return b.done();
}

export function chunkBytes(chunks: MeshChunk[]): number {
  let n = 0;
  for (const g of chunks) n += g.positions.byteLength + g.normals.byteLength + g.indices.byteLength + g.ids.length * 40;
  return n;
}
