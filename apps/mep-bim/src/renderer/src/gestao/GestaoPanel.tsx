// Gestão da informação (ISO 19650): codificação do projeto, documentos (folhas e modelos IFC por
// disciplina) com revisão, estado e histórico, e emissões (GRD) com a lista em PDF e CSV.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  changeState,
  docCode,
  DOC_TYPES,
  emissionCsv,
  emissionSvg,
  hasCoding,
  modelDocMeta,
  nextEmissionNumber,
  sheetDocMeta,
  STATE_LABEL,
  SUITABILITY,
  suitabilityLabel,
  type CdeData,
  type CdeState,
  type DocMeta,
  type Emission,
} from "../../../core/cde";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import type { Discipline } from "../../../core/types";
import type { SheetDef } from "../../../core/viewDrawing";
import type { PointsStore } from "../locacao/usePointsStore";
import { saveFile, savePdf } from "../platform";
import type { LinkMeta } from "../../../ifc/federate";
import { ClashPendencias } from "./ClashPendencias";
import { cde as cdeServer, DEFAULT_CDE_URL, isModelFile, loadSession, saveSession, type CdeSession, type Overview, type ServerDoc } from "./cdeClient";

interface Props {
  store: PointsStore;
  /** Disciplinas com modelo (IFC) neste projeto. */
  modelDisciplines: Discipline[];
  /** Nível (código) e disciplina (código) padrão de cada folha. */
  sheetDefaults: (s: SheetDef) => { nivel: string; disciplina: string };
  onOpenSheet: (id: string) => void;
  /** Arquivo de um documento (folha em PDF, modelo em IFC) para enviar ao CDE do servidor. */
  makeFile: (docId: string) => Promise<{ name: string; bytes: Uint8Array; contentType: string } | null>;
  /** Vincula (ou atualiza) um modelo de outra disciplina vindo do CDE. */
  onLinkFromCde: (doc: ServerDoc) => Promise<void>;
  links: LinkMeta[];
  linkStatus: Record<string, string>;
  /** Seleciona e enquadra no 3D os elementos com esses GlobalIds; devolve quantos achou. */
  onGoToElements?: (globalIds: string[]) => number;
}

interface Doc {
  id: string;
  titulo: string;
  formato: string;
  meta: DocMeta;
}

const today = () => new Date().toLocaleDateString("pt-BR");
const cde_link = (x: CdeData) => x.servidor ?? null;
const STATES: CdeState[] = ["andamento", "compartilhado", "publicado", "arquivado"];

export function GestaoPanel({ store, modelDisciplines, sheetDefaults, onOpenSheet, makeFile, onLinkFromCde, links, linkStatus, onGoToElements }: Props) {
  const cde = store.cde;
  const c = cde.coding;
  const docs = useMemo<Doc[]>(
    () => [
      ...store.sheets.map((s, i) => {
        const d = sheetDefaults(s);
        return { id: s.id, titulo: s.info.conteudo || s.name, formato: "PDF", meta: sheetDocMeta(s, i, d.nivel, d.disciplina) };
      }),
      ...modelDisciplines.map((d) => ({ id: `modelo:${d}`, titulo: `Modelo IFC — ${DISCIPLINE_BY_ID[d].label}`, formato: "IFC", meta: modelDocMeta(cde, d) })),
    ],
    [store.sheets, modelDisciplines, cde, sheetDefaults],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [emit, setEmit] = useState({ estado: "compartilhado" as CdeState, finalidade: "S1", destinatario: "", observacoes: "" });
  const [stateEdit, setStateEdit] = useState({ estado: "compartilhado" as CdeState, finalidade: "S1", descricao: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const setCoding = (patch: Partial<CdeData["coding"]>) => store.setCde((x) => ({ ...x, coding: { ...x.coding, ...patch } }), "codificacao");
  /** Grava os campos de um documento (folha ou modelo) num único passo de desfazer. */
  const writeMetas = (metas: Map<string, DocMeta>, extra?: (cde: CdeData) => CdeData) =>
    store.mutate((cur) => {
      const sheets = cur.sheets.map((s) => (metas.has(s.id) ? { ...s, cde: metas.get(s.id) } : s));
      let next: CdeData = { ...cur.cde, modelos: { ...cur.cde.modelos } };
      for (const [id, m] of metas) if (id.startsWith("modelo:")) next.modelos[id.slice(7) as Discipline] = m;
      if (extra) next = extra(next);
      return { ...cur, sheets, cde: next };
    });
  const setMeta = (doc: Doc, patch: Partial<DocMeta>) => writeMetas(new Map([[doc.id, { ...doc.meta, ...patch }]]));

  const downloadGrd = async (e: Emission) => {
    const saved = await savePdf({ defaultName: `${e.numero}.pdf`, svg: emissionSvg(e, c), widthMm: 210, heightMm: 297 });
    if (saved) setMsg(`GRD em PDF: ${saved}`);
  };
  const downloadCsv = async (e: Emission) => {
    const saved = await saveFile({ defaultName: `${e.numero}.csv`, content: "﻿" + emissionCsv(e, c), filters: [{ name: "Planilha (CSV)", extensions: ["csv"] }] });
    if (saved) setMsg(`Lista em CSV: ${saved}`);
  };

  const doEmit = () => {
    const chosen = docs.filter((d) => picked.has(d.id));
    if (!chosen.length) return setMsg("Marque os documentos da emissão.");
    const numero = nextEmissionNumber(cde.emissoes);
    const data = today();
    const metas = new Map<string, DocMeta>();
    const itens = chosen.map((d) => {
      const m = changeState(d.meta, emit.estado, emit.finalidade, `Emissão ${numero}${emit.observacoes ? `: ${emit.observacoes}` : ""}`, c.autor, data);
      metas.set(d.id, m);
      return { docId: d.id, codigo: docCode(c, m), titulo: d.titulo, revisao: m.revisao, estado: m.estado, finalidade: m.finalidade, formato: d.formato };
    });
    const e: Emission = { id: `grd-${Date.now().toString(36)}`, numero, data, destinatario: emit.destinatario, finalidade: emit.finalidade, observacoes: emit.observacoes, autor: c.autor, itens };
    writeMetas(metas, (x) => ({ ...x, emissoes: [...x.emissoes, e] }));
    setPicked(new Set());
    setMsg(`${numero} registrada com ${itens.length} documento(s). Baixe a GRD em PDF ou CSV em Emissões, e exporte cada documento (os arquivos já saem com o código e a revisão).`);
  };

  const ready = hasCoding(c);

  // ---- CDE do servidor (SmartEasyBIM CDE na rede do escritório) ------------------------------------------------------
  const [session, setSession] = useState<CdeSession | null>(loadSession);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [emps, setEmps] = useState<{ id: number; nome: string }[] | null>(null);
  const [loginForm, setLoginForm] = useState({ url: session?.url ?? DEFAULT_CDE_URL, email: "", password: "" });
  const [srvBusy, setSrvBusy] = useState<string | null>(null);
  const link = cde_link(cde);
  const linked = !!(session && link);

  /** Traz do servidor a codificação e a revisão/estado dos documentos ligados. */
  const refresh = useCallback(async () => {
    if (!session || !link) return;
    const ov = await cdeServer.overview(session, link.empreendimentoId);
    setOverview(ov);
    // Cada documento do projeto acha o seu no CDE pelo id ou, se ainda não ligado, pelo código.
    const coding = ov.config.projeto ? { ...c, projeto: ov.config.projeto, originador: ov.config.originador, volume: ov.config.volume } : c;
    const byId = new Map(ov.documentos.map((d) => [d.id, d]));
    const byCode = new Map(ov.documentos.map((d) => [d.codigo, d]));
    const metas = new Map<string, DocMeta>();
    for (const d of docs) {
      const sd = (d.meta.cdeId != null ? byId.get(d.meta.cdeId) : undefined) ?? byCode.get(docCode(coding, d.meta));
      if (sd) metas.set(d.id, { ...d.meta, cdeId: sd.id, revisao: sd.revisao, estado: sd.estado, finalidade: sd.finalidade });
    }
    writeMetas(metas, (x) => ({ ...x, coding }));
  }, [session, link?.empreendimentoId, docs, c]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (linked) refresh().catch((e) => setMsg(`CDE: ${e.message}`));
  }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverRun = async (label: string, fn: () => Promise<string | void>) => {
    setSrvBusy(label);
    setMsg(null);
    try {
      const done = await fn();
      if (done) setMsg(done);
    } catch (e) {
      setMsg(`CDE: ${e instanceof Error ? e.message : e}`);
      if (/expirada/.test(String(e))) {
        saveSession(null);
        setSession(null);
      }
    } finally {
      setSrvBusy(null);
    }
  };

  /** Garante o documento no servidor (cria com o mesmo código, ou acha o existente) e devolve o id. */
  const ensureServerDoc = async (d: Doc, ov: Overview): Promise<number> => {
    if (d.meta.cdeId != null && ov.documentos.some((x) => x.id === d.meta.cdeId)) return d.meta.cdeId;
    const code = docCode({ ...c, ...ov.config }, d.meta);
    const found = ov.documentos.find((x) => x.codigo === code);
    if (found) return found.id;
    const created = await cdeServer.createDoc(session!, link!.empreendimentoId, {
      titulo: d.titulo,
      tipo: d.meta.tipo,
      disciplina: d.meta.disciplina,
      nivel: d.meta.nivel,
      numero: d.meta.numero,
      volume: d.meta.volume ?? "",
      origem: "smarteasybim",
    });
    return created.id;
  };

  /** Envia a versão atual dos documentos marcados (PDF das folhas, IFC dos modelos). */
  const sendToCde = async (ids: string[]): Promise<Map<string, number>> => {
    const ov = await cdeServer.overview(session!, link!.empreendimentoId);
    const sent = new Map<string, number>();
    for (const d of docs.filter((x) => ids.includes(x.id))) {
      setSrvBusy(`Enviando ${d.titulo}…`);
      const id = await ensureServerDoc(d, ov);
      const f = await makeFile(d.id);
      if (!f) throw new Error(`Não foi possível gerar o arquivo de ${d.titulo}.`);
      await cdeServer.upload(session!, id, f.name, f.bytes, f.contentType, "Enviado pelo SmartEasyBIM");
      sent.set(d.id, id);
    }
    writeMetas(new Map([...sent].map(([docId, id]) => [docId, { ...docs.find((x) => x.id === docId)!.meta, cdeId: id }])));
    await refresh();
    return sent;
  };

  const references = useMemo(() => {
    // Documentos deste projeto (pelo id no CDE ou pelo código): não são referências.
    const mine = new Set(docs.map((d) => d.meta.cdeId).filter((x): x is number => x != null));
    const myCodes = new Set(docs.map((d) => docCode({ ...c, ...(overview?.config ?? {}) }, d.meta)));
    return (overview?.documentos ?? []).filter((d) => isModelFile(d.arquivo_nome) && (d.estado === "compartilhado" || d.estado === "publicado") && !mine.has(d.id) && !myCodes.has(d.codigo));
  }, [overview, docs, c]);

  return (
    <div className="panel-body gestao">
      <div className="panel-head">
        <h3>Gestão da informação (ISO 19650)</h3>
      </div>
      <section className="card">
        <h4>CDE do servidor</h4>
        {!session && (
          <>
            <p className="muted small">Entre com seu usuário do SmartEasyBIM CDE (o servidor do escritório) para publicar folhas e modelos no CDE do empreendimento e vincular os modelos das outras disciplinas. O endereço aparece no painel do servidor do CDE (ex.: http://servidor:4000).</p>
            <div className="form-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                Endereço
                <input value={loginForm.url} placeholder="http://servidor:4000" onChange={(e) => setLoginForm({ ...loginForm, url: e.target.value })} />
              </label>
              <label>
                E-mail
                <input value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
              </label>
              <label>
                Senha
                <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
              </label>
            </div>
            <button
              className="btn primary"
              disabled={!!srvBusy || !loginForm.email || !loginForm.password}
              onClick={() =>
                serverRun("Entrando…", async () => {
                  const s = await cdeServer.login(loginForm.url, loginForm.email, loginForm.password);
                  saveSession(s);
                  setSession(s);
                  setLoginForm({ ...loginForm, password: "" });
                  return `Conectado ao CDE como ${s.user.name ?? s.user.email}.`;
                })
              }
            >
              Entrar
            </button>
          </>
        )}
        {session && !link && (
          <>
            <p className="muted small">
              Conectado como {session.user.name ?? session.user.email}.{" "}
              <button className="link" onClick={() => (saveSession(null), setSession(null))}>
                sair
              </button>
            </p>
            {!emps ? (
              <button className="btn" disabled={!!srvBusy} onClick={() => serverRun("Carregando…", async () => setEmps((await cdeServer.empreendimentos(session)).map((e) => ({ id: e.id, nome: e.nome }))))}>
                Escolher o empreendimento
              </button>
            ) : (
              <ul className="sel-list">
                {emps.map((e) => (
                  <li key={e.id}>
                    <span className="grow">{e.nome}</span>
                    <button className="link" onClick={() => store.setCde((x) => ({ ...x, servidor: { url: session.url, empreendimentoId: e.id, empreendimento: e.nome } }))}>
                      ligar este projeto
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {link && (
          <>
            <p className="small">
              Empreendimento: <b>{link.empreendimento}</b>
              {overview && ` · ${overview.documentos.length} documento(s) no CDE`}
              {!session && <span className="muted"> — entre no CDE para sincronizar.</span>}
            </p>
            <div className="btn-row wrap tight">
              {session && (
                <button className="btn small" disabled={!!srvBusy} onClick={() => serverRun("Atualizando…", async () => (await refresh(), "Atualizado do CDE."))}>
                  Atualizar do CDE
                </button>
              )}
              <button className="btn small" onClick={() => window.confirm("Desligar este projeto do empreendimento no CDE? Os documentos no servidor ficam.") && store.setCde((x) => ({ ...x, servidor: undefined }))}>
                Desligar
              </button>
              {session && (
                <button className="link" onClick={() => (saveSession(null), setSession(null))}>
                  sair ({session.user.name ?? session.user.email})
                </button>
              )}
            </div>
          </>
        )}
        {srvBusy && <p className="muted small">{srvBusy}</p>}
      </section>

      <section className="card">
        <h4>Codificação do projeto</h4>
        {linked && <p className="muted small">Codificação do empreendimento no CDE (alterada pela coordenação no CDE).</p>}
        <div className="form-grid">
          <label title="Código curto do projeto/empreendimento (ex.: HTL)">
            Projeto
            <input value={c.projeto} onChange={(e) => setCoding({ projeto: e.target.value })} disabled={linked} placeholder="HTL" />
          </label>
          <label title="Empresa que produz a informação (ex.: SEB)">
            Originador
            <input value={c.originador} onChange={(e) => setCoding({ originador: e.target.value })} disabled={linked} placeholder="SEB" />
          </label>
          <label title="Volume/zona padrão (ZZ = vários; XX = nenhum)">
            Volume / zona
            <input value={c.volume} onChange={(e) => setCoding({ volume: e.target.value })} disabled={linked} placeholder="ZZ" />
          </label>
          <label title="Quem emite as revisões">
            Responsável
            <input value={c.autor} onChange={(e) => setCoding({ autor: e.target.value })} />
          </label>
        </div>
        <p className="muted small">
          Código dos documentos: Projeto-Originador-Volume-Nível-Tipo-Disciplina-Número (ex.: {docCode(c, { nivel: "01", tipo: "DR", disciplina: "EL", numero: "1" })}).
          {!ready && " Preencha Projeto e Originador para os arquivos exportados saírem com o código."}
        </p>
      </section>

      <section className="card">
        <h4>
          Documentos{" "}
          <button className="link" onClick={() => setPicked(picked.size === docs.length ? new Set() : new Set(docs.map((d) => d.id)))}>
            {picked.size === docs.length && docs.length ? "desmarcar" : "marcar todos"}
          </button>
        </h4>
        {!docs.length && <p className="muted small">Sem folhas nem modelos ainda. Crie folhas em Pranchas e locar/traçar gera os modelos por disciplina.</p>}
        <ul className="gestao-docs">
          {docs.map((d) => {
            const isOpen = open === d.id;
            return (
              <li key={d.id} className={`gestao-doc ${isOpen ? "open" : ""}`}>
                <div className="gestao-row">
                  <input
                    type="checkbox"
                    checked={picked.has(d.id)}
                    onChange={() => setPicked((p) => {
                      const n = new Set(p);
                      if (n.has(d.id)) n.delete(d.id);
                      else n.add(d.id);
                      return n;
                    })}
                  />
                  <button className="link gestao-code" onClick={() => setOpen(isOpen ? null : d.id)} title="Editar código, estado e ver o histórico">
                    {docCode(c, d.meta)}
                  </button>
                  <span className="badge">{d.meta.revisao}</span>
                  <span className={`gestao-state ${d.meta.estado}`} title={suitabilityLabel(d.meta.finalidade)}>
                    {STATE_LABEL[d.meta.estado]}
                  </span>
                </div>
                <div className="muted small gestao-title">
                  {d.titulo} · {d.formato}
                  {!d.id.startsWith("modelo:") && (
                    <button className="link" onClick={() => onOpenSheet(d.id)}>
                      abrir
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="gestao-edit">
                    <div className="form-grid">
                      <label>
                        Nível
                        <input value={d.meta.nivel} onChange={(e) => setMeta(d, { nivel: e.target.value })} />
                      </label>
                      <label>
                        Tipo
                        <select value={d.meta.tipo} onChange={(e) => setMeta(d, { tipo: e.target.value })}>
                          {DOC_TYPES.map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.code} — {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Disciplina
                        <input value={d.meta.disciplina} onChange={(e) => setMeta(d, { disciplina: e.target.value })} />
                      </label>
                      <label>
                        Número
                        <input value={d.meta.numero} onChange={(e) => setMeta(d, { numero: e.target.value })} />
                      </label>
                      <label title="Vazio: o do projeto">
                        Volume
                        <input value={d.meta.volume ?? ""} placeholder={c.volume} onChange={(e) => setMeta(d, { volume: e.target.value })} />
                      </label>
                      <label title="Ajuste manual da revisão atual">
                        Revisão
                        <input value={d.meta.revisao} onChange={(e) => setMeta(d, { revisao: e.target.value.toUpperCase() })} />
                      </label>
                    </div>
                    <div className="form-grid">
                      <label>
                        Mudar estado para
                        <select value={stateEdit.estado} onChange={(e) => setStateEdit({ ...stateEdit, estado: e.target.value as CdeState, finalidade: SUITABILITY[e.target.value as CdeState][0].code })}>
                          {STATES.map((s) => (
                            <option key={s} value={s}>
                              {STATE_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Finalidade
                        <select value={stateEdit.finalidade} onChange={(e) => setStateEdit({ ...stateEdit, finalidade: e.target.value })}>
                          {SUITABILITY[stateEdit.estado].map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.code} — {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Descrição da revisão
                        <input value={stateEdit.descricao} onChange={(e) => setStateEdit({ ...stateEdit, descricao: e.target.value })} placeholder="ex.: ajuste dos circuitos do 2º pavimento" />
                      </label>
                    </div>
                    <button
                      className="btn small"
                      onClick={() => {
                        setMeta(d, changeState(d.meta, stateEdit.estado, stateEdit.finalidade, stateEdit.descricao, c.autor, today()));
                        setStateEdit({ ...stateEdit, descricao: "" });
                      }}
                    >
                      Aplicar
                    </button>
                    {d.meta.historico.length > 0 && (
                      <table className="gestao-hist">
                        <tbody>
                          {[...d.meta.historico].reverse().map((h, i) => (
                            <tr key={i}>
                              <td>{h.rev}</td>
                              <td>{h.data}</td>
                              <td>
                                {STATE_LABEL[h.estado]} ({h.finalidade})
                              </td>
                              <td>{h.descricao}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h4>Emitir (GRD)</h4>
        <div className="form-grid">
          <label>
            Estado
            <select value={emit.estado} onChange={(e) => setEmit({ ...emit, estado: e.target.value as CdeState, finalidade: SUITABILITY[e.target.value as CdeState][0].code })}>
              <option value="compartilhado">Compartilhado</option>
              <option value="publicado">Publicado</option>
            </select>
          </label>
          <label>
            Finalidade
            <select value={emit.finalidade} onChange={(e) => setEmit({ ...emit, finalidade: e.target.value })}>
              {SUITABILITY[emit.estado].map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Destinatário
            <input value={emit.destinatario} onChange={(e) => setEmit({ ...emit, destinatario: e.target.value })} placeholder="ex.: Construtora X / Coordenação" />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Observações
            <input value={emit.observacoes} onChange={(e) => setEmit({ ...emit, observacoes: e.target.value })} />
          </label>
        </div>
        {linked ? (
          <div className="btn-row wrap tight">
            <button
              className="btn"
              disabled={!picked.size || !!srvBusy}
              onClick={() => serverRun("Enviando…", async () => (await sendToCde([...picked]), `${picked.size} documento(s) enviado(s) ao CDE (nova versão, em andamento).`))}
            >
              Enviar ao CDE
            </button>
            <button
              className="btn primary"
              disabled={!picked.size || !!srvBusy}
              onClick={() =>
                serverRun("Emitindo…", async () => {
                  const sent = await sendToCde([...picked]);
                  const r = await cdeServer.emit(session!, link!.empreendimentoId, { documento_ids: [...sent.values()], estado: emit.estado, finalidade: emit.finalidade, destinatario: emit.destinatario, observacoes: emit.observacoes });
                  await refresh();
                  setPicked(new Set());
                  return `${r.numero} emitida no CDE com ${r.itens.length} documento(s). A GRD fica no CDE (página do empreendimento).`;
                })
              }
            >
              Emitir no CDE {picked.size || ""} documento(s)
            </button>
          </div>
        ) : (
          <button className="btn primary" disabled={!picked.size} onClick={doEmit}>
            Emitir {picked.size || ""} documento(s)
          </button>
        )}
        <p className="muted small">
          A emissão gera a revisão de cada documento (P01, P02…; ao publicar, C01…), registra no histórico e cria a GRD.
        </p>
      </section>

      {linked && (
        <section className="card">
          <h4>Modelos das outras disciplinas (CDE)</h4>
          {!references.length && <p className="muted small">Nenhum modelo (IFC ou .sebmod) compartilhado ou publicado pelas outras disciplinas neste empreendimento.</p>}
          <ul className="sel-list">
            {references.map((d) => {
              const l = links.find((x) => x.cde?.docId === d.id);
              const outdated = l && l.cde!.revisao !== d.revisao;
              return (
                <li key={d.id}>
                  <span className="grow" title={d.arquivo_nome ?? ""}>
                    <span className="gestao-code">{d.codigo}</span> <span className="badge">{d.revisao}</span> <span className={`gestao-state ${d.estado}`}>{d.estado === "publicado" ? "Publicado" : "Compartilhado"}</span>
                    <br />
                    <span className="muted small">
                      {d.titulo}
                      {l && (outdated ? ` · vinculado na ${l.cde!.revisao}: há versão nova` : ` · vinculado${linkStatus[l.id] ? ` (${linkStatus[l.id]})` : ""}`)}
                    </span>
                  </span>
                  {(!l || outdated) && (
                    <button className="btn small" disabled={!!srvBusy} onClick={() => serverRun(`Baixando ${d.codigo}…`, async () => (await onLinkFromCde(d), `${d.codigo} ${d.revisao} ${l ? "atualizado" : "vinculado"}.`))}>
                      {l ? `Atualizar para ${d.revisao}` : "Vincular"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {linked && onGoToElements && (
        <ClashPendencias
          session={session!}
          empreendimentoId={link!.empreendimentoId}
          docIds={docs.map((d) => d.meta.cdeId).filter((x): x is number => x != null)}
          onGoTo={onGoToElements}
        />
      )}

      <section className="card">
        <h4>Emissões ({cde.emissoes.length})</h4>
        {!cde.emissoes.length && <p className="muted small">Nenhuma emissão ainda.</p>}
        <ul className="sel-list">
          {[...cde.emissoes].reverse().map((e) => (
            <li key={e.id}>
              <span className="grow">
                <b>{e.numero}</b> · {e.data} · {e.itens.length} doc(s) · {e.finalidade} {e.destinatario && `· ${e.destinatario}`}
              </span>
              <button className="link" onClick={() => void downloadGrd(e)}>
                PDF
              </button>
              <button className="link" onClick={() => void downloadCsv(e)}>
                CSV
              </button>
            </li>
          ))}
        </ul>
      </section>
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}
