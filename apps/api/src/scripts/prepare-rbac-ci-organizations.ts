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
      create: { name: 'Admin A', email: 'admin_a@zafira.test', password: 'hash' }
    });
    const memAdminA = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgA.id, userId: adminA.id } },
      update: {},
      create: { organizationId: orgA.id, userId: adminA.id, role: 'ADMIN' }
    });

    const managerA = await prisma.user.upsert({
      where: { email: 'manager_a@zafira.test' },
      update: {},
      create: { name: 'Manager A', email: 'manager_a@zafira.test', password: 'hash' }
    });
    const memManagerA = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgA.id, userId: managerA.id } },
      update: {},
      create: { organizationId: orgA.id, userId: managerA.id, role: 'MANAGER' }
    });

    const memberA = await prisma.user.upsert({
      where: { email: 'member_a@zafira.test' },
      update: {},
      create: { name: 'Member A', email: 'member_a@zafira.test', password: 'hash' }
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
      create: { name: 'Admin B', email: 'admin_b@zafira.test', password: 'hash' }
    });
    const memAdminB = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: orgB.id, userId: adminB.id } },
      update: {},
      create: { organizationId: orgB.id, userId: adminB.id, role: 'ADMIN' }
    });

    // Clients
    const clientAAssigned = await prisma.client.upsert({
      where: { document: '11111111111' }, // fake doc to make it idempotent
      update: {},
      create: {
        organizationId: orgA.id,
        name: 'Client A Assigned',
        legalName: 'Client A Assigned',
        document: '11111111111',
      }
    });

    const clientAUnassigned = await prisma.client.upsert({
      where: { document: '22222222222' },
      update: {},
      create: {
        organizationId: orgA.id,
        name: 'Client A Unassigned',
        legalName: 'Client A Unassigned',
        document: '22222222222',
      }
    });

    const clientB = await prisma.client.upsert({
      where: { document: '33333333333' },
      update: {},
      create: {
        organizationId: orgB.id,
        name: 'Client B',
        legalName: 'Client B',
        document: '33333333333',
      }
    });

    // Assignments
    // Member A -> Client A Assigned
    await prisma.userClientAssignment.upsert({
      where: {
        clientId_organizationMemberId: {
          clientId: clientAAssigned.id,
          organizationMemberId: memMemberA.id
        }
      },
      update: {},
      create: {
        clientId: clientAAssigned.id,
        organizationMemberId: memMemberA.id
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
