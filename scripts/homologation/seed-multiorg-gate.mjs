import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// ==============================================================================
// Script de Seed da Fixture para Rehearsal do Portão Multi-Organização
// Cria duas organizações independentes e dois usuários ADMIN em ambiente controlado.
// ==============================================================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[-] ERRO: DATABASE_URL não definida.');
  process.exit(1);
}

// Proteção contra apontamento acidental para banco de produção
if (DATABASE_URL.includes('zafira_hub_v2')) {
  console.error('[-] ERRO CRÍTICO: Execução de seed bloqueada em banco de PRODUÇÃO (zafira_hub_v2)!');
  process.exit(1);
}

const PASSWORD_A = process.env.GATE_PASSWORD_A;
const PASSWORD_B = process.env.GATE_PASSWORD_B;

if (!PASSWORD_A || !PASSWORD_B) {
  console.error('[-] ERRO: Variáveis GATE_PASSWORD_A e GATE_PASSWORD_B são obrigatórias.');
  process.exit(1);
}

const ORG_A = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'HML Gate Organization A',
  slug: 'hml-gate-org-a',
};

const ORG_B = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'HML Gate Organization B',
  slug: 'hml-gate-org-b',
};

const USER_A = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'gate-a@zafira.invalid',
  name: 'Gate Admin A',
  membershipId: '11111111-aaaa-4111-8111-aaaaaaaaaaaa',
};

const USER_B = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'gate-b@zafira.invalid',
  name: 'Gate Admin B',
  membershipId: '22222222-bbbb-4222-8222-bbbbbbbbbbbb',
};

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

async function main() {
  console.log('[*] Iniciando seed idempotente de fixture multi-organização...');

  const sanitizedUrl = DATABASE_URL.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@');
  console.log(`[*] Destino do banco: ${sanitizedUrl}`);

  // 1. Hash de senhas com Argon2id
  const hashA = await argon2.hash(PASSWORD_A, { type: argon2.argon2id });
  const hashB = await argon2.hash(PASSWORD_B, { type: argon2.argon2id });

  await prisma.$transaction(async (tx) => {
    // 2. Upsert Organizações A e B
    await tx.organization.upsert({
      where: { id: ORG_A.id },
      update: { name: ORG_A.name, slug: ORG_A.slug },
      create: { id: ORG_A.id, name: ORG_A.name, slug: ORG_A.slug },
    });

    await tx.organization.upsert({
      where: { id: ORG_B.id },
      update: { name: ORG_B.name, slug: ORG_B.slug },
      create: { id: ORG_B.id, name: ORG_B.name, slug: ORG_B.slug },
    });

    // 3. Upsert Usuários A e B (status ACTIVE)
    await tx.user.upsert({
      where: { id: USER_A.id },
      update: {
        email: USER_A.email,
        name: USER_A.name,
        passwordHash: hashA,
        status: 'ACTIVE',
      },
      create: {
        id: USER_A.id,
        email: USER_A.email,
        name: USER_A.name,
        passwordHash: hashA,
        status: 'ACTIVE',
      },
    });

    await tx.user.upsert({
      where: { id: USER_B.id },
      update: {
        email: USER_B.email,
        name: USER_B.name,
        passwordHash: hashB,
        status: 'ACTIVE',
      },
      create: {
        id: USER_B.id,
        email: USER_B.email,
        name: USER_B.name,
        passwordHash: hashB,
        status: 'ACTIVE',
      },
    });

    // 4. Upsert Memberships (User A -> Org A [ADMIN, ACTIVE]; User B -> Org B [ADMIN, ACTIVE])
    await tx.membership.upsert({
      where: { id: USER_A.membershipId },
      update: {
        userId: USER_A.id,
        organizationId: ORG_A.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      create: {
        id: USER_A.membershipId,
        userId: USER_A.id,
        organizationId: ORG_A.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });

    await tx.membership.upsert({
      where: { id: USER_B.membershipId },
      update: {
        userId: USER_B.id,
        organizationId: ORG_B.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
      create: {
        id: USER_B.membershipId,
        userId: USER_B.id,
        organizationId: ORG_B.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  });

  console.log('[+] Fixture Multi-Org aplicada com sucesso:');
  console.log(`    - Org A: ${ORG_A.name} (${ORG_A.id}) | User A: ${USER_A.email}`);
  console.log(`    - Org B: ${ORG_B.name} (${ORG_B.id}) | User B: ${USER_B.email}`);
  console.log('[+] Zero clients criados no banco (devem ser criados via HTTP no teste).');
}

main()
  .catch((err) => {
    console.error('[-] Erro ao executar seed multi-org:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
