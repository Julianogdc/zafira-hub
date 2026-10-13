import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Calendar } from 'lucide-react';
import { Badge } from '../../ui/ds/Badge';
import styles from './dashboard-widgets.module.css';

// ============================================================================
// 1. DashKpiCard
// ============================================================================
export interface DashKpiTrend {
  value: string;
  direction?: 'up' | 'down' | 'neutral';
}

export interface DashKpiCardProps {
  title: string;
  value: string | number | null;
  context?: string;
  icon?: React.ReactNode;
  trend?: DashKpiTrend;
  href?: string;
  onClick?: () => void;
  variant?: 'default' | 'warning' | 'danger' | 'success';
  loading?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function DashKpiCard({
  title,
  value,
  context,
  icon,
  trend,
  href,
  onClick,
  variant = 'default',
  loading = false,
  className = '',
  'aria-label': ariaLabel,
}: DashKpiCardProps) {
  if (loading) {
    return (
      <div
        className={`${styles.kpiCard} ${className}`.trim()}
        aria-busy="true"
        aria-label={`Carregando indicador ${title}`}
      >
        <div className={styles.kpiHeader}>
          <div style={{ width: 100, height: 16, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4 }} />
          {icon && <div style={{ width: 18, height: 18, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4 }} />}
        </div>
        <div style={{ width: 120, height: 32, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4, margin: '4px 0' }} />
        {context && <div style={{ width: 140, height: 14, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4 }} />}
      </div>
    );
  }

  const isInteractive = Boolean(href || onClick);
  const displayValue = value === null || value === undefined ? '—' : value;

  const content = (
    <>
      <div className={styles.kpiHeader}>
        <span className={styles.kpiTitle}>{title}</span>
        {icon && <span className={styles.kpiIcon} aria-hidden="true">{icon}</span>}
      </div>

      <div className={styles.kpiValue}>{displayValue}</div>

      {(trend || context) && (
        <div className={styles.kpiFooter}>
          {trend && (
            <span
              className={`${styles.kpiTrend} ${
                trend.direction === 'up'
                  ? styles.kpiTrendUp
                  : trend.direction === 'down'
                  ? styles.kpiTrendDown
                  : styles.kpiTrendNeutral
              }`}
            >
              {trend.direction === 'up' ? '↑ ' : trend.direction === 'down' ? '↓ ' : ''}
              {trend.value}
            </span>
          )}
          {context && <span className={styles.kpiContext}>{context}</span>}
        </div>
      )}
    </>
  );

  const cardClasses = `${styles.kpiCard} ${isInteractive ? styles.kpiCardInteractive : ''} ${className}`.trim();
  const computedAriaLabel = ariaLabel || `${title}: ${displayValue}${context ? `. ${context}` : ''}`;

  if (href) {
    return (
      <Link to={href} className={cardClasses} aria-label={computedAriaLabel}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div
        className={cardClasses}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        aria-label={computedAriaLabel}
      >
        {content}
      </div>
    );
  }

  return (
    <div className={cardClasses} aria-label={computedAriaLabel}>
      {content}
    </div>
  );
}

// ============================================================================
// 2. DashboardSectionCard
// ============================================================================
export interface DashboardSectionCardProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DashboardSectionCard({
  title,
  subtitle,
  actionLabel,
  actionHref,
  onAction,
  headerExtra,
  children,
  className = '',
}: DashboardSectionCardProps) {
  return (
    <div className={`${styles.sectionCard} ${className}`.trim()}>
      <div className={styles.sectionCardHeader}>
        <div className={styles.sectionCardTitleWrap}>
          <h3 className={styles.sectionCardTitle}>{title}</h3>
          {subtitle && <p className={styles.sectionCardSubtitle}>{subtitle}</p>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {headerExtra}
          {actionLabel && actionHref && (
            <Link to={actionHref} className={styles.sectionCardAction}>
              {actionLabel}
            </Link>
          )}
          {actionLabel && !actionHref && onAction && (
            <button
              type="button"
              onClick={onAction}
              className={styles.sectionCardAction}
              style={{ background: 'none', border: 'none', padding: 0 }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>

      <div className={styles.sectionCardBody}>{children}</div>
    </div>
  );
}

// ============================================================================
// 3. DashboardProgressBar
// ============================================================================
export interface DashboardProgressBarProps {
  value: number;
  status?: string;
  variant?: 'primary' | 'warning' | 'danger' | 'success';
  ariaLabel?: string;
}

export function DashboardProgressBar({
  value,
  status,
  variant,
  ariaLabel,
}: DashboardProgressBarProps) {
  // Clampa estritamente entre 0 e 100 para percentuais
  const clampedValue = Math.min(100, Math.max(0, value));

  const resolveFillColor = () => {
    if (variant === 'danger') return 'var(--z-color-danger)';
    if (variant === 'warning') return 'var(--z-color-warning)';
    if (variant === 'success') return 'var(--z-color-success)';
    if (variant === 'primary') return 'var(--z-color-primary-active)';

    if (status === 'Em risco' || status === 'Atrasado') return 'var(--z-color-danger)';
    if (status === 'Atenção') return 'var(--z-color-warning)';
    return 'var(--z-color-primary-active)';
  };

  return (
    <div
      className={styles.progressBarContainer}
      role="progressbar"
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel || `Progresso: ${clampedValue}%`}
    >
      <span className={styles.progressBarValue}>{clampedValue}%</span>
      <div className={styles.progressBarTrack}>
        <div
          className={styles.progressBarFill}
          style={{ width: `${clampedValue}%`, backgroundColor: resolveFillColor() }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// 4. CarteiraBars (Distribuição Horizontal Genérica)
// ============================================================================
export interface CarteiraBarItem {
  label: string;
  value: number;
  color?: string;
  variant?: 'success' | 'warning' | 'danger' | 'primary' | 'muted';
}

export interface CarteiraBarsProps {
  items: CarteiraBarItem[];
  total?: number;
  className?: string;
}

export function CarteiraBars({ items, total, className = '' }: CarteiraBarsProps) {
  const computedTotal =
    total !== undefined && total > 0
      ? total
      : items.reduce((acc, curr) => acc + (curr.value || 0), 0);

  const resolveBarColor = (item: CarteiraBarItem) => {
    if (item.color) return item.color;
    if (item.variant === 'success') return 'var(--z-color-success)';
    if (item.variant === 'warning') return 'var(--z-color-warning)';
    if (item.variant === 'danger') return 'var(--z-color-danger)';
    if (item.variant === 'muted') return 'var(--z-text-muted)';
    return 'var(--z-color-primary-active)';
  };

  return (
    <div className={`${styles.carteiraContainer} ${className}`.trim()}>
      {items.map((row) => {
        const percent = computedTotal > 0 ? (row.value / computedTotal) * 100 : 0;
        return (
          <div key={row.label} className={styles.carteiraRow}>
            <span className={styles.carteiraLabel}>{row.label}</span>
            <div className={styles.carteiraTrack}>
              <div
                className={styles.carteiraFill}
                style={{
                  width: `${percent}%`,
                  backgroundColor: resolveBarColor(row),
                }}
              />
            </div>
            <span className={styles.carteiraValue}>{row.value}</span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// 5. PrioridadesList
// ============================================================================
export interface PrioridadeItem {
  id: string;
  title: string;
  clientName?: string;
  description?: string;
  severity?: 'danger' | 'warning' | 'info' | 'neutral' | 'high' | 'medium' | 'low' | 'urgent';
  severityLabel?: string;
  label?: string;
  href?: string;
  onClick?: () => void;
}

export interface PrioridadesListProps {
  items: PrioridadeItem[];
  loading?: boolean;
  emptyMessage?: string;
}

export function PrioridadesList({
  items,
  loading = false,
  emptyMessage = 'Nenhuma prioridade crítica no momento.',
}: PrioridadesListProps) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 48,
              backgroundColor: 'var(--z-surface-secondary)',
              borderRadius: 'var(--z-radius-xs)',
            }}
          />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <div className={styles.emptyStateCompact}>{emptyMessage}</div>;
  }

  const resolveBadgeVariant = (severity?: string): 'danger' | 'warning' | 'info' | 'neutral' => {
    if (severity === 'danger' || severity === 'high' || severity === 'urgent' || severity === 'Alta') return 'danger';
    if (severity === 'warning' || severity === 'medium' || severity === 'Média') return 'warning';
    if (severity === 'info' || severity === 'low' || severity === 'Informativa' || severity === 'Baixa') return 'info';
    return 'neutral';
  };

  const resolveBadgeLabel = (item: PrioridadeItem): string => {
    if (item.severityLabel) return item.severityLabel;
    if (item.label) return item.label;
    if (item.severity === 'danger' || item.severity === 'high' || item.severity === 'urgent') return 'Alta';
    if (item.severity === 'warning' || item.severity === 'medium') return 'Média';
    if (item.severity === 'info' || item.severity === 'low') return 'Informativa';
    return 'Geral';
  };

  return (
    <div className={styles.prioridadesList}>
      {items.map((item) => {
        const content = (
          <>
            <div className={styles.prioridadeContent}>
              {item.clientName && <span className={styles.prioridadeCliente}>{item.clientName}</span>}
              <span className={styles.prioridadeProblema}>{item.title}</span>
              {item.description && !item.clientName && (
                <span className={styles.prioridadeProblema}>{item.description}</span>
              )}
            </div>
            <div className={styles.prioridadeRight}>
              <Badge variant={resolveBadgeVariant(item.severity)} size="sm">
                {resolveBadgeLabel(item)}
              </Badge>
              <ChevronRight size={14} style={{ color: 'var(--z-text-muted)', flexShrink: 0 }} />
            </div>
          </>
        );

        if (item.href) {
          return (
            <Link key={item.id} to={item.href} className={styles.prioridadeItem}>
              {content}
            </Link>
          );
        }

        return (
          <div
            key={item.id}
            className={styles.prioridadeItem}
            onClick={item.onClick}
            role={item.onClick ? 'button' : undefined}
            tabIndex={item.onClick ? 0 : undefined}
            onKeyDown={(e) => {
              if (item.onClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                item.onClick();
              }
            }}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// 6. CompromissosList
// ============================================================================
export interface CompromissoItem {
  id: string;
  title: string;
  clientName?: string;
  date: string;
  time?: string;
  href?: string;
  onClick?: () => void;
}

export interface CompromissosListProps {
  items: CompromissoItem[];
  loading?: boolean;
  emptyMessage?: string;
}

export function CompromissosList({
  items,
  loading = false,
  emptyMessage = 'Nenhum compromisso agendado para o período.',
}: CompromissosListProps) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 44,
              backgroundColor: 'var(--z-surface-secondary)',
              borderRadius: 'var(--z-radius-xs)',
            }}
          />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <div className={styles.emptyStateCompact}>{emptyMessage}</div>;
  }

  return (
    <div className={styles.compromissosList}>
      {items.map((item) => {
        const content = (
          <>
            <div className={styles.compromissoIconWrap}>
              <Calendar size={14} />
            </div>
            <div className={styles.compromissoContent}>
              <div className={styles.compromissoTitle}>{item.title}</div>
              {item.clientName && <div className={styles.compromissoClient}>{item.clientName}</div>}
            </div>
            <div className={styles.compromissoTimeWrap}>
              {item.time && <span className={styles.compromissoTime}>{item.time}</span>}
              <span className={styles.compromissoDate}>{item.date}</span>
            </div>
          </>
        );

        if (item.href) {
          return (
            <Link key={item.id} to={item.href} className={styles.compromissoItem}>
              {content}
            </Link>
          );
        }

        return (
          <div
            key={item.id}
            className={styles.compromissoItem}
            onClick={item.onClick}
            role={item.onClick ? 'button' : undefined}
            tabIndex={item.onClick ? 0 : undefined}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// 7. ResponsavelCell
// ============================================================================
export interface ResponsavelCellProps {
  name: string;
  avatarUrl?: string;
  className?: string;
}

export function ResponsavelCell({ name, avatarUrl, className = '' }: ResponsavelCellProps) {
  const initials = (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className={`${styles.responsavelCell} ${className}`.trim()} title={name}>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={`Foto de ${name}`}
          className={styles.responsavelAvatar}
          style={{ objectFit: 'cover' }}
        />
      ) : (
        <span className={styles.responsavelAvatar} aria-hidden="true">
          {initials || '—'}
        </span>
      )}
      <span className={styles.responsavelName}>{name}</span>
    </div>
  );
}

// ============================================================================
// 8. ProjectsAttentionTable
// ============================================================================
export interface ProjectAttentionItem {
  id: string;
  name: string;
  clientName: string;
  responsible: string;
  progress: number;
  deadline: string;
  status: string;
  statusVariant?: 'danger' | 'warning' | 'neutral' | 'success';
  href?: string;
}

export interface ProjectsAttentionTableProps {
  items: ProjectAttentionItem[];
  loading?: boolean;
  emptyMessage?: string;
}

export function ProjectsAttentionTable({
  items,
  loading = false,
  emptyMessage = 'Nenhum projeto em atenção no período selecionado.',
}: ProjectsAttentionTableProps) {
  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ height: 120, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 'var(--z-radius-xs)' }} />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <div className={styles.emptyStateCompact}>{emptyMessage}</div>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--z-surface-secondary)' }}>
            {['Projeto', 'Cliente', 'Responsável', 'Progresso', 'Prazo', 'Status'].map((col) => (
              <th
                key={col}
                style={{
                  padding: '10px 16px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: 'var(--z-text-muted)',
                  borderBottom: '1px solid var(--z-border-default)',
                  whiteSpace: 'nowrap',
                  fontFamily: 'var(--z-font-ui)',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((proj) => (
            <tr
              key={proj.id}
              style={{
                borderBottom: '1px solid var(--z-border-default)',
                transition: 'background-color var(--z-transition)',
              }}
            >
              <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--z-text-primary)' }}>
                {proj.href ? (
                  <Link
                    to={proj.href}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {proj.name}
                  </Link>
                ) : (
                  proj.name
                )}
              </td>
              <td style={{ padding: '12px 16px', color: 'var(--z-text-muted)' }}>{proj.clientName}</td>
              <td style={{ padding: '12px 16px' }}>
                <ResponsavelCell name={proj.responsible} />
              </td>
              <td style={{ padding: '12px 16px', minWidth: 140 }}>
                <DashboardProgressBar value={proj.progress} status={proj.status} />
              </td>
              <td style={{ padding: '12px 16px', fontFamily: 'var(--z-font-numeric)', fontWeight: 600, color: 'var(--z-text-primary)' }}>
                {proj.deadline}
              </td>
              <td style={{ padding: '12px 16px' }}>
                <Badge variant={proj.statusVariant || 'warning'} size="sm">
                  {proj.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// 9. FinancialSummary
// ============================================================================
export interface FinancialSummaryProps {
  received: number | string | null;
  pending: number | string | null;
  overdue: number | string | null;
  overdueCount?: number | null;
  formatCurrency?: (val: number) => string;
  loading?: boolean;
}

export function FinancialSummary({
  received,
  pending,
  overdue,
  overdueCount,
  formatCurrency,
  loading = false,
}: FinancialSummaryProps) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 36,
              backgroundColor: 'var(--z-surface-secondary)',
              borderRadius: 'var(--z-radius-xs)',
            }}
          />
        ))}
      </div>
    );
  }

  const formatValue = (val: number | string | null) => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') {
      if (formatCurrency) return formatCurrency(val);
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);
    }
    return val;
  };

  const rows = [
    { label: 'Recebido no período', value: formatValue(received), styleClass: styles.finValueSuccess },
    { label: 'A receber (previsto)', value: formatValue(pending), styleClass: styles.finValuePending },
    {
      label: overdueCount ? `Vencido (${overdueCount} cobrança${overdueCount > 1 ? 's' : ''})` : 'Vencido',
      value: formatValue(overdue),
      styleClass: styles.finValueDanger,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {rows.map((row) => (
        <div key={row.label} className={styles.finRow}>
          <span className={styles.finLabel}>{row.label}</span>
          <span className={`${styles.finValue} ${row.styleClass}`}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
