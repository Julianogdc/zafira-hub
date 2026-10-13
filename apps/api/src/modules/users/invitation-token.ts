import { randomBytes, createHash } from 'node:crypto';

export const INVITATION_TTL_DAYS = 7;

/**
 * Gera um token bruto aleatório de 32 bytes criptograficamente seguro codificado em base64url.
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Gera o hash SHA-256 hexadecimal do token bruto para armazenamento seguro no banco de dados.
 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Calcula a data de expiração de um convite a partir de uma data base (padrão: agora + 7 dias).
 */
export function calculateInvitationExpiry(from: Date = new Date()): Date {
  const expiresAt = new Date(from);
  expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);
  return expiresAt;
}
