// Arquivo de projeto (.locacao.json): pontos locados e trechos, em
// coordenadas do IFC de origem. Versão 2 acrescenta "trechos"; a versão 1
// (só pontos) continua sendo lida.
import type { CoordinateSystem } from "./math";
import { deserializePoints, serializePoints, type LocacaoFile, type PlacedPoint } from "./points";
import { newRunId, RUN_TYPE_BY_ID, type Run } from "./runs";
import { newCircuitId, type Circuit, type CircuitType } from "./circuits";
import type { Vec3 } from "./types";
import { EMPTY_PROGRAM, type ProgramState } from "./program";
import type { LinkMeta } from "../ifc/federate";
import type { GeorefSettings } from "./georef";
import { syncDraftIds, type DraftEntity } from "./draft";
import { migrateViews, type ViewDef } from "./views";
import type { SheetDef } from "./viewDrawing";
import type { Discipline } from "./types";
import type { ProjectChoices } from "./alternatives";

/** Vista 3D criada pelo usuário (coordenadas do projeto, m). */
export interface SavedView {
  id: string;
  name: string;
  eye: Vec3;
  target: Vec3;
}

export interface ProjectData {
  points: PlacedPoint[];
  runs: Run[];
  circuits: Circuit[];
  /** Programa de necessidades por ambiente (versão 4). */
  program?: ProgramState;
  /** Vínculos IFC (referências externas). */
  links?: LinkMeta[];
  /** Coordenadas do projeto (do IFC ou informadas). */
  georef?: GeorefSettings | null;
  /** Desenho 2D (anotações) na planta. */
  drafts?: DraftEntity[];
  /** Vistas (trabalho e documentação): plantas, ampliações, cortes e 3D. */
  views?: ViewDef[];
  /** Folhas com as vistas de documentação. */
  sheets?: SheetDef[];
  /** Disciplinas que este projeto entrega (o IFC da disciplina). */
  disciplines?: Discipline[];
  /** Marca de referência por grupo e elemento escolhido entre equivalentes. */
  choices?: ProjectChoices;
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
  programa?: ProgramState;
  georreferenciamento?: GeorefSettings;
  desenhos?: DraftEntity[];
  vistas?: ViewDef[];
  folhas?: SheetDef[];
  disciplinas?: Discipline[];
  marcas?: Record<string, string>;
  variantes?: Record<string, string>;
  vinculos?: { id: string; nome: string; caminho: string | null; disciplina: LinkMeta["discipline"]; visivel: boolean; transparente: boolean; alinhamento?: LinkMeta["align"] }[];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function serializeProject(data: ProjectData, cs: CoordinateSystem, modelName: string | null): ProjectFile {
  return {
    ...serializePoints(data.points, cs, modelName),
    versao: 4,
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
    ...(data.program && Object.keys(data.program.rooms).length ? { programa: data.program } : {}),
    ...(data.georef ? { georreferenciamento: data.georef } : {}),
    ...(data.drafts?.length ? { desenhos: data.drafts } : {}),
    ...(data.views?.length ? { vistas: data.views } : {}),
    ...(data.sheets?.length ? { folhas: data.sheets } : {}),
    ...(data.disciplines?.length ? { disciplinas: data.disciplines } : {}),
    ...(data.choices && Object.keys(data.choices.brands).length ? { marcas: data.choices.brands } : {}),
    ...(data.choices && Object.keys(data.choices.variants).length ? { variantes: data.choices.variants } : {}),
    ...(data.links?.length
      ? { vinculos: data.links.map((l) => ({ id: l.id, nome: l.name, caminho: l.path, disciplina: l.discipline, visivel: l.visible, transparente: l.translucent, ...(l.align ? { alinhamento: l.align } : {}) })) }
      : {}),
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
  const program: ProgramState = file.programa && typeof file.programa === "object" && file.programa.rooms ? file.programa : EMPTY_PROGRAM;
  const links: LinkMeta[] = (file.vinculos ?? []).map((v) => ({
    id: v.id,
    name: v.nome,
    path: v.caminho ?? null,
    discipline: v.disciplina ?? "auto",
    visible: v.visivel !== false,
    translucent: !!v.transparente,
    ...(v.alinhamento ? { align: v.alinhamento } : {}),
  }));
  const drafts = Array.isArray(file.desenhos) ? file.desenhos : [];
  syncDraftIds(drafts);
  return { points, runs, circuits, program, links, georef: file.georreferenciamento ?? null, drafts,
    views: migrateViews(file.vistas),
    sheets: Array.isArray(file.folhas) ? file.folhas : [],
    disciplines: Array.isArray(file.disciplinas) ? file.disciplinas : [],
    choices: { brands: file.marcas ?? {}, variants: file.variantes ?? {} },
  };
}
