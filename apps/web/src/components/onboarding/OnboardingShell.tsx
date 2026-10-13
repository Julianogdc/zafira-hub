import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { useAutomationCapabilities } from '@/services/automation';
import styles from '@/pages/Onboarding.module.css';

interface OnboardingShellProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Mostra as abas Modelos/Funções (telas de lista). */
  tabs?: boolean;
  children: React.ReactNode;
}

/** Moldura comum das telas de onboarding (F7-1b): título, ações e abas. */
export function OnboardingShell({ title, subtitle, actions, tabs = true, children }: OnboardingShellProps) {
  const { currentOrganization } = useAuthStore();
  const automation = useAutomationCapabilities(currentOrganization?.id);
  return (
    <div className={styles.container} data-testid="onboarding-page">
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div style={{ minWidth: 0 }}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
        {tabs ? (
          <nav className={styles.tabs} aria-label="Seções de onboarding">
            <NavLink
              to="/onboarding/execucoes"
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
            >
              Acompanhamento
            </NavLink>
            <NavLink
              to="/onboarding/minhas-etapas"
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
            >
              Minhas etapas
            </NavLink>
            <NavLink
              to="/onboarding/modelos"
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
            >
              Modelos
            </NavLink>
            <NavLink
              to="/onboarding/funcoes"
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
            >
              Funções
            </NavLink>
            {automation.view ? (
              <NavLink
                to="/onboarding/automacoes"
                className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
                data-testid="tab-automacoes"
              >
                Automações
              </NavLink>
            ) : null}
          </nav>
        ) : null}
      </header>
      {children}
    </div>
  );
}

interface BannerProps {
  kind?: 'info' | 'warn' | 'danger' | 'ok';
  children: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
}

export function Banner({ kind = 'info', children, actions, testId }: BannerProps) {
  const tone =
    kind === 'warn' ? styles.bannerWarn : kind === 'danger' ? styles.bannerDanger : kind === 'ok' ? styles.bannerOk : '';
  return (
    <div className={`${styles.banner} ${tone}`} role={kind === 'danger' || kind === 'warn' ? 'alert' : 'status'} data-testid={testId}>
      <div className={styles.bannerText}>{children}</div>
      {actions}
    </div>
  );
}
