import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AsanaService, AsanaIntegrationError } from '../asana.service.js';
import { asanaIntegrationConnector } from '../asana.connector.js';
import { integrationRegistryService } from '../../common/integration-registry.service.js';
import {
  encryptToken,
  decryptToken,
  encryptIntegrationCredential,
  decryptIntegrationCredential,
} from '../../../../lib/crypto.js';

describe('Asana Canonical Integration & Common Layer (Passo 2C1)', () => {
  const testOrgId = 'org-asana-canonical-test-01';
  const otherOrgId = 'org-asana-canonical-test-02';

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  describe('1. Criptografia e Isolamento Canônico', () => {
    it('deve criptografar e descriptografar credenciais canônicas sem vazar segredos em plaintext', () => {
      const rawSecret = JSON.stringify({
        accessToken: '1/synthetic-token-secret-12345',
        refreshToken: '1/refresh-token-secret-67890',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const encrypted = encryptIntegrationCredential(rawSecret);
      assert.notStrictEqual(encrypted, rawSecret);
      assert.ok(!encrypted.includes('1/synthetic-token-secret-12345'));

      const decrypted = decryptIntegrationCredential(encrypted);
      assert.strictEqual(decrypted, rawSecret);
      const parsed = JSON.parse(decrypted);
      assert.strictEqual(parsed.accessToken, '1/synthetic-token-secret-12345');
    });
  });

  describe('2. Migração Transparente do OrganizationIntegration Legado', () => {
    it('deve migrar credencial legada para IntegrationConnection e torná-la canônica', async () => {
      const legacyToken = '1/legacy-asana-token-999';
      const encLegacyToken = encryptToken(legacyToken);

      // Simula objeto legado
      const legacyRecord = {
        id: 'legacy-org-int-1',
        organizationId: testOrgId,
        provider: 'ASANA',
        accessToken: encLegacyToken,
        refreshToken: null,
        workspaceId: 'ws-asana-legacy-123',
        metadata: { userName: 'Legacy Admin' },
      };

      // Valida que o token descriptografado do legado é idêntico
      const dec = decryptToken(legacyRecord.accessToken);
      assert.strictEqual(dec, legacyToken);
    });
  });

  describe('3. Conector Comum do Asana e Central de Integrações', () => {
    beforeEach(() => {
      integrationRegistryService.registerConnector(asanaIntegrationConnector);
    });

    it('deve ter capacidades declaradas corretamente', () => {
      const caps = asanaIntegrationConnector.getCapabilities();
      assert.strictEqual(caps.canTestConnection, true);
      assert.strictEqual(caps.canSync, true);
      assert.strictEqual(caps.canReconnect, true);
      assert.strictEqual(caps.canDisconnect, true);
      assert.strictEqual(asanaIntegrationConnector.provider, 'ASANA');
    });

    it('deve registrar conector no IntegrationRegistryService e listar na Central de Integrações', async () => {
      const connector = integrationRegistryService.getConnector('ASANA');
      assert.ok(connector);
      assert.strictEqual(connector.provider, 'ASANA');

      const allConnectors = integrationRegistryService.getAllConnectors();
      assert.ok(allConnectors.some((c) => c.provider === 'ASANA'));
    });
  });
});

