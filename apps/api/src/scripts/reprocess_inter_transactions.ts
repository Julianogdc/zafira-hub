import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { InterService } from '../modules/integrations/inter/inter.service.js';

/**
 * Script de reprocessamento idempotente das transações do Banco Inter PJ.
 * - Corrige datas (occurredAt) inválidas ou desformatadas
 * - Corrige direções (CREDIT para Pix recebido, DEBIT para Pix enviado/pagamentos)
 * - Garante magnitude positiva dos valores
 * - Preserva IDs, histórico e transações internas já conciliadas
 * - Reexecuta a conciliação de transferências com o Asaas
 * - Zero deleção ou duplicação
 */
async function main() {
  console.log('[ReprocessScript] Iniciando reprocessamento idempotente do Banco Inter PJ...');

  const interService = new InterService(prisma);
  const result = await interService.reprocessExistingTransactions();

  console.log('[ReprocessScript] Concluído com sucesso:', {
    totalEncontradas: result.reprocessedCount,
    totalAtualizadas: result.updatedCount,
    transferenciasConciliadas: result.autoMatchedTransfers,
    transferenciasEmRevisao: result.reviewTransfers,
  });
}

main()
  .catch((err) => {
    console.error('[ReprocessScript] Erro ao reprocessar:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
