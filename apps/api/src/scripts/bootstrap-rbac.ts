import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ADMIN_DEFAULTS, MANAGER_DEFAULTS, MEMBER_DEFAULTS } from '@zafira/domain';
import {
  applyRbacSync,
  computeRbacSyncPlan,
  formatRbacSyncReport,
  loadRbacState,
  reportIndividualExceptions,
  RbacDefaultsInvalidError,
  assertRbacDefaultsSane,
  type RbacDefaults,
} from '../modules/authorization/rbac-sync.js';

/**
 * Bootstrap RBAC (HM-1 / H1, P22).
 *
 *   npm run rbac:bootstrap --workspace=@zafira/api              # sincroniza (cria o que falta e REMOVE o que deixou de ser padrao)
 *   npm run rbac:bootstrap --workspace=@zafira/api -- --check   # somente leitura: lista divergencias; sai com 2 se houver
 *
 * Nunca altera excecoes individuais por membro e nunca remove codigos do catalogo.
 * Idempotente. Exige DATABASE_URL; nao imprime credenciais.
 */
const prisma = new PrismaClient();

const defaults: RbacDefaults = {
  ADMIN: ADMIN_DEFAULTS,
  MANAGER: MANAGER_DEFAULTS,
  MEMBER: MEMBER_DEFAULTS,
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check') || args.includes('--dry-run');

  const maskedUrl = databaseUrl.replace(/:[^:@]+@/, ':***@');
  console.log(`${checkOnly ? 'Verificação' : 'Bootstrap'} RBAC no ambiente: ${maskedUrl}`);

  try {
    assertRbacDefaultsSane(PERMISSIONS, defaults);

    if (checkOnly) {
      const plan = computeRbacSyncPlan(PERMISSIONS, defaults, await loadRbacState(prisma));
      const exceptions = await reportIndividualExceptions(prisma);
      console.log(formatRbacSyncReport(plan, exceptions, 'check'));
      if (!plan.inSync) {
        console.error('Divergências entre as permissões padrão esperadas e as cadastradas. Rode o bootstrap (sem --check) antes do deploy.');
        process.exitCode = 2;
      }
      return;
    }

    const { result, plan } = await applyRbacSync(prisma, PERMISSIONS, defaults);
    const exceptions = await reportIndividualExceptions(prisma);
    console.log(formatRbacSyncReport(plan, exceptions, 'apply'));
    console.log(`Bootstrap RBAC concluído: ${result.created} criada(s) no catálogo, ${result.added} acrescentada(s), ${result.removed} removida(s).`);
  } catch (error) {
    if (error instanceof RbacDefaultsInvalidError) {
      console.error(`Padrões de permissão inválidos: ${error.message} Nada foi alterado.`);
    } else {
      console.error('Erro durante o bootstrap RBAC:', error);
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
