// Ambientes e equipamentos ↔ SmartEasyWEB: envia os ambientes do modelo (IfcSpace) com os
// equipamentos incluídos no programa; traz de lá a potência/tensão revistas e os equipamentos
// cadastrados só no SmartEasyWEB (entram como incluídos à mão).
import { effectiveTech, roomEquipment, type EquipmentInstance, type EquipmentType, type ProgramState, type RoomProgram } from "../../../core/program";
import type { Space } from "../../../core/spaces";

export interface WebRoomOut {
  globalId: string;
  number: string;
  name: string;
  storey: string | null;
  area: number;
  height: number;
  equipment: { key: string; name: string; quantity: number; powerW: number | null; voltageV: number | null; tipo: string | null }[];
}

export interface WebRoomIn {
  id: string;
  globalId: string | null;
  floorName: string | null;
  name: string;
  equipment: { id: string; bimKey: string | null; name: string; quantity: number; powerW: number | null; voltageV: number | null }[];
}

const EMPTY_ROOM: RoomProgram = { equipment: {}, extras: [] };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function roomsForWeb(spaces: Space[], program: ProgramState, inventory: Map<string, EquipmentInstance[]>, catalog: EquipmentType[]): WebRoomOut[] {
  const label = (id: string | null) => catalog.find((t) => t.id === id)?.label ?? null;
  return spaces.map((s) => {
    const room = program.rooms[s.globalId];
    const equipment: WebRoomOut["equipment"] = [];
    for (const inst of inventory.get(s.globalId) ?? []) {
      const eq = roomEquipment(room, inst);
      if (!eq.include) continue;
      const t = effectiveTech(eq, catalog);
      equipment.push({ key: inst.key, name: inst.name, quantity: 1, powerW: t.potencia ?? null, voltageV: t.tensao ?? null, tipo: label(eq.typeId) });
    }
    for (const [key, eq] of Object.entries(room?.equipment ?? {})) {
      if (!eq.manual || !eq.include) continue;
      const t = effectiveTech(eq, catalog);
      equipment.push({ key, name: eq.manual.label, quantity: 1, powerW: t.potencia ?? null, voltageV: t.tensao ?? null, tipo: label(eq.typeId) });
    }
    return { globalId: s.globalId, number: s.number, name: s.name || s.number, storey: s.storey, area: r2(s.area), height: r2(s.topY - s.floorY), equipment };
  });
}

/**
 * Aplica ao programa o que veio do SmartEasyWEB. Devolve o programa novo e o resumo; ambientes de
 * lá que não estão no modelo só são contados.
 */
export function applyWebRooms(spaces: Space[], program: ProgramState, web: WebRoomIn[], inventory: Map<string, EquipmentInstance[]>, catalog: EquipmentType[]) {
  const byGid = new Map(spaces.map((s) => [s.globalId, s]));
  const byName = new Map(spaces.map((s) => [`${s.storey ?? ""}|${(s.name || s.number).trim().toLowerCase()}`, s]));
  const rooms = { ...program.rooms };
  const out = { ambientes: 0, foraDoModelo: 0, novos: 0, revistos: 0 };
  for (const w of web) {
    const s = (w.globalId && byGid.get(w.globalId)) || byName.get(`${w.floorName ?? ""}|${w.name.trim().toLowerCase()}`);
    if (!s) {
      out.foraDoModelo += 1;
      continue;
    }
    out.ambientes += 1;
    const room: RoomProgram = { ...(rooms[s.globalId] ?? EMPTY_ROOM), equipment: { ...(rooms[s.globalId]?.equipment ?? {}) } };
    const instances = new Map((inventory.get(s.globalId) ?? []).map((i) => [i.key, i]));
    for (const e of w.equipment) {
      const tech = { ...(e.powerW ? { potencia: e.powerW } : {}), ...(e.voltageV ? { tensao: e.voltageV } : {}) };
      const key = e.bimKey ?? `web-${e.id}`;
      const inst = instances.get(key);
      const cur = room.equipment[key] ?? (inst ? roomEquipment(room, inst) : undefined);
      if (cur) {
        const now = effectiveTech(cur, catalog);
        if ((tech.potencia && tech.potencia !== now.potencia) || (tech.tensao && tech.tensao !== now.tensao)) {
          room.equipment[key] = { ...cur, tech: { ...(cur.tech ?? {}), ...tech } };
          out.revistos += 1;
        }
      } else if (!e.bimKey || key.startsWith("manual-")) {
        room.equipment[key] = { typeId: null, include: true, manual: { label: e.quantity > 1 ? `${e.name} (${e.quantity}×)` : e.name }, tech };
        out.novos += 1;
      }
    }
    rooms[s.globalId] = room;
  }
  return { program: { ...program, rooms }, ...out };
}
