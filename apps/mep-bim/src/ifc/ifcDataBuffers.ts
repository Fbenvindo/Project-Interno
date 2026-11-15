import type { IfcData } from "./loadIfc";

/** Blocos da geometria (para transferir entre o worker e a interface sem cópia). */
export function ifcDataBuffers(d: IfcData): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const g of d.geometry)
    for (const a of [g.ids, g.colors, g.vertexStart, g.indexStart, g.positions, g.normals, g.indices]) out.add(a.buffer as ArrayBuffer);
  return [...out];
}
