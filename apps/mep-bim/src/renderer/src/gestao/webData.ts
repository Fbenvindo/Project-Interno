// Troca de dados com o SmartEasyWEB (API dos aplicativos, /api/app/dados): perfil do
// empreendimento, ambientes e equipamentos, quadros e circuitos, resultados dos cálculos.
// Precisa da sessão do SmartEasyWEB e do projeto ligado a um empreendimento (Documentos e emissões).
import type { BuildingProfile } from "../../../core/building";
import { json, loadSession, type CdeSession } from "./cdeClient";
import type { WebRoomIn, WebRoomOut } from "../programa/webRooms";
import type { WebCircuitResult, WebPanelOut } from "../circuitos/webCircuits";

export interface WebLink {
  session: CdeSession;
  empId: string;
  empreendimento: string;
}

/** Sessão + empreendimento ligado, ou o motivo de não haver. */
export function webLink(servidor: { url: string; empreendimentoId: string; empreendimento: string } | undefined): WebLink | string {
  const session = loadSession();
  if (!session) return "Entre no SmartEasyWEB em Pranchas › Documentos e emissões.";
  if (!servidor) return "Ligue o projeto a um empreendimento do SmartEasyWEB em Pranchas › Documentos e emissões.";
  if (servidor.url.replace(/\/+$/, "") !== session.url.replace(/\/+$/, "")) return `O projeto está ligado a ${servidor.url}; entre nesse SmartEasyWEB.`;
  return { session, empId: servidor.empreendimentoId, empreendimento: servidor.empreendimento };
}

const enc = encodeURIComponent;

export const web = {
  profile: (l: WebLink) => json<BuildingProfile & { atualizado: string }>(l.session, "GET", `/api/app/dados/${enc(l.empId)}/perfil`),
  putProfile: (l: WebLink, p: BuildingProfile) =>
    json<{ criados: number; atualizados: number; mantidos: number; perfil: BuildingProfile }>(l.session, "PUT", `/api/app/dados/${enc(l.empId)}/perfil`, p),
  rooms: (l: WebLink) => json<WebRoomIn[]>(l.session, "GET", `/api/app/dados/${enc(l.empId)}/ambientes`),
  putRooms: (l: WebLink, ambientes: WebRoomOut[]) =>
    json<{ ambientesCriados: number; ambientesAtualizados: number; pavimentosCriados: number; equipamentos: number; removidos: number }>(l.session, "PUT", `/api/app/dados/${enc(l.empId)}/ambientes`, { ambientes }),
  putPanels: (l: WebLink, quadros: WebPanelOut[]) =>
    json<{ quadrosCriados: number; quadrosAtualizados: number; circuitosCriados: number; circuitosAtualizados: number; circuitosRemovidos: number; cargas: number }>(
      l.session,
      "PUT",
      `/api/app/dados/${enc(l.empId)}/quadros`,
      { quadros },
    ),
  results: (l: WebLink) =>
    json<{ quadros: { guid: string; nome: string; calculo: string }[]; circuitos: WebCircuitResult[]; calculadoEm: string }>(l.session, "GET", `/api/app/dados/${enc(l.empId)}/resultados`),
};
