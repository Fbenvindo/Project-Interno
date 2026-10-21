import { Fragment, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertTriangle, ChevronDown, ChevronRight, ClipboardList, FileJson, FileSpreadsheet, Focus, Loader2, RefreshCw,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CATEGORIAS_SANITARIAS, ORIENTACOES, gerarLevantamento } from '@/components/ifc/ifcLevantamento';
import { exportarLevantamentoExcel, exportarLevantamentoJson } from '@/components/ifc/levantamentoExport';
import { getLevantamentoIfc, saveLevantamentoIfc } from '@/api/ifcModelos';

const fmt = (v, casas = 2) => (v == null || Number.isNaN(Number(v))
  ? '—'
  : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));

const porOrientacao = (mapa) => ORIENTACOES
  .filter((o) => mapa[o] >= 0.05)
  .map((o) => `${o} ${fmt(mapa[o], 1)}`)
  .join(' · ');

function Resumo({ titulo, valor, unidade }) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="text-lg font-semibold text-slate-900">
        {valor} {unidade && <span className="text-sm font-normal text-slate-500">{unidade}</span>}
      </p>
    </div>
  );
}

function TabelaSimples({ colunas, linhas, vazio }) {
  if (!linhas.length) return <p className="text-xs text-slate-400 py-1">{vazio}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b">
            {colunas.map((c) => <th key={c.titulo} className={`py-1 pr-3 font-medium ${c.direita ? 'text-right' : ''}`}>{c.titulo}</th>)}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b last:border-0 align-top">
              {colunas.map((c) => (
                <td key={c.titulo} className={`py-1 pr-3 ${c.direita ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>{c.valor(l) ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetalheAmbiente({ amb }) {
  const acab = Object.entries({ Piso: amb.acabamentos.piso, Parede: amb.acabamentos.parede, Teto: amb.acabamentos.teto, Rodapé: amb.acabamentos.rodape })
    .filter(([, v]) => v.length);
  return (
    <div className="space-y-4 bg-slate-50 px-4 py-3">
      <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <p><span className="text-slate-500">Área geométrica:</span> {fmt(amb.area_geometrica_m2)} m²</p>
        <p><span className="text-slate-500">Perímetro:</span> {fmt(amb.perimetro_m)} m</p>
        <p><span className="text-slate-500">Ocupação:</span> {amb.ocupacao != null ? fmt(amb.ocupacao, 0) : '—'}</p>
        <p><span className="text-slate-500">Uso:</span> {amb.uso || '—'}</p>
        {acab.map(([k, v]) => <p key={k}><span className="text-slate-500">Acabamento {k.toLowerCase()}:</span> {v.join('; ')}</p>)}
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1">Superfícies (paredes, piso e teto)</p>
        <TabelaSimples
          vazio="Nenhuma superfície identificada."
          linhas={amb.superficies}
          colunas={[
            { titulo: 'Superfície', valor: (s) => s.tipo },
            { titulo: 'Condição', valor: (s) => s.condicao },
            { titulo: 'Orient.', valor: (s) => s.orientacao },
            { titulo: 'Azim.', direita: true, valor: (s) => (s.azimute_graus != null ? `${fmt(s.azimute_graus, 0)}°` : null) },
            { titulo: 'Área (m²)', direita: true, valor: (s) => fmt(s.area_m2) },
            { titulo: 'Divisa com', valor: (s) => s.divisa_com },
            { titulo: 'Elemento', valor: (s) => s.elemento },
            { titulo: 'Composição', valor: (s) => s.materiais },
            { titulo: 'U', direita: true, valor: (s) => (s.u != null ? fmt(s.u, 3) : null) },
          ]}
        />
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1">Janelas, portas e vidros</p>
        <TabelaSimples
          vazio="Nenhuma abertura."
          linhas={amb.aberturas}
          colunas={[
            { titulo: 'Tipo', valor: (o) => o.tipo },
            { titulo: 'Condição', valor: (o) => o.condicao },
            { titulo: 'Orient.', valor: (o) => o.orientacao },
            { titulo: 'L × A (m)', direita: true, valor: (o) => (o.largura_m && o.altura_m ? `${fmt(o.largura_m)} × ${fmt(o.altura_m)}` : null) },
            { titulo: 'Área (m²)', direita: true, valor: (o) => fmt(o.area_m2) },
            { titulo: 'Divisa com', valor: (o) => o.divisa_com },
            { titulo: 'Tipo construtivo', valor: (o) => o.tipo_construtivo },
            { titulo: 'U', direita: true, valor: (o) => (o.u != null ? fmt(o.u, 3) : null) },
            { titulo: 'Fator solar', direita: true, valor: (o) => (o.fator_solar != null ? fmt(o.fator_solar) : null) },
          ]}
        />
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1">Equipamentos e aparelhos</p>
        <TabelaSimples
          vazio="Nenhum equipamento no ambiente."
          linhas={amb.equipamentos}
          colunas={[
            { titulo: 'Categoria', valor: (e) => e.categoria_nome },
            { titulo: 'Tipo construtivo', valor: (e) => e.tipo_construtivo },
            { titulo: 'Potência (IFC)', valor: (e) => e.potencia },
            { titulo: 'Classe IFC', valor: (e) => e.ifc },
          ]}
        />
      </div>
    </div>
  );
}

export default function LevantamentoDialog({
  open, onClose, engine, fileName, savedModelo, canSave, levantamento, onLevantamento, onFocusSpace,
}) {
  const [progresso, setProgresso] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvoEm, setSalvoEm] = useState(savedModelo?.levantamento_em || null);
  const [salvando, setSalvando] = useState(false);
  const [carregandoSalvo, setCarregandoSalvo] = useState(false);
  const [abertos, setAbertos] = useState(new Set());
  const [exportando, setExportando] = useState(false);

  useEffect(() => { setSalvoEm(savedModelo?.levantamento_em || null); }, [savedModelo]);

  // Ao abrir um modelo salvo que já tem levantamento, carrega o que está no servidor
  useEffect(() => {
    if (!open || levantamento || !savedModelo?.levantamento_em) return undefined;
    let cancelado = false;
    setCarregandoSalvo(true);
    getLevantamentoIfc(savedModelo.id)
      .then((r) => { if (!cancelado && r?.levantamento) { onLevantamento(r.levantamento); setSalvoEm(r.levantamento_em); } })
      .catch((err) => { if (!cancelado) setErro(err.message); })
      .finally(() => { if (!cancelado) setCarregandoSalvo(false); });
    return () => { cancelado = true; };
  }, [open, levantamento, savedModelo, onLevantamento]);

  const gerar = async () => {
    setErro(null);
    setProgresso({ etapa: 'Preparando...', percentual: 0 });
    try {
      const resultado = await gerarLevantamento(engine, { onProgress: setProgresso });
      onLevantamento(resultado);
      setAbertos(new Set());
      if (savedModelo && canSave) {
        setSalvando(true);
        try {
          const r = await saveLevantamentoIfc(savedModelo.id, resultado);
          setSalvoEm(r.levantamento_em);
        } catch (err) {
          setErro(`Levantamento gerado, mas não foi salvo: ${err.message}`);
        } finally {
          setSalvando(false);
        }
      }
    } catch (err) {
      console.error('Erro no levantamento IFC:', err);
      setErro(err.message || 'Falha ao gerar o levantamento.');
    } finally {
      setProgresso(null);
    }
  };

  const exportarExcel = async () => {
    setExportando(true);
    try {
      await exportarLevantamentoExcel(levantamento, fileName);
    } catch (err) {
      setErro(`Falha ao gerar a planilha: ${err.message}`);
    } finally {
      setExportando(false);
    }
  };

  const ambs = useMemo(() => levantamento?.ambientes || [], [levantamento]);
  const totais = useMemo(() => {
    const soma = (f) => ambs.reduce((s, a) => s + (f(a) || 0), 0);
    return {
      area: soma((a) => a.area_m2),
      paredeExt: soma((a) => a.totais.parede_externa_m2),
      janelaExt: soma((a) => a.totais.janela_externa_m2),
      sanitarios: soma((a) => Object.values(a.totais.sanitarios).reduce((x, y) => x + y, 0)),
    };
  }, [ambs]);
  const categoriasSanit = useMemo(
    () => Object.keys(CATEGORIAS_SANITARIAS).filter((c) => ambs.some((a) => a.totais.sanitarios[c])),
    [ambs]
  );

  const alternar = (id) => setAbertos((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ocupado = !!progresso || carregandoSalvo;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !progresso) onClose(); }}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] flex flex-col gap-3 p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-blue-600" /> Levantamento por ambiente
          </DialogTitle>
          <p className="text-xs text-slate-500">
            {fileName}
            {levantamento && <> · gerado em {format(new Date(levantamento.gerado_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</>}
            {salvando && <> · salvando...</>}
            {!salvando && salvoEm && <> · salvo no empreendimento</>}
          </p>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button onClick={gerar} disabled={ocupado}>
            {progresso ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {levantamento ? 'Recalcular' : 'Gerar levantamento'}
          </Button>
          <Button variant="outline" onClick={exportarExcel} disabled={!levantamento || ocupado || exportando}>
            {exportando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />}
            Exportar Excel
          </Button>
          <Button variant="outline" onClick={() => exportarLevantamentoJson(levantamento, fileName)} disabled={!levantamento || ocupado}>
            <FileJson className="w-4 h-4 mr-2" /> Exportar JSON
          </Button>
        </div>

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        {progresso && (
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm text-slate-700">{progresso.etapa}</p>
            <Progress value={progresso.percentual} />
          </div>
        )}
        {carregandoSalvo && (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando levantamento salvo...</div>
        )}

        {!levantamento && !ocupado && (
          <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-700 space-y-2">
            <p>O levantamento lê cada ambiente (IfcSpace) do modelo e reúne os dados de entrada para cargas térmicas e consumos hidráulicos e de esgoto:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>área, pé-direito, volume, perímetro e ocupação;</li>
              <li>paredes, piso e teto: externos ou internos (com o ambiente vizinho), orientação em relação ao norte verdadeiro, composição das camadas e U quando informado;</li>
              <li>janelas, portas e vidros com dimensões, orientação, U e fator solar;</li>
              <li>acabamentos de piso, parede, teto e rodapé;</li>
              <li>aparelhos sanitários e demais equipamentos de cada ambiente.</li>
            </ul>
          </div>
        )}

        {levantamento && !progresso && (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
              <Resumo titulo="Ambientes" valor={ambs.length} />
              <Resumo titulo="Área total" valor={fmt(totais.area)} unidade="m²" />
              <Resumo titulo="Parede externa" valor={fmt(totais.paredeExt)} unidade="m²" />
              <Resumo titulo="Janelas/vidros externos" valor={fmt(totais.janelaExt)} unidade="m²" />
              <Resumo titulo="Aparelhos sanitários" valor={totais.sanitarios} />
            </div>

            {levantamento.avisos.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                {levantamento.avisos.map((a) => (
                  <p key={a} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {a}</p>
                ))}
              </div>
            )}

            <Tabs defaultValue="ambientes" className="flex-1 min-h-0 flex flex-col">
              <TabsList className="self-start">
                <TabsTrigger value="ambientes">Ambientes</TabsTrigger>
                <TabsTrigger value="sanitarios">Aparelhos sanitários</TabsTrigger>
              </TabsList>
              <TabsContent value="ambientes" className="flex-1 min-h-0 overflow-auto rounded-md border bg-white data-[state=inactive]:hidden">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white shadow-[0_1px_0_#e2e8f0] z-10">
                    <tr className="text-left text-xs text-slate-500">
                      <th className="w-8" />
                      <th className="py-2 pr-3 font-medium">Pavimento</th>
                      <th className="py-2 pr-3 font-medium">Ambiente</th>
                      <th className="py-2 pr-3 font-medium text-right">Área (m²)</th>
                      <th className="py-2 pr-3 font-medium text-right">Pé-dir. (m)</th>
                      <th className="py-2 pr-3 font-medium text-right">Vol. (m³)</th>
                      <th className="py-2 pr-3 font-medium">Parede externa (m²)</th>
                      <th className="py-2 pr-3 font-medium">Janelas/vidros ext. (m²)</th>
                      <th className="py-2 pr-3 font-medium text-right">Cobertura (m²)</th>
                      <th className="py-2 pr-3 font-medium text-right">Portas</th>
                      <th className="py-2 pr-3 font-medium text-right">Sanit.</th>
                      <th className="py-2 pr-3 font-medium text-right" title="Parte do contorno do ambiente associada a um elemento construtivo">Contorno</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {ambs.map((a) => {
                      const aberto = abertos.has(a.id);
                      const t = a.totais;
                      return (
                        <Fragment key={a.id}>
                          <tr className="border-t hover:bg-slate-50 cursor-pointer align-top" onClick={() => alternar(a.id)}>
                            <td className="py-2 pl-2 text-slate-400">{aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                            <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{a.pavimento || '—'}</td>
                            <td className="py-2 pr-3 font-medium">{a.rotulo}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{fmt(a.area_m2)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{fmt(a.pe_direito_m)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{fmt(a.volume_m3)}</td>
                            <td className="py-2 pr-3 text-xs">
                              <span className="tabular-nums font-medium">{fmt(t.parede_externa_m2)}</span>
                              <span className="block text-slate-500">{porOrientacao(t.parede_externa_por_orientacao)}</span>
                            </td>
                            <td className="py-2 pr-3 text-xs">
                              <span className="tabular-nums font-medium">{fmt(t.janela_externa_m2)}</span>
                              <span className="block text-slate-500">{porOrientacao(t.janela_externa_por_orientacao)}</span>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{fmt(t.cobertura_exposta_m2)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{t.portas}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{Object.values(t.sanitarios).reduce((x, y) => x + y, 0) || '—'}</td>
                            <td className={`py-2 pr-3 text-right tabular-nums ${a.fechamento_identificado_pct != null && a.fechamento_identificado_pct < 70 ? 'text-amber-600' : ''}`}>
                              {a.fechamento_identificado_pct != null ? `${a.fechamento_identificado_pct}%` : '—'}
                            </td>
                            <td className="py-1 pr-2">
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Ver no modelo"
                                onClick={(e) => { e.stopPropagation(); onFocusSpace(a.id); }}
                              >
                                <Focus className="w-4 h-4" />
                              </Button>
                            </td>
                          </tr>
                          {aberto && (
                            <tr>
                              <td colSpan={13} className="p-0"><DetalheAmbiente amb={a} /></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </TabsContent>
              <TabsContent value="sanitarios" className="flex-1 min-h-0 overflow-auto rounded-md border bg-white data-[state=inactive]:hidden">
                {categoriasSanit.length === 0 ? (
                  <p className="text-sm text-slate-500 p-4">
                    Nenhum aparelho sanitário encontrado nos ambientes. Se as louças estão em um modelo de hidráulica separado, elas precisam estar no mesmo arquivo dos ambientes.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white shadow-[0_1px_0_#e2e8f0]">
                      <tr className="text-left text-xs text-slate-500">
                        <th className="py-2 px-3 font-medium">Pavimento</th>
                        <th className="py-2 pr-3 font-medium">Ambiente</th>
                        {categoriasSanit.map((c) => <th key={c} className="py-2 pr-3 font-medium text-right">{CATEGORIAS_SANITARIAS[c]}</th>)}
                        <th className="py-2 pr-3 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ambs.filter((a) => Object.keys(a.totais.sanitarios).length).map((a) => (
                        <tr key={a.id} className="border-t">
                          <td className="py-2 px-3 text-slate-600">{a.pavimento || '—'}</td>
                          <td className="py-2 pr-3 font-medium">{a.rotulo}</td>
                          {categoriasSanit.map((c) => <td key={c} className="py-2 pr-3 text-right tabular-nums">{a.totais.sanitarios[c] || ''}</td>)}
                          <td className="py-2 pr-3 text-right tabular-nums font-medium">{Object.values(a.totais.sanitarios).reduce((x, y) => x + y, 0)}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-slate-50 font-medium">
                        <td className="py-2 px-3" colSpan={2}>Total</td>
                        {categoriasSanit.map((c) => (
                          <td key={c} className="py-2 pr-3 text-right tabular-nums">{ambs.reduce((s, a) => s + (a.totais.sanitarios[c] || 0), 0)}</td>
                        ))}
                        <td className="py-2 pr-3 text-right tabular-nums">{totais.sanitarios}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
