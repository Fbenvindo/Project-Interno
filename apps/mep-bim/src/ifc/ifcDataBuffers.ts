import type { IfcData } from "./loadIfc";

/** Blocos da geometria (para transferir entre o worker e a interface sem cópia). */
export function ifcDataBuffers(d: IfcData): ArrayBuffer[] {
  const g = d.geometry;
  return [...new Set([g.ids, g.colors, g.vertexStart, g.indexStart, g.positions, g.normals, g.indices].map((a) => a.buffer as ArrayBuffer))];
}
