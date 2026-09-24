import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import {
  PrismaClient,
  Prisma,
  IntegrationProvider,
  SyncRunStatus,
  WebhookEventStatus,
} from '@prisma/client';

export class IntegrationObservabilityError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'OBSERVABILITY_ERROR') {
    super(message);
    this.name = 'IntegrationObservabilityError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, IntegrationObservabilityError.prototype);
  }
}

const PROHIBITED_KEYS = new Set([
  'credential',
  'credentialciphertext',
  'apikey',
  'token',
  'secret',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'password',
  'clientsecret',
]);

/**
 * Sanitiza recursivamente chaves sensíveis em metadados/payloads substituindo por [REDACTED].
 */
export function sanitizeMetadata(obj: unknown): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeMetadata(item));
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (PROHIBITED_KEYS.has(normalizedKey)) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      result[key] = sanitizeMetadata(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Valida recursivamente se algum objeto de metadata/payload possui chaves sensíveis.
 */
function sanitizeOrValidateMetadata(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => sanitizeOrValidateMetadata(item, `${path}[${idx}]`));
    return;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (PROHIBITED_KEYS.has(normalizedKey)) {
      throw new IntegrationObservabilityError(
        `O campo de metadata '${path ? `${path}.${key}` : key}' não pode armazenar segredos ou credenciais.`,
        400,
        'PROHIBITED_METADATA_KEY'
      );
    }
    sanitizeOrValidateMetadata(value, path ? `${path}.${key}` : key);
  }
}

export interface StartSyncRunInput {
  organizationId: string;
  clientId?: string | null;
  connectionId?: string | null;
  provider: IntegrationProvider;
  operation: string;
  metadata?: Record<string, any>;
}

export interface FinishSyncRunInput {
  status: SyncRunStatus;
  itemsProcessed?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
  errorSummary?: string | null;
  metadata?: Record<string, any>;
}

export interface RecordIntegrationErrorInput {
  organizationId: string;
  clientId?: string | null;
  connectionId?: string | null;
  provider: IntegrationProvider;
  operation: string;
  code?: string | null;
  message: string;
  retryable?: boolean;
  metadata?: Record<string, any>;
}

export interface RecordWebhookEventInput {
  organizationId: string;
  connectionId?: string | null;
  provider: IntegrationProvider;
  externalEventId?: string | null;
  dedupeKey: string;
  eventType: string;
  payload?: Record<string, any>;
}

export interface ListSyncRunsFilters {
  clientId?: string;
  connectionId?: string;
  provider?: IntegrationProvider;
  status?: SyncRunStatus;
  limit?: number;
  offset?: number;
}

export interface ListErrorsFilters {
  clientId?: string;
  connectionId?: string;
  provider?: IntegrationProvider;
  resolved?: boolean;
  limit?: number;
  offset?: number;
}

export class IntegrationObservabilityService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma as any) {}

  /**
   * Inicia um registro de execução de sincronização (SyncRun).
   */
  async startSyncRun(input: StartSyncRunInput) {
    if (!input.organizationId || !input.organizationId.trim()) {
      throw new IntegrationObservabilityError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.provider) {
      throw new IntegrationObservabilityError('provider é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.operation || !input.operation.trim()) {
      throw new IntegrationObservabilityError('operation é obrigatório.', 400, 'INVALID_INPUT');
    }

    if (input.metadata) {
      sanitizeOrValidateMetadata(input.metadata);
    }

    return this.prisma.syncRun.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId || null,
        connectionId: input.connectionId || null,
        provider: input.provider,
        operation: input.operation.trim(),
        status: 'RUNNING',
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  /**
   * Conclui um SyncRun atualizando status, contagens e sumário de erros.
   */
  async finishSyncRun(syncRunId: string, input: FinishSyncRunInput) {
    if (!syncRunId || !syncRunId.trim()) {
      throw new IntegrationObservabilityError('syncRunId é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.status) {
      throw new IntegrationObservabilityError('status é obrigatório.', 400, 'INVALID_INPUT');
    }

    if (input.metadata) {
      sanitizeOrValidateMetadata(input.metadata);
    }

    return this.prisma.syncRun.update({
      where: { id: syncRunId },
      data: {
        status: input.status,
        finishedAt: new Date(),
        itemsProcessed: input.itemsProcessed ?? 0,
        itemsSucceeded: input.itemsSucceeded ?? 0,
        itemsFailed: input.itemsFailed ?? 0,
        errorSummary: input.errorSummary ? input.errorSummary.trim() : null,
        ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /**
   * Registra um erro de integração operacional com contexto multi-tenant.
   */
  async recordError(input: RecordIntegrationErrorInput) {
    if (!input.organizationId || !input.organizationId.trim()) {
      throw new IntegrationObservabilityError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.provider) {
      throw new IntegrationObservabilityError('provider é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.operation || !input.operation.trim()) {
      throw new IntegrationObservabilityError('operation é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.message || !input.message.trim()) {
      throw new IntegrationObservabilityError('message é obrigatória.', 400, 'INVALID_INPUT');
    }

    if (input.metadata) {
      sanitizeOrValidateMetadata(input.metadata);
    }

    return this.prisma.integrationError.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId || null,
        connectionId: input.connectionId || null,
        provider: input.provider,
        operation: input.operation.trim(),
        code: input.code ? input.code.trim() : null,
        message: input.message.trim(),
        retryable: input.retryable ?? false,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  /**
   * Marca um erro de integração como resolvido.
   */
  async resolveError(organizationId: string, errorId: string) {
    if (!organizationId || !errorId) {
      throw new IntegrationObservabilityError('Parâmetros inválidos.', 400, 'INVALID_INPUT');
    }

    const err = await this.prisma.integrationError.findFirst({
      where: { id: errorId, organizationId },
    });

    if (!err) {
      throw new IntegrationObservabilityError('Erro de integração não encontrado.', 404, 'ERROR_NOT_FOUND');
    }

    return this.prisma.integrationError.update({
      where: { id: errorId },
      data: {
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Registra um evento de webhook com verificação de deduplicação (dedupeKey).
   */
  async recordWebhookEvent(input: RecordWebhookEventInput): Promise<{ event: any; isDuplicate: boolean }> {
    if (!input.organizationId || !input.organizationId.trim()) {
      throw new IntegrationObservabilityError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.provider) {
      throw new IntegrationObservabilityError('provider é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.dedupeKey || !input.dedupeKey.trim()) {
      throw new IntegrationObservabilityError('dedupeKey é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.eventType || !input.eventType.trim()) {
      throw new IntegrationObservabilityError('eventType é obrigatório.', 400, 'INVALID_INPUT');
    }

    if (input.payload) {
      sanitizeOrValidateMetadata(input.payload);
    }

    const existing = await this.prisma.webhookEvent.findUnique({
      where: { dedupeKey: input.dedupeKey.trim() },
    });

    if (existing) {
      return { event: existing, isDuplicate: true };
    }

    const created = await this.prisma.webhookEvent.create({
      data: {
        organizationId: input.organizationId,
        connectionId: input.connectionId || null,
        provider: input.provider,
        externalEventId: input.externalEventId ? input.externalEventId.trim() : null,
        dedupeKey: input.dedupeKey.trim(),
        eventType: input.eventType.trim(),
        status: 'RECEIVED',
        payload: input.payload ? (input.payload as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    return { event: created, isDuplicate: false };
  }

  /**
   * Atualiza status de processamento do webhook.
   */
  async updateWebhookStatus(
    webhookEventId: string,
    status: WebhookEventStatus,
    errorMessage?: string | null
  ) {
    return this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status,
        processedAt: new Date(),
        errorMessage: errorMessage ? errorMessage.trim() : null,
      },
    });
  }

  /**
   * Lista SyncRuns de uma organização com filtros e paginação.
   */
  async listSyncRuns(organizationId: string, filters?: ListSyncRunsFilters) {
    if (!organizationId) {
      throw new IntegrationObservabilityError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }

    const limit = Math.min(filters?.limit || 50, 100);
    const offset = filters?.offset || 0;

    return this.prisma.syncRun.findMany({
      where: {
        organizationId,
        ...(filters?.clientId ? { clientId: filters.clientId } : {}),
        ...(filters?.connectionId ? { connectionId: filters.connectionId } : {}),
        ...(filters?.provider ? { provider: filters.provider } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Lista erros operacionais de integração da organização.
   */
  async listErrors(organizationId: string, filters?: ListErrorsFilters) {
    if (!organizationId) {
      throw new IntegrationObservabilityError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }

    const limit = Math.min(filters?.limit || 50, 100);
    const offset = filters?.offset || 0;

    return this.prisma.integrationError.findMany({
      where: {
        organizationId,
        ...(filters?.clientId ? { clientId: filters.clientId } : {}),
        ...(filters?.connectionId ? { connectionId: filters.connectionId } : {}),
        ...(filters?.provider ? { provider: filters.provider } : {}),
        ...(filters?.resolved === true ? { resolvedAt: { not: null } } : {}),
        ...(filters?.resolved === false ? { resolvedAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}

export const integrationObservabilityService = new IntegrationObservabilityService();
