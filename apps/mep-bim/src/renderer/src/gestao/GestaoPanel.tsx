// Gestão da informação (ISO 19650): codificação do projeto, documentos (folhas e modelos IFC por
// disciplina) com revisão, estado e histórico, e emissões (GRD) com a lista em PDF e CSV.
import { useMemo, useState } from "react";
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

interface Props {
  store: PointsStore;
  /** Disciplinas com modelo (IFC) neste projeto. */
  modelDisciplines: Discipline[];
  /** Nível (código) e disciplina (código) padrão de cada folha. */
  sheetDefaults: (s: SheetDef) => { nivel: string; disciplina: string };
  onOpenSheet: (id: string) => void;
}

interface Doc {
  id: string;
  titulo: string;
  formato: string;
  meta: DocMeta;
}

const today = () => new Date().toLocaleDateString("pt-BR");
const STATES: CdeState[] = ["andamento", "compartilhado", "publicado", "arquivado"];

export function GestaoPanel({ store, modelDisciplines, sheetDefaults, onOpenSheet }: Props) {
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
  return (
    <div className="panel-body gestao">
      <div className="panel-head">
        <h3>Gestão da informação (ISO 19650)</h3>
      </div>
      <section className="card">
        <h4>Codificação do projeto</h4>
        <div className="form-grid">
          <label title="Código curto do projeto/empreendimento (ex.: HTL)">
            Projeto
            <input value={c.projeto} onChange={(e) => setCoding({ projeto: e.target.value })} placeholder="HTL" />
          </label>
          <label title="Empresa que produz a informação (ex.: SEB)">
            Originador
            <input value={c.originador} onChange={(e) => setCoding({ originador: e.target.value })} placeholder="SEB" />
          </label>
          <label title="Volume/zona padrão (ZZ = vários; XX = nenhum)">
            Volume / zona
            <input value={c.volume} onChange={(e) => setCoding({ volume: e.target.value })} placeholder="ZZ" />
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
        <button className="btn primary" disabled={!picked.size} onClick={doEmit}>
          Emitir {picked.size || ""} documento(s)
        </button>
        <p className="muted small">
          A emissão gera a revisão de cada documento (P01, P02…; ao publicar, C01…), registra no histórico e cria a GRD.
        </p>
      </section>

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
