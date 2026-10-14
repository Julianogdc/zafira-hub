/**
 * F8-4b (DEC-F8-027) - Apresentação do agendamento no Instagram (somente o que a tela precisa; sem rede).
 * Distingue "registrado no Hub" de "enviado ao Instagram" e nunca sugere publicação que não aconteceu.
 */

export type PublicationState =
  | 'PENDING'
  | 'DRAFTED'
  | 'SCHEDULED'
  | 'PROVIDER_RETRY'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED'
  | 'AMBIGUOUS';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const PUBLICATION_STATE_META: Record<PublicationState, { label: string; tone: Tone; help: string }> = {
  PENDING: { label: 'Aguardando envio', tone: 'neutral', help: 'Registrado no Hub. Ainda não foi enviado ao Instagram.' },
  DRAFTED: { label: 'Preparado no Instagram', tone: 'info', help: 'Enviado ao provedor como rascunho; o agendamento ainda vai ser confirmado.' },
  SCHEDULED: { label: 'Agendado no Instagram', tone: 'info', help: 'O provedor confirmou o agendamento para o horário indicado.' },
  PROVIDER_RETRY: { label: 'Nova tentativa automática', tone: 'warning', help: 'O provedor está tentando publicar de novo. Aguarde: reagendar ou cancelar fica bloqueado até resolver.' },
  PUBLISHING: { label: 'Publicando', tone: 'warning', help: 'A publicação começou. Não é mais possível reagendar nem cancelar.' },
  PUBLISHED: { label: 'Publicado', tone: 'success', help: 'Publicado no Instagram.' },
  FAILED: { label: 'Falhou', tone: 'danger', help: 'A publicação não foi concluída. É possível agendar de novo.' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral', help: 'Agendamento cancelado.' },
  AMBIGUOUS: { label: 'Em conferência', tone: 'warning', help: 'Sem confirmação do provedor. O Hub está conferindo o estado antes de qualquer ação.' },
};

export interface PublicationView {
  id: string;
  versionNumber: number | null;
  socialAccountId: string;
  platform: string;
  state: PublicationState;
  scheduledAt: string;
  sentToProvider: boolean;
  actions: { reschedule: boolean; cancel: boolean };
  permalink: string | null;
  publishedAt: string | null;
  failureMessage: string | null;
  cancelRequestedAt: string | null;
}

/** Selo do envio: o que foi só registrado no Hub x o que já está no Instagram. */
export function deliveryNote(p: Pick<PublicationView, 'state' | 'sentToProvider' | 'cancelRequestedAt'>, dispatchEnabled: boolean): string {
  if (p.cancelRequestedAt && p.state !== 'CANCELLED') return 'Cancelamento solicitado — aguardando confirmação do provedor.';
  if (p.state === 'PUBLISHED') return 'Publicado no Instagram.';
  if (p.state === 'CANCELLED' || p.state === 'FAILED') return p.sentToProvider ? 'Chegou a ser enviado ao provedor.' : 'Não foi enviado ao Instagram.';
  if (!p.sentToProvider) return dispatchEnabled ? 'Registrado no Hub; o envio ao Instagram será feito automaticamente.' : 'Registrado no Hub. O envio ao Instagram não está ativo neste ambiente.';
  return 'Enviado ao provedor de publicação.';
}

/** Só https; qualquer outra coisa não vira link. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function partsInZone(ms: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Deslocamento (min) do fuso naquele instante. */
function offsetMinutes(ms: number, timeZone: string): number {
  const p = partsInZone(ms, timeZone);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * Data (AAAA-MM-DD) e hora (HH:mm) digitadas no fuso da organização -> ISO com deslocamento explícito
 * (ex.: 2026-10-20T14:00:00-03:00). Correto em mudança de horário de verão.
 */
export function toOffsetIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let off = offsetMinutes(naive, timeZone);
  off = offsetMinutes(naive - off * 60000, timeZone); // segunda passada acerta a fronteira do horario de verao
  const ms = naive - off * 60000;
  const back = partsInZone(ms, timeZone);
  if (back.y !== y || back.mo !== mo || back.d !== d || back.h !== h || back.mi !== mi) return null; // horario inexistente
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Validação antes do envio (o servidor valida de novo). */
export function scheduleProblem(iso: string | null, minLeadMinutes: number, now: Date = new Date()): string | null {
  if (!iso) return 'Informe uma data e um horário válidos.';
  if (new Date(iso).getTime() < now.getTime() + minLeadMinutes * 60_000) return `Escolha um horário com pelo menos ${minLeadMinutes} minutos de antecedência.`;
  return null;
}

/** Exibe um instante no fuso da organização (dd/mm/aaaa hh:mm). */
export function formatInZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);
}

/** Data e hora sugeridas (amanhã, 10:00, no fuso da organização) para preencher o formulário. */
export function suggestedSchedule(timeZone: string, now: Date = new Date()): { date: string; time: string } {
  const p = partsInZone(now.getTime() + 24 * 3600_000, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: '10:00' };
}
