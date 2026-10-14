import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS_STATUS_META, METRIC_FIELDS, PUBLICATION_STATE_META, deliveryNote, formatMetric, metricsHaveNumbers, formatInZone, safeHttpsUrl, scheduleProblem, suggestedSchedule, toOffsetIso } from '../publication-view';

// F8-4b (DEC-F8-027): apresentação do agendamento no Instagram.

test('fuso da organização -> ISO com deslocamento explícito', () => {
  assert.equal(toOffsetIso('2026-10-20', '14:00', 'America/Sao_Paulo'), '2026-10-20T14:00:00-03:00');
  assert.equal(toOffsetIso('2026-10-20', '14:00', 'UTC'), '2026-10-20T14:00:00+00:00');
  assert.equal(new Date(toOffsetIso('2026-10-20', '14:00', 'America/Sao_Paulo')!).toISOString(), '2026-10-20T17:00:00.000Z');
  // horário de verão (Nova York): março muda de -05:00 para -04:00
  assert.equal(toOffsetIso('2026-03-07', '12:00', 'America/New_York'), '2026-03-07T12:00:00-05:00');
  assert.equal(toOffsetIso('2026-03-09', '12:00', 'America/New_York'), '2026-03-09T12:00:00-04:00');
  assert.equal(toOffsetIso('2026-03-08', '02:30', 'America/New_York'), null, 'horário inexistente na troca');
  assert.equal(toOffsetIso('20/10/2026', '14:00', 'UTC'), null);
  assert.equal(toOffsetIso('2026-10-20', '2pm', 'UTC'), null);
});

test('antecedência mínima antes de enviar', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.match(scheduleProblem('2026-10-20T12:04:00+00:00', 5, now) ?? '', /5 minutos/);
  assert.equal(scheduleProblem('2026-10-20T12:05:00+00:00', 5, now), null);
  assert.match(scheduleProblem(null, 5, now) ?? '', /válidos/);
});

test('rótulos de todos os estados; nada sugere publicação sem confirmação', () => {
  for (const [state, meta] of Object.entries(PUBLICATION_STATE_META)) {
    assert.ok(meta.label && meta.help, state);
    if (state !== 'PUBLISHED') assert.ok(!/^Publicado/.test(meta.label), state);
  }
  assert.equal(PUBLICATION_STATE_META.PENDING.label, 'Aguardando envio');
  assert.match(PUBLICATION_STATE_META.PROVIDER_RETRY.help, /bloqueado/);
});

test('registrado no Hub x enviado ao Instagram', () => {
  assert.match(deliveryNote({ state: 'PENDING', sentToProvider: false, cancelRequestedAt: null }, false), /não está ativo/);
  assert.match(deliveryNote({ state: 'PENDING', sentToProvider: false, cancelRequestedAt: null }, true), /automaticamente/);
  assert.match(deliveryNote({ state: 'SCHEDULED', sentToProvider: true, cancelRequestedAt: null }, true), /Enviado ao provedor/);
  assert.match(deliveryNote({ state: 'SCHEDULED', sentToProvider: true, cancelRequestedAt: '2026-10-20T10:00:00Z' }, true), /Cancelamento solicitado/);
  assert.match(deliveryNote({ state: 'CANCELLED', sentToProvider: false, cancelRequestedAt: 'x' }, false), /Não foi enviado/);
  assert.match(deliveryNote({ state: 'PUBLISHED', sentToProvider: true, cancelRequestedAt: null }, true), /Publicado/);
});

test('link da publicação só em https', () => {
  assert.equal(safeHttpsUrl('https://www.instagram.com/p/abc/'), 'https://www.instagram.com/p/abc/');
  assert.equal(safeHttpsUrl('http://x.test/p'), null);
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl(null), null);
});

test('formatação e sugestão no fuso da organização', () => {
  assert.equal(formatInZone('2026-10-20T17:00:00Z', 'America/Sao_Paulo'), '20/10/2026, 14:00');
  assert.equal(formatInZone(null, 'UTC'), '—');
  assert.deepEqual(suggestedSchedule('America/Sao_Paulo', new Date('2026-10-20T02:00:00Z')), { date: '2026-10-20', time: '10:00' });
});

// F8-5c (DEC-F8-029): desempenho com ausencia != zero.
test('metrica ausente nunca vira zero; zero coletado continua zero; engajamento em %', () => {
  assert.equal(formatMetric('reach', null), '—');
  assert.equal(formatMetric('reach', undefined), '—');
  assert.equal(formatMetric('reach', 0), '0');
  assert.equal(formatMetric('reach', 12345), '12.345');
  assert.equal(formatMetric('engagementPct', 3.25), '3,25%');
  assert.equal(formatMetric('engagementPct', null), '—');
});

test('numeros so com coleta registrada (capturedAt)', () => {
  assert.equal(metricsHaveNumbers(null), false);
  assert.equal(metricsHaveNumbers({ latest: null }), false);
  const snap = { capturedAt: '2026-10-14T03:00:00Z', fetchedAt: '2026-10-14T04:00:00Z', reach: 0, views: 0, likes: 0, comments: 0, saves: 0, shares: 0, engagementPct: 0 };
  assert.equal(metricsHaveNumbers({ latest: snap }), true);
});

test('situacoes de metricas: aguardando explica que nao ha zero; todas com texto', () => {
  for (const [k, m] of Object.entries(METRICS_STATUS_META)) assert.ok(m.label && m.help, k);
  assert.match(METRICS_STATUS_META.AWAITING_COLLECTION.help, /nenhum zero/);
  assert.equal(METRIC_FIELDS.length, 7);
});
