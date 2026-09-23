import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes recomendado pelo NIST para AES-GCM
const PREFIX = 'enc:v1:';

/**
 * Obtém a chave de 256 bits (32 bytes) para criptografia em repouso.
 * Utiliza INTEGRATION_ENCRYPTION_KEY da variável de ambiente.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.COOKIE_SECRET || 'zafira_hub_default_encryption_key_32b_dev';
  
  // Derivação segura para garantir exatamente 32 bytes (256 bits)
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Criptografa um texto sensível (tokens, segredos) usando AES-256-GCM.
 * Retorna string no formato: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return plainText;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Descriptografa um token cifrado com AES-256-GCM.
 * Lança erro caso o dado tenha sido adulterado ou a chave seja incompatível.
 */
export function decryptToken(cipherText: string): string {
  if (!cipherText) return cipherText;

  // Se não estiver cifrado (legado ou texto puro), retorna o valor com aviso
  if (!cipherText.startsWith(PREFIX)) {
    return cipherText;
  }

  const parts = cipherText.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Formato inválido do payload criptografado.');
  }

  const [ivHex, tagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Criptografia ESTRITA para novas IntegrationConnection.
 * Exige INTEGRATION_ENCRYPTION_KEY obrigatoriamente (fail-closed sem chave/fallback).
 * Utiliza formato: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptIntegrationCredential(plainText: string): string {
  if (!plainText || !plainText.trim()) {
    throw new Error('Credencial inválida ou vazia para criptografia.');
  }

  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret || !secret.trim()) {
    throw new Error('CRITICAL SECURITY ERROR: INTEGRATION_ENCRYPTION_KEY é obrigatória para IntegrationConnection.');
  }

  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Descriptografia ESTRITA para novas IntegrationConnection.
 * Exige INTEGRATION_ENCRYPTION_KEY obrigatoriamente e rejeita plaintext ou payloads adulterados.
 */
export function decryptIntegrationCredential(cipherText: string): string {
  if (!cipherText || typeof cipherText !== 'string' || !cipherText.startsWith(PREFIX)) {
    throw new Error('Payload inválido ou não criptografado. Rejeitado pelo modo estrito.');
  }

  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret || !secret.trim()) {
    throw new Error('CRITICAL SECURITY ERROR: INTEGRATION_ENCRYPTION_KEY é obrigatória para decrypt de IntegrationConnection.');
  }

  const parts = cipherText.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Formato inválido do payload criptografado.');
  }

  const [ivHex, tagHex, encryptedHex] = parts;
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
}
