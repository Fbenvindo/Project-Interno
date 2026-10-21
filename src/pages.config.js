/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import { lazy } from 'react';
import __Layout from './Layout.jsx';

const AnaliseConcepcaoPlanejamento = lazy(() => import('./pages/AnaliseConcepcaoPlanejamento'));
const Analitico = lazy(() => import('./pages/Analitico'));
const AtaPlanejamento = lazy(() => import('./pages/AtaPlanejamento'));
const AtividadesRapidas = lazy(() => import('./pages/AtividadesRapidas'));
const ChecklistCadastro = lazy(() => import('./pages/ChecklistCadastro'));
const Comercial = lazy(() => import('./pages/Comercial'));
const ComercialDetalhes = lazy(() => import('./pages/ComercialDetalhes'));
const Configuracoes = lazy(() => import('./pages/Configuracoes'));
const ControleOSGlobal = lazy(() => import('./pages/ControleOSGlobal'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Empreendimento = lazy(() => import('./pages/Empreendimento'));
const Empreendimentos = lazy(() => import('./pages/Empreendimentos'));
const Home = lazy(() => import('./pages/Home'));
const Orcamentos = lazy(() => import('./pages/Orcamentos'));
const PRE = lazy(() => import('./pages/PRE'));
const Planejamento = lazy(() => import('./pages/Planejamento'));
const Propostas = lazy(() => import('./pages/Propostas'));
const Relatorios = lazy(() => import('./pages/Relatorios'));
const SeletorPlanejamento = lazy(() => import('./pages/SeletorPlanejamento'));
const Usuarios = lazy(() => import('./pages/Usuarios'));
const VisualizadorIFC = lazy(() => import('./pages/VisualizadorIFC'));

export const PAGES = {
    "AnaliseConcepcaoPlanejamento": AnaliseConcepcaoPlanejamento,
    "Analitico": Analitico,
    "AtaPlanejamento": AtaPlanejamento,
    "AtividadesRapidas": AtividadesRapidas,
    "Comercial": Comercial,
    "ComercialDetalhes": ComercialDetalhes,
    "Configuracoes": Configuracoes,
    "ControleOSGlobal": ControleOSGlobal,
    "Dashboard": Dashboard,
    "Empreendimento": Empreendimento,
    "Empreendimentos": Empreendimentos,
    "Home": Home,
    "Orcamentos": Orcamentos,
    "PRE": PRE,
    "Planejamento": Planejamento,
    "Propostas": Propostas,
    "Relatorios": Relatorios,
    "SeletorPlanejamento": SeletorPlanejamento,
    "Usuarios": Usuarios,
    "VisualizadorIFC": VisualizadorIFC,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
