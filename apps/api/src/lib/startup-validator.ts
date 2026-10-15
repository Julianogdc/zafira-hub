import { URL } from 'node:url';

/**
 * HM-4a (DEC-HML-005, H5) — Validador de Inicialização Segura e Perfil de Ambiente.
 *
 * Garante que a API do Zafira Hub 2.1 não inicialize em ambiente de produção/homologação com:
 *  - Credenciais ausentes, fracas, curtas ou com valores conhecidos de desenvolvimento;
 *  - Chaves criptográficas em formato inadequado ou reutilizadas entre domínios diferentes;
 *  - Driver de armazenamento inseguro (FILE_STORAGE_DRIVER=local é proibido em produção);
 *  - Endpoints S3 inseguros (http sem TLS é proibido em produção);
 *  - Variáveis condicionais ativadas sem suas dependências de segurança;
 *
 * REGRA ABSOLUTA DE SEGURANÇA:
 *  - NENHUM valor de segredo ou credencial deve ser impresso em mensagens de erro ou logs.
 */

export class StartupValidationError extends Error {
  public readonly errors: string[];

  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = 'StartupValidationError';
    this.errors = errors;
  }
}

export interface StartupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StartupValidationOptions {
  env?: NodeJS.ProcessEnv;
  strictProduction?: boolean;
}

/** Conjunto de valores conhecidos de desenvolvimento, testes e exemplos que NUNCA devem ser aceitos em produção. */
const KNOWN_INSECURE_SECRETS = new Set([
  'zafira_hub_cookie_secret_dev_32bytes_long',
  'zafira_hub_jwt_secret_dev_key_32bytes_long',
  'zafira_hub_default_encryption_key_32b_dev',
  'zafira_hub_oauth_state_secret_key',
  'test_key_32_bytes_long_exact_val_1',
  'different_key_32_bytes_long_val_2',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'ci-integration-encryption-key-0123456789',
  'secret_test_key_123',
  'test-teams-internal-api-key',
  'secret_machine_token_123',
  'secret_internal_key_test',
  'secret_internal_key_org',
  'postgres_staging_secret',
  'changeme',
  'secret',
  'password',
  '12345678',
  'admin',
  'zafira_hub_app',
  'sua_senha_aqui',
  'chave_secreta_longa_para_assinatura_jwt_producao',
  'chave_secreta_longa_para_assinatura_cookie_producao',
  'chave_secreta_interna_para_acesso_a_rotas_privadas',
]);

const S3_BUCKET_NAME_REGEX = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Avalia se um segredo textual possui entropia mínima e comprimento adequado.
 * Nunca expõe o valor avaliado.
 */
function isSecretWeak(secret: string | undefined, minLength = 32): { weak: boolean; reason?: string } {
  if (!secret || typeof secret !== 'string') {
    return { weak: true, reason: 'ausente ou vazio' };
  }

  const trimmed = secret.trim();
  if (trimmed.length === 0) {
    return { weak: true, reason: 'vazio' };
  }

  if (trimmed.length < minLength) {
    return { weak: true, reason: `comprimento insuficiente (mínimo ${minLength} caracteres)` };
  }

  const lower = trimmed.toLowerCase();
  if (KNOWN_INSECURE_SECRETS.has(lower)) {
    return { weak: true, reason: 'utiliza valor conhecido de desenvolvimento ou teste' };
  }

  // Verifica se todos os caracteres são idênticos (baixa entropia, ex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  const firstChar = trimmed[0];
  const allSame = trimmed.split('').every((c) => c === firstChar);
  if (allSame) {
    return { weak: true, reason: 'baixa entropia (caracteres repetidos)' };
  }

  // Verifica substrings óbvias de template ou exemplo
  if (
    lower.includes('staging_secret') ||
    lower.includes('exemplo') ||
    lower.includes('placeholder') ||
    lower.includes('sua_senha')
  ) {
    return { weak: true, reason: 'contém termo demonstrativo inseguro' };
  }

  return { weak: false };
}

/**
 * Valida o formato de uma chave criptográfica (hexadecimal ou string de alta entropia).
 */
function isCryptoKeyValid(key: string | undefined, minBytes = 32): { valid: boolean; reason?: string } {
  const weakCheck = isSecretWeak(key, minBytes);
  if (weakCheck.weak) {
    return { valid: false, reason: weakCheck.reason };
  }

  const trimmed = key!.trim();
  // Se for hexadecimal (ex: 64 caracteres para 32 bytes)
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    const byteLength = trimmed.length / 2;
    if (byteLength < minBytes) {
      return { valid: false, reason: `chave hexadecimal com comprimento em bytes insuficiente (${byteLength} < ${minBytes} bytes)` };
    }
  }

  return { valid: true };
}

/**
 * Executa a validação de inicialização do ambiente de forma centralizada e sem vazamento de segredos.
 */
export function validateStartupEnvironment(options?: StartupValidationOptions): StartupValidationResult {
  const env = options?.env ?? process.env;
  const isProduction = options?.strictProduction ?? (env.NODE_ENV === 'production');

  const errors: string[] = [];
  const warnings: string[] = [];

  // Em ambientes de desenvolvimento/teste sem strictProduction, não bloqueamos o boot
  if (!isProduction) {
    return { valid: true, errors: [], warnings: [] };
  }

  // ============================================================================
  // 1. SEGREDOS CRIPTOGRÁFICOS GLOBAIS DE PRODUÇÃO (OBRIGATÓRIOS)
  // ============================================================================

  // 1.1 JWT_SECRET
  const jwtCheck = isSecretWeak(env.JWT_SECRET, 32);
  if (jwtCheck.weak) {
    errors.push(`JWT_SECRET inválido: ${jwtCheck.reason}.`);
  }

  // 1.2 COOKIE_SECRET
  const cookieCheck = isSecretWeak(env.COOKIE_SECRET, 32);
  if (cookieCheck.weak) {
    errors.push(`COOKIE_SECRET inválido: ${cookieCheck.reason}.`);
  }

  // 1.3 INTEGRATION_ENCRYPTION_KEY (para criptografia AES-256 de credenciais de integração)
  const encKeyCheck = isCryptoKeyValid(env.INTEGRATION_ENCRYPTION_KEY, 32);
  if (!encKeyCheck.valid) {
    errors.push(`INTEGRATION_ENCRYPTION_KEY inválida: ${encKeyCheck.reason}.`);
  }

  // 1.4 APPROVAL_MEDIA_SECRET (para assinatura HMAC de links de aprovação pública)
  const approvalCheck = isSecretWeak(env.APPROVAL_MEDIA_SECRET, 32);
  if (approvalCheck.weak) {
    errors.push(`APPROVAL_MEDIA_SECRET inválido: ${approvalCheck.reason}.`);
  }

  // 1.5 Defesa em profundidade: Segregação de Chaves Criptográficas
  // Segredos críticos não devem ser idênticos entre si (evita ataque de reutilização de chave entre subsistemas)
  if (env.JWT_SECRET && env.COOKIE_SECRET && env.JWT_SECRET === env.COOKIE_SECRET) {
    errors.push('JWT_SECRET e COOKIE_SECRET não podem ser idênticos (exige segregação de segredos).');
  }
  if (env.INTEGRATION_ENCRYPTION_KEY && env.JWT_SECRET && env.INTEGRATION_ENCRYPTION_KEY === env.JWT_SECRET) {
    errors.push('INTEGRATION_ENCRYPTION_KEY e JWT_SECRET não podem ser idênticos.');
  }
  if (env.APPROVAL_MEDIA_SECRET && env.JWT_SECRET && env.APPROVAL_MEDIA_SECRET === env.JWT_SECRET) {
    errors.push('APPROVAL_MEDIA_SECRET e JWT_SECRET não podem ser idênticos.');
  }

  // 1.6 HUB_INTERNAL_API_KEY (segredo de máquina opcional ou condicional)
  if (env.HUB_INTERNAL_API_KEY) {
    const hubKeyCheck = isSecretWeak(env.HUB_INTERNAL_API_KEY, 32);
    if (hubKeyCheck.weak) {
      errors.push(`HUB_INTERNAL_API_KEY definida com valor inválido: ${hubKeyCheck.reason}.`);
    }
  }

  // ============================================================================
  // 2. BANCO DE DADOS (DATABASE_URL)
  // ============================================================================
  const dbUrl = (env.DATABASE_URL ?? '').trim();
  if (!dbUrl) {
    errors.push('DATABASE_URL é obrigatória em ambiente de produção e não pode ser vazia.');
  } else {
    try {
      const u = new URL(dbUrl);
      if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
        errors.push("DATABASE_URL deve utilizar o protocolo 'postgresql:' ou 'postgres:'.");
      }
      if (u.password && KNOWN_INSECURE_SECRETS.has(u.password.toLowerCase())) {
        errors.push('DATABASE_URL utiliza senha padrão ou conhecida de desenvolvimento/teste.');
      }
    } catch {
      errors.push('DATABASE_URL possui formato de URL inválido.');
    }
  }

  // ============================================================================
  // 3. ARMAZENAMENTO DE ARQUIVOS (FILE_STORAGE_DRIVER & S3)
  // ============================================================================
  const storageDriver = (env.FILE_STORAGE_DRIVER ?? '').trim().toLowerCase();
  if (storageDriver === 'local') {
    errors.push("FILE_STORAGE_DRIVER 'local' é terminantemente proibido em ambiente de produção/homologação. Utilize 's3'.");
  } else if (storageDriver !== 's3') {
    errors.push("FILE_STORAGE_DRIVER deve ser configurado explicitamente como 's3' em produção/homologação.");
  } else {
    // Validação estrita do driver S3
    const bucket = (env.FILE_STORAGE_S3_BUCKET ?? '').trim();
    if (!bucket) {
      errors.push('FILE_STORAGE_S3_BUCKET é obrigatório para o driver S3 em produção.');
    } else if (!S3_BUCKET_NAME_REGEX.test(bucket)) {
      errors.push('FILE_STORAGE_S3_BUCKET contém nome de bucket inválido conforme as regras S3.');
    }

    const accessKeyId = (env.FILE_STORAGE_S3_ACCESS_KEY_ID ?? '').trim();
    if (!accessKeyId) {
      errors.push('FILE_STORAGE_S3_ACCESS_KEY_ID é obrigatório para o driver S3.');
    }

    const secretKey = (env.FILE_STORAGE_S3_SECRET_ACCESS_KEY ?? '').trim();
    if (!secretKey) {
      errors.push('FILE_STORAGE_S3_SECRET_ACCESS_KEY é obrigatório para o driver S3.');
    } else if (secretKey.length < 16) {
      errors.push('FILE_STORAGE_S3_SECRET_ACCESS_KEY possui comprimento insuficiente.');
    }

    const endpointRaw = (env.FILE_STORAGE_S3_ENDPOINT ?? '').trim();
    const allowInsecure = env.FILE_STORAGE_S3_ALLOW_INSECURE === 'true';

    if (allowInsecure) {
      errors.push('FILE_STORAGE_S3_ALLOW_INSECURE=true é expressamente proibido em ambiente de produção.');
    }

    if (endpointRaw) {
      try {
        const u = new URL(endpointRaw);
        if (u.protocol !== 'https:') {
          errors.push('FILE_STORAGE_S3_ENDPOINT deve utilizar estritamente o protocolo HTTPS em ambiente de produção.');
        }
        if (u.username || u.password) {
          errors.push('FILE_STORAGE_S3_ENDPOINT não pode conter credenciais embutidas na URL.');
        }
      } catch {
        errors.push('FILE_STORAGE_S3_ENDPOINT possui formato de URL inválido.');
      }
    } else if (!env.FILE_STORAGE_S3_REGION || env.FILE_STORAGE_S3_REGION.trim() === '') {
      errors.push('Armazenamento S3 exige configuração de FILE_STORAGE_S3_ENDPOINT ou FILE_STORAGE_S3_REGION.');
    }
  }

  // ============================================================================
  // 4. VARIÁVEIS CONDICIONAIS DE AGENDADORES E INTEGRAÇÕES
  // ============================================================================

  // 4.1 Sincronização da Agenda Google
  if (env.GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED === 'true') {
    const hmacKey = env.CALENDAR_IDENTITY_HMAC_KEY;
    const hmacCheck = isSecretWeak(hmacKey, 32);
    if (hmacCheck.weak) {
      errors.push(`GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED está ativo mas CALENDAR_IDENTITY_HMAC_KEY é inválido: ${hmacCheck.reason}.`);
    }
  }

  // 4.2 Despachante de Automações n8n
  if (env.N8N_DISPATCH_ENABLED === 'true') {
    const callbackUrl = (env.N8N_CALLBACK_BASE_URL ?? '').trim();
    if (!callbackUrl) {
      errors.push('N8N_DISPATCH_ENABLED está ativo mas N8N_CALLBACK_BASE_URL não está configurada.');
    } else {
      try {
        const u = new URL(callbackUrl);
        const allowHttp = env.N8N_ALLOW_INSECURE_HTTP === 'true';
        if (u.protocol !== 'https:' && !allowHttp) {
          errors.push('N8N_CALLBACK_BASE_URL deve utilizar HTTPS em produção.');
        }
      } catch {
        errors.push('N8N_CALLBACK_BASE_URL possui formato de URL inválido.');
      }
    }

    const allowedHosts = (env.N8N_ALLOWED_HOSTS ?? '').trim();
    if (!allowedHosts) {
      errors.push('N8N_DISPATCH_ENABLED está ativo mas N8N_ALLOWED_HOSTS não está configurada.');
    }
  }

  // 4.3 Despachante de Publicação Social
  if (env.PUBLICATION_DISPATCH_ENABLED === 'true') {
    const bbUrl = (env.BRIGHTBEAN_API_URL ?? '').trim();
    if (!bbUrl) {
      errors.push('PUBLICATION_DISPATCH_ENABLED está ativo mas BRIGHTBEAN_API_URL não está configurada.');
    } else {
      try {
        const u = new URL(bbUrl);
        if (u.protocol !== 'https:') {
          errors.push('BRIGHTBEAN_API_URL deve utilizar HTTPS em produção quando o despachante estiver habilitado.');
        }
      } catch {
        errors.push('BRIGHTBEAN_API_URL possui formato de URL inválido.');
      }
    }
  }

  const valid = errors.length === 0;

  if (!valid) {
    throw new StartupValidationError(
      `Falha na validação de inicialização do ambiente (${errors.length} erro(s) crítico(s)):\n - ${errors.join('\n - ')}`,
      errors
    );
  }

  return { valid, errors, warnings };
}
