import React from 'react';
import { CheckCircle2, RefreshCw, ChevronDown } from 'lucide-react';
import { IconButton } from '../../ui/ds/IconButton';
import styles from './dashboard-widgets.module.css';

export type DashboardPeriodOption = '7d' | '30d' | '90d';

export interface DashboardClientOption {
  value: string;
  label: string;
}

export interface DashboardHeaderProps {
  title?: string;
  subtitle?: string;
  freshnessLabel?: string;
  period: DashboardPeriodOption;
  onPeriodChange: (period: DashboardPeriodOption) => void;
  clientOptions?: DashboardClientOption[];
  selectedClientId?: string;
  onClientChange?: (clientId: string) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  className?: string;
}

const DEFAULT_PERIOD_OPTIONS: Array<{ value: DashboardPeriodOption; label: string }> = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
];

const DEFAULT_CLIENT_OPTIONS: DashboardClientOption[] = [
  { value: 'all', label: 'Todos os clientes' },
];

export function DashboardHeader({
  title = 'Visão geral',
  subtitle = 'Acompanhe a situação da agência, prioridades e principais indicadores.',
  freshnessLabel,
  period,
  onPeriodChange,
  clientOptions = DEFAULT_CLIENT_OPTIONS,
  selectedClientId = 'all',
  onClientChange,
  refreshing = false,
  onRefresh,
  className = '',
}: DashboardHeaderProps) {
  return (
    <header className={`${styles.headerContainer} ${className}`.trim()}>
      <div className={styles.headerLeft}>
        <h1 className={styles.headerTitle}>{title}</h1>
        {subtitle && <p className={styles.headerSubtitle}>{subtitle}</p>}
      </div>

      <div className={styles.headerRight}>
        {freshnessLabel && (
          <div className={styles.freshnessBadge} aria-live="polite">
            <CheckCircle2 size={13} style={{ color: 'var(--z-color-success)' }} />
            <span>{freshnessLabel}</span>
          </div>
        )}

        {/* Seletor de Período Oficial (7d, 30d, 90d) */}
        <div className={styles.selectWrapper} style={{ width: 156 }}>
          <select
            className={styles.selectInput}
            value={period}
            onChange={(e) => onPeriodChange(e.target.value as DashboardPeriodOption)}
            aria-label="Selecionar período do dashboard"
            style={{ width: '100%' }}
          >
            {DEFAULT_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className={styles.selectChevron} aria-hidden="true" />
        </div>

        {/* Seletor de Cliente Opcional */}
        <div className={styles.selectWrapper} style={{ width: 180 }}>
          <select
            className={styles.selectInput}
            value={selectedClientId}
            onChange={(e) => onClientChange?.(e.target.value)}
            aria-label="Filtrar por cliente"
            style={{ width: '100%' }}
          >
            {clientOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className={styles.selectChevron} aria-hidden="true" />
        </div>

        {/* Botão de Atualização Manual */}
        <IconButton
          variant="default"
          size="md"
          onClick={onRefresh}
          aria-label="Atualizar dados do dashboard"
          aria-busy={refreshing}
          disabled={refreshing}
        >
          <RefreshCw
            size={16}
            className={refreshing ? styles.refreshButtonRotating : undefined}
          />
        </IconButton>
      </div>
    </header>
  );
}
