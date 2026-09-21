import test from 'node:test';
import assert from 'node:assert';
import {
  generateInvitationToken,
  hashInvitationToken,
  calculateInvitationExpiry,
  INVITATION_TTL_DAYS,
} from '../invitation-token.js';

test('Invitation Token Utility - Unit Tests', async (t) => {
  await t.test('1. generateInvitationToken produz strings seguras não-vazias e distintas', () => {
    const token1 = generateInvitationToken();
    const token2 = generateInvitationToken();

    assert.ok(token1 && token1.length >= 40);
    assert.ok(token2 && token2.length >= 40);
    assert.notStrictEqual(token1, token2);
  });

  await t.test('2. hashInvitationToken é determinístico e produz hash SHA-256 hexadecimal', () => {
    const token = 'test-token-fixed-value-12345';
    const hash1 = hashInvitationToken(token);
    const hash2 = hashInvitationToken(token);

    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
    assert.match(hash1, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(hash1, token);
  });

  await t.test('3. calculateInvitationExpiry calcula exatamente 7 dias à frente', () => {
    const baseDate = new Date('2026-09-20T12:00:00.000Z');
    const expiry = calculateInvitationExpiry(baseDate);

    const diffMs = expiry.getTime() - baseDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    assert.strictEqual(diffDays, INVITATION_TTL_DAYS);
    assert.strictEqual(diffDays, 7);
  });
});
