import { prisma as defaultPrisma } from '../../lib/prisma.js';
import {
  FinancialCategoryType,
  FinancialCategorizationSource,
  FinancialMatchField,
  FinancialMatchType,
} from '@prisma/client';

export interface DefaultCategoryDef {
  name: string;
  type: FinancialCategoryType;
  color?: string;
}

export const DEFAULT_SYSTEM_CATEGORIES: DefaultCategoryDef[] = [
  { name: 'Receita de cliente', type: 'INCOME', color: '#10b981' },
  { name: 'Produção / Fornecedores', type: 'EXPENSE', color: '#f59e0b' },
  { name: 'Tráfego pago', type: 'EXPENSE', color: '#6366f1' },
  { name: 'Assinaturas e softwares', type: 'EXPENSE', color: '#3b82f6' },
  { name: 'Impostos e contabilidade', type: 'TAX', color: '#ef4444' },
  { name: 'Pró-labore / Retirada de sócio', type: 'EXPENSE', color: '#8b5cf6' },
  { name: 'Tarifas financeiras', type: 'FEE', color: '#ec4899' },
  { name: 'Transferência interna', type: 'TRANSFER', color: '#14b8a6' },
  { name: 'Outros', type: 'OTHER', color: '#6b7280' },
  { name: 'Para revisar', type: 'OTHER', color: '#9ca3af' },
];

export function normalizeMatchText(str?: string | null): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export class FinancialCategoryService {
  private readonly prisma: typeof defaultPrisma;

  constructor(prismaClient?: any) {
    this.prisma = prismaClient || defaultPrisma;
  }

  /**
   * Garante a criação idempotente das categorias padrão da organização.
   */
  async ensureDefaultCategories(organizationId: string): Promise<Map<string, string>> {
    const existing = await this.prisma.financialCategory.findMany({
      where: { organizationId },
    });

    const categoryMap = new Map<string, string>();
    for (const cat of existing) {
      categoryMap.set(cat.name, cat.id);
    }

    for (const def of DEFAULT_SYSTEM_CATEGORIES) {
      if (!categoryMap.has(def.name)) {
        const created = await this.prisma.financialCategory.create({
          data: {
            organizationId,
            name: def.name,
            type: def.type,
            color: def.color,
            isSystem: true,
            isActive: true,
          },
        });
        categoryMap.set(created.name, created.id);
      }
    }

    return categoryMap;
  }

  /**
   * Lista categorias da organização com contagem de movimentações vinculadas.
   */
  async listCategories(organizationId: string, options?: { includeArchived?: boolean }) {
    await this.ensureDefaultCategories(organizationId);

    const where: any = { organizationId };
    if (!options?.includeArchived) {
      where.isActive = true;
    }

    return this.prisma.financialCategory.findMany({
      where,
      include: {
        _count: {
          select: { transactions: true },
        },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Cria nova categoria personalizada na organização.
   */
  async createCategory(
    organizationId: string,
    data: { name: string; type: FinancialCategoryType; color?: string }
  ) {
    const trimmedName = (data.name || '').trim();
    if (!trimmedName) {
      throw new Error('Nome da categoria é obrigatório.');
    }

    const existing = await this.prisma.financialCategory.findFirst({
      where: {
        organizationId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      if (!existing.isActive) {
        // Se estava arquivada, reativa e atualiza dados
        return this.prisma.financialCategory.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            type: data.type || existing.type,
            color: data.color || existing.color,
          },
          include: { _count: { select: { transactions: true } } },
        });
      }
      throw new Error(`Já existe uma categoria ativa chamada "${trimmedName}".`);
    }

    return this.prisma.financialCategory.create({
      data: {
        organizationId,
        name: trimmedName,
        type: data.type || 'EXPENSE',
        color: data.color || '#6b7280',
        isSystem: false,
        isActive: true,
      },
      include: { _count: { select: { transactions: true } } },
    });
  }

  /**
   * Edita os atributos de uma categoria (nome, tipo, cor).
   */
  async updateCategory(
    organizationId: string,
    categoryId: string,
    data: { name?: string; type?: FinancialCategoryType; color?: string }
  ) {
    const category = await this.prisma.financialCategory.findFirst({
      where: { id: categoryId, organizationId },
    });

    if (!category) {
      throw new Error('Categoria não encontrada.');
    }

    const updateData: any = {};

    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (!trimmedName) {
        throw new Error('Nome da categoria não pode ser vazio.');
      }

      // Impede renomear categorias vitais de sistema
      if (category.isSystem && (category.name === 'Para revisar' || category.name === 'Transferência interna') && category.name !== trimmedName) {
        throw new Error(`A categoria do sistema "${category.name}" não pode ter o nome alterado.`);
      }

      // Verifica duplicidade de nome
      const duplicate = await this.prisma.financialCategory.findFirst({
        where: {
          organizationId,
          name: { equals: trimmedName, mode: 'insensitive' },
          id: { not: categoryId },
        },
      });
      if (duplicate) {
        throw new Error(`Já existe outra categoria com o nome "${trimmedName}".`);
      }

      updateData.name = trimmedName;
    }

    if (data.type !== undefined) {
      updateData.type = data.type;
    }

    if (data.color !== undefined) {
      updateData.color = data.color;
    }

    return this.prisma.financialCategory.update({
      where: { id: categoryId },
      data: updateData,
      include: { _count: { select: { transactions: true } } },
    });
  }

  /**
   * Arquiva uma categoria (isActive = false).
   */
  async archiveCategory(organizationId: string, categoryId: string) {
    const category = await this.prisma.financialCategory.findFirst({
      where: { id: categoryId, organizationId },
    });

    if (!category) {
      throw new Error('Categoria não encontrada.');
    }

    if (category.name === 'Para revisar' || category.name === 'Transferência interna') {
      throw new Error(`A categoria do sistema "${category.name}" não pode ser arquivada.`);
    }

    return this.prisma.financialCategory.update({
      where: { id: categoryId },
      data: { isActive: false },
      include: { _count: { select: { transactions: true } } },
    });
  }

  /**
   * Reativa uma categoria arquivada (isActive = true).
   */
  async reactivateCategory(organizationId: string, categoryId: string) {
    const category = await this.prisma.financialCategory.findFirst({
      where: { id: categoryId, organizationId },
    });

    if (!category) {
      throw new Error('Categoria não encontrada.');
    }

    return this.prisma.financialCategory.update({
      where: { id: categoryId },
      data: { isActive: true },
      include: { _count: { select: { transactions: true } } },
    });
  }

  /**
   * Exclui categoria se e somente se NÃO houver nenhuma movimentação vinculada.
   * Se houver transações vinculadas, lança erro com código CATEGORY_HAS_TRANSACTIONS.
   */
  async deleteCategory(organizationId: string, categoryId: string) {
    const category = await this.prisma.financialCategory.findFirst({
      where: { id: categoryId, organizationId },
    });

    if (!category) {
      throw new Error('Categoria não encontrada.');
    }

    if (category.isSystem) {
      throw new Error(`A categoria de sistema "${category.name}" não pode ser excluída.`);
    }

    const txCount = await this.prisma.financialTransaction.count({
      where: { categoryId, organizationId },
    });

    if (txCount > 0) {
      const err: any = new Error(
        `Esta categoria possui ${txCount} movimentação(ões) vinculada(s). Exclusão bloqueada para preservar o histórico. Escolha arquivar ou migrar os lançamentos para outra categoria antes de excluir.`
      );
      err.code = 'CATEGORY_HAS_TRANSACTIONS';
      err.transactionCount = txCount;
      throw err;
    }

    // Exclui regras associadas e em seguida a categoria
    await this.prisma.financialCategoryRule.deleteMany({
      where: { categoryId, organizationId },
    });

    return this.prisma.financialCategory.delete({
      where: { id: categoryId },
    });
  }

  /**
   * Migra movimentações de uma categoria para outra categoria de destino da mesma organização.
   */
  async migrateCategoryTransactions(
    organizationId: string,
    sourceCategoryId: string,
    targetCategoryId: string
  ) {
    if (sourceCategoryId === targetCategoryId) {
      throw new Error('A categoria de origem e de destino não podem ser a mesma.');
    }

    const [source, target] = await Promise.all([
      this.prisma.financialCategory.findFirst({ where: { id: sourceCategoryId, organizationId } }),
      this.prisma.financialCategory.findFirst({ where: { id: targetCategoryId, organizationId } }),
    ]);

    if (!source) throw new Error('Categoria de origem não encontrada.');
    if (!target) throw new Error('Categoria de destino não encontrada.');

    const result = await this.prisma.financialTransaction.updateMany({
      where: { categoryId: sourceCategoryId, organizationId },
      data: { categoryId: targetCategoryId },
    });

    return {
      migratedCount: result.count,
      sourceCategoryName: source.name,
      targetCategoryName: target.name,
    };
  }

  /**
   * Categoriza automaticamente uma transação com base nas regras locais da organização.
   * Ordem oficial:
   * 1. Informação estruturada / já classificada
   * 2. Regra automática local ativa (maior prioridade)
   * 3. Fallback seguro: "Para revisar" com status PENDING
   */
  async categorizeTransaction(
    organizationId: string,
    tx: {
      description: string;
      counterpartyName?: string | null;
      counterpartyDocument?: string | null;
    }
  ): Promise<{
    categoryId: string;
    categorizationSource: FinancialCategorizationSource;
    categorizationConfidence: number;
  }> {
    const categoryMap = await this.ensureDefaultCategories(organizationId);
    const toReviewCategoryId = categoryMap.get('Para revisar') || (categoryMap.values().next().value as string);

    // Carrega regras ativas da organização ordenadas por prioridade decrescente
    const rules = await this.prisma.financialCategoryRule.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      orderBy: { priority: 'desc' },
    });

    const normDesc = normalizeMatchText(tx.description);
    const normName = normalizeMatchText(tx.counterpartyName);
    const normDoc = (tx.counterpartyDocument || '').replace(/\D/g, '').trim();

    for (const rule of rules) {
      let candidateText = '';
      let targetRuleValue = rule.matchValueNormalized;

      if (rule.matchField === 'DESCRIPTION') {
        candidateText = normDesc;
        targetRuleValue = normalizeMatchText(rule.matchValueNormalized);
      } else if (rule.matchField === 'COUNTERPARTY_NAME') {
        candidateText = normName;
        targetRuleValue = normalizeMatchText(rule.matchValueNormalized);
      } else if (rule.matchField === 'COUNTERPARTY_DOCUMENT') {
        candidateText = normDoc;
        targetRuleValue = (rule.matchValueNormalized || '').replace(/\D/g, '').trim();
      }

      if (!candidateText || !targetRuleValue) continue;

      let matched = false;
      if (rule.matchType === 'EXACT') {
        matched = candidateText === targetRuleValue;
      } else {
        matched = candidateText.includes(targetRuleValue);
      }

      if (matched) {
        return {
          categoryId: rule.categoryId,
          categorizationSource: 'AUTO_RULE',
          categorizationConfidence: 0.95,
        };
      }
    }

    // Nenhuma regra coincidente: direciona para "Para revisar"
    return {
      categoryId: toReviewCategoryId,
      categorizationSource: 'PENDING',
      categorizationConfidence: 0.5,
    };
  }

  /**
   * Lista regras de categorização automática da organização.
   */
  async listRules(organizationId: string) {
    return this.prisma.financialCategoryRule.findMany({
      where: { organizationId },
      include: {
        category: {
          select: { id: true, name: true, color: true, type: true, isActive: true },
        },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Cria nova regra de categorização automática.
   */
  async createCategoryRule(
    organizationId: string,
    data: {
      categoryId: string;
      matchField: FinancialMatchField;
      matchType: FinancialMatchType;
      matchValue: string;
      priority?: number;
      isActive?: boolean;
    }
  ) {
    const matchValueNormalized = normalizeMatchText(data.matchValue);
    if (!matchValueNormalized) {
      throw new Error('Valor para critério da regra é obrigatório.');
    }

    const category = await this.prisma.financialCategory.findFirst({
      where: { id: data.categoryId, organizationId },
    });
    if (!category) {
      throw new Error('Categoria de destino não encontrada.');
    }

    return this.prisma.financialCategoryRule.create({
      data: {
        organizationId,
        categoryId: data.categoryId,
        matchField: data.matchField,
        matchType: data.matchType,
        matchValueNormalized,
        priority: data.priority ?? 10,
        isActive: data.isActive !== false,
      },
      include: {
        category: {
          select: { id: true, name: true, color: true, type: true },
        },
      },
    });
  }

  /**
   * Atualiza uma regra de categorização automática.
   */
  async updateCategoryRule(
    organizationId: string,
    ruleId: string,
    data: {
      categoryId?: string;
      matchField?: FinancialMatchField;
      matchType?: FinancialMatchType;
      matchValue?: string;
      priority?: number;
      isActive?: boolean;
    }
  ) {
    const existing = await this.prisma.financialCategoryRule.findFirst({
      where: { id: ruleId, organizationId },
    });
    if (!existing) {
      throw new Error('Regra não encontrada.');
    }

    const updateData: any = {};
    if (data.categoryId) {
      const category = await this.prisma.financialCategory.findFirst({
        where: { id: data.categoryId, organizationId },
      });
      if (!category) throw new Error('Categoria de destino não encontrada.');
      updateData.categoryId = data.categoryId;
    }
    if (data.matchField) updateData.matchField = data.matchField;
    if (data.matchType) updateData.matchType = data.matchType;
    if (data.matchValue !== undefined) {
      const norm = normalizeMatchText(data.matchValue);
      if (!norm) throw new Error('Critério da regra não pode ser vazio.');
      updateData.matchValueNormalized = norm;
    }
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return this.prisma.financialCategoryRule.update({
      where: { id: ruleId },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true, color: true, type: true },
        },
      },
    });
  }

  /**
   * Exclui uma regra de categorização automática.
   */
  async deleteCategoryRule(organizationId: string, ruleId: string) {
    const existing = await this.prisma.financialCategoryRule.findFirst({
      where: { id: ruleId, organizationId },
    });
    if (!existing) {
      throw new Error('Regra não encontrada.');
    }

    return this.prisma.financialCategoryRule.delete({
      where: { id: ruleId },
    });
  }

  /**
   * Alterna status ativo/inativo de uma regra.
   */
  async toggleRuleActive(organizationId: string, ruleId: string, isActive: boolean) {
    return this.updateCategoryRule(organizationId, ruleId, { isActive });
  }

  /**
   * Prévia de impacto de uma regra sobre transações existentes SEM realizar mutações silenciosas.
   */
  async previewRuleMatches(
    organizationId: string,
    rule: {
      matchField: FinancialMatchField;
      matchType: FinancialMatchType;
      matchValue: string;
      categoryId?: string;
    }
  ) {
    const targetVal = normalizeMatchText(rule.matchValue);
    if (!targetVal) return { totalMatches: 0, sampleMatches: [] };

    const transactions = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        account: { provider: 'INTER' },
      },
      select: {
        id: true,
        occurredAt: true,
        description: true,
        counterpartyName: true,
        counterpartyDocument: true,
        amount: true,
        direction: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
      },
      take: 200,
    });

    const matching = transactions.filter((tx) => {
      let candidate = '';
      if (rule.matchField === 'DESCRIPTION') candidate = normalizeMatchText(tx.description);
      if (rule.matchField === 'COUNTERPARTY_NAME') candidate = normalizeMatchText(tx.counterpartyName);
      if (rule.matchField === 'COUNTERPARTY_DOCUMENT') candidate = (tx.counterpartyDocument || '').replace(/\D/g, '').trim();

      if (!candidate) return false;
      return rule.matchType === 'EXACT' ? candidate === targetVal : candidate.includes(targetVal);
    });

    return {
      totalMatches: matching.length,
      sampleMatches: matching.slice(0, 5).map((m) => ({
        id: m.id,
        date: m.occurredAt.toISOString(),
        description: m.description,
        counterpartyName: m.counterpartyName,
        amount: Number(m.amount),
        direction: m.direction,
        currentCategory: m.category?.name || 'Sem categoria',
      })),
    };
  }

  /**
   * Aplica explicitamente uma regra criada sobre transações existentes que ainda estão "Para revisar"
   * ou sem categoria na organização.
   */
  async applyRuleRetroactively(organizationId: string, ruleId: string) {
    const rule = await this.prisma.financialCategoryRule.findFirst({
      where: { id: ruleId, organizationId, isActive: true },
    });
    if (!rule) throw new Error('Regra ativa não encontrada.');

    const targetVal = rule.matchValueNormalized;

    // Busca transações da organização onde categorizationSource é PENDING ou categoryId é nulo
    const transactions = await this.prisma.financialTransaction.findMany({
      where: {
        organizationId,
        categorizationSource: 'PENDING',
      },
    });

    let appliedCount = 0;
    for (const tx of transactions) {
      let candidate = '';
      if (rule.matchField === 'DESCRIPTION') candidate = normalizeMatchText(tx.description);
      if (rule.matchField === 'COUNTERPARTY_NAME') candidate = normalizeMatchText(tx.counterpartyName);
      if (rule.matchField === 'COUNTERPARTY_DOCUMENT') candidate = (tx.counterpartyDocument || '').replace(/\D/g, '').trim();

      if (!candidate) continue;
      const matched = rule.matchType === 'EXACT' ? candidate === targetVal : candidate.includes(targetVal);

      if (matched) {
        await this.prisma.financialTransaction.update({
          where: { id: tx.id },
          data: {
            categoryId: rule.categoryId,
            categorizationSource: 'AUTO_RULE',
            categorizationConfidence: 0.95,
          },
        });
        appliedCount += 1;
      }
    }

    return { appliedCount };
  }
}

export const financialCategoryService = new FinancialCategoryService();
