import { Prisma } from '@prisma/client';
import type {
  AutomationCallbackRequest,
  CreateAutomationFlowRequest,
  ResendAutomationRequest,
  SetupAutomationConnectionRequest,
  UpdateAutomationFlowRequest,
} from '@zafira/contracts';
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_HOURS,
  canResend,
  classifySendStatus,
  decideCallback,
  isTimedOut,
  isTimestampFresh,
  nextAfterSend,
  type OutboxStatus,
} from '@zafira/domain';
import { prisma } from '../../lib/prisma.js';
import { decryptIntegrationCredential } from '../../lib/crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { findClientInResourceScope } from '../authorization/client-resource-scope.js';
import { integrationConnectionService } from '../integrations/connections/integration-connection.service.js';
import { OnboardingError } from './onboarding.service.js';
import { idempotencyKeyFor } from './automation-outbox.js';
import {
  checkWebhookUrl,
  dispatcherEnabled,
  secretFingerprint,
  signBody,
  verifySignature,
} from './automation-config.js';
import { onboardingExecutionService, type ExecutionContext } from './onboarding-execution.service.js';

/**
 * F7-4a - Automacoes n8n do onboarding (DEC-F7-016). Infra generica, sem servico novo.
 * Persistencia ANTES do envio; chave estavel; resultado aplicado uma vez; falha de rede nunca conclui.
 * Segredos so cifrados em IntegrationConnection (provider N8N) e nunca em resposta, log ou auditoria.
 */

type Tx = Prisma.TransactionClient;
type FetchLike = typeof fetch;

const PROVIDER = 'N8N' as const;
const CLAIM_LEASE_MS = 5 * 60_000;
const SEND_TIMEOUT_MS = 10_000;

export class AutomationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

interface ConnectionMeta {
  timeoutHours: number;
  maxAttempts: number;
}

const metaOf = (m: unknown): ConnectionMeta => {
  const o = (m ?? {}) as Record<string, unknown>;
  const n = (v: unknown, d: number, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : d);
  return { timeoutHours: n(o.timeoutHours, DEFAULT_TIMEOUT_HOURS, 1, 168), maxAttempts: n(o.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 10) };
};

/** Mensagens curtas e sem corpo bruto nem segredo. */
const safe = (v: string | null | undefined, max = 300) => (v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);

export class AutomationService {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  /* ------------------------------ conexao ------------------------------ */

  private async connectionOf(organizationId: string) {
    return prisma.integrationConnection.findFirst({ where: { organizationId, provider: PROVIDER, clientId: null } });
  }

  private secretOf(conn: { credentialCiphertext: string | null }): string | null {
    if (!conn.credentialCiphertext) return null;
    try {
      const parsed = JSON.parse(decryptIntegrationCredential(conn.credentialCiphertext));
      return typeof parsed.secret === 'string' ? parsed.secret : null;
    } catch {
      return null;
    }
  }

  async connectionStatus(organizationId: string) {
    const conn = await this.connectionOf(organizationId);
    const secret = conn ? this.secretOf(conn) : null;
    const meta = metaOf(conn?.metadata);
    return {
      configured: Boolean(conn && secret && conn.status === 'ACTIVE'),
      hasSecret: Boolean(secret),
      secretFingerprint: secret ? secretFingerprint(secret) : null,
      timeoutHours: meta.timeoutHours,
      maxAttempts: meta.maxAttempts,
      dispatcherEnabled: dispatcherEnabled(),
      callbackPath: `/integrations/n8n/callback/${organizationId}`,
    };
  }

  async setupConnection(ctx: { organizationId: string; userId: string }, input: SetupAutomationConnectionRequest) {
    await integrationConnectionService.upsertConnection({
      organizationId: ctx.organizationId,
      provider: PROVIDER,
      authType: 'TOKEN',
      externalAccountId: 'n8n',
      displayName: 'n8n',
      rawCredential: { secret: input.secret },
      status: 'ACTIVE',
      metadata: { timeoutHours: input.timeoutHours, maxAttempts: input.maxAttempts },
    });
    await new AuditService(prisma as never).record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'automation.connection_configured',
      entityType: 'IntegrationConnection',
      entityId: ctx.organizationId,
      metadata: { provider: PROVIDER, fingerprint: secretFingerprint(input.secret) },
    });
    return this.connectionStatus(ctx.organizationId);
  }

  async removeConnection(ctx: { organizationId: string; userId: string }) {
    const conn = await this.connectionOf(ctx.organizationId);
    if (!conn) throw new AutomationError(404, 'NOT_FOUND', 'Nao ha conexao com o n8n.');
    await prisma.integrationConnection.update({ where: { id: conn.id }, data: { status: 'DISCONNECTED', credentialCiphertext: null } });
    await new AuditService(prisma as never).record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'automation.connection_removed',
      entityType: 'IntegrationConnection',
      entityId: conn.id,
    });
    return this.connectionStatus(ctx.organizationId);
  }

  /* ------------------------------ fluxos ------------------------------ */

  private flowView(f: { id: string; key: string; name: string; description: string | null; webhookUrl: string; enabled: boolean; subscribeLifecycle: boolean; includeClientName: boolean }) {
    // a URL pode conter caminho secreto: devolve so o host
    let host = '';
    try {
      host = new URL(f.webhookUrl).host;
    } catch {
      /* ignora */
    }
    return {
      id: f.id,
      key: f.key,
      name: f.name,
      description: f.description,
      webhookHost: host,
      enabled: f.enabled,
      subscribeLifecycle: f.subscribeLifecycle,
      includeClientName: f.includeClientName,
    };
  }

  async listFlows(organizationId: string) {
    const rows = await prisma.automationFlow.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
    return rows.map((f) => this.flowView(f));
  }

  async createFlow(ctx: { organizationId: string; userId: string }, input: CreateAutomationFlowRequest) {
    const check = checkWebhookUrl(input.webhookUrl);
    if (!check.ok) throw new AutomationError(400, 'INVALID_WEBHOOK_URL', check.message);
    try {
      const f = await prisma.automationFlow.create({
        data: {
          organizationId: ctx.organizationId,
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          webhookUrl: input.webhookUrl,
          enabled: input.enabled,
          subscribeLifecycle: input.subscribeLifecycle,
          includeClientName: input.includeClientName,
        },
      });
      await new AuditService(prisma as never).record({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'automation.flow_created',
        entityType: 'AutomationFlow',
        entityId: f.id,
        after: { key: f.key, enabled: f.enabled } as Prisma.InputJsonValue,
      });
      return this.flowView(f);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AutomationError(409, 'KEY_TAKEN', 'Ja existe um fluxo com este identificador.');
      }
      throw error;
    }
  }

  async updateFlow(ctx: { organizationId: string; userId: string }, id: string, input: UpdateAutomationFlowRequest) {
    const flow = await prisma.automationFlow.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!flow) throw new AutomationError(404, 'NOT_FOUND', 'Fluxo nao encontrado.');
    if (input.webhookUrl !== undefined) {
      const check = checkWebhookUrl(input.webhookUrl);
      if (!check.ok) throw new AutomationError(400, 'INVALID_WEBHOOK_URL', check.message);
    }
    const updated = await prisma.automationFlow.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.webhookUrl !== undefined ? { webhookUrl: input.webhookUrl } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.subscribeLifecycle !== undefined ? { subscribeLifecycle: input.subscribeLifecycle } : {}),
        ...(input.includeClientName !== undefined ? { includeClientName: input.includeClientName } : {}),
      },
    });
    await new AuditService(prisma as never).record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'automation.flow_updated',
      entityType: 'AutomationFlow',
      entityId: id,
      after: { enabled: updated.enabled } as Prisma.InputJsonValue,
    });
    return this.flowView(updated);
  }

  /* ------------------------------ eventos da execucao (sem corpo bruto) ------------------------------ */

  private async event(
    db: Tx | typeof prisma,
    p: { organizationId: string; executionId: string; stepKey: string | null; type: string; reason?: string | null; after?: Prisma.InputJsonValue; actorUserId?: string | null }
  ) {
    await db.onboardingExecutionEvent.create({
      data: {
        organizationId: p.organizationId,
        executionId: p.executionId,
        stepKey: p.stepKey,
        type: p.type,
        actorUserId: p.actorUserId ?? null,
        reason: p.reason ?? null,
        after: p.after,
      },
    });
    await new AuditService(db as never).record({
      organizationId: p.organizationId,
      actorUserId: p.actorUserId ?? undefined,
      action: `automation.${p.type.toLowerCase()}`,
      entityType: 'OnboardingExecution',
      entityId: p.executionId,
      after: p.after,
      metadata: { stepKey: p.stepKey, reason: p.reason ?? null },
    });
  }

  /* ------------------------------ despacho (outbox -> n8n) ------------------------------ */

  /**
   * Reserva pedidos vencidos (visibilidade por nextAttemptAt, sem estado extra) e envia.
   * So roda com N8N_DISPATCH_ENABLED=true; desligado, nada e enviado e nada conclui.
   */
  async dispatchDue(opts: { limit?: number; now?: Date; organizationId?: string } = {}) {
    if (!dispatcherEnabled()) return { enabled: false as const, claimed: 0, results: [] as string[] };
    const now = opts.now ?? new Date();
    const limit = opts.limit ?? 20;
    // Reserva otimista (sem SQL cru, independente do fuso do banco): o vencedor e quem consegue
    // mover nextAttemptAt a partir do valor lido; os demais seguem adiante sem enviar em duplicidade.
    const due = await prisma.automationOutbox.findMany({
      where: {
        status: { in: ['PENDING', 'RETRYING'] },
        nextAttemptAt: { lte: now },
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    const claimed: { id: string }[] = [];
    for (const row of due) {
      const won = await prisma.automationOutbox.updateMany({
        where: { id: row.id, status: row.status, nextAttemptAt: row.nextAttemptAt },
        data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
      });
      if (won.count === 1) claimed.push({ id: row.id });
    }
    const results: string[] = [];
    for (const row of claimed) results.push(await this.sendOne(row.id, now));
    await this.sweepTimeouts(now);
    return { enabled: true as const, claimed: claimed.length, results };
  }

  private async sendOne(outboxId: string, now: Date): Promise<string> {
    const o = await prisma.automationOutbox.findUnique({ where: { id: outboxId } });
    if (!o) return 'MISSING';
    const fail = async (message: string, status: OutboxStatus = 'FAILED') => {
      await prisma.automationOutbox.update({
        where: { id: o.id },
        data: { status, lastError: safe(message), finishedAt: now },
      });
      await this.event(prisma, { organizationId: o.organizationId, executionId: o.executionId, stepKey: o.stepKey, type: 'AUTOMATION_FAILED', after: { code: 'SEND', message: safe(message) } });
      return status;
    };
    const [flow, conn, exec] = await Promise.all([
      prisma.automationFlow.findFirst({ where: { organizationId: o.organizationId, key: o.flowKey } }),
      this.connectionOf(o.organizationId),
      prisma.onboardingExecution.findFirst({ where: { id: o.executionId, organizationId: o.organizationId }, include: { client: { select: { name: true } } } }),
    ]);
    if (!exec) return fail('Execucao nao encontrada.');
    if (!flow || !flow.enabled) return fail('Fluxo ausente ou desabilitado (FLOW_UNAVAILABLE).');
    const secret = conn && conn.status === 'ACTIVE' ? this.secretOf(conn) : null;
    if (!secret) return fail('Conexao com o n8n ausente (CONNECTION_UNAVAILABLE).');
    const check = checkWebhookUrl(flow.webhookUrl);
    if (!check.ok) return fail(`Destino recusado: ${check.message}`);
    const meta = metaOf(conn!.metadata);

    const payload: Record<string, unknown> = {
      organizationId: o.organizationId,
      executionId: o.executionId,
      stepKey: o.stepKey,
      flowKey: o.flowKey,
      clientId: exec.clientId,
      eventType: o.eventType,
      generation: o.generation,
      idempotencyKey: o.idempotencyKey,
      occurredAt: o.createdAt.toISOString(),
    };
    if (flow.includeClientName) payload.clientName = exec.client.name;
    const base = process.env.N8N_CALLBACK_BASE_URL?.replace(/\/$/, '');
    if (base && o.eventType === 'STEP_AUTOMATION') payload.callbackUrl = `${base}/integrations/n8n/callback/${o.organizationId}`;
    const body = JSON.stringify(payload);
    const ts = Math.floor(now.getTime() / 1000);

    let status: number | null = null;
    let errorText: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      const res = await this.fetchImpl(check.url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Zafira-Timestamp': String(ts),
          'X-Zafira-Signature': `sha256=${signBody(secret, ts, body)}`,
          'X-Zafira-Idempotency-Key': o.idempotencyKey,
          'X-Zafira-Event': o.eventType,
        },
        body,
      });
      clearTimeout(timer);
      status = res.status;
    } catch {
      errorText = 'Falha de rede ao chamar o n8n.';
    }
    const outcome = classifySendStatus(status);
    const next = nextAfterSend({ outcome, attemptsDone: o.attempts, maxAttempts: meta.maxAttempts, now });
    const informational = o.eventType !== 'STEP_AUTOMATION';
    const finalStatus: OutboxStatus = next.status === 'SENT' && informational ? 'SUCCEEDED' : next.status;
    await prisma.automationOutbox.update({
      where: { id: o.id },
      data: {
        status: finalStatus,
        nextAttemptAt: next.nextAttemptAt ?? now,
        sentAt: outcome === 'OK' ? now : o.sentAt,
        finishedAt: ['SUCCEEDED', 'FAILED', 'DEAD'].includes(finalStatus) ? now : null,
        lastError: outcome === 'OK' ? null : safe(errorText ?? `HTTP ${status}`),
      },
    });
    const type =
      finalStatus === 'SENT' || finalStatus === 'SUCCEEDED'
        ? 'AUTOMATION_SENT'
        : finalStatus === 'RETRYING'
          ? 'AUTOMATION_RETRY_SCHEDULED'
          : 'AUTOMATION_FAILED';
    await this.event(prisma, {
      organizationId: o.organizationId,
      executionId: o.executionId,
      stepKey: o.stepKey,
      type,
      after: { attempt: o.attempts, httpStatus: status, status: finalStatus } as Prisma.InputJsonValue,
    });
    return finalStatus;
  }

  /** SENT sem resultado alem do prazo -> TIMED_OUT (visivel na etapa). Nunca conclui. */
  async sweepTimeouts(now: Date = new Date()) {
    const sent = await prisma.automationOutbox.findMany({ where: { status: 'SENT', eventType: 'STEP_AUTOMATION' }, take: 200 });
    let count = 0;
    for (const o of sent) {
      const conn = await this.connectionOf(o.organizationId);
      const meta = metaOf(conn?.metadata);
      if (!isTimedOut(o.sentAt, now, meta.timeoutHours)) continue;
      const res = await prisma.automationOutbox.updateMany({
        where: { id: o.id, status: 'SENT' },
        data: { status: 'TIMED_OUT', finishedAt: now, lastError: 'Sem resultado dentro do prazo.' },
      });
      if (res.count === 1) {
        count++;
        await this.event(prisma, { organizationId: o.organizationId, executionId: o.executionId, stepKey: o.stepKey, type: 'AUTOMATION_TIMED_OUT' });
      }
    }
    return count;
  }

  /* ------------------------------ callback (n8n -> Hub) ------------------------------ */

  /**
   * Autenticacao: a organizacao e provada pela ASSINATURA com o segredo dela (o id na URL so seleciona qual
   * segredo verificar; qualquer organizacao no corpo e ignorada). Janela de +-5 min; pedido buscado por
   * organizacao + chave; resultado deduplicado; transicao decidida por decideCallback.
   */
  async handleCallback(organizationId: string, rawBody: string, headers: Record<string, string | string[] | undefined>, now: Date = new Date()) {
    const unauthorized = { status: 401, body: { status: 'error', code: 'UNAUTHORIZED', message: 'Nao autorizado.' } };
    const h = (k: string) => (Array.isArray(headers[k]) ? (headers[k] as string[])[0] : (headers[k] as string | undefined));
    const conn = await this.connectionOf(organizationId);
    const secret = conn && conn.status === 'ACTIVE' ? this.secretOf(conn) : null;
    if (!conn || !secret) return unauthorized;
    const ts = Number(h('x-zafira-timestamp'));
    if (!isTimestampFresh(ts, now)) return unauthorized;
    if (!verifySignature(secret, ts, rawBody, h('x-zafira-signature'))) return unauthorized;

    let parsed: AutomationCallbackRequest;
    try {
      const { AutomationCallbackRequestSchema } = await import('@zafira/contracts');
      parsed = AutomationCallbackRequestSchema.parse(JSON.parse(rawBody));
    } catch {
      return { status: 400, body: { status: 'error', code: 'INVALID_REQUEST', message: 'Corpo invalido.' } };
    }

    const outbox = await prisma.automationOutbox.findFirst({ where: { organizationId, idempotencyKey: parsed.idempotencyKey } });
    if (!outbox) return { status: 404, body: { status: 'error', code: 'NOT_FOUND', message: 'Pedido nao encontrado.' } };

    // deduplicacao do resultado (WebhookEvent.dedupeKey unico)
    let webhookId: string;
    try {
      const w = await prisma.webhookEvent.create({
        data: {
          organizationId,
          connectionId: conn.id,
          provider: PROVIDER,
          externalEventId: parsed.callbackId,
          dedupeKey: `${organizationId}:${parsed.idempotencyKey}:${parsed.callbackId}`,
          eventType: 'automation.callback',
          payload: { status: parsed.status, resultCode: parsed.resultCode ?? null } as Prisma.InputJsonValue,
        },
      });
      webhookId = w.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { status: 200, body: { status: 'ok', applied: false, reason: 'DUPLICATE' } };
      }
      throw error;
    }

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "automation_outbox" WHERE "id" = ${outbox.id} FOR UPDATE`;
      const cur = await tx.automationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      const [latest, exec, run] = await Promise.all([
        tx.automationOutbox.aggregate({
          where: { organizationId, executionId: cur.executionId, stepKey: cur.stepKey, flowKey: cur.flowKey, eventType: cur.eventType },
          _max: { generation: true },
        }),
        tx.onboardingExecution.findFirst({ where: { id: cur.executionId, organizationId }, select: { status: true } }),
        cur.stepKey
          ? tx.onboardingStepRun.findFirst({ where: { executionId: cur.executionId, stepKey: cur.stepKey }, select: { status: true } })
          : Promise.resolve(null),
      ]);
      const decision = decideCallback({
        outboxStatus: cur.status as OutboxStatus,
        generation: cur.generation,
        latestGeneration: latest._max.generation ?? cur.generation,
        executionActive: exec?.status === 'ACTIVE',
        stepOpen: cur.eventType !== 'STEP_AUTOMATION' ? true : Boolean(run && ['WAITING', 'READY', 'IN_PROGRESS'].includes(run.status)),
      });
      if (!decision.apply) {
        await this.event(tx, {
          organizationId,
          executionId: cur.executionId,
          stepKey: cur.stepKey,
          type: 'AUTOMATION_RESULT_IGNORED',
          after: { reason: decision.reason, reported: parsed.status } as Prisma.InputJsonValue,
        });
        return { applied: false, reason: decision.reason };
      }
      const refs = parsed.externalRefs.slice(0, 5) as unknown as Prisma.InputJsonValue;
      if (parsed.status === 'FAILED') {
        await tx.automationOutbox.update({
          where: { id: cur.id },
          data: { status: 'FAILED', finishedAt: now, resultCode: safe(parsed.resultCode, 64) || null, resultMessage: safe(parsed.message), lastError: safe(parsed.message), externalRefs: refs },
        });
        await this.event(tx, { organizationId, executionId: cur.executionId, stepKey: cur.stepKey, type: 'AUTOMATION_FAILED', after: { code: safe(parsed.resultCode, 64) || null, message: safe(parsed.message) } as Prisma.InputJsonValue });
        return { applied: true, reason: 'FAILED_RECORDED' };
      }
      await tx.automationOutbox.update({
        where: { id: cur.id },
        data: { status: 'SUCCEEDED', finishedAt: now, resultCode: safe(parsed.resultCode, 64) || null, resultMessage: safe(parsed.message), lastError: null, externalRefs: refs },
      });
      await this.event(tx, { organizationId, executionId: cur.executionId, stepKey: cur.stepKey, type: 'AUTOMATION_SUCCEEDED', after: { code: safe(parsed.resultCode, 64) || null } as Prisma.InputJsonValue });
      if (cur.eventType === 'STEP_AUTOMATION' && cur.stepKey) {
        const done = await onboardingExecutionService.applyAutomationSuccess(tx, organizationId, cur.executionId, cur.stepKey, cur.id);
        if (!done) {
          await this.event(tx, { organizationId, executionId: cur.executionId, stepKey: cur.stepKey, type: 'AUTOMATION_RESULT_PENDING', after: { reason: 'STEP_BLOCKED' } });
        }
        return { applied: true, reason: done ? 'STEP_COMPLETED' : 'PENDING_UNBLOCK' };
      }
      return { applied: true, reason: 'RECORDED' };
    });
    await prisma.webhookEvent.update({ where: { id: webhookId }, data: { status: 'PROCESSED', processedAt: now } }).catch(() => undefined);
    return { status: 200, body: { status: 'ok', ...outcome } };
  }

  /* ------------------------------ reenvio ------------------------------ */

  async resend(ctx: ExecutionContext, executionId: string, stepKey: string, input: ResendAutomationRequest) {
    const exec = await prisma.onboardingExecution.findFirst({ where: { id: executionId, organizationId: ctx.organizationId } });
    if (!exec) throw new OnboardingError(404, 'NOT_FOUND', 'Onboarding nao encontrado.');
    const scoped = await findClientInResourceScope(prisma, { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role }, exec.clientId);
    if (!scoped) throw new OnboardingError(404, 'NOT_FOUND', 'Onboarding nao encontrado.');
    if (exec.status !== 'ACTIVE') throw new OnboardingError(409, 'EXECUTION_CLOSED', 'Este onboarding ja foi encerrado.');
    const run = await prisma.onboardingStepRun.findFirst({ where: { executionId, stepKey } });
    if (!run || !['WAITING', 'READY', 'IN_PROGRESS'].includes(run.status)) {
      throw new OnboardingError(409, 'STEP_CLOSED', 'A etapa nao esta aberta.');
    }
    const latest = await prisma.automationOutbox.findFirst({
      where: { organizationId: ctx.organizationId, executionId, stepKey, eventType: 'STEP_AUTOMATION' },
      orderBy: { generation: 'desc' },
    });
    if (!latest) throw new OnboardingError(404, 'NOT_FOUND', 'Nao ha pedido de automacao para esta etapa.');
    if (!canResend(latest.status as OutboxStatus)) {
      throw new OnboardingError(409, 'NOT_RESENDABLE', `O pedido esta em ${latest.status} e nao pode ser reenviado.`);
    }
    await prisma.$transaction(async (tx) => {
      if (input.mode === 'RETRY') {
        // mesma chave: o fluxo deve deduplicar; zera tentativas e volta para a fila
        await tx.automationOutbox.update({
          where: { id: latest.id },
          data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, finishedAt: null, requestedByUserId: ctx.userId },
        });
      } else {
        const generation = latest.generation + 1;
        await tx.automationOutbox.create({
          data: {
            organizationId: ctx.organizationId,
            executionId,
            stepKey,
            flowKey: latest.flowKey,
            eventType: 'STEP_AUTOMATION',
            generation,
            idempotencyKey: idempotencyKeyFor({ organizationId: ctx.organizationId, executionId, stepKey, flowKey: latest.flowKey, eventType: 'STEP_AUTOMATION', generation }),
            requestedByUserId: ctx.userId,
          },
        });
      }
      await this.event(tx, {
        organizationId: ctx.organizationId,
        executionId,
        stepKey,
        type: input.mode === 'RETRY' ? 'AUTOMATION_RETRY_REQUESTED' : 'AUTOMATION_REDO_REQUESTED',
        reason: input.reason,
        actorUserId: ctx.userId,
        after: { previousStatus: latest.status, generation: latest.generation } as Prisma.InputJsonValue,
      });
    });
    return { ok: true, mode: input.mode };
  }

  /** Historico de pedidos de uma execucao (sem corpo bruto nem segredos). */
  async listForExecution(organizationId: string, executionId: string) {
    const rows = await prisma.automationOutbox.findMany({ where: { organizationId, executionId }, orderBy: [{ createdAt: 'asc' }] });
    return rows.map((o) => ({
      id: o.id,
      stepKey: o.stepKey,
      flowKey: o.flowKey,
      eventType: o.eventType,
      generation: o.generation,
      status: o.status,
      attempts: o.attempts,
      sentAt: o.sentAt?.toISOString() ?? null,
      finishedAt: o.finishedAt?.toISOString() ?? null,
      lastError: o.lastError,
      resultCode: o.resultCode,
      externalRefs: o.externalRefs ?? [],
    }));
  }
}

export const automationService = new AutomationService();
