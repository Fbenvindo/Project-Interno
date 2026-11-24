// Interferências do projeto no CDE do servidor: as pendências em aberto (colisões e folgas) das
// análises mais recentes que envolvem os modelos deste projeto. "Ver" seleciona os elementos no
// 3D pelo GlobalId (deste projeto e dos vínculos); dá para comentar e marcar como resolvida.
import { useCallback, useEffect, useMemo, useState } from "react";
import { clash, type CdeSession, type ClashItem, type ClashPending } from "./cdeClient";

interface Props {
  session: CdeSession;
  empreendimentoId: number;
  /** Documentos do CDE que são deste projeto (para filtrar as interferências). */
  docIds: number[];
  /** Seleciona e enquadra no 3D os elementos com esses GlobalIds; devolve quantos achou. */
  onGoTo: (globalIds: string[]) => number;
}

const cm = (m: number) => `${(Math.abs(m) * 100).toFixed(1).replace(".", ",")} cm`;
const STATE_LABEL: Record<string, string> = { nova: "Nova", ativa: "Ativa", resolvida: "Resolvida", aprovada: "Aprovada" };

export function ClashPendencias({ session, empreendimentoId, docIds, onGoTo }: Props) {
  const [data, setData] = useState<ClashPending | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const key = docIds.join(",");

  const load = useCallback(async () => {
    try {
      setData(await clash.pending(session, empreendimentoId, key ? key.split(",").map(Number) : []));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [session, empreendimentoId, key]);
  useEffect(() => {
    load();
  }, [load]);

  const total = useMemo(() => (data?.analises ?? []).reduce((n, a) => n + a.interferencias.length, 0), [data]);
  const mine = (c: ClashItem) => (docIds.includes(c.a.documento_id) ? c.a : c.b);
  const other = (c: ClashItem) => (docIds.includes(c.a.documento_id) ? c.b : c.a);

  const update = async (analiseId: number, c: ClashItem, estado?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await clash.update(session, analiseId, { ids: [c.id], ...(estado ? { estado } : {}), comentario: comment.trim() || undefined, origem: "smarteasybim" });
      setComment("");
      setMsg(estado === "resolvida" ? `#${c.numero} marcada como resolvida no CDE.` : `#${c.numero} atualizada no CDE.`);
      await load();
    } catch (e) {
      setMsg(`Erro: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h4>
        Interferências do projeto (CDE) {data ? `· ${total} em aberto` : ""}
        <button className="btn small" style={{ marginLeft: 8 }} onClick={load} disabled={busy}>
          Atualizar
        </button>
      </h4>
      {err && <p className="muted small">Não foi possível buscar as interferências: {err}</p>}
      {data && !total && <p className="muted small">Nenhuma interferência em aberto envolvendo os modelos deste projeto nas análises do CDE.</p>}
      {data?.analises.map(({ analise, interferencias }) => (
        <div key={analise.id}>
          <p className="muted small">
            <b>{analise.nome}</b> · {new Date(analise.concluida_at).toLocaleDateString("pt-BR")} · {analise.modelos.map((m) => `${m.codigo} ${m.revisao}`).join(", ")}
          </p>
          <ul className="sel-list">
            {interferencias.map((c) => {
              const a = mine(c);
              const b = other(c);
              return (
                <li key={c.id} style={{ display: "block" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span className="grow">
                      <b>#{c.numero}</b> {c.tipo === "colisao" ? "Colisão" : "Folga"} · {a.nome} × {b.nome} <span className="muted small">({b.codigo})</span>
                      <br />
                      <span className="muted small">
                        {c.pavimento ?? "sem pavimento"} · {c.tipo === "colisao" ? `sobreposição ~${cm(c.distancia)}` : `distância ${cm(c.distancia)}`} · {STATE_LABEL[c.estado]}
                        {c.situacao === "nova" ? " · nova" : c.situacao === "reaberta" ? " · reaberta" : ""}
                        {c.responsavel_nome ? ` · ${c.responsavel_nome}` : ""}
                      </span>
                    </span>
                    <button
                      className="btn small"
                      title="Seleciona os dois elementos no 3D (deste projeto e do vínculo)"
                      onClick={() => {
                        const n = onGoTo([c.a.globalId, c.b.globalId].filter(Boolean));
                        setMsg(n ? null : `Os elementos da #${c.numero} não estão carregados (GlobalId não encontrado): vincule o modelo ${b.codigo} e confira se o modelo do projeto é o mesmo enviado ao CDE.`);
                      }}
                    >
                      Ver
                    </button>
                    <button className="btn small" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      {open === c.id ? "Fechar" : "Tratar"}
                    </button>
                  </div>
                  {open === c.id && (
                    <div style={{ marginTop: 6 }}>
                      {(c.comentarios ?? []).slice(-4).map((k) => (
                        <p key={k.id} className="muted small" style={{ margin: "2px 0" }}>
                          {k.autor} ({new Date(k.created_at).toLocaleDateString("pt-BR")}): {k.texto}
                        </p>
                      ))}
                      <textarea value={comment} placeholder="Comentário (ex.: desviado no traçado, sobe 30 cm)" onChange={(e) => setComment(e.target.value)} style={{ width: "100%", minHeight: 48 }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button className="btn small" disabled={busy || (!comment.trim() && c.estado === "ativa")} onClick={() => update(analise.id, c, c.estado === "nova" ? "ativa" : undefined)}>
                          {c.estado === "nova" ? "Em tratamento" : "Comentar"}
                        </button>
                        <button className="btn small primary" disabled={busy} onClick={() => update(analise.id, c, "resolvida")}>
                          Resolvida
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {msg && <p className="muted small">{msg}</p>}
      <p className="muted small">A próxima análise no CDE (com a revisão nova deste modelo) confirma o que foi resolvido.</p>
    </section>
  );
}
