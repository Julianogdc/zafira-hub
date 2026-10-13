import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  type CalendarEventCategoryValue,
  CALENDAR_EVENT_CATEGORIES,
  type RoleType,
  computeSyncWindow,
  decideEventAccess,
  isActiveAppointment,
  mapGoogleEvent,
  maskCalendarEvent,
  normalizeEmail,
  reconcileWindow,
  resolveWindowConfig,
  updatedMinFromCursor,
} from '@zafira/domain';
import { prisma } from '../../../lib/prisma.js';
import { acquireLease, releaseLease } from '../../../lib/scheduler-lease.js';
import { createAndPersistOAuthState, verifyAndConsumeOAuthState } from '../../../lib/oauthState.js';
import { decryptIntegrationCredential } from '../../../lib/crypto.js';
import { AuditService } from '../../audit/audit.service.js';
import { buildClientResourceScopeWhere, findClientInResourceScope } from '../../authorization/client-resource-scope.js';
import { integrationConnectionService } from '../connections/integration-connection.service.js';
import {
  GOOGLE_SCOPES,
  GoogleCalendarClient,
  GoogleCalendarError,
  googleConfig,
} from './google-calendar.client.js';

/**
 * F7-3a - Agenda Google Calendar (SOMENTE LEITURA) - DEC-F7-011/012.
 * Reutiliza IntegrationConnection (credencial cifrada), SyncRun, IntegrationError e scheduler_leases.
 * Nenhuma escrita no Google; dados minimos; mascaramento e carteira decididos aqui, no servidor.
 */

export class CalendarError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'CalendarError';
  }
}

export interface CalendarContext {
  organizationId: string;
  userId: string;
  membershipId: string;
  role: RoleType;
}

const PROVIDER = 'GOOGLE_CALENDAR' as const;
const DAY_MS = 86_400_000;
const RECONCILE_EVERY_MS = DAY_MS;
const LEASE_TTL_MS = 10 * 60_000;

/** HMAC protegido por chave de ambiente. Sem chave, o recurso de participantes fica desativado. */
export function identityHasher(organizationId: string): ((normalizedEmail: string) => string) | null {
  const key = process.env.CALENDAR_IDENTITY_HMAC_KEY?.trim();
  if (!key || key.length < 16) return null;
  return (email: string) => createHmac('sha256', key).update(`${organizationId}:${normalizeEmail(email)}`).digest('hex');
}

const maskEmail = (email: string) => {
  const [user = '', domain = ''] = normalizeEmail(email).split('@');
  return `${user.slice(0, 1)}***@${domain}`;
};

const dayToDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const safeMessage = (error: unknown) =>
  error instanceof GoogleCalendarError ? error.message : 'Falha inesperada na sincronizacao da agenda.';

type EventRow = Prisma.CalendarEventGetPayload<Record<string, never>>;

export class GoogleCalendarService {
  constructor(private readonly client: GoogleCalendarClient = new GoogleCalendarClient()) {}

  /* ------------------------------ conexao ------------------------------ */

  private async connectionOf(organizationId: string) {
    return prisma.integrationConnection.findFirst({
      where: { organizationId, provider: PROVIDER, clientId: null },
    });
  }

  async connectionStatus(ctx: CalendarContext) {
    const conn = await this.connectionOf(ctx.organizationId);
    const meta = (conn?.metadata ?? {}) as Record<string, unknown>;
    const window = resolveWindowConfig(meta as { windowPastDays?: unknown; windowFutureDays?: unknown });
    return {
      configured: Boolean(googleConfig.oauth()),
      identityKeyConfigured: Boolean(identityHasher(ctx.organizationId)),
      connected: Boolean(conn && conn.status === 'ACTIVE'),
      status: conn?.status ?? 'DISCONNECTED',
      requiresReconnect: conn?.status === 'ERROR' || meta.requiresReconnect === true,
      accountHint: conn?.displayName ?? null,
      lastValidatedAt: conn?.lastValidatedAt?.toISOString() ?? null,
      windowPastDays: window.pastDays,
      windowFutureDays: window.futureDays,
    };
  }

  /** PKCE: o verificador e derivado do nonce com segredo do servidor (nao precisa ser armazenado). */
  private verifierFor(nonce: string): string {
    const secret = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.JWT_SECRET || 'zafira-calendar-pkce';
    return createHmac('sha256', secret).update(`pkce:${nonce}`).digest('base64url');
  }

  async authorizeUrl(ctx: CalendarContext) {
    const cfg = googleConfig.oauth();
    if (!cfg) throw new CalendarError(503, 'NOT_CONFIGURED', 'A integracao com o Google nao esta configurada neste ambiente.');
    const { stateParam, nonce } = await createAndPersistOAuthState(prisma as never, ctx.organizationId, ctx.userId, PROVIDER);
    const challenge = createHash('sha256').update(this.verifierFor(nonce)).digest('base64url');
    const url = new URL(googleConfig.authUrl());
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', cfg.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', stateParam);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { url: url.toString() };
  }

  /** Callback publico: validado por state assinado, de uso unico e vinculado a organizacao/usuario. */
  async handleCallback(code: string, state: string) {
    let organizationId: string;
    let userId: string;
    let nonce: string;
    try {
      const payloadB64 = state.split('.')[0] ?? '';
      nonce = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')).nonce;
      ({ organizationId, userId } = await verifyAndConsumeOAuthState(prisma as never, state, PROVIDER));
    } catch {
      throw new CalendarError(400, 'INVALID_STATE', 'Autorizacao invalida ou expirada. Inicie a conexao novamente.');
    }
    let tokens;
    try {
      tokens = await this.client.exchangeCode(code, this.verifierFor(nonce));
    } catch (error) {
      throw new CalendarError(502, 'TOKEN_EXCHANGE_FAILED', safeMessage(error));
    }
    let sub: string | null = null;
    let hint: string | null = null;
    if (tokens.idToken) {
      try {
        const claims = JSON.parse(Buffer.from(tokens.idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
        sub = typeof claims.sub === 'string' ? claims.sub : null;
        hint = typeof claims.email === 'string' ? maskEmail(claims.email) : null;
      } catch {
        /* identificacao opcional */
      }
    }
    // no maximo uma conexao por organizacao: substitui credencial e reativa
    await integrationConnectionService.upsertConnection({
      organizationId,
      provider: PROVIDER,
      authType: 'OAUTH2',
      externalAccountId: sub,
      displayName: hint,
      rawCredential: { refreshToken: tokens.refreshToken },
      status: 'ACTIVE',
      metadata: {},
    });
    await new AuditService(prisma as never).record({
      organizationId,
      actorUserId: userId,
      action: 'calendar.connection_connected',
      entityType: 'IntegrationConnection',
      entityId: organizationId,
      metadata: { provider: PROVIDER },
    });
    return { organizationId };
  }

  async disconnect(ctx: CalendarContext) {
    const conn = await this.connectionOf(ctx.organizationId);
    if (!conn) throw new CalendarError(404, 'NOT_FOUND', 'Nao ha conta Google conectada.');
    await prisma.$transaction(async (tx) => {
      await tx.integrationConnection.update({
        where: { id: conn.id },
        data: { status: 'DISCONNECTED', credentialCiphertext: null },
      });
      await tx.calendarSource.updateMany({ where: { connectionId: conn.id }, data: { isMonitored: false } });
      await new AuditService(tx as never).record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'calendar.connection_disconnected',
        entityType: 'IntegrationConnection',
        entityId: conn.id,
        metadata: { provider: PROVIDER },
      });
    });
    return this.connectionStatus(ctx);
  }

  async updateSettings(ctx: CalendarContext, input: { windowPastDays?: number; windowFutureDays?: number }) {
    const conn = await this.connectionOf(ctx.organizationId);
    if (!conn) throw new CalendarError(404, 'NOT_FOUND', 'Conecte uma conta Google antes de configurar a janela.');
    const current = resolveWindowConfig(conn.metadata as never);
    const next = resolveWindowConfig({
      windowPastDays: input.windowPastDays ?? current.pastDays,
      windowFutureDays: input.windowFutureDays ?? current.futureDays,
    });
    const meta = { ...((conn.metadata ?? {}) as Record<string, unknown>), windowPastDays: next.pastDays, windowFutureDays: next.futureDays };
    await prisma.integrationConnection.update({ where: { id: conn.id }, data: { metadata: meta as Prisma.InputJsonValue } });
    // janela alterada: forca nova leitura completa na proxima sincronizacao
    await prisma.calendarSource.updateMany({ where: { connectionId: conn.id }, data: { syncCursorAt: null, lastReconciledAt: null } });
    return this.connectionStatus(ctx);
  }

  /**
   * Estado resumido para quem so visualiza a agenda (sem dados de administracao):
   * o usuario ve QUANDO foi a ultima leitura e se esta desatualizada, nunca "tempo real".
   */
  async agendaStatus(ctx: CalendarContext) {
    const conn = await this.connectionOf(ctx.organizationId);
    const sources = await prisma.calendarSource.findMany({
      where: { organizationId: ctx.organizationId, isMonitored: true },
      select: { lastSyncedAt: true, lastError: true },
    });
    const synced = sources.map((s) => s.lastSyncedAt).filter((d): d is Date => Boolean(d));
    const oldest = synced.length === sources.length && synced.length > 0 ? new Date(Math.min(...synced.map((d) => d.getTime()))) : null;
    const meta = (conn?.metadata ?? {}) as Record<string, unknown>;
    return {
      connected: Boolean(conn && conn.status === 'ACTIVE'),
      requiresReconnect: conn?.status === 'ERROR' || meta.requiresReconnect === true,
      monitoredCalendars: sources.length,
      neverSynced: sources.length > 0 && synced.length < sources.length,
      lastSyncedAt: oldest?.toISOString() ?? null,
      hasErrors: sources.some((s) => Boolean(s.lastError)),
      // agenda desatualizada: sem leitura ha mais de 60 min (agendador pode estar desligado)
      stale: oldest ? Date.now() - oldest.getTime() > 60 * 60_000 : sources.length > 0,
    };
  }

  /* ------------------------------ calendarios ------------------------------ */

  private async accessToken(conn: { id: string; organizationId: string; credentialCiphertext: string | null }) {
    if (!conn.credentialCiphertext) throw new GoogleCalendarError('AUTH_REVOKED', 'Conta Google desconectada.');
    let refreshToken: string;
    try {
      refreshToken = JSON.parse(decryptIntegrationCredential(conn.credentialCiphertext)).refreshToken;
    } catch {
      throw new GoogleCalendarError('AUTH_REVOKED', 'Credencial ilegivel. Reconecte a conta.');
    }
    return this.client.refreshAccessToken(refreshToken);
  }

  private async markRequiresReconnect(connectionId: string, organizationId: string, message: string) {
    const conn = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    const meta = { ...((conn?.metadata ?? {}) as Record<string, unknown>), requiresReconnect: true };
    await prisma.integrationConnection.update({
      where: { id: connectionId },
      data: { status: 'ERROR', metadata: meta as Prisma.InputJsonValue },
    });
    await prisma.integrationError.create({
      data: { organizationId, connectionId, provider: PROVIDER, operation: 'calendar.sync', code: 'AUTH_REVOKED', message, retryable: false },
    });
  }

  async discover(ctx: CalendarContext) {
    const conn = await this.connectionOf(ctx.organizationId);
    if (!conn || conn.status !== 'ACTIVE') throw new CalendarError(409, 'NOT_CONNECTED', 'Conecte uma conta Google primeiro.');
    let entries;
    try {
      entries = await this.client.listCalendars(await this.accessToken(conn));
    } catch (error) {
      if (error instanceof GoogleCalendarError && error.kind === 'AUTH_REVOKED') {
        await this.markRequiresReconnect(conn.id, ctx.organizationId, error.message);
        throw new CalendarError(409, 'REQUIRES_RECONNECT', 'A autorizacao do Google foi revogada. Reconecte a conta.');
      }
      throw new CalendarError(502, 'GOOGLE_UNAVAILABLE', safeMessage(error));
    }
    for (const e of entries) {
      await prisma.calendarSource.upsert({
        where: { connectionId_googleCalendarId: { connectionId: conn.id, googleCalendarId: e.id } },
        update: { name: e.summary || e.id, accessRole: e.accessRole, timeZone: e.timeZone ?? null, color: e.backgroundColor ?? null },
        create: {
          organizationId: ctx.organizationId,
          connectionId: conn.id,
          googleCalendarId: e.id,
          name: e.summary || e.id,
          accessRole: e.accessRole,
          timeZone: e.timeZone ?? null,
          color: e.backgroundColor ?? null,
        },
      });
    }
    return this.listSources(ctx);
  }

  async listSources(ctx: CalendarContext) {
    const rows = await prisma.calendarSource.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { name: 'asc' } });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      accessRole: s.accessRole,
      limitedDetails: s.accessRole === 'freeBusyReader',
      timeZone: s.timeZone,
      color: s.color,
      isMonitored: s.isMonitored,
      defaultCategory: s.defaultCategory,
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      lastError: s.lastError,
    }));
  }

  async updateSource(ctx: CalendarContext, id: string, input: { isMonitored?: boolean; defaultCategory?: CalendarEventCategoryValue | null }) {
    const source = await prisma.calendarSource.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!source) throw new CalendarError(404, 'NOT_FOUND', 'Calendario nao encontrado.');
    if (input.defaultCategory && !CALENDAR_EVENT_CATEGORIES.includes(input.defaultCategory)) {
      throw new CalendarError(400, 'INVALID_CATEGORY', 'Categoria invalida.');
    }
    const data: Prisma.CalendarSourceUpdateInput = {};
    if (input.isMonitored !== undefined) {
      data.isMonitored = input.isMonitored;
      // remarcar = nova leitura completa (vinculos locais permanecem)
      if (input.isMonitored && !source.isMonitored) {
        data.syncCursorAt = null;
        data.lastReconciledAt = null;
      }
    }
    if (input.defaultCategory !== undefined) data.defaultCategory = input.defaultCategory;
    await prisma.$transaction(async (tx) => {
      await tx.calendarSource.update({ where: { id }, data });
      await new AuditService(tx as never).record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'calendar.source_updated',
        entityType: 'CalendarSource',
        entityId: id,
        before: { isMonitored: source.isMonitored, defaultCategory: source.defaultCategory } as Prisma.InputJsonValue,
        after: { isMonitored: input.isMonitored ?? source.isMonitored, defaultCategory: input.defaultCategory ?? source.defaultCategory } as Prisma.InputJsonValue,
      });
    });
    return this.listSources(ctx);
  }

  /* ------------------------------ sincronizacao ------------------------------ */

  /**
   * Um ciclo de um calendario: janela movel + updatedMin, paginacao completa, cursor so apos TODAS as paginas,
   * reconciliacao a cada 24 h (ou apos carga/janela alterada). Execucao unica por calendario (lease).
   */
  async syncSource(organizationId: string, sourceId: string, opts: { forceFull?: boolean; now?: Date } = {}) {
    const holder = await acquireLease(`gcal-sync:${sourceId}`, LEASE_TTL_MS);
    if (!holder) return { skipped: 'ALREADY_RUNNING' as const };
    const startedAt = opts.now ?? new Date();
    let runId: string | null = null;
    try {
      const source = await prisma.calendarSource.findFirst({ where: { id: sourceId, organizationId }, include: { connection: true } });
      if (!source || !source.isMonitored) return { skipped: 'NOT_MONITORED' as const };
      if (source.connection.status !== 'ACTIVE') return { skipped: 'NOT_CONNECTED' as const };
      const run = await prisma.syncRun.create({
        data: { organizationId, connectionId: source.connectionId, provider: PROVIDER, operation: 'calendar.sync', metadata: { sourceId } },
      });
      runId = run.id;

      const win = resolveWindowConfig(source.connection.metadata as never);
      const window = computeSyncWindow(startedAt, win.pastDays, win.futureDays);
      const dueReconcile =
        opts.forceFull === true ||
        !source.syncCursorAt ||
        !source.lastReconciledAt ||
        startedAt.getTime() - source.lastReconciledAt.getTime() >= RECONCILE_EVERY_MS;
      const updatedMin = dueReconcile ? null : updatedMinFromCursor(source.syncCursorAt);
      const hasherFn = identityHasher(organizationId);
      const token = await this.accessToken(source.connection);

      const seen = new Set<string>();
      let processed = 0;
      let pageToken: string | undefined;
      do {
        const page = await this.client.listEventsPage(token, source.googleCalendarId, { ...window, updatedMin, pageToken });
        for (const raw of page.items) {
          const ev = mapGoogleEvent(raw, hasherFn ?? (() => ''));
          if (!ev) continue;
          seen.add(ev.googleEventId);
          const hashes = hasherFn ? ev.attendeeHashes.filter(Boolean) : [];
          const base = {
            recurringEventId: ev.recurringEventId,
            originalStartDateTime: ev.originalStartDateTime ? new Date(ev.originalStartDateTime) : null,
            originalStartDate: dayToDate(ev.originalStartDate),
            originalStartTimeZone: ev.originalStartTimeZone,
            iCalUID: ev.iCalUID,
            status: ev.status,
            visibility: ev.visibility,
            googleUpdatedAt: ev.googleUpdatedAt,
            syncedAt: startedAt,
            missingFromSourceAt: null,
          };
          const detail = {
            title: ev.title,
            isAllDay: ev.isAllDay,
            startAt: ev.startAt,
            startDate: dayToDate(ev.startDate),
            endAt: ev.endAt,
            endDate: dayToDate(ev.endDate),
            timeZone: ev.timeZone,
            location: ev.location,
            htmlLink: ev.htmlLink,
            attendeeCount: ev.attendeeCount,
            attendeeHashes: hashes,
          };
          await prisma.calendarEvent.upsert({
            where: { sourceId_googleEventId: { sourceId, googleEventId: ev.googleEventId } },
            // cancelado costuma vir sem horario/titulo: nao apaga o que ja existe localmente
            update: ev.hasTiming ? { ...base, ...detail } : base,
            create: { organizationId, sourceId, googleEventId: ev.googleEventId, ...base, ...detail },
          });
          processed++;
        }
        pageToken = page.nextPageToken;
      } while (pageToken);

      let reconciled = { marked: 0, cleared: 0 };
      if (dueReconcile) {
        const margin = 2 * DAY_MS;
        const local = await prisma.calendarEvent.findMany({
          where: {
            sourceId,
            OR: [
              { startAt: { gte: new Date(window.timeMin.getTime() - margin), lte: new Date(window.timeMax.getTime() + margin) } },
              { startDate: { gte: new Date(window.timeMin.getTime() - margin), lte: new Date(window.timeMax.getTime() + margin) } },
            ],
          },
          select: { id: true, googleEventId: true, status: true, startAt: true, endAt: true, startDate: true, endDate: true, missingFromSourceAt: true },
        });
        const r = reconcileWindow(
          local.map((e) => ({ ...e, startDate: isoDay(e.startDate), endDate: isoDay(e.endDate) })),
          seen,
          window
        );
        if (r.markMissing.length) await prisma.calendarEvent.updateMany({ where: { id: { in: r.markMissing } }, data: { missingFromSourceAt: startedAt } });
        if (r.clearMissing.length) await prisma.calendarEvent.updateMany({ where: { id: { in: r.clearMissing } }, data: { missingFromSourceAt: null } });
        reconciled = { marked: r.markMissing.length, cleared: r.clearMissing.length };
      }

      // cursor so avanca depois de TODAS as paginas e da reconciliacao
      await prisma.calendarSource.update({
        where: { id: sourceId },
        data: {
          syncCursorAt: startedAt,
          lastSyncedAt: new Date(),
          lastError: null,
          ...(dueReconcile ? { lastReconciledAt: startedAt } : {}),
        },
      });
      await prisma.syncRun.update({
        where: { id: runId },
        data: { status: 'SUCCESS', finishedAt: new Date(), itemsProcessed: processed, itemsSucceeded: processed, metadata: { sourceId, reconcile: dueReconcile, ...reconciled } },
      });
      return { ok: true as const, processed, reconcile: dueReconcile, ...reconciled };
    } catch (error) {
      const message = safeMessage(error);
      const kind = error instanceof GoogleCalendarError ? error.kind : 'TRANSIENT';
      await prisma.calendarSource.updateMany({ where: { id: sourceId, organizationId }, data: { lastError: message } }).catch(() => undefined);
      const source = await prisma.calendarSource.findFirst({ where: { id: sourceId }, select: { connectionId: true } }).catch(() => null);
      if (kind === 'AUTH_REVOKED' && source) await this.markRequiresReconnect(source.connectionId, organizationId, message).catch(() => undefined);
      if (runId) {
        await prisma.syncRun
          .update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), itemsFailed: 1, errorSummary: message } })
          .catch(() => undefined);
      }
      return { ok: false as const, kind, message };
    } finally {
      await releaseLease(`gcal-sync:${sourceId}`, holder);
    }
  }

  async syncOrganization(organizationId: string, opts: { forceFull?: boolean } = {}) {
    const sources = await prisma.calendarSource.findMany({ where: { organizationId, isMonitored: true }, select: { id: true } });
    const results = [];
    for (const s of sources) results.push({ sourceId: s.id, ...(await this.syncSource(organizationId, s.id, opts)) });
    return results;
  }

  /** Para o agendador: organizacoes com conexao ativa e calendarios monitorados. */
  async organizationsToSync(): Promise<string[]> {
    const rows = await prisma.calendarSource.findMany({
      where: { isMonitored: true, connection: { status: 'ACTIVE', provider: PROVIDER } },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    return rows.map((r) => r.organizationId);
  }

  /* ------------------------------ identidades (associacao explicita) ------------------------------ */

  async listIdentities(ctx: CalendarContext) {
    const rows = await prisma.calendarMemberIdentity.findMany({
      where: { organizationId: ctx.organizationId },
      include: { member: { select: { user: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, memberId: r.organizationMemberId, memberName: r.member.user.name, displayHint: r.displayHint, createdAt: r.createdAt.toISOString() }));
  }

  /** O e-mail e usado SO para calcular o HMAC e descartado. Quem associa e o administrador autenticado. */
  async setIdentity(ctx: CalendarContext, input: { memberId: string; email: string }) {
    const hasher = identityHasher(ctx.organizationId);
    if (!hasher) throw new CalendarError(409, 'NOT_CONFIGURED', 'A chave de identidades da agenda nao esta configurada neste ambiente.');
    const member = await prisma.organizationMember.findFirst({ where: { id: input.memberId, organizationId: ctx.organizationId, status: 'ACTIVE' } });
    if (!member) throw new CalendarError(404, 'NOT_FOUND', 'Membro nao encontrado nesta organizacao.');
    const email = normalizeEmail(input.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CalendarError(400, 'INVALID_EMAIL', 'E-mail invalido.');
    const identityHash = hasher(email);
    await prisma.$transaction(async (tx) => {
      await tx.calendarMemberIdentity.upsert({
        where: { organizationId_organizationMemberId_identityHash: { organizationId: ctx.organizationId, organizationMemberId: member.id, identityHash } },
        update: {},
        create: { organizationId: ctx.organizationId, organizationMemberId: member.id, identityHash, displayHint: maskEmail(email), createdByUserId: ctx.userId },
      });
      await new AuditService(tx as never).record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'calendar.identity_associated',
        entityType: 'OrganizationMember',
        entityId: member.id,
        metadata: { displayHint: maskEmail(email) },
      });
    });
    return this.listIdentities(ctx);
  }

  async removeIdentity(ctx: CalendarContext, id: string) {
    const res = await prisma.calendarMemberIdentity.deleteMany({ where: { id, organizationId: ctx.organizationId } });
    if (res.count === 0) throw new CalendarError(404, 'NOT_FOUND', 'Identidade nao encontrada.');
    return this.listIdentities(ctx);
  }

  /* ------------------------------ agenda (leitura com acesso) ------------------------------ */

  private async myHashes(ctx: CalendarContext): Promise<Set<string>> {
    const rows = await prisma.calendarMemberIdentity.findMany({
      where: { organizationId: ctx.organizationId, organizationMemberId: ctx.membershipId },
      select: { identityHash: true },
    });
    return new Set(rows.map((r) => r.identityHash));
  }

  /** Vinculos aplicaveis: o do evento prevalece sobre o da serie. */
  private async linksFor(organizationId: string, events: EventRow[]) {
    if (events.length === 0) return new Map<string, Prisma.CalendarEventLinkGetPayload<Record<string, never>>>();
    const links = await prisma.calendarEventLink.findMany({
      where: {
        organizationId,
        OR: [
          { scope: 'EVENT', eventId: { in: events.map((e) => e.id) } },
          { scope: 'SERIES', recurringEventId: { in: [...new Set(events.map((e) => e.recurringEventId).filter((v): v is string => Boolean(v)))] } },
        ],
      },
    });
    const byEvent = new Map(links.filter((l) => l.scope === 'EVENT').map((l) => [l.eventId!, l] as const));
    const bySeries = new Map(links.filter((l) => l.scope === 'SERIES').map((l) => [`${l.sourceId}:${l.recurringEventId}`, l] as const));
    const out = new Map<string, (typeof links)[number]>();
    for (const e of events) {
      const link = byEvent.get(e.id) ?? (e.recurringEventId ? bySeries.get(`${e.sourceId}:${e.recurringEventId}`) : undefined);
      if (link) out.set(e.id, link);
    }
    return out;
  }

  private async scopedClientIds(ctx: CalendarContext, clientIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(clientIds)];
    if (ids.length === 0) return new Set();
    const rows = await prisma.client.findMany({
      where: { AND: [buildClientResourceScopeWhere({ organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role }), { id: { in: ids } }] },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  async listEvents(ctx: CalendarContext, opts: { from?: Date; to?: Date; hasViewAll: boolean; clientId?: string }) {
    const from = opts.from ?? new Date(Date.now() - 7 * DAY_MS);
    const to = opts.to ?? new Date(Date.now() + 60 * DAY_MS);
    if (to.getTime() - from.getTime() > 400 * DAY_MS) throw new CalendarError(400, 'RANGE_TOO_LARGE', 'Periodo muito grande.');
    const rows = await prisma.calendarEvent.findMany({
      where: {
        organizationId: ctx.organizationId,
        source: { isMonitored: true },
        status: { not: 'CANCELLED' },
        missingFromSourceAt: null,
        OR: [
          { startAt: { gte: from, lte: to } },
          { startDate: { gte: new Date(isoDay(from)! + 'T00:00:00Z'), lte: new Date(isoDay(to)! + 'T00:00:00Z') } },
        ],
      },
      orderBy: [{ startAt: 'asc' }, { startDate: 'asc' }],
      take: 1000,
      include: { source: { select: { name: true, color: true, defaultCategory: true } } },
    });
    const events = rows.filter(isActiveAppointment);
    const [links, mine] = await Promise.all([this.linksFor(ctx.organizationId, events), this.myHashes(ctx)]);
    const clientIds = [...links.values()].map((l) => l.clientId).filter((v): v is string => Boolean(v));
    const inScope = await this.scopedClientIds(ctx, clientIds);

    const out = [];
    for (const e of events) {
      const link = links.get(e.id) ?? null;
      const isParticipant = e.attendeeHashes.some((h) => mine.has(h));
      const access = decideEventAccess({
        googleVisibility: e.visibility as never,
        isParticipant,
        linkedClientId: link?.clientId ?? null,
        clientInScope: link?.clientId ? inScope.has(link.clientId) : false,
        hasViewAll: opts.hasViewAll,
      });
      if (!access.visible) continue;
      if (opts.clientId && link?.clientId !== opts.clientId) continue;
      const base = {
        id: e.id,
        sourceId: e.sourceId,
        sourceName: e.source.name,
        color: e.source.color,
        title: e.title,
        isAllDay: e.isAllDay,
        startAt: e.startAt?.toISOString() ?? null,
        endAt: e.endAt?.toISOString() ?? null,
        startDate: isoDay(e.startDate),
        endDate: isoDay(e.endDate),
        timeZone: e.timeZone,
        status: e.status,
        location: e.location,
        htmlLink: e.htmlLink,
        attendeeCount: e.attendeeCount,
        isRecurringInstance: Boolean(e.recurringEventId),
      };
      const shown = access.masked ? maskCalendarEvent(base) : base;
      // vinculo so aparece quando o usuario pode ver o cliente (nunca vaza cliente fora da carteira)
      const linkOut =
        link && (!link.clientId || inScope.has(link.clientId) || opts.hasViewAll)
          ? { scope: link.scope, clientId: link.clientId, category: link.category, asanaProjectGid: link.asanaProjectGid, notes: access.masked ? null : link.notes }
          : null;
      out.push({ ...shown, masked: access.masked, participant: isParticipant, link: linkOut });
    }
    return out;
  }

  /* ------------------------------ vinculos locais ------------------------------ */

  async setLink(
    ctx: CalendarContext,
    eventId: string,
    input: { scope: 'EVENT' | 'SERIES'; clientId?: string | null; asanaProjectGid?: string | null; category: CalendarEventCategoryValue; notes?: string | null },
    hasViewAll: boolean
  ) {
    const event = await prisma.calendarEvent.findFirst({ where: { id: eventId, organizationId: ctx.organizationId, source: { isMonitored: true } } });
    if (!event) throw new CalendarError(404, 'NOT_FOUND', 'Evento nao encontrado.');
    // so vincula quem enxerga o evento
    const visible = await this.canSee(ctx, event, hasViewAll);
    if (!visible) throw new CalendarError(404, 'NOT_FOUND', 'Evento nao encontrado.');
    if (input.clientId) {
      const client = await findClientInResourceScope(prisma, { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role }, input.clientId);
      if (!client) throw new CalendarError(404, 'CLIENT_NOT_FOUND', 'Cliente nao encontrado na sua carteira.');
    }
    if (input.asanaProjectGid) {
      if (!input.clientId) throw new CalendarError(400, 'CLIENT_REQUIRED', 'Informe o cliente para vincular um projeto.');
      const linked = await prisma.clientIntegration.findFirst({ where: { clientId: input.clientId, provider: 'ASANA', externalId: input.asanaProjectGid }, select: { id: true } });
      if (!linked) throw new CalendarError(400, 'PROJECT_NOT_LINKED', 'O projeto nao esta vinculado a este cliente.');
    }
    if (input.scope === 'SERIES' && !event.recurringEventId) {
      throw new CalendarError(400, 'NOT_RECURRING', 'Este evento nao pertence a uma serie.');
    }
    const data = {
      clientId: input.clientId ?? null,
      asanaProjectGid: input.asanaProjectGid ?? null,
      category: input.category,
      notes: input.notes?.trim() ? input.notes.trim().slice(0, 2000) : null,
      createdByUserId: ctx.userId,
    };
    await prisma.$transaction(async (tx) => {
      const where: Prisma.CalendarEventLinkWhereInput =
        input.scope === 'EVENT'
          ? { organizationId: ctx.organizationId, scope: 'EVENT', eventId }
          : { organizationId: ctx.organizationId, scope: 'SERIES', sourceId: event.sourceId, recurringEventId: event.recurringEventId };
      const existing = await tx.calendarEventLink.findFirst({ where });
      if (existing) await tx.calendarEventLink.update({ where: { id: existing.id }, data });
      else {
        await tx.calendarEventLink.create({
          data: {
            organizationId: ctx.organizationId,
            scope: input.scope,
            eventId: input.scope === 'EVENT' ? eventId : null,
            sourceId: input.scope === 'SERIES' ? event.sourceId : null,
            recurringEventId: input.scope === 'SERIES' ? event.recurringEventId : null,
            ...data,
          },
        });
      }
      await new AuditService(tx as never).record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'calendar.link_set',
        entityType: 'CalendarEvent',
        entityId: eventId,
        after: { scope: input.scope, clientId: input.clientId ?? null, category: input.category } as Prisma.InputJsonValue,
      });
    });
    return { ok: true };
  }

  private async canSee(ctx: CalendarContext, event: EventRow, hasViewAll: boolean): Promise<boolean> {
    const [links, mine] = await Promise.all([this.linksFor(ctx.organizationId, [event]), this.myHashes(ctx)]);
    const link = links.get(event.id) ?? null;
    const inScope = link?.clientId ? await this.scopedClientIds(ctx, [link.clientId]) : new Set<string>();
    return decideEventAccess({
      googleVisibility: event.visibility as never,
      isParticipant: event.attendeeHashes.some((h) => mine.has(h)),
      linkedClientId: link?.clientId ?? null,
      clientInScope: link?.clientId ? inScope.has(link.clientId) : false,
      hasViewAll,
    }).visible;
  }

  async removeLink(ctx: CalendarContext, eventId: string, scope: 'EVENT' | 'SERIES', hasViewAll: boolean) {
    const event = await prisma.calendarEvent.findFirst({ where: { id: eventId, organizationId: ctx.organizationId } });
    if (!event || !(await this.canSee(ctx, event, hasViewAll))) throw new CalendarError(404, 'NOT_FOUND', 'Evento nao encontrado.');
    await prisma.calendarEventLink.deleteMany({
      where:
        scope === 'EVENT'
          ? { organizationId: ctx.organizationId, scope: 'EVENT', eventId }
          : { organizationId: ctx.organizationId, scope: 'SERIES', sourceId: event.sourceId, recurringEventId: event.recurringEventId },
    });
    return { ok: true };
  }
}

export const googleCalendarService = new GoogleCalendarService();
