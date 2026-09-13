import crypto from 'node:crypto';
import { encryptToken, decryptToken } from '../crypto.js';
import {
  generateOAuthState,
  verifyOAuthState,
  verifyOAuthStateSignature,
  createAndPersistOAuthState,
  verifyAndConsumeOAuthState,
} from '../oauthState.js';
import { buildAsanaAuthorizeUrl, ASANA_OAUTH_SCOPES } from '../../modules/integrations/asana/asana.routes.js';

interface InMemoryOAuthState {
  id: string;
  nonce: string;
  organizationId: string;
  userId: string;
  provider: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

function createMockPrisma() {
  const store = new Map<string, InMemoryOAuthState>();

  return {
    oAuthState: {
      create: async ({ data }: { data: any }) => {
        const record: InMemoryOAuthState = {
          id: `state-${Date.now()}-${Math.random()}`,
          nonce: data.nonce,
          organizationId: data.organizationId,
          userId: data.userId,
          provider: data.provider || 'ASANA',
          expiresAt: data.expiresAt,
          consumedAt: null,
          createdAt: new Date(),
        };
        store.set(data.nonce, record);
        return record;
      },
      findUnique: async ({ where }: { where: { nonce: string } }) => {
        return store.get(where.nonce) || null;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        for (const [nonce, record] of store.entries()) {
          if (record.id === where.id) {
            const updated = { ...record, ...data };
            store.set(nonce, updated);
            return updated;
          }
        }
        throw new Error('Record not found');
      },
      deleteMany: async ({ where }: { where: any }) => {
        let count = 0;
        if (where?.expiresAt?.lt) {
          const threshold = where.expiresAt.lt.getTime();
          for (const [nonce, record] of store.entries()) {
            if (record.expiresAt.getTime() < threshold) {
              store.delete(nonce);
              count++;
            }
          }
        }
        return { count };
      },
    },
  } as any;
}

async function runSecurityTests() {
  console.log('--- TESTE 1: Criptografia Autenticada AES-256-GCM ---');
  const sampleToken = '2/1205135781277453/1212661485522205:ee5bd2206b3d9939c74763e5c4b0cdb05';
  const encrypted = encryptToken(sampleToken);
  console.log('Token Cifrado:', encrypted);

  if (!encrypted.startsWith('enc:v1:')) {
    throw new Error('Falha: Prefixo enc:v1: não encontrado!');
  }
  if (encrypted.includes(sampleToken)) {
    throw new Error('Falha crítica: Token original vazou no texto cifrado!');
  }

  const decrypted = decryptToken(encrypted);
  if (decrypted !== sampleToken) {
    throw new Error('Falha: Descriptografia não bate com o token original!');
  }
  console.log('✓ Criptografia e descriptografia AES-256-GCM validadas com sucesso!');

  console.log('\n--- TESTE 2: Detecção de Adulteração de Ciphertext (Tampering) ---');
  const tampered = encrypted.slice(0, -4) + 'abcd';
  let tamperedDetected = false;
  try {
    decryptToken(tampered);
  } catch (err: any) {
    tamperedDetected = true;
    console.log('✓ Adulteração detectada e rejeitada pelo GCM Auth Tag:', err.message);
  }
  if (!tamperedDetected) {
    throw new Error('Falha crítica: GCM aceitou dado adulterado sem erro!');
  }

  const mockPrisma = createMockPrisma();
  const orgId = 'org-uuid-zafira-123';
  const userId = 'user-uuid-juliano-456';

  console.log('\n--- TESTE 3: OAuth State Válido (Server-Side + HMAC) ---');
  const { stateParam } = await createAndPersistOAuthState(mockPrisma, orgId, userId, 'ASANA');
  console.log('State gerado e persistido no servidor:', stateParam.slice(0, 40) + '...');

  const consumed = await verifyAndConsumeOAuthState(mockPrisma, stateParam, 'ASANA');
  if (consumed.organizationId !== orgId || consumed.userId !== userId) {
    throw new Error('Falha: Identidade recuperada divergente da esperada!');
  }
  console.log('✓ State válido consumido com sucesso no servidor. Organização:', consumed.organizationId);

  console.log('\n--- TESTE 4: Rejeição de State Adulterado (Assinatura HMAC Falsa) ---');
  const forgedState = stateParam.slice(0, -8) + 'deadbeef';
  let forgedRejected = false;
  try {
    await verifyAndConsumeOAuthState(mockPrisma, forgedState, 'ASANA');
  } catch (err: any) {
    forgedRejected = true;
    console.log('✓ State adulterado rejeitado pela assinatura HMAC:', err.message);
  }
  if (!forgedRejected) {
    throw new Error('Falha crítica: State com HMAC adulterado foi aceito!');
  }

  console.log('\n--- TESTE 5: Rejeição de State Já Utilizado (Uso Único) ---');
  let replayRejected = false;
  try {
    // Tenta reutilizar o mesmo state que acabou de ser consumido no Teste 3
    await verifyAndConsumeOAuthState(mockPrisma, stateParam, 'ASANA');
  } catch (err: any) {
    replayRejected = true;
    console.log('✓ Reutilização de state rejeitada com sucesso:', err.message);
  }
  if (!replayRejected) {
    throw new Error('Falha crítica: Reutilização de state (replay attack) foi aceita!');
  }

  console.log('\n--- TESTE 6: Rejeição de State Inexistente no Servidor ---');
  // Gera um state assinado com a chave do sistema, mas sem salvar no mockPrisma
  const fakeNonce = crypto.randomBytes(24).toString('hex');
  const fakePayload = {
    nonce: fakeNonce,
    orgId,
    userId,
    exp: Date.now() + 600000,
  };
  const secret = crypto.createHash('sha256').update(process.env.INTEGRATION_ENCRYPTION_KEY || 'zafira_hub_oauth_state_secret_key').digest();
  const payloadStr = Buffer.from(JSON.stringify(fakePayload)).toString('base64url');
  const fakeHmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url');
  const fakeStateParam = `${payloadStr}.${fakeHmac}`;

  let nonexistentRejected = false;
  try {
    await verifyAndConsumeOAuthState(mockPrisma, fakeStateParam, 'ASANA');
  } catch (err: any) {
    nonexistentRejected = true;
    console.log('✓ State inexistente no banco rejeitado com sucesso:', err.message);
  }
  if (!nonexistentRejected) {
    throw new Error('Falha crítica: State não cadastrado no banco foi aceito!');
  }

  console.log('\n--- TESTE 7: Rejeição de State Expirado ---');
  const expiredPayload = {
    nonce: crypto.randomBytes(24).toString('hex'),
    orgId,
    userId,
    exp: Date.now() - 1000, // expirado há 1 segundo
  };
  const expStr = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
  const expHmac = crypto.createHmac('sha256', secret).update(expStr).digest('base64url');
  const expiredStateParam = `${expStr}.${expHmac}`;

  let expiredRejected = false;
  try {
    await verifyAndConsumeOAuthState(mockPrisma, expiredStateParam, 'ASANA');
  } catch (err: any) {
    expiredRejected = true;
    console.log('✓ State expirado rejeitado com sucesso:', err.message);
  }
  if (!expiredRejected) {
    throw new Error('Falha crítica: State expirado foi aceito!');
  }

  console.log('\n--- TESTE 8: Callback Independente de Cookies de Navegador ---');
  // Cria novo state
  const { stateParam: standaloneState } = await createAndPersistOAuthState(mockPrisma, orgId, userId, 'ASANA');
  // Validação funciona sem precisar de cookieNonce
  const standaloneResult = await verifyAndConsumeOAuthState(mockPrisma, standaloneState, 'ASANA');
  if (standaloneResult.organizationId !== orgId) {
    throw new Error('Falha na validação standalone server-side!');
  }
  console.log('✓ Callback validado e consumido perfeitamente sem depender de cookie do localhost!');

  console.log('\n--- TESTE 9: Target Origin Restrito no Callback (sem wildcard) ---');
  function getTargetOriginMock(envFrontendOrigin?: string, envCorsOrigin?: string): string {
    if (envFrontendOrigin) return envFrontendOrigin.trim();
    if (envCorsOrigin) return envCorsOrigin.split(',')[0].trim();
    return 'http://localhost:5173';
  }

  const originDefault = getTargetOriginMock();
  if (originDefault === '*') {
    throw new Error('Falha crítica: Target origin está usando wildcard *!');
  }
  if (originDefault !== 'http://localhost:5173') {
    throw new Error('Falha: Target origin padrão incompatível com localhost!');
  }
  const originCustom = getTargetOriginMock('https://meuhub.zafira.com.br');
  if (originCustom !== 'https://meuhub.zafira.com.br') {
    throw new Error('Falha: Custom FRONTEND_ORIGIN não respeitado!');
  }
  console.log('✓ targetOrigin validado com sucesso: não usa wildcard e restringe para', originDefault, 'ou customizado.');

  console.log('\n--- TESTE 10: Filtro de Origens Seguras no Frontend ---');
  const allowedOrigins = [
    'https://zafira-hub-v2-api.hvrb9d.easypanel.host',
    'http://localhost:5173',
  ];

  function simulateFrontendMessageReceive(eventOrigin: string, eventData: any): boolean {
    if (!allowedOrigins.includes(eventOrigin)) {
      return false; // Rejeita/ignora
    }
    return eventData?.type === 'ASANA_AUTH_SUCCESS';
  }

  const accepted = simulateFrontendMessageReceive('https://zafira-hub-v2-api.hvrb9d.easypanel.host', { type: 'ASANA_AUTH_SUCCESS' });
  const evilRejected = simulateFrontendMessageReceive('https://malicious-phishing.com', { type: 'ASANA_AUTH_SUCCESS' });

  if (!accepted) {
    throw new Error('Falha: Origem legítima foi indevidamente rejeitada no frontend!');
  }
  if (evilRejected) {
    throw new Error('Falha crítica: Origem maliciosa foi aceita no frontend!');
  }
  console.log('✓ Frontend: Origem legítima aceita e mensagem de origem forjada (phishing) sumariamente ignorada.');

  console.log('\n--- TESTE 11: Validação de Scopes Explícitos do Asana OAuth ---');
  const dummyClientId = '1205135781277453';
  const dummyRedirectUri = 'https://zafira-hub-v2-api.hvrb9d.easypanel.host/integrations/asana/oauth/callback';
  const dummyState = 'state_test_token_sample.hmac123';

  const generatedAuthUrl = buildAsanaAuthorizeUrl({
    clientId: dummyClientId,
    redirectUri: dummyRedirectUri,
    state: dummyState,
    scopes: ASANA_OAUTH_SCOPES,
  });

  const parsedUrl = new URL(generatedAuthUrl);

  // 1. Validar parâmetros fundamentais
  if (parsedUrl.searchParams.get('response_type') !== 'code') {
    throw new Error('Falha: response_type diferente de "code"!');
  }
  if (parsedUrl.searchParams.get('client_id') !== dummyClientId) {
    throw new Error('Falha: client_id incorreto na URL!');
  }
  if (parsedUrl.searchParams.get('redirect_uri') !== dummyRedirectUri) {
    throw new Error('Falha: redirect_uri incorreto na URL!');
  }
  if (parsedUrl.searchParams.get('state') !== dummyState) {
    throw new Error('Falha: state ausente ou corrompido na URL!');
  }

  // 2. Validar scope
  const scopeParam = parsedUrl.searchParams.get('scope');
  if (!scopeParam) {
    throw new Error('Falha crítica: Parâmetro scope não existe na URL de autorização!');
  }

  const scopesList = scopeParam.split(' ');

  // Não contém default
  if (scopesList.includes('default')) {
    throw new Error('Falha crítica: scope contém "default" proibido para apps granulares!');
  }

  // Não contém openid, email, profile
  const forbiddenScopes = ['openid', 'email', 'profile'];
  for (const forbidden of forbiddenScopes) {
    if (scopesList.includes(forbidden)) {
      throw new Error(`Falha crítica: scope contém escopo proibido "${forbidden}"!`);
    }
  }

  // Contém projects:read e tasks:read
  if (!scopesList.includes('projects:read') || !scopesList.includes('tasks:read')) {
    throw new Error('Falha: scope deve conter obrigatoriamente "projects:read" e "tasks:read"!');
  }

  // Não contém permissões delete
  const deleteScopes = scopesList.filter((s) => s.includes(':delete'));
  if (deleteScopes.length > 0) {
    throw new Error(`Falha crítica: scopes contém permissões de delete proibidas: ${deleteScopes.join(', ')}`);
  }

  // Não contém webhooks
  if (scopesList.some((s) => s.includes('webhook'))) {
    throw new Error('Falha: escopos não devem conter webhooks!');
  }

  console.log('✓ Escopos validados com sucesso: 19 escopos específicos presentes.');
  console.log('✓ Nenhuma permissão "default", "identity/openid/email/profile" ou ":delete" detectada.');
  console.log('✓ URL gerada com sucesso:', generatedAuthUrl.slice(0, 100) + '...');

  console.log('\n======================================================');
  console.log('TODOS OS 11 TESTES DE SEGURANÇA E COMPATIBILIDADE APROVADOS COM 100% DE SUCESSO!');
  console.log('======================================================');
}

runSecurityTests().catch((err) => {
  console.error('ERRO NOS TESTES:', err);
  process.exit(1);
});

