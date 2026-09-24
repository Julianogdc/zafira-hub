import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IntegrationObservabilityService, sanitizeMetadata } from '../integration-observability.service.js';

describe('Integration Observability Service & Sanitization (Passo 2C1)', () => {
  let observability: IntegrationObservabilityService;
  let mockPrisma: any;
  let createdSyncRuns: any[];
  let updatedSyncRuns: any[];
  let createdErrors: any[];
  let updatedErrors: any[];
  let createdEvents: any[];

  beforeEach(() => {
    createdSyncRuns = [];
    updatedSyncRuns = [];
    createdErrors = [];
    updatedErrors = [];
    createdEvents = [];

    mockPrisma = {
      syncRun: {
        create: async (args: any) => {
          const run = { id: `sync-${Date.now()}-${Math.random()}`, ...args.data, createdAt: new Date() };
          createdSyncRuns.push(run);
          return run;
        },
        update: async (args: any) => {
          updatedSyncRuns.push(args);
          return { id: args.where.id, ...args.data };
        },
        findMany: async (args: any) => {
          return createdSyncRuns.filter((r) => r.organizationId === args.where.organizationId);
        },
      },
      integrationError: {
        create: async (args: any) => {
          const err = { id: `err-${Date.now()}-${Math.random()}`, ...args.data, createdAt: new Date() };
          createdErrors.push(err);
          return err;
        },
        findFirst: async (args: any) => {
          return createdErrors.find((e) => e.id === args.where.id && (!args.where.organizationId || e.organizationId === args.where.organizationId)) || null;
        },
        update: async (args: any) => {
          updatedErrors.push(args);
          return { id: args.where.id, ...args.data };
        },
        findMany: async (args: any) => {
          return createdErrors.filter((e) => e.organizationId === args.where.organizationId);
        },
      },
      webhookEvent: {
        findUnique: async (args: any) => {
          const dedupeKey = args.where.dedupeKey;
          return createdEvents.find((e) => e.dedupeKey === dedupeKey) || null;
        },
        create: async (args: any) => {
          const ev = { id: `ev-${Date.now()}-${Math.random()}`, ...args.data, receivedAt: new Date() };
          createdEvents.push(ev);
          return ev;
        },
        update: async (args: any) => {
          const ev = createdEvents.find((e) => e.id === args.where.id);
          if (ev) Object.assign(ev, args.data);
          return ev;
        },
      },
    };

    observability = new IntegrationObservabilityService(mockPrisma);
  });

  describe('Sanitização de Segurança', () => {
    it('deve remover chaves sensíveis de metadados e payloads', () => {
      const sensitive = {
        token: 'secret-token-123',
        access_token: 'bearer-abc',
        refresh_token: 'refresh-xyz',
        client_secret: 'sec-999',
        password: 'my-password',
        credentialCiphertext: 'encrypted-blob',
        validKey: 'safe-value',
        nested: {
          apiKey: 'key-123',
          normalCount: 42,
        },
      };

      const sanitized = sanitizeMetadata(sensitive);
      assert.strictEqual(sanitized.token, '[REDACTED]');
      assert.strictEqual(sanitized.access_token, '[REDACTED]');
      assert.strictEqual(sanitized.refresh_token, '[REDACTED]');
      assert.strictEqual(sanitized.client_secret, '[REDACTED]');
      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.credentialCiphertext, '[REDACTED]');
      assert.strictEqual(sanitized.validKey, 'safe-value');
      assert.strictEqual((sanitized.nested as any).apiKey, '[REDACTED]');
      assert.strictEqual((sanitized.nested as any).normalCount, 42);
    });
  });

  describe('SyncRun Lifecycle', () => {
    it('deve iniciar um SyncRun com status RUNNING e finalizar com SUCCESS', async () => {
      const run = await observability.startSyncRun({
        organizationId: 'org-test-1',
        provider: 'ASANA',
        operation: 'SYNC_PROJECTS',
      });

      assert.ok(run.id);
      assert.strictEqual(run.status, 'RUNNING');
      assert.strictEqual(run.provider, 'ASANA');
      assert.strictEqual(run.operation, 'SYNC_PROJECTS');

      await observability.finishSyncRun(run.id, {
        status: 'SUCCESS',
        itemsProcessed: 10,
        itemsSucceeded: 10,
        itemsFailed: 0,
      });

      assert.strictEqual(updatedSyncRuns.length, 1);
      assert.strictEqual(updatedSyncRuns[0].data.status, 'SUCCESS');
      assert.strictEqual(updatedSyncRuns[0].data.itemsProcessed, 10);
      assert.strictEqual(updatedSyncRuns[0].data.itemsSucceeded, 10);
      assert.strictEqual(updatedSyncRuns[0].data.itemsFailed, 0);
    });

    it('deve registrar falha no SyncRun com resumo de erro seguro', async () => {
      const run = await observability.startSyncRun({
        organizationId: 'org-test-2',
        provider: 'ASANA',
        operation: 'SYNC_WEBHOOKS',
      });

      await observability.finishSyncRun(run.id, {
        status: 'FAILED',
        itemsProcessed: 5,
        itemsSucceeded: 2,
        itemsFailed: 3,
        errorSummary: 'Erro de comunicação remota HTTP 500',
      });

      assert.strictEqual(updatedSyncRuns[0].data.status, 'FAILED');
      assert.strictEqual(updatedSyncRuns[0].data.errorSummary, 'Erro de comunicação remota HTTP 500');
    });
  });

  describe('IntegrationError Tracking', () => {
    it('deve registrar erro operacional com isolamento e metadados válidos', async () => {
      const err = await observability.recordError({
        organizationId: 'org-test-3',
        provider: 'ASANA',
        operation: 'OAUTH_REFRESH',
        code: 'TOKEN_EXPIRED',
        message: 'Refresh token revogado pelo usuário no Asana',
        retryable: false,
        metadata: {
          attemptCount: 3,
          source: 'oauth_handler',
        },
      });

      assert.ok(err.id);
      assert.strictEqual(err.organizationId, 'org-test-3');
      assert.strictEqual(err.code, 'TOKEN_EXPIRED');
      assert.strictEqual(err.retryable, false);
      assert.strictEqual((err.metadata as any).attemptCount, 3);
    });

    it('deve rejeitar metadados com segredos proibidos em IntegrationError', async () => {
      await assert.rejects(
        async () => {
          await observability.recordError({
            organizationId: 'org-test-3',
            provider: 'ASANA',
            operation: 'OAUTH_REFRESH',
            message: 'Erro com secret vazado',
            metadata: {
              client_secret: 'prohibited-secret',
            },
          });
        },
        (err: any) => {
          return err.code === 'PROHIBITED_METADATA_KEY';
        }
      );
    });

    it('deve marcar erro operacional como resolvido', async () => {
      const err = await observability.recordError({
        organizationId: 'org-test-3',
        provider: 'ASANA',
        operation: 'SYNC',
        message: 'Timeout temporário',
        retryable: true,
      });

      await observability.resolveError('org-test-3', err.id);
      assert.strictEqual(updatedErrors.length, 1);
      assert.ok(updatedErrors[0].data.resolvedAt instanceof Date);
    });
  });

  describe('WebhookEvent Deduplication', () => {
    it('deve registrar e deduplicar evento por chave única', async () => {
      const { isDuplicate, event } = await observability.recordWebhookEvent({
        organizationId: 'org-test-4',
        provider: 'ASANA',
        dedupeKey: 'asana-event-guid-9988',
        eventType: 'task.changed',
        payload: { taskGid: 'task-123' },
      });

      assert.strictEqual(isDuplicate, false);
      assert.ok(event.id);
      assert.strictEqual(event.status, 'RECEIVED');

      // Tentativa de reprocessar o mesmo evento
      const retry = await observability.recordWebhookEvent({
        organizationId: 'org-test-4',
        provider: 'ASANA',
        dedupeKey: 'asana-event-guid-9988',
        eventType: 'task.changed',
      });

      assert.strictEqual(retry.isDuplicate, true);
      assert.strictEqual(retry.event.id, event.id);
    });
  });
});
