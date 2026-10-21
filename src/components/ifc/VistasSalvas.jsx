import { Download, Eye, FileDown, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Lista de vistas salvas do modelo aberto, com exportação em PDF (todas numa prancha cada) e BCF
export default function VistasSalvas({ vistas, ocupado, onRestaurar, onExcluir, onPng, onPdf, onBcf }) {
  if (!vistas.length) {
    return (
      <p className="text-sm text-slate-400 px-3 py-4">
        Nenhuma vista salva. Monte a vista no painel "Axonometria e vistas" e clique em Salvar.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <div className="grid grid-cols-2 gap-1">
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={ocupado} onClick={onPdf} title="Uma prancha A3 por vista">
          {ocupado ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />} PDF (todas)
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={ocupado} onClick={onBcf} title="Abre no Revit e em outros programas BIM pelos plugins de BCF">
          <Download className="w-3.5 h-3.5 mr-1" /> BCF (todas)
        </Button>
      </div>
      {vistas.map((v) => (
        <div key={v.id} className="rounded-md border bg-white overflow-hidden">
          {v.imagem ? (
            <button type="button" className="block w-full" onClick={() => onRestaurar(v)} title="Abrir esta vista">
              <img src={v.imagem.dataUrl} alt={v.nome} className="w-full h-24 object-cover bg-slate-50" />
            </button>
          ) : (
            <div className="h-10 bg-slate-50 text-[11px] text-slate-400 flex items-center justify-center">sem miniatura (salva em outra sessão)</div>
          )}
          <div className="flex items-center gap-1 px-2 py-1.5">
            <p className="flex-1 truncate text-xs font-medium" title={v.nome}>{v.nome}</p>
            <Button size="icon" variant="ghost" className="h-6 w-6" title="Abrir" onClick={() => onRestaurar(v)}><Eye className="w-3.5 h-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" title="Baixar PNG" disabled={ocupado} onClick={() => onPng(v)}><ImageIcon className="w-3.5 h-3.5" /></Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" title="Excluir" onClick={() => onExcluir(v)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button>
          </div>
        </div>
      ))}
    </div>
  );
}
