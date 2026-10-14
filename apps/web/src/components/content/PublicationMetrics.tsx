import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/ds';
import styles from '@/pages/Onboarding.module.css';
import { contentService } from '@/services/content';
import {
  METRICS_STATUS_META,
  METRIC_FIELDS,
  formatInZone,
  formatMetric,
  metricsHaveNumbers,
  type PublicationMetricsView,
} from '@/lib/publication-view';

/**
 * F8-5c (DEC-F8-029) - Desempenho de uma publicacao confirmada. Somente leitura.
 * Numero so aparece com coleta registrada pelo provedor (capturedAt); sem coleta, a situacao
 * (aguardando, indisponivel, falha, encerrada) aparece no lugar, nunca um zero.
 */
export function PublicationMetrics({ publicationId, timeZone, refreshKey }: { publicationId: string; timeZone: string; refreshKey?: string }) {
  const [data, setData] = useState<PublicationMetricsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    contentService
      .publicationMetrics(publicationId)
      .then((m) => {
        if (!alive) return;
        setData(m);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [publicationId, refreshKey]);

  if (failed) {
    return <p className={styles.eventMeta} data-testid="publication-metrics-error">Não foi possível carregar o desempenho.</p>;
  }
  if (!data) return null;
  const meta = METRICS_STATUS_META[data.status];
  return (
    <div data-testid="publication-metrics" data-metrics-status={data.status} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      <div className={styles.badges}>
        <strong style={{ fontSize: 13 }}>Desempenho</strong>
        <Badge variant={meta.tone}>{meta.label}</Badge>
      </div>
      {metricsHaveNumbers(data) && data.latest ? (
        <>
          <div className={styles.kpis} data-testid="publication-metrics-values">
            {METRIC_FIELDS.map((f) => (
              <div key={f.key} className={styles.kpi} data-metric={f.key}>
                <span className={styles.kpiValue}>{formatMetric(f.key, data.latest![f.key])}</span>
                <span className={styles.kpiLabel}>{f.label}</span>
              </div>
            ))}
          </div>
          <span className={styles.eventMeta} data-testid="publication-metrics-captured">
            Coletado pelo Instagram em {formatInZone(data.latest.capturedAt, timeZone)}
            {data.lastCheckedAt ? ` · última consulta do Hub em ${formatInZone(data.lastCheckedAt, timeZone)}` : ''}
          </span>
          {data.status === 'STOPPED' ? <span className={styles.eventMeta}>{meta.help}</span> : null}
        </>
      ) : (
        <span className={styles.eventMeta} data-testid="publication-metrics-empty">
          {meta.help}
          {data.lastCheckedAt ? ` Última consulta do Hub em ${formatInZone(data.lastCheckedAt, timeZone)}.` : ''}
        </span>
      )}
    </div>
  );
}
