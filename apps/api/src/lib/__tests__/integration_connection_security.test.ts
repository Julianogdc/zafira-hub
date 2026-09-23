import test from 'node:test';
import assert from 'node:assert';
import {
  encryptToken,
  decryptToken,
  encryptIntegrationCredential,
  decryptIntegrationCredential,
} from '../../lib/crypto.js';
import { sanitizeAuditPayload } from '../../modules/audit/audit.service.js';

test('Security & Crypto Suite (Integration Connection Hardening)', async (t) => {

  await t.test('1. Criptografia legada encryptToken/decryptToken continua preservada', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test_key_32_bytes_long_exact_val_1';
    const plain = 'asana_legacy_secret_123';
    const encrypted = encryptToken(plain);

    assert.ok(encrypted.startsWith('enc:v1:'));
    assert.strictEqual(decryptToken(encrypted), plain);
    assert.strictEqual(decryptToken('plain_unencrypted_legacy'), 'plain_unencrypted_legacy');
  });

  await t.test('2. Criptografia estrita encryptIntegrationCredential gera IVs aleatórios para o mesmo texto', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test_key_32_bytes_long_exact_val_1';
    const secret = 'brightbean_api_key_abc_123';

    const enc1 = encryptIntegrationCredential(secret);
    const enc2 = encryptIntegrationCredential(secret);

    assert.notStrictEqual(enc1, enc2, 'Dois ciphertexts do mesmo secret devem ser diferentes devido ao IV aleatório');
    assert.ok(enc1.startsWith('enc:v1:'));
    assert.ok(enc2.startsWith('enc:v1:'));
    assert.strictEqual(decryptIntegrationCredential(enc1), secret);
    assert.strictEqual(decryptIntegrationCredential(enc2), secret);
  });

  await t.test('3. Modo estrito rejeita se INTEGRATION_ENCRYPTION_KEY estiver ausente (Fail-Closed)', () => {
    const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;

    assert.throws(() => {
      encryptIntegrationCredential('secret');
    }, /INTEGRATION_ENCRYPTION_KEY é obrigatória/);

    assert.throws(() => {
      decryptIntegrationCredential('enc:v1:iv:tag:ciphertext');
    }, /INTEGRATION_ENCRYPTION_KEY é obrigatória/);

    process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
  });

  await t.test('4. Modo estrito rejeita plaintext em decrypt (sem fallback permissivo)', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test_key_32_bytes_long_exact_val_1';
    assert.throws(() => {
      decryptIntegrationCredential('plaintext_unencrypted_secret');
    }, /Payload inválido ou não criptografado/);
  });

  await t.test('5. Modo estrito falha ao descriptografar payload adulterado ou com chave errada', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test_key_32_bytes_long_exact_val_1';
    const secret = 'my_secret';
    const encrypted = encryptIntegrationCredential(secret);

    // Adultera o ciphertext
    const tampered = encrypted.slice(0, -4) + 'ffff';
    assert.throws(() => {
      decryptIntegrationCredential(tampered);
    });

    // Tenta com chave diferente
    process.env.INTEGRATION_ENCRYPTION_KEY = 'different_key_32_bytes_long_val_2';
    assert.throws(() => {
      decryptIntegrationCredential(encrypted);
    });

    process.env.INTEGRATION_ENCRYPTION_KEY = 'test_key_32_bytes_long_exact_val_1';
  });

  await t.test('6. Audit Log Sanitizer substitui credential, credentialCiphertext e integrationCredential por [REDACTED]', () => {
    const payload = {
      organizationId: 'org_123',
      credential: 'secret_plain_key',
      credentialCiphertext: 'enc:v1:iv:tag:cipher',
      integrationCredential: 'secret_key_2',
      nested: {
        apiKey: 'api_key_val',
        token: 'token_val',
        credential: 'nested_credential',
      },
      array: [{ credentialCiphertext: 'enc:v1:abc' }],
      safeField: 'valor_seguro',
    };

    const sanitized = sanitizeAuditPayload(payload) as any;

    assert.strictEqual(sanitized.credential, '[REDACTED]');
    assert.strictEqual(sanitized.credentialCiphertext, '[REDACTED]');
    assert.strictEqual(sanitized.integrationCredential, '[REDACTED]');
    assert.strictEqual(sanitized.nested.apiKey, '[REDACTED]');
    assert.strictEqual(sanitized.nested.token, '[REDACTED]');
    assert.strictEqual(sanitized.nested.credential, '[REDACTED]');
    assert.strictEqual(sanitized.array[0].credentialCiphertext, '[REDACTED]');
    assert.strictEqual(sanitized.safeField, 'valor_seguro');
  });
});
