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

  // Todas as rotas são protegidas por autenticação e perfil restrito (ADMIN ou MANAGER)
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(['ADMIN', 'MANAGER']));

  // Helper para obter organizationId de forma segura a partir de authContext ou sessão
  const getOrganizationId = (req: FastifyRequest): string => {
    const auth = req.authContext;
    if (auth && auth.type === 'user' && auth.memberships && auth.memberships.length > 0) {
      const zafira = auth.memberships.find((m) => m.organizationSlug === 'zafira');
      const orgId = (zafira || auth.memberships[0]).organizationId;
      if (orgId) return orgId;
    }

    const user = (req as any).user;
    if (user?.organizationId) {
      return user.organizationId;
    }

    if (auth && auth.type === 'api_key') {
      const headerOrg = req.headers['x-organization-id'] as string;
      const queryOrg = (req.query as any)?.organizationId;
      if (headerOrg || queryOrg) return headerOrg || queryOrg;
    }

    const err: any = new Error('Usuário não autenticado ou organização não identificada');
    err.statusCode = 401;
    throw err;
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
   * Lista categorias ativas da organização
   */
  const handleGetCategories = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const categories = await categoryService.ensureDefaultCategories(organizationId);
    return reply.send({ categories });
  };
  app.get('/financial/categories', handleGetCategories);
  app.get('/api/financial/categories', handleGetCategories);

  /**
   * PATCH /financial/transactions/:id/category
   * Edição e categorização rápida de uma transação (criação opcional de regra)
   */
  const handleUpdateCategory = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const { id } = req.params as { id: string };
    const body = req.body as {
      categoryId: string;
      createRule?: boolean;
      rulePattern?: string;
      ruleField?: 'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT';
      ruleMatchType?: 'CONTAINS' | 'EXACT';
    };

    if (!body || !body.categoryId) {
      return reply.status(400).send({ error: 'categoryId é obrigatório' });
    }

    const updated = await financialService.updateTransactionCategory(
      organizationId,
      id,
      body.categoryId,
      body.createRule
        ? {
            pattern: body.rulePattern || '',
            field: body.ruleField,
            matchType: body.ruleMatchType,
          }
        : undefined
    );
    return reply.send(updated);
  };
  app.patch('/financial/transactions/:id/category', handleUpdateCategory);
  app.patch('/api/financial/transactions/:id/category', handleUpdateCategory);

  /**
   * POST /financial/category-rules
   * Criação manual de regra de categorização
   */
  const handleCreateCategoryRule = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const body = req.body as {
      name: string;
      categoryId: string;
      matchField: 'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT';
      matchType: 'CONTAINS' | 'EXACT';
      pattern: string;
      priority?: number;
    };

    if (!body.name || !body.categoryId || !body.matchField || !body.matchType || !body.pattern) {
      return reply.status(400).send({ error: 'Campos obrigatórios ausentes para criação de regra' });
    }

    const rule = await categoryService.createRule(organizationId, body);
    return reply.status(201).send(rule);
  };
  app.post('/financial/category-rules', handleCreateCategoryRule);
  app.post('/api/financial/category-rules', handleCreateCategoryRule);

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
   * Sincroniza saldo e extrato financeiro do Asaas para a tabela de transações
   */
  const handleSyncAsaasLedger = async (req: FastifyRequest, reply: FastifyReply) => {
    const organizationId = getOrganizationId(req);
    const result = await asaasService.syncLedger(organizationId);
    return reply.send(result);
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
    return reply.send(result);
  };
  app.post('/integrations/inter/sync', handleSyncInter);
  app.post('/api/integrations/inter/sync', handleSyncInter);
}
