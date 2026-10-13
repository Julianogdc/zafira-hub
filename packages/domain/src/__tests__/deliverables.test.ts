import test from 'node:test';
import assert from 'node:assert';
import {
  assertSameOrganization,
  assertPlanMutable,
  validatePlanReopen,
  validatePlanClosure,
  validateTargetAdjustment,
  calculatePlanMetrics,
  validateDeliverableEvidence,
  validatePlanClientTenant,
  validateUserTenantMembership,
  validateItemPlanTenant,
  validateEventActorTenant,
  DeliverableDomainError
} from '../deliverables/index.js';

/* ==========================================================================
   1. TESTES DE ISOLAMENTO MULTI-TENANT E REJEIÇÃO CROSS-TENANT
   ========================================================================== */

test('Isolamento Multi-Tenant: aprova quando todas as entidades pertencem à mesma organização', () => {
  assert.doesNotThrow(() => {
    assertSameOrganization('org-zafira-1', [
      { name: 'DeliverablePlan', organizationId: 'org-zafira-1' },
      { name: 'DeliverableItem', organizationId: 'org-zafira-1' },
      { name: 'Client', organizationId: 'org-zafira-1' },
      { name: 'User', organizationId: 'org-zafira-1' },
    ]);
  });
});

test('Isolamento Multi-Tenant: rejeita estritamente quando entidade pertence a outra organização', () => {
  assert.throws(
    () => {
      assertSameOrganization('org-zafira-1', [
        { name: 'DeliverablePlan', organizationId: 'org-zafira-1' },
        { name: 'DeliverableItem', organizationId: 'org-outra-empresa' },
      ]);
    },
    (err: any) => {
      assert.strictEqual(err instanceof DeliverableDomainError, true);
      assert.strictEqual(err.code, 'TENANT_MISMATCH');
      assert.match(err.message, /Isolamento multi-tenant violado/);
      return true;
    }
  );
});

test('Isolamento Multi-Tenant (Negativo): rejeita Client de outra organização ao vincular a DeliverablePlan', () => {
  assert.throws(
    () => {
      validatePlanClientTenant(
        { organizationId: 'org-cliente-a', clientId: 'cli-alheio' },
        { organizationId: 'org-cliente-b', id: 'cli-alheio' }
      );
    },
    (err: any) => {
      assert.strictEqual(err.code, 'TENANT_MISMATCH');
      assert.match(err.message, /Client cli-alheio/);
      return true;
    }
  );

  assert.doesNotThrow(() => {
    validatePlanClientTenant(
      { organizationId: 'org-cliente-a', clientId: 'cli-proprio' },
      { organizationId: 'org-cliente-a', id: 'cli-proprio' }
    );
  });
});

test('Isolamento Multi-Tenant (Negativo): rejeita User de outra organização tentando fechar DeliverablePlan', () => {
  assert.throws(
    () => {
      validateUserTenantMembership('org-cliente-a', {
        organizationId: 'org-cliente-b',
        userId: 'user-invasor',
        status: 'ACTIVE',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'TENANT_MISMATCH');
      assert.match(err.message, /Usuário user-invasor pertence à organização org-cliente-b/);
      return true;
    }
  );

  assert.throws(
    () => {
      validateUserTenantMembership('org-cliente-a', {
        organizationId: 'org-cliente-a',
        userId: 'user-suspenso',
        status: 'SUSPENDED',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'INACTIVE_MEMBERSHIP');
      return true;
    }
  );

  assert.doesNotThrow(() => {
    validateUserTenantMembership('org-cliente-a', {
      organizationId: 'org-cliente-a',
      userId: 'user-valido',
      status: 'ACTIVE',
    });
  });
});

test('Isolamento Multi-Tenant (Negativo): rejeita DeliverableItem com tenant ou planId divergente', () => {
  // Tenant divergente
  assert.throws(
    () => {
      validateItemPlanTenant(
        { organizationId: 'org-cliente-a', id: 'plan-1' },
        { organizationId: 'org-cliente-b', planId: 'plan-1', id: 'item-1' }
      );
    },
    (err: any) => {
      assert.strictEqual(err.code, 'TENANT_MISMATCH');
      return true;
    }
  );

  // PlanId divergente
  assert.throws(
    () => {
      validateItemPlanTenant(
        { organizationId: 'org-cliente-a', id: 'plan-1' },
        { organizationId: 'org-cliente-a', planId: 'plan-outro', id: 'item-1' }
      );
    },
    (err: any) => {
      assert.strictEqual(err.code, 'PLAN_MISMATCH');
      return true;
    }
  );

  assert.doesNotThrow(() => {
    validateItemPlanTenant(
      { organizationId: 'org-cliente-a', id: 'plan-1' },
      { organizationId: 'org-cliente-a', planId: 'plan-1', id: 'item-1' }
    );
  });
});

test('Isolamento Multi-Tenant (Negativo): rejeita autor de DeliverableEvent pertencente a outra organização', () => {
  assert.throws(
    () => {
      validateEventActorTenant(
        { organizationId: 'org-alvo' },
        { organizationId: 'org-estrangeira', userId: 'user-x' }
      );
    },
    (err: any) => {
      assert.strictEqual(err.code, 'TENANT_MISMATCH');
      return true;
    }
  );

  assert.doesNotThrow(() => {
    validateEventActorTenant(
      { organizationId: 'org-alvo' },
      { organizationId: 'org-alvo', userId: 'user-valido', status: 'ACTIVE' }
    );
  });
});


/* ==========================================================================
   2. TESTES DE MUTABILIDADE E TRANSIÇÕES DE ESTADO DO PLANO
   ========================================================================== */

test('Mutabilidade do Plano: planos DRAFT e ACTIVE são mutáveis', () => {
  assert.doesNotThrow(() => assertPlanMutable({ status: 'ACTIVE' }));
  assert.doesNotThrow(() => assertPlanMutable({ status: 'DRAFT' }));
});

test('Mutabilidade do Plano: plano CLOSED é estritamente imutável', () => {
  assert.throws(
    () => assertPlanMutable({ status: 'CLOSED' }),
    (err: any) => {
      assert.strictEqual(err instanceof DeliverableDomainError, true);
      assert.strictEqual(err.code, 'PLAN_CLOSED_IMMUTABLE');
      return true;
    }
  );
});

test('Mutabilidade do Plano: plano CANCELLED é estritamente imutável', () => {
  assert.throws(
    () => assertPlanMutable({ status: 'CANCELLED' }),
    (err: any) => {
      assert.strictEqual(err instanceof DeliverableDomainError, true);
      assert.strictEqual(err.code, 'PLAN_CANCELLED_IMMUTABLE');
      return true;
    }
  );
});

/* ==========================================================================
   3. TESTES DE FECHAMENTO E REABERTURA DE PLANO
   ========================================================================== */

test('Fechamento de Plano: exige permissão deliverables.complete', () => {
  assert.throws(
    () => {
      validatePlanClosure({
        currentStatus: 'ACTIVE',
        userPermissions: ['deliverables.view'],
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'PERMISSION_DENIED');
      return true;
    }
  );

  assert.doesNotThrow(() => {
    validatePlanClosure({
      currentStatus: 'ACTIVE',
      userPermissions: ['deliverables.complete', 'deliverables.view'],
    });
  });
});

test('Reabertura de Plano: exige status CLOSED, permissão deliverables.reopen e justificativa', () => {
  // Tentativa em plano ACTIVE falha
  assert.throws(
    () => {
      validatePlanReopen({
        currentStatus: 'ACTIVE',
        userPermissions: ['deliverables.reopen'],
        reason: 'Reajustando escopo com o cliente',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'INVALID_STATUS_TRANSITION');
      return true;
    }
  );

  // Tentativa sem permissão deliverables.reopen
  assert.throws(
    () => {
      validatePlanReopen({
        currentStatus: 'CLOSED',
        userPermissions: ['deliverables.view', 'deliverables.complete'],
        reason: 'Reajustando escopo',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'PERMISSION_DENIED');
      return true;
    }
  );

  // Tentativa sem justificativa
  assert.throws(
    () => {
      validatePlanReopen({
        currentStatus: 'CLOSED',
        userPermissions: ['deliverables.reopen'],
        reason: '',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'REASON_REQUIRED');
      return true;
    }
  );

  // Sucesso com todos os requisitos atendidos
  assert.doesNotThrow(() => {
    validatePlanReopen({
      currentStatus: 'CLOSED',
      userPermissions: ['deliverables.reopen'],
      reason: 'Ajuste de aditivo contratual acordado em reunião formal',
    });
  });
});

/* ==========================================================================
   4. TESTES DE AJUSTE DE METAS CONTRATUAIS
   ========================================================================== */

test('Ajuste de Meta: exige permissão deliverables.adjust_target e justificativa auditável', () => {
  // Bloqueio se plano estiver CLOSED
  assert.throws(
    () => {
      validateTargetAdjustment({
        currentTargetQuantity: 10,
        newTargetQuantity: 12,
        userPermissions: ['deliverables.adjust_target'],
        reason: 'Cliente contratou pacote adicional',
        planStatus: 'CLOSED',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'PLAN_CLOSED_IMMUTABLE');
      return true;
    }
  );

  // Bloqueio se usuário não tem permissão
  assert.throws(
    () => {
      validateTargetAdjustment({
        currentTargetQuantity: 10,
        newTargetQuantity: 12,
        userPermissions: ['deliverables.view'],
        reason: 'Cliente contratou pacote adicional',
        planStatus: 'ACTIVE',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'PERMISSION_DENIED');
      return true;
    }
  );

  // Bloqueio se justificativa for menor que 3 caracteres
  assert.throws(
    () => {
      validateTargetAdjustment({
        currentTargetQuantity: 10,
        newTargetQuantity: 12,
        userPermissions: ['deliverables.adjust_target'],
        reason: 'ok',
        planStatus: 'ACTIVE',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'REASON_REQUIRED');
      return true;
    }
  );

  // Bloqueio se meta for inválida (< 1)
  assert.throws(
    () => {
      validateTargetAdjustment({
        currentTargetQuantity: 10,
        newTargetQuantity: 0,
        userPermissions: ['deliverables.adjust_target'],
        reason: 'Zerando meta',
        planStatus: 'ACTIVE',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'INVALID_TARGET_QUANTITY');
      return true;
    }
  );

  // Sucesso com parâmetros válidos
  assert.doesNotThrow(() => {
    validateTargetAdjustment({
      currentTargetQuantity: 10,
      newTargetQuantity: 15,
      userPermissions: ['deliverables.adjust_target'],
      reason: 'Aditivo aprovado pela diretoria para campanha de Black Friday',
      planStatus: 'ACTIVE',
    });
  });
});

/* ==========================================================================
   5. TESTES DE SEGREGAÇÃO DE MÉTRICAS (CONTRATADO VS EXTRA)
   ========================================================================== */

test('Cálculo de Métricas: itens extras NUNCA mascaram déficit de metas contratadas', () => {
  const items = [
    // Meta contratada: 10 posts, entregues 5
    { targetQuantity: 10, deliveredQuantity: 5, isExtra: false, status: 'IN_PROGRESS' as const },
    // Meta contratada: 4 reels, entregues 4
    { targetQuantity: 4, deliveredQuantity: 4, isExtra: false, status: 'DELIVERED' as const },
    // Item extra: 8 criativos emergenciais entregues além do contrato
    { targetQuantity: 1, deliveredQuantity: 8, isExtra: true, status: 'DELIVERED' as const },
    // Item cancelado: não deve ser computado
    { targetQuantity: 5, deliveredQuantity: 2, isExtra: false, status: 'CANCELLED' as const },
  ];

  const metrics = calculatePlanMetrics(items);

  // Total contratado deve ser 10 + 4 = 14
  assert.strictEqual(metrics.contractedTargetCount, 14);
  // Total contratado entregue deve ser 5 + 4 = 9
  assert.strictEqual(metrics.contractedDeliveredCount, 9);
  // Total contratado pendente = 14 - 9 = 5
  assert.strictEqual(metrics.contractedPendingCount, 5);
  // Progresso contratado deve ser exatamente 9 / 14 = 64% (não inflado pelos 8 extras)
  assert.strictEqual(metrics.contractedProgressPercent, 64);
  // Total extra entregue segregado
  assert.strictEqual(metrics.extraDeliveredCount, 8);
  // Total bruto de entregas realizadas
  assert.strictEqual(metrics.totalDeliveredCount, 17); // 9 contratados + 8 extras
  // Não está totalmente entregue porque a meta contratada é de 14 e foram entregues 9
  assert.strictEqual(metrics.isFullyDelivered, false);
});

test('Cálculo de Métricas: plano 100% entregue no escopo contratado', () => {
  const items = [
    { targetQuantity: 8, deliveredQuantity: 8, isExtra: false, status: 'DELIVERED' as const },
    { targetQuantity: 4, deliveredQuantity: 4, isExtra: false, status: 'DELIVERED' as const },
  ];

  const metrics = calculatePlanMetrics(items);
  assert.strictEqual(metrics.contractedTargetCount, 12);
  assert.strictEqual(metrics.contractedDeliveredCount, 12);
  assert.strictEqual(metrics.contractedPendingCount, 0);
  assert.strictEqual(metrics.contractedProgressPercent, 100);
  assert.strictEqual(metrics.isFullyDelivered, true);
});

/* ==========================================================================
   6. TESTES DE VÍNCULOS DE EVIDÊNCIA (ASANA E EXTERNOS)
   ========================================================================== */

test('Vínculo de Evidência: exige identificador externo para tarefas do Asana', () => {
  assert.throws(
    () => {
      validateDeliverableEvidence({
        planStatus: 'ACTIVE',
        linkType: 'ASANA_TASK',
        title: 'Post Feed #12 - Carrossel',
        externalId: '',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'ASANA_GID_REQUIRED');
      return true;
    }
  );

  assert.doesNotThrow(() => {
    validateDeliverableEvidence({
      planStatus: 'ACTIVE',
      linkType: 'ASANA_TASK',
      title: 'Post Feed #12 - Carrossel',
      externalId: '120987654321',
    });
  });
});

test('Vínculo de Evidência: rejeita vínculo se plano estiver CLOSED', () => {
  assert.throws(
    () => {
      validateDeliverableEvidence({
        planStatus: 'CLOSED',
        linkType: 'ASANA_TASK',
        title: 'Post Feed #12',
        externalId: '120987654321',
      });
    },
    (err: any) => {
      assert.strictEqual(err.code, 'PLAN_CLOSED_IMMUTABLE');
      return true;
    }
  );
});
