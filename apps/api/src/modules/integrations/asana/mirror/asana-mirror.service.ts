import { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import { acquireLease, releaseLease } from '../../../../lib/scheduler-lease.js';
import { asanaService } from '../asana.service.js';
import { getOrganizationTimeZone } from '../../../organization-config/organization-config.service.js';
import {
  KnownTask,
  MIRROR_TIMEZONE,
  MirrorTask,
  computeProjectCounts,
  diffMirror,
  normalizeAsanaTask,
  retentionCutoff,
  snapshotDateFor,
} from './asana-mirror.diff.js';

/**
 * F6-IMP.8 — Espelho e fotos diárias do Asana (DEC-F6-003). SOMENTE LEITURA no Asana.
 *
 * Garantias:
 *  - uma execução por organização de cada vez (trava em scheduler_leases), inclusive entre instâncias;
 *  - cada projeto é gravado numa transação: ou tudo (tarefas, mudanças, foto) ou nada;
 *  - falha ao ler o Asana NÃO apaga nem zera nada: mantém o último estado válido e marca o projeto como FAILED;
 *  - a primeira conferência de um projeto é o ponto de partida (não gera histórico de "criação" falso);
 *  - toda execução fica registrada em SyncRun.
 */

export interface MirrorDependencies {
  getToken: (organizationId: string) => Promise<string>;
  fetchProjectTasks: (projectGid: string, token: string) => Promise<any[]>;
  fetchProjectName: (projectGid: string, token: string) => Promise<string | null>;
  now: () => Date;
}

const defaultDependencies: MirrorDependencies = {
  getToken: async (organizationId) => (await asanaService.getValidToken(organizationId)).token,
  fetchProjectTasks: (projectGid, token) => asanaService.fetchProjectTasksForMirror(projectGid, token),
  fetchProjectName: (projectGid, token) => asanaService.fetchProjectNameForMirror(projectGid, token),
  now: () => new Date(),
};

export type SyncTrigger = 'schedule' | 'webhook' | 'manual';

export interface SyncOrganizationResult {
  skipped: boolean;
  syncRunId?: string;
  status?: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  projects: number;
  succeeded: number;
  failed: number;
}

const LEASE_TTL_MS = 30 * 60 * 1000;
const leaseName = (organizationId: string) => `asana-mirror:${organizationId}`;

const safeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Falha ao consultar o Asana.';
  // Nunca guardar tokens: corta qualquer coisa que pareça credencial.
  return message.replace(/(bearer|token)\s*[:=]?\s*\S+/gi, '$1 [REDACTED]').slice(0, 500);
};

export class AsanaMirrorService {
  constructor(private readonly deps: MirrorDependencies = defaultDependencies) {}

  /** Confere os projetos vinculados da organização (todos ou só os informados). */
  async syncOrganization(
    organizationId: string,
    trigger: SyncTrigger,
    options: { projectGids?: string[] } = {}
  ): Promise<SyncOrganizationResult> {
    const holder = await acquireLease(leaseName(organizationId), LEASE_TTL_MS);
    if (!holder) return { skipped: true, projects: 0, succeeded: 0, failed: 0 };

    try {
      const links = await prisma.clientIntegration.findMany({
        where: {
          provider: 'ASANA',
          client: { organizationId },
          ...(options.projectGids ? { externalId: { in: options.projectGids } } : {}),
        },
        select: { clientId: true, externalId: true },
      });

      const run = await prisma.syncRun.create({
        data: {
          organizationId,
          provider: 'ASANA',
          operation: 'asana.mirror.sync',
          status: 'RUNNING',
          itemsProcessed: links.length,
          metadata: { trigger, projectGids: options.projectGids ?? null },
        },
      });

      let token: string | null = null;
      let tokenError: string | null = null;
      try {
        token = await this.deps.getToken(organizationId);
      } catch (error) {
        tokenError = safeError(error);
      }

      const timeZone = await getOrganizationTimeZone(organizationId);
      let succeeded = 0;
      let failed = 0;
      for (const link of links) {
        const ok = token
          ? await this.syncProject(organizationId, link.clientId, link.externalId, token, run.id, timeZone)
          : await this.markProjectFailed(organizationId, link.clientId, link.externalId, tokenError || 'Asana não conectado.');
        if (ok) succeeded++;
        else failed++;
      }

      const status: 'SUCCESS' | 'PARTIAL' | 'FAILED' =
        failed === 0 && (token || links.length === 0) ? 'SUCCESS' : succeeded > 0 ? 'PARTIAL' : 'FAILED';
      await prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: this.deps.now(),
          itemsSucceeded: succeeded,
          itemsFailed: failed,
          errorSummary: tokenError ?? (failed > 0 ? `${failed} projeto(s) com falha na conferência.` : null),
        },
      });
      return { skipped: false, syncRunId: run.id, status, projects: links.length, succeeded, failed };
    } finally {
      await releaseLease(leaseName(organizationId), holder);
    }
  }

  /** Registra falha de conferência sem tocar em tarefas, mudanças ou fotos. */
  private async markProjectFailed(organizationId: string, clientId: string, projectGid: string, error: string) {
    const now = this.deps.now();
    await prisma.asanaProjectMirror.upsert({
      where: { organizationId_clientId_projectGid: { organizationId, clientId, projectGid } },
      create: { organizationId, clientId, projectGid, lastAttemptAt: now, lastSyncStatus: 'FAILED', lastSyncError: error },
      update: { lastAttemptAt: now, lastSyncStatus: 'FAILED', lastSyncError: error },
    });
    return false;
  }

  /** Confere um projeto. Devolve true se gravou um estado novo e válido. */
  async syncProject(
    organizationId: string,
    clientId: string,
    projectGid: string,
    token: string,
    syncRunId: string,
    timeZone: string = MIRROR_TIMEZONE
  ): Promise<boolean> {
    let fetched: MirrorTask[];
    let projectName: string | null = null;
    try {
      const [rawTasks, name] = await Promise.all([
        this.deps.fetchProjectTasks(projectGid, token),
        this.deps.fetchProjectName(projectGid, token).catch(() => null),
      ]);
      if (!Array.isArray(rawTasks)) throw new Error('Resposta do Asana sem lista de tarefas.');
      fetched = rawTasks.map((raw) => normalizeAsanaTask(raw, projectGid)).filter((t): t is MirrorTask => t !== null);
      projectName = name;
    } catch (error) {
      return this.markProjectFailed(organizationId, clientId, projectGid, safeError(error));
    }

    const now = this.deps.now();
    try {
      await prisma.$transaction(
        async (tx) => {
          const mirror = await tx.asanaProjectMirror.findUnique({
            where: { organizationId_clientId_projectGid: { organizationId, clientId, projectGid } },
          });
          const isBaseline = !mirror?.baselineAt;
          const knownRows = await tx.asanaTaskMirror.findMany({ where: { organizationId, clientId, projectGid } });
          const known: KnownTask[] = knownRows.map((row) => ({
            taskGid: row.taskGid,
            name: row.name,
            completed: row.completed,
            dueOn: row.dueOn,
            dueAt: row.dueAt,
            assigneeGid: row.assigneeGid,
            assigneeName: row.assigneeName,
            sectionGid: row.sectionGid,
            sectionName: row.sectionName,
            permalinkUrl: row.permalinkUrl,
            removed: row.removedAt !== null,
          }));
          const diff = diffMirror(known, fetched, !isBaseline);
          const knownGids = new Set(knownRows.map((r) => r.taskGid));

          const data = (task: MirrorTask) => ({
            name: task.name,
            completed: task.completed,
            dueOn: task.dueOn,
            dueAt: task.dueAt,
            assigneeGid: task.assigneeGid,
            assigneeName: task.assigneeName,
            sectionGid: task.sectionGid,
            sectionName: task.sectionName,
            permalinkUrl: task.permalinkUrl,
          });

          const brandNew = diff.added.filter((t) => !knownGids.has(t.taskGid));
          if (brandNew.length > 0) {
            await tx.asanaTaskMirror.createMany({
              data: brandNew.map((task) => ({
                organizationId,
                clientId,
                projectGid,
                taskGid: task.taskGid,
                ...data(task),
                firstSeenAt: now,
                lastSeenAt: now,
              })),
              skipDuplicates: true,
            });
          }
          const where = (taskGid: string) => ({
            organizationId_clientId_projectGid_taskGid: { organizationId, clientId, projectGid, taskGid },
          });
          for (const task of diff.added.filter((t) => knownGids.has(t.taskGid))) {
            await tx.asanaTaskMirror.update({ where: where(task.taskGid), data: { ...data(task), removedAt: null, lastSeenAt: now } });
          }
          for (const task of diff.updated) {
            await tx.asanaTaskMirror.update({ where: where(task.taskGid), data: { ...data(task), lastSeenAt: now } });
          }
          if (diff.removed.length > 0) {
            await tx.asanaTaskMirror.updateMany({
              where: { organizationId, clientId, projectGid, taskGid: { in: diff.removed } },
              data: { removedAt: now },
            });
          }
          const seenGids = fetched.map((t) => t.taskGid);
          if (seenGids.length > 0) {
            await tx.asanaTaskMirror.updateMany({
              where: { organizationId, clientId, projectGid, taskGid: { in: seenGids } },
              data: { lastSeenAt: now },
            });
          }
          if (diff.changes.length > 0) {
            await tx.asanaTaskChange.createMany({
              data: diff.changes.map((change) => ({
                organizationId,
                clientId,
                projectGid,
                taskGid: change.taskGid,
                taskName: change.taskName,
                field: change.field,
                before: (change.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                after: (change.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                detectedAt: now,
                syncRunId,
              })),
            });
          }

          const counts = computeProjectCounts(fetched, now, timeZone);
          const snapshotDate = snapshotDateFor(now, timeZone);
          await tx.asanaProjectSnapshot.upsert({
            where: {
              organizationId_clientId_projectGid_snapshotDate: { organizationId, clientId, projectGid, snapshotDate },
            },
            create: { organizationId, clientId, projectGid, snapshotDate, ...counts, capturedAt: now, syncRunId },
            update: { ...counts, capturedAt: now, syncRunId },
          });

          await tx.asanaProjectMirror.upsert({
            where: { organizationId_clientId_projectGid: { organizationId, clientId, projectGid } },
            create: {
              organizationId,
              clientId,
              projectGid,
              name: projectName,
              baselineAt: now,
              lastSyncedAt: now,
              lastAttemptAt: now,
              lastSyncStatus: 'SUCCESS',
              lastSyncError: null,
            },
            update: {
              ...(projectName ? { name: projectName } : {}),
              ...(isBaseline ? { baselineAt: now } : {}),
              lastSyncedAt: now,
              lastAttemptAt: now,
              lastSyncStatus: 'SUCCESS',
              lastSyncError: null,
            },
          });
        },
        { timeout: 60_000 }
      );
      return true;
    } catch (error) {
      return this.markProjectFailed(organizationId, clientId, projectGid, 'Falha ao gravar o espelho: ' + safeError(error));
    }
  }

  /** Descarte controlado do que passou da retenção (13 meses). Nunca toca no Asana. */
  async purgeExpired(): Promise<{ changes: number; snapshots: number; removedTasks: number }> {
    const cutoff = retentionCutoff(this.deps.now());
    const cutoffDate = snapshotDateFor(cutoff);
    const [changes, snapshots, removedTasks] = await prisma.$transaction([
      prisma.asanaTaskChange.deleteMany({ where: { detectedAt: { lt: cutoff } } }),
      prisma.asanaProjectSnapshot.deleteMany({ where: { snapshotDate: { lt: cutoffDate } } }),
      prisma.asanaTaskMirror.deleteMany({ where: { removedAt: { lt: cutoff } } }),
    ]);
    return { changes: changes.count, snapshots: snapshots.count, removedTasks: removedTasks.count };
  }

  /** Organizações com pelo menos um projeto Asana vinculado. */
  async listOrganizationsWithLinks(): Promise<string[]> {
    const rows = await prisma.client.findMany({
      where: { integrations: { some: { provider: 'ASANA' } } },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    return rows.map((r) => r.organizationId);
  }

  /** Histórico de um cliente para a tela: frescor por projeto, fotos dos últimos dias e mudanças recentes. */
  async getClientHistory(organizationId: string, clientId: string, days: number, changesLimit = 50) {
    const now = this.deps.now();
    const timeZone = await getOrganizationTimeZone(organizationId);
    const since = snapshotDateFor(new Date(now.getTime() - (days - 1) * 86_400_000), timeZone);
    const [links, mirrors, snapshots, changes] = await Promise.all([
      prisma.clientIntegration.findMany({
        where: { provider: 'ASANA', clientId, client: { organizationId } },
        select: { externalId: true, metadata: true },
      }),
      prisma.asanaProjectMirror.findMany({ where: { organizationId, clientId } }),
      prisma.asanaProjectSnapshot.findMany({
        where: { organizationId, clientId, snapshotDate: { gte: since } },
        orderBy: { snapshotDate: 'asc' },
      }),
      prisma.asanaTaskChange.findMany({
        where: { organizationId, clientId },
        orderBy: { detectedAt: 'desc' },
        take: changesLimit,
      }),
    ]);

    const mirrorByGid = new Map(mirrors.map((m) => [m.projectGid, m]));
    const projects = links.map((link) => {
      const mirror = mirrorByGid.get(link.externalId);
      const meta = (link.metadata as { projectName?: string } | null) ?? {};
      return {
        projectGid: link.externalId,
        name: mirror?.name || meta.projectName || `Projeto ${link.externalId}`,
        baselineAt: mirror?.baselineAt?.toISOString() ?? null,
        lastSyncedAt: mirror?.lastSyncedAt?.toISOString() ?? null,
        lastAttemptAt: mirror?.lastAttemptAt?.toISOString() ?? null,
        lastSyncStatus: (mirror?.lastSyncStatus as 'SUCCESS' | 'FAILED' | undefined) ?? 'NEVER',
        lastSyncError: mirror?.lastSyncError ?? null,
        snapshots: snapshots
          .filter((s) => s.projectGid === link.externalId)
          .map((s) => ({
            date: s.snapshotDate,
            totalTasks: s.totalTasks,
            completedTasks: s.completedTasks,
            pendingTasks: s.pendingTasks,
            overdueTasks: s.overdueTasks,
            capturedAt: s.capturedAt.toISOString(),
          })),
      };
    });

    return {
      clientId,
      days,
      generatedAt: now.toISOString(),
      projects,
      changes: changes.map((c) => ({
        id: c.id,
        projectGid: c.projectGid,
        taskGid: c.taskGid,
        taskName: c.taskName,
        field: c.field,
        before: c.before,
        after: c.after,
        detectedAt: c.detectedAt.toISOString(),
      })),
    };
  }
}

export const asanaMirrorService = new AsanaMirrorService();
