import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { FinancialService } from './financial.service.js';
import { FinancialCategoryService } from './financial-category.service.js';
import { auditService } from '../audit/audit.service.js';
import { FinancialReconciliationService } from './financial-reconciliation.service.js';
import { AsaasService } from '../integrations/asaas/asaas.service.js';
import { InterService } from '../integrations/inter/inter.service.js';
import { FinancialTransactionDirection, FinancialTransactionKind } from '@prisma/client';

export async function financialRoutes(app: FastifyInstance) {
  const financialService = new FinancialService(prisma);
  const categoryService = new FinancialCategoryService(prisma);
  const reconciliationService = new FinancialReconciliationService(prisma);
  const asaasService = new AsaasService(prisma);
  const interService = new InterService(prisma);

  // Todas as rotas são protegidas por autenticação
  app.addHook('preHandler', authenticate);

  /**
   * Resolução multi-tenant segura de organização e validação de RBAC por organização.
   * Não possui slug, ID ou nome de organização fixado no código.
   */
  const resolveFinancialContext = async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.authContext;
    if (!auth) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    // 1. Chave de API de integração (server-to-server)
    if (auth.type === 'api_key') {
      const headerOrg = req.headers['x-organization-id'] as string | undefined;
      if (!headerOrg || typeof headerOrg !== 'string' || headerOrg.trim().length === 0) {
        return reply.status(400).send({
          status: 'error',
          error: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Cabeçalho x-organization-id é obrigatório para chave de integração',
        });
      }

      const orgId = headerOrg.trim();
      const allowed = auth.allowedOrganizationIds;

      // Se a chave não possui organizações autorizadas vinculadas: acesso financeiro proibido
      if (!allowed || allowed.length === 0) {
        return reply.status(403).send({
          status: 'error',
          error: 'forbidden',
          code: 'API_KEY_ORGANIZATION_UNAUTHORIZED',
          message: 'Chave de integração não possui organizações vinculadas no seu escopo',
        });
      }

      // Se a organização solicitada não está no escopo da chave: 403 Forbidden
      if (!allowed.includes(orgId)) {
        return reply.status(403).send({
          status: 'error',
          error: 'forbidden',
          code: 'API_KEY_ORGANIZATION_UNAUTHORIZED',
          message: 'Chave de integração não autorizada para a organização informada',
        });
      }

      (req as any).resolvedOrganizationId = orgId;
      return;
    }

    // 2. Usuário autenticado
    if (auth.type === 'user') {
      const memberships = auth.memberships || [];
      if (memberships.length === 0) {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      const explicitOrgId =
        (auth as any).activeOrganizationId ||
        (req.headers['x-organization-id'] as string | undefined) ||
        (req as any).session?.organizationId ||
        (req as any).user?.organizationId;

      let targetMembership = explicitOrgId
        ? memberships.find((m) => m.organizationId === explicitOrgId || m.organizationSlug === explicitOrgId)
        : undefined;

      // Se foi informada organização explícita e ela não pertence às memberships do usuário: 403 Forbidden
      if (explicitOrgId && !targetMembership) {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Usuário não possui acesso à organização informada',
        });
      }

      // Se nenhuma organização explícita foi fornecida:
      if (!targetMembership) {
        if (memberships.length === 1) {
          // Única membership: utiliza essa organização
          targetMembership = memberships[0];
        } else {
          // Múltiplas memberships sem contexto ativo: erro claro 400
          return reply.status(400).send({
            error: 'ORGANIZATION_CONTEXT_REQUIRED',
            message: 'Múltiplas organizações disponíveis. Contexto de organização ativo é obrigatório.',
          });
        }
      }

      // Validação de tenant: pertencimento à organização já confirmado acima.
      // Controle de permissão granular é responsabilidade de requirePermission em cada rota.

      (req as any).resolvedOrganizationId = targetMembership.organizationId;
    }
  };

  app.addHook('preHandler', resolveFinancialContext);

  // Helper para obter a organizationId já validada e resolvida
  const getOrganizationId = (req: FastifyRequest): string => {
    const orgId = (req as any).resolvedOrganizationId;
    if (!orgId) {
      const err: any = new Error('ORGANIZATION_CONTEXT_REQUIRED');
      err.statusCode = 400;
      throw err;
    }
    return orgId;
  };

  /**
   * GET /financial/accounts/overview
   * Visão consolidada de saldos e totais operacionais
   */
  const handleGetOverview = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const query = req.query as { startDate?: string; endDate?: string };
    const result = await financialService.getAccountsOverview(organizationId, {
      startDate: query.startDate,
      endDate: query.endDate,
    });
    return reply.send(result);
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/financial/accounts/overview', { preHandler: [requirePermission('financial.view_summary')] }, handleGetOverview);
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/api/financial/accounts/overview', { preHandler: [requirePermission('financial.view_summary')] }, handleGetOverview);

  /**
   * GET /financial/transactions
   * Extrato unificado de transações com filtros e paginação
   */
  const handleGetTransactions = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const query = req.query as {
      accountId?: string;
      categoryId?: string;
      direction?: FinancialTransactionDirection;
      kind?: FinancialTransactionKind;
      pendingCategoryOnly?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      page?: string;
      limit?: string;
    };

    const result = await financialService.getTransactions(organizationId, {
      accountId: query.accountId,
      categoryId: query.categoryId,
      direction: query.direction,
      kind: query.kind,
      pendingCategoryOnly: query.pendingCategoryOnly === 'true',
      startDate: query.startDate,
      endDate: query.endDate,
      search: query.search,
      page: query.page ? parseInt(query.page, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });
    return reply.send(result);
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/financial/transactions', { preHandler: [requirePermission('financial.view_details')] }, handleGetTransactions);
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/api/financial/transactions', { preHandler: [requirePermission('financial.view_details')] }, handleGetTransactions);

  /**
   * GET /financial/categories
   * Lista categorias da organização com contagem de transações (suporta ?includeArchived=true)
   */
  const handleGetCategories = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const query = req.query as { includeArchived?: string };
    const categories = await categoryService.listCategories(organizationId, {
      includeArchived: query.includeArchived === 'true',
    });
    return reply.send({ categories });
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/financial/categories', { preHandler: [requirePermission('financial.view_details')] }, handleGetCategories);
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/api/financial/categories', { preHandler: [requirePermission('financial.view_details')] }, handleGetCategories);

  /**
   * POST /financial/categories
   * Criação de nova categoria (ADMIN / MANAGER)
   */
  const handleCreateCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const body = req.body as { name: string; type?: any; color?: string };
    if (!body || !body.name) {
      return reply.status(400).send({ error: 'Nome da categoria é obrigatório' });
    }

    try {
      const category = await categoryService.createCategory(organizationId, {
        name: body.name,
        type: body.type || 'EXPENSE',
        color: body.color,
      });

      // Gravação de auditoria operacional (Etapa J)
      await auditService.record({
        organizationId,
        actorUserId: req.authContext?.type === 'user' ? req.authContext.userId : null,
        action: 'financial_category.created',
        entityType: 'FinancialCategory',
        entityId: category.id,
        after: category,
      }).catch((auditErr) => {
        req.log?.warn?.({ err: auditErr }, 'Falha ao registrar AuditLog para financial_category.created');
      });

      return reply.status(201).send(category);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/financial/categories', { preHandler: [requirePermission('financial.edit')] }, handleCreateCategory);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/categories', { preHandler: [requirePermission('financial.edit')] }, handleCreateCategory);

  /**
   * PATCH /financial/categories/:id
   * Atualização de nome, tipo e cor da categoria (ADMIN / MANAGER)
   */
  const handleUpdateCategoryAttrs = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; type?: any; color?: string };

    try {
      const updated = await categoryService.updateCategory(organizationId, id, body);

      // Gravação de auditoria operacional (Etapa J)
      await auditService.record({
        organizationId,
        actorUserId: req.authContext?.type === 'user' ? req.authContext.userId : null,
        action: 'financial_category.updated',
        entityType: 'FinancialCategory',
        entityId: updated.id,
        after: updated,
      }).catch((auditErr) => {
        req.log?.warn?.({ err: auditErr }, 'Falha ao registrar AuditLog para financial_category.updated');
      });

      return reply.send(updated);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/financial/categories/:id', { preHandler: [requirePermission('financial.edit')] }, handleUpdateCategoryAttrs);
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/api/financial/categories/:id', { preHandler: [requirePermission('financial.edit')] }, handleUpdateCategoryAttrs);

  /**
   * POST /financial/categories/:id/archive
   * Arquiva categoria (ADMIN / MANAGER)
   */
  const handleArchiveCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };

    try {
      const archived = await categoryService.archiveCategory(organizationId, id);

      // Gravação de auditoria operacional (Etapa J)
      await auditService.record({
        organizationId,
        actorUserId: req.authContext?.type === 'user' ? req.authContext.userId : null,
        action: 'financial_category.archived',
        entityType: 'FinancialCategory',
        entityId: id,
        after: archived,
      }).catch((auditErr) => {
        req.log?.warn?.({ err: auditErr }, 'Falha ao registrar AuditLog para financial_category.archived');
      });

      return reply.send({ success: true, category: archived });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/financial/categories/:id/archive', { preHandler: [requirePermission('financial.edit')] }, handleArchiveCategory);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/categories/:id/archive', { preHandler: [requirePermission('financial.edit')] }, handleArchiveCategory);

  /**
   * POST /financial/categories/:id/reactivate
   * Reativa categoria arquivada (ADMIN / MANAGER)
   */
  const handleReactivateCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };

    try {
      const reactivated = await categoryService.reactivateCategory(organizationId, id);
      return reply.send({ success: true, category: reactivated });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/financial/categories/:id/reactivate', { preHandler: [requirePermission('financial.edit')] }, handleReactivateCategory);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/categories/:id/reactivate', { preHandler: [requirePermission('financial.edit')] }, handleReactivateCategory);

  /**
   * DELETE /financial/categories/:id
   * Exclusão segura: permitida SOMENTE se 0 transações vinculadas.
   * Se houver movimentações, retorna 409 Conflict com código CATEGORY_HAS_TRANSACTIONS.
   */
  const handleDeleteCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };

    try {
      await categoryService.deleteCategory(organizationId, id);
      return reply.send({ success: true, message: 'Categoria excluída com sucesso.' });
    } catch (err: any) {
      if (err.code === 'CATEGORY_HAS_TRANSACTIONS') {
        return reply.status(409).send({
          error: 'CATEGORY_HAS_TRANSACTIONS',
          message: err.message,
          transactionCount: err.transactionCount,
        });
      }
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.delete('/financial/categories/:id', { preHandler: [requirePermission('financial.edit')] }, handleDeleteCategory);
  // CLASSE: HUMAN_AUTHENTICATED
  app.delete('/api/financial/categories/:id', { preHandler: [requirePermission('financial.edit')] }, handleDeleteCategory);

  /**
   * POST /financial/categories/:id/migrate
   * Migração de movimentações de uma categoria para outra antes de exclusão/arquivamento
   */
  const handleMigrateCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id: sourceCategoryId } = req.params as { id: string };
    const body = req.body as { targetCategoryId: string };

    if (!body?.targetCategoryId) {
      return reply.status(400).send({ error: 'targetCategoryId é obrigatório' });
    }

    try {
      const res = await categoryService.migrateCategoryTransactions(
        organizationId,
        sourceCategoryId,
        body.targetCategoryId
      );
      return reply.send({ success: true, ...res });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/financial/categories/:id/migrate', { preHandler: [requirePermission('financial.edit')] }, handleMigrateCategory);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/categories/:id/migrate', { preHandler: [requirePermission('financial.edit')] }, handleMigrateCategory);

  /**
   * GET /financial/category-rules
   * Lista regras de categorização automática
   */
  const handleGetRules = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const rules = await categoryService.listRules(organizationId);
    return reply.send({ rules });
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/financial/category-rules', { preHandler: [requirePermission('financial.view_details')] }, handleGetRules);
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/api/financial/category-rules', { preHandler: [requirePermission('financial.view_details')] }, handleGetRules);

  /**
   * POST /financial/category-rules
   * Criação manual de regra de categorização (ADMIN / MANAGER)
   */
  const handleCreateCategoryRule = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const body = req.body as {
      categoryId: string;
      clientId?: string | null;
      matchField: any;
      matchType: any;
      matchValue?: string;
      pattern?: string;
      priority?: number;
      isActive?: boolean;
    };

    const matchVal = body.matchValue || body.pattern;
    if (!body.categoryId || !body.matchField || !body.matchType || !matchVal) {
      return reply.status(400).send({ error: 'Campos obrigatórios ausentes para criação de regra' });
    }

    try {
      const rule = await categoryService.createCategoryRule(organizationId, {
        categoryId: body.categoryId,
        clientId: body.clientId,
        matchField: body.matchField,
        matchType: body.matchType,
        matchValue: matchVal,
        priority: body.priority,
        isActive: body.isActive,
      });
      return reply.status(201).send(rule);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/financial/category-rules', { preHandler: [requirePermission('financial.edit')] }, handleCreateCategoryRule);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/category-rules', { preHandler: [requirePermission('financial.edit')] }, handleCreateCategoryRule);

  /**
   * PATCH /financial/category-rules/:id
   * Atualização de regra (ADMIN / MANAGER)
   */
  const handleUpdateCategoryRule = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };
    const body = req.body as any;

    try {
      const updated = await categoryService.updateCategoryRule(organizationId, id, body);
      return reply.send(updated);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/financial/category-rules/:id', { preHandler: [requirePermission('financial.edit')] }, handleUpdateCategoryRule);
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/api/financial/category-rules/:id', { preHandler: [requirePermission('financial.edit')] }, handleUpdateCategoryRule);

  /**
   * DELETE /financial/category-rules/:id
   * Exclusão de regra (ADMIN / MANAGER)
   */
  const handleDeleteCategoryRule = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };

    try {
      await categoryService.deleteCategoryRule(organizationId, id);
      return reply.send({ success: true, message: 'Regra excluída com sucesso.' });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.delete('/financial/category-rules/:id', { preHandler: [requirePermission('financial.edit')] }, handleDeleteCategoryRule);
  // CLASSE: HUMAN_AUTHENTICATED
  app.delete('/api/financial/category-rules/:id', { preHandler: [requirePermission('financial.edit')] }, handleDeleteCategoryRule);

  /**
   * POST /financial/category-rules/preview
   * Prévia de impacto de uma regra sobre movimentações sem mutação silenciosa
   */
  const handlePreviewCategoryRule = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const body = req.body as {
      matchField: any;
      matchType: any;
      matchValue?: string;
      pattern?: string;
    };

    const matchValue = body.matchValue || body.pattern;
    if (!body.matchField || !body.matchType || !matchValue) {
      return reply.status(400).send({ error: 'Critérios incompletos para prévia da regra' });
    }

    const preview = await categoryService.previewRuleMatches(organizationId, {
      matchField: body.matchField,
      matchType: body.matchType,
      matchValue,
    });
    return reply.send(preview);
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/financial/category-rules/preview', { preHandler: [requirePermission('financial.view_details')] }, handlePreviewCategoryRule);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/category-rules/preview', { preHandler: [requirePermission('financial.view_details')] }, handlePreviewCategoryRule);

  /**
   * POST /financial/category-rules/:id/apply
   * Aplicação retroativa explícita de uma regra (ADMIN / MANAGER)
   */
  const handleApplyCategoryRule = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };

    try {
      const result = await categoryService.applyRuleRetroactively(organizationId, id);
      return reply.send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/financial/category-rules/:id/apply', { preHandler: [requirePermission('financial.edit')] }, handleApplyCategoryRule);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/category-rules/:id/apply', { preHandler: [requirePermission('financial.edit')] }, handleApplyCategoryRule);

  /**
   * PATCH /financial/transactions/:id/category
   * Atualiza manualmente a categoria e/ou cliente de uma transação (MEMBER, MANAGER, ADMIN)
   */
  const handleUpdateCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };
    const body = req.body as {
      categoryId?: string;
      clientId?: string | null;
      createRule?: boolean;
      rulePattern?: string;
      ruleField?: 'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT';
      ruleMatchType?: 'CONTAINS' | 'EXACT';
      rulePriority?: number;
    };

    if (!body || (!body.categoryId && body.clientId === undefined)) {
      return reply.status(400).send({ error: 'categoryId ou clientId é obrigatório' });
    }

    try {
      const updated = await financialService.updateTransactionCategory(
        organizationId,
        id,
        {
          categoryId: body.categoryId,
          clientId: body.clientId,
          createRule: body.createRule,
          rulePattern: body.rulePattern,
          ruleMatchField: body.ruleField,
          ruleMatchType: body.ruleMatchType,
          rulePriority: body.rulePriority,
        }
      );
      return reply.send(updated);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/financial/transactions/:id/category', { preHandler: [requirePermission('financial.edit')] }, handleUpdateCategory);
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/api/financial/transactions/:id/category', { preHandler: [requirePermission('financial.edit')] }, handleUpdateCategory);

  /**
   * PATCH /financial/transfers/:id/confirm
   * Confirmação manual de transferência que estava em revisão
   */
  const handleConfirmTransfer = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };
    const confirmed = await reconciliationService.confirmTransfer(organizationId, id);
    return reply.send({ success: true, transfer: confirmed });
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/financial/transfers/:id/confirm', { preHandler: [requirePermission('financial.reconcile')] }, handleConfirmTransfer);
  // CLASSE: HUMAN_AUTHENTICATED
  app.patch('/api/financial/transfers/:id/confirm', { preHandler: [requirePermission('financial.reconcile')] }, handleConfirmTransfer);

  /**
   * POST /integrations/asaas/sync-ledger
   * Desativado na Etapa 5B: Asaas é exclusivo para contas a receber; o caixa é alimentado exclusivamente pelo Banco Inter PJ.
   */
  const handleSyncAsaasLedger = async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      success: false,
      code: 'ASAAS_LEDGER_DISABLED',
      message: 'O Asaas é utilizado apenas para contas a receber. O caixa é alimentado exclusivamente pelo Banco Inter PJ.',
    });
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/integrations/asaas/sync-ledger', { preHandler: [requirePermission('integrations.sync')] }, handleSyncAsaasLedger);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/integrations/asaas/sync-ledger', { preHandler: [requirePermission('integrations.sync')] }, handleSyncAsaasLedger);

  /**
   * POST /integrations/inter/sync
   * Sincroniza saldo e extrato bancário do Banco Inter PJ
   */
  const handleSyncInter = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const body = (req.body as { startDate?: string; endDate?: string } | undefined) || {};
    const result = await interService.syncAccountAndStatement(organizationId, body);
    if (!result.success) {
      const statusCode = result.code === 'INTER_NOT_CONFIGURED' ? 400 : 502;
      return reply.status(statusCode).send(result);
    }
    return reply.send(result);
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/integrations/inter/sync', { preHandler: [requirePermission('integrations.sync')] }, handleSyncInter);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/integrations/inter/sync', { preHandler: [requirePermission('integrations.sync')] }, handleSyncInter);

  /**
   * POST /integrations/inter/reprocess
   * Reprocessa de forma idempotente todas as movimentações do Banco Inter PJ já persistidas,
   * corrigindo datas e direções (CREDIT/DEBIT) sem duplicar nem apagar nenhum registro.
   */
  const handleReprocessInter = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const result = await interService.reprocessExistingTransactions(organizationId);
    return reply.send({
      success: true,
      message: 'Reprocessamento idempotente concluído com sucesso.',
      ...result,
    });
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/integrations/inter/reprocess', { preHandler: [requirePermission('integrations.sync')] }, handleReprocessInter);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/integrations/inter/reprocess', { preHandler: [requirePermission('integrations.sync')] }, handleReprocessInter);

  /**
   * POST /integrations/inter/repair-duplicates (ENDPOINT CANÔNICO)
   * Rotina de reparo local, segura e idempotente para duplicatas comprovadas do Banco Inter PJ.
   * - Mescla classificações manuais para o registro canônico com valor real.
   * - Preserva transferências e histórico.
   * - Remove exclusivamente duplicatas comprovadas de R$ 0,00 (Prova A ou Prova B estrita).
   * - Retorna: scanned, duplicatesRemoved, manualDataMerged, ambiguousDuplicatesSkipped, remainingTransactions
   */
  const handleRepairInterDuplicates = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const result = await interService.repairInterDuplicates(organizationId);
    return reply.send({
      success: true,
      scanned: result.scanned,
      duplicatesRemoved: result.duplicatesRemoved,
      manualDataMerged: result.manualDataMerged,
      ambiguousDuplicatesSkipped: result.ambiguousDuplicatesSkipped,
      remainingTransactions: result.remainingTransactions,
      // Retrocompatibilidade
      totalInspected: result.totalInspected,
      removedCount: result.removedCount,
      mergedCount: result.mergedCount,
      message: 'Reparo de duplicatas concluído com sucesso.',
    });
  };

  // CLASSE: HUMAN_AUTHENTICATED — Endpoint canônico oficial
  app.post('/integrations/inter/repair-duplicates', { preHandler: [requirePermission('financial.edit')] }, handleRepairInterDuplicates);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/integrations/inter/repair-duplicates', { preHandler: [requirePermission('financial.edit')] }, handleRepairInterDuplicates);

  // CLASSE: HUMAN_AUTHENTICATED — Alias interno para compatibilidade
  app.post('/financial/inter/repair-duplicates', { preHandler: [requirePermission('financial.edit')] }, handleRepairInterDuplicates);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/financial/inter/repair-duplicates', { preHandler: [requirePermission('financial.edit')] }, handleRepairInterDuplicates);

  /**
   * GET /integrations/inter/repair-duplicates/preview (SOMENTE LEITURA)
   * Prévia do reparo de duplicatas do Banco Inter PJ.
   * Não grava nada no banco de dados e retorna contadores agregados seguros para confirmação explícita.
   */
  const handlePreviewRepairInterDuplicates = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const result = await interService.previewRepairInterDuplicates(organizationId);
    return reply.send(result);
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/integrations/inter/repair-duplicates/preview', { preHandler: [requirePermission('financial.view_details')] }, handlePreviewRepairInterDuplicates);
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/api/integrations/inter/repair-duplicates/preview', { preHandler: [requirePermission('financial.view_details')] }, handlePreviewRepairInterDuplicates);

  /**
   * GET /integrations/inter/diagnostics/date-fields (SOMENTE LEITURA - GET EXCLUSIVO)
   * Diagnóstico seguro sobre os rawPayloads das transações Inter armazenadas.
   * Não expõe dados pessoais, valores financeiros, descrições ou credenciais.
   */
  const handleGetInterDateDiagnostics = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const diagnostics = await interService.getInterDateFieldDiagnostics(organizationId);
    return reply.send(diagnostics);
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/integrations/inter/diagnostics/date-fields', { preHandler: [requirePermission('financial.view_details')] }, handleGetInterDateDiagnostics);
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/api/integrations/inter/diagnostics/date-fields', { preHandler: [requirePermission('financial.view_details')] }, handleGetInterDateDiagnostics);

  /**
   * GET /integrations/inter/preview-enriched-times (SOMENTE LEITURA)
   * Prévia segura dos horários reais do extrato completo do Banco Inter PJ.
   * Não grava nada no banco de dados e retorna exclusivamente contadores agregados.
   */
  const handlePreviewInterEnrichedTimes = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const query = (req.query as { startDate?: string; endDate?: string } | undefined) || {};
    try {
      const result = await interService.previewEnrichedTimes(organizationId, query);
      return reply.send(result);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        error: err.code || 'INTER_PREVIEW_ERROR',
        message: err.message || 'Erro ao consultar prévia do extrato completo.',
        scopeAvailable: false,
      });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/integrations/inter/preview-enriched-times', { preHandler: [requirePermission('financial.view_details')] }, handlePreviewInterEnrichedTimes);
  // CLASSE: HUMAN_AUTHENTICATED
  app.get('/api/integrations/inter/preview-enriched-times', { preHandler: [requirePermission('financial.view_details')] }, handlePreviewInterEnrichedTimes);

  /**
   * POST /integrations/inter/apply-enriched-times
   * Aplicação controlada e segura dos horários oficiais analíticos do Banco Inter PJ.
   * Atualiza unicamente lançamentos com identificador oficial bancário comprovado.
   * Não cria e não exclui nenhuma movimentação.
   */
  const handleApplyInterEnrichedTimes = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const body = (req.body as { startDate?: string; endDate?: string } | undefined) || {};
    try {
      const result = await interService.applyEnrichedTimes(organizationId, body);
      return reply.send(result);
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        error: err.code || 'INTER_APPLY_ERROR',
        message: err.message || 'Erro ao aplicar horários do extrato completo.',
      });
    }
  };
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/integrations/inter/apply-enriched-times', { preHandler: [requirePermission('financial.edit')] }, handleApplyInterEnrichedTimes);
  // CLASSE: HUMAN_AUTHENTICATED
  app.post('/api/integrations/inter/apply-enriched-times', { preHandler: [requirePermission('financial.edit')] }, handleApplyInterEnrichedTimes);
}
