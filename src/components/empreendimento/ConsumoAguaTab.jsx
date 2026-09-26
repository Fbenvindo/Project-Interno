import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConsumoAguaCalculo } from "@/entities/all";
import { Plus, Trash2, Save, Loader2, Droplets, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";

// Valores de referência de mercado para consumo per capita/unidade (L/dia),
// usados na ausência de dado específico do projeto (NBR 5626 / prática de
// projeto hidrossanitário predial). Devem ser ajustados conforme exigência
// da concessionária local e do memorial descritivo do empreendimento.
const ITENS_PADRAO = [
  { uso: "Residencial (apartamento)", unidade: "hab.", consumo_per_capita: 150, quantidade: 0 },
  { uso: "Escritório", unidade: "pessoa", consumo_per_capita: 50, quantidade: 0 },
  { uso: "Hotel (sem lavanderia/cozinha)", unidade: "hóspede", consumo_per_capita: 250, quantidade: 0 },
  { uso: "Restaurante/Refeitório", unidade: "refeição", consumo_per_capita: 25, quantidade: 0 },
  { uso: "Garagem/Estacionamento", unidade: "veículo", consumo_per_capita: 50, quantidade: 0 },
  { uso: "Área de lazer/Piscina (reposição)", unidade: "m²", consumo_per_capita: 5, quantidade: 0 },
  { uso: "Irrigação de jardins", unidade: "m²", consumo_per_capita: 2, quantidade: 0 },
];

function uid() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeItens(rawItens) {
  const base = Array.isArray(rawItens) && rawItens.length > 0
    ? rawItens
    : ITENS_PADRAO;
  return base.map((it) => ({
    id: it.id || uid(),
    uso: it.uso || "",
    unidade: it.unidade || "un.",
    quantidade: toNumber(it.quantidade),
    consumo_per_capita: toNumber(it.consumo_per_capita),
  }));
}

function formatNumber(n, digits = 0) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function ConsumoAguaTab({ empreendimentoId, readOnly = false }) {
  const [calculo, setCalculo] = useState(null);
  const [itens, setItens] = useState([]);
  const [diasAutonomia, setDiasAutonomia] = useState(1);
  const [reservaIncendio, setReservaIncendio] = useState(0);
  const [percentualInferior, setPercentualInferior] = useState(40);
  const [observacoes, setObservacoes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const hydrateFromCalculo = useCallback((c) => {
    setCalculo(c);
    setItens(normalizeItens(c?.itens));
    setDiasAutonomia(toNumber(c?.dias_autonomia) || 1);
    setReservaIncendio(toNumber(c?.reserva_incendio_litros));
    setPercentualInferior(c?.percentual_reservatorio_inferior != null ? toNumber(c.percentual_reservatorio_inferior) : 40);
    setObservacoes(c?.observacoes || '');
    setDirty(false);
  }, []);

  const fetchCalculo = useCallback(async () => {
    if (!empreendimentoId) return;
    setIsLoading(true);
    try {
      const rows = await ConsumoAguaCalculo.filter({ empreendimento_id: empreendimentoId });
      if (rows && rows.length > 0) {
        hydrateFromCalculo(rows[0]);
      } else {
        hydrateFromCalculo(null);
      }
    } catch (error) {
      console.error("Erro ao buscar cálculo de consumo de água:", error);
      hydrateFromCalculo(null);
    } finally {
      setIsLoading(false);
    }
  }, [empreendimentoId, hydrateFromCalculo]);

  useEffect(() => {
    if (empreendimentoId) fetchCalculo();
  }, [empreendimentoId, fetchCalculo]);

  const totals = useMemo(() => {
    const totalDiarioLitros = itens.reduce((sum, it) => sum + (it.quantidade * it.consumo_per_capita), 0);
    const volumeReservatorioLitros = totalDiarioLitros * (diasAutonomia || 0) + toNumber(reservaIncendio);
    const volumeInferior = volumeReservatorioLitros * (percentualInferior / 100);
    const volumeSuperior = volumeReservatorioLitros - volumeInferior;
    return { totalDiarioLitros, volumeReservatorioLitros, volumeInferior, volumeSuperior };
  }, [itens, diasAutonomia, reservaIncendio, percentualInferior]);

  const updateItem = (id, field, value) => {
    setItens(prev => prev.map(it => it.id === id ? { ...it, [field]: field === 'quantidade' || field === 'consumo_per_capita' ? toNumber(value) : value } : it));
    setDirty(true);
  };

  const addItem = () => {
    setItens(prev => [...prev, { id: uid(), uso: '', unidade: 'un.', quantidade: 0, consumo_per_capita: 0 }]);
    setDirty(true);
  };

  const removeItem = (id) => {
    setItens(prev => prev.filter(it => it.id !== id));
    setDirty(true);
  };

  const moveItem = (id, direction) => {
    setItens(prev => {
      const index = prev.findIndex(it => it.id === id);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!empreendimentoId) return;
    setIsSaving(true);
    try {
      const payload = {
        empreendimento_id: empreendimentoId,
        nome: 'Cálculo de Consumo de Água',
        itens,
        dias_autonomia: diasAutonomia,
        reserva_incendio_litros: reservaIncendio,
        percentual_reservatorio_inferior: percentualInferior,
        observacoes,
      };
      let saved;
      if (calculo?.id) {
        saved = await ConsumoAguaCalculo.update(calculo.id, payload);
      } else {
        saved = await ConsumoAguaCalculo.create(payload);
      }
      hydrateFromCalculo(saved);
    } catch (error) {
      console.error("Erro ao salvar cálculo de consumo de água:", error);
      alert("Erro ao salvar cálculo. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600">Carregando cálculo de consumo de água...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-blue-500" />
            Cálculo de Consumo de Água
          </CardTitle>
          {!readOnly && (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {dirty ? 'Salvar alterações' : 'Salvar'}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-500">
            Estimativa de demanda diária de água por tipo de uso (base NBR 5626 / prática de projeto).
            Os valores de consumo per capita são de referência e devem ser conferidos com o memorial
            descritivo e a concessionária local antes da emissão do projeto.
          </p>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Uso / Ambiente</TableHead>
                  <TableHead className="w-24">Unidade</TableHead>
                  <TableHead className="w-32">Quantidade</TableHead>
                  <TableHead className="w-40">Consumo per capita (L/dia)</TableHead>
                  <TableHead className="w-36 text-right">Subtotal (L/dia)</TableHead>
                  {!readOnly && <TableHead className="w-36" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((it, index) => (
                  <TableRow key={it.id}>
                    <TableCell>
                      <Input
                        value={it.uso}
                        disabled={readOnly}
                        onChange={(e) => updateItem(it.id, 'uso', e.target.value)}
                        placeholder="Ex: Residencial (apartamento)"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={it.unidade}
                        disabled={readOnly}
                        onChange={(e) => updateItem(it.id, 'unidade', e.target.value)}
                        placeholder="hab., pessoa..."
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={it.quantidade}
                        disabled={readOnly}
                        onChange={(e) => updateItem(it.id, 'quantidade', e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        value={it.consumo_per_capita}
                        disabled={readOnly}
                        onChange={(e) => updateItem(it.id, 'consumo_per_capita', e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatNumber(it.quantidade * it.consumo_per_capita)}
                    </TableCell>
                    {!readOnly && (
                      <TableCell>
                        <div className="flex items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={index === 0}
                            onClick={() => moveItem(it.id, -1)}
                          >
                            <ChevronUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={index === itens.length - 1}
                            onClick={() => moveItem(it.id, 1)}
                          >
                            <ChevronDown className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => removeItem(it.id)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {!readOnly && (
            <Button variant="outline" onClick={addItem}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar linha
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dimensionamento do Reservatório</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="dias_autonomia">Dias de autonomia da reserva</Label>
            <Input
              id="dias_autonomia"
              type="number"
              min="0"
              step="0.5"
              disabled={readOnly}
              value={diasAutonomia}
              onChange={(e) => { setDiasAutonomia(toNumber(e.target.value)); setDirty(true); }}
            />
          </div>
          <div>
            <Label htmlFor="reserva_incendio">Reserva técnica de incêndio (L)</Label>
            <Input
              id="reserva_incendio"
              type="number"
              min="0"
              disabled={readOnly}
              value={reservaIncendio}
              onChange={(e) => { setReservaIncendio(toNumber(e.target.value)); setDirty(true); }}
            />
          </div>
          <div>
            <Label htmlFor="percentual_inferior">% no reservatório inferior</Label>
            <Input
              id="percentual_inferior"
              type="number"
              min="0"
              max="100"
              disabled={readOnly}
              value={percentualInferior}
              onChange={(e) => { setPercentualInferior(toNumber(e.target.value)); setDirty(true); }}
            />
          </div>

          <div className="md:col-span-3">
            <Label htmlFor="observacoes">Observações</Label>
            <Textarea
              id="observacoes"
              disabled={readOnly}
              value={observacoes}
              onChange={(e) => { setObservacoes(e.target.value); setDirty(true); }}
              placeholder="Premissas, exigências da concessionária, fonte alternativa de abastecimento, etc."
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-base">Resumo</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">Consumo diário total</p>
            <p className="text-lg font-semibold">{formatNumber(totals.totalDiarioLitros)} L/dia</p>
            <p className="text-xs text-gray-500">{formatNumber(totals.totalDiarioLitros / 1000, 2)} m³/dia</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Volume total de reserva</p>
            <p className="text-lg font-semibold">{formatNumber(totals.volumeReservatorioLitros)} L</p>
            <p className="text-xs text-gray-500">{formatNumber(totals.volumeReservatorioLitros / 1000, 2)} m³</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Reservatório inferior ({formatNumber(percentualInferior)}%)</p>
            <p className="text-lg font-semibold">{formatNumber(totals.volumeInferior)} L</p>
            <p className="text-xs text-gray-500">{formatNumber(totals.volumeInferior / 1000, 2)} m³</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Reservatório superior ({formatNumber(100 - percentualInferior)}%)</p>
            <p className="text-lg font-semibold">{formatNumber(totals.volumeSuperior)} L</p>
            <p className="text-xs text-gray-500">{formatNumber(totals.volumeSuperior / 1000, 2)} m³</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
