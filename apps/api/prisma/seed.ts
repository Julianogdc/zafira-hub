import 'dotenv/config';
import { PrismaClient, Role, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    throw new Error('Variável de ambiente ADMIN_EMAIL não configurada. Defina ADMIN_EMAIL antes de executar o seed.');
  }

  console.log('[Seed] Iniciando seed de infraestrutura inicial do Zafira Hub 2.0...');

  // 1. Organization: Zafira
  const organization = await prisma.organization.upsert({
    where: { slug: 'zafira' },
    update: {
      name: 'Zafira',
    },
    create: {
      name: 'Zafira',
      slug: 'zafira',
    },
  });
  console.log(`[Seed] Organização garantida: ${organization.name} (${organization.slug})`);

  // 2. User: Juliano Guerrero
  const user = await prisma.user.upsert({
    where: { email: adminEmail.trim().toLowerCase() },
    update: {
      name: 'Juliano Guerrero',
      status: UserStatus.ACTIVE,
    },
    create: {
      name: 'Juliano Guerrero',
      email: adminEmail.trim().toLowerCase(),
      status: UserStatus.ACTIVE,
    },
  });
  console.log(`[Seed] Usuário administrador garantido: ${user.name}`);

  // 3. OrganizationMember: ADMIN
  const membership = await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: {
      role: Role.ADMIN,
    },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: Role.ADMIN,
    },
  });
  console.log(`[Seed] Vínculo de membro garantido: Papel ${membership.role}`);

  console.log('[Seed] Seed finalizado com sucesso!');
}

main()
  .catch((e) => {
    console.error('[Seed] Erro ao executar seed:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
