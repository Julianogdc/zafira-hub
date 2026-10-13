import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_PERIOD_PATTERN,
  contentPeriodOf,
  contentStageOf,
  countContentStages,
  publishedRatio,
} from '../index.js';

// F8-3 (DEC-F8-007): contador de Entregas por estagio, derivado dos registros reais.

const T = '2026-10-10T12:00:00.000Z';

test('estagio: o mais alto alcancado; sem arquivo nem envio = null', () => {
  assert.equal(contentStageOf({ receivedAt: null, sentAt: null, approvedAt: null }), null);
  assert.equal(contentStageOf({ receivedAt: T, sentAt: null, approvedAt: null }), 'RECEIVED');
  assert.equal(contentStageOf({ receivedAt: T, sentAt: T, approvedAt: null }), 'SENT');
  assert.equal(contentStageOf({ receivedAt: T, sentAt: T, approvedAt: T }), 'APPROVED');
});

test('alteracao pedida na v1 e v2 aprovada: uma peca em cada estagio (sem duplicidade por versao)', () => {
  // Datas minimas por conteudo: a derivacao trabalha por peca, nao por versao.
  const peca = contentStageOf({ receivedAt: T, sentAt: T, approvedAt: '2026-10-12T10:00:00.000Z' });
  assert.deepEqual(countContentStages([peca]), {
    received: 1,
    sent: 1,
    approved: 1,
    published: null,
    publishedSource: 'NOT_INTEGRATED',
  });
});

test('contagem cumulativa e monotonica: recebidos >= enviados >= aprovados', () => {
  const c = countContentStages(['RECEIVED', 'SENT', 'APPROVED', 'APPROVED', null, 'SENT']);
  assert.equal(c.received, 5);
  assert.equal(c.sent, 4);
  assert.equal(c.approved, 2);
  assert.ok(c.received >= c.sent && c.sent >= c.approved);
});

test('publicados: sempre null (NOT_INTEGRATED), nunca 0; barra sem percentual', () => {
  const vazio = countContentStages([]);
  assert.equal(vazio.received, 0);
  assert.equal(vazio.published, null);
  assert.notEqual(vazio.published, 0);
  assert.equal(publishedRatio(vazio), null);
  assert.equal(publishedRatio(countContentStages(['APPROVED'])), null);
});

test('barra: proporcao limitada entre 0 e 1 quando houver dado confiavel e recebidos > 0', () => {
  const comDado = { received: 4, published: 1 } as unknown as Parameters<typeof publishedRatio>[0];
  assert.equal(publishedRatio(comDado), 0.25);
  assert.equal(publishedRatio({ received: 0, published: 0 } as unknown as Parameters<typeof publishedRatio>[0]), null);
});

test('competencia D1: plano da peca vinculada; sem vinculo, mes do primeiro arquivo no fuso da organizacao', () => {
  assert.deepEqual(contentPeriodOf({ linkedPlanPeriod: '2026-09', receivedAt: T }, 'America/Sao_Paulo'), {
    period: '2026-09',
    source: 'PLAN',
  });
  // 01/11 02:00 UTC ainda e 31/10 em Sao Paulo
  assert.deepEqual(contentPeriodOf({ linkedPlanPeriod: null, receivedAt: '2026-11-01T02:00:00.000Z' }, 'America/Sao_Paulo'), {
    period: '2026-10',
    source: 'FIRST_FILE',
  });
  assert.deepEqual(contentPeriodOf({ linkedPlanPeriod: null, receivedAt: '2026-11-01T02:00:00.000Z' }, 'UTC'), {
    period: '2026-11',
    source: 'FIRST_FILE',
  });
  assert.equal(contentPeriodOf({ linkedPlanPeriod: null, receivedAt: null }, 'America/Sao_Paulo'), null);
});

test('formato da competencia', () => {
  assert.ok(CONTENT_PERIOD_PATTERN.test('2026-10'));
  for (const bad of ['2026-13', '2026-1', '26-10', '2026-10-01', '']) assert.ok(!CONTENT_PERIOD_PATTERN.test(bad));
});
