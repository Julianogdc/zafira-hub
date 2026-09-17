import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { InterService } from '../modules/integrations/inter/inter.service.js';

/**
 * Script executável para reparo idempotente de duplicatas do Banco Inter PJ.
 * - Identifica pares idênticos de lançamentos bancários
 * - Mescla classificações manuais e clientes para o registro canônico com valor real
 * - Preserva vínculos de transferências internas
 * - Remove exclusivamente os registros espúrios com valor R$ 0,00
 * - Totalmente idempotente
 */
async function main() {
  console.log('[RepairDuplicatesScript] Iniciando reparo seguro de duplicatas do Banco Inter PJ...');

  const interService = new InterService(prisma);
  const result = await interService.repairInterDuplicates();

  console.log('[RepairDuplicatesScript] Concluído com sucesso:', {
    totalInspecionadas: result.totalInspected,
    classificacoesMescladas: result.mergedCount,
    duplicatasRemovidas: result.removedCount,
  });
}

main()
  .catch((err) => {
    console.error('[RepairDuplicatesScript] Erro ao executar reparo:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
