import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMetricsCheckDue,
  isMetricsWindowClosed,
  metricsCheckpoints,
  metricsStatusOf,
  metricsWindowEnd,
  normalizePostMetrics,
} from '../content/publication-metrics.js';

// F8-5a (DEC-F8-029): metricas organicas com ausencia != zero.

const tiles = (v: number) => [
  { key: 'reach', kind: 'count', value: v },
  { key: 'views', kind: 'count', value: v },
  { key: 'likes', kind: 'count', value: v },
  { key: 'comments', kind: 'count', value: v },
  { key: 'saves', kind: 'count', value: v },
  { key: 'shares', kind: 'count', value: v },
  { key: 'engagement', kind: 'percent', value: v },
];

test('zeros com captured_at nulo nao sao dado (comportamento do T30)', () => {
  const r = normalizePostMetrics({ analyticsAvailable: true, capturedAt: null, tiles: tiles(0) });
  assert.deepEqual(r, { kind: 'AWAITING_COLLECTION' });
  assert.equal(normalizePostMetrics({ analyticsAvailable: true, capturedAt: 'nao-e-data', tiles: tiles(5) }).kind, 'AWAITING_COLLECTION');
});

test('coleta registrada: zero legitimo e preservado, com capturedAt do provedor', () => {
  const r = normalizePostMetrics({ analyticsAvailable: true, capturedAt: '2026-10-14T03:00:00Z', tiles: tiles(0) });
  assert.equal(r.kind, 'COLLECTED');
  if (r.kind !== 'COLLECTED') return;
  assert.equal(r.capturedAt.toISOString(), '2026-10-14T03:00:00.000Z');
  assert.equal(r.values.reach, 0);
  assert.equal(r.values.engagementPct, 0);
  assert.equal(r.kinds.engagement, 'percent');
});

test('indicador ausente, negativo, nao numerico ou de tipo inesperado vira null (nunca 0)', () => {
  const r = normalizePostMetrics({
    analyticsAvailable: true,
    capturedAt: '2026-10-14T03:00:00Z',
    tiles: [
      { key: 'reach', kind: 'count', value: 12.4 },
      { key: 'likes', kind: 'count', value: -1 },
      { key: 'comments', kind: 'count', value: '3' },
      { key: 'saves', kind: 'percent', value: 2 },
      { key: 'engagement', kind: 'percent', value: 4.567 },
    ],
  });
  assert.equal(r.kind, 'COLLECTED');
  if (r.kind !== 'COLLECTED') return;
  assert.deepEqual(r.values, { reach: 12, views: null, likes: null, comments: null, saves: null, shares: null, engagementPct: 4.57 });
});

test('provedor sem analise: indisponivel com motivo', () => {
  assert.deepEqual(normalizePostMetrics({ analyticsAvailable: false, unavailableReason: 'not_supported', capturedAt: '2026-10-14T03:00:00Z', tiles: tiles(9) }), {
    kind: 'UNAVAILABLE',
    reason: 'not_supported',
  });
});

test('janelas D-F85-3: 1h, 3h, 6h, 24h, 72h, 7d; Story ate 26h', () => {
  const pub = new Date('2026-10-14T00:00:00Z');
  assert.deepEqual(metricsCheckpoints(pub, 'FEED_IMAGE').map((d) => (d.getTime() - pub.getTime()) / 3600_000), [1, 3, 6, 24, 72, 168]);
  assert.deepEqual(metricsCheckpoints(pub, 'STORY').map((d) => (d.getTime() - pub.getTime()) / 3600_000), [1, 3, 6, 24, 26]);
  assert.equal(metricsWindowEnd(pub, 'STORY').toISOString(), '2026-10-15T02:00:00.000Z');
});

test('consulta devida so quando um ponto passou e nao foi coberto', () => {
  const pub = new Date('2026-10-14T00:00:00Z');
  const at = (h: number) => new Date(pub.getTime() + h * 3600_000);
  assert.equal(isMetricsCheckDue({ publishedAt: pub, format: 'FEED_IMAGE', lastCheckedAt: null, now: at(0.5) }), false);
  assert.equal(isMetricsCheckDue({ publishedAt: pub, format: 'FEED_IMAGE', lastCheckedAt: null, now: at(1) }), true);
  assert.equal(isMetricsCheckDue({ publishedAt: pub, format: 'FEED_IMAGE', lastCheckedAt: at(1.01), now: at(2) }), false);
  // atrasada: uma consulta em 5 h cobre 1 h e 3 h
  assert.equal(isMetricsCheckDue({ publishedAt: pub, format: 'FEED_IMAGE', lastCheckedAt: at(5), now: at(5.5) }), false);
  assert.equal(isMetricsCheckDue({ publishedAt: pub, format: 'FEED_IMAGE', lastCheckedAt: at(5), now: at(6) }), true);
  assert.equal(isMetricsCheckDue({ publishedAt: pub, format: 'STORY', lastCheckedAt: at(26), now: at(200) }), false);
  assert.equal(isMetricsWindowClosed({ publishedAt: pub, format: 'STORY', lastCheckedAt: at(26) }), true);
  assert.equal(isMetricsWindowClosed({ publishedAt: pub, format: 'FEED_IMAGE', lastCheckedAt: at(26) }), false);
});

test('situacao exibida preserva aguardando, indisponivel, erro e encerrado sem valor fabricado', () => {
  const s = (o: Partial<Parameters<typeof metricsStatusOf>[0]>) =>
    metricsStatusOf({ published: true, hasSnapshot: false, lastOutcome: null, windowClosed: false, ...o });
  assert.equal(s({ published: false, hasSnapshot: true }), 'NOT_PUBLISHED');
  assert.equal(s({}), 'AWAITING_COLLECTION');
  assert.equal(s({ lastOutcome: 'AWAITING_COLLECTION' }), 'AWAITING_COLLECTION');
  assert.equal(s({ lastOutcome: 'ERROR' }), 'ERROR');
  assert.equal(s({ lastOutcome: 'UNAVAILABLE' }), 'UNAVAILABLE');
  assert.equal(s({ lastOutcome: 'NOT_FOUND' }), 'UNAVAILABLE');
  assert.equal(s({ windowClosed: true }), 'STOPPED');
  assert.equal(s({ hasSnapshot: true, lastOutcome: 'ERROR' }), 'COLLECTED');
  assert.equal(s({ hasSnapshot: true, windowClosed: true }), 'STOPPED');
});

// F8-5p.2 (DEC-F8-031, P38): repeticoes controladas
import { isMetricsConsultDue, metricsRateLimitDelaySeconds, metricsRetryDelayMinutes } from '../content/publication-metrics.js';

test('repeticoes em 15, 30 e 60 min; a quarta falha consome o ponto', () => {
  assert.deepEqual([1, 2, 3, 4, 0].map(metricsRetryDelayMinutes), [15, 30, 60, null, null]);
});

test('429: espera do provedor com piso de 60 s e teto de 1 h', () => {
  assert.deepEqual([metricsRateLimitDelaySeconds(5), metricsRateLimitDelaySeconds(120), metricsRateLimitDelaySeconds(99999), metricsRateLimitDelaySeconds(null)], [60, 120, 3600, 60]);
});

test('repeticao pendente: so quando vence, mesmo com a janela ja no ultimo ponto', () => {
  const pub = new Date('2026-10-14T00:00:00Z');
  const at = (h: number) => new Date(pub.getTime() + h * 3600_000);
  const base = { publishedAt: pub, format: 'STORY' as const, lastCheckedAt: at(24) };
  assert.equal(isMetricsConsultDue({ ...base, retryAt: at(26.25), now: at(26.1) }), false);
  assert.equal(isMetricsConsultDue({ ...base, retryAt: at(26.25), now: at(26.25) }), true, 'o ultimo ponto nao se perde por um erro');
  assert.equal(isMetricsConsultDue({ ...base, retryAt: null, now: at(26) }), true);
  assert.equal(isMetricsConsultDue({ ...base, lastCheckedAt: at(26), retryAt: null, now: at(40) }), false);
});
