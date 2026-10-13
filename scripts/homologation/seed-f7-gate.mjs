import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// ==============================================================================
// Seed do Browser Gate F7-1 (Homologation Rehearsal) - pessoas 100% FICTICIAS.
// Depende do seed multi-organizacao (Org A/B e usuarios admin do gate) e do rbac:bootstrap.
// Cria na Org A: um gestor, um membro e duas pessoas de operacao, para os testes de
// permissao e de funcoes/pessoas desativadas. NENHUM modelo, etapa ou funcao e criado aqui:
// o gate cria tudo pela interface. Senha: a mesma credencial efemera do gate (GATE_PASSWORD_A).
// ==============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[-] ERRO: DATABASE_URL nao definida.');
  process.exit(1);
}
if (DATABASE_URL.includes('zafira_hub_v2') || !DATABASE_URL.includes('_ui') && !DATABASE_URL.includes('staging')) {
  console.error('[-] ERRO CRITICO: seed F7 so roda no banco de ensaio (staging) do CI ou em banco descartavel local.');
  process.exit(1);
}
const PASSWORD = process.env.GATE_PASSWORD_A;
if (!PASSWORD) {
  console.error('[-] ERRO: GATE_PASSWORD_A obrigatoria.');
  process.exit(1);
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const PEOPLE = [
  { id: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000001', email: 'gate-manager-a@zafira.invalid', name: 'Gate Gestor A', role: 'MANAGER', status: 'ACTIVE' },
  { id: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000002', email: 'gate-member-a@zafira.invalid', name: 'Gate Membro A', role: 'MEMBER', status: 'ACTIVE' },
  { id: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000003', email: 'gate-pessoa-a@zafira.invalid', name: 'Gate Pessoa Operacao', role: 'MEMBER', status: 'ACTIVE' },
  { id: 'f7f7f7f7-aaaa-4aaa-8aaa-000000000004', email: 'gate-saida-a@zafira.invalid', name: 'Gate Pessoa Saida', role: 'MEMBER', status: 'ACTIVE' },
];

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function main() {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    for (const p of PEOPLE) {
      await tx.user.upsert({
        where: { id: p.id },
        update: { email: p.email, name: p.name, passwordHash: hash, status: 'ACTIVE' },
        create: { id: p.id, email: p.email, name: p.name, passwordHash: hash, status: 'ACTIVE' },
      });
      await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: ORG_A, userId: p.id } },
        update: { role: p.role, status: p.status },
        create: { userId: p.id, organizationId: ORG_A, role: p.role, status: p.status },
      });
    }
  });
  console.log('[+] Seed F7 concluido (gestor, membro e 2 pessoas de operacao ficticias na Org A).');
}

main()
  .catch((err) => {
    console.error('[-] Falha no seed F7:', err?.message || err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
