import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT_OPTIONS, allowedKinds, contentEventLabel, formatBytes, formatLabel, localFileProblem, mediaLimits, previewAspect } from '../content-view';

test('formatos canonicos sem formato separado de video de feed (F8-1)', () => {
  assert.deepEqual(FORMAT_OPTIONS.map((o) => o.value), ['FEED_IMAGE', 'CAROUSEL', 'REEL', 'STORY']);
  assert.equal(formatLabel('REEL'), 'Reel');
});

test('limites e tipos por formato', () => {
  assert.deepEqual(mediaLimits('CAROUSEL'), { min: 2, max: 10 });
  assert.deepEqual(mediaLimits('STORY'), { min: 1, max: 1 });
  assert.deepEqual(allowedKinds('FEED_IMAGE'), ['IMAGE']);
  assert.deepEqual(allowedKinds('REEL'), ['VIDEO']);
  assert.deepEqual(allowedKinds('STORY'), ['IMAGE', 'VIDEO']);
});

test('aviso local de tamanho e rotulos', () => {
  assert.equal(localFileProblem({ size: 0 }) !== null, true);
  assert.equal(localFileProblem({ size: 100 * 1024 * 1024 + 1 }) !== null, true);
  assert.equal(localFileProblem({ size: 1024 }), null);
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(contentEventLabel('MEDIA_REPLACED'), 'Arquivo substituído');
  assert.equal(contentEventLabel('X'), 'X');
  assert.equal(previewAspect('STORY'), '9 / 16');
});

import { APPROVAL_STATUS, CHANNEL_LABEL, approvalUrl, clampDays, truncateCaption } from '../content-view';

test('status de aprovacao: todos rotulados; revogado/expirado pedem novo link (F8-2)', () => {
  for (const s of ['NOT_SENT', 'AWAITING_CLIENT', 'APPROVED', 'CHANGES_REQUESTED', 'LINK_EXPIRED', 'LINK_REVOKED'] as const) {
    assert.ok(APPROVAL_STATUS[s].label.length > 0);
  }
  assert.match(APPROVAL_STATUS.LINK_EXPIRED.help, /novo link/);
  assert.equal(CHANNEL_LABEL.WHATSAPP, 'WhatsApp');
});

test('link de aprovacao usa fragmento (#) e validade fica entre 1 e 30 dias', () => {
  assert.equal(approvalUrl('https://hub.exemplo/', '/aprovacao#abc'), 'https://hub.exemplo/aprovacao#abc');
  assert.equal(clampDays(90), 30);
  assert.equal(clampDays(0), 1);
  assert.equal(clampDays(Number.NaN), 7);
});

test('legenda truncada como no feed, sem cortar palavra quando possivel', () => {
  assert.deepEqual(truncateCaption('curta', 125), { text: 'curta', truncated: false });
  const long = 'palavra '.repeat(40);
  const r = truncateCaption(long, 50);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= 50);
  assert.ok(!r.text.endsWith(' '));
});
