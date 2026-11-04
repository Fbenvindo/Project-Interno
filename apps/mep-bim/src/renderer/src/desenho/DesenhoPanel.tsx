// Painel do comando ativo dos menus Criar, Modificar e Geral.
import { DRAFT_LABEL } from "../../../core/draft";
import { runIdOfElement } from "../../../core/runs";
import type { PointsStore } from "../locacao/usePointsStore";
import { CMD_LABEL, isCreateCmd, isMeasureCmd, NEEDS_SELECTION, type DraftCmd, type DraftController } from "./useDraftTool";
import { measureText } from "../../../core/measure";

interface Props {
  cmd: DraftCmd;
  ctl: DraftController;
  store: PointsStore;
  selection: number[];
  setSelection: (ids: number[]) => void;
  hasClip: boolean;
  onClearClip: () => void;
  /** Nome de um elemento do modelo (IFC) para a lista da seleção. */
  elementLabel: (id: number) => string;
}

const STEPS = ["Selecionar", "Confirmar", "Executar"];

export function DesenhoPanel({ cmd, ctl, store, selection, setSelection, hasClip, onClearClip, elementLabel }: Props) {
  const { phase, opts, setOpts, tool } = ctl;
  const withSel = NEEDS_SELECTION.has(cmd);
  const step = phase === "selecionar" ? 0 : phase === "executar" ? 2 : 1;

  // Itens da seleção com rótulo (um por trecho, não por segmento).
  const items: { key: string; label: string; ids: number[] }[] = [];
  const seenRuns = new Set<number>();
  for (const id of selection) {
    const runId = runIdOfElement(id);
    if (runId != null) {
      if (seenRuns.has(runId)) continue;
      seenRuns.add(runId);
      const r = store.runs.find((x) => x.id === runId);
      items.push({ key: `r${runId}`, label: r ? `Trecho ${r.tag}` : `Trecho ${runId}`, ids: selection.filter((x) => runIdOfElement(x) === runId) });
      continue;
    }
    const d = store.drafts.find((x) => x.id === id);
    if (d) {
      items.push({ key: `d${id}`, label: d.kind === "texto" ? `Texto “${d.text}”` : DRAFT_LABEL[d.kind], ids: [id] });
      continue;
    }
    const p = store.points.find((x) => x.id === id);
    items.push({ key: `e${id}`, label: p ? `Ponto ${p.tag}` : elementLabel(id), ids: [id] });
  }
  const removeItem = (ids: number[]) => setSelection(selection.filter((x) => !ids.includes(x)));

  return (
    <div className="panel-body desenho">
      <h2>{CMD_LABEL[cmd]}</h2>
      <p className="draft-prompt">{tool.prompt}</p>

      {withSel && (
        <>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i === step ? "on" : i < step ? "done" : ""}>
                {i + 1}. {s}
              </li>
            ))}
          </ol>
          {phase === "confirmar" && tool.question && (
            <section className="card question-card">
              <p>
                <b>{tool.question.text}</b>
              </p>
              <div className="btn-row">
                {tool.question.options.map((o) => (
                  <button key={o.label} className={`btn ${o.primary ? "primary" : ""}`} onClick={o.run}>
                    {o.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {phase !== "executar" && (
            <section className="card">
              <div className="panel-head">
                <h3>
                  Seleção · {items.length} elemento{items.length === 1 ? "" : "s"}
                </h3>
                {items.length > 0 && phase !== "confirmar" && (
                  <button className="link" onClick={() => setSelection([])}>
                    limpar
                  </button>
                )}
              </div>
              {phase === "remover" && <p className="muted small">Clique (ou faça uma janela) nos elementos a tirar da seleção, ou use o ✕ da lista.</p>}
              {items.length === 0 ? (
                <p className="muted small">
                  Clique nos elementos na planta (ou no 3D). Arraste da esquerda para a direita para selecionar o que fica inteiro dentro da janela; da direita para a
                  esquerda, o que a janela cruza. Shift ou Ctrl+clique tira da seleção.
                </p>
              ) : (
                <ul className="sel-list">
                  {items.map((it) => (
                    <li key={it.key}>
                      <span className="grow">{it.label}</span>
                      {phase !== "confirmar" && (
                        <button className="link danger-link" title="Remover da seleção" onClick={() => removeItem(it.ids)}>
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="btn-row">
                {phase === "selecionar" && (
                  <button className="btn primary" disabled={!ctl.count} onClick={ctl.finishSelection}>
                    Concluir seleção
                  </button>
                )}
                {phase === "remover" && (
                  <button className="btn primary" disabled={!ctl.count} onClick={ctl.execute}>
                    Concluir remoção e continuar
                  </button>
                )}
              </div>
            </section>
          )}
          {phase === "executar" && (
            <div className="btn-row">
              <button className="btn" onClick={() => ctl.setPhase("selecionar")}>
                Voltar à seleção
              </button>
            </div>
          )}
        </>
      )}

      {cmd === "texto" && (
        <div className="form-grid">
          <p className="muted small span2">Clique na planta onde o texto começa, digite no próprio local e tecle Enter (Esc desiste). Para editar um texto depois, dê duplo clique nele.</p>
          <label>
            Altura no papel (mm)
            <input type="number" step={0.5} min={1} value={opts.textSize} onChange={(e) => setOpts({ ...opts, textSize: Math.max(0.5, Number(e.target.value) || 2.5) })} />
          </label>
          <label>
            Rotação (°)
            <input type="number" step={15} value={opts.textRot} onChange={(e) => setOpts({ ...opts, textRot: Number(e.target.value) || 0 })} />
          </label>
        </div>
      )}
      {cmd === "poligonal" && (
        <label className="inline-check">
          <input type="checkbox" checked={opts.closed} onChange={(e) => setOpts({ ...opts, closed: e.target.checked })} /> Fechar ao terminar (Enter)
        </label>
      )}
      {cmd === "copiar" && (
        <label className="inline-check">
          <input type="checkbox" checked={opts.repeat} onChange={(e) => setOpts({ ...opts, repeat: e.target.checked })} /> Cópias múltiplas (vários destinos)
        </label>
      )}
      {cmd === "colar" && (
        <p className="muted small">
          {ctl.clipboard
            ? `Na área de transferência: ${ctl.clipboard.drafts.length} desenho(s), ${ctl.clipboard.points.length} ponto(s), ${ctl.clipboard.runs.length} trecho(s) — de ${ctl.clipboard.storey}. Ao colar em outro pavimento, a cota acompanha o piso.`
            : "Área de transferência vazia: use Copiar ou Recortar primeiro."}
        </p>
      )}
      {(cmd === "corte-linha" || cmd === "ampliacao") && (
        <p className="muted small">
          {cmd === "corte-linha"
            ? "O corte vira uma vista 2D (elementos cortados hachurados e o que está além, até a profundidade de vista), com níveis dos pavimentos. Ao terminar, escolha se é de Trabalho ou de Documentação."
            : "A ampliação mostra a área escolhida da planta em escala maior (1:25 por padrão). Ao terminar, escolha se é de Trabalho ou de Documentação."}
        </p>
      )}
      {cmd === "corte-selecao" && (
        <div className="btn-row">
          <button className="btn" disabled={!hasClip} onClick={onClearClip}>
            Remover cortes
          </button>
        </div>
      )}
      {cmd === "vista-3d" && (
        <>
          <div className="form-grid">
            <label title="Altura dos olhos acima do piso do pavimento">
              Altura do observador (m)
              <input type="number" step={0.1} min={0.2} value={opts.eyeHeight} onChange={(e) => setOpts({ ...opts, eyeHeight: Math.max(0.2, Number(e.target.value) || 1.6) })} />
            </label>
          </div>
          <p className="muted small">A vista criada fica no navegador de vistas (Trabalho ou Documentação, à sua escolha) e pode ser reaberta, renomeada ou colocada numa folha.</p>
        </>
      )}

      {isMeasureCmd(cmd) && (
        <section className="card">
          <div className="panel-head">
            <h3>Medições ({ctl.measures.length})</h3>
            {ctl.measures.length > 0 && (
              <button className="link" onClick={() => ctl.setMeasures([])}>
                limpar
              </button>
            )}
          </div>
          {ctl.measures.length === 0 ? (
            <p className="muted small">Clique nos pontos na planta (ou no corte). As medidas ficam na tela até você sair do comando (Esc).</p>
          ) : (
            <ul className="sel-list">
              {ctl.measures.map((m, i) => (
                <li key={i}>
                  <span className="grow">
                    <b>{m.kind === "distancia" ? "Distância" : m.kind === "area" ? "Área" : "Ângulo"}:</b> {measureText(m)}
                  </span>
                  <button className="link" title="Gravar o valor como texto na vista" onClick={() => ctl.measureToText(m)}>
                    texto
                  </button>
                  <button className="link danger-link" title="Apagar esta medição" onClick={() => ctl.setMeasures((l) => l.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Troque entre distância, área e ângulo sem perder as medidas. Shift trava na horizontal/vertical; o encaixe pega pontas, meios, cantos e pontos locados.</p>
        </section>
      )}
      {ctl.message && <div className="info-text small">{ctl.message}</div>}

      {(isCreateCmd(cmd) || phase === "executar" || cmd === "colar" || cmd === "corte-linha" || cmd === "vista-3d") && !isMeasureCmd(cmd) && (
        <p className="muted small">
          Encaixe automático em extremidades, meios, centros e vértices (quadrado laranja). Shift: ortogonal ao último ponto. Enter, duplo clique ou botão direito
          termina; Esc cancela. Os desenhos ficam no pavimento atual, entram na prancha e no DXF (camadas ANOT-*).
        </p>
      )}
    </div>
  );
}
