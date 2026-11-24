// CDE (Ambiente Comum de Dados, ISO 19650) do empreendimento: documentos de qualquer software
// (PDF, DWG, RVT, IFC, planilhas…) com código, revisões, estados, arquivos e emissões (GRD).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from './ui';
import { RefreshCw, Upload, Download, Plus, Send, FileText, History, Archive } from 'lucide-react';
import { cdeApi } from './api';
import { grdSvg, printGrd } from './grd';

const TIPOS = [
  ['DR', 'Desenho (prancha)'],
  ['M3', 'Modelo 3D (IFC/RVT)'],
  ['M2', 'Modelo 2D (DWG)'],
  ['SH', 'Planilha / quantitativos'],
  ['CA', 'Memória de cálculo'],
  ['SP', 'Especificação / memorial'],
  ['RP', 'Relatório'],
  ['SC', 'Esquema / fluxograma'],
];
const DISCIPLINAS = [
  ['AR', 'Arquitetura'],
  ['ES', 'Estrutura'],
  ['EL', 'Elétrica'],
  ['HD', 'Hidráulica'],
  ['IN', 'Incêndio'],
  ['AC', 'Ar condicionado'],
  ['GS', 'Gás'],
  ['TC', 'Telecom'],
  ['MP', 'Instalações (várias)'],
  ['ZZ', 'Geral'],
];
const STATE_STYLE = {
  andamento: 'bg-gray-100 text-gray-700',
  compartilhado: 'bg-blue-100 text-blue-700',
  publicado: 'bg-green-100 text-green-700',
  arquivado: 'bg-gray-100 text-gray-400 line-through',
};
const sel = 'h-9 rounded-md border border-input bg-background px-2 text-sm';
const fmtSize = (n) => (n == null ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
const fmtDate = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function CdeView({ empreendimento }) {
  const empId = empreendimento?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState({ projeto: '', originador: '', volume: 'ZZ' });
  const [novo, setNovo] = useState({ titulo: '', tipo: 'DR', disciplina: 'AR', nivel: 'ZZ', numero: '' });
  const [filtro, setFiltro] = useState({ texto: '', estado: '', disciplina: '' });
  const [picked, setPicked] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [progress, setProgress] = useState(null);
  const [emit, setEmit] = useState({ estado: 'compartilhado', finalidade: 'S1', destinatario: '', observacoes: '' });
  const [mudar, setMudar] = useState({ estado: 'compartilhado', finalidade: 'S1', descricao: '' });

  const load = useCallback(async () => {
    if (!empId) return;
    try {
      const d = await cdeApi.overview(empId);
      setData(d);
      setCfg(d.config);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [empId]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const docs = useMemo(() => {
    const list = data?.documentos || [];
    const q = filtro.texto.trim().toLowerCase();
    return list.filter(
      (d) =>
        (!q || d.codigo.toLowerCase().includes(q) || d.titulo.toLowerCase().includes(q) || (d.arquivo_nome || '').toLowerCase().includes(q)) &&
        (!filtro.estado || d.estado === filtro.estado) &&
        (!filtro.disciplina || d.disciplina === filtro.disciplina),
    );
  }, [data, filtro]);

  const openHistory = async (doc) => {
    if (open === doc.id) return setOpen(null);
    setOpen(doc.id);
    setHistorico([]);
    try {
      setHistorico(await cdeApi.events(doc.id));
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    }
  };

  const finalidades = (estado) => data?.finalidades?.[estado] || [];
  const finLabel = (code) =>
    Object.values(data?.finalidades || {})
      .flat()
      .find((f) => f.code === code)?.label || code;

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-600">
          Não foi possível carregar o CDE: {error}{' '}
          <Button variant="outline" size="sm" onClick={load}>
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <RefreshCw className="w-6 h-6 animate-spin mb-2" /> Carregando CDE…
      </div>
    );
  }

  const coded = data.config.projeto && data.config.originador;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ambiente Comum de Dados (ISO 19650)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            {[
              ['projeto', 'Projeto', 'HTL'],
              ['originador', 'Originador', 'SEB'],
              ['volume', 'Volume', 'ZZ'],
            ].map(([k, label, ph]) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">{label}</span>
                <Input className="w-32" value={cfg[k]} placeholder={ph} disabled={!data.podeAprovar} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
              </label>
            ))}
            {data.podeAprovar && (
              <Button size="sm" disabled={busy} onClick={() => run(() => cdeApi.saveConfig(empId, cfg), 'Codificação salva.')}>
                Salvar codificação
              </Button>
            )}
            <span className="text-xs text-gray-500 ml-auto">
              Arquivos guardados na pasta do servidor do CDE
            </span>
          </div>
          <p className="text-xs text-gray-500">
            Código: Projeto-Originador-Volume-Nível-Tipo-Disciplina-Número. Envio de arquivo depois de emitido abre a próxima revisão (P01 → P02; publicado: C01 → C02).
            {!coded && ' Defina projeto e originador (coordenação) para os códigos ficarem completos.'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Novo documento</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <span className="text-xs text-gray-500">Título</span>
            <Input value={novo.titulo} placeholder="ex.: Planta de arquitetura — 1º pavimento" onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Tipo</span>
            <select className={sel} value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}>
              {TIPOS.map(([c, l]) => (
                <option key={c} value={c}>
                  {c} — {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Disciplina</span>
            <select className={sel} value={novo.disciplina} onChange={(e) => setNovo({ ...novo, disciplina: e.target.value })}>
              {DISCIPLINAS.map(([c, l]) => (
                <option key={c} value={c}>
                  {c} — {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Nível</span>
            <Input className="w-20" value={novo.nivel} onChange={(e) => setNovo({ ...novo, nivel: e.target.value })} title="00 térreo, 01…, B1 subsolo, ZZ vários" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Número</span>
            <Input className="w-20" value={novo.numero} placeholder="auto" onChange={(e) => setNovo({ ...novo, numero: e.target.value })} />
          </label>
          <Button
            size="sm"
            disabled={busy || !novo.titulo.trim()}
            onClick={() =>
              run(async () => {
                await cdeApi.createDoc(empId, novo);
                setNovo({ ...novo, titulo: '', numero: '' });
              }, 'Documento criado.')
            }
          >
            <Plus className="w-4 h-4 mr-1" /> Criar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Documentos ({data.documentos.length})</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Input className="w-56 h-8" placeholder="Buscar código, título ou arquivo…" value={filtro.texto} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
            <select className={sel + ' h-8'} value={filtro.estado} onChange={(e) => setFiltro({ ...filtro, estado: e.target.value })}>
              <option value="">Todos os estados</option>
              {Object.entries(data.estados).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select className={sel + ' h-8'} value={filtro.disciplina} onChange={(e) => setFiltro({ ...filtro, disciplina: e.target.value })}>
              <option value="">Todas as disciplinas</option>
              {DISCIPLINAS.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={load} title="Atualizar">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {progress != null && (
            <div className="px-4 py-2 text-xs text-blue-700">
              Enviando… {Math.round(progress * 100)}%
              <div className="h-1 bg-blue-100 mt-1">
                <div className="h-1 bg-blue-600" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="p-2 w-8">
                  <input
                    type="checkbox"
                    checked={docs.length > 0 && docs.every((d) => picked.has(d.id))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(docs.map((d) => d.id)) : new Set())}
                  />
                </th>
                <th className="p-2 text-left">Código</th>
                <th className="p-2 text-left">Título</th>
                <th className="p-2">Rev.</th>
                <th className="p-2">Estado</th>
                <th className="p-2 text-left">Arquivo</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <React.Fragment key={d.id}>
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={picked.has(d.id)}
                        onChange={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(d.id)) n.delete(d.id);
                            else n.add(d.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{d.codigo}</td>
                    <td className="p-2">{d.titulo}</td>
                    <td className="p-2 text-center">
                      <Badge variant="outline">{d.revisao}</Badge>
                    </td>
                    <td className="p-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATE_STYLE[d.estado]}`} title={finLabel(d.finalidade)}>
                        {data.estados[d.estado]} ({d.finalidade})
                      </span>
                    </td>
                    <td className="p-2 text-xs text-gray-600">
                      {d.arquivo_nome ? (
                        <>
                          {d.arquivo_nome} <span className="text-gray-400">{fmtSize(d.tamanho)}</span>
                        </>
                      ) : (
                        <span className="text-gray-400">sem arquivo</span>
                      )}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {d.estado !== 'arquivado' && (
                        <label className="inline-flex items-center cursor-pointer text-blue-600 hover:underline text-xs mr-3" title="Enviar arquivo (nova versão)">
                          <Upload className="w-4 h-4 mr-1" /> Enviar
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = '';
                              if (f) run(() => cdeApi.upload(d.id, f, null, setProgress), `Arquivo ${f.name} enviado.`);
                            }}
                          />
                        </label>
                      )}
                      {d.arquivo_key && (
                        <button className="inline-flex items-center text-blue-600 hover:underline text-xs mr-3" onClick={() => run(() => cdeApi.download(d.id))}>
                          <Download className="w-4 h-4 mr-1" /> Baixar
                        </button>
                      )}
                      <button className="inline-flex items-center text-gray-600 hover:underline text-xs" onClick={() => openHistory(d)}>
                        <History className="w-4 h-4 mr-1" /> {open === d.id ? 'Fechar' : 'Histórico'}
                      </button>
                    </td>
                  </tr>
                  {open === d.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={7} className="p-3">
                        <div className="flex flex-wrap items-end gap-2 mb-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-gray-500">Mudar estado</span>
                            <select className={sel} value={mudar.estado} onChange={(e) => setMudar({ ...mudar, estado: e.target.value, finalidade: finalidades(e.target.value)[0]?.code })}>
                              {Object.entries(data.estados)
                                .filter(([k]) => data.podeAprovar || k === 'andamento' || k === 'compartilhado')
                                .map(([k, l]) => (
                                  <option key={k} value={k}>
                                    {l}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-gray-500">Finalidade</span>
                            <select className={sel} value={mudar.finalidade} onChange={(e) => setMudar({ ...mudar, finalidade: e.target.value })}>
                              {finalidades(mudar.estado).map((f) => (
                                <option key={f.code} value={f.code}>
                                  {f.code} — {f.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 flex-1 min-w-[200px]">
                            <span className="text-xs text-gray-500">Descrição</span>
                            <Input value={mudar.descricao} onChange={(e) => setMudar({ ...mudar, descricao: e.target.value })} />
                          </label>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await cdeApi.setState(d.id, mudar.estado, mudar.finalidade, mudar.descricao);
                                setMudar({ ...mudar, descricao: '' });
                                setHistorico(await cdeApi.events(d.id));
                              }, 'Estado atualizado.')
                            }
                          >
                            Aplicar
                          </Button>
                          {data.podeAprovar && d.estado !== 'arquivado' && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => cdeApi.setState(d.id, 'arquivado', 'AR', 'Arquivado'), 'Documento arquivado.')}>
                              <Archive className="w-4 h-4 mr-1" /> Arquivar
                            </Button>
                          )}
                        </div>
                        <table className="w-full text-xs">
                          <tbody>
                            {historico.map((h) => (
                              <tr key={h.id} className="border-t">
                                <td className="p-1 w-14 font-semibold">{h.revisao}</td>
                                <td className="p-1 w-36">{fmtDate(h.created_at)}</td>
                                <td className="p-1 w-40">{h.tipo === 'arquivo' ? 'Arquivo enviado' : `${data.estados[h.estado]} (${h.finalidade})`}</td>
                                <td className="p-1">{h.descricao || h.arquivo_nome || ''}</td>
                                <td className="p-1 w-32 text-gray-500">{h.autor_nome}</td>
                                <td className="p-1 w-16 text-right">
                                  {h.tipo === 'arquivo' && h.arquivo_key && (
                                    <button className="text-blue-600 hover:underline" onClick={() => run(() => cdeApi.download(d.id, h.id))}>
                                      baixar
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                            {!historico.length && (
                              <tr>
                                <td className="p-1 text-gray-400">Sem histórico ainda.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {!docs.length && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-400">
                    <FileText className="w-6 h-6 mx-auto mb-1" />
                    Nenhum documento {data.documentos.length ? 'com esses filtros' : 'ainda: crie o primeiro acima'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Emitir (GRD) — {picked.size} documento(s) marcado(s)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Estado</span>
            <select className={sel} value={emit.estado} onChange={(e) => setEmit({ ...emit, estado: e.target.value, finalidade: finalidades(e.target.value)[0]?.code })}>
              <option value="compartilhado">Compartilhado</option>
              {data.podeAprovar && <option value="publicado">Publicado</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Finalidade</span>
            <select className={sel} value={emit.finalidade} onChange={(e) => setEmit({ ...emit, finalidade: e.target.value })}>
              {finalidades(emit.estado).map((f) => (
                <option key={f.code} value={f.code}>
                  {f.code} — {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <span className="text-xs text-gray-500">Destinatário</span>
            <Input value={emit.destinatario} onChange={(e) => setEmit({ ...emit, destinatario: e.target.value })} placeholder="ex.: Construtora X" />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <span className="text-xs text-gray-500">Observações</span>
            <Input value={emit.observacoes} onChange={(e) => setEmit({ ...emit, observacoes: e.target.value })} />
          </label>
          <Button
            size="sm"
            disabled={busy || !picked.size}
            onClick={() =>
              run(async () => {
                const e = await cdeApi.emit(empId, { documento_ids: [...picked], ...emit });
                setPicked(new Set());
                printGrd(grdSvg(e, data.config, data.estados, finLabel), e.numero);
              }, 'Emissão registrada.')
            }
          >
            <Send className="w-4 h-4 mr-1" /> Emitir
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Emissões ({data.emissoes.length})</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {!data.emissoes.length && <p className="text-gray-400">Nenhuma emissão ainda.</p>}
          {data.emissoes.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-t pt-1">
              <b>{e.numero}</b>
              <span className="text-gray-500">{new Date(e.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
              <span>
                {e.itens.length} doc(s) · {e.finalidade} {e.destinatario ? `· ${e.destinatario}` : ''}
              </span>
              <button className="text-blue-600 hover:underline ml-auto text-xs" onClick={() => printGrd(grdSvg(e, data.config, data.estados, finLabel), e.numero)}>
                GRD (imprimir/PDF)
              </button>
            </div>
          ))}
        </CardContent>
      </Card>
      {msg && <p className={`text-sm ${msg.startsWith('Erro') ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>}
    </div>
  );
}
