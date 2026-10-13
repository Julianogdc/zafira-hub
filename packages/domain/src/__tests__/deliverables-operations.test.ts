import test from 'node:test';
import assert from 'node:assert';
import {
  calculatePlanMetrics,
  deriveItemProgress,
  isDeliverableServiceType,
  nextPieceStage,
  previousPieceStage,
  validatePieceCancel,
  validatePieceFormat,
  DeliverableDomainError,
  ADMIN_DEFAULTS,
  MANAGER_DEFAULTS,
  MEMBER_DEFAULTS,
  PERMISSIONS,
} from '../index.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof DeliverableDomainError);
    return err.code;
  }
  return null;
};

test('Taxonomia (DEC-F6-002): só os serviços da Zafira são aceitos em novas linhas', () => {
  for (const t of ['CONTEUDO_SOCIAL', 'CRIATIVO_ADS', 'RELATORIO_MENSAL', 'CAPTACAO', 'GESTAO_TRAFEGO', 'OUTRO']) {
    assert.strictEqual(isDeliverableServiceType(t), true, t);
  }
  assert.strictEqual(isDeliverableServiceType('POST_FEED'), false);
  assert.strictEqual(isDeliverableServiceType(''), false);
});

test('Formato: pacote de conteúdos exige feed, carrossel, Reels ou Stories; outros serviços não têm formato', () => {
  assert.strictEqual(validatePieceFormat('CONTEUDO_SOCIAL', 'REELS'), 'REELS');
  assert.strictEqual(code(() => validatePieceFormat('CONTEUDO_SOCIAL', undefined)), 'FORMAT_REQUIRED');
  assert.strictEqual(code(() => validatePieceFormat('CONTEUDO_SOCIAL', 'TIKTOK')), 'FORMAT_REQUIRED');
  assert.strictEqual(validatePieceFormat('RELATORIO_MENSAL', null), null);
  assert.strictEqual(code(() => validatePieceFormat('CRIATIVO_ADS', 'FEED')), 'FORMAT_NOT_ALLOWED');
});

test('Etapas: produzida → aprovada → entregue; entregue e cancelada não avançam', () => {
  assert.strictEqual(nextPieceStage('PRODUCED'), 'APPROVED');
  assert.strictEqual(nextPieceStage('APPROVED'), 'DELIVERED');
  assert.strictEqual(code(() => nextPieceStage('DELIVERED')), 'INVALID_STAGE_TRANSITION');
  assert.strictEqual(code(() => nextPieceStage('CANCELLED')), 'INVALID_STAGE_TRANSITION');
});

test('Voltar etapa exige justificativa e não sai da primeira etapa', () => {
  assert.strictEqual(previousPieceStage('DELIVERED', 'Post apagado pelo cliente'), 'APPROVED');
  assert.strictEqual(previousPieceStage('APPROVED', 'Aprovado por engano'), 'PRODUCED');
  assert.strictEqual(code(() => previousPieceStage('APPROVED', '')), 'REASON_REQUIRED');
  assert.strictEqual(code(() => previousPieceStage('APPROVED', '  a ')), 'REASON_REQUIRED');
  assert.strictEqual(code(() => previousPieceStage('PRODUCED', 'qualquer')), 'INVALID_STAGE_TRANSITION');
  assert.strictEqual(code(() => previousPieceStage('CANCELLED', 'qualquer')), 'INVALID_STAGE_TRANSITION');
});

test('Cancelar peça exige justificativa e não cancela duas vezes', () => {
  assert.strictEqual(code(() => validatePieceCancel('PRODUCED', 'Cliente desistiu')), null);
  assert.strictEqual(code(() => validatePieceCancel('DELIVERED', '')), 'REASON_REQUIRED');
  assert.strictEqual(code(() => validatePieceCancel('CANCELLED', 'de novo')), 'INVALID_STAGE_TRANSITION');
});

test('Progresso da linha: só peças entregues contam; canceladas não contam', () => {
  assert.deepStrictEqual(deriveItemProgress(12, []), { deliveredQuantity: 0, status: 'PENDING' });
  assert.deepStrictEqual(deriveItemProgress(12, ['CANCELLED']), { deliveredQuantity: 0, status: 'PENDING' });
  assert.deepStrictEqual(deriveItemProgress(12, ['PRODUCED', 'APPROVED']), { deliveredQuantity: 0, status: 'IN_PROGRESS' });
  assert.deepStrictEqual(
    deriveItemProgress(2, ['DELIVERED', 'DELIVERED', 'CANCELLED']),
    { deliveredQuantity: 2, status: 'DELIVERED' }
  );
  assert.deepStrictEqual(deriveItemProgress(1, ['DELIVERED', 'DELIVERED']), { deliveredQuantity: 2, status: 'DELIVERED' });
});

test('Métricas (DEC-F6-002): excedente de uma linha é extra e não cobre o déficit de outra', () => {
  const metrics = calculatePlanMetrics([
    // Pacote de 12 conteúdos, 14 postados: 12 contam, 2 são extra
    { targetQuantity: 12, deliveredQuantity: 14, isExtra: false, status: 'DELIVERED' },
    // 4 criativos contratados, 1 entregue: déficit de 3 NÃO é coberto pelo excedente acima
    { targetQuantity: 4, deliveredQuantity: 1, isExtra: false, status: 'IN_PROGRESS' },
    // Linha extra (fora do contrato)
    { targetQuantity: 1, deliveredQuantity: 1, isExtra: true, status: 'DELIVERED' },
  ]);
  assert.strictEqual(metrics.contractedTargetCount, 16);
  assert.strictEqual(metrics.contractedDeliveredCount, 13);
  assert.strictEqual(metrics.contractedPendingCount, 3);
  assert.strictEqual(metrics.contractedProgressPercent, 81);
  assert.strictEqual(metrics.extraDeliveredCount, 3);
  assert.strictEqual(metrics.totalDeliveredCount, 16);
  assert.strictEqual(metrics.isFullyDelivered, false);
});

test('Permissões (DEC-F6-002): membro registra peças mas não fecha o mês nem mexe no plano', () => {
  assert.ok(PERMISSIONS.includes('deliverables.register'));
  for (const defaults of [ADMIN_DEFAULTS, MANAGER_DEFAULTS]) {
    for (const p of ['deliverables.register', 'deliverables.plan', 'deliverables.complete', 'deliverables.reopen', 'deliverables.adjust_target'] as const) {
      assert.ok(defaults.includes(p), p);
    }
  }
  assert.ok(MEMBER_DEFAULTS.includes('deliverables.register'));
  assert.ok(MEMBER_DEFAULTS.includes('deliverables.view'));
  for (const p of ['deliverables.plan', 'deliverables.complete', 'deliverables.reopen', 'deliverables.adjust_target', 'deliverables.cancel'] as const) {
    assert.ok(!MEMBER_DEFAULTS.includes(p), p);
  }
});
