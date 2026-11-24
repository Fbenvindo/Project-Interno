// Resultado de uma análise: lista de interferências (agrupadas, com filtros), visualizador 3D,
// detalhes da pendência (estado, responsável, comentário), edição em lote e relatório PDF.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Eye, EyeOff, FileDown, FileUp, Maximize2, Share2 } from 'lucide-react';
import { clashApi } from '../api';
import { Button, Input } from '../ui';
import { ClashViewer, parseGeometry } from './viewer';
import { clashMeasure, fmtCoords, openReport, typeLabel } from './report';
import { buildBcf, downloadBytes, readBcf } from './bcf';

const STATE_STYLE = { nova: 'bg-red-100 text-red-700', ativa: 'bg-amber-100 text-amber-800', resolvida: 'bg-green-100 text-green-700', aprovada: 'bg-indigo-100 text-indigo-700' };
const sel = 'h-8 rounded-md border border-gray-300 bg-white px-2 text-xs';
const SIT_STYLE = { nova: 'text-blue-700', mantida: 'text-gray-500', reaberta: 'text-red-700' };
const fmtDate = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function ClashView({ empreendimento, analiseId, canApprove, onBack }) {
  const [an, setAn] = useState(null);
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState(null);
  const [filtro, setFiltro] = useState({ estado: 'abertas', tipo: '', pavimento: '', responsavel: '', situacao: '', texto: '' });
  const [showResolved, setShowResolved] = useState(false);
  const bcfInput = useRef(null);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [open, setOpen] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [bulk, setBulk] = useState({ estado: '', responsavel_id: '' });
  const [geoState, setGeoState] = useState('Carregando modelos…');
  const [context, setContext] = useState(true);
  const [report, setReport] = useState(null);
  const box = useRef(null);
  const viewer = useRef(null);

  const load = useCallback(async () => {
    const a = await clashApi.get(analiseId);
    setAn(a);
    return a;
  }, [analiseId]);

  useEffect(() => {
    load().catch((e) => setMsg(`Erro: ${e.message}`));
    clashApi
      .overview(empreendimento.id)
      .then((d) => setUsers(d.usuarios))
      .catch(() => {});
  }, [load, empreendimento.id]);

  // Visualizador: cria uma vez e carrega a geometria dos modelos da análise.
  useEffect(() => {
    if (!an || viewer.current || !box.current) return undefined;
    const v = new ClashViewer(box.current);
    viewer.current = v;
    let cancelled = false;
    (async () => {
      try {
        const models = [];
        for (let i = 0; i < an.modelos.length; i++) {
          setGeoState(`Carregando modelo ${i + 1} de ${an.modelos.length} (${an.modelos[i].codigo})…`);
          models.push({ geo: parseGeometry(await clashApi.geometry(an.id, i)), disciplina: an.modelos[i].disciplina });
          if (cancelled) return;
        }
        v.setModels(models, an.origem || models[0]?.geo.origem || [0, 0, 0]);
        setGeoState(null);
      } catch (e) {
        setGeoState(`Não foi possível carregar os modelos: ${e.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [an]);
  useEffect(
    () => () => {
      viewer.current?.dispose();
      viewer.current = null;
    },
    [],
  );

  const modelIdx = useCallback((docId) => an?.modelos.findIndex((m) => m.documento_id === docId) ?? -1, [an]);
  const clashes = an?.interferencias ?? [];
  const pavimentos = useMemo(() => [...new Set(clashes.map((c) => c.pavimento).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })), [clashes]);

  const shown = useMemo(() => {
    const q = filtro.texto.trim().toLowerCase();
    return clashes.filter(
      (c) =>
        (!filtro.estado || (filtro.estado === 'abertas' ? c.estado === 'nova' || c.estado === 'ativa' : c.estado === filtro.estado)) &&
        (!filtro.tipo || c.tipo === filtro.tipo) &&
        (!filtro.pavimento || c.pavimento === filtro.pavimento) &&
        (!filtro.responsavel || (filtro.responsavel === '-' ? !c.responsavel_id : String(c.responsavel_id) === filtro.responsavel)) &&
        (!filtro.situacao || c.situacao === filtro.situacao) &&
        (!q || [c.a.nome, c.b.nome, c.a.tipo, c.b.tipo, c.grupo_nome, c.comentario, String(c.numero)].some((s) => String(s || '').toLowerCase().includes(q))),
    );
  }, [clashes, filtro]);

  // Linhas da lista: grupos (cabeçalho + itens, se aberto) e interferências soltas, pela numeração.
  const rows = useMemo(() => {
    const out = [];
    const groups = new Map();
    for (const c of shown) {
      if (c.grupo == null) out.push({ kind: 'item', c, first: c.numero });
      else {
        if (!groups.has(c.grupo)) {
          const g = { kind: 'group', grupo: c.grupo, nome: c.grupo_nome, items: [], first: c.numero };
          groups.set(c.grupo, g);
          out.push(g);
        }
        groups.get(c.grupo).items.push(c);
      }
    }
    out.sort((a, b) => a.first - b.first);
    return out.flatMap((r) => (r.kind === 'group' && r.items.length === 1 ? [{ kind: 'item', c: r.items[0] }] : r.kind === 'group' ? [r, ...(open.has(r.grupo) ? r.items.map((c) => ({ kind: 'item', c, inGroup: true })) : [])] : [r]));
  }, [shown, open]);

  const current = clashes.find((c) => c.id === selected) || null;
  useEffect(() => {
    if (!current) return setEdit(null);
    setEdit({ estado: current.estado, responsavel_id: current.responsavel_id ?? '', comentario: '' });
    if (!geoState) viewer.current?.focus(current, modelIdx(current.a.documento_id), modelIdx(current.b.documento_id));
  }, [current?.id, geoState]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (ids, body, ok) => {
    setMsg(null);
    try {
      const updated = await clashApi.update(an.id, { ids, ...body });
      const byId = new Map(updated.map((u) => [u.id, u]));
      setAn((a) => ({ ...a, interferencias: a.interferencias.map((c) => byId.get(c.id) || c) }));
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    }
  };

  const toggleCheck = (ids, on) =>
    setChecked((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  const makeReport = async () => {
    if (!shown.length || geoState) return;
    const win = window.open('', '_blank');
    if (!win) return setMsg('Erro: o navegador bloqueou a janela do relatório; permita pop-ups para este endereço.');
    win.document.write('<p style="font-family:Arial;padding:20px">Gerando o relatório…</p>');
    const items = [];
    const limit = 300;
    const list = shown.slice(0, limit);
    for (let i = 0; i < list.length; i++) {
      setReport(`Gerando imagens ${i + 1} de ${list.length}…`);
      const c = list[i];
      viewer.current.focus(c, modelIdx(c.a.documento_id), modelIdx(c.b.documento_id));
      items.push({ clash: c, image: viewer.current.snapshot(640, 420) });
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    if (current) viewer.current.focus(current, modelIdx(current.a.documento_id), modelIdx(current.b.documento_id));
    setReport(null);
    const filtroTexto = [
      filtro.estado === 'abertas' ? 'só em aberto' : filtro.estado && an.estados[filtro.estado],
      filtro.tipo && (filtro.tipo === 'colisao' ? 'colisões' : 'folgas'),
      filtro.pavimento,
      shown.length > limit && `primeiras ${limit} de ${shown.length}`,
    ]
      .filter(Boolean)
      .join(', ');
    openReport({ win, empreendimento, analise: an, items, estados: an.estados, filtroTexto });
  };

  /** BCF das interferências filtradas: ponto de vista, elementos (GlobalId) e imagem de cada uma. */
  const exportBcf = async () => {
    if (!shown.length || geoState) return;
    const items = [];
    const limit = 1000;
    const list = shown.slice(0, limit);
    for (let i = 0; i < list.length; i++) {
      setReport(`Preparando BCF ${i + 1} de ${list.length}…`);
      const c = list[i];
      viewer.current.focus(c, modelIdx(c.a.documento_id), modelIdx(c.b.documento_id));
      items.push({ clash: c, image: viewer.current.snapshot(800, 520, 'image/png'), camera: viewer.current.cameraState() });
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    if (current) viewer.current.focus(current, modelIdx(current.a.documento_id), modelIdx(current.b.documento_id));
    setReport(null);
    const zip = buildBcf({ empreendimento, analise: an, items, users, author: 'CDE' });
    const safe = an.nome.replace(/[^A-Za-z0-9._-]+/g, '_');
    downloadBytes(zip, `Interferencias_${safe}_${new Date().toISOString().slice(0, 10)}.bcf`, 'application/zip');
    setMsg(`BCF com ${items.length} interferência(s) gerado${shown.length > limit ? ` (primeiras ${limit} de ${shown.length})` : ''}. Abra no Revit (BCF Manager), Navisworks, Solibri ou BIMcollab.`);
  };

  const importBcf = async (file) => {
    setMsg(null);
    try {
      const topicos = readBcf(new Uint8Array(await file.arrayBuffer()));
      const r = await clashApi.bcfImport(an.id, topicos);
      await load();
      setMsg(
        `BCF importado: ${r.encontrados} de ${r.topicos} tópico(s) desta análise, ${r.estados} estado(s) atualizado(s), ${r.comentarios} comentário(s) novo(s)${r.ignorados ? ` · ${r.ignorados} tópico(s) de outras análises ignorado(s)` : ''}.`,
      );
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    }
  };

  if (!an) return <p className="text-sm text-gray-500">{msg || 'Carregando análise…'}</p>;
  const cmp = an.resumo?.comparacao;
  const allShownChecked = shown.length > 0 && shown.every((c) => checked.has(c.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Análises
        </Button>
        <h2 className="text-lg font-semibold">{an.nome}</h2>
        <span className="text-xs text-gray-500">
          {an.modelos.map((m) => `${m.codigo} ${m.revisao}`).join(' · ')} · {an.resumo.total} interferência(s)
        </span>
        <div className="ml-auto flex items-center gap-2">
          {report && <span className="text-xs text-blue-700">{report}</span>}
          <Button size="sm" variant="outline" disabled={!!report || !!geoState || !shown.length} onClick={makeReport} title="Relatório das interferências filtradas, com imagens">
            <FileDown className="w-4 h-4 mr-1" /> Relatório PDF ({Math.min(shown.length, 300)})
          </Button>
          <Button size="sm" variant="outline" disabled={!!report || !!geoState || !shown.length} onClick={exportBcf} title="BCF das interferências filtradas, para Revit, Navisworks, Solibri, BIMcollab…">
            <Share2 className="w-4 h-4 mr-1" /> Exportar BCF
          </Button>
          <Button size="sm" variant="outline" disabled={!!report} onClick={() => bcfInput.current?.click()} title="Traz de volta o status e os comentários feitos em outro software">
            <FileUp className="w-4 h-4 mr-1" /> Importar BCF
          </Button>
          <input
            ref={bcfInput}
            type="file"
            accept=".bcf,.bcfzip,.zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) importBcf(f);
            }}
          />
        </div>
      </div>

      {an.automatica ? <p className="text-xs text-gray-500">Rodada automaticamente quando chegou revisão nova de um dos modelos.</p> : null}
      {cmp && (
        <div className="rounded-lg border bg-white px-3 py-2 text-sm">
          Comparada com a análise de {fmtDate(an.anterior?.concluida_at)}
          {an.anterior ? ` (${an.anterior.modelos.map((m) => `${m.codigo.split('-').slice(-3).join('-')} ${m.revisao}`).join(', ')})` : ''}:{' '}
          <button className="text-blue-700 hover:underline" onClick={() => setFiltro({ ...filtro, estado: '', situacao: 'nova' })}>
            {cmp.novas} nova(s)
          </button>
          {' · '}
          <button className="text-gray-700 hover:underline" onClick={() => setFiltro({ ...filtro, estado: '', situacao: 'mantida' })}>
            {cmp.mantidas} continuam
          </button>
          {' · '}
          <button className="text-red-700 hover:underline" onClick={() => setFiltro({ ...filtro, estado: '', situacao: 'reaberta' })}>
            {cmp.reabertas} reaberta(s)
          </button>
          {' · '}
          <button className="text-green-700 hover:underline" onClick={() => setShowResolved(!showResolved)}>
            {cmp.resolvidas} resolvida(s) pela revisão {showResolved ? '▴' : '▾'}
          </button>
          {showResolved && (
            <div className="mt-2 max-h-40 overflow-auto text-xs text-gray-600 border-t pt-1">
              {cmp.resolvidasLista.map((r) => (
                <div key={r.guid || r.numero}>
                  #{r.numero} (análise anterior) · {r.tipo === 'colisao' ? 'colisão' : 'folga'} · {r.a.nome} × {r.b.nome}
                  {r.pavimento ? ` · ${r.pavimento}` : ''}
                </div>
              ))}
              {!cmp.resolvidasLista.length && 'Nenhuma.'}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(340px, 430px) 1fr', height: 'calc(100vh - 150px)', minHeight: 520 }}>
        {/* Lista */}
        <div className="flex flex-col border rounded-lg bg-white overflow-hidden">
          <div className="p-2 border-b space-y-2">
            <div className="flex flex-wrap gap-1">
              <select className={sel} value={filtro.estado} onChange={(e) => setFiltro({ ...filtro, estado: e.target.value })}>
                <option value="abertas">Em aberto</option>
                <option value="">Todos os estados</option>
                {Object.entries(an.estados).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <select className={sel} value={filtro.tipo} onChange={(e) => setFiltro({ ...filtro, tipo: e.target.value })}>
                <option value="">Colisões e folgas</option>
                <option value="colisao">Colisões</option>
                <option value="folga">Folgas</option>
              </select>
              <select className={sel} value={filtro.pavimento} onChange={(e) => setFiltro({ ...filtro, pavimento: e.target.value })}>
                <option value="">Todos os pavimentos</option>
                {pavimentos.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <select className={sel} value={filtro.responsavel} onChange={(e) => setFiltro({ ...filtro, responsavel: e.target.value })}>
                <option value="">Todos os responsáveis</option>
                <option value="-">Sem responsável</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name}
                  </option>
                ))}
              </select>
              {cmp && (
                <select className={sel} value={filtro.situacao} onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value })}>
                  <option value="">Novas e antigas</option>
                  {Object.entries(an.situacoes).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Input className="h-8 text-xs" placeholder="Buscar nº, elemento, tipo, comentário…" value={filtro.texto} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={allShownChecked} onChange={(e) => toggleCheck(shown.map((c) => c.id), e.target.checked)} /> {shown.length} de {clashes.length}
              </label>
              {checked.size > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  {checked.size} marcada(s):
                  <select className={sel} value={bulk.estado} onChange={(e) => setBulk({ ...bulk, estado: e.target.value })}>
                    <option value="">estado…</option>
                    {Object.entries(an.estados)
                      .filter(([k]) => canApprove || k !== 'aprovada')
                      .map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                  </select>
                  <select className={sel} value={bulk.responsavel_id} onChange={(e) => setBulk({ ...bulk, responsavel_id: e.target.value })}>
                    <option value="">responsável…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!bulk.estado && !bulk.responsavel_id}
                    onClick={async () => {
                      await save([...checked], { ...(bulk.estado ? { estado: bulk.estado } : {}), ...(bulk.responsavel_id ? { responsavel_id: Number(bulk.responsavel_id) } : {}) }, `${checked.size} interferência(s) atualizada(s).`);
                      setChecked(new Set());
                      setBulk({ estado: '', responsavel_id: '' });
                    }}
                  >
                    Aplicar
                  </Button>
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto text-sm">
            {rows.map((r) =>
              r.kind === 'group' ? (
                <div key={`g${r.grupo}`} className="flex items-center gap-2 px-2 py-1.5 border-b bg-gray-50 cursor-pointer" onClick={() => setOpen((s) => new Set(s.has(r.grupo) ? [...s].filter((x) => x !== r.grupo) : [...s, r.grupo]))}>
                  <input
                    type="checkbox"
                    checked={r.items.every((c) => checked.has(c.id))}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => toggleCheck(r.items.map((c) => c.id), e.target.checked)}
                  />
                  {open.has(r.grupo) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="font-medium truncate">{r.nome}</span>
                  <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">{r.items.length} interferências</span>
                </div>
              ) : (
                <div
                  key={r.c.id}
                  className={`flex items-start gap-2 px-2 py-1.5 border-b cursor-pointer ${r.inGroup ? 'pl-8' : ''} ${selected === r.c.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  onClick={() => setSelected(r.c.id)}
                >
                  <input type="checkbox" className="mt-1" checked={checked.has(r.c.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleCheck([r.c.id], e.target.checked)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <b>#{r.c.numero}</b>
                      <span className={`text-[10px] uppercase tracking-wide ${r.c.tipo === 'colisao' ? 'text-red-600' : 'text-amber-600'}`}>{r.c.tipo === 'colisao' ? 'colisão' : 'folga'}</span>
                      <span className={`ml-auto text-[11px] px-1.5 rounded-full ${STATE_STYLE[r.c.estado]}`}>{an.estados[r.c.estado]?.split(' (')[0]}</span>
                    </div>
                    <div className="truncate text-xs">
                      <span className="text-red-600">■</span> {r.c.a.nome} <span className="text-gray-400">×</span> <span className="text-blue-600">■</span> {r.c.b.nome}
                    </div>
                    <div className="truncate text-[11px] text-gray-500">
                      {r.c.pavimento || 'sem pavimento'} · {clashMeasure(r.c)}
                      {r.c.responsavel_nome ? ` · ${r.c.responsavel_nome}` : ''}
                      {cmp && r.c.situacao !== 'mantida' ? <span className={`ml-1 ${SIT_STYLE[r.c.situacao]}`}>· {r.c.situacao === 'nova' ? 'nova' : 'reaberta'}</span> : null}
                    </div>
                  </div>
                </div>
              ),
            )}
            {!rows.length && <p className="p-6 text-center text-gray-400 text-sm">{clashes.length ? 'Nenhuma interferência com esses filtros.' : 'Nenhuma interferência encontrada nesta análise.'}</p>}
          </div>
        </div>

        {/* Visualizador e detalhes */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="relative flex-1 min-h-[300px] border rounded-lg overflow-hidden bg-gray-100">
            <div ref={box} className="absolute inset-0" />
            {geoState && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-600 bg-gray-100/80">{geoState}</div>}
            <div className="absolute top-2 right-2 flex gap-1">
              <Button size="sm" variant="outline" title={context ? 'Ocultar os demais elementos' : 'Mostrar os demais elementos'} onClick={() => (setContext(!context), viewer.current?.setContextVisible(!context))}>
                {context ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button size="sm" variant="outline" title="Ver os modelos inteiros" onClick={() => viewer.current?.fitAll()}>
                <Maximize2 className="w-4 h-4" />
              </Button>
            </div>
            <div className="absolute bottom-2 left-2 text-[11px] bg-white/85 rounded px-2 py-1">
              <span className="text-red-600">■</span> elemento A · <span className="text-blue-600">■</span> elemento B · arraste para girar, botão direito para mover, roda para aproximar
            </div>
          </div>
          {current && edit ? (
            <div className="border rounded-lg bg-white p-3 text-sm grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="space-y-1">
                <div className="font-semibold">
                  #{current.numero} · {current.tipo === 'colisao' ? 'Colisão física' : 'Folga insuficiente'} · {clashMeasure(current)}
                </div>
                {[
                  ['A', 'text-red-600', current.a],
                  ['B', 'text-blue-600', current.b],
                ].map(([k, cls, e]) => (
                  <div key={k} className="text-xs">
                    <b className={cls}>{k}</b> {e.nome} <span className="text-gray-500">({typeLabel(e.tipo)})</span>
                    <div className="text-gray-500 pl-3">
                      <span className="font-mono">{e.codigo}</span>
                      {e.pavimento ? ` · ${e.pavimento}` : ''} · GlobalId <span className="font-mono select-all">{e.globalId || '—'}</span>
                    </div>
                  </div>
                ))}
                <div className="text-xs text-gray-500">Ponto (IFC, m): {fmtCoords(current.ponto)}</div>
                {current.updated_at && (
                  <div className="text-[11px] text-gray-400">
                    Atualizada por {current.updated_by} em {new Date(current.updated_at).toLocaleString('pt-BR')}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select className={sel + ' flex-1'} value={edit.estado} onChange={(e) => setEdit({ ...edit, estado: e.target.value })}>
                    {Object.entries(an.estados)
                      .filter(([k]) => canApprove || k !== 'aprovada' || current.estado === 'aprovada')
                      .map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                  </select>
                  <select className={sel + ' flex-1'} value={edit.responsavel_id} onChange={(e) => setEdit({ ...edit, responsavel_id: e.target.value })}>
                    <option value="">Sem responsável</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="max-h-28 overflow-auto space-y-1 text-xs">
                  {(current.comentarios || []).map((k) => (
                    <div key={k.id} className={`rounded px-2 py-1 ${k.origem === 'sistema' ? 'bg-gray-50 text-gray-500' : k.origem === 'bcf' ? 'bg-indigo-50' : k.origem === 'smarteasybim' ? 'bg-sky-50' : 'bg-amber-50'}`}>
                      <span className="text-gray-500">
                        {k.autor} · {fmtDate(k.created_at)}
                        {k.origem === 'bcf' ? ' · BCF' : k.origem === 'smarteasybim' ? ' · SmartEasyBIM' : ''}
                      </span>
                      <div>{k.texto}</div>
                    </div>
                  ))}
                  {!(current.comentarios || []).length && <div className="text-gray-400">Sem comentários.</div>}
                </div>
                <textarea
                  className="w-full h-14 rounded-md border border-gray-300 p-2 text-xs"
                  placeholder="Novo comentário (ex.: desviar a tubulação por baixo da viga)"
                  value={edit.comentario}
                  onChange={(e) => setEdit({ ...edit, comentario: e.target.value })}
                />
                <Button
                  size="sm"
                  onClick={() =>
                    save([current.id], { estado: edit.estado, responsavel_id: edit.responsavel_id === '' ? null : Number(edit.responsavel_id), comentario: edit.comentario }, 'Interferência atualizada.').then(() =>
                      setEdit((x) => x && { ...x, comentario: '' }),
                    )
                  }
                >
                  Salvar
                </Button>
              </div>
            </div>
          ) : (
            <div className="border rounded-lg bg-white p-3 text-sm text-gray-500">Escolha uma interferência na lista para vê-la no 3D e registrar o tratamento.</div>
          )}
          {msg && <p className={`text-sm ${msg.startsWith('Erro') ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>}
        </div>
      </div>
    </div>
  );
}
