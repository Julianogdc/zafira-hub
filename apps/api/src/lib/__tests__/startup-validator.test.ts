import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStartupEnvironment,
  StartupValidationError,
} from '../startup-validator.js';

// Base mock válida para testes de produção
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

test('startup-validator (HM-4a) — configuração válida de produção é aprovada integralmente', () => {
  const env = createValidProductionEnv();
  const result = validateStartupEnvironment({ env });

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('startup-validator (HM-4a) — configuração de smoke test do CI (healthcheck) é aceita', () => {
  const smokeEnv = {
    NODE_ENV: 'production',
    PORT: '3001',
    COOKIE_SECRET: 'smoke-test-dummy-cookie-secret-32-chars-long',
    JWT_SECRET: 'smoke-test-dummy-jwt-secret-at-least-32-chars',
    HUB_INTERNAL_API_KEY: 'smoke-test-dummy-internal-api-key-12345',
    BRIGHTBEAN_API_URL: 'http://brightbean-mock:8000/api/v1',
    DATABASE_URL: 'postgresql://smoke:smoke@localhost:5432/smoke?schema=public',
  };

  const result = validateStartupEnvironment({ env: smokeEnv });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert(result.warnings.length > 0); // Contém avisos orientativos sobre S3 e chaves de integração
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

test('startup-validator (HM-4a) — exige segregação de segredos criptográficos (chaves não podem ser idênticas)', () => {
  const base = createValidProductionEnv();
  const duplicatedSecret = 'segredo_compartilhado_extremamente_longo_e_forte_32b!';

  // JWT e Cookie idênticos
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
      assert.match(err.message, /JWT_SECRET e COOKIE_SECRET não podem ser idênticos/);
      return true;
    }
  );

  // Encryption key e JWT idênticos
  assert.throws(
    () => validateStartupEnvironment({
      env: {
        ...base,
        INTEGRATION_ENCRYPTION_KEY: duplicatedSecret,
        JWT_SECRET: duplicatedSecret,
      },
    }),
    (err: any) => {
      assert(err instanceof StartupValidationError);
      assert.match(err.message, /INTEGRATION_ENCRYPTION_KEY e JWT_SECRET não podem ser idênticos/);
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

test('startup-validator (HM-4a) — rejeita terminantemente driver de arquivo local em produção', () => {
  const base = createValidProductionEnv();

  assert.throws(
    () => validateStartupEnvironment({ env: { ...base, FILE_STORAGE_DRIVER: 'local' } }),
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
