import { useState } from 'react';
import { AlertTriangle, Download, Loader2, Wind } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PARAMETROS_PADRAO, baixarCasoOpenFOAM } from '@/components/ifc/openfoamExport';

const fmt = (v, casas = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

const CAMPOS = [
  ['tExterna', 'Temperatura externa (°C)'],
  ['tInsuflamento', 'Temperatura de insuflamento (°C)'],
  ['tInicial', 'Temperatura inicial do ar (°C)'],
  ['tSolo', 'Temperatura do solo (°C)'],
  ['trocasHora', 'Renovações de ar por hora'],
];

const CAMPOS_U = [
  ['uParede', 'Parede externa'],
  ['uJanela', 'Janela / vidro'],
  ['uCobertura', 'Cobertura'],
  ['uPorta', 'Porta externa'],
  ['uPiso', 'Piso sobre solo'],
];

const DESCRICAO_CONDICAO = (p) => {
  if (p.tipo === 'entrada') return 'Insuflamento';
  if (p.tipo === 'saida') return 'Saída de ar';
  if (p.termico.modo === 'externo') return `Externa, U ${fmt(p.termico.valor)} (${p.termico.origem})`;
  return 'Adiabática';
};

export default function CfdDialog({ ambiente, engine, onClose }) {
  const [params, setParams] = useState({ ...PARAMETROS_PADRAO });
  const [gerando, setGerando] = useState(false);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState(null);

  const set = (chave, valor) => setParams((p) => ({ ...p, [chave]: valor === '' ? '' : Number(valor) }));
  const celulasEstimadas = ambiente.volume_m3 && params.tamanhoCelula ? Math.round(ambiente.volume_m3 / params.tamanhoCelula ** 3) : null;

  const gerar = async () => {
    setErro(null);
    setGerando(true);
    try {
      const valores = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === '' ? PARAMETROS_PADRAO[k] : v]));
      setResumo(await baixarCasoOpenFOAM(engine, ambiente.id, valores));
    } catch (err) {
      console.error('Erro ao gerar caso OpenFOAM:', err);
      setErro(err.message || 'Falha ao gerar o caso.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !gerando) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wind className="w-5 h-5 text-blue-600" /> Caso OpenFOAM — {ambiente.rotulo}
          </DialogTitle>
          <p className="text-xs text-slate-500">
            Escoamento de ar e temperatura no ambiente, em regime permanente com empuxo (buoyantSimpleFoam, k-ε).
            Gera um .zip com geometria, malha (snappyHexMesh), condições de contorno e o script Allrun.
          </p>
        </DialogHeader>

        {!resumo && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tamanho das células</Label>
                <Select value={String(params.tamanhoCelula)} onValueChange={(v) => set('tamanhoCelula', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[0.1, 0.15, 0.2, 0.25].map((v) => (
                      <SelectItem key={v} value={String(v)}>{fmt(v)} m{v === 0.15 ? ' (padrão)' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {celulasEstimadas && (
                  <p className="text-xs text-slate-500">≈ {celulasEstimadas.toLocaleString('pt-BR')} células antes do refino junto às paredes</p>
                )}
              </div>
              {CAMPOS.map(([chave, rotulo]) => (
                <div key={chave} className="space-y-1">
                  <Label>{rotulo}</Label>
                  <Input type="number" step="0.5" value={params[chave]} onChange={(e) => set(chave, e.target.value)} />
                </div>
              ))}
            </div>
            <div>
              <p className="font-medium text-slate-700 mb-1">Transmitância padrão (W/m²K)</p>
              <p className="text-xs text-slate-500 mb-2">Usadas só quando o IFC não informa o U do elemento.</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {CAMPOS_U.map(([chave, rotulo]) => (
                  <div key={chave} className="space-y-1">
                    <Label className="text-xs">{rotulo}</Label>
                    <Input type="number" step="0.1" value={params[chave]} onChange={(e) => set(chave, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {resumo && (
          <div className="space-y-3 text-sm">
            <p className="text-emerald-700">Caso gerado e baixado. Descompacte e rode <code className="bg-slate-100 px-1 rounded">./Allrun</code> num terminal com uma versão recente do OpenFOAM da linha openfoam.com (testado no v2412). Veja o README.md do caso.</p>
            <p className="text-slate-600">
              Volume {fmt(resumo.volume_m3)} m³ · ≈ {resumo.celulas_estimadas.toLocaleString('pt-BR')} células
              {resumo.vazao_insuflamento_m3s > 0 && <> · insuflamento {fmt(resumo.vazao_insuflamento_m3s * 3600, 0)} m³/h</>}
            </p>
            {resumo.avisos.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                {resumo.avisos.map((a) => <p key={a} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {a}</p>)}
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-1 pr-3 font-medium">Patch</th>
                  <th className="py-1 pr-3 font-medium text-right">Área (m²)</th>
                  <th className="py-1 font-medium">Condição</th>
                </tr>
              </thead>
              <tbody>
                {resumo.patches.map((p) => (
                  <tr key={p.nome} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-mono">{p.nome}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{p.area_m2 ? fmt(p.area_m2) : '—'}</td>
                    <td className="py-1">{DESCRICAO_CONDICAO(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {erro && <p className="text-sm text-red-600">{erro}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={gerando}>Fechar</Button>
          {!resumo && (
            <Button onClick={gerar} disabled={gerando}>
              {gerando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Gerar e baixar caso (.zip)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
