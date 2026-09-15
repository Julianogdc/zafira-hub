import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { AsaasClient, AsaasIntegrationError, AsaasPaymentRaw } from './asaas.client.js';
import { AsaasPaymentStatus } from '@prisma/client';

export type AsaasLinkStatus = 'LINKED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'NO_DOCUMENT';

export interface ClientFinancialKPIs {
  pending: number;
  pendingCount: number;
  receivedMonth: number;
  receivedMonthCount: number;
  overdue: number;
  overdueCount: number;
}

export interface ClientFinancialSummaryResponse {
  clientId: string;
  isLinked: boolean;
  linkStatus: AsaasLinkStatus;
  linkStatusLabel: string;
  asaasCustomerId: string | null;
  kpis: ClientFinancialKPIs;
  payments: FormattedAsaasPayment[];
  totalPayments: number;
}

export interface FormattedAsaasPayment {
  id: string;
  externalId: string;
  description: string;
  value: number;
  netValue: number | null;
  billingType: string;
  status: AsaasPaymentStatus;
  statusLabel: string;
  dueDate: string;
  paymentDate: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  isOverdue: boolean;
}

export interface ClientSyncResult {
  success: boolean;
  clientId: string;
  linkStatus: AsaasLinkStatus;
  linkStatusLabel: string;
  asaasCustomerId: string | null;
  syncedPayments: number;
  timestamp: string;
}

export interface AsaasSyncResult {
  success: boolean;
  syncedCustomers: number;
  linkedClients: number;
  unlinkedCustomers: number;
  syncedPayments: number;
  timestamp: string;
}

export interface AsaasWalletSyncResult {
  success: boolean;
  totalCustomersAsaas: number;
  linkedClients: number;
  createdClients: number;
  syncedPayments: number;
  ignoredWithoutDoc: number;
  ambiguousCount: number;
  errors: string[];
  timestamp: string;
}


export interface FinancialOverviewFilters {
  period?: 'current-month' | 'last-month' | 'current-year' | 'all' | 'custom' | string;
  startDate?: string;
  endDate?: string;
  clientId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface FinancialOverviewKPIs {
  receivedMonth: number;
  receivedMonthCount: number;
  pending: number;
  pendingCount: number;
  overdue: number;
  overdueCount: number;
  nextDueDate: {
    date: string | null;
    value: number | null;
    clientName: string | null;
  } | null;
  statusCounts: {
    pending: number;
    received: number;
    overdue: number;
    refunded: number;
    cancelled: number;
  };
}

export interface TimeSeriesPoint {
  month: string;
  label: string;
  value: number;
  count: number;
}

export interface FinancialOverviewPaymentItem extends FormattedAsaasPayment {
  client: {
    id: string;
    name: string;
  } | null;
}

export interface FinancialOverviewResponse {
  kpis: FinancialOverviewKPIs;
  recebidosTimeSeries: TimeSeriesPoint[];
  previstosTimeSeries: TimeSeriesPoint[];
  payments: FinancialOverviewPaymentItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  hasUnsyncedData: boolean;
  disclaimer: string;
}


/**
 * Higieniza strings de documento removendo pontuação e espaços.
 */
export function sanitizeDocument(doc?: string | null): string {
  if (!doc) return '';
  return doc.replace(/\D/g, '').trim();
}

/**
 * Validação de token em tempo constante para prevenir timing attacks.
 */
export function safeCompareTokens(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Gera chave determinística SHA-256 para controle rigoroso de idempotência de webhooks.
 * Baseia-se no evento + externalId do pagamento + payload normalizado.
 */
export function generateWebhookDedupeKey(event: string, paymentId: string, paymentPayload: any): string {
  const cleanEvent = String(event || '').trim().toUpperCase();
  const cleanPaymentId = String(paymentId || '').trim();

  if (!cleanEvent || !cleanPaymentId) {
    throw new AsaasIntegrationError(
      'Evento e ID de pagamento são obrigatórios para cálculo de dedupeKey',
      400,
      'INVALID_WEBHOOK_DATA'
    );
  }

  const normalize = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(normalize);
    return Object.keys(obj)
      .sort()
      .reduce((acc: any, key: string) => {
        acc[key] = normalize(obj[key]);
        return acc;
      }, {});
  };

  const payloadToHash = normalize({
    event: cleanEvent,
    paymentId: cleanPaymentId,
    payment: paymentPayload || {},
  });

  return crypto.createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');
}

/**
 * Mapeia o status de cobrança do Asaas para o enum AsaasPaymentStatus do Prisma.
 */
export function mapAsaasPaymentStatus(status?: string | null): AsaasPaymentStatus {
  const upper = String(status || '').toUpperCase();
  switch (upper) {
    case 'RECEIVED':
      return AsaasPaymentStatus.RECEIVED;
    case 'CONFIRMED':
      return AsaasPaymentStatus.CONFIRMED;
    case 'OVERDUE':
      return AsaasPaymentStatus.OVERDUE;
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
      return AsaasPaymentStatus.REFUNDED;
    case 'DELETED':
      return AsaasPaymentStatus.DELETED;
    case 'CANCELLED':
      return AsaasPaymentStatus.CANCELLED;
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
    default:
      return AsaasPaymentStatus.PENDING;
  }
}

export function getAsaasStatusLabel(status: AsaasPaymentStatus): string {
  switch (status) {
    case AsaasPaymentStatus.RECEIVED:
    case AsaasPaymentStatus.CONFIRMED:
      return 'Pago';
    case AsaasPaymentStatus.OVERDUE:
      return 'Vencido';
    case AsaasPaymentStatus.REFUNDED:
      return 'Estornado';
    case AsaasPaymentStatus.DELETED:
    case AsaasPaymentStatus.CANCELLED:
      return 'Cancelado';
    case AsaasPaymentStatus.PENDING:
    default:
      return 'Pendente';
  }
}

export class AsaasService {
  private readonly client: AsaasClient;
  private readonly prismaClient: typeof defaultPrisma;

  constructor(client?: AsaasClient, prismaClient?: any) {
    this.client = client || new AsaasClient();
    this.prismaClient = prismaClient || defaultPrisma;
  }

  /**
   * Consulta o extrato e resumo financeiro do cliente no Hub a partir das cobranças do Asaas.
   */
  async getClientFinancialSummary(
    clientId: string,
    organizationId?: string
  ): Promise<ClientFinancialSummaryResponse> {
    if (!clientId || !clientId.trim()) {
      throw new AsaasIntegrationError('ID do cliente é obrigatório', 400, 'INVALID_CLIENT_ID');
    }

    // 1. Valida se o cliente existe e pertence à organização
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, organizationId: true, document: true, name: true },
    });

    if (!client || (organizationId && client.organizationId !== organizationId)) {
      throw new AsaasIntegrationError('Cliente não encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Busca vínculo do cliente com o Asaas
    const integration = await this.prismaClient.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'ASAAS',
      },
    });

    const asaasCustomerId = integration?.externalId || null;
    const isLinked = Boolean(asaasCustomerId);

    let linkStatus: AsaasLinkStatus = 'NOT_FOUND';
    let linkStatusLabel = 'Cliente não encontrado no Asaas';

    const cleanDoc = sanitizeDocument(client.document);
    if (isLinked) {
      linkStatus = 'LINKED';
      linkStatusLabel = 'Vinculado';
    } else if (!cleanDoc || (cleanDoc.length !== 11 && cleanDoc.length !== 14)) {
      linkStatus = 'NO_DOCUMENT';
      linkStatusLabel = 'Cliente sem CPF/CNPJ cadastrado';
    }

    // 3. Busca cobranças registradas no banco para este cliente
    const payments = await this.prismaClient.asaasPayment.findMany({
      where: {
        clientId,
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: {
        dueDate: 'desc',
      },
    });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let pending = 0;
    let pendingCount = 0;
    let receivedMonth = 0;
    let receivedMonthCount = 0;
    let overdue = 0;
    let overdueCount = 0;

    const formattedPayments: FormattedAsaasPayment[] = payments.map((p) => {
      const numValue = Number(p.value);
      const isPaid = p.status === AsaasPaymentStatus.RECEIVED || p.status === AsaasPaymentStatus.CONFIRMED;
      const isOverdue = !isPaid && (p.status === AsaasPaymentStatus.OVERDUE || p.dueDate < now);

      if (isPaid) {
        const payDate = p.paymentDate || p.clientPaymentDate || p.updatedAt;
        if (payDate && payDate.getMonth() === currentMonth && payDate.getFullYear() === currentYear) {
          receivedMonth += numValue;
          receivedMonthCount += 1;
        }
      } else if (isOverdue) {
        overdue += numValue;
        overdueCount += 1;
      } else if (p.status === AsaasPaymentStatus.PENDING) {
        pending += numValue;
        pendingCount += 1;
      }

      return {
        id: p.id,
        externalId: p.externalId,
        description: p.description || 'Cobrança Asaas',
        value: numValue,
        netValue: p.netValue ? Number(p.netValue) : null,
        billingType: p.billingType,
        status: p.status,
        statusLabel: getAsaasStatusLabel(p.status),
        dueDate: p.dueDate.toISOString(),
        paymentDate: p.paymentDate ? p.paymentDate.toISOString() : null,
        invoiceUrl: p.invoiceUrl,
        bankSlipUrl: p.bankSlipUrl,
        isOverdue,
      };
    });

    return {
      clientId,
      isLinked,
      linkStatus,
      linkStatusLabel,
      asaasCustomerId,
      kpis: {
        pending,
        pendingCount,
        receivedMonth,
        receivedMonthCount,
        overdue,
        overdueCount,
      },
      payments: formattedPayments,
      totalPayments: formattedPayments.length,
    };
  }

  /**
   * Sincronização granular restrita a um único cliente (Etapa 4B Hardening).
   * Consulta e sincroniza SOMENTE os dados deste cliente Hub no Asaas.
   * Não afeta outros clientes nem faz varredura ampla.
   */
  async syncClientAsaasData(clientId: string, organizationId: string): Promise<ClientSyncResult> {
    if (!clientId || !clientId.trim()) {
      throw new AsaasIntegrationError('ID do cliente é obrigatório', 400, 'INVALID_CLIENT_ID');
    }
    if (!organizationId) {
      throw new AsaasIntegrationError('Organização é obrigatória', 400, 'ORG_REQUIRED');
    }

    // 1. Valida se o cliente existe e pertence à organização
    const client = await this.prismaClient.client.findUnique({
      where: { id: clientId },
      select: { id: true, organizationId: true, document: true, name: true },
    });

    if (!client || client.organizationId !== organizationId) {
      throw new AsaasIntegrationError('Cliente não encontrado na organização', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Verifica se já há integração registrada
    let existingIntegration = await this.prismaClient.clientIntegration.findFirst({
      where: {
        clientId,
        provider: 'ASAAS',
      },
    });

    let asaasCustomerId = existingIntegration?.externalId || null;

    // Se ainda não estiver vinculado, busca no Asaas por CPF/CNPJ higienizado
    if (!asaasCustomerId) {
      const cleanDoc = sanitizeDocument(client.document);

      // Regra de segurança: se não houver documento válido, não vincular
      if (!cleanDoc || (cleanDoc.length !== 11 && cleanDoc.length !== 14)) {
        return {
          success: false,
          clientId,
          linkStatus: 'NO_DOCUMENT',
          linkStatusLabel: 'Cliente não possui CPF/CNPJ válido cadastrado',
          asaasCustomerId: null,
          syncedPayments: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // Consulta no Asaas estritamente pelo CPF/CNPJ do cliente
      const asaasRes = await this.client.getCustomers({ cpfCnpj: cleanDoc });
      const matches = asaasRes.data || [];

      if (matches.length === 0) {
        return {
          success: false,
          clientId,
          linkStatus: 'NOT_FOUND',
          linkStatusLabel: 'Cliente não encontrado no Asaas',
          asaasCustomerId: null,
          syncedPayments: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // Regra de segurança: se houver mais de um registro, ambiguidade impede vínculo automático
      if (matches.length > 1) {
        return {
          success: false,
          clientId,
          linkStatus: 'AMBIGUOUS',
          linkStatusLabel: 'Vínculo ambíguo — requer revisão',
          asaasCustomerId: null,
          syncedPayments: 0,
          timestamp: new Date().toISOString(),
        };
      }

      // Exatamente 1 cliente encontrado: vínculo seguro garantido
      const matchedCustomer = matches[0];
      asaasCustomerId = matchedCustomer.id;

      await this.prismaClient.clientIntegration.upsert({
        where: {
          clientId_provider_externalId: {
            clientId,
            provider: 'ASAAS',
            externalId: asaasCustomerId,
          },
        },
        create: {
          clientId,
          provider: 'ASAAS',
          externalId: asaasCustomerId,
          metadata: {
            name: matchedCustomer.name,
            email: matchedCustomer.email,
            cpfCnpj: matchedCustomer.cpfCnpj,
            phone: matchedCustomer.phone || matchedCustomer.mobilePhone,
          },
        },
        update: {
          metadata: {
            name: matchedCustomer.name,
            email: matchedCustomer.email,
            cpfCnpj: matchedCustomer.cpfCnpj,
            phone: matchedCustomer.phone || matchedCustomer.mobilePhone,
          },
        },
      });
    }

    // 3. Consulta cobranças SOMENTE para este customer do Asaas
    const paymentsRes = await this.client.getPayments({
      customer: asaasCustomerId,
      limit: 100,
    });
    const payments = paymentsRes.data || [];

    let syncedPayments = 0;

    for (const p of payments) {
      const status = mapAsaasPaymentStatus(p.status);
      const dueDate = new Date(p.dueDate);
      const paymentDate = p.paymentDate ? new Date(p.paymentDate) : null;
      const clientPaymentDate = p.clientPaymentDate ? new Date(p.clientPaymentDate) : null;

      await this.prismaClient.asaasPayment.upsert({
        where: { externalId: p.id },
        create: {
          organizationId,
          clientId,
          asaasCustomerId: p.customer,
          externalId: p.id,
          installmentNumber: p.installmentNumber || null,
          description: p.description || null,
          value: p.value,
          netValue: p.netValue || null,
          originalValue: p.originalValue || null,
          interestValue: p.interestValue || null,
          billingType: p.billingType || 'UNDEFINED',
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: p.invoiceUrl || null,
          bankSlipUrl: p.bankSlipUrl || null,
          rawPayload: p as any,
        },
        update: {
          clientId, // Assegura o vínculo deste cliente
          value: p.value,
          netValue: p.netValue || null,
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: p.invoiceUrl || null,
          bankSlipUrl: p.bankSlipUrl || null,
          rawPayload: p as any,
        },
      });

      syncedPayments += 1;
    }

    return {
      success: true,
      clientId,
      linkStatus: 'LINKED',
      linkStatusLabel: 'Vinculado',
      asaasCustomerId,
      syncedPayments,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Sincronização manual segura global (Modo Somente Leitura).
   */
  async syncAsaasData(organizationId: string): Promise<AsaasSyncResult> {
    if (!organizationId) {
      throw new AsaasIntegrationError('Organização é obrigatória para sincronização', 400, 'ORG_REQUIRED');
    }

    const hubClients = await this.prismaClient.client.findMany({
      where: { organizationId },
      select: { id: true, document: true, name: true },
    });

    const clientsByDoc = new Map<string, string>();
    for (const c of hubClients) {
      const cleanDoc = sanitizeDocument(c.document);
      if (cleanDoc && (cleanDoc.length === 11 || cleanDoc.length === 14)) {
        clientsByDoc.set(cleanDoc, c.id);
      }
    }

    const asaasCustomersRes = await this.client.getCustomers({ limit: 100 });
    const asaasCustomers = asaasCustomersRes.data || [];

    let linkedClients = 0;
    let unlinkedCustomers = 0;
    const customerToClientMap = new Map<string, string>();

    const existingIntegrations = await this.prismaClient.clientIntegration.findMany({
      where: {
        provider: 'ASAAS',
        client: { organizationId },
      },
      select: { clientId: true, externalId: true },
    });

    for (const integ of existingIntegrations) {
      customerToClientMap.set(integ.externalId, integ.clientId);
    }

    for (const ac of asaasCustomers) {
      const cleanDoc = sanitizeDocument(ac.cpfCnpj);
      let matchedClientId = cleanDoc ? clientsByDoc.get(cleanDoc) : undefined;

      if (matchedClientId) {
        customerToClientMap.set(ac.id, matchedClientId);
        await this.prismaClient.clientIntegration.upsert({
          where: {
            clientId_provider_externalId: {
              clientId: matchedClientId,
              provider: 'ASAAS',
              externalId: ac.id,
            },
          },
          create: {
            clientId: matchedClientId,
            provider: 'ASAAS',
            externalId: ac.id,
            metadata: {
              name: ac.name,
              email: ac.email,
              phone: ac.phone || ac.mobilePhone,
              cpfCnpj: ac.cpfCnpj,
            },
          },
          update: {
            metadata: {
              name: ac.name,
              email: ac.email,
              phone: ac.phone || ac.mobilePhone,
              cpfCnpj: ac.cpfCnpj,
            },
          },
        });
        linkedClients += 1;
      } else if (customerToClientMap.has(ac.id)) {
        linkedClients += 1;
      } else {
        unlinkedCustomers += 1;
      }
    }

    const asaasPaymentsRes = await this.client.getPayments({ limit: 100 });
    const asaasPayments = asaasPaymentsRes.data || [];

    let syncedPayments = 0;

    for (const p of asaasPayments) {
      const matchedClientId = customerToClientMap.get(p.customer) || null;
      const status = mapAsaasPaymentStatus(p.status);
      const dueDate = new Date(p.dueDate);
      const paymentDate = p.paymentDate ? new Date(p.paymentDate) : null;
      const clientPaymentDate = p.clientPaymentDate ? new Date(p.clientPaymentDate) : null;

      await this.prismaClient.asaasPayment.upsert({
        where: { externalId: p.id },
        create: {
          organizationId,
          clientId: matchedClientId,
          asaasCustomerId: p.customer,
          externalId: p.id,
          installmentNumber: p.installmentNumber || null,
          description: p.description || null,
          value: p.value,
          netValue: p.netValue || null,
          originalValue: p.originalValue || null,
          interestValue: p.interestValue || null,
          billingType: p.billingType || 'UNDEFINED',
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: p.invoiceUrl || null,
          bankSlipUrl: p.bankSlipUrl || null,
          rawPayload: p as any,
        },
        update: {
          clientId: matchedClientId,
          value: p.value,
          netValue: p.netValue || null,
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: p.invoiceUrl || null,
          bankSlipUrl: p.bankSlipUrl || null,
          rawPayload: p as any,
        },
      });

      syncedPayments += 1;
    }

    return {
      success: true,
      syncedCustomers: asaasCustomers.length,
      linkedClients,
      unlinkedCustomers,
      syncedPayments,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Sincronização completa da carteira do Asaas com criação automática de clientes no Hub.
   * Regras:
   * - Clientes do Asaas ausentes no Hub com CPF/CNPJ válido são criados com status ACTIVE.
   * - Clientes existentes no Hub NÃO têm seus dados manuais sobrescritos e mantêm seu status.
   * - Clientes sem CPF/CNPJ válido (11 ou 14 dígitos) não são criados e são contabilizados em ignoredWithoutDoc.
   * - Cobranças são espelhadas em AsaasPayment vinculadas à organização e aos respectivos clientes.
   * - Paginação completa de clientes e cobranças (somente GET contra o Asaas).
   */
  async syncAllWallet(organizationId: string): Promise<AsaasWalletSyncResult> {
    if (!organizationId) {
      throw new AsaasIntegrationError('Organização é obrigatória', 400, 'ORG_REQUIRED');
    }

    // 1. Carrega todos os clientes da organização no Hub
    const hubClients = await this.prismaClient.client.findMany({
      where: { organizationId },
      include: {
        integrations: {
          where: { provider: 'ASAAS' },
        },
      },
    });

    const clientByDoc = new Map<string, typeof hubClients[0]>();
    const clientByExternalId = new Map<string, typeof hubClients[0]>();

    for (const c of hubClients) {
      const cleanDoc = sanitizeDocument(c.document);
      if (cleanDoc && (cleanDoc.length === 11 || cleanDoc.length === 14)) {
        clientByDoc.set(cleanDoc, c);
      }
      for (const integ of c.integrations) {
        clientByExternalId.set(integ.externalId, c);
      }
    }

    // 2. Consulta todos os clientes do Asaas (paginação completa via getAllCustomers)
    const asaasCustomers = await this.client.getAllCustomers();

    let linkedClients = 0;
    let createdClients = 0;
    let ignoredWithoutDoc = 0;
    let ambiguousCount = 0;
    const errors: string[] = [];

    const asaasCustomerToHubClientId = new Map<string, string>();

    for (const ac of asaasCustomers) {
      const cleanDoc = sanitizeDocument(ac.cpfCnpj);

      // Regra de segurança: cliente sem CPF/CNPJ válido é ignorado e não é criado
      if (!cleanDoc || (cleanDoc.length !== 11 && cleanDoc.length !== 14)) {
        ignoredWithoutDoc += 1;
        continue;
      }

      let matchedClient = clientByExternalId.get(ac.id) || clientByDoc.get(cleanDoc);

      if (matchedClient) {
        asaasCustomerToHubClientId.set(ac.id, matchedClient.id);
        linkedClients += 1;

        // Assegura que o vínculo em ClientIntegration existe sem sobrescrever nenhum dado do Client existente
        await this.prismaClient.clientIntegration.upsert({
          where: {
            clientId_provider_externalId: {
              clientId: matchedClient.id,
              provider: 'ASAAS',
              externalId: ac.id,
            },
          },
          create: {
            clientId: matchedClient.id,
            provider: 'ASAAS',
            externalId: ac.id,
            metadata: {
              name: ac.name,
              email: ac.email,
              phone: ac.phone || ac.mobilePhone,
              cpfCnpj: ac.cpfCnpj,
            },
          },
          update: {
            metadata: {
              name: ac.name,
              email: ac.email,
              phone: ac.phone || ac.mobilePhone,
              cpfCnpj: ac.cpfCnpj,
            },
          },
        });
      } else {
        // Criação automática no Hub para cliente novo
        try {
          const newClient = await this.prismaClient.client.create({
            data: {
              organizationId,
              name: (ac.name || 'Cliente Asaas').trim(),
              legalName: ac.name || null,
              document: cleanDoc,
              email: ac.email?.trim() || null,
              phone: (ac.phone || ac.mobilePhone || '').trim() || null,
              status: 'ACTIVE',
              integrations: {
                create: {
                  provider: 'ASAAS',
                  externalId: ac.id,
                  metadata: {
                    name: ac.name,
                    email: ac.email,
                    phone: ac.phone || ac.mobilePhone,
                    cpfCnpj: ac.cpfCnpj,
                  },
                },
              },
            },
          });

          clientByDoc.set(cleanDoc, newClient as any);
          clientByExternalId.set(ac.id, newClient as any);
          asaasCustomerToHubClientId.set(ac.id, newClient.id);
          createdClients += 1;
        } catch (err: any) {
          errors.push(`Erro ao criar cliente '${ac.name}' (${cleanDoc}): ${err?.message || 'Erro desconhecido'}`);
        }
      }
    }

    // 3. Consulta todas as cobranças do Asaas (paginação completa via getAllPayments)
    const asaasPayments = await this.client.getAllPayments();
    let syncedPayments = 0;

    for (const p of asaasPayments) {
      const matchedClientId = asaasCustomerToHubClientId.get(p.customer) || null;
      const status = mapAsaasPaymentStatus(p.status);
      const dueDate = new Date(p.dueDate);
      const paymentDate = p.paymentDate ? new Date(p.paymentDate) : null;
      const clientPaymentDate = p.clientPaymentDate ? new Date(p.clientPaymentDate) : null;

      await this.prismaClient.asaasPayment.upsert({
        where: { externalId: p.id },
        create: {
          organizationId,
          clientId: matchedClientId,
          asaasCustomerId: p.customer,
          externalId: p.id,
          installmentNumber: p.installmentNumber || null,
          description: p.description || null,
          value: p.value,
          netValue: p.netValue || null,
          originalValue: p.originalValue || null,
          interestValue: p.interestValue || null,
          billingType: p.billingType || 'UNDEFINED',
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: p.invoiceUrl || null,
          bankSlipUrl: p.bankSlipUrl || null,
          rawPayload: p as any,
        },
        update: {
          clientId: matchedClientId,
          value: p.value,
          netValue: p.netValue || null,
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: p.invoiceUrl || null,
          bankSlipUrl: p.bankSlipUrl || null,
          rawPayload: p as any,
        },
      });

      syncedPayments += 1;
    }

    return {
      success: true,
      totalCustomersAsaas: asaasCustomers.length,
      linkedClients,
      createdClients,
      syncedPayments,
      ignoredWithoutDoc,
      ambiguousCount,
      errors,
      timestamp: new Date().toISOString(),
    };
  }


  /**
   * Processamento idempotente e seguro de notificações de Webhook do Asaas (Etapa 4B Hardening).
   * Utiliza dedupeKey SHA-256 determinística baseada em evento + paymentId + payload normalizado.
   */
  async processWebhookEvent(payload: any, tokenHeader?: string): Promise<{ processed: boolean; duplicate?: boolean }> {
    const configuredToken = process.env.ASAAS_WEBHOOK_TOKEN;

    // 1. Validação de segurança do token com safeCompareTokens
    if (!configuredToken || !safeCompareTokens(tokenHeader, configuredToken)) {
      throw new AsaasIntegrationError(
        'Assinatura ou token de webhook inválido',
        401,
        'UNAUTHORIZED_WEBHOOK'
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new AsaasIntegrationError('Payload de webhook inválido', 400, 'INVALID_WEBHOOK_PAYLOAD');
    }

    const event = String(payload.event || '').trim().toUpperCase();
    const supportedEvents = [
      'PAYMENT_CREATED',
      'PAYMENT_UPDATED',
      'PAYMENT_RECEIVED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_OVERDUE',
      'PAYMENT_DELETED',
      'PAYMENT_REFUNDED',
    ];

    if (!supportedEvents.includes(event)) {
      return { processed: false };
    }

    const payment: AsaasPaymentRaw = payload.payment;
    if (!payment || !payment.id || !payment.id.trim()) {
      return { processed: false };
    }

    // 2. Idempotência real: gera dedupeKey SHA-256 determinística
    const dedupeKey = generateWebhookDedupeKey(event, payment.id, payment);

    const existingEvent = await this.prismaClient.asaasWebhookEvent.findUnique({
      where: { dedupeKey },
    });

    if (existingEvent) {
      return { processed: true, duplicate: true };
    }

    // 3. Localiza vínculo de cliente e organização
    const integration = await this.prismaClient.clientIntegration.findFirst({
      where: {
        provider: 'ASAAS',
        externalId: payment.customer,
      },
      include: {
        client: {
          select: { id: true, organizationId: true },
        },
      },
    });

    let organizationId = integration?.client?.organizationId;
    let clientId = integration?.client?.id || null;

    if (!organizationId) {
      const existingPayment = await this.prismaClient.asaasPayment.findUnique({
        where: { externalId: payment.id },
        select: { organizationId: true, clientId: true },
      });
      organizationId = existingPayment?.organizationId;
      clientId = clientId || existingPayment?.clientId || null;
    }

    if (!organizationId) {
      const firstOrg = await this.prismaClient.organization.findFirst({
        select: { id: true },
      });
      organizationId = firstOrg?.id;
    }

    if (organizationId) {
      const status = mapAsaasPaymentStatus(payment.status);
      const dueDate = new Date(payment.dueDate);
      const paymentDate = payment.paymentDate ? new Date(payment.paymentDate) : null;
      const clientPaymentDate = payment.clientPaymentDate ? new Date(payment.clientPaymentDate) : null;

      await this.prismaClient.asaasPayment.upsert({
        where: { externalId: payment.id },
        create: {
          organizationId,
          clientId,
          asaasCustomerId: payment.customer,
          externalId: payment.id,
          installmentNumber: payment.installmentNumber || null,
          description: payment.description || null,
          value: payment.value,
          netValue: payment.netValue || null,
          originalValue: payment.originalValue || null,
          interestValue: payment.interestValue || null,
          billingType: payment.billingType || 'UNDEFINED',
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: payment.invoiceUrl || null,
          bankSlipUrl: payment.bankSlipUrl || null,
          rawPayload: payload,
        },
        update: {
          value: payment.value,
          netValue: payment.netValue || null,
          status,
          dueDate,
          paymentDate,
          clientPaymentDate,
          invoiceUrl: payment.invoiceUrl || null,
          bankSlipUrl: payment.bankSlipUrl || null,
          rawPayload: payload,
        },
      });
    }

    // 4. Registra evento com dedupeKey e eventId opcional (sem segredos)
    await this.prismaClient.asaasWebhookEvent.create({
      data: {
        dedupeKey,
        eventId: payload.id ? String(payload.id).trim() : null,
        event,
        paymentExternalId: payment.id,
        payload: payload,
      },
    });

    return { processed: true, duplicate: false };
  }

  /**
   * Consulta agregada para a página global Finanças (/financas).
   * Utiliza estritamente os dados de AsaasPayment e Client no banco local.
   * Não realiza nenhuma chamada à API externa do Asaas.
   */
  async getFinancialOverview(
    organizationId: string,
    filters: FinancialOverviewFilters = {}
  ): Promise<FinancialOverviewResponse> {
    if (!organizationId) {
      throw new AsaasIntegrationError('Organização é obrigatória', 400, 'ORG_REQUIRED');
    }

    const {
      period = 'current-month',
      startDate,
      endDate,
      clientId,
      status,
      search,
      page = 1,
      limit = 20,
    } = filters;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // 1. Busca todos os pagamentos da organização (com filtro opcional de cliente) para calcular KPIs e Séries Temporais
    const baseWhere: any = {
      organizationId,
      ...(clientId ? { clientId } : {}),
    };

    const allPayments = await this.prismaClient.asaasPayment.findMany({
      where: baseWhere,
      select: {
        id: true,
        value: true,
        netValue: true,
        status: true,
        dueDate: true,
        paymentDate: true,
        clientPaymentDate: true,
        updatedAt: true,
        clientId: true,
        client: {
          select: { id: true, name: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    let receivedMonth = 0;
    let receivedMonthCount = 0;
    let pending = 0;
    let pendingCount = 0;
    let overdue = 0;
    let overdueCount = 0;

    let nextDueDateItem: { date: string | null; value: number | null; clientName: string | null } | null = null;
    let minFutureDueDate: Date | null = null;

    const statusCounts = {
      pending: 0,
      received: 0,
      overdue: 0,
      refunded: 0,
      cancelled: 0,
    };

    for (const p of allPayments) {
      const numVal = Number(p.value);
      const isPaid = p.status === AsaasPaymentStatus.RECEIVED || p.status === AsaasPaymentStatus.CONFIRMED;
      const isOverdue = !isPaid && (p.status === AsaasPaymentStatus.OVERDUE || p.dueDate < now);
      const isPending = !isPaid && !isOverdue && p.status === AsaasPaymentStatus.PENDING;

      if (isPaid) {
        statusCounts.received += 1;
        const pDate = p.paymentDate || p.clientPaymentDate || p.updatedAt;
        if (pDate && pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) {
          receivedMonth += numVal;
          receivedMonthCount += 1;
        }
      } else if (isOverdue) {
        statusCounts.overdue += 1;
        overdue += numVal;
        overdueCount += 1;
      } else if (isPending) {
        statusCounts.pending += 1;
        pending += numVal;
        pendingCount += 1;

        if (p.dueDate >= now) {
          if (!minFutureDueDate || p.dueDate < minFutureDueDate) {
            minFutureDueDate = p.dueDate;
            nextDueDateItem = {
              date: p.dueDate.toISOString(),
              value: numVal,
              clientName: p.client?.name || null,
            };
          }
        }
      } else if (p.status === AsaasPaymentStatus.REFUNDED) {
        statusCounts.refunded += 1;
      } else if (p.status === AsaasPaymentStatus.DELETED || p.status === AsaasPaymentStatus.CANCELLED) {
        statusCounts.cancelled += 1;
      }
    }

    // 2. Séries Temporais
    // A) Recebidos reais nos últimos 6 meses (baseado estritamente na data de pagamento liquidada)
    const monthsNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const recebidosMap = new Map<string, { label: string; value: number; count: number }>();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${monthsNames[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
      recebidosMap.set(key, { label, value: 0, count: 0 });
    }

    for (const p of allPayments) {
      const isPaid = p.status === AsaasPaymentStatus.RECEIVED || p.status === AsaasPaymentStatus.CONFIRMED;
      if (isPaid) {
        const pDate = p.paymentDate || p.clientPaymentDate || p.updatedAt;
        if (pDate) {
          const key = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}`;
          if (recebidosMap.has(key)) {
            const entry = recebidosMap.get(key)!;
            entry.value += Number(p.value);
            entry.count += 1;
          }
        }
      }
    }

    const recebidosTimeSeries: TimeSeriesPoint[] = Array.from(recebidosMap.entries()).map(([month, data]) => ({
      month,
      label: data.label,
      value: data.value,
      count: data.count,
    }));

    // B) Previstos por vencimento para os próximos 6 meses (baseado estritamente em cobranças pendentes)
    const previstosMap = new Map<string, { label: string; value: number; count: number }>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(currentYear, currentMonth + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${monthsNames[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`;
      previstosMap.set(key, { label, value: 0, count: 0 });
    }

    for (const p of allPayments) {
      const isPaid = p.status === AsaasPaymentStatus.RECEIVED || p.status === AsaasPaymentStatus.CONFIRMED;
      if (!isPaid && p.status === AsaasPaymentStatus.PENDING) {
        const key = `${p.dueDate.getFullYear()}-${String(p.dueDate.getMonth() + 1).padStart(2, '0')}`;
        if (previstosMap.has(key)) {
          const entry = previstosMap.get(key)!;
          entry.value += Number(p.value);
          entry.count += 1;
        }
      }
    }

    const previstosTimeSeries: TimeSeriesPoint[] = Array.from(previstosMap.entries()).map(([month, data]) => ({
      month,
      label: data.label,
      value: data.value,
      count: data.count,
    }));

    // 3. Montagem do filtro para a lista paginada de cobranças
    const listWhere: any = {
      organizationId,
      ...(clientId ? { clientId } : {}),
    };

    // Filtro por status
    if (status && status !== 'ALL') {
      const upperStatus = status.toUpperCase();
      if (upperStatus === 'OVERDUE') {
        listWhere.OR = [
          { status: AsaasPaymentStatus.OVERDUE },
          {
            status: AsaasPaymentStatus.PENDING,
            dueDate: { lt: now },
          },
        ];
      } else if (upperStatus === 'PENDING') {
        listWhere.status = AsaasPaymentStatus.PENDING;
        listWhere.dueDate = { gte: now };
      } else if (upperStatus === 'RECEIVED' || upperStatus === 'CONFIRMED') {
        listWhere.status = { in: [AsaasPaymentStatus.RECEIVED, AsaasPaymentStatus.CONFIRMED] };
      } else {
        listWhere.status = mapAsaasPaymentStatus(upperStatus);
      }
    }

    // Filtro por período de data
    if (period === 'current-month') {
      const start = new Date(currentYear, currentMonth, 1);
      const end = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
      listWhere.dueDate = { gte: start, lte: end };
    } else if (period === 'last-month') {
      const start = new Date(currentYear, currentMonth - 1, 1);
      const end = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);
      listWhere.dueDate = { gte: start, lte: end };
    } else if (period === 'current-year') {
      const start = new Date(currentYear, 0, 1);
      const end = new Date(currentYear, 11, 31, 23, 59, 59, 999);
      listWhere.dueDate = { gte: start, lte: end };
    } else if (period === 'custom' && startDate && endDate) {
      listWhere.dueDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Busca textual por descrição ou nome do cliente
    if (search && search.trim()) {
      const searchTerms = search.trim();
      const searchCondition = [
        { description: { contains: searchTerms, mode: 'insensitive' } },
        { client: { name: { contains: searchTerms, mode: 'insensitive' } } },
      ];
      if (listWhere.OR) {
        listWhere.AND = [{ OR: listWhere.OR }, { OR: searchCondition }];
        delete listWhere.OR;
      } else {
        listWhere.OR = searchCondition;
      }
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [totalCount, pagedPayments] = await Promise.all([
      this.prismaClient.asaasPayment.count({ where: listWhere }),
      this.prismaClient.asaasPayment.findMany({
        where: listWhere,
        include: {
          client: {
            select: { id: true, name: true },
          },
        },
        orderBy: { dueDate: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    const formattedPayments: FinancialOverviewPaymentItem[] = pagedPayments.map((p) => {
      const numValue = Number(p.value);
      const isPaid = p.status === AsaasPaymentStatus.RECEIVED || p.status === AsaasPaymentStatus.CONFIRMED;
      const isOverdue = !isPaid && (p.status === AsaasPaymentStatus.OVERDUE || p.dueDate < now);

      return {
        id: p.id,
        externalId: p.externalId,
        description: p.description || 'Cobrança Asaas',
        value: numValue,
        netValue: p.netValue ? Number(p.netValue) : null,
        billingType: p.billingType,
        status: p.status,
        statusLabel: getAsaasStatusLabel(p.status),
        dueDate: p.dueDate.toISOString(),
        paymentDate: p.paymentDate ? p.paymentDate.toISOString() : null,
        invoiceUrl: p.invoiceUrl,
        bankSlipUrl: p.bankSlipUrl,
        isOverdue,
        client: p.client ? { id: p.client.id, name: p.client.name } : null,
      };
    });

    const totalClientsCount = await this.prismaClient.client.count({
      where: { organizationId },
    });
    const clientsWithPaymentsCount = new Set(allPayments.map((p) => p.clientId).filter(Boolean)).size;
    const hasUnsyncedData = totalClientsCount > clientsWithPaymentsCount;

    return {
      kpis: {
        receivedMonth,
        receivedMonthCount,
        pending,
        pendingCount,
        overdue,
        overdueCount,
        nextDueDate: nextDueDateItem,
        statusCounts,
      },
      recebidosTimeSeries,
      previstosTimeSeries,
      payments: formattedPayments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
      hasUnsyncedData,
      disclaimer: 'Os dados são atualizados pela sincronização por cliente e pelos eventos do Asaas.',
    };
  }
}

