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
   * Categoriza automaticamente uma transação com base nas regras locais da organização.
   * Se nenhuma regra corresponder, atribui "Para revisar" com status PENDING.
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
   * Cria ou atualiza uma regra de categorização automática da organização.
   */
  async createCategoryRule(
    organizationId: string,
    data: {
      categoryId: string;
      matchField: FinancialMatchField;
      matchType: FinancialMatchType;
      matchValue: string;
      priority?: number;
    }
  ) {
    const matchValueNormalized = normalizeMatchText(data.matchValue);
    if (!matchValueNormalized) {
      throw new Error('Valor para critério da regra é obrigatório.');
    }

    return this.prisma.financialCategoryRule.create({
      data: {
        organizationId,
        categoryId: data.categoryId,
        matchField: data.matchField,
        matchType: data.matchType,
        matchValueNormalized,
        priority: data.priority ?? 10,
        isActive: true,
      },
    });
  }

  /**
   * Lista categorias da organização.
   */
  async listCategories(organizationId: string) {
    await this.ensureDefaultCategories(organizationId);
    return this.prisma.financialCategory.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }
}

export const financialCategoryService = new FinancialCategoryService();
