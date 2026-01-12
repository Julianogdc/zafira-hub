import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AppSidebar } from "./components/AppSidebar";
import { lazy, Suspense, useEffect } from "react";
import { GlobalErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "./store/useAuthStore";
import { supabase } from "./lib/supabase";

// Lazy Imports for Performance
const Index = lazy(() => import("./pages/Index"));
const Projetos = lazy(() => import("./pages/Projetos"));
const Financas = lazy(() => import("./pages/Financas"));
const Clientes = lazy(() => import("./pages/Clientes"));
const CRM = lazy(() => import("./pages/CRM"));
const Metas = lazy(() => import("./pages/Metas"));
const Ferramentas = lazy(() => import("./pages/Ferramentas"));
const IAStudio = lazy(() => import("./pages/IAStudio"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Login = lazy(() => import("./pages/Login")); // Lazy load Login
const AdminUsers = lazy(() => import("./pages/admin/Users"));
import { ProtectedRoute } from "@/components/ProtectedRoute"; // Import ProtectedRoute
import AsanaAuthCallback from "./pages/AsanaAuthCallback";

const queryClient = new QueryClient();

// Simple Loader Component
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
  </div>
);



// Header Component to handle logic based on route
const AppHeader = () => {
  const location = useLocation();
  const isDashboard = location.pathname === "/";

  if (!isDashboard) return null;

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl sticky top-0 z-10">
      {/* SidebarTrigger removed per user request - moved to internal sidebar */}

      {/* Show Zafira Hub branding ONLY on Dashboard */}
      {isDashboard && (
        <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-500">
          <img
            src="/zafira-logo-full.png"
            alt="Zafira Hub"
            className="h-8 w-auto object-contain brightness-0 invert opacity-90 hover:opacity-100 transition-opacity"
          />
          <div className="h-4 w-px bg-white/20 mx-2" />
          <span className="text-xs text-muted-foreground font-medium tracking-wide">
            PAINEL DE GESTÃO
          </span>
        </div>
      )}
    </header>
  );
};

// Layout Component for authenticated pages
const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const isFullHeightPage = location.pathname === '/projetos' || location.pathname.startsWith('/projetos/');

  return (
    <SidebarProvider className="bg-background">
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1 h-full min-w-0 overflow-hidden">
          <AppHeader />
          <main className={`flex-1 overflow-hidden ${isFullHeightPage ? 'p-0' : 'px-6 py-6 overflow-y-auto'}`}>
            <GlobalErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                {children}
              </Suspense>
            </GlobalErrorBoundary>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
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
    if (checkSession) {
      checkSession();

      // Setup auth listener
      const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          checkSession();
        } else if (event === 'SIGNED_OUT') {
          useAuthStore.getState().logout();
        }
      });

      return () => {
        authListener.subscription.unsubscribe();
      };
    }
  }, [checkSession]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public Routes - No Layout */}
            <Route path="/login" element={
              <Suspense fallback={<LoadingFallback />}>
                <Login />
              </Suspense>
            } />
            <Route path="/auth/callback/asana" element={<AsanaAuthCallback />} />





            {/* Protected Routes - With Layout */}
            <Route path="*" element={
              <ProtectedRoute>
                <MainLayout>
                  <Routes>
                    <Route path="/" element={<Index />} />

                    {/* Business Routes (Admin + Manager) */}
                    <Route path="/financas" element={<ManagerRoute><Financas /></ManagerRoute>} />
                    <Route path="/clientes" element={<ManagerRoute><Clientes /></ManagerRoute>} />
                    <Route path="/crm" element={<ManagerRoute><CRM /></ManagerRoute>} />

                    {/* Operational Routes (All Authenticated Users) */}
                    <Route path="/ferramentas" element={<Ferramentas />} />
                    <Route path="/ia-studio" element={<IAStudio />} />
                    <Route path="/configuracoes" element={<Configuracoes />} />

                    {/* Admin Routes (Strict) */}
                    <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />

                    <Route path="/projetos" element={<Projetos />} />
                    <Route path="/metas" element={<Metas />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </MainLayout>
              </ProtectedRoute>
            } />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;