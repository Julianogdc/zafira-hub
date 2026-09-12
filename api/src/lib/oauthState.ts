import crypto from 'node:crypto';

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
 * Gera um state de OAuth criptograficamente seguro e assinado via HMAC-SHA256.
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
 * Valida o state retornado pelo Asana no callback.
 * Verifica a assinatura HMAC, a expiração e o nonce da sessão do usuário.
 */
export function verifyOAuthState(stateParam: string, cookieNonce?: string): { organizationId: string; userId: string } {
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

  if (cookieNonce && payload.nonce !== cookieNonce) {
    throw new Error('Sessão de autorização incompatível com o navegador.');
  }

  if (!payload.orgId) {
    throw new Error('Identificador de organização ausente no state.');
  }

  return {
    organizationId: payload.orgId,
    userId: payload.userId,
  };
}
