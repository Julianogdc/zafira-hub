import React, { useState, useEffect, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSidebarDs } from './AppSidebarDs';
import { AppTopbarDs } from './AppTopbarDs';
import { GlobalErrorBoundary } from '@/components/ui/ErrorBoundary';
import { LoadingState } from '@/components/ui/ds';
import styles from './layout.module.css';

const SIDEBAR_STORAGE_KEY = 'zafira:sidebar-collapsed';


export interface AppShellDsProps {
  children: React.ReactNode;
}

export function AppShellDs({ children }: AppShellDsProps) {
  const location = useLocation();
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.innerWidth <= 640) {
        return false;
      }
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      return saved !== 'true'; // Se não houver preferência salva, padrão é expandida (true)
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 640px)');
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setSidebarExpanded(false);
      }
    };
    if (mql.matches) {
      setSidebarExpanded(false);
    }
    mql.addEventListener('change', handleMediaChange);
    return () => mql.removeEventListener('change', handleMediaChange);
  }, []);

  const toggleSidebar = () => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'false' : 'true');
      } catch {
        // Fallback silencioso se o localStorage estiver bloqueado
      }
      return next;
    });
  };

  const isFullHeightPage =
    location.pathname === '/projetos' || location.pathname.startsWith('/projetos/');

  return (
    <div className={styles.appShell}>
      {/* 1. Sidebar Zafira Fixa */}
      <AppSidebarDs expanded={sidebarExpanded} />

      {/* 2. Área Principal de Conteúdo */}
      <div className={styles.mainContent}>
        {/* Topbar Fixa no topo */}
        <AppTopbarDs
          onToggleSidebar={toggleSidebar}
          sidebarExpanded={sidebarExpanded}
        />

        {/* Conteúdo das Páginas de Negócio Preservadas */}
        <main
          className={`flex-1 min-w-0 ${
            isFullHeightPage ? 'p-0 overflow-hidden' : 'px-3 py-4 sm:px-6 sm:py-6 overflow-y-auto'
          }`}
          style={{ backgroundColor: 'var(--z-surface-bg)' }}
        >
          <GlobalErrorBoundary>
            <Suspense fallback={<LoadingState message="Carregando..." />}>
              {children}
            </Suspense>
          </GlobalErrorBoundary>
        </main>
      </div>
    </div>
  );
}
