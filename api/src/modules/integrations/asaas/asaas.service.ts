import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { AsaasClient, AsaasIntegrationError, AsaasPaymentRaw } from './asaas.client.js';
import { AsaasPaymentStatus } from '@prisma/client';

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

export interface AsaasSyncResult {
  success: boolean;
  syncedCustomers: number;
  linkedClients: number;
  unlinkedCustomers: number;
  syncedPayments: number;
  timestamp: string;
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
   * Sincronização manual segura (Modo Somente Leitura).
   * Consulta clientes e cobranças no Asaas e atualiza a base local.
   * Não dispara requisições de escrita ao Asaas.
   */
  async syncAsaasData(organizationId: string): Promise<AsaasSyncResult> {
    if (!organizationId) {
      throw new AsaasIntegrationError('Organização é obrigatória para sincronização', 400, 'ORG_REQUIRED');
    }

    // 1. Busca todos os clientes da organização no Hub para cruzamento por CPF/CNPJ
    const hubClients = await this.prismaClient.client.findMany({
      where: { organizationId },
      select: { id: true, document: true, name: true },
    });

    // Mapeia clientes por documento higienizado
    const clientsByDoc = new Map<string, string>();
    for (const c of hubClients) {
      const cleanDoc = sanitizeDocument(c.document);
      if (cleanDoc && (cleanDoc.length === 11 || cleanDoc.length === 14)) {
        clientsByDoc.set(cleanDoc, c.id);
      }
    }

    // 2. Consulta clientes no Asaas (paginação inicial)
    const asaasCustomersRes = await this.client.getCustomers({ limit: 100 });
    const asaasCustomers = asaasCustomersRes.data || [];

    let linkedClients = 0;
    let unlinkedCustomers = 0;
    const customerToClientMap = new Map<string, string>();

    // Vínculos existentes prévios
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

    // Tenta vincular clientes do Asaas aos clientes do Hub pelo CPF/CNPJ
    for (const ac of asaasCustomers) {
      const cleanDoc = sanitizeDocument(ac.cpfCnpj);
      let matchedClientId = cleanDoc ? clientsByDoc.get(cleanDoc) : undefined;

      if (matchedClientId) {
        customerToClientMap.set(ac.id, matchedClientId);
        // Garante o vínculo em clientIntegration
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

    // 3. Consulta cobranças no Asaas
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
   * Processamento idempotente de notificações de Webhook do Asaas.
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
      // Evento não relevante para cobranças nesta etapa, responde 200 para liberar o Asaas
      return { processed: false };
    }

    const payment: AsaasPaymentRaw = payload.payment;
    if (!payment || !payment.id) {
      return { processed: false };
    }

    // 2. Garantia de Idempotência: verifica se o evento já foi processado
    const eventId = String(payload.id || `${event}_${payment.id}_${payment.dateCreated || Date.now()}`);

    const existingEvent = await this.prismaClient.asaasWebhookEvent.findUnique({
      where: { eventId },
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

    // Se já tiver uma organização identificada pelo vínculo ou cobrança prévia
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

    // Se ainda não houver organização (ex: primeira organização ativa do sistema como fallback)
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

    // Registra o evento de webhook para garantir idempotência em retransmissões futuras
    await this.prismaClient.asaasWebhookEvent.create({
      data: {
        eventId,
        event,
        paymentExternalId: payment.id,
        payload: payload,
      },
    });

    return { processed: true };
  }
}
