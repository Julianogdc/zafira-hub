import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuthStore } from "./store/useAuthStore";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { AppShellDs } from "./components/layout";
import { LoadingState } from "./components/ui/ds";

// Lazy Imports for Performance
const Index = lazy(() => import("./pages/Index"));
const Projetos = lazy(() => import("./pages/Projetos"));
const Financas = lazy(() => import("./pages/Financas"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Cliente360 = lazy(() => import("./pages/Cliente360"));
const ClienteConteudoPreview = lazy(() => import("./pages/ClienteConteudoPreview"));
const CRM = lazy(() => import("./pages/CRM"));
const Performance = lazy(() => import("./pages/Performance"));
const Metas = lazy(() => import("./pages/Metas"));
const Ferramentas = lazy(() => import("./pages/Ferramentas"));
const IAStudio = lazy(() => import("./pages/IAStudio"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Login = lazy(() => import("./pages/Login")); // Lazy load Login
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const ConteudosAgenda = lazy(() => import("./pages/ConteudosAgenda"));
import { ProtectedRoute } from "@/components/ProtectedRoute"; // Import ProtectedRoute
import AsanaAuthCallback from "./pages/AsanaAuthCallback";
import OnboardingModelos from "./pages/OnboardingModelos";
import OnboardingConstrutor from "./pages/OnboardingConstrutor";
import OnboardingFuncoes from "./pages/OnboardingFuncoes";
import OnboardingAutomacoes from "./pages/OnboardingAutomacoes";
import Conteudo from "./pages/Conteudo";
import ConteudoDetalhe from "./pages/ConteudoDetalhe";
import Aprovacao from "./pages/Aprovacao";
import OnboardingExecucoes from "./pages/OnboardingExecucoes";
import OnboardingExecucao from "./pages/OnboardingExecucao";
import OnboardingMinhasEtapas from "./pages/OnboardingMinhasEtapas";
import Agenda from "./pages/Agenda";
import AgendaConfiguracao from "./pages/AgendaConfiguracao";

const queryClient = new QueryClient();





// Layout Component for authenticated pages
const MainLayout = ({ children }: { children: React.ReactNode }) => {
  return <AppShellDs>{children}</AppShellDs>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuthStore();
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

const ManagerRoute = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuthStore();
  // Allow Admin OR Manager
  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

const App = () => {
  const checkSession = useAuthStore((state) => state.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
          <Routes>
            {/* Public Routes - No Layout */}
            <Route path="/login" element={
              <Suspense fallback={<LoadingState fullHeight message="Iniciando Zafira Hub..." />}>
                <Login />
              </Suspense>
            } />
            <Route path="/auth/callback/asana" element={<AsanaAuthCallback />} />
            {/* F8-2: aprovacao do cliente por link (publica, sem login; token no fragmento da URL) */}
            <Route path="/aprovacao" element={<Aprovacao />} />





            {/* Protected Routes - With Layout */}
            <Route path="*" element={
              <ProtectedRoute>
                <MainLayout>
                  <Routes>
                    <Route path="/" element={<Index />} />

                    {/* Business Routes (Admin + Manager) */}
                    <Route path="/conteudos" element={<ManagerRoute><ConteudosAgenda /></ManagerRoute>} />
                    <Route path="/financas" element={<ManagerRoute><Financas /></ManagerRoute>} />
                    <Route path="/clientes" element={<ManagerRoute><Clientes /></ManagerRoute>} />
                    <Route path="/clientes/:id" element={<ManagerRoute><Cliente360 /></ManagerRoute>} />
                    <Route path="/clientes/:id/conteudo/:postId" element={<ManagerRoute><ClienteConteudoPreview /></ManagerRoute>} />
                    <Route path="/crm" element={<ManagerRoute><CRM /></ManagerRoute>} />
                    {/* <Route path="/performance" element={<ManagerRoute><Performance /></ManagerRoute>} /> */}

                    {/* Operational Routes (All Authenticated Users) */}
                    <Route path="/ferramentas" element={<Ferramentas />} />
                    <Route path="/ia-studio" element={<IAStudio />} />
                    <Route path="/configuracoes" element={<Configuracoes />} />

                    {/* Admin Routes (Strict) */}
                    <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />

                    <Route path="/projetos" element={<Projetos />} />
                    <Route path="/onboarding" element={<Navigate to="/onboarding/execucoes" replace />} />
                    <Route path="/onboarding/execucoes" element={<OnboardingExecucoes />} />
                    <Route path="/onboarding/execucoes/:id" element={<OnboardingExecucao />} />
                    <Route path="/onboarding/minhas-etapas" element={<OnboardingMinhasEtapas />} />
                    <Route path="/onboarding/modelos" element={<OnboardingModelos />} />
                    <Route path="/onboarding/modelos/:id" element={<OnboardingConstrutor />} />
                    <Route path="/onboarding/funcoes" element={<OnboardingFuncoes />} />
                    <Route path="/onboarding/automacoes" element={<OnboardingAutomacoes />} />
                    <Route path="/conteudo" element={<Conteudo />} />
                    <Route path="/conteudo/:id" element={<ConteudoDetalhe />} />
                    <Route path="/agenda" element={<Agenda />} />
                    <Route path="/agenda/configuracao" element={<AgendaConfiguracao />} />
                    <Route path="/metas" element={<Metas />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </MainLayout>
              </ProtectedRoute>
            } />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;