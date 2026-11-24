// Interferências do empreendimento: nova análise (modelos IFC do CDE nos lados A e B, regras) e
// lista de análises com andamento e resultados.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { clashApi } from '../api';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '../ui';

const cmOf = (m) => String(Math.round(m * 1000) / 10).replace('.', ',');
const mOf = (cm) => Number(String(cm).replace(',', '.')) / 100;
const fmtDate = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function ModelPicker({ title, models, value, onChange }) {
  return (
    <div className="flex-1 min-w-[260px]">
      <div className="text-xs font-semibold text-gray-600 mb-1">{title}</div>
      <div className="border rounded-md divide-y max-h-56 overflow-auto bg-white">
        {models.map((m) => {
          const v = m.emitida || m.atual;
          return (
            <label key={m.id} className="flex items-start gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={value.includes(m.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, m.id] : value.filter((x) => x !== m.id))}
              />
              <span>
                <span className="font-mono text-xs">{m.codigo}</span>
                <span className="block text-xs text-gray-500">
                  {m.titulo} · {m.emitida ? `emitida ${m.emitida.revisao}` : 'nunca emitida'}
                  {m.atual && m.atual.revisao !== v.revisao ? ` · atual ${m.atual.revisao}` : ''}
                </span>
              </span>
            </label>
          );
        })}
        {!models.length && <p className="p-3 text-xs text-gray-400">Nenhum documento com arquivo IFC no CDE deste empreendimento.</p>}
      </div>
    </div>
  );
}

export default function ClashPanel({ empreendimento, canApprove, onOpen }) {
  const empId = empreendimento.id;
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await clashApi.overview(empId);
      setData(d);
      setForm((f) => {
        if (f) return f;
        const p = d.padrao;
        return {
          nome: '',
          ladoA: p?.ladoA ?? [],
          ladoB: p?.ladoB ?? [],
          versao: p?.versao ?? 'emitida',
          colisao: p?.colisao ?? true,
          tolerancia: cmOf(p?.tolerancia ?? 0.01),
          folga: p?.folga ?? false,
          distancia: cmOf(p?.distancia ?? 0.05),
          ignorar: (p?.ignorar ?? d.ignorarPadrao).join(', '),
          auto: p?.auto ?? true,
        };
      });
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    }
  }, [empId]);
  useEffect(() => {
    load();
  }, [load]);
  // Enquanto houver análise na fila ou processando, atualiza o andamento.
  const pending = data?.analises.some((a) => a.estado === 'fila' || a.estado === 'processando');
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [pending, load]);

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
    }
  };
  const models = data?.modelos ?? [];
  const valid = useMemo(() => form && form.ladoA.length && form.ladoB.length && (form.colisao || form.folga), [form]);

  if (!data || !form) return <p className="text-sm text-gray-500">{msg || 'Carregando…'}</p>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Nova análise de interferências</CardTitle>
          <p className="text-xs text-gray-500">Escolha os modelos IFC do CDE de cada lado: cada elemento do lado A é testado contra os do lado B. O mesmo modelo pode estar nos dois lados (interferências internas).</p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-4">
            <ModelPicker title="Lado A (ex.: estrutura)" models={models} value={form.ladoA} onChange={(ladoA) => setForm({ ...form, ladoA })} />
            <ModelPicker title="Lado B (ex.: instalações)" models={models} value={form.ladoB} onChange={(ladoB) => setForm({ ...form, ladoB })} />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Versão dos modelos">
              <select className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm" value={form.versao} onChange={(e) => setForm({ ...form, versao: e.target.value })}>
                <option value="emitida">Última emitida (compartilhada/publicada)</option>
                <option value="atual">Atual (inclui em andamento)</option>
              </select>
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.colisao} onChange={(e) => setForm({ ...form, colisao: e.target.checked })} /> Colisão física · tolerância
              <Input className="w-16 h-8" value={form.tolerancia} onChange={(e) => setForm({ ...form, tolerancia: e.target.value })} /> cm
            </label>
            <label className="flex items-center gap-2" title="Quando um dos modelos receber revisão nova (emitida, ou enviada se a análise usa a versão atual), a análise roda de novo e é comparada com esta">
              <input type="checkbox" checked={form.auto} onChange={(e) => setForm({ ...form, auto: e.target.checked })} /> Reexecutar sozinha a cada revisão nova
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.folga} onChange={(e) => setForm({ ...form, folga: e.target.checked })} /> Folga mínima
              <Input className="w-16 h-8" value={form.distancia} onChange={(e) => setForm({ ...form, distancia: e.target.value })} /> cm
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Ignorar tipos IFC (separados por vírgula)" className="flex-1 min-w-[300px]">
              <Input value={form.ignorar} onChange={(e) => setForm({ ...form, ignorar: e.target.value })} />
            </Field>
            <Field label="Nome (opcional)" className="w-56">
              <Input value={form.nome} placeholder="ex.: ES × HD — 3º pav." onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </Field>
            <Button
              disabled={busy || !valid}
              onClick={() =>
                run(
                  () =>
                    clashApi.create(empId, {
                      nome: form.nome,
                      ladoA: form.ladoA,
                      ladoB: form.ladoB,
                      versao: form.versao,
                      colisao: form.colisao,
                      tolerancia: mOf(form.tolerancia),
                      folga: form.folga,
                      distancia: mOf(form.distancia),
                      ignorar: form.ignorar.split(/[,;\s]+/).filter(Boolean),
                      auto: form.auto,
                    }),
                  'Análise na fila: o servidor processa e a lista abaixo mostra o andamento.',
                )
              }
            >
              <Play className="w-4 h-4 mr-1" /> Executar
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Tolerância: sobreposições e contatos até esse valor são ignorados (apoios, facetamento de tubos). Folga: aponta elementos que não colidem mas ficam mais próximos que a distância.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Análises ({data.analises.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={load} title="Atualizar">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="p-2 text-left">Análise</th>
                <th className="p-2 text-left">Modelos</th>
                <th className="p-2 text-left">Situação</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.analises.map((a) => (
                <tr key={a.id} className="border-t align-top">
                  <td className="p-2">
                    <button className="font-medium text-blue-700 hover:underline text-left" disabled={a.estado !== 'concluida'} onClick={() => onOpen(a.id)}>
                      {a.nome}
                    </button>
                    <div className="text-xs text-gray-500">
                      {fmtDate(a.created_at)} · {a.automatica ? 'automática (revisão nova)' : a.criado_por}
                    </div>
                  </td>
                  <td className="p-2 text-xs text-gray-600">
                    {a.modelos.map((m) => (
                      <div key={m.documento_id}>
                        <span className="font-mono">{m.codigo}</span> {m.revisao}
                        {m.estado === 'andamento' ? ' (em andamento)' : ''}
                      </div>
                    ))}
                  </td>
                  <td className="p-2 text-xs">
                    {a.estado === 'concluida' && (
                      <>
                        <b>{a.resumo.total}</b> interferência(s): {a.resumo.colisao} colisão(ões), {a.resumo.folga} folga(s)
                        {a.resumo.grupos ? ` · ${a.resumo.grupos} grupo(s)` : ''}
                        <div className={a.abertas ? 'text-amber-700' : 'text-green-700'}>{a.abertas ? `${a.abertas} em aberto` : 'nenhuma em aberto'}</div>
                        {a.resumo.comparacao && (
                          <div className="text-gray-500">
                            vs. anterior: {a.resumo.comparacao.novas} nova(s), {a.resumo.comparacao.resolvidas} resolvida(s)
                            {a.resumo.comparacao.reabertas ? `, ${a.resumo.comparacao.reabertas} reaberta(s)` : ''}
                          </div>
                        )}
                      </>
                    )}
                    {(a.estado === 'fila' || a.estado === 'processando') && (
                      <div className="w-56">
                        <div className="text-blue-700">{a.mensagem || (a.estado === 'fila' ? 'Na fila' : 'Processando')}</div>
                        <div className="h-1.5 bg-blue-100 rounded mt-1">
                          <div className="h-1.5 bg-blue-600 rounded" style={{ width: `${Math.round(a.progresso * 100)}%` }} />
                        </div>
                      </div>
                    )}
                    {a.estado === 'erro' && <span className="text-red-600">Erro: {a.erro}</span>}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap text-xs">
                    {a.estado === 'concluida' && (
                      <button className="text-blue-600 hover:underline mr-3" onClick={() => onOpen(a.id)}>
                        Abrir
                      </button>
                    )}
                    <button className="inline-flex items-center text-gray-600 hover:underline mr-3" title="Roda de novo com as mesmas regras e a versão mais recente dos modelos" disabled={busy} onClick={() => run(() => clashApi.rerun(a.id), 'Análise na fila.')}>
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reexecutar
                    </button>
                    {canApprove && a.estado !== 'processando' && (
                      <button
                        className="inline-flex items-center text-red-600 hover:underline"
                        onClick={() => window.confirm(`Excluir a análise "${a.nome}" e suas interferências?`) && run(() => clashApi.remove(a.id), 'Análise excluída.')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!data.analises.length && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-400">
                    Nenhuma análise ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {msg && <p className={`text-sm ${msg.startsWith('Erro') ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>}
    </div>
  );
}
