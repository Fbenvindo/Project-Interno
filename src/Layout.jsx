import React, { useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Building2, Settings, Home, Users, Zap, Calendar, BarChart3, Briefcase, FileText, Calculator, LogOut, Box } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ActivityTimerProvider, ActivityTimerContext } from "@/components/contexts/ActivityTimerContext";
import GlobalTimer from "@/components/layout/GlobalTimer";
import PlaylistTrigger from "@/components/playlist/PlaylistTrigger";
import NotificacoesOcasionais from "@/components/dashboard/NotificacoesOcasionais";
import NotificationGenerator from "@/components/utils/NotificationGenerator";
import NetworkStatusBadge from "@/components/layout/NetworkStatusBadge";
import OfflineDataBanner from "@/components/layout/OfflineDataBanner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

const LOGO_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/577f93874_logo_Interativa_versao_final_sem_fundo_0002.png";

const LayoutComponent = ({ children, currentPageName }) => {
  const location = useLocation();
  const { logout } = useAuth();
  const { user, isLoading, userProfile, hasPermission, isAdmin, perfilAtual, allPlanejamentos, isLoadingPlanejamentos, atividadesGenericas, allEmpreendimentos, allUsers } = useContext(ActivityTimerContext);

  const getNavigationItems = (hasPermission, perfilAtual, isAdmin) => {
    // Em dev, forçar mostrar todas as abas quando configurado em localStorage
    // Defina `localStorage.setItem('dev_show_all_nav', '1')` no console para habilitar
    const showAll = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('dev_show_all_nav') === '1') || (!user && !userProfile);
    const items = [
      {
        title: "Início",
        url: createPageUrl("Dashboard"),
        icon: Home,
        show: true
      }
    ];

    // Empreendimentos: todos os usuários podem acessar
    items.push({
      title: "Empreendimentos",
      url: createPageUrl("Empreendimentos"),
      icon: Building2,
      show: true
    });

    if (hasPermission('gestao') || showAll) {
      items.push({
        title: "Comercial",
        url: createPageUrl("Comercial"),
        icon: Briefcase,
        show: true
      });
    }

    if (hasPermission('coordenador') || showAll) {
      items.push({
        title: "Planejamento",
        url: createPageUrl("SeletorPlanejamento"),
        icon: Calendar,
        show: true
      });
      items.push({
        title: "Controle OS",
        url: createPageUrl("ControleOSGlobal"),
        icon: Briefcase,
        show: true
      });
    }

    // Relatórios: coordenador+
    if (hasPermission('coordenador') || showAll) {
      items.push({
        title: "Relatórios",
        url: createPageUrl("Relatorios"),
        icon: BarChart3,
        show: true
      });
    }

    // ATA de Reunião: coordenador+
    if (hasPermission('coordenador') || showAll) {
      items.push({
        title: "ATA de Reunião",
        url: createPageUrl("AtaPlanejamento"),
        icon: FileText,
        show: true
      });
    }

    // Atividades Rápidas: todos os usuários
    items.push({
      title: "Atividades Rápidas",
      url: createPageUrl("AtividadesRapidas"),
      icon: Zap,
      show: true
    });

    // Visualizador IFC: todos os usuários
    items.push({
      title: "Visualizador IFC",
      url: createPageUrl("VisualizadorIFC"),
      icon: Box,
      show: true
    });

    // Usuários: gestão+
    if (hasPermission('gestao') || showAll) {
      items.push({
        title: "Usuários",
        url: createPageUrl("Usuarios"),
        icon: Users,
        show: true
      });
    }

    // Configurações: apenas para Admin, sem exceção para showAll
    if (isAdmin) {
      items.push({
        title: "Configurações",
        url: createPageUrl("Configuracoes"),
        icon: Settings,
        show: true
      });
    }

    return items.filter(item => item.show);
  };

  const navigationItems = isLoading ? [] : getNavigationItems(hasPermission, perfilAtual, isAdmin);

  const getPerfilLabel = (perfilAtual, isAdmin) => {
    if (isAdmin) return 'Administrador';

    const labels = {
      'direcao': 'Direção',
      'gestao': 'Gestão',
      'lider': 'Líder',
      'coordenador': 'Coordenador',
      'apoio': 'Apoio',
      'consultor': 'Consultor',
      'user': 'Colaborador'
    };

    return labels[perfilAtual] || 'Colaborador';
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gray-50">
        <Sidebar className="border-r border-gray-200 bg-white">
          <SidebarHeader className="border-b border-gray-100 p-6">
            <div className="flex flex-col items-center justify-center gap-2">
              <img src={LOGO_URL} alt="Project Control Logo" className="h-20 w-auto" />
              <strong className="text-gray-800 text-sm">Gestão de Projetos</strong>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-4">
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2">
                Navegação Principal
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {navigationItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        className={`hover:bg-blue-50 hover:text-blue-700 transition-all duration-200 rounded-lg ${location.pathname === item.url ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600'
                          }`}
                      >
                        <Link to={item.url} className="flex items-center gap-3 px-3 py-3">
                          <item.icon className="w-5 h-5" />
                          <span className="font-medium">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-gray-100 p-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                  <Users className="w-4 h-4 text-gray-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {userProfile?.nome || user?.full_name || user?.email || 'Usuário'}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {getPerfilLabel(perfilAtual, isAdmin)}
                  </p>
                </div>
              </div>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => logout(true)}>
                <LogOut className="w-4 h-4" />
                Sair
              </Button>
            </div>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="bg-white border-b border-gray-200 px-6 py-4 md:hidden">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="hover:bg-gray-100 p-2 rounded-lg transition-colors" />
              <h1 className="text-xl font-semibold text-gray-900">Project Control</h1>
            </div>
          </header>

          <div className="flex-1 overflow-auto overflow-x-hidden">
            <OfflineDataBanner />
            {children}
          </div>
        </main>

        <GlobalTimer />
        <PlaylistTrigger
          allPlanejamentos={allPlanejamentos}
          isLoading={isLoadingPlanejamentos}
          atividadesGenericas={atividadesGenericas}
          empreendimentos={allEmpreendimentos}
          usuarios={allUsers}
        />
        <NotificacoesOcasionais />
        <NotificationGenerator />
        <NetworkStatusBadge />
      </div>
    </SidebarProvider>
  );
}

export default function Layout({ children, currentPageName }) {
  return (
    <ActivityTimerProvider>
      <LayoutComponent currentPageName={currentPageName}>
        {children}
      </LayoutComponent>
    </ActivityTimerProvider>
  );
}
