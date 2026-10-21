import { useEffect, useState } from 'react';
import { Bookmark, ChevronDown, ChevronUp, FileDown, Image as ImageIcon, Lock, Shapes, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { VISTAS } from '@/components/ifc/ifcViewerEngine';

const ESTILOS = { cores: 'Cores do modelo', tecnico: 'Técnico (arestas)', cores_arestas: 'Cores + arestas' };
const fmtCota = (c) => {
  const v = Math.abs(c) < 0.005 ? 0 : c;
  return `${v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}`;
};

// Controles de projeção, vistas axonométricas, nível/corte, explosão e estilo.
// O estado é lido de volta do motor sempre que "sinal" muda (ex.: depois de restaurar uma vista salva).
export default function PainelAxonometria({ engine, niveis, sinal, onSalvarVista, onExportarAtual }) {
  const [aberto, setAberto] = useState(true);
  const [projecao, setProjecao] = useState('perspectiva');
  const [vista, setVista] = useState('');
  const [travado, setTravado] = useState(false);
  const [nivel, setNivel] = useState('todos');
  // Desligado por padrão: num modelo de instalações o corte a 1,20 m apagaria a tubulação de teto
  const [cortar, setCortar] = useState(false);
  const [alturaCorte, setAlturaCorte] = useState(1.2);
  const [explosao, setExplosao] = useState(0);
  const [estilo, setEstilo] = useState('cores');
  const [gerandoArestas, setGerandoArestas] = useState(null);

  useEffect(() => {
    if (!engine) return;
    const e = engine.estadoVista();
    setProjecao(e.projecao);
    setTravado(e.rotacaoTravada);
    setNivel(e.nivel == null ? 'todos' : String(e.nivel));
    setCortar(e.alturaCorte != null);
    if (e.alturaCorte != null) setAlturaCorte(e.alturaCorte);
    setExplosao(e.explosao);
    setEstilo(e.estilo);
  }, [engine, sinal]);

  if (!engine) return null;

  const reenquadrar = () => (vista ? engine.setVista(vista) : engine.fitToView());

  const mudarProjecao = (p) => {
    engine.setProjecao(p);
    setProjecao(p);
    if (p === 'perspectiva') setVista('');
  };

  const mudarVista = (v) => {
    setVista(v);
    engine.setVista(v);
    setProjecao(engine.projecao);
  };

  const aplicarNivel = (valor, corteLigado = cortar, altura = alturaCorte) => {
    const indice = valor === 'todos' ? null : Number(valor);
    if (indice != null && explosao) { engine.setExplosao(0); setExplosao(0); }
    engine.setNivel(indice, corteLigado ? altura : null);
    reenquadrar();
  };

  const nivelAtual = nivel === 'todos' ? null : niveis[Number(nivel)];
  const nomeSugerido = [
    VISTAS[vista]?.nome || (projecao === 'perspectiva' ? 'Perspectiva' : 'Vista ortográfica'),
    nivelAtual ? nivelAtual.nome : null,
    explosao ? 'explodida' : null,
  ].filter(Boolean).join(' — ');

  return (
    <div className="absolute top-2 right-2 z-10 w-64 rounded-lg border bg-white/95 shadow-sm text-xs">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 font-medium text-slate-700" onClick={() => setAberto(!aberto)}>
        <span className="flex items-center gap-1.5"><Shapes className="w-4 h-4 text-blue-600" /> Axonometria e vistas</span>
        {aberto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {aberto && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="grid grid-cols-2 gap-1">
            {['perspectiva', 'ortografica'].map((p) => (
              <Button key={p} size="sm" variant={projecao === p ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => mudarProjecao(p)}>
                {p === 'perspectiva' ? 'Perspectiva' : 'Ortográfica'}
              </Button>
            ))}
          </div>

          <div className="flex gap-1">
            <Select value={vista} onValueChange={mudarVista}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Escolher vista..." /></SelectTrigger>
              <SelectContent>
                {Object.entries(VISTAS).map(([chave, v]) => <SelectItem key={chave} value={chave} className="text-xs">{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="icon"
              variant={travado ? 'default' : 'outline'}
              className="h-7 w-7 shrink-0"
              title={travado ? 'Rotação travada' : 'Travar rotação'}
              onClick={() => { engine.travarRotacao(!travado); setTravado(!travado); }}
            >
              {travado ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {niveis.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-slate-500">Nível</p>
              <Select value={nivel} onValueChange={(v) => { setNivel(v); aplicarNivel(v); }}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos os níveis</SelectItem>
                  {niveis.map((n) => (
                    <SelectItem key={n.indice} value={String(n.indice)} className="text-xs">{n.nome} ({fmtCota(n.cota)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {nivelAtual && (
                <label className="flex items-center gap-2">
                  <Checkbox checked={cortar} onCheckedChange={(c) => { setCortar(!!c); aplicarNivel(nivel, !!c); }} />
                  <span>Cortar a</span>
                  <Input
                    type="number"
                    step="0.1"
                    value={alturaCorte}
                    className="h-6 w-16 px-1 text-xs"
                    disabled={!cortar}
                    onChange={(e) => { const v = Number(e.target.value); setAlturaCorte(v); if (cortar) engine.setCorte(v); }}
                  />
                  <span>m do piso</span>
                </label>
              )}
            </div>
          )}

          {niveis.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-slate-500">Explodir níveis {explosao ? `(${Math.round(explosao * 100)}%)` : ''}</p>
              <Slider
                value={[explosao]}
                min={0}
                max={1.5}
                step={0.05}
                disabled={!!nivelAtual}
                onValueChange={([v]) => { setExplosao(v); engine.setExplosao(v); }}
                onValueCommit={() => reenquadrar()}
              />
              {nivelAtual && <p className="text-slate-400">Volte para "Todos os níveis" para explodir.</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-slate-500">Estilo</p>
            <Select
              value={estilo}
              disabled={gerandoArestas != null}
              onValueChange={async (v) => {
                setEstilo(v);
                setGerandoArestas(0);
                await engine.setEstilo(v, setGerandoArestas);
                setGerandoArestas(null);
              }}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ESTILOS).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
              </SelectContent>
            </Select>
            {gerandoArestas != null && gerandoArestas < 100 && <p className="text-slate-500">Gerando arestas... {gerandoArestas}%</p>}
          </div>

          <div className="grid grid-cols-3 gap-1 border-t pt-3">
            <Button size="sm" className="h-7 text-xs px-1" onClick={() => onSalvarVista(nomeSugerido, nivelAtual?.nome || null)}>
              <Bookmark className="w-3.5 h-3.5 mr-1" /> Salvar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs px-1" onClick={() => onExportarAtual('png', nomeSugerido, nivelAtual?.nome || null)}>
              <ImageIcon className="w-3.5 h-3.5 mr-1" /> PNG
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs px-1" onClick={() => onExportarAtual('pdf', nomeSugerido, nivelAtual?.nome || null)}>
              <FileDown className="w-3.5 h-3.5 mr-1" /> PDF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
