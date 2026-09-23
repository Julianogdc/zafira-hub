import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { PrismaClient, Prisma } from '@prisma/client';

const SENSITIVE_KEYS_SET = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'xapikey',
  'secret',
  'cookie',
  'authorization',
  'clientsecret',
  'jwt',
  'privatekey',
  'credential',
  'credentialciphertext',
  'integrationcredential',
]);

/**
 * Sanitiza recursivamente objetos, arrays e valores para armazenamento seguro em AuditLog.
 * Substitui qualquer campo de credencial/segredo por "[REDACTED]".
 */
export function sanitizeAuditPayload(data: unknown, seen = new WeakSet()): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  // Prevenção contra estruturas circulares
  if (seen.has(data as object)) {
    return '[CIRCULAR]';
  }
  seen.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => (item === undefined ? null : sanitizeAuditPayload(item, seen)));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS_SET.has(normalizedKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeAuditPayload(value, seen);
    }
  }

  return sanitized;
}

export interface AuditEventInput {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  requestId?: string | null;
}

export interface ListAuditLogsParams {
  organizationId: string;
  limit?: number;
  cursor?: string;
  action?: string;
  entityType?: string;
  actorUserId?: string;
}

export class AuditService {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma) {}

  /**
   * Grava um novo evento no AuditLog (Append-Only).
   */
  async record(event: AuditEventInput) {
    if (!event.organizationId) {
      throw new Error('organizationId é obrigatório para registrar AuditLog');
    }
    if (!event.action) {
      throw new Error('action é obrigatória para registrar AuditLog');
    }
    if (!event.entityType) {
      throw new Error('entityType é obrigatório para registrar AuditLog');
    }

    const sanitizedBefore = event.before !== undefined ? (sanitizeAuditPayload(event.before) as Prisma.InputJsonValue) : Prisma.JsonNull;
    const sanitizedAfter = event.after !== undefined ? (sanitizeAuditPayload(event.after) as Prisma.InputJsonValue) : Prisma.JsonNull;
    const sanitizedMetadata = event.metadata !== undefined ? (sanitizeAuditPayload(event.metadata) as Prisma.InputJsonValue) : Prisma.JsonNull;

    return (this.prisma as any).auditLog.create({
      data: {
        organizationId: event.organizationId,
        actorUserId: event.actorUserId || null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId || null,
        before: sanitizedBefore,
        after: sanitizedAfter,
        metadata: sanitizedMetadata,
        requestId: event.requestId || null,
      },
    });
  }

  /**
   * Consulta os logs de auditoria escopados rigorosamente pela organização autorizada.
   */
  async list({
    organizationId,
    limit = 50,
    cursor,
    action,
    entityType,
    actorUserId,
  }: ListAuditLogsParams) {
    if (!organizationId) {
      throw new Error('organizationId é obrigatório para consultar AuditLog');
    }

    // Limit clamp: min 1, default 50, max 100
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));

    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(actorUserId ? { actorUserId } : {}),
    };

    const items = await (this.prisma as any).auditLog.findMany({
      where,
      take: safeLimit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      include: {
        actorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    let nextCursor: string | null = null;
    if (items.length > safeLimit) {
      items.pop(); // Remove o item extra
      nextCursor = items.length > 0 ? items[items.length - 1].id : null; // ID do último item retornado
    }

    return {
      items,
      nextCursor,
      totalReturned: items.length,
    };
  }
}

export const auditService = new AuditService();
