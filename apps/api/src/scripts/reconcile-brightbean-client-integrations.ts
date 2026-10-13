import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma.js';

interface ClientAccountMapping {
  clientId: string;
  brightBeanAccountId: string;
  description: string;
}

const DEFAULT_MAPPINGS: ClientAccountMapping[] = [
  {
    clientId: '91cee5ec-3557-4476-b286-18bfa32aac11',
    brightBeanAccountId: '2251217e-e77f-487b-b4b0-ec707755017b',
    description: 'Cliente 1 -> Conta Instagram/Social BrightBean',
  },
  {
    clientId: '87a0e127-ad68-459d-8298-c511da2938f9',
    brightBeanAccountId: '85d8f325-c2d3-46bf-b362-48ec5505cc1c',
    description: 'Cliente 2 -> Conta Instagram/Social BrightBean',
  },
];

/**
 * Script de reconciliação idempotente de ClientIntegration para a BrightBean.
 *
 * REGRAS DE GOVERNANÇA:
 * - Default: DRY RUN.
 * - Somente escreve no banco se fornecida a flag explícita --apply.
 * - Valida existência do cliente e tenant isolation antes de qualquer escrita.
 * - NUNCA apaga ou altera registros de POSTIZ, ASANA ou outros providers.
 */
export interface ReconcileResult {
  validatedCount: number;
  upsertedCount: number;
  conflicts: string[];
  errors: string[];
}

export async function reconcileBrightBeanClientIntegrations(options: {
  isApply: boolean;
  organizationId?: string;
  mappings?: ClientAccountMapping[];
  prisma: any;
}): Promise<ReconcileResult> {
  const { isApply, organizationId, mappings = DEFAULT_MAPPINGS, prisma } = options;
  const resultSummary: ReconcileResult = {
    validatedCount: 0,
    upsertedCount: 0,
    conflicts: [],
    errors: [],
  };

  if (isApply && !organizationId) {
    const errorMsg = 'ORGANIZATION_ID é obrigatório para execução em modo --apply.';
    resultSummary.errors.push(errorMsg);
    throw new Error(errorMsg);
  }

  for (const mapping of mappings) {
    const client = await prisma.client.findUnique({
      where: { id: mapping.clientId },
      select: { id: true, name: true, organizationId: true },
    });

    if (!client) {
      const msg = `Cliente ${mapping.clientId} não encontrado na base de dados.`;
      if (isApply) {
        resultSummary.errors.push(msg);
        throw new Error(msg);
      }
      continue;
    }

    if (organizationId && client.organizationId !== organizationId) {
      const msg = `Cliente ${client.name} não pertence à organização informada (${organizationId}). Operação abortada.`;
      if (isApply) {
        resultSummary.errors.push(msg);
        throw new Error(msg);
      }
      continue;
    }

    // Valida se a conta já está vinculada a OUTRO cliente na mesma organização
    const conflict = await prisma.clientIntegration.findFirst({
      where: {
        provider: 'BRIGHTBEAN',
        externalId: mapping.brightBeanAccountId,
        client: { organizationId: client.organizationId },
        clientId: { not: client.id },
      },
      include: { client: { select: { id: true, name: true } } },
    });

    if (conflict) {
      const msg = `A conta ${mapping.brightBeanAccountId} já está vinculada a outro cliente na organização. Conflito impedido.`;
      resultSummary.conflicts.push(msg);
      if (isApply) {
        resultSummary.errors.push(msg);
        throw new Error(msg);
      }
      continue;
    }

    resultSummary.validatedCount++;

    if (isApply) {
      await prisma.clientIntegration.upsert({
        where: {
          clientId_provider_externalId: {
            clientId: client.id,
            provider: 'BRIGHTBEAN',
            externalId: mapping.brightBeanAccountId,
          },
        },
        create: {
          clientId: client.id,
          provider: 'BRIGHTBEAN',
          externalId: mapping.brightBeanAccountId,
          metadata: {
            reconciledBy: 'script:reconcile-brightbean-client-integrations',
            reconciledAt: new Date().toISOString(),
          },
        },
        update: {
          metadata: {
            reconciledBy: 'script:reconcile-brightbean-client-integrations',
            reconciledAt: new Date().toISOString(),
          },
        },
      });
      resultSummary.upsertedCount++;
    }
  }

  return resultSummary;
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const organizationId =
    process.env.ORGANIZATION_ID ||
    args.find((a) => a.startsWith('--org-id='))?.split('=')[1];

  console.log('====================================================');
  console.log(' RECONCILIAÇÃO DE VÍNCULOS DE CLIENTES BRIGHTBEAN');
  console.log(` MODO: ${isApply ? 'APPLY (ESCRITA NO BANCO)' : 'DRY RUN (SOMENTE LEITURA)'}`);
  console.log('====================================================');

  try {
    const summary = await reconcileBrightBeanClientIntegrations({
      isApply,
      organizationId,
      prisma: defaultPrisma as any,
    });
    console.log(`Validados: ${summary.validatedCount}, Upserts: ${summary.upsertedCount}`);
    if (!isApply) {
      console.log('[DRY RUN] Nenhuma modificação gravada no banco.');
    } else {
      console.log('[APPLY] Vínculos reconciliados com sucesso.');
    }
  } catch (err: any) {
    console.error('Falha na execução:', err?.message || err);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('reconcile-brightbean-client-integrations.ts')) {
  main().catch((err) => {
    console.error('Falha:', err?.message || err);
    process.exit(1);
  });
}
