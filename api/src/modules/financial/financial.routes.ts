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
