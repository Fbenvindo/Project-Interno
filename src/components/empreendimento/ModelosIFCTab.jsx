import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Box, ClipboardList, Download, Eye, FileUp, Loader2, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { createPageUrl } from '@/utils';
import {
  deleteModeloIfc, downloadModeloIfc, formatBytes, listModelosIfc, uploadModeloIfc,
} from '@/api/ifcModelos';

export default function ModelosIFCTab({ empreendimentoId, readOnly }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [modelos, setModelos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [descricao, setDescricao] = useState('');
  const [upload, setUpload] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!empreendimentoId) return;
    setLoading(true);
    setError(null);
    try {
      setModelos(await listModelosIfc(empreendimentoId));
    } catch (err) {
      setError(err.message || 'Erro ao carregar modelos.');
    } finally {
      setLoading(false);
    }
  }, [empreendimentoId]);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!/\.ifc$/i.test(file.name)) {
      setError('Selecione um arquivo com extensão .ifc');
      return;
    }
    setError(null);
    setUpload({ name: file.name, percent: 0 });
    try {
      const novo = await uploadModeloIfc(empreendimentoId, file, {
        descricao: descricao.trim() || undefined,
        onProgress: (percent) => setUpload({ name: file.name, percent }),
      });
      setModelos((prev) => [novo, ...prev]);
      setDescricao('');
    } catch (err) {
      setError(err.message || 'Erro ao enviar o arquivo.');
    } finally {
      setUpload(null);
    }
  };

  const handleDelete = async (modelo) => {
    if (!confirm(`Excluir o modelo "${modelo.nome}"? Esta ação não pode ser desfeita.`)) return;
    setBusyId(modelo.id);
    try {
      await deleteModeloIfc(modelo.id);
      setModelos((prev) => prev.filter((m) => m.id !== modelo.id));
    } catch (err) {
      setError(err.message || 'Erro ao excluir o modelo.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (modelo) => {
    setBusyId(modelo.id);
    try {
      const data = await downloadModeloIfc(modelo.id);
      const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = modelo.nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.message || 'Erro ao baixar o modelo.');
    } finally {
      setBusyId(null);
    }
  };

  const openViewer = (modelo) => {
    navigate(`${createPageUrl('VisualizadorIFC')}?modelo=${modelo.id}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Box className="w-5 h-5 text-blue-600" /> Modelos BIM (IFC)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!readOnly && (
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Descrição (opcional), ex.: Arquitetura rev. 03"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              disabled={!!upload}
              className="sm:max-w-sm"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".ifc"
              className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={!!upload}>
              {upload ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileUp className="w-4 h-4 mr-2" />}
              Enviar arquivo IFC
            </Button>
          </div>
        )}

        {upload && (
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm text-gray-700">
              {upload.percent < 100 ? `Enviando ${upload.name}...` : `Processando ${upload.name}...`}
            </p>
            <Progress value={upload.percent} />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando modelos...
          </div>
        ) : modelos.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            Nenhum modelo IFC salvo neste empreendimento.
          </p>
        ) : (
          <div className="space-y-2">
            {modelos.map((m) => (
              <div key={m.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border rounded-md bg-white hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="font-medium truncate" title={m.nome}>{m.nome}</p>
                  {m.descricao && <p className="text-sm text-gray-700 truncate">{m.descricao}</p>}
                  <p className="text-xs text-gray-500">
                    {formatBytes(m.tamanho_bytes)}
                    {m.created_at && <> · {format(new Date(m.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</>}
                    {m.enviado_por_nome && <> · {m.enviado_por_nome}</>}
                  </p>
                  {m.levantamento_em && (
                    <p className="text-xs text-emerald-700 flex items-center gap-1 mt-0.5">
                      <ClipboardList className="w-3.5 h-3.5" />
                      Levantamento por ambiente salvo em {format(new Date(m.levantamento_em), 'dd/MM/yyyy', { locale: ptBR })}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={() => openViewer(m)}>
                    <Eye className="w-4 h-4 mr-1" /> Visualizar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDownload(m)} disabled={busyId === m.id} title="Baixar arquivo">
                    {busyId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  </Button>
                  {!readOnly && (
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(m)} disabled={busyId === m.id} title="Excluir">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
