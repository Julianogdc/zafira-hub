import { PrismaClient } from '@prisma/client';

// ==============================================================================
// Seed do Browser Gate F6 (Homologation Rehearsal) — dados 100% FICTÍCIOS.
// Depende do seed multi-organização (organizações A/B e usuários do gate).
// Idempotente: apaga e recria SÓ os registros com os IDs fixos abaixo.
// ==============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[-] ERRO: DATABASE_URL não definida.');
  process.exit(1);
}
if (DATABASE_URL.includes('zafira_hub_v2') || !DATABASE_URL.includes('staging')) {
  console.error('[-] ERRO CRÍTICO: seed F6 só roda no banco de ensaio (staging) do CI.');
  process.exit(1);
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_A = 'f6f6f6f6-0000-4000-8000-0000000000a1';
const CLIENT_B = 'f6f6f6f6-0000-4000-8000-0000000000b1';
const PLAN_A = 'f6f6f6f6-1111-4000-8000-0000000000a1';
const PLAN_B = 'f6f6f6f6-1111-4000-8000-0000000000b1';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
const tz = 'America/Sao_Paulo';
const isoDay = (offsetDays) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offsetDays * 86_400_000)
  );
const period = isoDay(0).slice(0, 7);

async function main() {
  console.log(`[*] Seed F6: período ${period}`);
  await prisma.$transaction(async (tx) => {
    // Limpeza idempotente (cascata remove planos, itens, peças, eventos, espelho e fotos destes clientes)
    await tx.clientIntegration.deleteMany({ where: { clientId: { in: [CLIENT_A, CLIENT_B] } } });
    await tx.client.deleteMany({ where: { id: { in: [CLIENT_A, CLIENT_B] } } });

    await tx.client.create({ data: { id: CLIENT_A, organizationId: ORG_A, name: 'F6 Gate Cliente A', status: 'ACTIVE' } });
    await tx.client.create({ data: { id: CLIENT_B, organizationId: ORG_B, name: 'F6 Gate Cliente Sigiloso B', status: 'ACTIVE' } });
    await tx.clientIntegration.createMany({
      data: [
        { clientId: CLIENT_A, provider: 'ASANA', externalId: 'gate-proj-a1', metadata: { projectName: 'F6 Gate Social Media A' } },
        { clientId: CLIENT_B, provider: 'ASANA', externalId: 'gate-proj-b1', metadata: { projectName: 'F6 Gate Projeto Sigiloso B' } },
      ],
    });

    // Entregas: plano do mês da Org A (pacote de 8 conteúdos + 2 criativos)
    await tx.deliverablePlan.create({
      data: { id: PLAN_A, organizationId: ORG_A, clientId: CLIENT_A, period, title: 'F6 Gate Plano A', targetCount: 10, status: 'ACTIVE' },
    });
    const content = await tx.deliverableItem.create({
      data: { organizationId: ORG_A, planId: PLAN_A, title: 'Conteúdos para redes', type: 'CONTEUDO_SOCIAL', targetQuantity: 8, deliveredQuantity: 2, status: 'IN_PROGRESS' },
    });
    await tx.deliverableItem.create({
      data: { organizationId: ORG_A, planId: PLAN_A, title: 'Criativos para anúncios', type: 'CRIATIVO_ADS', targetQuantity: 2, deliveredQuantity: 0, status: 'PENDING' },
    });
    const now = new Date();
    await tx.deliverablePiece.createMany({
      data: [
        { organizationId: ORG_A, itemId: content.id, title: 'F6 Gate Reels postado', format: 'REELS', stage: 'DELIVERED', producedByUserId: USER_A, approvedAt: now, approvedByUserId: USER_A, deliveredAt: now, deliveredByUserId: USER_A },
        { organizationId: ORG_A, itemId: content.id, title: 'F6 Gate Carrossel postado', format: 'CARROSSEL', stage: 'DELIVERED', producedByUserId: USER_A, approvedAt: now, approvedByUserId: USER_A, deliveredAt: now, deliveredByUserId: USER_A },
        { organizationId: ORG_A, itemId: content.id, title: 'F6 Gate Feed aprovado', format: 'FEED', stage: 'APPROVED', producedByUserId: USER_A, approvedAt: now, approvedByUserId: USER_A },
      ],
    });
    await tx.deliverableEvent.create({ data: { organizationId: ORG_A, planId: PLAN_A, eventType: 'PLAN_CREATED', actorUserId: USER_A } });

    // Plano sigiloso da Org B (não pode aparecer para a Org A)
    await tx.deliverablePlan.create({
      data: { id: PLAN_B, organizationId: ORG_B, clientId: CLIENT_B, period, title: 'F6 Gate PLANO SIGILOSO B', targetCount: 1, status: 'ACTIVE' },
    });

    // Histórico do Asana (espelho) da Org A: 5 dias de fotos + mudanças
    await tx.asanaProjectMirror.create({
      data: { organizationId: ORG_A, clientId: CLIENT_A, projectGid: 'gate-proj-a1', name: 'F6 Gate Social Media A', baselineAt: new Date(Date.now() - 5 * 86_400_000), lastSyncedAt: now, lastAttemptAt: now, lastSyncStatus: 'SUCCESS' },
    });
    for (let i = 4; i >= 0; i--) {
      await tx.asanaProjectSnapshot.create({
        data: { organizationId: ORG_A, clientId: CLIENT_A, projectGid: 'gate-proj-a1', snapshotDate: isoDay(-i), totalTasks: 6, completedTasks: 1, pendingTasks: 5 - (i > 2 ? 0 : 0), overdueTasks: i > 2 ? 2 : 1, capturedAt: new Date(Date.now() - i * 86_400_000) },
      });
    }
    await tx.asanaTaskChange.createMany({
      data: [
        { organizationId: ORG_A, clientId: CLIENT_A, projectGid: 'gate-proj-a1', taskGid: 'ga-6', taskName: 'F6 Gate Briefing concluído', field: 'completed', before: false, after: true, detectedAt: new Date(Date.now() - 86_400_000) },
        { organizationId: ORG_A, clientId: CLIENT_A, projectGid: 'gate-proj-a1', taskGid: 'ga-3', taskName: 'F6 Gate Legendas da semana', field: 'assignee', before: { gid: 'u-bruno', name: 'Bruno Gate' }, after: { gid: 'u-ana', name: 'Ana Gate' }, detectedAt: now },
      ],
    });
  });
  console.log('[+] Seed F6 concluído (clientes, integrações, entregas, histórico — fictícios).');
}

main()
  .catch((err) => {
    console.error('[-] Falha no seed F6:', err?.message || err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
