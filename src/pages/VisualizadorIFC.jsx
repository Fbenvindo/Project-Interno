import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, Box, ChevronDown, ChevronRight, Eye, EyeOff, FileUp, Focus, Layers, Loader2, Maximize, Save, Search, X,
} from 'lucide-react';
import { IfcViewerEngine } from '@/components/ifc/ifcViewerEngine';
import { ActivityTimerContext } from '@/components/contexts/ActivityTimerContext';
import { downloadModeloIfc, getModeloIfc, uploadModeloIfc } from '@/api/ifcModelos';
import { createPageUrl } from '@/utils';

const TYPE_LABELS = {
  IFCPROJECT: 'Projeto',
  IFCSITE: 'Terreno',
  IFCBUILDING: 'Edifício',
  IFCBUILDINGSTOREY: 'Pavimento',
  IFCSPACE: 'Ambiente',
  IFCWALL: 'Parede',
  IFCWALLSTANDARDCASE: 'Parede',
  IFCSLAB: 'Laje',
  IFCBEAM: 'Viga',
  IFCCOLUMN: 'Pilar',
  IFCDOOR: 'Porta',
  IFCWINDOW: 'Janela',
  IFCSTAIR: 'Escada',
  IFCSTAIRFLIGHT: 'Lance de escada',
  IFCRAILING: 'Guarda-corpo',
  IFCROOF: 'Cobertura',
  IFCFOOTING: 'Fundação',
  IFCPLATE: 'Placa',
  IFCMEMBER: 'Membro',
  IFCCOVERING: 'Revestimento',
  IFCFURNISHINGELEMENT: 'Mobiliário',
  IFCFLOWSEGMENT: 'Tubulação/Duto',
  IFCFLOWTERMINAL: 'Terminal',
  IFCFLOWFITTING: 'Conexão',
  IFCBUILDINGELEMENTPROXY: 'Elemento genérico',
  IFCOPENINGELEMENT: 'Abertura',
};

const typeLabel = (type) => TYPE_LABELS[(type || '').toUpperCase()] || (type || '').replace(/^Ifc/i, '');

function collectIds(node, acc = []) {
  acc.push(node.expressID);
  node.children.forEach((c) => collectIds(c, acc));
  return acc;
}

function filterTree(node, term) {
  if (!term) return node;
  const children = node.children.map((c) => filterTree(c, term)).filter(Boolean);
  const text = `${node.name || ''} ${typeLabel(node.type)} ${node.type} ${node.expressID}`.toLowerCase();
  if (children.length || text.includes(term)) return { ...node, children };
  return null;
}

function TreeNode({ node, depth, selectedId, expanded, toggleExpanded, hidden, onSelect, onToggleVisible, forceOpen }) {
  const isOpen = forceOpen || expanded.has(node.expressID);
  const hasChildren = node.children.length > 0;
  const isHidden = hidden.has(node.expressID);
  const isSelected = selectedId === node.expressID;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded px-1 py-0.5 text-sm cursor-pointer ${isSelected ? 'bg-blue-100 text-blue-900' : 'hover:bg-slate-100'}`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => onSelect(node.expressID)}
      >
        <button
          type="button"
          className="w-4 h-4 flex items-center justify-center text-slate-500 shrink-0"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpanded(node.expressID); }}
        >
          {hasChildren ? (isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>
        <span className={`truncate flex-1 ${isHidden ? 'text-slate-400' : ''}`} title={`${node.type} #${node.expressID}`}>
          <span className="text-slate-500">{typeLabel(node.type)}</span>
          {node.name ? <span className="ml-1">{node.name}</span> : <span className="ml-1 text-slate-400">#{node.expressID}</span>}
        </span>
        <button
          type="button"
          className={`w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-900 shrink-0 ${isHidden ? '' : 'opacity-0 group-hover:opacity-100'}`}
          title={isHidden ? 'Mostrar' : 'Ocultar'}
          onClick={(e) => { e.stopPropagation(); onToggleVisible(node); }}
        >
          {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      {isOpen && node.children.map((child) => (
        <TreeNode
          key={child.expressID}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
          hidden={hidden}
          onSelect={onSelect}
          onToggleVisible={onToggleVisible}
          forceOpen={forceOpen}
        />
      ))}
    </div>
  );
}

export default function VisualizadorIFC() {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const fileInputRef = useRef(null);

  const [fileName, setFileName] = useState(null);
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [properties, setProperties] = useState(null);
  const [loadingProps, setLoadingProps] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [hidden, setHidden] = useState(new Set());
  const [hiddenTypes, setHiddenTypes] = useState(new Set());
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  // Arquivo aberto do computador (pode ser salvo) ou modelo salvo em um empreendimento
  const [localFile, setLocalFile] = useState(null);
  const [savedModelo, setSavedModelo] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const modeloParam = searchParams.get('modelo');
  const { hasPermission } = useContext(ActivityTimerContext) || {};
  const canSave = !!hasPermission?.('coordenador');

  const loadProperties = useCallback(async (id) => {
    const engine = engineRef.current;
    if (!engine || id == null) { setProperties(null); return; }
    setLoadingProps(true);
    try {
      setProperties(await engine.getProperties(id));
    } catch (err) {
      console.error('Erro ao ler propriedades IFC:', err);
      setProperties(null);
    } finally {
      setLoadingProps(false);
    }
  }, []);

  useEffect(() => {
    const engine = new IfcViewerEngine(containerRef.current, {
      onSelect: (id) => setSelectedId(id),
    });
    engineRef.current = engine;
    return () => engine.dispose();
  }, []);

  useEffect(() => { loadProperties(selectedId); }, [selectedId, loadProperties]);

  const resetView = () => {
    setError(null);
    setModel(null);
    setSelectedId(null);
    setHidden(new Set());
    setHiddenTypes(new Set());
    setSearch('');
  };

  const loadIntoEngine = useCallback(async (source) => {
    const result = await engineRef.current.load(source, setLoading);
    setModel(result);
    // Expande automaticamente até o nível dos pavimentos
    const initial = new Set();
    const walk = (n, d) => { if (d < 3) { initial.add(n.expressID); n.children.forEach((c) => walk(c, d + 1)); } };
    walk(result.tree, 0);
    setExpanded(initial);
  }, []);

  const openFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.ifc$/i.test(file.name)) {
      setError('Selecione um arquivo com extensão .ifc');
      return;
    }
    resetView();
    setSavedModelo(null);
    setLocalFile(file);
    setFileName(file.name);
    setLoading({ stage: 'Carregando leitor IFC...', percent: 0 });
    try {
      await loadIntoEngine(file);
    } catch (err) {
      console.error('Erro ao carregar IFC:', err);
      setError(err?.message || 'Falha ao carregar o arquivo IFC.');
      setFileName(null);
      setLocalFile(null);
    } finally {
      setLoading(null);
    }
  }, [loadIntoEngine]);

  // Abre um modelo salvo quando a página recebe ?modelo=ID (vindo da aba Modelos BIM)
  useEffect(() => {
    if (!modeloParam) return undefined;
    let cancelled = false;
    (async () => {
      resetView();
      setLocalFile(null);
      setLoading({ stage: 'Buscando modelo...', percent: 0 });
      try {
        const meta = await getModeloIfc(modeloParam);
        if (cancelled) return;
        setSavedModelo(meta);
        setFileName(meta.nome);
        const data = await downloadModeloIfc(meta.id, {
          total: Number(meta.tamanho_bytes),
          onProgress: (percent) => { if (!cancelled) setLoading({ stage: 'Baixando modelo...', percent }); },
        });
        if (cancelled) return;
        await loadIntoEngine(data);
      } catch (err) {
        if (cancelled) return;
        console.error('Erro ao abrir modelo salvo:', err);
        setError(err?.message || 'Falha ao abrir o modelo salvo.');
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => { cancelled = true; };
  }, [modeloParam, loadIntoEngine]);

  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    engineRef.current?.select(id);
  }, []);

  const findNode = useCallback((id) => {
    if (!model || id == null) return null;
    const walk = (n) => (n.expressID === id ? n : n.children.map(walk).find(Boolean));
    return walk(model.tree) || null;
  }, [model]);

  // Ids do elemento selecionado e de tudo que está contido nele (ex.: pavimento e seus elementos)
  const selectedIds = useMemo(() => {
    if (selectedId == null) return [];
    const node = findNode(selectedId);
    return node ? collectIds(node) : [selectedId];
  }, [selectedId, findNode]);

  const handleFocus = useCallback(() => {
    engineRef.current?.focus(selectedIds);
  }, [selectedIds]);

  const toggleExpanded = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleNodeVisible = useCallback((node) => {
    const ids = collectIds(node);
    setHidden((prev) => {
      const next = new Set(prev);
      const makeVisible = prev.has(node.expressID);
      ids.forEach((id) => (makeVisible ? next.delete(id) : next.add(id)));
      engineRef.current?.setElementsVisible(ids, makeVisible);
      return next;
    });
  }, []);

  const toggleType = useCallback((type) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      const makeVisible = prev.has(type);
      if (makeVisible) next.delete(type); else next.add(type);
      engineRef.current?.setTypeVisible(type, makeVisible);
      return next;
    });
  }, []);

  const isolateSelected = useCallback(() => {
    if (!selectedIds.length || !model) return;
    engineRef.current?.isolate(selectedIds);
    const keep = new Set(selectedIds);
    setHidden(new Set(collectIds(model.tree).filter((id) => !keep.has(id))));
    setHiddenTypes(new Set());
  }, [selectedIds, model]);

  const showAll = useCallback(() => {
    engineRef.current?.showAll();
    setHidden(new Set());
    setHiddenTypes(new Set());
  }, []);

  const term = search.trim().toLowerCase();
  const visibleTree = useMemo(() => (model ? filterTree(model.tree, term) : null), [model, term]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    openFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] p-4 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-auto">
          <Box className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-slate-900 leading-tight">Visualizador IFC</h1>
            <p className="text-xs text-slate-500">
              {fileName ? (
                <>
                  {fileName}
                  {model && <> · {model.schema} · {model.elementCount} elementos com geometria</>}
                  {savedModelo?.descricao && <> · {savedModelo.descricao}</>}
                </>
              ) : 'Abra um arquivo .ifc para navegar pelo modelo'}
            </p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ifc"
          className="hidden"
          onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        {savedModelo && (
          <Button variant="ghost" asChild>
            <Link to={`${createPageUrl('Empreendimento')}?id=${savedModelo.empreendimento_id}`}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Empreendimento
            </Link>
          </Button>
        )}
        <Button onClick={() => fileInputRef.current?.click()} disabled={!!loading}>
          <FileUp className="w-4 h-4 mr-2" /> Abrir IFC
        </Button>
        {canSave && localFile && model && (
          <Button variant="outline" onClick={() => setSaveOpen(true)}>
            <Save className="w-4 h-4 mr-2" /> Salvar no empreendimento
          </Button>
        )}
        <Button variant="outline" onClick={() => engineRef.current?.fitToView()} disabled={!model}>
          <Maximize className="w-4 h-4 mr-2" /> Enquadrar
        </Button>
        <Button variant="outline" onClick={handleFocus} disabled={!selectedIds.some((id) => engineRef.current?.hasGeometry(id))}>
          <Focus className="w-4 h-4 mr-2" /> Focar seleção
        </Button>
        <Button variant="outline" onClick={isolateSelected} disabled={selectedId == null}>
          <Layers className="w-4 h-4 mr-2" /> Isolar
        </Button>
        <Button variant="outline" onClick={showAll} disabled={!model}>
          <Eye className="w-4 h-4 mr-2" /> Mostrar tudo
        </Button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 gap-3">
        <div className="w-72 shrink-0 flex flex-col rounded-lg border bg-white min-h-0">
          <Tabs defaultValue="arvore" className="flex flex-col flex-1 min-h-0">
            <TabsList className="m-2 grid grid-cols-2">
              <TabsTrigger value="arvore">Estrutura</TabsTrigger>
              <TabsTrigger value="categorias">Categorias</TabsTrigger>
            </TabsList>
            <TabsContent value="arvore" className="flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <div className="px-2 pb-2 relative">
                <Search className="w-4 h-4 absolute left-4 top-2.5 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar elemento..."
                  className="pl-8 h-9"
                  disabled={!model}
                />
              </div>
              <ScrollArea className="flex-1 px-1 pb-2">
                {visibleTree ? (
                  <TreeNode
                    node={visibleTree}
                    depth={0}
                    selectedId={selectedId}
                    expanded={expanded}
                    toggleExpanded={toggleExpanded}
                    hidden={hidden}
                    onSelect={handleSelect}
                    onToggleVisible={toggleNodeVisible}
                    forceOpen={!!term}
                  />
                ) : (
                  <p className="text-sm text-slate-400 px-3 py-4">
                    {model ? 'Nenhum elemento encontrado.' : 'Nenhum modelo carregado.'}
                  </p>
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="categorias" className="flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <ScrollArea className="flex-1 px-3 pb-2">
                {model?.types.map(({ type, count }) => (
                  <label key={type} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                    <Checkbox checked={!hiddenTypes.has(type)} onCheckedChange={() => toggleType(type)} />
                    <span className="flex-1 truncate" title={type}>{typeLabel(type)}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </label>
                )) ?? <p className="text-sm text-slate-400 py-4">Nenhum modelo carregado.</p>}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <div
          className={`relative flex-1 min-w-0 rounded-lg border overflow-hidden ${dragOver ? 'ring-2 ring-blue-500' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div ref={containerRef} className="absolute inset-0" />
          {!model && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 pointer-events-none">
              <FileUp className="w-10 h-10 mb-2 text-slate-400" />
              <p className="font-medium">Arraste um arquivo .ifc aqui</p>
              <p className="text-sm">ou clique em “Abrir IFC”. O arquivo é lido localmente no navegador.</p>
            </div>
          )}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70">
              <div className="w-72 rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-slate-700 mb-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {loading.stage}
                </div>
                <Progress value={loading.percent} />
              </div>
            </div>
          )}
          {model && (
            <div className="absolute bottom-2 left-2 rounded bg-white/80 px-2 py-1 text-xs text-slate-500">
              Botão esquerdo: girar · Direito: mover · Roda: zoom · Clique: selecionar
            </div>
          )}
        </div>

        <div className="w-80 shrink-0 flex flex-col rounded-lg border bg-white min-h-0">
          <div className="px-3 py-2 border-b text-sm font-medium text-slate-700">Propriedades</div>
          <ScrollArea className="flex-1">
            <div className="p-3 text-sm">
              {selectedId == null && <p className="text-slate-400">Selecione um elemento no modelo ou na estrutura.</p>}
              {selectedId != null && loadingProps && (
                <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
              )}
              {selectedId != null && !loadingProps && properties && (
                <div className="space-y-4">
                  <PropertyGroup title="Atributos" rows={properties.attributes} />
                  {properties.materials.length > 0 && (
                    <PropertyGroup title="Materiais" rows={properties.materials.map((m, i) => ({ name: `Material ${i + 1}`, value: m }))} />
                  )}
                  {properties.groups.map((g, i) => (
                    <PropertyGroup key={`${g.name}-${i}`} title={g.name} rows={g.properties} />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
      {saveOpen && localFile && (
        <SalvarNoEmpreendimentoDialog
          file={localFile}
          onClose={() => setSaveOpen(false)}
          onSaved={(modelo) => {
            setSaveOpen(false);
            setLocalFile(null);
            setSavedModelo(modelo);
          }}
        />
      )}
    </div>
  );
}

function PropertyGroup({ title, rows }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" className="flex items-center gap-1 font-medium text-slate-800 mb-1" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {title}
      </button>
      {open && (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`} className="border-b last:border-0">
                <td className="py-1 pr-2 text-slate-500 align-top w-2/5 break-words">{r.name}</td>
                <td className="py-1 text-slate-900 break-all">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SalvarNoEmpreendimentoDialog({ file, onClose, onSaved }) {
  const { allEmpreendimentos = [] } = useContext(ActivityTimerContext) || {};
  const [empreendimentoId, setEmpreendimentoId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [percent, setPercent] = useState(null);
  const [error, setError] = useState(null);

  const opcoes = useMemo(
    () => [...allEmpreendimentos].sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''))),
    [allEmpreendimentos]
  );

  const salvar = async () => {
    if (!empreendimentoId) return;
    setError(null);
    setPercent(0);
    try {
      const modelo = await uploadModeloIfc(empreendimentoId, file, {
        descricao: descricao.trim() || undefined,
        onProgress: setPercent,
      });
      onSaved(modelo);
    } catch (err) {
      setError(err.message || 'Erro ao salvar o modelo.');
      setPercent(null);
    }
  };

  const saving = percent !== null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salvar modelo no empreendimento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 break-all">{file.name}</p>
          <div className="space-y-1">
            <Label>Empreendimento</Label>
            <Select value={empreendimentoId} onValueChange={setEmpreendimentoId} disabled={saving}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {opcoes.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Descrição (opcional)</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Arquitetura rev. 03" disabled={saving} />
          </div>
          {saving && <Progress value={percent} />}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={!empreendimentoId || saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
