import { encryptToken, decryptToken } from '../crypto.js';
import { generateOAuthState, verifyOAuthState } from '../oauthState.js';

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

  // Teste de adulteração (Auth Tag mismatch)
  console.log('\n--- TESTE 2: Detecção de Adulteração (Tampering) ---');
  const tampered = encrypted.slice(0, -4) + 'abcd';
  let tamperedDetected = false;
  try {
    decryptToken(tampered);
  } catch (err: any) {
    tamperedDetected = true;
    console.log('✓ Adulteração detectada e rejeitada com sucesso pelo GCM Auth Tag:', err.message);
  }
  if (!tamperedDetected) {
    throw new Error('Falha crítica: GCM aceitou dado adulterado sem erro!');
  }

  // Teste de OAuth State
  console.log('\n--- TESTE 3: Geração e Validação de OAuth State ---');
  const orgId = 'org-uuid-zafira-123';
  const userId = 'user-uuid-juliano-456';
  const { stateParam, cookieNonce } = generateOAuthState(orgId, userId);
  console.log('State Param:', stateParam);
  console.log('Cookie Nonce:', cookieNonce);

  const verified = verifyOAuthState(stateParam, cookieNonce);
  if (verified.organizationId !== orgId || verified.userId !== userId) {
    throw new Error('Falha: Dados verificados do state não coincidem!');
  }
  console.log('✓ OAuth State válido e verificado com sucesso!');

  // Teste de State adulterado (CSRF)
  console.log('\n--- TESTE 4: Rejeição de CSRF / State Adulterado ---');
  const forgedState = stateParam.slice(0, -6) + 'xxxxxx';
  let forgedDetected = false;
  try {
    verifyOAuthState(forgedState, cookieNonce);
  } catch (err: any) {
    forgedDetected = true;
    console.log('✓ CSRF/State forjado rejeitado:', err.message);
  }
  if (!forgedDetected) {
    throw new Error('Falha crítica: State forjado foi aceito!');
  }

  // Teste de Nonce divergente (navegador diferente)
  console.log('\n--- TESTE 5: Rejeição de Cookie Nonce Divergente ---');
  let nonceMismatchDetected = false;
  try {
    verifyOAuthState(stateParam, 'nonce_falso_de_outro_browser');
  } catch (err: any) {
    nonceMismatchDetected = true;
    console.log('✓ Nonce divergente rejeitado:', err.message);
  }
  if (!nonceMismatchDetected) {
    throw new Error('Falha crítica: Nonce divergente foi aceito!');
  }

  console.log('\n========================================');
  console.log('TODOS OS TESTES DE SEGURANÇA PASSARAM COM 100% DE SUCESSO!');
  console.log('========================================');
}

runSecurityTests().catch((err) => {
  console.error('ERRO NOS TESTES:', err);
  process.exit(1);
});
