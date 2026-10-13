import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliverableItem, DeliverableLink, DeliverableEvent } from '@zafira/contracts';
import {
  calculateDeliverablesMetrics,
  formatDeliverablePeriod,
  getPlanStatusMeta,
  getItemStatusMeta,
  formatDeliverableServiceType,
  getSafeEvidenceUrl,
  formatDeliverableEventDescription,
} from '../deliverables-view';

function makeItem(overrides: Partial<DeliverableItem>): DeliverableItem {
  return {
    id: 'item-1',
    planId: 'plan-1',
    organizationId: 'org-1',
    title: 'Post no Feed Institucional',
    serviceType: 'POST_FEED',
    status: 'DELIVERED',
    isExtra: false,
    targetQuantity: 4,
    deliveredQuantity: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('calculateDeliverablesMetrics - calcula progresso de metas contratadas e separa itens extras', () => {
  const items: DeliverableItem[] = [
    makeItem({ id: 'item-1', isExtra: false, targetQuantity: 6, deliveredQuantity: 6, status: 'DELIVERED' }),
    makeItem({ id: 'item-2', isExtra: false, targetQuantity: 4, deliveredQuantity: 2, status: 'IN_PROGRESS' }),
    // Item extra: entregou 5 posts extras
    makeItem({ id: 'item-3', isExtra: true, targetQuantity: 0, deliveredQuantity: 5, status: 'DELIVERED' }),
  ];

  const metrics = calculateDeliverablesMetrics(items);

  assert.equal(metrics.contractedTarget, 10);
  assert.equal(metrics.contractedDelivered, 8); // 6 + 2 das metas normais
  assert.equal(metrics.contractedPending, 2); // 10 - 8 = 2 pendente
  assert.equal(metrics.contractedProgressPercent, 80); // 8 / 10 = 80%

  // Segregação estrita: os 5 extras são contabilizados separadamente
  assert.equal(metrics.extraDelivered, 5);
  assert.equal(metrics.totalDelivered, 13); // 8 contratados + 5 extras
  assert.equal(metrics.isFullyDelivered, false);
});

test('calculateDeliverablesMetrics - itens extras NUNCA compensam déficit contratual', () => {
  const items: DeliverableItem[] = [
    // Contratado: entregou apenas 2 de 10
    makeItem({ id: 'item-1', isExtra: false, targetQuantity: 10, deliveredQuantity: 2, status: 'IN_PROGRESS' }),
    // Extras: cliente recebeu 20 itens extras
    makeItem({ id: 'item-extra', isExtra: true, targetQuantity: 0, deliveredQuantity: 20, status: 'DELIVERED' }),
  ];

  const metrics = calculateDeliverablesMetrics(items);

  // Mesmo tendo 20 extras, o progresso da meta contratada permanece em 20% e há 8 pendentes
  assert.equal(metrics.contractedTarget, 10);
  assert.equal(metrics.contractedDelivered, 2);
  assert.equal(metrics.contractedPending, 8);
  assert.equal(metrics.contractedProgressPercent, 20);
  assert.equal(metrics.extraDelivered, 20);
  assert.equal(metrics.totalDelivered, 22);
  assert.equal(metrics.isFullyDelivered, false);
});

test('calculateDeliverablesMetrics - ignora itens cancelados no cálculo', () => {
  const items: DeliverableItem[] = [
    makeItem({ id: 'item-1', isExtra: false, targetQuantity: 5, deliveredQuantity: 5, status: 'DELIVERED' }),
    makeItem({ id: 'item-cancelled', isExtra: false, targetQuantity: 5, deliveredQuantity: 0, status: 'CANCELLED' }),
  ];

  const metrics = calculateDeliverablesMetrics(items);
  assert.equal(metrics.contractedTarget, 5);
  assert.equal(metrics.contractedDelivered, 5);
  assert.equal(metrics.contractedPending, 0);
  assert.equal(metrics.contractedProgressPercent, 100);
  assert.equal(metrics.isFullyDelivered, true);
});

test('calculateDeliverablesMetrics - lida com plano vazio', () => {
  const metrics = calculateDeliverablesMetrics([]);

  assert.equal(metrics.contractedTarget, 0);
  assert.equal(metrics.contractedDelivered, 0);
  assert.equal(metrics.contractedPending, 0);
  assert.equal(metrics.contractedProgressPercent, 0);
  assert.equal(metrics.extraDelivered, 0);
  assert.equal(metrics.totalDelivered, 0);
  assert.equal(metrics.isFullyDelivered, false);
});

test('formatDeliverablePeriod - formata ano e mês em formato canônico pt-BR', () => {
  assert.equal(formatDeliverablePeriod('2026-10'), 'Outubro de 2026');
  assert.equal(formatDeliverablePeriod('2026-01'), 'Janeiro de 2026');
  assert.equal(formatDeliverablePeriod('2026-12'), 'Dezembro de 2026');
  assert.equal(formatDeliverablePeriod('invalido'), 'invalido');
  assert.equal(formatDeliverablePeriod(''), 'Período não informado');
});

test('getPlanStatusMeta - retorna rótulo e estilo corretos para status do plano', () => {
  const active = getPlanStatusMeta('ACTIVE');
  assert.equal(active.label, 'Em Andamento');
  assert.equal(active.isClosed, false);

  const closed = getPlanStatusMeta('CLOSED');
  assert.equal(closed.label, 'Encerrado (Fechado)');
  assert.equal(closed.isClosed, true);

  const draft = getPlanStatusMeta('DRAFT');
  assert.equal(draft.label, 'Rascunho');
  assert.equal(draft.isClosed, false);

  const cancelled = getPlanStatusMeta('CANCELLED');
  assert.equal(cancelled.label, 'Cancelado');
  assert.equal(cancelled.isClosed, true);
});

test('getItemStatusMeta - retorna rótulo correto para status dos itens', () => {
  assert.equal(getItemStatusMeta('DELIVERED').label, 'Entregue');
  assert.equal(getItemStatusMeta('IN_PROGRESS').label, 'Em Produção');
  assert.equal(getItemStatusMeta('PENDING').label, 'Pendente');
  assert.equal(getItemStatusMeta('CANCELLED').label, 'Cancelado');
});

test('formatDeliverableServiceType - traduz códigos de serviço para português', () => {
  assert.equal(formatDeliverableServiceType('POST_FEED'), 'Post no Feed');
  assert.equal(formatDeliverableServiceType('REELS'), 'Reels / Vídeo Curto');
  assert.equal(formatDeliverableServiceType('STORIES'), 'Stories');
  assert.equal(formatDeliverableServiceType('CAROUSEL'), 'Carrossel');
  assert.equal(formatDeliverableServiceType('ARTIGO_BLOG'), 'Artigo de Blog');
  assert.equal(formatDeliverableServiceType('LANDING_PAGE'), 'Landing Page');
  assert.equal(formatDeliverableServiceType('OUTRO_DESCONHECIDO'), 'OUTRO_DESCONHECIDO');
});

test('getSafeEvidenceUrl - sanitiza e aceita estritamente URLs seguras do Asana', () => {
  const linkWithGid: DeliverableLink = {
    id: 'link-1',
    itemId: 'item-1',
    organizationId: 'org-1',
    linkType: 'ASANA_TASK',
    externalId: '120987654321',
    url: null,
    title: 'Tarefa no Asana',
    createdAt: new Date().toISOString(),
  };
  assert.equal(getSafeEvidenceUrl(linkWithGid), 'https://app.asana.com/0/0/120987654321');

  const linkWithValidUrl: DeliverableLink = {
    ...linkWithGid,
    url: 'https://app.asana.com/0/123/456',
  };
  assert.equal(getSafeEvidenceUrl(linkWithValidUrl), 'https://app.asana.com/0/123/456');

  // URL externa que tenta se passar por Asana ou esquema malicioso
  const unsafeLink: DeliverableLink = {
    ...linkWithGid,
    externalId: null,
    url: 'https://malicious-phishing.com/task',
  };
  assert.equal(getSafeEvidenceUrl(unsafeLink), null);

  const jsSchemeLink: DeliverableLink = {
    ...linkWithGid,
    externalId: null,
    url: 'javascript:alert(1)',
  };
  assert.equal(getSafeEvidenceUrl(jsSchemeLink), null);
});

test('formatDeliverableEventDescription - formata eventos de auditoria com justificativas', () => {
  const goalAdjustedEvent: DeliverableEvent = {
    id: 'ev-1',
    planId: 'plan-1',
    organizationId: 'org-1',
    eventType: 'TARGET_ADJUSTED',
    actorUserId: 'usr-1',
    reason: 'Aditivo contratual aprovado pelo cliente',
    createdAt: '2026-10-05T10:00:00.000Z',
  };
  const goalAdjustedDesc = formatDeliverableEventDescription(goalAdjustedEvent);
  assert.equal(goalAdjustedDesc.title, 'Meta contratada ajustada');
  assert.equal(goalAdjustedDesc.details, 'Justificativa formal: "Aditivo contratual aprovado pelo cliente"');

  const closedEvent: DeliverableEvent = {
    id: 'ev-2',
    planId: 'plan-1',
    organizationId: 'org-1',
    eventType: 'PLAN_CLOSED',
    actorUserId: 'usr-1',
    reason: 'Fechamento regular do ciclo mensal',
    createdAt: '2026-10-31T23:59:59.000Z',
  };
  const closedDesc = formatDeliverableEventDescription(closedEvent);
  assert.equal(closedDesc.title, 'Plano de entregas encerrado formalmente');
  assert.equal(closedDesc.details, 'Motivo: Fechamento regular do ciclo mensal');
});

/* F6-IMP.7B — DEC-F6-002 */
import {
  formatPieceStage,
  nextStageActionLabel,
  formatContentFormat,
  SERVICE_TYPE_OPTIONS,
} from '../deliverables-view';

test('Métricas (DEC-F6-002): excedente de uma linha vira extra e não cobre déficit de outra', () => {
  const metrics = calculateDeliverablesMetrics([
    makeItem({ id: 'a', targetQuantity: 12, deliveredQuantity: 14, isExtra: false, status: 'DELIVERED' }),
    makeItem({ id: 'b', targetQuantity: 4, deliveredQuantity: 1, isExtra: false, status: 'IN_PROGRESS' }),
  ]);
  assert.equal(metrics.contractedTarget, 16);
  assert.equal(metrics.contractedDelivered, 13);
  assert.equal(metrics.contractedPending, 3);
  assert.equal(metrics.extraDelivered, 2);
  assert.equal(metrics.isFullyDelivered, false);
});

test('Etapas da peça: rótulo de conteúdo diz "Postada"; demais serviços "Entregue"', () => {
  assert.equal(formatPieceStage('DELIVERED', 'CONTEUDO_SOCIAL').label, 'Postada');
  assert.equal(formatPieceStage('DELIVERED', 'RELATORIO_MENSAL').label, 'Entregue');
  assert.equal(formatPieceStage('PRODUCED').label, 'Produzida');
  assert.equal(formatPieceStage('APPROVED').label, 'Aprovada');
  assert.equal(formatPieceStage('CANCELLED').label, 'Cancelada');
  assert.equal(nextStageActionLabel('PRODUCED', 'CONTEUDO_SOCIAL'), 'Marcar como aprovada');
  assert.equal(nextStageActionLabel('APPROVED', 'CONTEUDO_SOCIAL'), 'Marcar como postada');
  assert.equal(nextStageActionLabel('APPROVED', 'CRIATIVO_ADS'), 'Marcar como entregue');
  assert.equal(nextStageActionLabel('DELIVERED', 'CONTEUDO_SOCIAL'), null);
  assert.equal(nextStageActionLabel('CANCELLED', 'CONTEUDO_SOCIAL'), null);
});

test('Taxonomia na tela: os 6 serviços da DEC-F6-002 e rótulos de formato', () => {
  assert.deepEqual(
    SERVICE_TYPE_OPTIONS.map((o) => o.value),
    ['CONTEUDO_SOCIAL', 'CRIATIVO_ADS', 'RELATORIO_MENSAL', 'CAPTACAO', 'GESTAO_TRAFEGO', 'OUTRO']
  );
  assert.equal(formatContentFormat('CARROSSEL'), 'Carrossel');
  assert.equal(formatContentFormat(null), null);
  assert.equal(formatDeliverableServiceType('CONTEUDO_SOCIAL'), 'Conteúdos para redes (pacote)');
});
