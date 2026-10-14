import { Prisma } from '@prisma/client';
import {
  isMetricsConsultDue,
  METRICS_CHECKPOINT_HOURS,
  metricsRateLimitDelaySeconds,
  metricsRetryDelayMinutes,
  normalizePostMetrics,
  type ContentFormat,
  type MetricsCheckOutcome,
} from '@zafira/domain';
import { prisma } from '../../../lib/prisma.js';
import { publicationDispatchEnabled } from './publication-dispatcher.js';
import { GatewayError, resolveBrightBeanGateway, type PublicationGateway } from './publication-gateway.js';

/**
 * F8-5a (DEC-F8-029) - Coletor de metricas organicas das publicacoes confirmadas. SOMENTE LEITURA no provedor.
 * DESLIGADO por padrao: exige PUBLICATION_METRICS_ENABLED=true E o despachante ligado (sem publicacao nao ha o que medir).
 * Consulta so nos pontos da janela (D-F85-3); consultar nao significa coleta nova: so grava quando ha captured_at,
 * e a mesma coleta (publicacao + capturedAt) nunca duplica. fetchedAt (consulta do Hub) != capturedAt (coleta do provedor).
 * F8-5p.2 (DEC-F8-031, P38): erro transitorio NAO consome o ponto; repete em 15, 30 e 60 min e so entao consome com o erro
 * preservado. 429 espera o retry_after (sem contar como erro). Cada consulta reserva a publicacao (metricsRetryAt curto,
 * troca condicional), entao duas instancias nunca consultam a mesma publicacao ao mesmo tempo.
 */

const CLAIM_MS = 5 * 60_000;

export const publicationMetricsEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.PUBLICATION_METRICS_ENABLED === 'true' && publicationDispatchEnabled(env);

type GatewayFactory = (organizationId: string) => Promise<PublicationGateway>;

export interface MetricsCollectResult {
  enabled: boolean;
  checked: number;
  inserted: number;
  outcomes: Record<string, number>;
  stoppedByRateLimit?: boolean;
}

export class PublicationMetricsCollector {
  constructor(
    private readonly gatewayFor: GatewayFactory = resolveBrightBeanGateway,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  isEnabled() {
    return publicationMetricsEnabled(this.env);
  }

  async collectDue(opts: { now?: Date; limit?: number } = {}): Promise<MetricsCollectResult> {
    if (!this.isEnabled()) return { enabled: false, checked: 0, inserted: 0, outcomes: {} };
    const now = opts.now ?? new Date();
    const limit = opts.limit ?? 50;
    const candidates = await prisma.contentPublication.findMany({
      // janela maxima (7 dias) + margem: publicacoes antigas nunca ocupam o lote
      where: { state: 'PUBLISHED', publishedAt: { not: null, gte: new Date(now.getTime() - (METRICS_CHECKPOINT_HOURS.at(-1)! + 24) * 3600_000) }, externalPostId: { not: null } },
      orderBy: { metricsCheckedAt: { sort: 'asc', nulls: 'first' } },
      select: {
        id: true, organizationId: true, externalPostId: true, publishedAt: true, metricsCheckedAt: true,
        metricsRetryAt: true, metricsErrorCount: true, item: { select: { format: true } },
      },
      take: 500,
    });
    const due = candidates
      .filter((p) =>
        isMetricsConsultDue({ publishedAt: p.publishedAt!, format: p.item.format as ContentFormat, lastCheckedAt: p.metricsCheckedAt, retryAt: p.metricsRetryAt, now })
      )
      .slice(0, limit);

    const result: MetricsCollectResult = { enabled: true, checked: 0, inserted: 0, outcomes: {} };
    for (const p of due) {
      // reserva: so quem trocar o estado lido consulta (outra instancia ou ciclo concorrente pula)
      const claim = await prisma.contentPublication.updateMany({
        where: { id: p.id, metricsCheckedAt: p.metricsCheckedAt, metricsRetryAt: p.metricsRetryAt, metricsErrorCount: p.metricsErrorCount },
        data: { metricsRetryAt: new Date(now.getTime() + CLAIM_MS) },
      });
      if (claim.count !== 1) continue;
      let outcome: MetricsCheckOutcome;
      let reason: string | null = null;
      try {
        const gw = await this.gatewayFor(p.organizationId);
        const raw = await gw.getPostMetrics(p.externalPostId!);
        if (!raw) {
          outcome = 'NOT_FOUND';
        } else {
          const n = normalizePostMetrics(raw);
          if (n.kind === 'UNAVAILABLE') {
            outcome = 'UNAVAILABLE';
            reason = n.reason;
          } else if (n.kind === 'AWAITING_COLLECTION') {
            outcome = 'AWAITING_COLLECTION'; // zeros com captured_at nulo: nada e gravado
          } else {
            const created = await prisma.contentPublicationMetric.createMany({
              data: [
                {
                  organizationId: p.organizationId,
                  publicationId: p.id,
                  capturedAt: n.capturedAt,
                  fetchedAt: now,
                  ...n.values,
                  metricKinds: n.kinds as Prisma.InputJsonValue,
                },
              ],
              skipDuplicates: true, // mesma coleta ja registrada -> nada novo
            });
            result.inserted += created.count;
            outcome = created.count === 1 ? 'COLLECTED' : 'NO_NEW_COLLECTION';
          }
        }
      } catch (error) {
        if (error instanceof GatewayError && error.kind === 'RATE_LIMIT') {
          // limite do provedor: nao consome o ponto nem conta como erro; espera o retry_after e para o lote
          await prisma.contentPublication.update({
            where: { id: p.id },
            data: { metricsRetryAt: new Date(now.getTime() + metricsRateLimitDelaySeconds(error.retryAfterSeconds) * 1000) },
          });
          result.stoppedByRateLimit = true;
          break;
        }
        outcome = 'ERROR';
        reason = error instanceof GatewayError ? `${error.kind}: ${error.message}`.slice(0, 200) : 'Falha ao consultar as métricas.';
      }
      if (outcome === 'ERROR') {
        const errors = p.metricsErrorCount + 1;
        const delay = metricsRetryDelayMinutes(errors);
        if (delay !== null) {
          // erro transitorio: o ponto continua descoberto; nova tentativa no intervalo previsto
          await prisma.contentPublication.update({
            where: { id: p.id },
            data: { metricsRetryAt: new Date(now.getTime() + delay * 60_000), metricsErrorCount: errors, metricsLastOutcome: outcome, metricsLastReason: reason },
          });
          result.checked += 1;
          result.outcomes.ERROR_RETRY_SCHEDULED = (result.outcomes.ERROR_RETRY_SCHEDULED ?? 0) + 1;
          continue;
        }
      }
      // a consulta cobre o ponto atual (fetchedAt); esgotadas as repeticoes, o ponto e consumido com o erro preservado
      await prisma.contentPublication.update({
        where: { id: p.id },
        data: { metricsCheckedAt: now, metricsLastOutcome: outcome, metricsLastReason: reason, metricsRetryAt: null, metricsErrorCount: 0 },
      });
      result.checked += 1;
      result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1;
    }
    return result;
  }
}

export const publicationMetricsCollector = new PublicationMetricsCollector();
