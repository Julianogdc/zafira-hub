import React, { useEffect, useState } from 'react';
import { CheckCircle2, FileInput, Globe2, Send } from 'lucide-react';
import type { ContentStagesResponse } from '@zafira/contracts';
import { contentStagesService } from '@/services/deliverables';
import { contentStageCards, formatStageValue, publishedBarState } from '@/lib/content-stages-view';
import styles from './CanonicalDeliverablesView.module.css';

/**
 * F8-3 (DEC-F8-007) - Contador de Entregas por estágio. SOMENTE LEITURA: nenhum botão de ação,
 * nenhuma aprovação interna (Asana) e nenhuma alteração da meta contratual.
 * Publicados sem confirmação confiável aparecem como "aguardando integração", nunca como 0.
 */

const ICONS = {
  received: <FileInput size={14} className="text-sky-400" />,
  sent: <Send size={14} className="text-amber-400" />,
  approved: <CheckCircle2 size={14} className="text-emerald-400" />,
  published: <Globe2 size={14} className="text-muted-foreground" />,
};

interface ContentStagesPanelProps {
  clientId: string;
  period: string;
}

export function ContentStagesPanel({ clientId, period }: ContentStagesPanelProps) {
  const [data, setData] = useState<ContentStagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    contentStagesService
      .get(clientId, period)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status = (err as { status?: number } | null)?.status;
        setData(null);
        setError(
          status === 403
            ? 'Sem permissão para ver os conteúdos deste cliente (content.view).'
            : 'Não foi possível carregar o andamento dos conteúdos.'
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId, period]);

  return (
    <section className={styles.stagesSection} data-testid="content-stages-panel" aria-label="Conteúdos do mês por estágio">
      <div className={styles.stagesHeader}>
        <span className={styles.metricLabel}>Conteúdos do mês por estágio</span>
        <span className={styles.stagesNote}>Contagem automática a partir dos arquivos e aprovações; não altera a meta.</span>
      </div>

      {error ? (
        <p className={styles.stagesMessage} data-testid="content-stages-error">
          {error}
        </p>
      ) : loading && !data ? (
        <p className={styles.stagesMessage}>Carregando…</p>
      ) : data ? (
        <>
          <div className={styles.stagesGrid}>
            {contentStageCards(data.counts).map((card) => (
              <div key={card.key} className={styles.metricCard} data-testid={`content-stage-${card.key}`}>
                <div className={styles.metricCardHeader}>
                  <span className={styles.metricLabel}>{card.label}</span>
                  {ICONS[card.key]}
                </div>
                <div className={styles.metricValueRow}>
                  <span
                    className={`${styles.metricValue} ${card.value === null ? 'text-muted-foreground' : ''}`}
                    data-testid={`content-stage-${card.key}-value`}
                  >
                    {formatStageValue(card.value)}
                  </span>
                </div>
                <span className={styles.metricSubtitle}>{card.hint}</span>
              </div>
            ))}
          </div>
          <PublishedBar counts={data.counts} />
        </>
      ) : null}
    </section>
  );
}

function PublishedBar({ counts }: { counts: ContentStagesResponse['counts'] }) {
  const state = publishedBarState(counts);
  return (
    <div className={styles.metricCard} data-testid="content-stages-bar" data-state={state.kind}>
      <div className={styles.metricCardHeader}>
        <span className={styles.metricLabel}>Publicadas entre as recebidas</span>
        {state.kind === 'RATIO' && <span className="text-xs font-semibold text-emerald-400">{state.percent}%</span>}
      </div>
      <div
        className={styles.progressBarContainer}
        role="progressbar"
        aria-label="Publicadas entre as recebidas"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state.kind === 'RATIO' ? state.percent : undefined}
        aria-valuetext={state.label}
      >
        {state.kind === 'RATIO' ? (
          <div className={styles.progressBarFill} style={{ width: `${state.percent}%` }} />
        ) : (
          <div className={styles.progressBarNeutral} />
        )}
      </div>
      <span className="text-[11px] text-muted-foreground mt-1" data-testid="content-stages-bar-label">
        {state.label}
      </span>
    </div>
  );
}
