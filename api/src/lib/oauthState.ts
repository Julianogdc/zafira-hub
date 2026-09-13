import crypto from 'node:crypto';
import { PrismaClient, IntegrationProvider } from '@prisma/client';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos de validade máxima

function getStateSecret(): Buffer {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.COOKIE_SECRET || 'zafira_hub_oauth_state_secret_key';
  return crypto.createHash('sha256').update(secret).digest();
}

export interface OAuthStatePayload {
  nonce: string;
  orgId: string;
  userId: string;
  exp: number;
}

/**
 * Valida a integridade criptográfica e a assinatura HMAC-SHA256 do state recebido.
 */
export function verifyOAuthStateSignature(stateParam: string): OAuthStatePayload {
  if (!stateParam || typeof stateParam !== 'string') {
    throw new Error('Parâmetro state ausente ou inválido.');
  }

  const parts = stateParam.split('.');
  if (parts.length !== 2) {
    throw new Error('Estrutura de state inválida.');
  }

  const [payloadStr, signature] = parts;
  const secret = getStateSecret();

  const expectedHmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url');

  // Comparação em tempo constante para prevenir timing attacks
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedHmac);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new Error('Assinatura do state inválida. Possível tentativa de ataque CSRF.');
  }

  let payload: OAuthStatePayload;
  try {
    const jsonStr = Buffer.from(payloadStr, 'base64url').toString('utf8');
    payload = JSON.parse(jsonStr);
  } catch {
    throw new Error('Conteúdo do state ilegível.');
  }

  if (!payload.exp || payload.exp < Date.now()) {
    throw new Error('State de autorização expirado. Inicie o fluxo novamente.');
  }

  if (!payload.orgId || !payload.nonce) {
    throw new Error('Identificador de organização ou nonce ausente no state.');
  }

  return payload;
}

/**
 * Cria o OAuth state assinado criptograficamente e o persiste no banco de dados para validação server-side.
 */
export async function createAndPersistOAuthState(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  provider: IntegrationProvider = 'ASANA'
): Promise<{ stateParam: string; nonce: string }> {
  // Limpeza oportunística de states expirados
  await prisma.oAuthState.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  }).catch(() => {});

  const nonce = crypto.randomBytes(24).toString('hex');
  const exp = Date.now() + STATE_TTL_MS;

  const payload: OAuthStatePayload = {
    nonce,
    orgId: organizationId,
    userId,
    exp,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = getStateSecret();
  const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url');
  const stateParam = `${payloadStr}.${hmac}`;

  await prisma.oAuthState.create({
    data: {
      nonce,
      organizationId,
      userId,
      provider,
      expiresAt: new Date(exp),
    },
  });

  return {
    stateParam,
    nonce,
  };
}

/**
 * Valida o OAuth state tanto pela assinatura HMAC quanto pelo registro no banco de dados,
 * garantindo uso estritamente único (consome o registro).
 */
export async function verifyAndConsumeOAuthState(
  prisma: PrismaClient,
  stateParam: string,
  provider: IntegrationProvider = 'ASANA'
): Promise<{ organizationId: string; userId: string }> {
  // 1. Validação Criptográfica HMAC e expiração de curto prazo
  const payload = verifyOAuthStateSignature(stateParam);

  // 2. Busca e validação Server-side no banco de dados
  const record = await prisma.oAuthState.findUnique({
    where: { nonce: payload.nonce },
  });

  if (!record) {
    throw new Error('State de autorização inexistente ou não reconhecido pelo servidor.');
  }

  if (record.consumedAt) {
    throw new Error('State de autorização já utilizado. Cada autorização deve ser única.');
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new Error('State de autorização expirado no servidor.');
  }

  if (record.provider !== provider) {
    throw new Error('Provedor de integração incompatível com o state.');
  }

  if (record.organizationId !== payload.orgId || record.userId !== payload.userId) {
    throw new Error('Inconsistência nos parâmetros de identidade da autorização.');
  }

  // 3. Invalidação atômica (Uso único garantido)
  await prisma.oAuthState.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  // 4. Retorna organização e usuário estritamente obtidos do registro seguro do banco
  return {
    organizationId: record.organizationId,
    userId: record.userId,
  };
}

/**
 * Função utilitária mantida para compatibilidade e testes locais em memória
 */
export function generateOAuthState(organizationId: string, userId: string): { stateParam: string; cookieNonce: string } {
  const nonce = crypto.randomBytes(24).toString('hex');
  const exp = Date.now() + STATE_TTL_MS;

  const payload: OAuthStatePayload = {
    nonce,
    orgId: organizationId,
    userId,
    exp,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = getStateSecret();

  const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url');
  const stateParam = `${payloadStr}.${hmac}`;

  return {
    stateParam,
    cookieNonce: nonce,
  };
}

/**
 * Função utilitária mantida para compatibilidade e testes locais em memória
 */
export function verifyOAuthState(stateParam: string, cookieNonce?: string): { organizationId: string; userId: string } {
  const payload = verifyOAuthStateSignature(stateParam);

  if (cookieNonce && payload.nonce !== cookieNonce) {
    throw new Error('Sessão de autorização incompatível com o navegador.');
  }

  return {
    organizationId: payload.orgId,
    userId: payload.userId,
  };
}
