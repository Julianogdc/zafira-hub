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

  const prisma: PrismaClient = defaultPrisma as any;

  let validatedCount = 0;
  for (const mapping of DEFAULT_MAPPINGS) {
    console.log(`\nVerificando vínculo: ${mapping.description}`);
    console.log(`- Client ID:        ${mapping.clientId}`);
    console.log(`- BrightBean Acc:   ${mapping.brightBeanAccountId}`);

    const client = await prisma.client.findUnique({
      where: { id: mapping.clientId },
      select: { id: true, name: true, organizationId: true },
    });

    if (!client) {
      console.warn(`[AVISO] Cliente ${mapping.clientId} não encontrado na base de dados local.`);
      continue;
    }

    if (organizationId && client.organizationId !== organizationId) {
      console.warn(`[AVISO] Cliente ${client.name} pertence à organização ${client.organizationId}, diferente da esperada ${organizationId}. Ignorando.`);
      continue;
    }

    console.log(`- Cliente encontrado: ${client.name} (Org: ${client.organizationId})`);

    const existingLink = await prisma.clientIntegration.findFirst({
      where: {
        clientId: client.id,
        provider: 'BRIGHTBEAN',
        externalId: mapping.brightBeanAccountId,
      },
    });

    if (existingLink) {
      console.log(`- Status: Já vinculado (ClientIntegration ID: ${existingLink.id})`);
    } else {
      console.log(`- Status: Pendente de vinculação.`);
    }

    validatedCount++;

    if (isApply && !existingLink) {
      const created = await prisma.clientIntegration.create({
        data: {
          clientId: client.id,
          provider: 'BRIGHTBEAN',
          externalId: mapping.brightBeanAccountId,
          metadata: {
            reconciledBy: 'script:reconcile-brightbean-client-integrations',
            reconciledAt: new Date().toISOString(),
          },
        },
      });
      console.log(`  -> Criado com sucesso! ID: ${created.id}`);
    }
  }

  console.log('\n====================================================');
  console.log(`Total mapeamentos processados: ${validatedCount} de ${DEFAULT_MAPPINGS.length}`);
  if (!isApply) {
    console.log('[DRY RUN] Nenhuma modificação foi gravada no banco.');
    console.log('Para aplicar, execute com --apply');
  } else {
    console.log('[APPLY] Vínculos reconciliados com sucesso.');
  }
}

main().catch((err) => {
  console.error('Falha na execução da reconciliação:', err?.message || err);
  process.exit(1);
});
