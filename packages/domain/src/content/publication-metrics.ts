/**
 * F8-5a (DEC-F8-029) - Regras puras de metricas organicas do post publicado (sem rede, sem banco).
 * Base: docs/propostas/F8-5_PROPOSTA_EXECUCAO.md e o comportamento observado na F8-0b (T30):
 *  - antes da primeira coleta o provedor devolve os indicadores com valor 0, `captured_at` nulo e series vazias;
 *    esses zeros NAO sao dado (ausencia != zero);
 *  - `next_sync_eta` e uma estimativa movel: nunca e usado;
 *  - a coleta de posts recentes e horaria: consultar nao significa obter coleta nova.
 * fetchedAt = quando o Hub consultou; capturedAt = quando o provedor efetivamente coletou.
 */

import type { ContentFormat } from './content-model.js';

export const POST_METRIC_COUNT_KEYS = ['reach', 'views', 'likes', 'comments', 'saves', 'shares'] as const;
export type PostMetricCountKey = (typeof POST_METRIC_COUNT_KEYS)[number];

export interface PostMetricValues {
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  /** Percentual (kind = percent no provedor); nunca somado com contagens. */
  engagementPct: number | null;
}

export interface RawMetricTile {
  key: string;
  kind?: string | null;
  value?: unknown;
}

export interface RawPostMetrics {
  analyticsAvailable: boolean;
  unavailableReason?: string | null;
  capturedAt?: string | null;
  tiles: readonly RawMetricTile[];
}

export type NormalizedPostMetrics =
  | { kind: 'UNAVAILABLE'; reason: string | null }
  | { kind: 'AWAITING_COLLECTION' }
  | { kind: 'COLLECTED'; capturedAt: Date; values: PostMetricValues; kinds: Record<string, string> };

const finiteNonNegative = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Normaliza a resposta do provedor. Regra central: sem `captured_at` valido nao ha dado, mesmo que
 * `analytics_available` seja true e os valores venham 0. Indicador ausente vira null (nunca 0).
 */
export function normalizePostMetrics(raw: RawPostMetrics): NormalizedPostMetrics {
  if (!raw.analyticsAvailable) {
    return { kind: 'UNAVAILABLE', reason: raw.unavailableReason ? String(raw.unavailableReason).slice(0, 200) : null };
  }
  const captured = raw.capturedAt ? new Date(raw.capturedAt) : null;
  if (!captured || Number.isNaN(captured.getTime())) return { kind: 'AWAITING_COLLECTION' };
  const byKey = new Map(raw.tiles.map((t) => [String(t.key).toLowerCase(), t]));
  const kinds: Record<string, string> = {};
  for (const t of raw.tiles) if (t.kind) kinds[String(t.key).toLowerCase()] = String(t.kind).slice(0, 20);
  const count = (key: PostMetricCountKey): number | null => {
    const t = byKey.get(key);
    if (!t || (t.kind && t.kind !== 'count')) return null;
    const v = finiteNonNegative(t.value);
    return v === null ? null : Math.round(v);
  };
  const eng = byKey.get('engagement');
  const engagementPct = eng && (!eng.kind || eng.kind === 'percent') ? finiteNonNegative(eng.value) : null;
  return {
    kind: 'COLLECTED',
    capturedAt: captured,
    values: {
      reach: count('reach'),
      views: count('views'),
      likes: count('likes'),
      comments: count('comments'),
      saves: count('saves'),
      shares: count('shares'),
      engagementPct: engagementPct === null ? null : Math.round(engagementPct * 100) / 100,
    },
    kinds,
  };
}

/** D-F85-3: consultas em 1 h, 3 h, 6 h, 24 h, 72 h e 7 dias apos a publicacao; Story ate 26 h. */
export const METRICS_CHECKPOINT_HOURS = [1, 3, 6, 24, 72, 168] as const;
export const STORY_METRICS_CHECKPOINT_HOURS = [1, 3, 6, 24, 26] as const;

export function metricsCheckpoints(publishedAt: Date, format: ContentFormat): Date[] {
  const hours = format === 'STORY' ? STORY_METRICS_CHECKPOINT_HOURS : METRICS_CHECKPOINT_HOURS;
  return hours.map((h) => new Date(publishedAt.getTime() + h * 3600_000));
}

/** Fim da janela de consulta (ultimo ponto). */
export function metricsWindowEnd(publishedAt: Date, format: ContentFormat): Date {
  const cps = metricsCheckpoints(publishedAt, format);
  return cps[cps.length - 1];
}

/**
 * Ha consulta devida? Sim quando algum ponto ja passou e ainda nao foi coberto por uma consulta
 * (uma consulta atrasada cobre todos os pontos anteriores a ela; nunca ha consulta extra fora dos pontos).
 */
export function isMetricsCheckDue(input: { publishedAt: Date; format: ContentFormat; lastCheckedAt: Date | null; now: Date }): boolean {
  const last = input.lastCheckedAt?.getTime() ?? -Infinity;
  return metricsCheckpoints(input.publishedAt, input.format).some((c) => c.getTime() <= input.now.getTime() && c.getTime() > last);
}

/** A janela terminou e o ultimo ponto ja foi consultado. */
export function isMetricsWindowClosed(input: { publishedAt: Date; format: ContentFormat; lastCheckedAt: Date | null }): boolean {
  return input.lastCheckedAt !== null && input.lastCheckedAt.getTime() >= metricsWindowEnd(input.publishedAt, input.format).getTime();
}

export const METRICS_CHECK_OUTCOMES = ['AWAITING_COLLECTION', 'COLLECTED', 'NO_NEW_COLLECTION', 'UNAVAILABLE', 'NOT_FOUND', 'ERROR'] as const;
export type MetricsCheckOutcome = (typeof METRICS_CHECK_OUTCOMES)[number];

export type MetricsStatus = 'NOT_PUBLISHED' | 'AWAITING_COLLECTION' | 'COLLECTED' | 'UNAVAILABLE' | 'ERROR' | 'STOPPED';

/**
 * Situacao exibida. Nunca fabrica valor: sem coleta registrada nao ha numero, e o motivo
 * (aguardando, indisponivel, erro na ultima consulta, janela encerrada) e preservado.
 */
export function metricsStatusOf(input: {
  published: boolean;
  hasSnapshot: boolean;
  lastOutcome: MetricsCheckOutcome | null;
  windowClosed: boolean;
}): MetricsStatus {
  if (!input.published) return 'NOT_PUBLISHED';
  if (input.hasSnapshot) return input.windowClosed ? 'STOPPED' : 'COLLECTED';
  if (input.lastOutcome === 'UNAVAILABLE' || input.lastOutcome === 'NOT_FOUND') return 'UNAVAILABLE';
  if (input.windowClosed) return 'STOPPED';
  if (input.lastOutcome === 'ERROR') return 'ERROR';
  return 'AWAITING_COLLECTION';
}
