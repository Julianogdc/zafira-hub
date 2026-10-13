import { PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  ADMIN_DEFAULTS,
  MANAGER_DEFAULTS,
  MEMBER_DEFAULTS,
} from '@zafira/domain';

const prisma = new PrismaClient();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }

  // Mask credentials for display
  const maskedUrl = databaseUrl.replace(/:[^:@]+@/, ':***@');
  console.log(`Iniciando Bootstrap RBAC no ambiente: ${maskedUrl}`);

  try {
    // 1. Upsert Permissions
    console.log('Sincronizando catálogo de permissões...');
    for (const code of PERMISSIONS) {
      const area = code.split('.')[0];
      await prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          area,
          description: `Permissão do sistema: ${code}`,
        },
      });
    }

    // 2. Garantir RolePermissions para cada role e permissão default
    console.log('Sincronizando defaults para Role: ADMIN...');
    for (const code of ADMIN_DEFAULTS) {
      await prisma.rolePermission.upsert({
        where: {
          role_permissionCode: {
            role: 'ADMIN',
            permissionCode: code,
          },
        },
        update: {},
        create: {
          role: 'ADMIN',
          permissionCode: code,
        },
      });
    }

    console.log('Sincronizando defaults para Role: MANAGER...');
    for (const code of MANAGER_DEFAULTS) {
      await prisma.rolePermission.upsert({
        where: {
          role_permissionCode: {
            role: 'MANAGER',
            permissionCode: code,
          },
        },
        update: {},
        create: {
          role: 'MANAGER',
          permissionCode: code,
        },
      });
    }

    console.log('Sincronizando defaults para Role: MEMBER...');
    for (const code of MEMBER_DEFAULTS) {
      await prisma.rolePermission.upsert({
        where: {
          role_permissionCode: {
            role: 'MEMBER',
            permissionCode: code,
          },
        },
        update: {},
        create: {
          role: 'MEMBER',
          permissionCode: code,
        },
      });
    }

    console.log('Bootstrap RBAC concluído com sucesso.');
  } catch (error) {
    console.error('Erro durante o bootstrap RBAC:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
