import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStartupEnvironment,
  StartupValidationError,
} from '../startup-validator.js';

// Base mock válida para testes de homologação/produção
function createValidProductionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app_user:c0mpl3x_R4nd0m_P4ssw0rd_987654321@db-host:5432/hub_staging?schema=public',
    JWT_SECRET: 'k9#mP2$vL5*nQ8@xZ1!wR4&yT7^bC0(uJ3)', // 35 chars
    COOKIE_SECRET: 'd8@fG2#hJ5*kL7!mN9^pQ1&rS3(tV6_wY0)', // 35 chars, distinto de JWT_SECRET
    INTEGRATION_ENCRYPTION_KEY: 'e1a4c8f3b7d2e6a9f0c5b8d1e4a7f2c9e1a4c8f3b7d2e6a9f0c5b8d1e4a7f2c9', // 64 hex chars
    APPROVAL_MEDIA_SECRET: 'z3!xC5@vB7#nM9$lK1%jH3^gF5&dD7*sA9)', // 35 chars, exclusivo
    FILE_STORAGE_DRIVER: 's3',
    FILE_STORAGE_S3_BUCKET: 'zafira-hub-staging-bucket',
    FILE_STORAGE_S3_ACCESS_KEY_ID: 'AKIA_VALID_ACCESS_KEY_EXAMPLE_ID',
    FILE_STORAGE_S3_SECRET_ACCESS_KEY: 's3cr3t_4cc3ss_k3y_v4l1d_h1gh_3ntr0py',
    FILE_STORAGE_S3_ENDPOINT: 'https://staging-account.r2.cloudflarestorage.com',
    FILE_STORAGE_S3_REGION: 'auto',
    // Schedulers desligados por padrão
    ASANA_MIRROR_SCHEDULE_ENABLED: 'false',
    GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED: 'false',
    N8N_DISPATCH_ENABLED: 'false',
    PUBLICATION_DISPATCH_ENABLED: 'false',
    PUBLICATION_METRICS_ENABLED: 'false',
  };
}

test('startup-validator (HM-4a) — ambiente de desenvolvimento não bloqueia inicialização', () => {
  const devEnv = {
    NODE_ENV: 'development',
  };

  const result = validateStartupEnvironment({ env: devEnv });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('startup-validator (HM-4a) — configuração válida de homologação/produção é aprovada integralmente', () => {
  const env = createValidProductionEnv();
  const result = validateStartupEnvironment({ env });

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('startup-validator (HM-4a) — CI_SMOKE_TEST ou ALLOW_UNCONFIGURED_STORAGE_IN_SMOKE não permitem bypass em NODE_ENV=production', () => {
  const base = createValidProductionEnv();

  // 1. CI_SMOKE_TEST=true sem storage S3 deve falhar estritamente
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        FILE_STORAGE_DRIVER: '',
        CI_SMOKE_TEST: 'true',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_DRIVER é obrigatório em ambiente de produção\/homologação/);
      return true;
    }
  );

  // 2. ALLOW_UNCONFIGURED_STORAGE_IN_SMOKE=true sem storage S3 deve falhar estritamente
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        FILE_STORAGE_DRIVER: '',
        ALLOW_UNCONFIGURED_STORAGE_IN_SMOKE: 'true',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_DRIVER é obrigatório em ambiente de produção\/homologação/);
      return true;
    }
  );

  // 3. CI_SMOKE_TEST=true sem INTEGRATION_ENCRYPTION_KEY deve falhar estritamente
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        INTEGRATION_ENCRYPTION_KEY: undefined,
        CI_SMOKE_TEST: 'true',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /INTEGRATION_ENCRYPTION_KEY é obrigatória no perfil de homologação\/produção/);
      return true;
    }
  );

  // 4. CI_SMOKE_TEST=true sem APPROVAL_MEDIA_SECRET deve falhar estritamente
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        APPROVAL_MEDIA_SECRET: undefined,
        CI_SMOKE_TEST: 'true',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /APPROVAL_MEDIA_SECRET é obrigatória no perfil de homologação\/produção/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — configuração sintética de teste do CI (S3 fictício HTTPS e chaves exclusivas) é aceita', () => {
  const syntheticSmokeEnv = {
    NODE_ENV: 'production',
    PORT: '3001',
    COOKIE_SECRET: 'ci-smoke-cookie-secret-min-32-chars-long',
    JWT_SECRET: 'ci-smoke-jwt-secret-min-32-chars-length',
    HUB_INTERNAL_API_KEY: 'ci-smoke-internal-api-key-min-32-chars',
    INTEGRATION_ENCRYPTION_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    APPROVAL_MEDIA_SECRET: 'ci-smoke-approval-media-key-min-32-chars',
    CALENDAR_IDENTITY_HMAC_KEY: 'ci-smoke-calendar-hmac-key-min-32-chars',
    FILE_STORAGE_DRIVER: 's3',
    FILE_STORAGE_S3_BUCKET: 'ci-smoke-synthetic-bucket',
    FILE_STORAGE_S3_ENDPOINT: 'https://s3.ci-smoke.synthetic.internal',
    FILE_STORAGE_S3_REGION: 'auto',
    FILE_STORAGE_S3_ACCESS_KEY_ID: 'ci-smoke-synthetic-access-key-id',
    FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'ci-smoke-synthetic-secret-key-32ch',
    BRIGHTBEAN_API_URL: 'http://brightbean-mock:8000/api/v1',
    DATABASE_URL: 'postgresql://smoke:smoke@localhost:5432/smoke?schema=public',
  };

  const result = validateStartupEnvironment({ env: syntheticSmokeEnv });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('startup-validator (HM-4a) — rejeita segredos obrigatórios ausentes em produção', () => {
  const base = createValidProductionEnv();

  // 1. JWT_SECRET ausente
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, JWT_SECRET: '' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /JWT_SECRET inválido/);
      return true;
    }
  );

  // 2. COOKIE_SECRET ausente
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, COOKIE_SECRET: undefined } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /COOKIE_SECRET inválido/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — rejeita segredos com valores conhecidos de desenvolvimento/teste', () => {
  const base = createValidProductionEnv();

  // JWT de exemplo
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, JWT_SECRET: 'zafira_hub_jwt_secret_dev_key_32bytes_long' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /JWT_SECRET inválido: utiliza valor conhecido/);
      return true;
    }
  );

  // Cookie de exemplo
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, COOKIE_SECRET: 'zafira_hub_cookie_secret_dev_32bytes_long' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /COOKIE_SECRET inválido: utiliza valor conhecido/);
      return true;
    }
  );

  // Encryption key de exemplo CI
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, INTEGRATION_ENCRYPTION_KEY: 'ci-integration-encryption-key-0123456789' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /INTEGRATION_ENCRYPTION_KEY inválida: utiliza valor conhecido/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — rejeita segredos curtos ou com baixa entropia (repetição)', () => {
  const base = createValidProductionEnv();

  // Curto (< 32 caracteres)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, JWT_SECRET: 'curto_demais_para_producao_123' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /comprimento insuficiente/);
      return true;
    }
  );

  // Baixa entropia (caracteres repetidos)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, COOKIE_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /baixa entropia/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — exige INTEGRATION_ENCRYPTION_KEY válida no perfil de homologação/produção', () => {
  const base = createValidProductionEnv();

  // 1. Ausente em produção sem flag de smoke test
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, INTEGRATION_ENCRYPTION_KEY: undefined } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /INTEGRATION_ENCRYPTION_KEY é obrigatória no perfil de homologação\/produção/);
      return true;
    }
  );

  // 2. Chave hexadecimal curta (< 32 bytes)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, INTEGRATION_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef' } }), // 32 hex chars = 16 bytes (< 32 bytes)
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /chave hexadecimal com comprimento em bytes insuficiente/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — exige APPROVAL_MEDIA_SECRET dedicada própria no perfil de homologação/produção', () => {
  const base = createValidProductionEnv();

  // 1. Ausente em produção sem flag de smoke test (proíbe fallback)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, APPROVAL_MEDIA_SECRET: undefined } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /APPROVAL_MEDIA_SECRET é obrigatória no perfil de homologação\/produção/);
      return true;
    }
  );

  // 2. Curta (< 32 caracteres)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, APPROVAL_MEDIA_SECRET: 'chave_curta_apenas_20_c' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /APPROVAL_MEDIA_SECRET inválido: comprimento insuficiente/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — exige segregação estrita total entre segredos criptográficos ativos', () => {
  const base = createValidProductionEnv();
  const duplicatedSecret = 'segredo_compartilhado_extremamente_longo_e_forte_32b!';

  // Caso 1: JWT_SECRET e COOKIE_SECRET idênticos
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        JWT_SECRET: duplicatedSecret,
        COOKIE_SECRET: duplicatedSecret,
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /Violação de segregação de segredos criptográficos: JWT_SECRET e COOKIE_SECRET não podem ser idênticos/);
      return true;
    }
  );

  // Caso 2: COOKIE_SECRET e INTEGRATION_ENCRYPTION_KEY idênticos
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        COOKIE_SECRET: duplicatedSecret,
        INTEGRATION_ENCRYPTION_KEY: duplicatedSecret,
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /Violação de segregação de segredos criptográficos: COOKIE_SECRET e INTEGRATION_ENCRYPTION_KEY não podem ser idênticos/);
      return true;
    }
  );

  // Caso 3: APPROVAL_MEDIA_SECRET e JWT_SECRET idênticos
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        APPROVAL_MEDIA_SECRET: duplicatedSecret,
        JWT_SECRET: duplicatedSecret,
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /Violação de segregação de segredos criptográficos: JWT_SECRET e APPROVAL_MEDIA_SECRET não podem ser idênticos/);
      return true;
    }
  );

  // Caso 4: HUB_INTERNAL_API_KEY e JWT_SECRET idênticos
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        HUB_INTERNAL_API_KEY: duplicatedSecret,
        JWT_SECRET: duplicatedSecret,
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /Violação de segregação de segredos criptográficos: JWT_SECRET e HUB_INTERNAL_API_KEY não podem ser idênticos/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — validação de STORAGE: ausente, desconhecido e local', () => {
  const base = createValidProductionEnv();

  // 1. FILE_STORAGE_DRIVER ausente em produção sem smoke test (deve falhar explicitamente)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_DRIVER: '' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_DRIVER é obrigatório em ambiente de produção\/homologação/);
      return true;
    }
  );

  // 2. FILE_STORAGE_DRIVER com valor desconhecido (ex: 'ftp' ou 'custom') — não reproduz o valor bruto
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_DRIVER: 'ftp' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_DRIVER possui valor inválido ou desconhecido/);
      assert.equal(err.message.includes('ftp'), false);
      return true;
    }
  );

  // 3. FILE_STORAGE_DRIVER='local' em produção (terminantemente proibido)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_DRIVER: 'local' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_DRIVER 'local' é terminantemente proibido em ambiente de produção\/homologação/);
      return true;
    }
  );

  // 4. FILE_STORAGE_DRIVER='local' mesmo com CI_SMOKE_TEST=true continua proibido
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_DRIVER: 'local', CI_SMOKE_TEST: 'true' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_DRIVER 'local' é terminantemente proibido/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — validação estrita de configuração S3 e rejeição de HTTP inseguro', () => {
  const base = createValidProductionEnv();

  // Bucket com caracteres inválidos
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_S3_BUCKET: 'Bucket_Invalido_Com_Maiusculas' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_S3_BUCKET contém nome de bucket inválido/);
      return true;
    }
  );

  // Endpoint S3 sem HTTPS (inseguro)
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_S3_ENDPOINT: 'http://minio.local:9000' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_S3_ENDPOINT deve utilizar estritamente o protocolo HTTPS/);
      return true;
    }
  );

  // FILE_STORAGE_S3_ALLOW_INSECURE em produção
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_S3_ALLOW_INSECURE: 'true' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_S3_ALLOW_INSECURE=true é expressamente proibido/);
      return true;
    }
  );

  // Endpoint contendo credenciais na URL
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_S3_ENDPOINT: 'https://user:secret@r2.cloudflarestorage.com' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /FILE_STORAGE_S3_ENDPOINT não pode conter credenciais embutidas/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — validação estrita de DATABASE_URL e rejeição de senhas fracas', () => {
  const base = createValidProductionEnv();

  // DATABASE_URL ausente
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, DATABASE_URL: '' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /DATABASE_URL é obrigatória/);
      return true;
    }
  );

  // Protocolo não postgres
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, DATABASE_URL: 'mysql://root:pass@localhost:3306/db' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /DATABASE_URL deve utilizar o protocolo 'postgresql:' ou 'postgres:'/);
      return true;
    }
  );

  // Senha de teste padrão de staging
  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, DATABASE_URL: 'postgresql://postgres:postgres_staging_secret@db:5432/hub' } }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /DATABASE_URL utiliza senha padrão ou conhecida/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — validações condicionais quando agendadores estão habilitados', () => {
  const base = createValidProductionEnv();

  // 1. Google Calendar ativado sem chave HMAC de identidade
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED: 'true',
        CALENDAR_IDENTITY_HMAC_KEY: '',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED está ativo mas CALENDAR_IDENTITY_HMAC_KEY é inválido/);
      return true;
    }
  );

  // 2. n8n ativado sem callback URL
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        N8N_DISPATCH_ENABLED: 'true',
        N8N_CALLBACK_BASE_URL: '',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /N8N_DISPATCH_ENABLED está ativo mas N8N_CALLBACK_BASE_URL não está configurada/);
      return true;
    }
  );

  // 3. n8n ativado com callback URL HTTP (sem HTTPS)
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        N8N_DISPATCH_ENABLED: 'true',
        N8N_CALLBACK_BASE_URL: 'http://n8n.internal.local/webhook',
        N8N_ALLOWED_HOSTS: 'n8n.internal.local',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /N8N_CALLBACK_BASE_URL deve utilizar HTTPS em produção/);
      return true;
    }
  );

  // 4. Publicação ativada sem URL do BrightBean
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        PUBLICATION_DISPATCH_ENABLED: 'true',
        BRIGHTBEAN_API_URL: '',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /PUBLICATION_DISPATCH_ENABLED está ativo mas BRIGHTBEAN_API_URL não está configurada/);
      return true;
    }
  );

  // 5. Métricas de publicação ativadas sem URL do BrightBean (HM-4b)
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        PUBLICATION_METRICS_ENABLED: 'true',
        BRIGHTBEAN_API_URL: '',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /PUBLICATION_METRICS_ENABLED está ativo mas BRIGHTBEAN_API_URL não está configurada/);
      return true;
    }
  );

  // 6. Ambos despachante e métricas ativados sem URL do BrightBean (HM-4b)
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        PUBLICATION_DISPATCH_ENABLED: 'true',
        PUBLICATION_METRICS_ENABLED: 'true',
        BRIGHTBEAN_API_URL: '',
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /PUBLICATION_DISPATCH_ENABLED e PUBLICATION_METRICS_ENABLED estão ativos mas BRIGHTBEAN_API_URL não está configurada/);
      return true;
    }
  );
});

test('startup-validator (HM-4a) — compatibilidade com funcionalidades opcionais desativadas', () => {
  const base = createValidProductionEnv();

  // Com os 4 schedulers desativados ("false"), chaves de calendar, n8n, brightbean podem ficar ausentes
  const env = {
    ...base,
    CALENDAR_IDENTITY_HMAC_KEY: '',
    N8N_CALLBACK_BASE_URL: '',
    N8N_ALLOWED_HOSTS: '',
    BRIGHTBEAN_API_URL: '',
    ASANA_CLIENT_ID: '',
  };

  const result = validateStartupEnvironment({ env });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('startup-validator (HM-4a) — NENHUM segredo é exposto nas mensagens de erro (Sanitização Absoluta)', () => {
  const base = createValidProductionEnv();
  const sensitiveShortSecret = 'v4z4m3nt0_curt0_invalido'; // 24 chars (< 32 chars)

  try {
    validateStartupEnvironment({
      env: {
        ...base,
        JWT_SECRET: sensitiveShortSecret,
      },
    });
    assert.fail('Deveria ter lançado erro');
  } catch (err: any) {
    assert(err instanceof StartupValidationError);
    // Garante que o valor do segredo NÃO está na mensagem nem no array de erros
    assert.equal(err.message.includes(sensitiveShortSecret), false);
    for (const errorStr of err.errors) {
      assert.equal(errorStr.includes(sensitiveShortSecret), false);
    }
  }
});
