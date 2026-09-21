// @ts-nocheck
import { useState, useEffect, useCallback, useMemo, useContext } from "react";
import { useLocation } from "react-router-dom";
import {
  Empreendimento,
  Documento,
  Disciplina,
  Atividade,
  PlanejamentoAtividade,
  Usuario,
  Pavimento,
  Execucao
} from "@/entities/all";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertCircle } from "lucide-react";
import { retryWithBackoff, retryWithExtendedBackoff } from "../components/utils/apiUtils";

import EmpreendimentoHeader from "../components/empreendimento/EmpreendimentoHeader";
import DocumentosTab from "../components/empreendimento/DocumentosTab";
import PavimentosTab from "../components/empreendimento/PavimentosTab";
import AnaliticoGlobalTab from "../components/empreendimento/AnaliticoGlobalTab";
import GestaoTab from "../components/empreendimento/GestaoTab";
import PRETab from "../components/empreendimento/PRETab";
import CadastroTab from "../components/empreendimento/CadastroTab";
import ControleOSTab from "../components/empreendimento/ControleOSTab";
import ConsumoAguaTab from "../components/empreendimento/ConsumoAguaTab";
import ChecklistCadastroTab from "@/pages/ChecklistCadastro";
import { ActivityTimerContext } from "@/components/contexts/ActivityTimerContext";

export default function EmpreendimentoPage() {
  const location = useLocation();
  const [empreendimento, setEmpreendimento] = useState(null);
  const [isLoadingEmpreendimento, setIsLoadingEmpreendimento] = useState(true);
  const [error, setError] = useState(null);

  const [tabData, setTabData] = useState({
    documentos: { data: [], loaded: false, loading: false },
    pavimentos: { data: [], loaded: false, loading: false },
    atividades_projeto: { data: [], loaded: false, loading: false },
    gestao: { data: [], loaded: false, loading: false },
    controle_os: { data: [], loaded: false, loading: false },
    checklists: { data: [], loaded: false, loading: false },
    consumo_agua: { data: [], loaded: false, loading: false }
  });

  const [sharedData, setSharedData] = useState({
    disciplinas: [],
    usuarios: [],
    atividades: [],
    execucoes: [],
    loaded: false,
    loading: false
  });

  const [activeTab, setActiveTab] = useState('documentos');
  const [mountedTabs, setMountedTabs] = useState(new Set(['documentos']));
  // Persistência da etapa selecionada no localStorage
  const EMP_KEY = `etapaPlanejamento_${empreendimento?.id || ''}`;
  const [etapaParaPlanejamento, setEtapaParaPlanejamentoState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(EMP_KEY);
      return saved || 'todas';
    }
    return 'todas';
  });

  // Wrapper para salvar no localStorage
  const setEtapaParaPlanejamento = (val) => {
    setEtapaParaPlanejamentoState(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem(EMP_KEY, val);
    }
  };

  const etapasConfiguradas = useMemo(() => {
    const etapas = (empreendimento?.etapas || [])
      .map(etapa => String(etapa || '').trim())
      .filter(Boolean);
    return [...new Set(etapas)];
  }, [empreendimento?.etapas]);

  useEffect(() => {
    if (etapasConfiguradas.length === 0) {
      if (etapaParaPlanejamento !== 'todas') {
        setEtapaParaPlanejamento('todas');
      }
      return;
    }
    if (etapasConfiguradas.length === 1 && etapaParaPlanejamento === 'todas') {
      setEtapaParaPlanejamento(etapasConfiguradas[0]);
    }
  }, [etapasConfiguradas, /* não depende mais de setEtapaParaPlanejamento */]);

  const empreendimentoQueryId = useMemo(() =>
    new URLSearchParams(location.search).get("id"), [location.search]
  );

  const empreendimentoFilterId = empreendimento?.id || null;

  const { user, hasPermission, perfilAtual } = useContext(ActivityTimerContext);
  const hasAccessToGestao = hasPermission('gestao');
  const hasChecklistAccess = hasPermission('coordenador');
  const canEdit = hasPermission('coordenador');

  const visibleTabsForUser = useMemo(() => {
    if (canEdit) {
      return ['documentos', 'cadastro', 'pavimentos', 'atividades_projeto', 'pre', 'controle_os', 'consumo_agua', 'gestao'];
    }
    // Padrão/Apoio: visualização de Documentos, Cadastro, Pavimentos e PRE
    return ['documentos', 'cadastro', 'pavimentos', 'pre'];
  }, [canEdit]);

  const loadEmpreendimento = useCallback(async () => {
    if (!empreendimentoQueryId) return;

    setIsLoadingEmpreendimento(true);
    setError(null);

    try {
      const lookup = String(empreendimentoQueryId).trim();
      const emp = await retryWithBackoff(
        () => Empreendimento.filter({ id: lookup }),
        3, 1000, 'loadEmpreendimento'
      );

      if (!emp || emp.length === 0) {
        setError("Empreendimento não encontrado");
        return;
      }

      let selected = emp.find(e => String(e.id) === lookup);
      if (!selected) {
        selected = emp.find(e => String(e.nome || '').startsWith(`${lookup} -`));
      }

      setEmpreendimento(selected || emp[0]);

    } catch (err) {
      console.error("Erro ao carregar empreendimento:", err);
      setError("Erro ao carregar empreendimento");
    } finally {
      setIsLoadingEmpreendimento(false);
    }
  }, [empreendimentoQueryId]);

  const loadSharedData = useCallback(async () => {
    if (!empreendimentoFilterId) return;

    setSharedData(prev => {
      if (prev.loading || prev.loaded) return prev;
      return { ...prev, loading: true };
    });

    try {
      const { base44: b44 } = await import('@/api/base44Client');

      const [
        disciplinasData,
        usuariosData,
        atividadesGenericasData,
        atividadesEmpData,
        atividadesProjetoData,
        execucoesData,
      ] = await Promise.all([
        retryWithBackoff(() => Disciplina.list(), 3, 1000, 'loadDisciplinas'),
        retryWithBackoff(() => Usuario.list(), 3, 1000, 'loadUsuarios'),
        retryWithBackoff(() => Atividade.list(null, 500), 3, 1000, 'loadAtividadesGenericas'),
        retryWithBackoff(() => b44.entities.AtividadesEmpreendimento.filter({ empreendimento_id: empreendimentoFilterId }), 3, 1000, 'loadAtividadesEmp').catch(() => []),
        retryWithBackoff(() => Atividade.filter({ empreendimento_id: empreendimentoFilterId }), 3, 1000, 'loadAtividadesProjeto').catch(() => []),
        retryWithExtendedBackoff(() => Execucao.filter({ empreendimento_id: empreendimentoFilterId }), 'loadExecucoes'),
      ]);

      setSharedData({
        disciplinas: disciplinasData || [],
        usuarios: usuariosData || [],
        atividades: [
          ...(atividadesGenericasData || []),
          ...(atividadesEmpData || []),
          ...(atividadesProjetoData || []),
        ],
        execucoes: execucoesData || [],
        loaded: true,
        loading: false,
      });

    } catch (err) {
      console.error("Erro ao carregar dados compartilhados:", err);
      setSharedData(prev => ({ ...prev, loading: false }));
    }
  }, [empreendimentoFilterId]);

  const loadTabData = useCallback(async (tabName) => {
    if (!empreendimentoFilterId || tabData[tabName]?.loading || tabData[tabName]?.loaded) return;

    setTabData(prev => ({
      ...prev,
      [tabName]: { ...prev[tabName], loading: true }
    }));

    try {
      let data = [];

    switch (tabName) {
      case 'documentos':
          const [documentosData, planejamentosAtividadeData, planejamentosDocumentoData] = await Promise.all([
            retryWithExtendedBackoff(() => Documento.filter({ empreendimento_id: empreendimentoFilterId }), 'loadDocumentos'),
            retryWithExtendedBackoff(() => PlanejamentoAtividade.filter({ empreendimento_id: empreendimentoFilterId }), 'loadPlanejamentosAtividade'),
            (async () => {
              try {
                const { PlanejamentoDocumento } = await import('@/entities/all');
                return await retryWithExtendedBackoff(() => PlanejamentoDocumento.filter({ empreendimento_id: empreendimentoFilterId }), 'loadPlanejamentosDocumento');
              } catch {
                return [];
              }
            })()
          ]);

          data = {
            documentos: documentosData || [],
            planejamentos: [...(planejamentosAtividadeData || []), ...(planejamentosDocumentoData || [])].map(p => ({
              ...p,
              tipo_plano: p.documento_id && !p.atividade_id ? 'documento' : 'atividade'
            })),
          };
        break;

      case 'pavimentos':
          data = await retryWithExtendedBackoff(() => Pavimento.filter({ empreendimento_id: empreendimentoFilterId }), 'loadPavimentos');
        break;

      case 'atividades_projeto':
          data = await retryWithExtendedBackoff(() => Atividade.filter({ empreendimento_id: empreendimentoFilterId }), 'loadAtividadesProjeto');
        break;

      case 'gestao':
        data = {};
        break;

      case 'pre':
      case 'checklists':
        data = {};
        break;

      case 'controle_os':
        data = {};
          break;

      case 'consumo_agua':
        data = {};
        break;

        default:
          break;
      }

      setTabData(prev => ({
        ...prev,
        [tabName]: { data, loaded: true, loading: false }
      }));

    } catch (err) {
      console.error(`Erro ao carregar ${tabName}:`, err);

      let errorMessage = `Erro ao carregar dados. `;
      if (err.message?.includes('Network Error')) {
        errorMessage += 'Verifique sua conexão.';
      } else if (err.message?.includes('429')) {
        errorMessage += 'Aguarde 30 segundos.';
      } else {
        errorMessage += 'Tente recarregar.';
      }

      alert(errorMessage);

      setTabData(prev => ({
        ...prev,
        [tabName]: { ...prev[tabName], loading: false }
      }));
    }
  }, [empreendimentoFilterId]);

  const handleTabChange = useCallback((newTab) => {
    setActiveTab(newTab);
    setMountedTabs(prev => { prev.add(newTab); return new Set(prev); });

    if (!sharedData.loaded && !sharedData.loading) loadSharedData();

    const needsLoad = newTab !== 'gestao' && !tabData[newTab]?.loaded && !tabData[newTab]?.loading;
    if (needsLoad) loadTabData(newTab);

    if (newTab === 'atividades_projeto' || newTab === 'documentos' || newTab === 'gestao') {
      if (!tabData.documentos?.loaded && !tabData.documentos?.loading) loadTabData('documentos');
      if (!tabData.pavimentos?.loaded && !tabData.pavimentos?.loading) loadTabData('pavimentos');
    }

    if (newTab === 'gestao' && !tabData.gestao?.loaded) {
      setTabData(prev => ({ ...prev, gestao: { ...prev.gestao, loaded: true } }));
    }
  }, [loadSharedData, loadTabData, sharedData, tabData]);

  const forceFullReload = useCallback(() => {
    setTabData({
      documentos: { data: [], loaded: false, loading: false },
      pavimentos: { data: [], loaded: false, loading: false },
      atividades_projeto: { data: [], loaded: false, loading: false },
      gestao: { data: [], loaded: false, loading: false },
      controle_os: { data: [], loaded: false, loading: false },
      checklists: { data: [], loaded: false, loading: false },
      consumo_agua: { data: [], loaded: false, loading: false }
    });
    // mark shared data stale and trigger an immediate reload to avoid
    // race conditions where state updates are not visible to subsequent checks
    setSharedData(prev => ({ ...prev, loaded: false }));
    // call loaders directly to ensure fresh data is fetched
    loadSharedData();
    loadEmpreendimento();
    handleTabChange(activeTab || 'documentos');
  }, [activeTab, loadEmpreendimento, handleTabChange]);

  useEffect(() => {
    loadEmpreendimento();
  }, [loadEmpreendimento]);

  useEffect(() => {
    if (empreendimento) {
      handleTabChange(activeTab);
      // Pré-carregar sharedData em paralelo sem bloquear a aba principal
      loadSharedData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreendimento?.id]);

  if (isLoadingEmpreendimento) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="p-6 md:p-8 space-y-6">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center p-8 bg-white rounded-lg shadow-lg">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Erro ao Carregar</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Tentar Novamente
          </Button>
        </div>
      </div>
    );
  }

  const isGestaoLoading = sharedData.loading || tabData.documentos.loading || tabData.pavimentos.loading;
  const isGestaoLoaded = sharedData.loaded && tabData.documentos.loaded && tabData.pavimentos.loaded;
  const tabsGridClass = canEdit
    ? (hasAccessToGestao ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-9' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-8')
    : 'grid-cols-4';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="p-6 md:p-8 space-y-6">
        <EmpreendimentoHeader empreendimento={empreendimento} />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className={`grid w-full ${tabsGridClass} bg-white shadow-sm`}>
            {visibleTabsForUser.includes('documentos') && <TabsTrigger value="documentos">Documentos</TabsTrigger>}
            {hasChecklistAccess && <TabsTrigger value="checklists">Check-List</TabsTrigger>}
            {visibleTabsForUser.includes('cadastro') && <TabsTrigger value="cadastro">Cadastro</TabsTrigger>}
            {visibleTabsForUser.includes('pavimentos') && <TabsTrigger value="pavimentos">Pavimentos</TabsTrigger>}
            {visibleTabsForUser.includes('atividades_projeto') && <TabsTrigger value="atividades_projeto">Atividades do Projeto</TabsTrigger>}
            {visibleTabsForUser.includes('pre') && <TabsTrigger value="pre">PRE</TabsTrigger>}
            {visibleTabsForUser.includes('controle_os') && <TabsTrigger value="controle_os">Controle OS</TabsTrigger>}
            {visibleTabsForUser.includes('consumo_agua') && <TabsTrigger value="consumo_agua">Consumo de Água</TabsTrigger>}
            {hasAccessToGestao && visibleTabsForUser.includes('gestao') && (
              <TabsTrigger value="gestao">Gestão</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="documentos">
            {tabData.documentos.loading || tabData.pavimentos.loading ? (
              <div className="flex flex-col items-center justify-center h-96">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-600">Carregando documentos...</p>
              </div>
            ) : tabData.documentos.loaded && tabData.pavimentos.loaded ? (
              <DocumentosTab
                empreendimento={empreendimento}
                documentos={tabData.documentos.data.documentos || []}
                disciplinas={sharedData.disciplinas}
                atividades={sharedData.atividades || []}
                planejamentos={tabData.documentos.data.planejamentos || []}
                usuarios={sharedData.usuarios}
                pavimentos={tabData.pavimentos.data || []}
                onUpdate={forceFullReload}
                isLoading={false}
                etapaParaPlanejamento={etapaParaPlanejamento}
                onEtapaChange={setEtapaParaPlanejamento}
                readOnly={!canEdit}
              />
            ) : (
              <div className="flex justify-center items-center h-64">
                <Button onClick={() => handleTabChange('documentos')}>
                  Carregar Documentos
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="pavimentos">
            {tabData.pavimentos.loading ? (
              <div className="flex flex-col items-center justify-center h-96">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-600">Carregando pavimentos...</p>
              </div>
            ) : tabData.pavimentos.loaded ? (
              <PavimentosTab
                empreendimentoId={empreendimento?.id}
                pavimentosIniciais={tabData.pavimentos.data}
                onUpdate={() => {
                  setTabData(prev => ({ ...prev, pavimentos: { ...prev.pavimentos, loaded: false } }));
                  loadTabData('pavimentos');
                }}
                isLoading={false}
                readOnly={!canEdit}
              />
            ) : null}
          </TabsContent>

          <TabsContent value="atividades_projeto">
            {tabData.atividades_projeto.loading || sharedData.loading || tabData.documentos.loading || tabData.pavimentos.loading ? (
              <div className="flex flex-col items-center justify-center h-96">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-600">Carregando atividades...</p>
              </div>
            ) : tabData.atividades_projeto.loaded && sharedData.loaded && tabData.documentos.loaded && tabData.pavimentos.loaded ? (
              <AnaliticoGlobalTab
                empreendimentoId={empreendimento?.id}
                onUpdate={forceFullReload}
                etapaParaPlanejamento={etapaParaPlanejamento}
                disciplinasProp={sharedData.disciplinas}
                usuariosProp={sharedData.usuarios}
                documentosProp={tabData.documentos.data?.documentos || []}
                pavimentosProp={tabData.pavimentos.data || []}
                allAtividadesProp={sharedData.atividades || []}
                activeTab={activeTab}
              />
            ) : null}
          </TabsContent>
            
          <TabsContent value="cadastro">
            {mountedTabs.has('cadastro') && <CadastroTab empreendimento={empreendimento} readOnly={!canEdit} />}
          </TabsContent>
          {hasChecklistAccess && (
            <TabsContent value="checklists">
              {mountedTabs.has('checklists') && <ChecklistCadastroTab empreendimento={empreendimento} />}
            </TabsContent>
          )}
          <TabsContent value="pre">
            {mountedTabs.has('pre') && (
              <PRETab
                empreendimento={empreendimento}
                readOnly={!canEdit}
                onAfterSave={() => {
                  setTabData(prev => ({
                    ...prev,
                    documentos: { ...prev.documentos, loaded: false }
                  }));
                  loadTabData('documentos');
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="controle_os">
            {mountedTabs.has('controle_os') && (sharedData.loading ? (
              <div className="flex flex-col items-center justify-center h-96">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                <p className="text-gray-600">Carregando...</p>
              </div>
            ) : sharedData.loaded ? (
              <ControleOSTab
                empreendimento={empreendimento}
                atividades={sharedData.atividades || []}
              />
            ) : null)}
          </TabsContent>

          <TabsContent value="consumo_agua">
            {mountedTabs.has('consumo_agua') && (
              <ConsumoAguaTab
                empreendimentoId={empreendimento?.id}
                readOnly={!canEdit}
              />
            )}
          </TabsContent>

          {hasAccessToGestao && (
            <TabsContent value="gestao">
              {mountedTabs.has('gestao') && (isGestaoLoading ? (
                <div className="flex flex-col items-center justify-center h-96">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-4" />
                  <p className="text-gray-600">Carregando gestão...</p>
                </div>
              ) : isGestaoLoaded ? (
                <GestaoTab
                  empreendimento={empreendimento}
                  documentos={tabData.documentos.data.documentos || []}
                  planejamentos={[
                    ...(tabData.documentos.data.planejamentos || [])
                  ]}
                  atividades={sharedData.atividades || []}
                  usuarios={sharedData.usuarios}
                  execucoes={sharedData.execucoes || []}
                  pavimentos={tabData.pavimentos.data || []}
                  onUpdate={forceFullReload}
                />
              ) : null)}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
