import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTAGRAM_DAILY_CAP,
  canCancelPublication,
  canReschedulePublication,
  checkDailyCap,
  checkScheduleLead,
  draftIdempotencyKey,
  isActivePublication,
  isPilotPlatform,
  mapRemoteState,
  mediaUploadIdempotencyKey,
  parseScheduledAt,
  validatePublicationContent,
} from '../index.js';

// F8-4a (DEC-F8-023): regras puras de publicacao pela versao aprovada.

const img = (sizeBytes = 1000, mimeType = 'image/jpeg') => ({ kind: 'IMAGE' as const, mimeType, sizeBytes });
const vid = (sizeBytes = 1000) => ({ kind: 'VIDEO' as const, mimeType: 'video/mp4', sizeBytes });
const codes = (p: { code: string }[]) => p.map((x) => x.code);

test('horario exige fuso explicito (D-F84-2)', () => {
  assert.equal(parseScheduledAt('2026-10-20T14:00:00-03:00').ok, true);
  assert.equal(parseScheduledAt('2026-10-20T17:00:00Z').ok, true);
  for (const bad of ['2026-10-20T14:00:00', '2026-10-20', 'amanha', 123, null]) {
    const r = parseScheduledAt(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.problem.code, 'SCHEDULE_TIMEZONE_REQUIRED');
  }
  const r = parseScheduledAt('2026-10-20T14:00:00-03:00');
  assert.ok(r.ok && r.at.toISOString() === '2026-10-20T17:00:00.000Z');
});

test('antecedencia minima de 5 minutos', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.equal(checkScheduleLead(new Date('2026-10-20T12:04:59Z'), now)?.code, 'SCHEDULE_TOO_SOON');
  assert.equal(checkScheduleLead(new Date('2026-10-20T11:00:00Z'), now)?.code, 'SCHEDULE_TOO_SOON');
  assert.equal(checkScheduleLead(new Date('2026-10-20T12:05:00Z'), now), null);
});

test('piloto somente Instagram (D-F84-4)', () => {
  assert.ok(isPilotPlatform('instagram') && isPilotPlatform('instagram_login') && isPilotPlatform('INSTAGRAM'));
  for (const p of ['facebook', 'linkedin', 'tiktok', '', null, undefined, 'instagram-business']) assert.equal(isPilotPlatform(p), false);
});

test('validacoes que o provedor nao faz: carrossel 2-10, story 1, reel 1 video, legenda', () => {
  assert.deepEqual(validatePublicationContent({ format: 'FEED_IMAGE', media: [img()], caption: 'ok' }), []);
  assert.deepEqual(codes(validatePublicationContent({ format: 'CAROUSEL', media: Array(11).fill(img()), caption: '' })), ['MEDIA_COUNT_INVALID']);
  assert.deepEqual(codes(validatePublicationContent({ format: 'CAROUSEL', media: [img()], caption: '' })), ['MEDIA_COUNT_INVALID']);
  assert.deepEqual(validatePublicationContent({ format: 'CAROUSEL', media: Array(10).fill(img()), caption: '' }), []);
  assert.deepEqual(codes(validatePublicationContent({ format: 'STORY', media: [img(), img()], caption: '' })), ['MEDIA_COUNT_INVALID']);
  assert.deepEqual(codes(validatePublicationContent({ format: 'REEL', media: [img()], caption: '' })), ['MEDIA_KIND_INVALID']);
  assert.deepEqual(validatePublicationContent({ format: 'REEL', media: [vid()], caption: '' }), []);
  assert.deepEqual(codes(validatePublicationContent({ format: 'FEED_IMAGE', media: [img()], caption: 'x'.repeat(2201) })), ['CAPTION_TOO_LONG']);
  assert.deepEqual(validatePublicationContent({ format: 'FEED_IMAGE', media: [img()], caption: 'x'.repeat(2200) }), []);
  assert.deepEqual(codes(validatePublicationContent({ format: 'FEED_IMAGE', media: [img()], caption: 'x'.repeat(101), captionLimit: 100 })), ['CAPTION_TOO_LONG']);
});

test('limites de arquivo e tipos publicaveis (MOV ainda nao verificado)', () => {
  assert.deepEqual(codes(validatePublicationContent({ format: 'FEED_IMAGE', media: [img(20 * 1024 * 1024 + 1)], caption: '' })), ['MEDIA_TOO_LARGE']);
  assert.deepEqual(codes(validatePublicationContent({ format: 'REEL', media: [{ kind: 'VIDEO', mimeType: 'video/quicktime', sizeBytes: 10 }], caption: '' })), ['MEDIA_TYPE_NOT_PUBLISHABLE']);
  assert.deepEqual(validatePublicationContent({ format: 'FEED_IMAGE', media: [img(10, 'image/webp')], caption: '' }), []);
});

test('teto diario do Instagram', () => {
  assert.equal(checkDailyCap(INSTAGRAM_DAILY_CAP - 1), null);
  assert.equal(checkDailyCap(INSTAGRAM_DAILY_CAP)?.code, 'DAILY_CAP_REACHED');
});

test('depois de PUBLISHING: sem reagendar nem cancelar (D-F84-3); AMBIGUOUS e retentativa do provedor bloqueiam (DEC-F8-027)', () => {
  for (const s of ['PENDING', 'DRAFTED', 'SCHEDULED'] as const) assert.ok(canReschedulePublication(s) && canCancelPublication(s));
  for (const s of ['PROVIDER_RETRY', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'AMBIGUOUS'] as const) {
    assert.equal(canReschedulePublication(s), false);
    assert.equal(canCancelPublication(s), false);
  }
  assert.equal(isActivePublication('FAILED'), false);
  assert.equal(isActivePublication('CANCELLED'), false);
  assert.equal(isActivePublication('SCHEDULED'), true);
});

test('mapeamento do estado do provedor falha fechado', () => {
  assert.equal(mapRemoteState({ status: 'draft' }, 'PENDING'), 'DRAFTED');
  assert.equal(mapRemoteState({ status: 'scheduled' }, 'DRAFTED'), 'SCHEDULED');
  assert.equal(mapRemoteState({ status: 'scheduled' }, 'PUBLISHING'), 'PROVIDER_RETRY');
  assert.equal(mapRemoteState({ status: 'published' }, 'PUBLISHING'), 'PUBLISHING', 'sem published_at/platform_post_id nao e publicado');
  assert.equal(mapRemoteState({ status: 'published', publishedAt: 'x', platformPostId: 'y' }, 'PUBLISHING'), 'PUBLISHED');
  assert.equal(mapRemoteState({ status: 'failed' }, 'PUBLISHING'), 'FAILED');
  assert.equal(mapRemoteState({ status: 'pending_review' }, 'SCHEDULED'), 'AMBIGUOUS');
  assert.equal(mapRemoteState({ status: null }, 'SCHEDULED'), 'AMBIGUOUS');
});

test('chaves de idempotencia estaveis', () => {
  const sha = 'a'.repeat(64);
  assert.equal(mediaUploadIdempotencyKey(sha, 'acc-1'), mediaUploadIdempotencyKey(sha, 'acc-1'));
  assert.notEqual(mediaUploadIdempotencyKey(sha, 'acc-1'), mediaUploadIdempotencyKey('b'.repeat(64), 'acc-1'));
  assert.ok(mediaUploadIdempotencyKey(sha, 'acc-1').length <= 128);
  assert.equal(draftIdempotencyKey('p1'), 'hub-draft-p1');
});
