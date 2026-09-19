import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail) {
    throw new Error('Variável de ambiente ADMIN_EMAIL não configurada.');
  }

  if (!adminPassword || adminPassword.length < 6) {
    throw new Error('Variável de ambiente ADMIN_PASSWORD não configurada ou muito curta (mínimo 6 caracteres).');
  }

  const normalizedEmail = adminEmail.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new Error(`Usuário não encontrado com o e-mail: ${normalizedEmail}. Execute "npm run db:seed" primeiro.`);
  }

  const passwordHash = await argon2.hash(adminPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
    },
  });

  console.log(`[Admin Password] Senha configurada com sucesso para o usuário: ${user.name} (${user.email}).`);
  console.log('[Admin Password] Lembre-se de remover ADMIN_PASSWORD do seu ambiente se desejar.');
}

main()
  .catch((err) => {
    console.error('[Admin Password] Erro:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
