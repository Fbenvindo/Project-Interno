// Arquivo de projeto (.locacao.json): pontos locados e trechos, em
// coordenadas do IFC de origem. Versão 2 acrescenta "trechos"; a versão 1
// (só pontos) continua sendo lida.
import type { CoordinateSystem } from "./math";
import { deserializePoints, serializePoints, type LocacaoFile, type PlacedPoint } from "./points";
import { newRunId, RUN_TYPE_BY_ID, type Run } from "./runs";
import { newCircuitId, type Circuit, type CircuitType } from "./circuits";
import type { Vec3 } from "./types";

export interface ProjectData {
  points: PlacedPoint[];
  runs: Run[];
  circuits: Circuit[];
}

interface StoredCircuit {
  uid: string;
  quadro: string;
  nome: string;
  descricao: string;
  tipo: CircuitType;
  fases: 1 | 2 | 3;
  ligacao: string;
  fatorPotencia: number;
  fca: number;
  quedaMaxima: number;
}

interface StoredRun {
  guid: string;
  tipo: string;
  etiqueta: string;
  bitola: string;
  largura: number;
  altura: number;
  sistema: string;
  declividade: number;
  /** Vértices do eixo em coordenadas IFC (metros, Z para cima). */
  vertices: Vec3[];
  parametros: Record<string, string | number>;
  circuito?: string | null;
}

export interface ProjectFile extends LocacaoFile {
  trechos?: StoredRun[];
  circuitos?: StoredCircuit[];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function serializeProject(data: ProjectData, cs: CoordinateSystem, modelName: string | null): ProjectFile {
  return {
    ...serializePoints(data.points, cs, modelName),
    versao: 3,
    trechos: data.runs.map((r) => ({
      guid: r.guid,
      tipo: r.typeId,
      etiqueta: r.tag,
      bitola: r.size.label,
      largura: r.size.width,
      altura: r.size.height,
      sistema: r.system,
      declividade: r.slope,
      vertices: r.vertices.map((v) => cs.worldToIfc(v).map(round6) as Vec3),
      parametros: r.params,
      ...(r.circuit ? { circuito: r.circuit } : {}),
    })),
    circuitos: data.circuits.map((c) => ({
      uid: c.uid,
      quadro: c.panel,
      nome: c.name,
      descricao: c.description,
      tipo: c.type,
      fases: c.poles,
      ligacao: c.phases,
      fatorPotencia: c.powerFactor,
      fca: c.correction,
      quedaMaxima: c.dropLimit,
    })),
  };
}

export function deserializeProject(json: unknown, cs: CoordinateSystem): ProjectData {
  const points = deserializePoints(json, cs);
  const file = json as ProjectFile;
  const runs: Run[] = (file.trechos ?? []).map((s) => {
    if (!RUN_TYPE_BY_ID[s.tipo]) throw new Error(`Tipo de trecho desconhecido: ${s.tipo}`);
    return {
      id: newRunId(),
      guid: s.guid,
      typeId: s.tipo,
      tag: s.etiqueta,
      size: { label: s.bitola, width: s.largura, height: s.altura },
      system: s.sistema,
      slope: s.declividade ?? 0,
      vertices: s.vertices.map((v) => cs.ifcToWorld(v)),
      params: s.parametros ?? {},
      circuit: s.circuito ?? null,
    };
  });
  const circuits: Circuit[] = (file.circuitos ?? []).map((c) => ({
    id: newCircuitId(),
    uid: c.uid,
    panel: c.quadro,
    name: c.nome,
    description: c.descricao ?? "",
    type: c.tipo ?? "tug",
    poles: c.fases ?? 1,
    phases: c.ligacao ?? "A",
    powerFactor: c.fatorPotencia ?? 0.92,
    correction: c.fca ?? 1,
    dropLimit: c.quedaMaxima ?? 4,
  }));
  return { points, runs, circuits };
}
