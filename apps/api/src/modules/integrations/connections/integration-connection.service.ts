import { prisma as defaultPrisma } from '../../../lib/prisma.js';
import { PrismaClient, Prisma, IntegrationProvider, IntegrationAuthType, IntegrationConnectionStatus } from '@prisma/client';
import { encryptIntegrationCredential, decryptIntegrationCredential } from '../../../lib/crypto.js';
import { AuditService, auditService as defaultAuditService } from '../../audit/audit.service.js';

export class IntegrationConnectionError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'INTEGRATION_CONNECTION_ERROR') {
    super(message);
    this.name = 'IntegrationConnectionError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, IntegrationConnectionError.prototype);
  }
}

export interface IntegrationConnectionDTO {
  id: string;
  organizationId: string;
  clientId: string | null;
  provider: IntegrationProvider;
  authType: IntegrationAuthType;
  externalScopeId: string | null;
  displayName: string | null;
  status: IntegrationConnectionStatus;
  metadata: any | null;
  lastValidatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  hasCredential: boolean;
}

export interface CreateClientConnectionInput {
  organizationId: string;
  clientId: string;
  provider: IntegrationProvider;
  authType: IntegrationAuthType;
  externalScopeId: string;
  displayName?: string;
  credential: string;
  metadata?: Record<string, any>;
}

export interface ListConnectionsFilters {
  clientId?: string;
  provider?: IntegrationProvider;
  status?: IntegrationConnectionStatus;
}

const PROHIBITED_METADATA_KEYS_SET = new Set([
  'credential',
  'credentialciphertext',
  'apikey',
  'token',
  'secret',
  'accesstoken',
  'refreshtoken',
  'authorization',
]);

/**
 * Valida recursivamente se algum objeto de metadata possui chaves sensíveis/segredos.
 */
function validateMetadataObject(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => validateMetadataObject(item, `${path}[${idx}]`));
    return;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (PROHIBITED_METADATA_KEYS_SET.has(normalizedKey)) {
      throw new IntegrationConnectionError(
        `O campo de metadata '${path ? `${path}.${key}` : key}' não pode armazenar segredos ou credenciais.`,
        400,
        'PROHIBITED_METADATA_KEY'
      );
    }
    validateMetadataObject(value, path ? `${path}.${key}` : key);
  }
}

export class IntegrationConnectionService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma as any,
    private readonly audit: AuditService = defaultAuditService
  ) {}

  private mapToDTO(conn: any): IntegrationConnectionDTO {
    const { credentialCiphertext, ...rest } = conn;
    return {
      ...rest,
      hasCredential: Boolean(credentialCiphertext && credentialCiphertext.length > 0),
    };
  }

  /**
   * Cria uma nova conexão client-scoped segura no Hub Zafira.
   */
  async createClientConnection(input: CreateClientConnectionInput): Promise<IntegrationConnectionDTO> {
    if (!input.organizationId || !input.organizationId.trim()) {
      throw new IntegrationConnectionError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.clientId || !input.clientId.trim()) {
      throw new IntegrationConnectionError('clientId é obrigatório para conexões de cliente.', 400, 'INVALID_INPUT');
    }
    if (!input.provider) {
      throw new IntegrationConnectionError('provider é obrigatório.', 400, 'INVALID_INPUT');
    }
    if (!input.externalScopeId || !input.externalScopeId.trim()) {
      throw new IntegrationConnectionError('externalScopeId é obrigatório para conexões de cliente.', 400, 'INVALID_INPUT');
    }
    if (!input.credential || !input.credential.trim()) {
      throw new IntegrationConnectionError('credential não pode ser vazia.', 400, 'INVALID_INPUT');
    }

    if (input.metadata) {
      validateMetadataObject(input.metadata);
    }

    // 1. Valida se o cliente existe e pertence ESTRITAMENTE à organização informada
    const client = await this.prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, organizationId: true },
    });

    if (!client || client.organizationId !== input.organizationId) {
      throw new IntegrationConnectionError('Cliente não encontrado na organização.', 404, 'CLIENT_NOT_FOUND');
    }

    // 2. Valida se o client já possui uma conexão com o mesmo provider
    const existingClientConnection = await this.prisma.integrationConnection.findFirst({
      where: {
        clientId: input.clientId,
        provider: input.provider,
      },
    });

    if (existingClientConnection) {
      throw new IntegrationConnectionError(
        `Já existe uma conexão do provedor ${input.provider} para este cliente.`,
        409,
        'DUPLICATE_CLIENT_CONNECTION'
      );
    }

    // 3. Valida se o escopo remoto (workspace) já está registrado para este provider na organização
    const existingScope = await this.prisma.integrationConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        provider: input.provider,
        externalScopeId: input.externalScopeId.trim(),
      },
    });

    if (existingScope) {
      throw new IntegrationConnectionError(
        `O escopo remoto informado já está registrado nesta organização.`,
        409,
        'DUPLICATE_REMOTE_SCOPE'
      );
    }

    // 4. Criptografa o segredo no modo ESTRITO
    const credentialCiphertext = encryptIntegrationCredential(input.credential.trim());

    // 5. Executa a criação e auditoria de forma ATÔMICA
    const created = await this.prisma.$transaction(async (tx) => {
      const conn = await tx.integrationConnection.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          provider: input.provider,
          authType: input.authType,
          externalScopeId: input.externalScopeId.trim(),
          displayName: input.displayName ? input.displayName.trim() : null,
          credentialCiphertext,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
          status: 'ACTIVE',
        },
      });

      const auditServiceTx = new AuditService(tx as any);
      await auditServiceTx.record({
        organizationId: input.organizationId,
        action: 'integration.connection_created',
        entityType: 'IntegrationConnection',
        entityId: conn.id,
        metadata: {
          provider: conn.provider,
          clientId: conn.clientId,
          externalScopeId: conn.externalScopeId,
          displayName: conn.displayName,
          authType: conn.authType,
          status: conn.status,
        },
      });

      return conn;
    });

    return this.mapToDTO(created);
  }

  /**
   * Obtém os detalhes seguros de uma conexão garantindo o escopo de organização.
   */
  async getConnection(organizationId: string, connectionId: string): Promise<IntegrationConnectionDTO> {
    if (!organizationId || !connectionId) {
      throw new IntegrationConnectionError('Parâmetros inválidos.', 400, 'INVALID_INPUT');
    }

    const conn = await this.prisma.integrationConnection.findFirst({
      where: {
        id: connectionId,
        organizationId,
      },
    });

    if (!conn) {
      throw new IntegrationConnectionError('Conexão de integração não encontrada.', 404, 'CONNECTION_NOT_FOUND');
    }

    return this.mapToDTO(conn);
  }

  /**
   * Lista as conexões de integração escopadas pela organização.
   */
  async listConnections(organizationId: string, filters?: ListConnectionsFilters): Promise<IntegrationConnectionDTO[]> {
    if (!organizationId) {
      throw new IntegrationConnectionError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }

    const items = await this.prisma.integrationConnection.findMany({
      where: {
        organizationId,
        ...(filters?.clientId ? { clientId: filters.clientId } : {}),
        ...(filters?.provider ? { provider: filters.provider } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => this.mapToDTO(item));
  }

  /**
   * Obtém a conexão ativa de um cliente para determinado provedor.
   */
  async getActiveConnectionForClient(
    organizationId: string,
    clientId: string,
    provider: IntegrationProvider
  ): Promise<IntegrationConnectionDTO | null> {
    if (!organizationId || !clientId || !provider) {
      throw new IntegrationConnectionError('Parâmetros inválidos.', 400, 'INVALID_INPUT');
    }

    // Valida tenant do cliente
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { organizationId: true },
    });

    if (!client || client.organizationId !== organizationId) {
      return null;
    }

    const conn = await this.prisma.integrationConnection.findFirst({
      where: {
        organizationId,
        clientId,
        provider,
        status: 'ACTIVE',
      },
    });

    return conn ? this.mapToDTO(conn) : null;
  }

  /**
   * Rotaciona a credencial de uma conexão recriptografando com novo IV.
   */
  async rotateCredential(organizationId: string, connectionId: string, newCredential: string): Promise<IntegrationConnectionDTO> {
    if (!organizationId || !connectionId) {
      throw new IntegrationConnectionError('Parâmetros inválidos.', 400, 'INVALID_INPUT');
    }
    if (!newCredential || !newCredential.trim()) {
      throw new IntegrationConnectionError('Nova credencial não pode ser vazia.', 400, 'INVALID_INPUT');
    }

    const conn = await this.prisma.integrationConnection.findFirst({
      where: { id: connectionId, organizationId },
    });

    if (!conn) {
      throw new IntegrationConnectionError('Conexão não encontrada na organização.', 404, 'CONNECTION_NOT_FOUND');
    }

    const newCiphertext = encryptIntegrationCredential(newCredential.trim());

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.integrationConnection.update({
        where: { id: connectionId },
        data: {
          credentialCiphertext: newCiphertext,
          updatedAt: new Date(),
        },
      });

      const auditTx = new AuditService(tx as any);
      await auditTx.record({
        organizationId,
        action: 'integration.credential_rotated',
        entityType: 'IntegrationConnection',
        entityId: connectionId,
        metadata: {
          provider: conn.provider,
          clientId: conn.clientId,
          externalScopeId: conn.externalScopeId,
        },
      });

      return res;
    });

    return this.mapToDTO(updated);
  }

  /**
   * Método de consumo estrito INTERNO do backend para descriptografar o segredo.
   * NUNCA exposto em APIs públicas ou contratos compartilhados.
   */
  async resolveCredential(organizationId: string, connectionId: string): Promise<string> {
    if (!organizationId || !connectionId) {
      throw new IntegrationConnectionError('Parâmetros inválidos.', 400, 'INVALID_INPUT');
    }

    const conn = await this.prisma.integrationConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { credentialCiphertext: true },
    });

    if (!conn || !conn.credentialCiphertext) {
      throw new IntegrationConnectionError('Conexão ou credencial não encontrada.', 404, 'CONNECTION_NOT_FOUND');
    }

    return decryptIntegrationCredential(conn.credentialCiphertext);
  }

  /**
   * Desconecta uma conexão alterando o status para DISCONNECTED.
   */
  async disconnectConnection(organizationId: string, connectionId: string): Promise<IntegrationConnectionDTO> {
    if (!organizationId || !connectionId) {
      throw new IntegrationConnectionError('Parâmetros inválidos.', 400, 'INVALID_INPUT');
    }

    const conn = await this.prisma.integrationConnection.findFirst({
      where: { id: connectionId, organizationId },
    });

    if (!conn) {
      throw new IntegrationConnectionError('Conexão não encontrada na organização.', 404, 'CONNECTION_NOT_FOUND');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.integrationConnection.update({
        where: { id: connectionId },
        data: {
          status: 'DISCONNECTED',
        },
      });

      const auditTx = new AuditService(tx as any);
      await auditTx.record({
        organizationId,
        action: 'integration.connection_disconnected',
        entityType: 'IntegrationConnection',
        entityId: connectionId,
        metadata: {
          provider: conn.provider,
          clientId: conn.clientId,
        },
      });

      return res;
    });

    return this.mapToDTO(updated);
  }

  /**
   * Cria ou atualiza uma conexão (org-level ou client-level) de forma atômica e criptografada.
   */
  async upsertConnection(input: {
    organizationId: string;
    clientId?: string | null;
    provider: IntegrationProvider;
    authType?: IntegrationAuthType;
    externalAccountId?: string | null;
    displayName?: string | null;
    rawCredential: any;
    status?: IntegrationConnectionStatus;
    metadata?: Record<string, any>;
  }): Promise<IntegrationConnectionDTO> {
    const { organizationId, clientId = null, provider, authType = 'OAUTH2', externalAccountId = null, displayName = null, rawCredential, status = 'ACTIVE', metadata } = input;

    if (!organizationId) {
      throw new IntegrationConnectionError('organizationId é obrigatório.', 400, 'INVALID_INPUT');
    }

    if (metadata) {
      validateMetadataObject(metadata);
    }

    const credString = typeof rawCredential === 'string' ? rawCredential : JSON.stringify(rawCredential);
    const credentialCiphertext = encryptIntegrationCredential(credString);

    const existing = await this.prisma.integrationConnection.findFirst({
      where: {
        organizationId,
        provider,
        clientId: clientId || null,
      },
    });

    let result;
    if (existing) {
      result = await this.prisma.integrationConnection.update({
        where: { id: existing.id },
        data: {
          authType,
          credentialCiphertext,
          externalScopeId: externalAccountId || existing.externalScopeId,
          displayName: displayName || existing.displayName,
          status,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : (existing.metadata ?? Prisma.JsonNull),
          lastValidatedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } else {
      result = await this.prisma.integrationConnection.create({
        data: {
          organizationId,
          clientId: clientId || null,
          provider,
          authType,
          credentialCiphertext,
          externalScopeId: externalAccountId,
          displayName,
          status,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
          lastValidatedAt: new Date(),
        },
      });
    }

    return this.mapToDTO(result);
  }

  /**
   * Helper para descriptografar credencial estruturada.
   */
  getDecryptedCredential<T = any>(connection: { credentialCiphertext?: string | null }): T | null {
    if (!connection.credentialCiphertext) return null;
    try {
      const plain = decryptIntegrationCredential(connection.credentialCiphertext);
      if (plain.startsWith('{') && plain.endsWith('}')) {
        return JSON.parse(plain) as T;
      }
      return plain as unknown as T;
    } catch {
      return null;
    }
  }
}

export const integrationConnectionService = new IntegrationConnectionService();

