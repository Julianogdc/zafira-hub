import React from 'react';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import styles from './dashboard-widgets.module.css';

const DASHBOARD_CHART_PALETTE = [
  'var(--z-color-primary-active)', // #5738AD
  'var(--z-color-purple-light)',    // #CFC5EA
  'var(--z-color-success)',         // #26C99A
  'var(--z-color-warning)',         // #F3A85B
  'var(--z-color-danger)',          // #F15C69
  'var(--z-color-info)',            // #6FA8FF
];

export interface TooltipPayloadEntry {
  name?: string;
  value?: string | number;
  color?: string;
  fill?: string;
  stroke?: string;
  payload?: Record<string, unknown>;
}

export interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  tooltipFormatter?: (value: string | number, name?: string, payload?: Record<string, unknown>) => React.ReactNode;
}

export function CustomChartTooltip({
  active,
  payload,
  label,
  tooltipFormatter,
}: CustomTooltipProps) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  return (
    <div className={styles.chartTooltip}>
      {label && <p className={styles.chartTooltipLabel}>{label}</p>}
      {payload.map((entry, index) => {
        const entryColor = entry.color || entry.fill || entry.stroke || 'var(--z-color-primary)';
        const rawValue = entry.value ?? '';
        const displayValue = tooltipFormatter
          ? tooltipFormatter(rawValue, entry.name, entry.payload)
          : typeof rawValue === 'number'
          ? rawValue.toLocaleString('pt-BR')
          : rawValue;

        return (
          <div key={`tooltip-item-${index}`} className={styles.chartTooltipItem}>
            <span
              className={styles.chartTooltipDot}
              style={{ backgroundColor: entryColor }}
            />
            <span className={styles.chartTooltipName}>{entry.name}:</span>
            <span className={styles.chartTooltipValue}>{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface AreaSeriesConfig {
  key: string;
  name: string;
  color?: string;
}

export interface AreaChartBaseProps {
  data: Record<string, unknown>[];
  dataKey: string;
  series: AreaSeriesConfig[];
  height?: number;
  valueFormatter?: (value: number) => string;
  tooltipFormatter?: (value: string | number, name?: string, payload?: Record<string, unknown>) => React.ReactNode;
  emptyMessage?: string;
  ariaLabel?: string;
}

export function AreaChartBase({
  data,
  dataKey,
  series,
  height = 260,
  valueFormatter,
  tooltipFormatter,
  emptyMessage = 'Nenhum dado disponível para o período.',
  ariaLabel = 'Gráfico de área comparativo',
}: AreaChartBaseProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className={styles.emptyStateCompact}
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        role="region"
        aria-label={ariaLabel}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }} role="region" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => {
              const color = s.color || DASHBOARD_CHART_PALETTE[i % DASHBOARD_CHART_PALETTE.length];
              const isPrimary = i === 0;
              return (
                <linearGradient
                  key={`gradient-${s.key}`}
                  id={`areaGradient-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={color}
                    stopOpacity={isPrimary ? 0.24 : 0.12}
                  />
                  <stop
                    offset="60%"
                    stopColor={color}
                    stopOpacity={isPrimary ? 0.08 : 0.03}
                  />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--z-border-default)"
            opacity={0.3}
          />
          <XAxis
            dataKey={dataKey}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: 'var(--z-text-muted)', fontFamily: 'var(--z-font-ui)' }}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: 'var(--z-text-muted)', fontFamily: 'var(--z-font-numeric)' }}
            tickFormatter={valueFormatter}
            width={valueFormatter ? 64 : 40}
            tickMargin={8}
          />
          <Tooltip
            content={<CustomChartTooltip tooltipFormatter={tooltipFormatter} />}
            cursor={{
              stroke: 'var(--z-border-default)',
              strokeWidth: 1,
              strokeDasharray: '4 4',
              opacity: 0.6,
            }}
          />
          {series.map((s, i) => {
            const color = s.color || DASHBOARD_CHART_PALETTE[i % DASHBOARD_CHART_PALETTE.length];
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={color}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#areaGradient-${s.key})`}
                activeDot={{
                  r: 4,
                  fill: color,
                  stroke: 'var(--z-surface-card)',
                  strokeWidth: 2,
                }}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutChartItem {
  name: string;
  value: number;
  color?: string;
  [key: string]: string | number | undefined;
}

export interface DonutChartBaseProps {
  data: DonutChartItem[];
  dataKey?: string;
  nameKey?: string;
  height?: number;
  centerLabel?: string;
  totalValue?: number;
  emptyMessage?: string;
  ariaLabel?: string;
}

export function DonutChartBase({
  data,
  dataKey = 'value',
  nameKey = 'name',
  height = 240,
  centerLabel = 'Total',
  totalValue,
  emptyMessage = 'Nenhum dado para exibição.',
  ariaLabel = 'Gráfico de rosca',
}: DonutChartBaseProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className={styles.emptyStateCompact}
        style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        role="region"
        aria-label={ariaLabel}
      >
        {emptyMessage}
      </div>
    );
  }

  const calculatedTotal =
    totalValue !== undefined
      ? totalValue
      : data.reduce((acc, curr) => acc + (Number(curr[dataKey]) || 0), 0);

  return (
    <div
      style={{ width: '100%', height, position: 'relative' }}
      role="region"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<CustomChartTooltip />} />
          <Pie
            data={data}
            innerRadius={65}
            outerRadius={92}
            paddingAngle={3}
            dataKey={dataKey}
            nameKey={nameKey}
            stroke="none"
          >
            {data.map((entry, index) => {
              const color =
                entry.color || DASHBOARD_CHART_PALETTE[index % DASHBOARD_CHART_PALETTE.length];
              return <Cell key={`donut-cell-${index}`} fill={color} />;
            })}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: 'var(--z-font-numeric)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--z-text-primary)',
              lineHeight: 1.1,
            }}
          >
            {calculatedTotal.toLocaleString('pt-BR')}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--z-text-muted)',
              fontFamily: 'var(--z-font-ui)',
              marginTop: 2,
            }}
          >
            {centerLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
