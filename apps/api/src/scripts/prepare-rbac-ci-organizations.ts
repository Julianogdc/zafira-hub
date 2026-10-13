import { PrismaClient } from '@prisma/client';

// --- GUARD DE SEGURANÇA (ETAPA F) ---
if (process.env.NODE_ENV === 'production') {
  throw new Error('NÃO É PERMITIDO EXECUTAR PREPARE CI EM PRODUÇÃO');
}

if (process.env.ZAFIRA_TEST_DATABASE !== '1') {
  throw new Error('ZAFIRA_TEST_DATABASE=1 obrigatório para testes de integração');
}

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.includes('/zafira_hub_ci')) {
  throw new Error('O banco alvo deve se chamar "zafira_hub_ci". URL rejeitada.');
}

const prisma = new PrismaClient();

async function upsertClient(organizationId: string, document: string, name: string, legalName: string) {
  let client = await prisma.client.findFirst({
    where: { organizationId, document }
  });
  if (client) {
    return client;
  }
  return await prisma.client.create({
    data: {
      organizationId,
      document,
      name,
      legalName
    }
  });
}

async function main() {
  console.log('Iniciando preparação de organizações fictícias para CI...');

  try {
    const orgA = await prisma.organization.upsert({
      where: { slug: 'ci-org-a' },
      update: {},
      create: {
        slug: 'ci-org-a',
        name: 'CI Organization A',
      }
    });

    const orgB = await prisma.organization.upsert({
      where: { slug: 'ci-org-b' },
      update: {},
      create: {
        slug: 'ci-org-b',
        name: 'CI Organization B',
      }
    });

    // Fixtures (Etapa I)
    
    // Org A Users & Memberships
    const adminA = await prisma.user.upsert({
      where: { email: 'admin_a@zafira.test' },
      update: {},
      create: { name: 'Admin A', email: 'admin_a@zafira.test' }
    });
    const memAdminA = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgA.id, userId: adminA.id } },
      update: {},
      create: { organizationId: orgA.id, userId: adminA.id, role: 'ADMIN' }
    });

    const managerA = await prisma.user.upsert({
      where: { email: 'manager_a@zafira.test' },
      update: {},
      create: { name: 'Manager A', email: 'manager_a@zafira.test' }
    });
    const memManagerA = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgA.id, userId: managerA.id } },
      update: {},
      create: { organizationId: orgA.id, userId: managerA.id, role: 'MANAGER' }
    });

    const memberA = await prisma.user.upsert({
      where: { email: 'member_a@zafira.test' },
      update: {},
      create: { name: 'Member A', email: 'member_a@zafira.test' }
    });
    const memMemberA = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgA.id, userId: memberA.id } },
      update: {},
      create: { organizationId: orgA.id, userId: memberA.id, role: 'MEMBER' }
    });

    // Org B Users & Memberships
    const adminB = await prisma.user.upsert({
      where: { email: 'admin_b@zafira.test' },
      update: {},
      create: { name: 'Admin B', email: 'admin_b@zafira.test' }
    });
    const memAdminB = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgB.id, userId: adminB.id } },
      update: {},
      create: { organizationId: orgB.id, userId: adminB.id, role: 'ADMIN' }
    });

    // Clients
    const clientAAssigned = await upsertClient(orgA.id, '11111111111', 'Client A Assigned', 'Client A Assigned');
    const clientAUnassigned = await upsertClient(orgA.id, '22222222222', 'Client A Unassigned', 'Client A Unassigned');
    const clientB = await upsertClient(orgB.id, '33333333333', 'Client B', 'Client B');

    // Assignments
    // Member A -> Client A Assigned
    await prisma.userClientAssignment.upsert({
      where: {
        organizationMemberId_clientId: {
          organizationMemberId: memMemberA.id,
          clientId: clientAAssigned.id
        }
      },
      update: {},
      create: {
        organizationId: orgA.id,
        organizationMemberId: memMemberA.id,
        clientId: clientAAssigned.id
      }
    });

    console.log('Organizações e fixtures criados com sucesso!');
  } catch (err) {
    console.error('Falha ao preparar CI:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
