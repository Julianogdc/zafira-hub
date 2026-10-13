import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  applyFilters,
  buildMonthGrid,
  buildWeek,
  eventDays,
  freshnessMessage,
  groupByDay,
  monthTitle,
  rangeFor,
  startOfWeek,
} from '../calendar-view';
import type { AgendaEvent } from '../../services/calendar';

const SP = 'America/Sao_Paulo';
const ev = (over: Partial<AgendaEvent>): AgendaEvent => ({
  id: 'e',
  sourceId: 's1',
  sourceName: 'Cal',
  color: null,
  title: 'T',
  isAllDay: false,
  startAt: '2026-10-13T17:00:00.000Z',
  endAt: '2026-10-13T18:00:00.000Z',
  startDate: null,
  endDate: null,
  timeZone: SP,
  status: 'CONFIRMED',
  location: null,
  htmlLink: null,
  attendeeCount: 0,
  isRecurringInstance: false,
  masked: false,
  participant: false,
  link: null,
  ...over,
});

test('grade mensal: domingo a sabado, 6 semanas, dias fora do mes marcados', () => {
  const g = buildMonthGrid('2026-10-15');
  assert.equal(g.length, 42);
  assert.equal(g[0].iso, '2026-09-27'); // 1/10/2026 e quinta; semana comeca no domingo 27/09
  assert.equal(g[0].inMonth, false);
  assert.equal(g.find((c) => c.iso === '2026-10-01')?.inMonth, true);
  assert.equal(g[41].iso, '2026-11-07');
});

test('semana, inicio da semana e navegacao de mes', () => {
  assert.equal(startOfWeek('2026-10-14'), '2026-10-11');
  assert.deepEqual(buildWeek('2026-10-14').map((c) => c.iso), ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
  assert.equal(addMonths('2026-12-20', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-31', -1), '2025-12-01');
  assert.equal(monthTitle('2026-10-01'), 'Outubro de 2026');
  const r = rangeFor('week', '2026-10-14');
  assert.ok(r.from.getTime() < Date.parse('2026-10-11T00:00:00Z') && r.to.getTime() > Date.parse('2026-10-18T00:00:00Z'));
});

test('dias do evento no fuso da organizacao: noite do dia anterior em UTC e dia inteiro com fim exclusivo', () => {
  // 02h UTC de 14/10 = 23h de 13/10 em Sao Paulo
  assert.deepEqual(eventDays(ev({ startAt: '2026-10-14T02:00:00.000Z', endAt: '2026-10-14T02:30:00.000Z' }), SP), ['2026-10-13']);
  assert.deepEqual(eventDays(ev({ isAllDay: true, startAt: null, endAt: null, startDate: '2026-10-20', endDate: '2026-10-22' }), SP), ['2026-10-20', '2026-10-21']);
  // evento que cruza a meia-noite cobre dois dias
  assert.deepEqual(eventDays(ev({ startAt: '2026-10-13T23:00:00.000Z', endAt: '2026-10-14T05:00:00.000Z' }), SP), ['2026-10-13', '2026-10-14']);
  assert.deepEqual(eventDays(ev({ startAt: null, endAt: null }), SP), []);
});

test('agrupamento por dia: dia inteiro primeiro, depois por horario', () => {
  const m = groupByDay(
    [
      ev({ id: 'b', title: 'B', startAt: '2026-10-13T18:00:00.000Z', endAt: '2026-10-13T19:00:00.000Z' }),
      ev({ id: 'a', title: 'A', startAt: '2026-10-13T15:00:00.000Z', endAt: '2026-10-13T16:00:00.000Z' }),
      ev({ id: 'd', isAllDay: true, startAt: null, endAt: null, startDate: '2026-10-13', endDate: '2026-10-14' }),
    ],
    SP
  );
  assert.deepEqual(m.get('2026-10-13')!.map((e) => e.id), ['d', 'a', 'b']);
});

test('filtros por calendario, categoria e cliente', () => {
  const withLink = (id: string, clientId: string | null, category: 'MEETING' | 'CAPTURE') =>
    ev({ id, sourceId: id === 'x' ? 's2' : 's1', link: { scope: 'EVENT', clientId, category, asanaProjectGid: null, notes: null } });
  const list = [withLink('a', 'c1', 'MEETING'), withLink('b', 'c2', 'CAPTURE'), withLink('x', null, 'MEETING'), ev({ id: 'n' })];
  assert.deepEqual(applyFilters(list, { sourceId: 's2' }).map((e) => e.id), ['x']);
  assert.deepEqual(applyFilters(list, { clientId: 'c1' }).map((e) => e.id), ['a']);
  assert.deepEqual(applyFilters(list, { category: 'CAPTURE' }).map((e) => e.id), ['b']);
  assert.deepEqual(applyFilters(list, { category: 'NONE' }).map((e) => e.id), ['n']);
});

test('frescor: revogada, nunca lida, desatualizada e normal nunca se apresentam como tempo real', () => {
  const base = { connected: true, requiresReconnect: false, monitoredCalendars: 2, lastSyncedAt: '2026-10-13T12:00:00.000Z', stale: false, neverSynced: false };
  assert.equal(freshnessMessage({ ...base, requiresReconnect: true }, SP).kind, 'danger');
  assert.equal(freshnessMessage({ ...base, neverSynced: true, lastSyncedAt: null }, SP).kind, 'warn');
  const stale = freshnessMessage({ ...base, stale: true }, SP);
  assert.equal(stale.kind, 'warn');
  assert.match(stale.text, /desatualizada/);
  assert.match(stale.text, /não são em tempo real/);
  const ok = freshnessMessage(base, SP);
  assert.equal(ok.kind, 'info');
  assert.match(ok.text, /não em tempo real/);
  assert.equal(freshnessMessage({ ...base, connected: false }, SP).kind, 'none');
});
