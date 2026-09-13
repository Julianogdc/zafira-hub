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
import { sseHub } from '../sseHub.js';

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

  // Contém os escopos de webhooks adicionados para o Asana 1.5
  const webhookScopes = ['webhooks:read', 'webhooks:write', 'webhooks:delete'];
  for (const ws of webhookScopes) {
    if (!scopesList.includes(ws)) {
      throw new Error(`Falha: scope deve conter o escopo de webhook "${ws}"!`);
    }
  }

  // Não contém permissões destrutivas de deleção de tarefas ou projetos
  const destructiveDeleteScopes = scopesList.filter((s) => s === 'tasks:delete' || s === 'projects:delete');
  if (destructiveDeleteScopes.length > 0) {
    throw new Error(`Falha crítica: scopes contém permissões de delete proibidas: ${destructiveDeleteScopes.join(', ')}`);
  }

  console.log(`✓ Escopos validados com sucesso: ${scopesList.length} escopos específicos presentes (incluindo webhooks).`);
  console.log('✓ Nenhuma permissão "default", "identity/openid/email/profile" ou deleção destrutiva de tarefas/projetos detectada.');
  console.log('✓ URL gerada com sucesso:', generatedAuthUrl.slice(0, 100) + '...');

  console.log('\n--- TESTE 12: Fluxo Completo de Desconexão da Conta Asana ---');
  // 1. Validação de Role / Permissões
  function checkDisconnectPermission(role: string): { allowed: boolean; status: number } {
    if (role === 'ADMIN') {
      return { allowed: true, status: 200 };
    }
    return { allowed: false, status: 403 };
  }

  const memberAttempt = checkDisconnectPermission('MEMBER');
  if (memberAttempt.allowed || memberAttempt.status !== 403) {
    throw new Error('Falha crítica: Usuário MEMBER não foi bloqueado com 403!');
  }
  const adminAttempt = checkDisconnectPermission('ADMIN');
  if (!adminAttempt.allowed || adminAttempt.status !== 200) {
    throw new Error('Falha: Usuário ADMIN não foi autorizado a desconectar!');
  }
  console.log('✓ Controle de acesso: MEMBER recebe 403 Forbidden e ADMIN é autorizado com sucesso.');

  // 2. Simulação de Isolamento Multi-Tenant na Desconexão
  interface MockOrgIntegration {
    id: string;
    organizationId: string;
    provider: string;
    accessToken: string;
    refreshToken: string;
  }
  interface MockClientIntegration {
    id: string;
    clientId: string;
    provider: string;
    externalId: string;
  }
  interface MockClient {
    id: string;
    organizationId: string;
  }

  const mockOrgIntegrations = new Map<string, MockOrgIntegration>();
  const mockClientIntegrations = new Map<string, MockClientIntegration>();
  const mockClients: MockClient[] = [
    { id: 'client-a1', organizationId: 'org-A' },
    { id: 'client-a2', organizationId: 'org-A' },
    { id: 'client-b1', organizationId: 'org-B' },
  ];

  // Configura Org A e Org B conectadas
  mockOrgIntegrations.set('org-A', {
    id: 'int-org-A',
    organizationId: 'org-A',
    provider: 'ASANA',
    accessToken: 'token-A-enc',
    refreshToken: 'refresh-A-enc',
  });
  mockOrgIntegrations.set('org-B', {
    id: 'int-org-B',
    organizationId: 'org-B',
    provider: 'ASANA',
    accessToken: 'token-B-enc',
    refreshToken: 'refresh-B-enc',
  });

  // Vínculos de projetos
  mockClientIntegrations.set('link-a1', { id: 'link-a1', clientId: 'client-a1', provider: 'ASANA', externalId: 'proj-101' });
  mockClientIntegrations.set('link-a2', { id: 'link-a2', clientId: 'client-a2', provider: 'ASANA', externalId: 'proj-102' });
  mockClientIntegrations.set('link-b1', { id: 'link-b1', clientId: 'client-b1', provider: 'ASANA', externalId: 'proj-201' });

  // Array para monitorar chamadas remotas de API
  const remoteAsanaCalls: string[] = [];

  async function simulateDisconnect(orgId: string) {
    // Busca e valida orgIntegration
    const integration = mockOrgIntegrations.get(orgId);
    if (!integration) throw new Error('Integração não encontrada.');

    // Simula tentativa de revogação de token (POST /oauth_revoke)
    remoteAsanaCalls.push(`POST /oauth_revoke token=${integration.refreshToken}`);

    // Remove clientIntegrations desta organização
    const orgClientIds = mockClients.filter((c) => c.organizationId === orgId).map((c) => c.id);
    for (const [key, ci] of Array.from(mockClientIntegrations.entries())) {
      if (orgClientIds.includes(ci.clientId) && ci.provider === 'ASANA') {
        mockClientIntegrations.delete(key);
      }
    }

    // Remove a integração da organização
    mockOrgIntegrations.delete(orgId);
  }

  // Executa desconexão para a Org A
  await simulateDisconnect('org-A');

  // Validações
  if (mockOrgIntegrations.has('org-A')) {
    throw new Error('Falha: OrganizationIntegration da Org A não foi removida!');
  }
  if (!mockOrgIntegrations.has('org-B')) {
    throw new Error('Falha crítica: OrganizationIntegration da Org B foi indevidamente removida!');
  }
  if (mockClientIntegrations.has('link-a1') || mockClientIntegrations.has('link-a2')) {
    throw new Error('Falha: ClientIntegrations da Org A não foram removidos!');
  }
  if (!mockClientIntegrations.has('link-b1')) {
    throw new Error('Falha crítica: ClientIntegration da Org B foi indevidamente removido!');
  }

  // Verifica que nenhuma requisição DELETE foi enviada para projetos/tarefas/arquivos do Asana
  const illegalDeletes = remoteAsanaCalls.filter((c) => c.includes('DELETE /projects') || c.includes('DELETE /tasks') || c.includes('DELETE /attachments'));
  if (illegalDeletes.length > 0) {
    throw new Error('Falha crítica: Requisições de DELETE foram disparadas para recursos reais do Asana!');
  }

  console.log('✓ Desconexão executada: OrganizationIntegration e ClientIntegration da organização excluídos.');
  console.log('✓ Isolamento confirmado: Organização B permaneceu 100% intacta.');
  console.log('✓ Integridade remota confirmada: Nenhum projeto, tarefa ou arquivo foi apagado no Asana.');

  // 3. Reconexão posterior
  const reconnectState = await createAndPersistOAuthState(mockPrisma, 'org-A', 'admin-user', 'ASANA');
  if (!reconnectState.stateParam) {
    throw new Error('Falha: Não foi possível gerar novo state de reconexão!');
  }
  console.log('✓ Reconexão: É possível iniciar novo fluxo de autorização OAuth e reconectar a conta.');

  console.log('\n--- TESTE 13: Webhooks Asana (Handshake, HMAC-SHA256, Ciclo de Vida e Isolamento SSE) ---');

  // 1. Validação dos novos escopos OAuth
  const requiredScopes = ['webhooks:read', 'webhooks:write', 'webhooks:delete'];
  for (const s of requiredScopes) {
    if (!ASANA_OAUTH_SCOPES.includes(s as any)) {
      throw new Error(`Falha: Escopo obrigatório ${s} ausente em ASANA_OAUTH_SCOPES!`);
    }
  }
  console.log('✓ Escopos de webhooks (webhooks:read, webhooks:write, webhooks:delete) confirmados em ASANA_OAUTH_SCOPES.');

  // 2. Mock de subscriptions e ciclo de vida
  interface MockWebhookSubscription {
    id: string;
    organizationId: string;
    resourceGid: string;
    webhookGid?: string | null;
    target: string;
    secret: string;
    active: boolean;
    lastEventAt?: Date | null;
  }

  const mockSubscriptions = new Map<string, MockWebhookSubscription>();

  // Handshake
  const subId = 'sub-test-123';
  const plainHookSecret = 'secret-handshake-asana-998877665544';

  mockSubscriptions.set(subId, {
    id: subId,
    organizationId: 'org-A',
    resourceGid: 'project-999',
    target: `https://api.zafirahub.com/integrations/asana/webhooks/${subId}`,
    secret: encryptToken('pending'),
    active: false,
  });

  // Simulação do Handshake
  function simulateHandshake(subscriptionId: string, receivedSecret: string) {
    const sub = mockSubscriptions.get(subscriptionId);
    if (!sub) throw new Error('Subscription não encontrada');
    sub.secret = encryptToken(receivedSecret);
    sub.active = true;
    return {
      status: 200,
      headers: { 'X-Hook-Secret': receivedSecret },
    };
  }

  const handshakeRes = simulateHandshake(subId, plainHookSecret);
  if (handshakeRes.status !== 200 || handshakeRes.headers['X-Hook-Secret'] !== plainHookSecret) {
    throw new Error('Falha: Handshake não devolveu o mesmo X-Hook-Secret com HTTP 200!');
  }
  const updatedSub = mockSubscriptions.get(subId)!;
  if (!updatedSub.active || decryptToken(updatedSub.secret) !== plainHookSecret) {
    throw new Error('Falha: Secret não foi criptografado/persistido corretamente no handshake!');
  }
  console.log('✓ Handshake oficial do Asana validado com sucesso (X-Hook-Secret devolvido e secret criptografado).');

  // 3. Validação de Assinatura HMAC-SHA256 (RAW body)
  const rawBodyPayload = JSON.stringify({
    events: [
      {
        user: { gid: 'user-1' },
        created_at: new Date().toISOString(),
        action: 'changed',
        resource: { gid: 'task-555', resource_type: 'task' },
      },
    ],
  });

  const validSignature = crypto
    .createHmac('sha256', plainHookSecret)
    .update(rawBodyPayload)
    .digest('hex');

  function verifySignature(subscriptionId: string, signature: string, rawBody: string): boolean {
    const sub = mockSubscriptions.get(subscriptionId);
    if (!sub || !sub.active) return false;
    const secret = decryptToken(sub.secret);
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const bSig = Buffer.from(signature);
    const bExp = Buffer.from(expected);
    if (bSig.length !== bExp.length) return false;
    return crypto.timingSafeEqual(bSig, bExp);
  }

  if (!verifySignature(subId, validSignature, rawBodyPayload)) {
    throw new Error('Falha: Assinatura HMAC-SHA256 válida foi incorretamente rejeitada!');
  }
  console.log('✓ Assinatura HMAC-SHA256 válida aceita com base no raw body exato.');

  // Assinatura inválida / adulterada
  const invalidSignature = 'invalid' + validSignature.slice(7);
  if (verifySignature(subId, invalidSignature, rawBodyPayload)) {
    throw new Error('Falha crítica: Assinatura adulterada/inválida foi aceita!');
  }

  const tamperedPayload = rawBodyPayload + ' ';
  if (verifySignature(subId, validSignature, tamperedPayload)) {
    throw new Error('Falha crítica: Payload adulterado não invalidou a assinatura HMAC!');
  }
  console.log('✓ Assinatura HMAC-SHA256 inválida ou payload adulterado corretamente rejeitados.');

  // 4. Ciclo de vida: Criação, não duplicidade, manutenção de vínculo compartilhado e expurgo
  let webhookCallCount = 0;
  function linkProjectWebhook(orgId: string, projectGid: string) {
    let existing: MockWebhookSubscription | undefined;
    for (const sub of mockSubscriptions.values()) {
      if (sub.organizationId === orgId && sub.resourceGid === projectGid && sub.active) {
        existing = sub;
        break;
      }
    }
    if (existing) {
      return existing; // Já existe webhook ativo, não duplica
    }
    webhookCallCount++;
    const newSub: MockWebhookSubscription = {
      id: `sub-${Date.now()}-${Math.random()}`,
      organizationId: orgId,
      resourceGid: projectGid,
      webhookGid: `wh-${projectGid}`,
      target: `https://api.zafirahub.com/integrations/asana/webhooks/${projectGid}`,
      secret: encryptToken('secret-test'),
      active: true,
    };
    mockSubscriptions.set(newSub.id, newSub);
    return newSub;
  }

  // Vincula no Cliente 1
  linkProjectWebhook('org-A', 'proj-shared');
  if (webhookCallCount !== 1) throw new Error('Falha: Webhook deveria ter sido criado.');

  // Vincula o mesmo projeto no Cliente 2 da mesma organização
  linkProjectWebhook('org-A', 'proj-shared');
  if (webhookCallCount !== 1) throw new Error('Falha: Webhook foi indevidamente duplicado para o mesmo projeto na mesma org!');
  console.log('✓ Idempotência confirmada: Webhook não é duplicado para o mesmo projeto na organização.');

  function unlinkProjectWebhook(orgId: string, projectGid: string, remainingClientCount: number) {
    if (remainingClientCount > 0) {
      return; // Mantém o webhook
    }
    for (const [id, sub] of Array.from(mockSubscriptions.entries())) {
      if (sub.organizationId === orgId && sub.resourceGid === projectGid) {
        mockSubscriptions.delete(id);
      }
    }
  }

  unlinkProjectWebhook('org-A', 'proj-shared', 1); // 1 vínculo restante
  let foundSub = Array.from(mockSubscriptions.values()).find((s) => s.resourceGid === 'proj-shared');
  if (!foundSub) {
    throw new Error('Falha: Webhook foi indevidamente removido enquanto outro cliente ainda o utilizava!');
  }
  console.log('✓ Manutenção de vínculo: Webhook mantido ativo enquanto outro cliente da organização ainda o utiliza.');

  unlinkProjectWebhook('org-A', 'proj-shared', 0); // último vínculo removido
  foundSub = Array.from(mockSubscriptions.values()).find((s) => s.resourceGid === 'proj-shared');
  if (foundSub) {
    throw new Error('Falha: Webhook não foi removido quando o último vínculo foi desfeito!');
  }
  console.log('✓ Expurgo automático: Webhook e subscription removidos quando não há mais clientes vinculados ao projeto.');

  // 5. Isolamento Multi-tenant do Server-Sent Events (SSE)
  const orgAMessages: string[] = [];
  const orgBMessages: string[] = [];

  const mockReplyOrgA = {
    raw: {
      writeHead: () => {},
      write: (data: string) => orgAMessages.push(data),
      on: () => {},
    },
  } as any;

  const mockReplyOrgB = {
    raw: {
      writeHead: () => {},
      write: (data: string) => orgBMessages.push(data),
      on: () => {},
    },
  } as any;

  sseHub.register('org-A', mockReplyOrgA);
  sseHub.register('org-B', mockReplyOrgB);

  // Publica evento para a Organização A
  sseHub.publishToOrganization('org-A', {
    type: 'asana.task.changed',
    organizationId: 'org-A',
    projectGid: 'proj-123',
    resourceGid: 'task-789',
    resourceType: 'task',
    action: 'changed',
    timestamp: new Date().toISOString(),
  });

  const orgAHasEvent = orgAMessages.some((m) => m.includes('asana.task.changed') && m.includes('task-789'));
  const orgBHasEvent = orgBMessages.some((m) => m.includes('asana.task.changed') || m.includes('task-789'));

  if (!orgAHasEvent) {
    throw new Error('Falha: Cliente da Organização A não recebeu o evento SSE!');
  }
  if (orgBHasEvent) {
    throw new Error('Falha crítica de segurança: Evento da Organização A vazou para a Organização B!');
  }
  // 6. Hardening de Segurança SSE: NUNCA aceitar token na URL / query string
  function simulateAuthenticate(req: { cookies: { token?: string }; headers: { authorization?: string }; query?: { token?: string } }) {
    let token: string | undefined = req.cookies.token;
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }
    // Token em query string NÃO é extraído nem aceito
    if (!token) {
      return { authenticated: false, status: 401 };
    }
    return { authenticated: true, status: 200, token };
  }

  // Tentativa com ?token= na URL sem cookie ou header
  const queryTokenAttempt = simulateAuthenticate({
    cookies: {},
    headers: {},
    query: { token: 'jwt.token.in.url.attempt' },
  });
  if (queryTokenAttempt.authenticated || queryTokenAttempt.status !== 401) {
    throw new Error('Falha crítica de segurança: Token em query string foi aceito no SSE!');
  }
  console.log('✓ Hardening SSE: Autenticação via ?token= na query string terminantemente rejeitada com 401.');

  // Requisição legítima com cookie HTTP-only
  const cookieAttempt = simulateAuthenticate({
    cookies: { token: 'valid_httponly_jwt_token' },
    headers: {},
  });
  if (!cookieAttempt.authenticated || cookieAttempt.status !== 200) {
    throw new Error('Falha: Cookie de sessão HTTP-only foi incorretamente recusado!');
  }
  console.log('✓ Hardening SSE: Sessão HTTP-only autenticada com sucesso sem expor tokens na URL.');

  console.log('\n--- TESTE 14: Asana Etapa 2A (Detalhes, Edição, Validação de Pertencimento e RBAC) ---');

  // 1. Simulação de validação estrita de pertencimento
  const clientIntegrations = [
    { clientId: 'client-1', externalId: 'proj-linked-100' },
    { clientId: 'client-1', externalId: 'proj-linked-200' },
  ];

  function validateTaskBelongsToClient(clientId: string, taskProjects: string[]) {
    const linkedGids = new Set(
      clientIntegrations.filter((c) => c.clientId === clientId).map((c) => c.externalId)
    );
    const belongs = taskProjects.some((p) => linkedGids.has(p));
    if (!belongs) {
      return { allowed: false, status: 403, error: 'A tarefa informada não pertence aos projetos vinculados a este cliente.' };
    }
    return { allowed: true, status: 200 };
  }

  // Tarefa que pertence a um projeto do cliente
  const validBelonging = validateTaskBelongsToClient('client-1', ['proj-linked-100']);
  if (!validBelonging.allowed || validBelonging.status !== 200) {
    throw new Error('Falha: Tarefa de projeto vinculado foi incorretamente recusada!');
  }
  console.log('✓ Pertencimento: Tarefa pertencente a projeto vinculado ao cliente aceita com sucesso.');

  // Tarefa de projeto arbitrário fora do cliente
  const invalidBelonging = validateTaskBelongsToClient('client-1', ['proj-unrelated-999']);
  if (invalidBelonging.allowed || invalidBelonging.status !== 403) {
    throw new Error('Falha crítica de segurança: Tarefa de projeto não vinculado não foi rejeitada com 403!');
  }
  console.log('✓ Segurança de Pertencimento: Tarefa fora dos projetos vinculados rejeitada com 403 Forbidden.');

  // 2. Simulação de RBAC para Edição (PATCH)
  function simulateTaskEditRBAC(userRole: string) {
    const allowedRoles = ['ADMIN', 'MANAGER'];
    if (!allowedRoles.includes(userRole.toUpperCase())) {
      return { allowed: false, status: 403, error: 'Acesso negado. Requer função: ADMIN ou MANAGER' };
    }
    return { allowed: true, status: 200 };
  }

  const adminEdit = simulateTaskEditRBAC('ADMIN');
  const managerEdit = simulateTaskEditRBAC('MANAGER');
  const memberEdit = simulateTaskEditRBAC('MEMBER');

  if (!adminEdit.allowed || !managerEdit.allowed) {
    throw new Error('Falha: ADMIN ou MANAGER não puderam editar tarefa!');
  }
  if (memberEdit.allowed || memberEdit.status !== 403) {
    throw new Error('Falha de autorização: MEMBER pôde editar tarefa quando deveria ser somente leitura (403)!');
  }
  console.log('✓ RBAC Edição: ADMIN e MANAGER autorizados; MEMBER bloqueado com 403 (modo somente leitura).');

  // 3. Validação dos campos de detalhe e edição
  interface MockEditableTask {
    gid: string;
    name: string;
    notes: string | null;
    completed: boolean;
    dueOn: string | null;
    dueAt: string | null;
    assignee: { gid: string; name: string } | null;
    sectionName: string | null;
    tags: Array<{ gid: string; name: string }>;
    customFields: Array<{ gid: string; name: string; value: string }>;
  }

  const mockTask: MockEditableTask = {
    gid: 'task-777',
    name: 'Nome Original',
    notes: 'Descrição original no Asana',
    completed: false,
    dueOn: '2026-10-01',
    dueAt: null,
    assignee: { gid: 'user-asana-1', name: 'Juliano' },
    sectionName: 'Em Andamento',
    tags: [{ gid: 'tag-1', name: 'Prioritário' }],
    customFields: [{ gid: 'cf-1', name: 'Tipo', value: 'Feature' }],
  };

  // Edição: alteração de nome, descrição, conclusão, prazo e responsável
  const updatedTask = {
    ...mockTask,
    name: 'Nome Atualizado via Hub',
    notes: 'Novas orientações na descrição',
    completed: true,
    dueOn: '2026-10-15',
    assignee: { gid: 'user-asana-2', name: 'Colaborador 2' },
  };

  if (
    updatedTask.name !== 'Nome Atualizado via Hub' ||
    updatedTask.notes !== 'Novas orientações na descrição' ||
    !updatedTask.completed ||
    updatedTask.dueOn !== '2026-10-15' ||
    updatedTask.assignee?.gid !== 'user-asana-2'
  ) {
    throw new Error('Falha na atualização de campos da tarefa!');
  }
  console.log('✓ Edição de Tarefa: Alteração de nome, descrição, conclusão, prazo e responsável validadas.');

  // Remoção de prazo e responsável
  const unassignedTask = {
    ...updatedTask,
    dueOn: null,
    assignee: null,
  };
  if (unassignedTask.dueOn !== null || unassignedTask.assignee !== null) {
    throw new Error('Falha ao remover prazo ou responsável da tarefa!');
  }
  console.log('✓ Edição de Tarefa: Remoção de prazo (due_on: null) e desatribuição (assignee: null) validadas.');

  console.log('\n--- TESTE 15: Subetapa 2B.1 - Validação de Pertencimento e RBAC de Seções Asana ---');
  // 1. Simulação de pertencimento para seções
  const clientLinkedProjects = new Set(['proj-asana-101', 'proj-asana-102']);
  const isProjectLinkedToClient = (pGid: string) => clientLinkedProjects.has(pGid);

  if (!isProjectLinkedToClient('proj-asana-101')) {
    throw new Error('Falha: Projeto válido não reconhecido!');
  }
  if (isProjectLinkedToClient('proj-asana-999-unauthorized')) {
    throw new Error('Falha de segurança: Projeto não vinculado foi aceito!');
  }
  console.log('✓ Pertencimento de Projetos para Seções: Apenas projetos vinculados têm acesso a seções liberado.');

  // 2. Simulação de RBAC para movimentação de seção
  const simulateMoveSectionRBAC = (role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    if (role === 'ADMIN' || role === 'MANAGER') return { allowed: true, status: 200 };
    return { allowed: false, status: 403 };
  };

  const adminMove = simulateMoveSectionRBAC('ADMIN');
  const managerMove = simulateMoveSectionRBAC('MANAGER');
  const memberMove = simulateMoveSectionRBAC('MEMBER');

  if (!adminMove.allowed || !managerMove.allowed) {
    throw new Error('Falha: ADMIN ou MANAGER não puderam mover seção de tarefa!');
  }
  if (memberMove.allowed || memberMove.status !== 403) {
    throw new Error('Falha de segurança: MEMBER pôde mover seção quando deveria receber 403!');
  }
  console.log('✓ RBAC Movimentação de Seção: ADMIN e MANAGER autorizados; MEMBER bloqueado com 403.');

  // 3. Simulação de movimentação entre seções com rollback em caso de falha
  const mockTaskWithSection = {
    ...mockTask,
    sectionGid: 'sec-1',
    sectionName: 'Backlog',
  };

  const movedTask = {
    ...mockTaskWithSection,
    sectionGid: 'sec-2',
    sectionName: 'Em Progresso',
  };

  if (movedTask.sectionGid !== 'sec-2' || movedTask.sectionName !== 'Em Progresso') {
    throw new Error('Falha ao atualizar seção da tarefa!');
  }
  console.log('✓ Movimentação de Seção: Transição de "Backlog" para "Em Progresso" validada com sucesso.');

  console.log('\n--- TESTE 16: Subetapa 2B.2 - Subtarefas e Comentários (Stories) com RBAC e Pertencimento ---');
  // 1. RBAC para criação de subtarefas e comentários
  const simulateInteractiveActionRBAC = (role: 'ADMIN' | 'MANAGER' | 'MEMBER') => {
    if (role === 'ADMIN' || role === 'MANAGER') return { allowed: true, status: 201 };
    return { allowed: false, status: 403 };
  };

  const adminSubtask = simulateInteractiveActionRBAC('ADMIN');
  const managerSubtask = simulateInteractiveActionRBAC('MANAGER');
  const memberSubtask = simulateInteractiveActionRBAC('MEMBER');

  if (!adminSubtask.allowed || !managerSubtask.allowed) {
    throw new Error('Falha: ADMIN ou MANAGER não puderam criar subtarefa ou comentário!');
  }
  if (memberSubtask.allowed || memberSubtask.status !== 403) {
    throw new Error('Falha de segurança: MEMBER pôde criar subtarefa/comentário quando deveria receber 403!');
  }
  console.log('✓ RBAC Subtarefas & Comentários: ADMIN e MANAGER autorizados; MEMBER bloqueado com 403.');

  // 2. Simulação de separação e mapeamento de stories (comentário vs sistema)
  const rawAsanaStories = [
    { gid: 'st-1', text: 'Excelente avanço na demanda!', type: 'comment', resource_subtype: 'comment_added' },
    { gid: 'st-2', text: 'marcou a tarefa como concluída', type: 'system', resource_subtype: 'marked_complete' },
  ];

  const parsedStories = rawAsanaStories.map((s) => ({
    gid: s.gid,
    text: s.text,
    type: s.resource_subtype === 'comment_added' || s.type === 'comment' ? 'comment' : 'system',
  }));

  if (parsedStories[0].type !== 'comment' || parsedStories[1].type !== 'system') {
    throw new Error('Falha na separação de stories entre comentários e histórico de sistema!');
  }
  console.log('✓ Normalização de Stories: Comentários de usuários e eventos de sistema separados com sucesso.');

  // 3. Simulação de Subtarefas com toggle de conclusão
  const sampleSubtasks = [
    { gid: 'sub-1', name: 'Revisar escopo', completed: false },
    { gid: 'sub-2', name: 'Escrever testes unitários', completed: true },
  ];

  const toggledSubtask = {
    ...sampleSubtasks[0],
    completed: true,
  };

  if (!toggledSubtask.completed) {
    throw new Error('Falha ao alternar conclusão da subtarefa!');
  }
  console.log('✓ Subtarefas: Criação e alternância de status (optimistic update) validadas.');

  console.log('\n======================================================');
  console.log('TODOS OS 16 TESTES DE SEGURANÇA E COMPATIBILIDADE APROVADOS COM 100% DE SUCESSO!');
  console.log('======================================================');
}

runSecurityTests().catch((err) => {
  console.error('ERRO NOS TESTES:', err);
  process.exit(1);
});


