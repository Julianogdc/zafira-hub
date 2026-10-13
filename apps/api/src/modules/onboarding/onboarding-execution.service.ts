import { Prisma } from '@prisma/client';
import type {
  BlockOnboardingStepRequest,
  CancelOnboardingExecutionRequest,
  CompleteOnboardingExecutionRequest,
  CompleteOnboardingStepRequest,
  OnboardingStartTrigger,
  OnboardingStepInput,
  ReassignOnboardingStepRequest,
  SkipOnboardingStepRequest,
  StartOnboardingExecutionRequest,
  UnblockOnboardingStepRequest,
} from '@zafira/contracts';
import {
  type PermissionCode,
  type RoleType,
  type StepAction,
  allowedStepActions,
  evaluateCalendarCondition,
  eventEligibility,
  MASKED_EVENT_TITLE,
  canActOnStep,
  computeDueDate,
  findReleasable,
  isAutoCompletable,
  isOpenStep,
  isStepLate,
  planEarlyCompletion,
  planExecutionStart,
  progressOf,
  resolveAssignee,
  validateStepCompletion,
} from '@zafira/domain';
import { prisma } from '../../lib/prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { buildClientResourceScopeWhere, findClientInResourceScope } from '../authorization/client-resource-scope.js';
import { resolveAuthorizationContext } from '../authorization/resolver.js';
import { OnboardingError, loadSteps } from './onboarding.service.js';
import { enqueueLifecycle, enqueueStepAutomation } from './automation-outbox.js';
import { dispatcherEnabled } from './automation-config.js';

/**
 * F7-2a - Execucao do onboarding por cliente (DEC-F7-008).
 * Garantias: B2 no banco (indice unico parcial); cliente/modelo/versao imutaveis (gatilho);
 * carteira nunca ampliada (P1); sem responsavel elegivel so `override` conclui (P2);
 * conclusao antecipada dispensa explicitamente as etapas abertas na mesma transacao (P3);
 * etapa encerrada nao reabre (P5); eventos append-only. Nenhuma escrita no Asana ou Calendar.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export interface ExecutionContext {
  organizationId: string;
  userId: string;
  membershipId: string;
  role: RoleType;
}

/** Ator das conclusoes por resultado autenticado da automacao (sem pessoa; nao vira FK nem e gravado como usuario). */
export const SYSTEM_USER = 'system:automation';

/** Etapas automaticas (AUTOMATION) nao tem responsavel humano: nao contam como "sem responsavel" (F7-4b). */
async function automaticStepKeys(db: Db, versionIds: string[]): Promise<Set<string>> {
  if (versionIds.length === 0) return new Set();
  const rows = await db.onboardingStepDefinition.findMany({
    where: { versionId: { in: [...new Set(versionIds)] }, kind: 'AUTOMATION' },
    select: { versionId: true, stepKey: true },
  });
  return new Set(rows.map((r) => `${r.versionId}:${r.stepKey}`));
}

const notFound = (what = 'Onboarding') => new OnboardingError(404, 'NOT_FOUND', `${what} nao encontrado.`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dayToDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

/* ------------------------------ elegibilidade (P1) ------------------------------ */

/** Pessoas ATIVAS (membro e usuario) que enxergam o cliente na propria carteira. */
export async function eligibleMemberIds(db: Db, organizationId: string, clientId: string, memberIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return new Set();
  const members = await db.organizationMember.findMany({
    where: { organizationId, id: { in: ids }, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { id: true, role: true },
  });
  const out = new Set<string>();
  await Promise.all(
    members.map(async (m) => {
      if (m.role === 'ADMIN') {
        out.add(m.id);
        return;
      }
      const hit = await db.client.findFirst({
        where: {
          AND: [buildClientResourceScopeWhere({ organizationId, membershipId: m.id, role: m.role as RoleType }), { id: clientId }],
        },
        select: { id: true },
      });
      if (hit) out.add(m.id);
    })
  );
  return out;
}

async function hasPermission(ctx: ExecutionContext, code: PermissionCode): Promise<boolean> {
  const r = await resolveAuthorizationContext({ userId: ctx.userId, activeOrganizationId: ctx.organizationId, permissionCode: code });
  return Boolean(r.allowed);
}

/* ------------------------------ Calendar (F7-3c): somente eventos e vinculos LOCAIS ------------------------------ */

const REASON_TEXT: Record<string, string> = {
  CANCELLED: 'evento cancelado no Google',
  REMOVED_FROM_SOURCE: 'evento removido ou fora da janela de leitura',
  SOURCE_NOT_MONITORED: 'calendario deixou de ser monitorado',
};

export interface CalendarCandidate {
  id: string;
  title: string;
  masked: boolean;
  startAt: string | null;
  startDate: string | null;
  isAllDay: boolean;
  sourceName: string;
  eligible: boolean;
  reason: string | null;
}

/**
 * Eventos ligados (por vinculo local, de evento ou de serie) ao CLIENTE da execucao, na organizacao.
 * Nenhuma chamada ao Google. Privado/confidencial: titulo mascarado para quem nao e participante.
 */
async function calendarContextFor(db: Db, ctx: ExecutionContext, clientId: string) {
  const [conn, monitoredSources, links, mine] = await Promise.all([
    db.integrationConnection.findFirst({
      where: { organizationId: ctx.organizationId, provider: 'GOOGLE_CALENDAR', clientId: null },
      select: { status: true },
    }),
    db.calendarSource.count({ where: { organizationId: ctx.organizationId, isMonitored: true } }),
    db.calendarEventLink.findMany({
      where: { organizationId: ctx.organizationId, clientId },
      select: { scope: true, eventId: true, sourceId: true, recurringEventId: true },
    }),
    db.calendarMemberIdentity.findMany({
      where: { organizationId: ctx.organizationId, organizationMemberId: ctx.membershipId },
      select: { identityHash: true },
    }),
  ]);
  const eventIds = links.filter((l) => l.scope === 'EVENT' && l.eventId).map((l) => l.eventId as string);
  const series = links
    .filter((l) => l.scope === 'SERIES' && l.sourceId && l.recurringEventId)
    .map((l) => ({ sourceId: l.sourceId as string, recurringEventId: l.recurringEventId as string }));
  const rows =
    eventIds.length === 0 && series.length === 0
      ? []
      : await db.calendarEvent.findMany({
          where: {
            organizationId: ctx.organizationId,
            OR: [{ id: { in: eventIds } }, ...series.map((p) => ({ sourceId: p.sourceId, recurringEventId: p.recurringEventId }))],
          },
          include: { source: { select: { name: true, isMonitored: true } } },
          orderBy: [{ startAt: 'asc' }, { startDate: 'asc' }],
          take: 200,
        });
  const hashes = new Set(mine.map((m) => m.identityHash));
  const candidates: CalendarCandidate[] = rows.map((e) => {
    const sensitive = e.visibility === 'private' || e.visibility === 'confidential';
    const masked = sensitive && !e.attendeeHashes.some((h) => hashes.has(h));
    const el = eventEligibility({ status: e.status, missingFromSourceAt: e.missingFromSourceAt, sourceMonitored: e.source.isMonitored });
    return {
      id: e.id,
      title: masked ? MASKED_EVENT_TITLE : e.title,
      masked,
      startAt: e.startAt?.toISOString() ?? null,
      startDate: isoDay(e.startDate),
      isAllDay: e.isAllDay,
      sourceName: e.source.name,
      eligible: el.eligible,
      reason: el.eligible ? null : REASON_TEXT[el.reason],
    };
  });
  const connectionActive = conn?.status === 'ACTIVE';
  const condition = evaluateCalendarCondition({
    connectionActive,
    monitoredSources,
    eligibleEvents: candidates.filter((c) => c.eligible).length,
  });
  return { connectionActive, monitoredSources, candidates, condition };
}

/* ------------------------------ eventos ------------------------------ */

async function recordEvent(
  tx: Tx,
  ctx: ExecutionContext,
  e: {
    executionId: string;
    stepKey?: string | null;
    type: string;
    reason?: string | null;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  }
) {
  await tx.onboardingExecutionEvent.create({
    data: {
      organizationId: ctx.organizationId,
      executionId: e.executionId,
      stepKey: e.stepKey ?? null,
      type: e.type,
      actorUserId: ctx.userId === SYSTEM_USER ? null : ctx.userId,
      reason: e.reason ?? null,
      before: e.before,
      after: e.after,
    },
  });
  await new AuditService(tx).record({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId === SYSTEM_USER ? undefined : ctx.userId,
    action: `onboarding.execution.${e.type.toLowerCase()}`,
    entityType: 'OnboardingExecution',
    entityId: e.executionId,
    before: e.before,
    after: e.after,
    metadata: { stepKey: e.stepKey ?? null, reason: e.reason ?? null },
  });
}

function mapDbError(error: unknown): never {
  if (error instanceof OnboardingError) throw error;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('onboarding_execution_closed')) {
    throw new OnboardingError(409, 'EXECUTION_CLOSED', 'Onboarding encerrado nao pode ser alterado.');
  }
  if (message.includes('onboarding_step_closed')) {
    throw new OnboardingError(409, 'STEP_CLOSED', 'Etapa encerrada nao pode ser alterada ou reaberta.');
  }
  if (message.includes('onboarding_execution_open_steps')) {
    throw new OnboardingError(409, 'OPEN_STEPS', 'Nenhuma etapa pode ficar aberta em um onboarding encerrado.');
  }
  throw error;
}

/* ------------------------------ leitura (visoes) ------------------------------ */

interface RunRow {
  stepKey: string;
  status: 'WAITING' | 'READY' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED' | 'CANCELLED';
  blocked: boolean;
  blockedReason: string | null;
  assigneeMemberId: string | null;
  assigneeSource: string;
  functionId: string | null;
  releasedAt: Date | null;
  dueDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  evidenceLink: string | null;
  evidenceNote: string | null;
  asanaProjectGid: string | null;
  skipReason: string | null;
}

async function buildExecutionView(ctx: ExecutionContext, executionId: string, opts: { withEvents: boolean }) {
  const execution = await prisma.onboardingExecution.findFirst({
    where: { id: executionId, organizationId: ctx.organizationId },
    include: {
      stepRuns: true,
      template: { select: { name: true } },
      version: { select: { versionNumber: true } },
      client: { select: { name: true } },
    },
  });
  if (!execution) throw notFound();
  const scoped = await findClientInResourceScope(
    prisma,
    { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role },
    execution.clientId
  );
  if (!scoped) throw notFound();

  const [defs, org, execFlag, overrideFlag] = await Promise.all([
    loadSteps(prisma, ctx.organizationId, execution.versionId),
    prisma.organizationConfig.findUnique({ where: { organizationId: ctx.organizationId }, select: { timezone: true } }),
    hasPermission(ctx, 'onboarding.execute'),
    hasPermission(ctx, 'onboarding.override'),
  ]);
  const timeZone = org?.timezone;
  const defRows = await prisma.onboardingStepDefinition.findMany({
    where: { organizationId: ctx.organizationId, versionId: execution.versionId },
    select: { stepKey: true, title: true, description: true, position: true },
  });
  const defMeta = new Map(defRows.map((d) => [d.stepKey, d] as const));
  const defByKey = new Map(defs.map((d) => [d.stepKey, d] as const));

  const assigneeIds = execution.stepRuns.map((r) => r.assigneeMemberId).filter((v): v is string => Boolean(v));
  const eligible = await eligibleMemberIds(prisma, ctx.organizationId, execution.clientId, assigneeIds);
  const people = assigneeIds.length
    ? await prisma.organizationMember.findMany({
        where: { organizationId: ctx.organizationId, id: { in: [...new Set(assigneeIds)] } },
        select: { id: true, status: true, user: { select: { name: true } } },
      })
    : [];
  const personById = new Map(people.map((p) => [p.id, p] as const));
  const fnIds = [...new Set(execution.stepRuns.map((r) => r.functionId).filter((v): v is string => Boolean(v)))];
  const fns = fnIds.length
    ? await prisma.organizationFunction.findMany({ where: { organizationId: ctx.organizationId, id: { in: fnIds } }, select: { id: true, name: true } })
    : [];
  const fnName = new Map(fns.map((f) => [f.id, f.name] as const));

  const outboxRows = await prisma.automationOutbox.findMany({
    where: { organizationId: ctx.organizationId, executionId, eventType: 'STEP_AUTOMATION' },
    orderBy: { generation: 'desc' },
  });
  const latestOutbox = new Map<string, (typeof outboxRows)[number]>();
  for (const o of outboxRows) if (o.stepKey && !latestOutbox.has(o.stepKey)) latestOutbox.set(o.stepKey, o);
  const needsCalendar = execution.stepRuns.some(
    (r) => isOpenStep(r.status) && defByKey.get(r.stepKey)?.completionCondition === 'CALENDAR_EVENT_LINKED'
  );
  const calendarCtx = needsCalendar ? await calendarContextFor(prisma, ctx, execution.clientId) : null;

  const steps = [...execution.stepRuns]
    .sort((a, b) => (defMeta.get(a.stepKey)?.position ?? 0) - (defMeta.get(b.stepKey)?.position ?? 0))
    .map((r) => {
      const meta = defMeta.get(r.stepKey);
      const def = defByKey.get(r.stepKey);
      const dueDate = isoDay(r.dueDate);
      const assigneeEligible = r.assigneeMemberId ? eligible.has(r.assigneeMemberId) : false;
      const open = isOpenStep(r.status);
      const assigneeIssue: null | 'UNASSIGNED' | 'INACTIVE_OR_OUT_OF_SCOPE' = !open || def?.kind === 'AUTOMATION'
        ? null
        : !r.assigneeMemberId
          ? 'UNASSIGNED'
          : assigneeEligible
            ? null
            : 'INACTIVE_OR_OUT_OF_SCOPE';
      const stateActions = allowedStepActions(
        { stepKey: r.stepKey, status: r.status, blocked: r.blocked },
        { automatic: def?.completionCondition === 'AUTOMATION_SUCCEEDED' }
      );
      const outbox = latestOutbox.get(r.stepKey) ?? null;
      const mayAct = canActOnStep({
        actorMemberId: ctx.membershipId,
        hasExecute: execFlag,
        hasOverride: overrideFlag,
        assigneeMemberId: r.assigneeMemberId,
        assigneeEligible,
      });
      const actions = execution.status !== 'ACTIVE'
        ? []
        : stateActions.filter((a) => (a === 'skip' || a === 'reassign' ? overrideFlag : mayAct));
      return {
        stepKey: r.stepKey,
        title: meta?.title ?? r.stepKey,
        description: meta?.description ?? null,
        position: meta?.position ?? 0,
        kind: def?.kind ?? 'MANUAL',
        status: r.status,
        blocked: r.blocked,
        blockedReason: r.blockedReason,
        blocksCompletion: def?.blocksCompletion ?? false,
        completionCondition: def?.completionCondition ?? 'CONFIRMATION',
        evidenceKind: def?.evidenceKind ?? 'NONE',
        dependsOn: def?.dependsOn ?? [],
        assigneeMemberId: r.assigneeMemberId,
        assigneeName: r.assigneeMemberId ? personById.get(r.assigneeMemberId)?.user.name ?? null : null,
        assigneeSource: r.assigneeSource,
        assigneeIssue,
        functionId: r.functionId,
        functionName: r.functionId ? fnName.get(r.functionId) ?? null : null,
        releasedAt: r.releasedAt?.toISOString() ?? null,
        dueDate,
        late: isStepLate({ status: r.status, dueDate }, timeZone),
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        evidenceLink: r.evidenceLink,
        evidenceNote: r.evidenceNote,
        asanaProjectGid: r.asanaProjectGid,
        // F7-3c: condicao do Calendar (atendida / pendente / indisponivel) e instantaneo do evento usado
        calendarCondition:
          calendarCtx && open && def?.completionCondition === 'CALENDAR_EVENT_LINKED'
            ? {
                state: calendarCtx.condition.state,
                reason: calendarCtx.condition.reason,
                candidates: calendarCtx.candidates.filter((c) => c.eligible),
                ineligible: calendarCtx.candidates.filter((c) => !c.eligible).slice(0, 5),
              }
            : null,
        completedBySystem: r.completedBySystem,
        // F7-4a: estado da automacao (so etapas AUTOMATION). Despachante desligado = nunca concluida.
        automation:
          def?.kind === 'AUTOMATION'
            ? {
                flowKey: def.automationKey ?? null,
                status: outbox?.status ?? null,
                generation: outbox?.generation ?? null,
                attempts: outbox?.attempts ?? 0,
                sentAt: outbox?.sentAt?.toISOString() ?? null,
                finishedAt: outbox?.finishedAt?.toISOString() ?? null,
                lastError: outbox?.lastError ?? null,
                resultCode: outbox?.resultCode ?? null,
                resultMessage: outbox?.resultMessage ?? null,
                externalRefs: (outbox?.externalRefs as unknown) ?? [],
                appliedAt: outbox?.appliedAt?.toISOString() ?? null,
                dispatcherEnabled: dispatcherEnabled(),
                canResend: Boolean(outbox && ['FAILED', 'TIMED_OUT', 'DEAD'].includes(outbox.status)) && isOpenStep(r.status) && execution.status === 'ACTIVE',
              }
            : null,
        calendarEvent: r.calendarEventId
          ? { id: r.calendarEventId, title: r.calendarEventTitle, startAt: r.calendarEventStartAt?.toISOString() ?? null }
          : null,
        skipReason: r.skipReason,
        actions,
      };
    });

  const events = opts.withEvents
    ? await prisma.onboardingExecutionEvent.findMany({
        where: { organizationId: ctx.organizationId, executionId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    : [];
  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((v): v is string => Boolean(v)))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name] as const));

  return {
    id: execution.id,
    clientId: execution.clientId,
    clientName: execution.client.name,
    templateId: execution.templateId,
    templateName: execution.template.name,
    versionId: execution.versionId,
    versionNumber: execution.version.versionNumber,
    status: execution.status,
    startTrigger: execution.startTrigger,
    startedAt: execution.startedAt.toISOString(),
    startedByUserId: execution.startedByUserId,
    completedAt: execution.completedAt?.toISOString() ?? null,
    completionMode: execution.completionMode,
    cancelledAt: execution.cancelledAt?.toISOString() ?? null,
    cancelReason: execution.cancelReason,
    progress: progressOf(steps),
    counts: {
      late: steps.filter((s) => s.late).length,
      blocked: steps.filter((s) => s.blocked && isOpenStep(s.status)).length,
      unresolved: steps.filter((s) => s.assigneeIssue !== null).length,
    },
    steps,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      stepKey: e.stepKey,
      actorUserId: e.actorUserId,
      actorName: e.actorUserId ? actorName.get(e.actorUserId) ?? null : null,
      reason: e.reason,
      before: e.before,
      after: e.after,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/* ------------------------------ servico ------------------------------ */

export class OnboardingExecutionService {
  /* ----- inicio (B2) ----- */
  async start(
    ctx: ExecutionContext,
    input: StartOnboardingExecutionRequest,
    origin: { trigger: OnboardingStartTrigger; sourceRef?: string | null } = { trigger: 'MANUAL' }
  ) {
    const client = await findClientInResourceScope(
      prisma,
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role },
      input.clientId
    );
    if (!client) throw notFound('Cliente');

    if (input.requestId) {
      const same = await prisma.onboardingExecution.findFirst({
        where: { organizationId: ctx.organizationId, requestId: input.requestId },
        select: { id: true, clientId: true, templateId: true },
      });
      if (same) {
        if (same.clientId !== input.clientId || same.templateId !== input.templateId) {
          throw new OnboardingError(409, 'REQUEST_ID_REUSED', 'Este requestId ja foi usado para outro onboarding.');
        }
        return buildExecutionView(ctx, same.id, { withEvents: true });
      }
    }

    const template = await prisma.onboardingTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.organizationId } });
    if (!template) throw notFound('Modelo de onboarding');
    if (template.status === 'ARCHIVED') {
      throw new OnboardingError(409, 'TEMPLATE_ARCHIVED', 'Modelo arquivado nao aceita novos onboardings. Reative-o antes.');
    }
    const version = await prisma.onboardingTemplateVersion.findFirst({
      where: { templateId: template.id, organizationId: ctx.organizationId, status: 'PUBLISHED' },
      orderBy: { versionNumber: 'desc' },
    });
    if (!version) throw new OnboardingError(409, 'NO_PUBLISHED_VERSION', 'O modelo ainda nao tem versao publicada.');

    const defs = await loadSteps(prisma, ctx.organizationId, version.id);
    const stepKeys = new Set(defs.map((d) => d.stepKey));
    for (const key of Object.keys(input.assignments)) {
      if (!stepKeys.has(key)) throw new OnboardingError(400, 'UNKNOWN_STEP', `Etapa inexistente neste modelo: ${key}.`);
    }

    const fnIds = [...new Set(defs.map((d) => d.functionId).filter((v): v is string => Boolean(v)))];
    const fnLinks = fnIds.length
      ? await prisma.organizationFunctionMember.findMany({
          where: { organizationId: ctx.organizationId, functionId: { in: fnIds }, function: { isActive: true } },
          select: { functionId: true, organizationMemberId: true },
        })
      : [];
    const functionMembers = new Map<string, string[]>();
    for (const l of fnLinks) functionMembers.set(l.functionId, [...(functionMembers.get(l.functionId) ?? []), l.organizationMemberId]);

    const candidateIds = [
      ...defs.map((d) => d.memberId).filter((v): v is string => Boolean(v)),
      ...fnLinks.map((l) => l.organizationMemberId),
      ...Object.values(input.assignments),
    ];
    const eligible = await eligibleMemberIds(prisma, ctx.organizationId, input.clientId, candidateIds);
    for (const [key, memberId] of Object.entries(input.assignments)) {
      if (!eligible.has(memberId)) {
        throw new OnboardingError(
          400,
          'ASSIGNEE_NOT_ELIGIBLE',
          `A pessoa escolhida para a etapa ${key} nao esta ativa ou nao tem este cliente na carteira.`
        );
      }
    }

    const org = await prisma.organizationConfig.findUnique({ where: { organizationId: ctx.organizationId }, select: { timezone: true } });
    const startedAt = new Date();
    const plan = planExecutionStart(defs, { startedAt, timeZone: org?.timezone });
    const planByKey = new Map(plan.map((p) => [p.stepKey, p] as const));
    const resolutions = new Map(
      defs.map((d) => [d.stepKey, resolveAssignee(d, { eligible, functionMembers, chosen: input.assignments[d.stepKey] })] as const)
    );

    let executionId: string;
    try {
      executionId = await prisma.$transaction(async (tx) => {
        const created = await tx.onboardingExecution.create({
          data: {
            organizationId: ctx.organizationId,
            clientId: input.clientId,
            templateId: template.id,
            versionId: version.id,
            startTrigger: origin.trigger,
            sourceRef: origin.sourceRef ?? null,
            requestId: input.requestId ?? null,
            startedAt,
            startedByUserId: ctx.userId,
          },
        });
        await tx.onboardingStepRun.createMany({
          data: defs.map((d) => {
            const p = planByKey.get(d.stepKey)!;
            const r = resolutions.get(d.stepKey)!;
            return {
              organizationId: ctx.organizationId,
              executionId: created.id,
              versionId: version.id,
              stepKey: d.stepKey,
              status: p.status,
              assigneeMemberId: r.memberId,
              assigneeSource: r.source,
              functionId: d.assigneeMode === 'FUNCTION' ? d.functionId ?? null : null,
              releasedAt: p.releasedAt,
              dueDate: dayToDate(p.dueDate),
            };
          }),
        });
        const unresolved = defs.filter((d) => resolutions.get(d.stepKey)!.unresolved !== null).map((d) => d.stepKey);
        await recordEvent(tx, ctx, {
          executionId: created.id,
          type: 'EXECUTION_STARTED',
          after: {
            clientId: input.clientId,
            templateId: template.id,
            versionId: version.id,
            versionNumber: version.versionNumber,
            trigger: origin.trigger,
            steps: defs.length,
            unresolvedStepKeys: unresolved,
          },
        });
        // F7-4a: pedidos persistidos NA MESMA transacao (outbox); o envio e feito depois pelo despachante
        for (const d of defs) {
          if (d.kind === 'AUTOMATION' && d.automationKey && planByKey.get(d.stepKey)?.status === 'READY') {
            await enqueueStepAutomation(tx, { organizationId: ctx.organizationId, executionId: created.id, stepKey: d.stepKey, flowKey: d.automationKey });
          }
        }
        await enqueueLifecycle(tx, { organizationId: ctx.organizationId, executionId: created.id, eventType: 'EXECUTION_STARTED' });
        return created.id;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2010')) {
        if (input.requestId) {
          const again = await prisma.onboardingExecution.findFirst({
            where: { organizationId: ctx.organizationId, requestId: input.requestId },
            select: { id: true, clientId: true, templateId: true },
          });
          if (again && again.clientId === input.clientId && again.templateId === input.templateId) {
            return buildExecutionView(ctx, again.id, { withEvents: true });
          }
        }
        const active = await prisma.onboardingExecution.findFirst({
          where: { organizationId: ctx.organizationId, clientId: input.clientId, templateId: template.id, status: 'ACTIVE' },
          select: { id: true },
        });
        const err = new OnboardingError(409, 'EXECUTION_ALREADY_ACTIVE', 'Ja existe um onboarding ativo deste modelo para este cliente.');
        (err as OnboardingError & { existingId?: string }).existingId = active?.id;
        throw err;
      }
      if (message.includes('onboarding_execution_version_invalid')) {
        throw new OnboardingError(409, 'NO_PUBLISHED_VERSION', 'A versao publicada do modelo mudou. Tente novamente.');
      }
      throw error;
    }
    return buildExecutionView(ctx, executionId, { withEvents: true });
  }

  /* ----- leitura ----- */
  async get(ctx: ExecutionContext, id: string) {
    return buildExecutionView(ctx, id, { withEvents: true });
  }

  async list(
    ctx: ExecutionContext,
    filters: { status?: string; clientId?: string; templateId?: string; assigneeId?: string; late?: boolean; blocked?: boolean }
  ) {
    const org = await prisma.organizationConfig.findUnique({ where: { organizationId: ctx.organizationId }, select: { timezone: true } });
    const rows = await prisma.onboardingExecution.findMany({
      where: {
        organizationId: ctx.organizationId,
        client: buildClientResourceScopeWhere({ organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role }),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.templateId ? { templateId: filters.templateId } : {}),
        ...(filters.assigneeId ? { stepRuns: { some: { assigneeMemberId: filters.assigneeId } } } : {}),
      },
      include: {
        stepRuns: true,
        client: { select: { name: true } },
        template: { select: { name: true } },
        version: { select: { versionNumber: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
    const automatic = await automaticStepKeys(prisma, rows.map((e) => e.versionId));
    const items = rows.map((e) => {
      const runs = e.stepRuns;
      const late = runs.filter((r) => isStepLate({ status: r.status, dueDate: isoDay(r.dueDate) }, org?.timezone)).length;
      const blocked = runs.filter((r) => r.blocked && isOpenStep(r.status)).length;
      const unassigned = runs.filter((r) => isOpenStep(r.status) && !r.assigneeMemberId && !automatic.has(`${e.versionId}:${r.stepKey}`)).length;
      return {
        id: e.id,
        clientId: e.clientId,
        clientName: e.client.name,
        templateId: e.templateId,
        templateName: e.template.name,
        versionNumber: e.version.versionNumber,
        status: e.status,
        startedAt: e.startedAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
        cancelledAt: e.cancelledAt?.toISOString() ?? null,
        progress: progressOf(runs),
        counts: { late, blocked, unassigned },
      };
    });
    return items.filter((i) => (filters.late ? i.counts.late > 0 : true) && (filters.blocked ? i.counts.blocked > 0 : true));
  }

  /** Etapas abertas atribuidas a quem consulta, nos clientes da sua carteira. */
  async mySteps(ctx: ExecutionContext) {
    const org = await prisma.organizationConfig.findUnique({ where: { organizationId: ctx.organizationId }, select: { timezone: true } });
    const runs = await prisma.onboardingStepRun.findMany({
      where: {
        organizationId: ctx.organizationId,
        assigneeMemberId: ctx.membershipId,
        status: { in: ['WAITING', 'READY', 'IN_PROGRESS'] },
        execution: {
          status: 'ACTIVE',
          client: buildClientResourceScopeWhere({ organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role }),
        },
      },
      include: { execution: { select: { id: true, clientId: true, templateId: true, versionId: true, client: { select: { name: true } }, template: { select: { name: true } } } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    const titles = runs.length
      ? await prisma.onboardingStepDefinition.findMany({
          where: { organizationId: ctx.organizationId, versionId: { in: [...new Set(runs.map((r) => r.versionId))] } },
          select: { versionId: true, stepKey: true, title: true },
        })
      : [];
    const title = new Map(titles.map((t) => [`${t.versionId}:${t.stepKey}`, t.title] as const));
    return runs.map((r) => ({
      executionId: r.executionId,
      clientId: r.execution.clientId,
      clientName: r.execution.client.name,
      templateName: r.execution.template.name,
      stepKey: r.stepKey,
      title: title.get(`${r.versionId}:${r.stepKey}`) ?? r.stepKey,
      status: r.status,
      blocked: r.blocked,
      dueDate: isoDay(r.dueDate),
      late: isStepLate({ status: r.status, dueDate: isoDay(r.dueDate) }, org?.timezone),
    }));
  }

  /** Agregados do painel do gestor (somente carteira do usuario). */
  async overview(ctx: ExecutionContext) {
    const org = await prisma.organizationConfig.findUnique({ where: { organizationId: ctx.organizationId }, select: { timezone: true } });
    const scope = buildClientResourceScopeWhere({ organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role });
    const active = await prisma.onboardingExecution.findMany({
      where: { organizationId: ctx.organizationId, status: 'ACTIVE', client: scope },
      select: { id: true, clientId: true, versionId: true, stepRuns: true },
    });
    const automatic = await automaticStepKeys(prisma, active.map((e) => e.versionId));
    const since = new Date(Date.now() - 30 * 86_400_000);
    const completedLast30Days = await prisma.onboardingExecution.count({
      where: { organizationId: ctx.organizationId, status: 'COMPLETED', completedAt: { gte: since }, client: scope },
    });
    let lateSteps = 0;
    let blockedSteps = 0;
    let unassignedSteps = 0;
    let inactiveAssigneeSteps = 0;
    const byAssignee = new Map<string, number>();
    for (const e of active) {
      const open = e.stepRuns.filter((r) => isOpenStep(r.status));
      const eligible = await eligibleMemberIds(
        prisma,
        ctx.organizationId,
        e.clientId,
        open.map((r) => r.assigneeMemberId).filter((v): v is string => Boolean(v))
      );
      for (const r of open) {
        if (isStepLate({ status: r.status, dueDate: isoDay(r.dueDate) }, org?.timezone)) lateSteps++;
        if (r.blocked) blockedSteps++;
        if (!r.assigneeMemberId) {
          if (!automatic.has(`${e.versionId}:${r.stepKey}`)) unassignedSteps++;
        } else if (!eligible.has(r.assigneeMemberId)) inactiveAssigneeSteps++;
        if (r.assigneeMemberId) byAssignee.set(r.assigneeMemberId, (byAssignee.get(r.assigneeMemberId) ?? 0) + 1);
      }
    }
    const ids = [...byAssignee.keys()];
    const people = ids.length
      ? await prisma.organizationMember.findMany({
          where: { organizationId: ctx.organizationId, id: { in: ids } },
          select: { id: true, user: { select: { name: true } } },
        })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, p.user.name] as const));
    return {
      activeExecutions: active.length,
      lateSteps,
      blockedSteps,
      unassignedSteps,
      inactiveAssigneeSteps,
      completedLast30Days,
      openStepsByAssignee: ids
        .map((id) => ({ memberId: id, name: nameOf.get(id) ?? null, openSteps: byAssignee.get(id) ?? 0 }))
        .sort((a, b) => b.openSteps - a.openSteps),
    };
  }

  /* ----- acoes ----- */

  /** Carrega e trava a execucao (FOR UPDATE), valida carteira (404) e situacao ATIVA (409). */
  private async lock(tx: Tx, ctx: ExecutionContext, executionId: string) {
    const exec = await tx.onboardingExecution.findFirst({ where: { id: executionId, organizationId: ctx.organizationId } });
    if (!exec) throw notFound();
    const scoped = await findClientInResourceScope(
      tx,
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, role: ctx.role },
      exec.clientId
    );
    if (!scoped) throw notFound();
    await tx.$queryRaw`SELECT "id" FROM "onboarding_executions" WHERE "id" = ${executionId} AND "organizationId" = ${ctx.organizationId} FOR UPDATE`;
    const locked = await tx.onboardingExecution.findFirstOrThrow({ where: { id: executionId, organizationId: ctx.organizationId } });
    if (locked.status !== 'ACTIVE') {
      throw new OnboardingError(409, 'EXECUTION_CLOSED', 'Este onboarding ja foi encerrado.');
    }
    return locked;
  }

  private async stepContext(tx: Tx, ctx: ExecutionContext, executionId: string, stepKey: string) {
    const exec = await this.lock(tx, ctx, executionId);
    const [runs, defs] = await Promise.all([
      tx.onboardingStepRun.findMany({ where: { executionId, organizationId: ctx.organizationId } }),
      loadSteps(tx, ctx.organizationId, exec.versionId),
    ]);
    const run = runs.find((r) => r.stepKey === stepKey);
    const def = defs.find((d) => d.stepKey === stepKey);
    if (!run || !def) throw notFound('Etapa');
    return { exec, runs, defs, run, def };
  }

  private async assertMayAct(tx: Tx, ctx: ExecutionContext, clientId: string, assigneeMemberId: string | null) {
    const [hasExecute, hasOverride] = await Promise.all([hasPermission(ctx, 'onboarding.execute'), hasPermission(ctx, 'onboarding.override')]);
    const eligible = assigneeMemberId ? await eligibleMemberIds(tx, ctx.organizationId, clientId, [assigneeMemberId]) : new Set<string>();
    const ok = canActOnStep({
      actorMemberId: ctx.membershipId,
      hasExecute,
      hasOverride,
      assigneeMemberId,
      assigneeEligible: assigneeMemberId ? eligible.has(assigneeMemberId) : false,
    });
    if (!ok) {
      const unresolved = !assigneeMemberId || !eligible.has(assigneeMemberId);
      throw new OnboardingError(
        403,
        unresolved ? 'OVERRIDE_REQUIRED' : 'NOT_ASSIGNEE',
        unresolved
          ? 'Esta etapa nao tem responsavel elegivel. Somente quem tem permissao de excecao pode agir ate que um responsavel seja atribuido.'
          : 'Somente o responsavel pela etapa (ou quem tem permissao de excecao) pode executar esta acao.'
      );
    }
  }

  private requireState(
    run: { stepKey: string; status: RunRow['status']; blocked: boolean },
    action: StepAction,
    automatic = false
  ) {
    if (!allowedStepActions(run, { automatic }).includes(action)) {
      throw new OnboardingError(409, 'INVALID_STATE', `A acao nao e possivel na situacao atual da etapa (${run.status}${run.blocked ? ', bloqueada' : ''}).`);
    }
  }

  /** Libera dependentes e conclui automaticamente quando nada mais esta aberto. */
  private async afterClosing(tx: Tx, ctx: ExecutionContext, exec: { id: string; organizationId: string }, defs: OnboardingStepInput[], now: Date) {
    const runs = await tx.onboardingStepRun.findMany({ where: { executionId: exec.id } });
    const org = await tx.organizationConfig.findUnique({ where: { organizationId: ctx.organizationId }, select: { timezone: true } });
    const keys = findReleasable(defs, runs.map((r) => ({ stepKey: r.stepKey, status: r.status, blocked: r.blocked })));
    for (const key of keys) {
      const def = defs.find((d) => d.stepKey === key)!;
      const current = runs.find((r) => r.stepKey === key)!;
      const dueDate = def.dueAnchor === 'RELEASED' ? computeDueDate(now, def.dueBusinessDays, org?.timezone) : isoDay(current.dueDate);
      await tx.onboardingStepRun.update({
        where: { executionId_stepKey: { executionId: exec.id, stepKey: key } },
        data: { status: 'READY', releasedAt: now, dueDate: dayToDate(dueDate) },
      });
      await recordEvent(tx, ctx, { executionId: exec.id, stepKey: key, type: 'STEP_RELEASED', after: { dueDate } });
      if (def.kind === 'AUTOMATION' && def.automationKey) {
        await enqueueStepAutomation(tx, { organizationId: ctx.organizationId, executionId: exec.id, stepKey: key, flowKey: def.automationKey });
      }
    }
    const fresh = await tx.onboardingStepRun.findMany({ where: { executionId: exec.id }, select: { status: true } });
    if (isAutoCompletable(fresh)) {
      await tx.onboardingExecution.update({
        where: { id: exec.id },
        data: { status: 'COMPLETED', completedAt: now, completedByUserId: ctx.userId === SYSTEM_USER ? null : ctx.userId, completionMode: 'AUTO' },
      });
      await recordEvent(tx, ctx, { executionId: exec.id, type: 'EXECUTION_COMPLETED', after: { mode: 'AUTO' } });
      await enqueueLifecycle(tx, { organizationId: ctx.organizationId, executionId: exec.id, eventType: 'EXECUTION_COMPLETED' });
    }
  }

  /**
   * Conclui a etapa AUTOMATION por resultado SUCCEEDED ja validado (pedido SENT, assinado, geracao vigente).
   * Respeita bloqueio: etapa bloqueada nao conclui; o resultado fica registrado e e aplicado ao desbloquear.
   * Devolve true se concluiu agora.
   */
  async applyAutomationSuccess(tx: Tx, organizationId: string, executionId: string, stepKey: string, outboxId: string): Promise<boolean> {
    const sys: ExecutionContext = { organizationId, userId: SYSTEM_USER, membershipId: '', role: 'ADMIN' };
    await tx.$queryRaw`SELECT "id" FROM "onboarding_executions" WHERE "id" = ${executionId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const exec = await tx.onboardingExecution.findFirst({ where: { id: executionId, organizationId } });
    if (!exec || exec.status !== 'ACTIVE') return false;
    const run = await tx.onboardingStepRun.findFirst({ where: { executionId, stepKey } });
    if (!run || !isOpenStep(run.status) || run.blocked) return false;
    const defs = await loadSteps(tx, organizationId, exec.versionId);
    const def = defs.find((d) => d.stepKey === stepKey);
    if (!def || def.completionCondition !== 'AUTOMATION_SUCCEEDED') return false;
    const now = new Date();
    await tx.onboardingStepRun.update({
      where: { executionId_stepKey: { executionId, stepKey } },
      data: { status: 'DONE', completedAt: now, completedByUserId: null, completedBySystem: true },
    });
    await tx.automationOutbox.update({ where: { id: outboxId }, data: { appliedAt: now } });
    await recordEvent(tx, sys, {
      executionId,
      stepKey,
      type: 'STEP_COMPLETED',
      before: { status: run.status },
      after: { status: 'DONE', condition: 'AUTOMATION_SUCCEEDED', completedBySystem: true, outboxId },
    });
    await this.afterClosing(tx, sys, exec, defs, now);
    return true;
  }

  /** Apos desbloquear: aplica o ultimo resultado SUCCEEDED ainda nao aplicado desta etapa. */
  private async applyPendingAutomationResult(tx: Tx, ctx: ExecutionContext, exec: { id: string; organizationId: string }, _defs: OnboardingStepInput[], stepKey: string) {
    const pending = await tx.automationOutbox.findFirst({
      where: { organizationId: ctx.organizationId, executionId: exec.id, stepKey, eventType: 'STEP_AUTOMATION', status: 'SUCCEEDED', appliedAt: null },
      orderBy: { generation: 'desc' },
    });
    if (pending) await this.applyAutomationSuccess(tx, ctx.organizationId, exec.id, stepKey, pending.id);
  }

  private async act<T>(ctx: ExecutionContext, executionId: string, fn: (tx: Tx) => Promise<T>) {
    try {
      await prisma.$transaction(async (tx) => {
        await fn(tx);
      });
    } catch (error) {
      return mapDbError(error);
    }
    return buildExecutionView(ctx, executionId, { withEvents: true });
  }

  async startStep(ctx: ExecutionContext, executionId: string, stepKey: string) {
    return this.act(ctx, executionId, async (tx) => {
      const { exec, run, def } = await this.stepContext(tx, ctx, executionId, stepKey);
      this.requireState(run, 'start', def.completionCondition === 'AUTOMATION_SUCCEEDED');
      await this.assertMayAct(tx, ctx, exec.clientId, run.assigneeMemberId);
      await tx.onboardingStepRun.update({
        where: { executionId_stepKey: { executionId, stepKey } },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      await recordEvent(tx, ctx, { executionId, stepKey, type: 'STEP_STARTED', before: { status: run.status }, after: { status: 'IN_PROGRESS' } });
    });
  }

  async completeStep(ctx: ExecutionContext, executionId: string, stepKey: string, input: CompleteOnboardingStepRequest) {
    return this.act(ctx, executionId, async (tx) => {
      const { exec, defs, run, def } = await this.stepContext(tx, ctx, executionId, stepKey);
      if (def.completionCondition === 'AUTOMATION_SUCCEEDED') {
        // D2/D4: nunca por acao manual; so o resultado autenticado da automacao conclui
        throw new OnboardingError(
          409,
          'AUTOMATION_MANUAL_COMPLETION_NOT_ALLOWED',
          'Esta etapa conclui somente pelo resultado da automacao. Reenvie ou dispense com justificativa.'
        );
      }
      this.requireState(run, 'complete');
      await this.assertMayAct(tx, ctx, exec.clientId, run.assigneeMemberId);
      const problems = validateStepCompletion(def, input);
      if (problems.length > 0) {
        throw new OnboardingError(400, 'COMPLETION_CONDITION_NOT_MET', problems[0].message);
      }
      if (def.completionCondition === 'ASANA_PROJECT_LINKED') {
        // So leitura local: o projeto precisa ja estar vinculado ao cliente. Nenhuma chamada ao Asana.
        const linked = await tx.clientIntegration.findFirst({
          where: { clientId: exec.clientId, provider: 'ASANA', externalId: input.asanaProjectGid ?? '' },
          select: { id: true },
        });
        if (!linked) {
          throw new OnboardingError(400, 'ASANA_PROJECT_NOT_LINKED', 'O projeto escolhido nao esta vinculado a este cliente.');
        }
      }
      let calendarSnapshot: { id: string; title: string; startAt: Date | null } | null = null;
      if (def.completionCondition === 'CALENDAR_EVENT_LINKED') {
        // So dados locais ja sincronizados; a pessoa escolhe o evento e o servidor confere vinculo e situacao.
        const cal = await calendarContextFor(tx, ctx, exec.clientId);
        if (cal.condition.state === 'UNAVAILABLE') {
          throw new OnboardingError(
            409,
            'CALENDAR_UNAVAILABLE',
            cal.condition.reason === 'CONNECTION_UNAVAILABLE'
              ? 'A conexao com o Google Calendar esta revogada ou desconectada; a condicao nao pode ser conferida. Reconecte a conta ou dispense a etapa com justificativa.'
              : 'Nenhum calendario esta monitorado; a condicao nao pode ser conferida.'
          );
        }
        const chosen = cal.candidates.find((c) => c.id === input.calendarEventId);
        if (!chosen) {
          throw new OnboardingError(400, 'CALENDAR_EVENT_NOT_LINKED', 'O evento escolhido nao esta vinculado a este cliente.');
        }
        if (!chosen.eligible) {
          throw new OnboardingError(409, 'CALENDAR_EVENT_NOT_ELIGIBLE', `O evento escolhido nao pode ser usado: ${chosen.reason}.`);
        }
        calendarSnapshot = {
          id: chosen.id,
          title: chosen.title,
          startAt: chosen.startAt ? new Date(chosen.startAt) : chosen.startDate ? new Date(`${chosen.startDate}T00:00:00.000Z`) : null,
        };
      }
      const now = new Date();
      await tx.onboardingStepRun.update({
        where: { executionId_stepKey: { executionId, stepKey } },
        data: {
          status: 'DONE',
          completedAt: now,
          completedByUserId: ctx.userId,
          calendarEventId: calendarSnapshot?.id ?? null,
          calendarEventTitle: calendarSnapshot?.title ?? null,
          calendarEventStartAt: calendarSnapshot?.startAt ?? null,
          evidenceLink: input.evidenceLink?.trim() || null,
          evidenceNote: input.evidenceNote?.trim() || null,
          asanaProjectGid: def.completionCondition === 'ASANA_PROJECT_LINKED' ? input.asanaProjectGid ?? null : null,
        },
      });
      await recordEvent(tx, ctx, {
        executionId,
        stepKey,
        type: 'STEP_COMPLETED',
        before: { status: run.status },
        after: {
          status: 'DONE',
          condition: def.completionCondition,
          hasEvidence: Boolean(input.evidenceLink?.trim() || input.evidenceNote?.trim()),
          calendarEventId: calendarSnapshot?.id ?? null,
          viaOverrideWithoutAssignee: !run.assigneeMemberId,
        },
      });
      await this.afterClosing(tx, ctx, exec, defs, now);
    });
  }

  async blockStep(ctx: ExecutionContext, executionId: string, stepKey: string, input: BlockOnboardingStepRequest) {
    return this.act(ctx, executionId, async (tx) => {
      const { exec, run } = await this.stepContext(tx, ctx, executionId, stepKey);
      this.requireState(run, 'block');
      await this.assertMayAct(tx, ctx, exec.clientId, run.assigneeMemberId);
      await tx.onboardingStepRun.update({
        where: { executionId_stepKey: { executionId, stepKey } },
        data: { blocked: true, blockedReason: input.reason, blockedAt: new Date() },
      });
      await recordEvent(tx, ctx, { executionId, stepKey, type: 'STEP_BLOCKED', reason: input.reason, before: { blocked: false }, after: { blocked: true } });
    });
  }

  async unblockStep(ctx: ExecutionContext, executionId: string, stepKey: string, input: UnblockOnboardingStepRequest) {
    return this.act(ctx, executionId, async (tx) => {
      const { exec, run, defs } = await this.stepContext(tx, ctx, executionId, stepKey);
      this.requireState(run, 'unblock');
      await this.assertMayAct(tx, ctx, exec.clientId, run.assigneeMemberId);
      await tx.onboardingStepRun.update({
        where: { executionId_stepKey: { executionId, stepKey } },
        data: { blocked: false, blockedReason: null, blockedAt: null },
      });
      await this.applyPendingAutomationResult(tx, ctx, exec, defs, stepKey);
      await recordEvent(tx, ctx, {
        executionId,
        stepKey,
        type: 'STEP_UNBLOCKED',
        reason: input.reason ?? null,
        before: { blocked: true, reason: run.blockedReason },
        after: { blocked: false },
      });
    });
  }

  /** Dispensar: somente `override` (garantido pela rota e conferido aqui). P4: destaque quando bloqueante. */
  async skipStep(ctx: ExecutionContext, executionId: string, stepKey: string, input: SkipOnboardingStepRequest) {
    return this.act(ctx, executionId, async (tx) => {
      if (!(await hasPermission(ctx, 'onboarding.override'))) {
        throw new OnboardingError(403, 'OVERRIDE_REQUIRED', 'Somente quem tem permissao de excecao pode dispensar etapas.');
      }
      const { exec, defs, run, def } = await this.stepContext(tx, ctx, executionId, stepKey);
      this.requireState(run, 'skip');
      const now = new Date();
      await tx.onboardingStepRun.update({
        where: { executionId_stepKey: { executionId, stepKey } },
        data: { status: 'SKIPPED', blocked: false, blockedReason: null, blockedAt: null, skipReason: input.reason, skippedByUserId: ctx.userId, completedAt: now },
      });
      await recordEvent(tx, ctx, {
        executionId,
        stepKey,
        type: 'STEP_SKIPPED',
        reason: input.reason,
        before: { status: run.status, blocked: run.blocked },
        after: { status: 'SKIPPED', blocksCompletion: def.blocksCompletion, highlight: def.blocksCompletion ? 'BLOCKING_STEP_SKIPPED' : null },
      });
      await this.afterClosing(tx, ctx, exec, defs, now);
    });
  }

  async reassignStep(ctx: ExecutionContext, executionId: string, stepKey: string, input: ReassignOnboardingStepRequest) {
    return this.act(ctx, executionId, async (tx) => {
      if (!(await hasPermission(ctx, 'onboarding.override'))) {
        throw new OnboardingError(403, 'OVERRIDE_REQUIRED', 'Somente quem tem permissao de excecao pode reatribuir etapas.');
      }
      const { exec, run } = await this.stepContext(tx, ctx, executionId, stepKey);
      this.requireState(run, 'reassign');
      const eligible = await eligibleMemberIds(tx, ctx.organizationId, exec.clientId, [input.memberId]);
      if (!eligible.has(input.memberId)) {
        throw new OnboardingError(400, 'ASSIGNEE_NOT_ELIGIBLE', 'A pessoa escolhida nao esta ativa ou nao tem este cliente na carteira.');
      }
      await tx.onboardingStepRun.update({
        where: { executionId_stepKey: { executionId, stepKey } },
        data: { assigneeMemberId: input.memberId, assigneeSource: 'MANUAL' },
      });
      await recordEvent(tx, ctx, {
        executionId,
        stepKey,
        type: 'STEP_REASSIGNED',
        reason: input.reason,
        before: { assigneeMemberId: run.assigneeMemberId },
        after: { assigneeMemberId: input.memberId },
      });
    });
  }

  /** Conclusao antecipada (P3): bloqueantes ja encerradas; demais abertas dispensadas na mesma transacao. */
  async completeExecution(ctx: ExecutionContext, executionId: string, input: CompleteOnboardingExecutionRequest) {
    return this.act(ctx, executionId, async (tx) => {
      const exec = await this.lock(tx, ctx, executionId);
      const [runs, defs] = await Promise.all([
        tx.onboardingStepRun.findMany({ where: { executionId, organizationId: ctx.organizationId } }),
        loadSteps(tx, ctx.organizationId, exec.versionId),
      ]);
      const plan = planEarlyCompletion(defs, runs.map((r) => ({ stepKey: r.stepKey, status: r.status, blocked: r.blocked })));
      if (!plan.allowed) {
        const titles = await tx.onboardingStepDefinition.findMany({
          where: { versionId: exec.versionId, stepKey: { in: plan.blockingOpen } },
          select: { title: true },
        });
        throw new OnboardingError(
          409,
          'BLOCKING_STEPS_OPEN',
          `Ha etapas obrigatorias para a conclusao ainda abertas: ${titles.map((t) => t.title).join(', ')}.`
        );
      }
      if (plan.toSkip.length > 0 && !input.reason) {
        throw new OnboardingError(400, 'REASON_REQUIRED', 'Informe a justificativa para dispensar as etapas ainda abertas.');
      }
      const now = new Date();
      for (const key of plan.toSkip) {
        const run = runs.find((r) => r.stepKey === key)!;
        await tx.onboardingStepRun.update({
          where: { executionId_stepKey: { executionId, stepKey: key } },
          data: { status: 'SKIPPED', blocked: false, blockedReason: null, blockedAt: null, skipReason: input.reason!, skippedByUserId: ctx.userId, completedAt: now },
        });
        await recordEvent(tx, ctx, {
          executionId,
          stepKey: key,
          type: 'STEP_SKIPPED',
          reason: input.reason,
          before: { status: run.status, blocked: run.blocked },
          after: { status: 'SKIPPED', viaEarlyCompletion: true },
        });
      }
      await tx.onboardingExecution.update({
        where: { id: executionId },
        data: { status: 'COMPLETED', completedAt: now, completedByUserId: ctx.userId, completionMode: 'EARLY' },
      });
      await recordEvent(tx, ctx, {
        executionId,
        type: 'EXECUTION_COMPLETED',
        reason: input.reason ?? null,
        after: { mode: 'EARLY', skippedSteps: plan.toSkip },
      });
      await enqueueLifecycle(tx, { organizationId: ctx.organizationId, executionId, eventType: 'EXECUTION_COMPLETED' });
    });
  }

  async cancel(ctx: ExecutionContext, executionId: string, input: CancelOnboardingExecutionRequest) {
    return this.act(ctx, executionId, async (tx) => {
      const exec = await this.lock(tx, ctx, executionId);
      const now = new Date();
      const open = await tx.onboardingStepRun.findMany({
        where: { executionId, status: { in: ['WAITING', 'READY', 'IN_PROGRESS'] } },
        select: { stepKey: true },
      });
      await tx.onboardingStepRun.updateMany({
        where: { executionId, status: { in: ['WAITING', 'READY', 'IN_PROGRESS'] } },
        data: { status: 'CANCELLED', blocked: false, blockedReason: null, blockedAt: null },
      });
      await tx.onboardingExecution.update({
        where: { id: exec.id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelledByUserId: ctx.userId, cancelReason: input.reason },
      });
      await recordEvent(tx, ctx, {
        executionId,
        type: 'EXECUTION_CANCELLED',
        reason: input.reason,
        before: { status: 'ACTIVE' },
        after: { status: 'CANCELLED', cancelledSteps: open.map((o) => o.stepKey) },
      });
      await enqueueLifecycle(tx, { organizationId: ctx.organizationId, executionId, eventType: 'EXECUTION_CANCELLED' });
    });
  }
}

export const onboardingExecutionService = new OnboardingExecutionService();
