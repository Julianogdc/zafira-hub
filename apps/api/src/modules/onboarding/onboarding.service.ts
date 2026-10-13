import { Prisma } from '@prisma/client';
import type {
  CreateOnboardingTemplateRequest,
  CreateOrganizationFunctionRequest,
  OnboardingStepInput,
  PublishOnboardingVersionRequest,
  SaveOnboardingDraftRequest,
  UpdateOnboardingTemplateRequest,
  UpdateOrganizationFunctionRequest,
} from '@zafira/contracts';
import {
  OnboardingProblem,
  cloneStepsForNewVersion,
  validateDraftIntegrity,
  validatePublishable,
} from '@zafira/domain';
import { prisma } from '../../lib/prisma.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * F7-1a — Construtor de onboarding (DEC-F7-004/005). SOMENTE modelos, versões e funções.
 * Nada aqui escreve no Asana ou no Calendar. Toda operação filtra pela organização da sessão.
 *
 * Garantias:
 *  - trava do modelo (SELECT ... FOR UPDATE) em toda mudança de versão/rascunho;
 *  - versão PUBLICADA é imutável (API + gatilho no banco);
 *  - um rascunho por modelo e numeração única (índices no banco como última defesa);
 *  - salvar/publicar exigem o \`updatedAt\` lido (conflito = 409, nunca sobrescreve).
 */

export class OnboardingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly problems?: OnboardingProblem[]
  ) {
    super(message);
    this.name = 'OnboardingError';
  }
}

export interface OnboardingContext {
  organizationId: string;
  userId: string;
}

type Tx = Prisma.TransactionClient;

const notFound = (what: string) => new OnboardingError(404, 'NOT_FOUND', `${what} não encontrado.`);

/** Converte erros do banco em erros de domínio (última linha de defesa). */
function mapDbError(error: unknown): never {
  if (error instanceof OnboardingError) throw error;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('onboarding_version_published_immutable')) {
    throw new OnboardingError(409, 'VERSION_PUBLISHED', 'Versão publicada não pode ser alterada. Crie uma nova versão.');
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = JSON.stringify(error.meta?.target ?? '');
    if (target.includes('one_draft') || target.includes('versionNumber')) {
      throw new OnboardingError(409, 'DRAFT_EXISTS', 'Já existe um rascunho para este modelo.');
    }
    throw new OnboardingError(409, 'NAME_TAKEN', 'Já existe um registro com este nome.');
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2010' || error.code === 'P2004')) {
    const raw = JSON.stringify(error.meta ?? {});
    if (raw.includes('lower') || raw.includes('_key') || raw.includes('one_draft')) {
      throw new OnboardingError(409, 'NAME_TAKEN', 'Já existe um registro com este nome.');
    }
  }
  throw error;
}

const isUniqueIndexViolation = (error: unknown, fragment: string) =>
  error instanceof Error && error.message.includes(fragment);

/* ----------------------------- helpers de leitura ----------------------------- */

async function lockTemplate(tx: Tx, ctx: OnboardingContext, templateId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM onboarding_templates
    WHERE id = ${templateId} AND "organizationId" = ${ctx.organizationId}
    FOR UPDATE`;
  if (rows.length === 0) throw notFound('Modelo de onboarding');
  const template = await tx.onboardingTemplate.findFirst({ where: { id: templateId, organizationId: ctx.organizationId } });
  if (!template) throw notFound('Modelo de onboarding');
  return template;
}

export async function loadSteps(db: Tx | typeof prisma, organizationId: string, versionId: string): Promise<OnboardingStepInput[]> {
  const [steps, deps] = await Promise.all([
    db.onboardingStepDefinition.findMany({ where: { organizationId, versionId }, orderBy: { position: 'asc' } }),
    db.onboardingStepDependency.findMany({ where: { organizationId, versionId } }),
  ]);
  const depsByStep = new Map<string, string[]>();
  for (const d of deps) {
    const list = depsByStep.get(d.stepKey) ?? [];
    list.push(d.dependsOnStepKey);
    depsByStep.set(d.stepKey, list);
  }
  return steps.map((s) => ({
    stepKey: s.stepKey,
    title: s.title,
    description: s.description,
    kind: s.kind,
    assigneeMode: s.assigneeMode,
    functionId: s.functionId,
    memberId: s.memberId,
    dueBusinessDays: s.dueBusinessDays,
    dueAnchor: s.dueAnchor,
    evidenceKind: s.evidenceKind,
    evidenceRequired: s.evidenceRequired,
    completionCondition: s.completionCondition,
    blocksCompletion: s.blocksCompletion,
    automationKey: s.automationKey,
    dependsOn: (depsByStep.get(s.stepKey) ?? []).sort(),
  }));
}

async function writeSteps(tx: Tx, ctx: OnboardingContext, versionId: string, steps: readonly OnboardingStepInput[]) {
  await tx.onboardingStepDependency.deleteMany({ where: { organizationId: ctx.organizationId, versionId } });
  await tx.onboardingStepDefinition.deleteMany({ where: { organizationId: ctx.organizationId, versionId } });
  if (steps.length === 0) return;
  await tx.onboardingStepDefinition.createMany({
    data: steps.map((s, position) => ({
      organizationId: ctx.organizationId,
      versionId,
      stepKey: s.stepKey,
      position,
      title: s.title,
      description: s.description ?? null,
      kind: s.kind,
      assigneeMode: s.assigneeMode,
      functionId: s.assigneeMode === 'FUNCTION' ? s.functionId ?? null : null,
      memberId: s.assigneeMode === 'MEMBER' ? s.memberId ?? null : null,
      dueBusinessDays: s.dueBusinessDays ?? null,
      dueAnchor: s.dueAnchor,
      evidenceKind: s.evidenceKind,
      evidenceRequired: s.evidenceRequired,
      completionCondition: s.completionCondition,
      blocksCompletion: s.blocksCompletion,
      automationKey: s.kind === 'AUTOMATION' ? s.automationKey ?? null : null,
    })),
  });
  const deps = steps.flatMap((s) =>
    [...new Set(s.dependsOn)].map((dependsOnStepKey) => ({
      organizationId: ctx.organizationId,
      versionId,
      stepKey: s.stepKey,
      dependsOnStepKey,
    }))
  );
  if (deps.length > 0) await tx.onboardingStepDependency.createMany({ data: deps });
}

async function validationContext(db: Tx | typeof prisma, organizationId: string) {
  const [functions, members, flows] = await Promise.all([
    db.organizationFunction.findMany({ where: { organizationId, isActive: true }, select: { id: true } }),
    db.organizationMember.findMany({ where: { organizationId, status: 'ACTIVE' }, select: { id: true } }),
    db.automationFlow.findMany({ where: { organizationId, enabled: true }, select: { key: true } }),
  ]);
  return {
    enabledAutomationKeys: new Set(flows.map((f) => f.key)),
    activeFunctionIds: new Set(functions.map((f) => f.id)),
    activeMemberIds: new Set(members.map((m) => m.id)),
  };
}

async function record(
  tx: Tx,
  ctx: OnboardingContext,
  event: {
    templateId: string;
    versionId?: string | null;
    type: string;
    action: string;
    entityType: string;
    entityId: string;
    reason?: string | null;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  }
) {
  await tx.onboardingEvent.create({
    data: {
      organizationId: ctx.organizationId,
      templateId: event.templateId,
      versionId: event.versionId ?? null,
      type: event.type,
      actorUserId: ctx.userId,
      reason: event.reason ?? null,
      before: event.before,
      after: event.after,
    },
  });
  await new AuditService(tx).record({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    before: event.before,
    after: event.after,
    metadata: { templateId: event.templateId, versionId: event.versionId ?? null, reason: event.reason ?? null },
  });
}

function assertEditable(template: { status: string }) {
  if (template.status === 'ARCHIVED') {
    throw new OnboardingError(409, 'TEMPLATE_ARCHIVED', 'Modelo arquivado. Reative-o para editar ou publicar.');
  }
}

/* --------------------------------- serviço --------------------------------- */

export class OnboardingService {
  /* ----- modelos ----- */

  async listTemplates(ctx: OnboardingContext) {
    const templates = await prisma.onboardingTemplate.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: 'asc' },
      include: { versions: { select: { id: true, versionNumber: true, status: true, updatedAt: true } } },
    });
    return templates.map((t) => {
      const published = t.versions.filter((v) => v.status === 'PUBLISHED').sort((a, b) => b.versionNumber - a.versionNumber)[0];
      const draft = t.versions.find((v) => v.status === 'DRAFT');
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        scopeKind: t.scopeKind,
        scopeLabel: t.scopeLabel,
        status: t.status,
        publishedVersion: published?.versionNumber ?? null,
        hasDraft: Boolean(draft),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    });
  }

  async getTemplate(ctx: OnboardingContext, templateId: string) {
    const template = await prisma.onboardingTemplate.findFirst({
      where: { id: templateId, organizationId: ctx.organizationId },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });
    if (!template) throw notFound('Modelo de onboarding');
    const draftRow = template.versions.find((v) => v.status === 'DRAFT');
    const publishedRow = template.versions.find((v) => v.status === 'PUBLISHED');
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      scopeKind: template.scopeKind,
      scopeLabel: template.scopeLabel,
      status: template.status,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      versions: template.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status,
        changeNote: v.changeNote,
        basedOnVersionId: v.basedOnVersionId,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        updatedAt: v.updatedAt.toISOString(),
      })),
      draft: draftRow
        ? {
            id: draftRow.id,
            versionNumber: draftRow.versionNumber,
            updatedAt: draftRow.updatedAt.toISOString(),
            steps: await loadSteps(prisma, ctx.organizationId, draftRow.id),
          }
        : null,
      published: publishedRow
        ? {
            id: publishedRow.id,
            versionNumber: publishedRow.versionNumber,
            publishedAt: publishedRow.publishedAt?.toISOString() ?? null,
            steps: await loadSteps(prisma, ctx.organizationId, publishedRow.id),
          }
        : null,
    };
  }

  async createTemplate(ctx: OnboardingContext, input: CreateOnboardingTemplateRequest) {
    try {
      const id = await prisma.$transaction(async (tx) => {
        const template = await tx.onboardingTemplate.create({
          data: {
            organizationId: ctx.organizationId,
            name: input.name,
            description: input.description ?? null,
            scopeKind: input.scopeKind,
            scopeLabel: input.scopeLabel ?? null,
            createdByUserId: ctx.userId,
          },
        });
        const draft = await tx.onboardingTemplateVersion.create({
          data: { organizationId: ctx.organizationId, templateId: template.id, versionNumber: 1, status: 'DRAFT' },
        });
        await record(tx, ctx, {
          templateId: template.id,
          versionId: draft.id,
          type: 'TEMPLATE_CREATED',
          action: 'onboarding.template_created',
          entityType: 'OnboardingTemplate',
          entityId: template.id,
          after: { name: template.name, scopeKind: template.scopeKind },
        });
        return template.id;
      });
      return this.getTemplate(ctx, id);
    } catch (error) {
      return mapDbError(error);
    }
  }

  async updateTemplate(ctx: OnboardingContext, templateId: string, input: UpdateOnboardingTemplateRequest) {
    try {
      await prisma.$transaction(async (tx) => {
        const before = await lockTemplate(tx, ctx, templateId);
        assertEditable(before);
        const updated = await tx.onboardingTemplate.update({
          where: { id: templateId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.scopeKind !== undefined ? { scopeKind: input.scopeKind } : {}),
            ...(input.scopeLabel !== undefined ? { scopeLabel: input.scopeLabel } : {}),
          },
        });
        await record(tx, ctx, {
          templateId,
          type: 'TEMPLATE_UPDATED',
          action: 'onboarding.template_updated',
          entityType: 'OnboardingTemplate',
          entityId: templateId,
          before: { name: before.name, description: before.description, scopeKind: before.scopeKind, scopeLabel: before.scopeLabel },
          after: { name: updated.name, description: updated.description, scopeKind: updated.scopeKind, scopeLabel: updated.scopeLabel },
        });
      });
      return this.getTemplate(ctx, templateId);
    } catch (error) {
      return mapDbError(error);
    }
  }

  async duplicateTemplate(ctx: OnboardingContext, templateId: string) {
    try {
      const newId = await prisma.$transaction(async (tx) => {
        const source = await lockTemplate(tx, ctx, templateId);
        const versions = await tx.onboardingTemplateVersion.findMany({
          where: { organizationId: ctx.organizationId, templateId },
          orderBy: { versionNumber: 'desc' },
        });
        const base = versions.find((v) => v.status === 'PUBLISHED') ?? versions.find((v) => v.status === 'DRAFT');
        const steps = base ? await loadSteps(tx, ctx.organizationId, base.id) : [];

        // nome único: "Nome (cópia)", "Nome (cópia 2)"...
        const existing = await tx.onboardingTemplate.findMany({
          where: { organizationId: ctx.organizationId },
          select: { name: true },
        });
        const taken = new Set(existing.map((t) => t.name.toLowerCase()));
        let candidate = `${source.name} (cópia)`;
        for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${source.name} (cópia ${n})`;

        const copy = await tx.onboardingTemplate.create({
          data: {
            organizationId: ctx.organizationId,
            name: candidate.slice(0, 120),
            description: source.description,
            scopeKind: source.scopeKind,
            scopeLabel: source.scopeLabel,
            createdByUserId: ctx.userId,
          },
        });
        const draft = await tx.onboardingTemplateVersion.create({
          data: { organizationId: ctx.organizationId, templateId: copy.id, versionNumber: 1, status: 'DRAFT' },
        });
        await writeSteps(tx, ctx, draft.id, cloneStepsForNewVersion(steps));
        await record(tx, ctx, {
          templateId: copy.id,
          versionId: draft.id,
          type: 'TEMPLATE_DUPLICATED',
          action: 'onboarding.template_duplicated',
          entityType: 'OnboardingTemplate',
          entityId: copy.id,
          after: { sourceTemplateId: templateId, sourceVersionId: base?.id ?? null, stepCount: steps.length },
        });
        return copy.id;
      });
      return this.getTemplate(ctx, newId);
    } catch (error) {
      return mapDbError(error);
    }
  }

  private async setArchived(ctx: OnboardingContext, templateId: string, archived: boolean) {
    try {
      await prisma.$transaction(async (tx) => {
        const template = await lockTemplate(tx, ctx, templateId);
        const target = archived ? 'ARCHIVED' : 'ACTIVE';
        if (template.status === target) {
          throw new OnboardingError(409, 'ALREADY_IN_STATE', archived ? 'Modelo já está arquivado.' : 'Modelo já está ativo.');
        }
        await tx.onboardingTemplate.update({ where: { id: templateId }, data: { status: target } });
        await record(tx, ctx, {
          templateId,
          type: archived ? 'TEMPLATE_ARCHIVED' : 'TEMPLATE_REACTIVATED',
          action: archived ? 'onboarding.template_archived' : 'onboarding.template_reactivated',
          entityType: 'OnboardingTemplate',
          entityId: templateId,
          before: { status: template.status },
          after: { status: target },
        });
      });
      return this.getTemplate(ctx, templateId);
    } catch (error) {
      return mapDbError(error);
    }
  }

  archiveTemplate(ctx: OnboardingContext, templateId: string) {
    return this.setArchived(ctx, templateId, true);
  }

  reactivateTemplate(ctx: OnboardingContext, templateId: string) {
    return this.setArchived(ctx, templateId, false);
  }

  /* ----- versões ----- */

  /** Cria o rascunho da próxima versão a partir da última publicada (stepKey preservado). */
  async createDraft(ctx: OnboardingContext, templateId: string) {
    try {
      await prisma.$transaction(async (tx) => {
        const template = await lockTemplate(tx, ctx, templateId);
        assertEditable(template);
        const versions = await tx.onboardingTemplateVersion.findMany({
          where: { organizationId: ctx.organizationId, templateId },
          orderBy: { versionNumber: 'desc' },
        });
        if (versions.some((v) => v.status === 'DRAFT')) {
          throw new OnboardingError(409, 'DRAFT_EXISTS', 'Já existe um rascunho para este modelo.');
        }
        const latest = versions[0];
        const draft = await tx.onboardingTemplateVersion.create({
          data: {
            organizationId: ctx.organizationId,
            templateId,
            versionNumber: (latest?.versionNumber ?? 0) + 1,
            status: 'DRAFT',
            basedOnVersionId: latest?.id ?? null,
          },
        });
        if (latest) {
          const steps = await loadSteps(tx, ctx.organizationId, latest.id);
          await writeSteps(tx, ctx, draft.id, cloneStepsForNewVersion(steps));
        }
        await record(tx, ctx, {
          templateId,
          versionId: draft.id,
          type: 'DRAFT_CREATED',
          action: 'onboarding.draft_created',
          entityType: 'OnboardingTemplateVersion',
          entityId: draft.id,
          after: { versionNumber: draft.versionNumber, basedOnVersionId: latest?.id ?? null },
        });
      });
      return this.getTemplate(ctx, templateId);
    } catch (error) {
      return mapDbError(error);
    }
  }

  private async lockDraft(tx: Tx, ctx: OnboardingContext, templateId: string, versionId: string) {
    const template = await lockTemplate(tx, ctx, templateId);
    const version = await tx.onboardingTemplateVersion.findFirst({
      where: { id: versionId, templateId, organizationId: ctx.organizationId },
    });
    if (!version) throw notFound('Versão do modelo');
    if (version.status === 'PUBLISHED') {
      throw new OnboardingError(409, 'VERSION_PUBLISHED', 'Versão publicada não pode ser alterada. Crie uma nova versão.');
    }
    return { template, version };
  }

  private assertFresh(version: { updatedAt: Date }, expectedUpdatedAt: string) {
    if (new Date(expectedUpdatedAt).getTime() !== version.updatedAt.getTime()) {
      throw new OnboardingError(409, 'STALE_DRAFT', 'O rascunho foi alterado por outra pessoa. Recarregue antes de salvar.');
    }
  }

  /** Substitui as etapas do rascunho. Aceita rascunho incompleto; rejeita integridade quebrada. */
  async saveDraft(ctx: OnboardingContext, templateId: string, versionId: string, input: SaveOnboardingDraftRequest) {
    try {
      await prisma.$transaction(async (tx) => {
        const { template, version } = await this.lockDraft(tx, ctx, templateId, versionId);
        assertEditable(template);
        this.assertFresh(version, input.expectedUpdatedAt);

        const problems = validateDraftIntegrity(input.steps);
        const functionIds = [...new Set(input.steps.map((s) => s.functionId).filter((v): v is string => Boolean(v)))];
        const memberIds = [...new Set(input.steps.map((s) => s.memberId).filter((v): v is string => Boolean(v)))];
        if (functionIds.length > 0) {
          const found = await tx.organizationFunction.findMany({
            where: { organizationId: ctx.organizationId, id: { in: functionIds } },
            select: { id: true },
          });
          const ok = new Set(found.map((f) => f.id));
          input.steps.forEach((s, i) => {
            if (s.functionId && !ok.has(s.functionId)) {
              problems.push({ code: 'ASSIGNEE_FUNCTION_INVALID', stepKey: s.stepKey, message: `Etapa ${i + 1}: função inexistente nesta organização.` });
            }
          });
        }
        if (memberIds.length > 0) {
          const found = await tx.organizationMember.findMany({
            where: { organizationId: ctx.organizationId, id: { in: memberIds } },
            select: { id: true },
          });
          const ok = new Set(found.map((m) => m.id));
          input.steps.forEach((s, i) => {
            if (s.memberId && !ok.has(s.memberId)) {
              problems.push({ code: 'ASSIGNEE_MEMBER_INVALID', stepKey: s.stepKey, message: `Etapa ${i + 1}: pessoa inexistente nesta organização.` });
            }
          });
        }
        if (problems.length > 0) {
          throw new OnboardingError(400, 'INVALID_DRAFT', 'O rascunho tem problemas de integridade.', problems);
        }

        await writeSteps(tx, ctx, versionId, input.steps);
        await tx.onboardingTemplateVersion.update({ where: { id: versionId }, data: { updatedAt: new Date() } });
        await tx.onboardingTemplate.update({ where: { id: templateId }, data: { updatedAt: new Date() } });
      });
      return this.getTemplate(ctx, templateId);
    } catch (error) {
      return mapDbError(error);
    }
  }

  /** Lista TODOS os problemas que impedem a publicação (não altera nada). */
  async validateVersion(ctx: OnboardingContext, templateId: string, versionId: string) {
    const version = await prisma.onboardingTemplateVersion.findFirst({
      where: { id: versionId, templateId, organizationId: ctx.organizationId },
    });
    if (!version) throw notFound('Versão do modelo');
    const [steps, vctx] = await Promise.all([
      loadSteps(prisma, ctx.organizationId, versionId),
      validationContext(prisma, ctx.organizationId),
    ]);
    const problems = validatePublishable(steps, vctx);
    return { versionId, publishable: version.status === 'DRAFT' && problems.length === 0, status: version.status, problems };
  }

  async publish(ctx: OnboardingContext, templateId: string, versionId: string, input: PublishOnboardingVersionRequest) {
    try {
      await prisma.$transaction(async (tx) => {
        const { template, version } = await this.lockDraft(tx, ctx, templateId, versionId);
        assertEditable(template);
        this.assertFresh(version, input.expectedUpdatedAt);

        const [steps, vctx] = await Promise.all([
          loadSteps(tx, ctx.organizationId, versionId),
          validationContext(tx, ctx.organizationId),
        ]);
        const problems = validatePublishable(steps, vctx);
        if (problems.length > 0) {
          throw new OnboardingError(400, 'NOT_PUBLISHABLE', 'O modelo tem problemas e não pode ser publicado.', problems);
        }

        await tx.onboardingTemplateVersion.update({
          where: { id: versionId },
          data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId: ctx.userId, changeNote: input.changeNote },
        });
        await tx.onboardingTemplate.update({ where: { id: templateId }, data: { updatedAt: new Date() } });
        await record(tx, ctx, {
          templateId,
          versionId,
          type: 'VERSION_PUBLISHED',
          action: 'onboarding.version_published',
          entityType: 'OnboardingTemplateVersion',
          entityId: versionId,
          reason: input.changeNote,
          before: { status: 'DRAFT' },
          after: { status: 'PUBLISHED', versionNumber: version.versionNumber, stepCount: steps.length },
        });
      });
      return this.getTemplate(ctx, templateId);
    } catch (error) {
      return mapDbError(error);
    }
  }

  async discardDraft(ctx: OnboardingContext, templateId: string, versionId: string) {
    try {
      await prisma.$transaction(async (tx) => {
        const { version } = await this.lockDraft(tx, ctx, templateId, versionId);
        await tx.onboardingTemplateVersion.delete({ where: { id: versionId } });
        await record(tx, ctx, {
          templateId,
          type: 'DRAFT_DISCARDED',
          action: 'onboarding.draft_discarded',
          entityType: 'OnboardingTemplateVersion',
          entityId: versionId,
          before: { versionNumber: version.versionNumber },
        });
      });
      return this.getTemplate(ctx, templateId);
    } catch (error) {
      return mapDbError(error);
    }
  }

  /* ----- funções operacionais (independentes do RBAC) ----- */

  /** Pessoas ativas da organização para escolher responsáveis. Só id, nome e papel — sem e-mail. */
  async listMembers(ctx: OnboardingContext) {
    const rows = await prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, status: 'ACTIVE' },
      select: { id: true, role: true, user: { select: { name: true } } },
    });
    return rows
      .map((m) => ({ id: m.id, name: m.user.name, role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async listFunctions(ctx: OnboardingContext) {
    const rows = await prisma.organizationFunction.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: 'asc' },
      include: { members: { select: { organizationMemberId: true } } },
    });
    return rows.map((f) => ({
      id: f.id,
      name: f.name,
      isActive: f.isActive,
      memberIds: f.members.map((m) => m.organizationMemberId).sort(),
    }));
  }

  async createFunction(ctx: OnboardingContext, input: CreateOrganizationFunctionRequest) {
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.organizationFunction.create({ data: { organizationId: ctx.organizationId, name: input.name } });
        await new AuditService(tx).record({
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          action: 'onboarding.function_created',
          entityType: 'OrganizationFunction',
          entityId: created.id,
          after: { name: created.name },
        });
      });
      return this.listFunctions(ctx);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OnboardingError(409, 'NAME_TAKEN', 'Já existe uma função com este nome.');
      }
      if (isUniqueIndexViolation(error, 'organization_functions_org_lower_name_key')) {
        throw new OnboardingError(409, 'NAME_TAKEN', 'Já existe uma função com este nome.');
      }
      return mapDbError(error);
    }
  }

  async updateFunction(ctx: OnboardingContext, functionId: string, input: UpdateOrganizationFunctionRequest) {
    try {
      await prisma.$transaction(async (tx) => {
        const before = await tx.organizationFunction.findFirst({ where: { id: functionId, organizationId: ctx.organizationId } });
        if (!before) throw notFound('Função');
        const updated = await tx.organizationFunction.update({
          where: { id: functionId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
        await new AuditService(tx).record({
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          action: 'onboarding.function_updated',
          entityType: 'OrganizationFunction',
          entityId: functionId,
          before: { name: before.name, isActive: before.isActive },
          after: { name: updated.name, isActive: updated.isActive },
        });
      });
      return this.listFunctions(ctx);
    } catch (error) {
      if (isUniqueIndexViolation(error, 'organization_functions_org_lower_name_key')) {
        throw new OnboardingError(409, 'NAME_TAKEN', 'Já existe uma função com este nome.');
      }
      return mapDbError(error);
    }
  }

  /** Define quem exerce a função. Só membros ATIVOS da própria organização. */
  async setFunctionMembers(ctx: OnboardingContext, functionId: string, memberIds: string[]) {
    const unique = [...new Set(memberIds)];
    try {
      await prisma.$transaction(async (tx) => {
        const fn = await tx.organizationFunction.findFirst({ where: { id: functionId, organizationId: ctx.organizationId } });
        if (!fn) throw notFound('Função');
        if (unique.length > 0) {
          const valid = await tx.organizationMember.count({
            where: { organizationId: ctx.organizationId, status: 'ACTIVE', id: { in: unique } },
          });
          if (valid !== unique.length) {
            throw new OnboardingError(400, 'INVALID_MEMBER', 'Há pessoas que não são membros ativos desta organização.');
          }
        }
        await tx.organizationFunctionMember.deleteMany({ where: { organizationId: ctx.organizationId, functionId } });
        if (unique.length > 0) {
          await tx.organizationFunctionMember.createMany({
            data: unique.map((organizationMemberId) => ({ organizationId: ctx.organizationId, functionId, organizationMemberId })),
          });
        }
        await new AuditService(tx).record({
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          action: 'onboarding.function_members_set',
          entityType: 'OrganizationFunction',
          entityId: functionId,
          after: { memberCount: unique.length },
        });
      });
      return this.listFunctions(ctx);
    } catch (error) {
      return mapDbError(error);
    }
  }
}

export const onboardingService = new OnboardingService();
