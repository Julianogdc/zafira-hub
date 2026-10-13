import { IntegrationProvider } from '@prisma/client';

export interface IntegrationContext {
  organizationId: string;
  userId?: string | null;
  clientId?: string | null;
  connectionId?: string | null;
  externalScopeId?: string | null;
}

export interface IntegrationCapabilities {
  canTestConnection: boolean;
  canSync: boolean;
  canReconnect: boolean;
  canDisconnect: boolean;
}

export interface TestConnectionResult {
  connected: boolean;
  provider: IntegrationProvider;
  externalScopeId?: string | null;
  accountName?: string | null;
  message?: string;
  checkedAt: string | Date;
  details?: Record<string, any>;
}

export interface SyncOptions {
  fullSync?: boolean;
  resourceTypes?: string[];
  since?: Date | string;
  metadata?: Record<string, any>;
}

export interface SyncResult {
  syncRunId?: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  errorSummary?: string | null;
  finishedAt: string | Date;
}

export interface ReconnectResult {
  reconnected: boolean;
  authUrl?: string | null;
  message?: string;
}

export interface DisconnectResult {
  disconnected: boolean;
  message?: string;
}

/**
 * Contrato canônico para operações comuns em provedores de integração.
 * O design usa composição e capacidades explícitas (capabilities),
 * permitindo que providers implementem apenas as ações que façam sentido técnico.
 */
export interface CommonIntegrationConnector {
  readonly provider: IntegrationProvider;

  getCapabilities(): IntegrationCapabilities;

  testConnection?(ctx: IntegrationContext): Promise<TestConnectionResult>;

  sync?(ctx: IntegrationContext, options?: SyncOptions): Promise<SyncResult>;

  reconnect?(ctx: IntegrationContext, payload?: any): Promise<ReconnectResult>;

  disconnect?(ctx: IntegrationContext): Promise<DisconnectResult>;
}
