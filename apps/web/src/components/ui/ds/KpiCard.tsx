import React from 'react';
import styles from './ds.module.css';

export interface KpiTrend {
  value: string;
  direction?: 'up' | 'down' | 'neutral';
}

export interface KpiCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  context?: string;
  trend?: KpiTrend;
  icon?: React.ReactNode;
  loading?: boolean;
}

export const KpiCard = React.forwardRef<HTMLDivElement, KpiCardProps>(
  (
    {
      className = '',
      title,
      value,
      context,
      trend,
      icon,
      loading = false,
      ...props
    },
    ref
  ) => {
    if (loading) {
      return (
        <div ref={ref} className={`${styles.kpiCard} ${className}`.trim()} aria-busy="true" {...props}>
          <div className={styles.kpiCardTop}>
            <div style={{ width: 100, height: 16, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4 }} />
            {icon && <div style={{ width: 20, height: 20, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4 }} />}
          </div>
          <div style={{ width: 120, height: 32, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4 }} />
          {trend && <div style={{ width: 80, height: 16, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 4 }} />}
        </div>
      );
    }

    const trendDirection = trend?.direction || 'neutral';
    const trendClass =
      trendDirection === 'up'
        ? styles.trendUp
        : trendDirection === 'down'
        ? styles.trendDown
        : styles.trendNeutral;

    const trendSymbol = trendDirection === 'up' ? '↑ ' : trendDirection === 'down' ? '↓ ' : '';

    return (
      <div ref={ref} className={`${styles.kpiCard} ${className}`.trim()} {...props}>
        <div className={styles.kpiCardTop}>
          <span className={styles.kpiCardTitle}>{title}</span>
          {icon && <div className={styles.kpiCardIcon} aria-hidden="true">{icon}</div>}
        </div>

        <div className={styles.kpiCardValue}>{value}</div>

        {(trend || context) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {trend && (
              <span className={`${styles.kpiCardTrend} ${trendClass}`}>
                {trendSymbol}{trend.value}
              </span>
            )}
            {context && (
              <span style={{ fontSize: 12, color: 'var(--z-text-muted)', fontFamily: 'var(--z-font-ui)' }}>
                {context}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);

KpiCard.displayName = 'KpiCard';
