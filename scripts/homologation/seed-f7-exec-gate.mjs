import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// ==============================================================================
// Seed do Browser Gate F7-2 (Homologation Rehearsal) - dados 100% FICTICIOS.
// Depende do seed multi-organizacao e do seed-f7-gate (pessoas). Cria SOMENTE clientes
// e vinculos de carteira para o gate; NENHUM modelo, etapa, funcao ou execucao e semeado
// (o gate cria tudo pela API/interface). Idempotente.
// ==============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[-] ERRO: DATABASE_URL nao definida.');
  process.exit(1);
}
if (DATABASE_URL.includes('zafira_hub_v2') || (!DATABASE_URL.includes('_ui') && !DATABASE_URL.includes('staging'))) {
  console.error('[-] ERRO CRITICO: seed F7-2 so roda no banco de ensaio (staging) do CI ou em banco descartavel local.');
  process.exit(1);
}
const PASSWORD = process.env.GATE_PASSWORD_A;
if (!PASSWORD) {
  console.error('[-] ERRO: GATE_PASSWORD_A obrigatoria.');
  process.exit(1);
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CLIENT_1 = 'f7f7f7f7-c1c1-4c1c-8c1c-000000000001';
const CLIENT_2 = 'f7f7f7f7-c1c1-4c1c-8c1c-000000000002';
const CLIENT_B = 'f7f7f7f7-c1c1-4c1c-8c1c-0000000000b1';
const PEOPLE_IDS = {
  manager: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000001',
  member: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000002',
  pessoa: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000003',
};
const NO_VIEW_USER = 'f7f7f7f7-aaaa-4aaa-8aaa-000000000009';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function main() {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    for (const [id, orgId, name] of [
      [CLIENT_1, ORG_A, 'F7 Gate Cliente 1'],
      [CLIENT_2, ORG_A, 'F7 Gate Cliente 2'],
      [CLIENT_B, ORG_B, 'F7 Gate Cliente Sigiloso B'],
    ]) {
      await tx.client.upsert({
        where: { id },
        update: { name, status: 'ACTIVE' },
        create: { id, organizationId: orgId, name, status: 'ACTIVE' },
      });
    }

    // carteira: gestor, membro e pessoa de operacao veem o Cliente 1; ninguem alem do admin ve o Cliente 2
    const members = await tx.organizationMember.findMany({
      where: { organizationId: ORG_A, userId: { in: Object.values(PEOPLE_IDS) } },
      select: { id: true },
    });
    for (const m of members) {
      await tx.userClientAssignment.upsert({
        where: { organizationMemberId_clientId: { organizationMemberId: m.id, clientId: CLIENT_1 } },
        update: {},
        create: { organizationId: ORG_A, organizationMemberId: m.id, clientId: CLIENT_1 },
      });
    }

    // Isolamento da fixture F7-2: reativa 'Gate Pessoa Saida' (suspensa no ensaio F7-1)
    // para que seja membro ativo da Org A, mas sem o CLIENT_1 na carteira (teste de reatribuicao fora da carteira).
    await tx.organizationMember.updateMany({
      where: { organizationId: ORG_A, userId: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000004' },
      data: { status: 'ACTIVE' },
    });

    // projeto do Asana (somente vinculo local) para a etapa "confirmar projeto"
    await tx.clientIntegration.upsert({
      where: { clientId_provider_externalId: { clientId: CLIENT_1, provider: 'ASANA', externalId: 'gate-proj-a1' } },
      update: {},
      create: { clientId: CLIENT_1, provider: 'ASANA', externalId: 'gate-proj-a1', metadata: { projectName: 'F6 Gate Social Media A' } },
    });

    // usuario SEM onboarding.view (override individual negado): menu oculto e rotas recusadas
    await tx.user.upsert({
      where: { id: NO_VIEW_USER },
      update: { passwordHash: hash, status: 'ACTIVE' },
      create: { id: NO_VIEW_USER, email: 'gate-semview-a@zafira.invalid', name: 'Gate Sem Visao A', passwordHash: hash, status: 'ACTIVE' },
    });
    const member = await tx.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: ORG_A, userId: NO_VIEW_USER } },
      update: { role: 'MEMBER', status: 'ACTIVE' },
      create: { userId: NO_VIEW_USER, organizationId: ORG_A, role: 'MEMBER', status: 'ACTIVE' },
    });
    await tx.organizationMemberPermission.upsert({
      where: { organizationMemberId_permissionCode: { organizationMemberId: member.id, permissionCode: 'onboarding.view' } },
      update: { allowed: false },
      create: { organizationId: ORG_A, organizationMemberId: member.id, permissionCode: 'onboarding.view', allowed: false },
    });
    await tx.organizationMemberPermission.upsert({
      where: { organizationMemberId_permissionCode: { organizationMemberId: member.id, permissionCode: 'calendar.view' } },
      update: { allowed: false },
      create: { organizationId: ORG_A, organizationMemberId: member.id, permissionCode: 'calendar.view', allowed: false },
    });
  });
  console.log('[+] Seed F7-2 concluido (clientes, carteira e usuario sem visao - ficticios; nenhum modelo/execucao).');
}

main()
  .catch((err) => {
    console.error('[-] Falha no seed F7-2:', err?.message || err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
