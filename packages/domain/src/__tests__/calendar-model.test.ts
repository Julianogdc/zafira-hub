import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCalendarCondition,
  eventEligibility,
  MASKED_EVENT_TITLE,
  backoffDelayMs,
  computeSyncWindow,
  decideEventAccess,
  isActiveAppointment,
  mapGoogleEvent,
  maskCalendarEvent,
  reconcileWindow,
  resolveWindowConfig,
  updatedMinFromCursor,
  type LocalEventForReconcile,
} from '../calendar/calendar-model.js';

const hasher = (e: string) => `h(${e})`;
// hasher que nao embute o texto (como o HMAC real)
const opaque = (e: string) => `x${[...e].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000003, 7)}`;

test('mapeamento: evento com horario, fuso e participantes sem guardar e-mails', () => {
  const e = mapGoogleEvent(
    {
      id: 'abc_123',
      status: 'confirmed',
      summary: 'Kickoff',
      location: 'Sala 1',
      htmlLink: 'https://calendar.google.com/event?eid=x',
      start: { dateTime: '2026-10-13T14:00:00-03:00', timeZone: 'America/Sao_Paulo' },
      end: { dateTime: '2026-10-13T15:00:00-03:00' },
      updated: '2026-10-12T10:00:00.000Z',
      organizer: { email: 'Org@Zafira.test' },
      attendees: [{ email: 'Ana@Zafira.test' }, { email: 'sala@resource.test', resource: true }],
    },
    opaque
  )!;
  assert.equal(e.googleEventId, 'abc_123');
  assert.equal(e.isAllDay, false);
  assert.equal(e.startAt?.toISOString(), '2026-10-13T17:00:00.000Z');
  assert.equal(e.timeZone, 'America/Sao_Paulo');
  assert.deepEqual(e.attendeeHashes, [opaque('ana@zafira.test'), opaque('org@zafira.test')].sort());
  assert.equal(e.attendeeCount, 2);
  assert.ok(!JSON.stringify(e).includes('@'), 'nenhum e-mail no registro');
});

test('mapeamento: dia inteiro, recorrencia com IDs reais e cancelado sem horario', () => {
  const allDay = mapGoogleEvent({ id: 'x', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }, hasher)!;
  assert.deepEqual([allDay.isAllDay, allDay.startDate, allDay.endDate, allDay.startAt], [true, '2026-10-20', '2026-10-21', null]);
  // o ID da ocorrencia e opaco: nada e decomposto ou reconstruido
  const inst = mapGoogleEvent(
    {
      id: 'qualquer-formato-opaco',
      recurringEventId: 'serie-123',
      originalStartTime: { dateTime: '2026-10-14T09:00:00-03:00', timeZone: 'America/Sao_Paulo' },
      start: { dateTime: '2026-10-14T10:00:00-03:00' },
      end: { dateTime: '2026-10-14T11:00:00-03:00' },
    },
    hasher
  )!;
  assert.equal(inst.googleEventId, 'qualquer-formato-opaco');
  assert.equal(inst.recurringEventId, 'serie-123');
  assert.equal(inst.originalStartDateTime, '2026-10-14T09:00:00-03:00');
  const cancelled = mapGoogleEvent({ id: 'c1', status: 'cancelled', recurringEventId: 'serie-123' }, hasher)!;
  assert.deepEqual([cancelled.status, cancelled.hasTiming, cancelled.title], ['CANCELLED', false, '']);
  assert.equal(mapGoogleEvent({ summary: 'sem id' }, hasher), null);
});

test('janela e cursor: padrao -30/+180, configuravel e limitado; updatedMin com sobreposicao', () => {
  assert.deepEqual(resolveWindowConfig(null), { pastDays: 30, futureDays: 180 });
  assert.deepEqual(resolveWindowConfig({ windowPastDays: 7, windowFutureDays: 400 }), { pastDays: 7, futureDays: 180 });
  const now = new Date('2026-10-12T12:00:00Z');
  const w = computeSyncWindow(now, 30, 180);
  assert.equal(w.timeMin.toISOString(), '2026-09-12T12:00:00.000Z');
  assert.equal(w.timeMax.toISOString(), '2027-04-10T12:00:00.000Z');
  assert.equal(updatedMinFromCursor(null), null);
  assert.equal(updatedMinFromCursor(new Date('2026-10-12T12:00:00Z'))?.toISOString(), '2026-10-12T11:55:00.000Z');
});

test('backoff exponencial com jitter limitado', () => {
  assert.ok(backoffDelayMs(0, () => 0) >= 250);
  assert.ok(backoffDelayMs(10, () => 1) <= 8000);
  assert.ok(backoffDelayMs(2, () => 0) > backoffDelayMs(0, () => 0));
});

test('reconciliacao: ausente dentro da janela e marcado; fora da janela e cancelado nao; reaparecido limpa', () => {
  const win = { timeMin: new Date('2026-09-12T00:00:00Z'), timeMax: new Date('2027-04-10T00:00:00Z') };
  const base = { endAt: null, startDate: null, endDate: null, missingFromSourceAt: null, status: 'CONFIRMED' as const };
  const local: LocalEventForReconcile[] = [
    { ...base, id: 'seen', googleEventId: 'g1', startAt: new Date('2026-10-15T10:00:00Z') },
    { ...base, id: 'gone', googleEventId: 'g2', startAt: new Date('2026-10-16T10:00:00Z') },
    { ...base, id: 'old', googleEventId: 'g3', startAt: new Date('2026-01-10T10:00:00Z') },
    { ...base, id: 'cancelled', googleEventId: 'g4', startAt: new Date('2026-10-17T10:00:00Z'), status: 'CANCELLED' },
    { ...base, id: 'back', googleEventId: 'g5', startAt: new Date('2026-10-18T10:00:00Z'), missingFromSourceAt: new Date('2026-10-01T00:00:00Z') },
    { ...base, id: 'allday', googleEventId: 'g6', startAt: null, startDate: '2026-10-19', endDate: '2026-10-20' },
  ];
  const r = reconcileWindow(local, new Set(['g1', 'g5']), win);
  assert.deepEqual(r.markMissing.sort(), ['allday', 'gone']);
  assert.deepEqual(r.clearMissing, ['back']);
});

test('compromisso ativo exclui cancelado e ausente da origem', () => {
  assert.equal(isActiveAppointment({ status: 'CONFIRMED', missingFromSourceAt: null }), true);
  assert.equal(isActiveAppointment({ status: 'CANCELLED', missingFromSourceAt: null }), false);
  assert.equal(isActiveAppointment({ status: 'TENTATIVE', missingFromSourceAt: new Date() }), false);
});

test('visibilidade: sem cliente nao e da agencia; carteira; participante; view_all nao revela privado', () => {
  const base = { googleVisibility: 'default' as const, isParticipant: false, linkedClientId: null, clientInScope: false, hasViewAll: false };
  assert.deepEqual(decideEventAccess(base), { visible: false, masked: false });
  assert.deepEqual(decideEventAccess({ ...base, linkedClientId: 'c1', clientInScope: true }), { visible: true, masked: false });
  assert.equal(decideEventAccess({ ...base, linkedClientId: 'c2', clientInScope: false }).visible, false);
  assert.deepEqual(decideEventAccess({ ...base, isParticipant: true }), { visible: true, masked: false });
  // view_all lista, mas nao revela o privado
  assert.deepEqual(decideEventAccess({ ...base, hasViewAll: true, googleVisibility: 'private' }), { visible: true, masked: true });
  assert.deepEqual(decideEventAccess({ ...base, hasViewAll: true, googleVisibility: 'confidential' }), { visible: true, masked: true });
  // participante ve o privado inteiro; carteira nao participante ve mascarado
  assert.deepEqual(decideEventAccess({ ...base, isParticipant: true, googleVisibility: 'private' }), { visible: true, masked: false });
  assert.deepEqual(decideEventAccess({ ...base, linkedClientId: 'c1', clientInScope: true, googleVisibility: 'private' }), { visible: true, masked: true });
});

test('mascaramento remove titulo, local, link e participantes', () => {
  const m = maskCalendarEvent({ title: 'Reuniao com o diretor', location: 'Sala', htmlLink: 'https://x', attendeeCount: 4, other: 1 });
  assert.deepEqual(m, { title: MASKED_EVENT_TITLE, location: null, htmlLink: null, attendeeCount: 0, other: 1 });
});

test('onboarding por evento: elegibilidade do evento (cancelado, removido, calendario desmarcado)', () => {
  const ok = { status: 'CONFIRMED' as const, missingFromSourceAt: null, sourceMonitored: true };
  assert.deepEqual(eventEligibility(ok), { eligible: true });
  assert.deepEqual(eventEligibility({ ...ok, status: 'TENTATIVE' }), { eligible: true });
  assert.deepEqual(eventEligibility({ ...ok, status: 'CANCELLED' }), { eligible: false, reason: 'CANCELLED' });
  assert.deepEqual(eventEligibility({ ...ok, missingFromSourceAt: new Date() }), { eligible: false, reason: 'REMOVED_FROM_SOURCE' });
  assert.deepEqual(eventEligibility({ ...ok, sourceMonitored: false }), { eligible: false, reason: 'SOURCE_NOT_MONITORED' });
});

test('onboarding por evento: estado da condicao (atendida, pendente, indisponivel)', () => {
  assert.deepEqual(evaluateCalendarCondition({ connectionActive: true, monitoredSources: 2, eligibleEvents: 1 }), { state: 'MET', reason: null });
  assert.deepEqual(evaluateCalendarCondition({ connectionActive: true, monitoredSources: 2, eligibleEvents: 0 }), { state: 'PENDING', reason: 'NO_LINKED_EVENT' });
  assert.deepEqual(evaluateCalendarCondition({ connectionActive: false, monitoredSources: 2, eligibleEvents: 5 }), { state: 'UNAVAILABLE', reason: 'CONNECTION_UNAVAILABLE' });
  assert.deepEqual(evaluateCalendarCondition({ connectionActive: true, monitoredSources: 0, eligibleEvents: 0 }), { state: 'UNAVAILABLE', reason: 'NO_MONITORED_CALENDAR' });
});
