import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { FinancialService } from './financial.service.js';
import { FinancialCategoryService } from './financial-category.service.js';
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

      // Validação de perfil (RBAC) estrita na organização resolvida
      if (!['ADMIN', 'MANAGER'].includes(targetMembership.role)) {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Permissão insuficiente na organização selecionada',
        });
      }

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
  app.get('/financial/accounts/overview', handleGetOverview);
  app.get('/api/financial/accounts/overview', handleGetOverview);

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
  app.get('/financial/transactions', handleGetTransactions);
  app.get('/api/financial/transactions', handleGetTransactions);

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
  app.get('/financial/categories', handleGetCategories);
  app.get('/api/financial/categories', handleGetCategories);

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
      return reply.status(201).send(category);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  app.post('/financial/categories', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleCreateCategory);
  app.post('/api/financial/categories', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleCreateCategory);

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
      return reply.send(updated);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  app.patch('/financial/categories/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleUpdateCategoryAttrs);
  app.patch('/api/financial/categories/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleUpdateCategoryAttrs);

  /**
   * POST /financial/categories/:id/archive
   * Arquiva categoria (ADMIN / MANAGER)
   */
  const handleArchiveCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };

    try {
      const archived = await categoryService.archiveCategory(organizationId, id);
      return reply.send({ success: true, category: archived });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  };
  app.post('/financial/categories/:id/archive', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleArchiveCategory);
  app.post('/api/financial/categories/:id/archive', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleArchiveCategory);

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
  app.post('/financial/categories/:id/reactivate', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleReactivateCategory);
  app.post('/api/financial/categories/:id/reactivate', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleReactivateCategory);

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
  app.delete('/financial/categories/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleDeleteCategory);
  app.delete('/api/financial/categories/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleDeleteCategory);

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
  app.post('/financial/categories/:id/migrate', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleMigrateCategory);
  app.post('/api/financial/categories/:id/migrate', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleMigrateCategory);

  /**
   * GET /financial/category-rules
   * Lista regras de categorização automática
   */
  const handleGetRules = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const rules = await categoryService.listRules(organizationId);
    return reply.send({ rules });
  };
  app.get('/financial/category-rules', handleGetRules);
  app.get('/api/financial/category-rules', handleGetRules);

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
  app.post('/financial/category-rules', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleCreateCategoryRule);
  app.post('/api/financial/category-rules', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleCreateCategoryRule);

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
  app.patch('/financial/category-rules/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleUpdateCategoryRule);
  app.patch('/api/financial/category-rules/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleUpdateCategoryRule);

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
  app.delete('/financial/category-rules/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleDeleteCategoryRule);
  app.delete('/api/financial/category-rules/:id', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleDeleteCategoryRule);

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
  app.post('/financial/category-rules/preview', handlePreviewCategoryRule);
  app.post('/api/financial/category-rules/preview', handlePreviewCategoryRule);

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
  app.post('/financial/category-rules/:id/apply', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleApplyCategoryRule);
  app.post('/api/financial/category-rules/:id/apply', { preHandler: [requireRole(['ADMIN', 'MANAGER'])] }, handleApplyCategoryRule);

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
  app.patch('/financial/transactions/:id/category', handleUpdateCategory);
  app.patch('/api/financial/transactions/:id/category', handleUpdateCategory);

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
  app.patch('/financial/transfers/:id/confirm', handleConfirmTransfer);
  app.patch('/api/financial/transfers/:id/confirm', handleConfirmTransfer);

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
  app.post('/integrations/asaas/sync-ledger', handleSyncAsaasLedger);
  app.post('/api/integrations/asaas/sync-ledger', handleSyncAsaasLedger);

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
  app.post('/integrations/inter/sync', handleSyncInter);
  app.post('/api/integrations/inter/sync', handleSyncInter);

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
  app.post('/integrations/inter/reprocess', handleReprocessInter);
  app.post('/api/integrations/inter/reprocess', handleReprocessInter);
}
