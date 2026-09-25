import fs from 'fs';
import { integrationConnectionService } from '../modules/integrations/connections/integration-connection.service.js';

/**
 * Script de provisionamento seguro da IntegrationConnection da BrightBean.
 *
 * REGRAS DE GOVERNANÇA E SEGURANÇA:
 * - Default: DRY RUN (somente leitura / planejamento).
 * - Modificações reais no banco somente com a flag explícita --apply.
 * - NUNCA imprimir API key no console ou em logs.
 * - Suporta leitura opcional de hiddenPostIds de arquivo JSON.
 */
async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');

  const organizationId =
    process.env.ORGANIZATION_ID ||
    args.find((a) => a.startsWith('--org-id='))?.split('=')[1];

  const workspaceId =
    process.env.BRIGHTBEAN_WORKSPACE_ID ||
    args.find((a) => a.startsWith('--workspace-id='))?.split('=')[1];

  const apiKey =
    process.env.BRIGHTBEAN_API_KEY ||
    args.find((a) => a.startsWith('--api-key='))?.split('=')[1];

  const hiddenPostsFile =
    process.env.BRIGHTBEAN_HIDDEN_POST_IDS_FILE ||
    args.find((a) => a.startsWith('--hidden-posts-file='))?.split('=')[1];

  console.log('====================================================');
  console.log(' PROVISIONAMENTO DA CONEXÃO BRIGHTBEAN NO HUB');
  console.log(` MODO: ${isApply ? 'APPLY (ESCRITA NO BANCO)' : 'DRY RUN (SOMENTE LEITURA)'}`);
  console.log('====================================================');

  if (!organizationId) {
    console.error('ERRO: ORGANIZATION_ID não informado (via env ou --org-id).');
    process.exit(1);
  }

  if (!workspaceId) {
    console.error('ERRO: BRIGHTBEAN_WORKSPACE_ID não informado (via env ou --workspace-id).');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('ERRO: BRIGHTBEAN_API_KEY não informada (via env ou --api-key).');
    process.exit(1);
  }

  let hiddenPostIds: string[] = [];
  if (hiddenPostsFile) {
    if (!fs.existsSync(hiddenPostsFile)) {
      console.error(`ERRO: Arquivo de hiddenPostIds não encontrado: ${hiddenPostsFile}`);
      process.exit(1);
    }
    try {
      const raw = fs.readFileSync(hiddenPostsFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        hiddenPostIds = parsed.map(String);
      }
    } catch (err: any) {
      console.error(`ERRO ao ler arquivo de hiddenPostIds: ${err?.message}`);
      process.exit(1);
    }
  }

  console.log(`Organization ID:    ${organizationId}`);
  console.log(`Workspace ID:       ${workspaceId}`);
  console.log(`API Key:            [CONFIGURADA - ${apiKey.length} caracteres - NÃO EXIBIDA]`);
  console.log(`Hidden Post IDs:    ${hiddenPostIds.length} IDs carregados`);
  console.log(`Provider:           BRIGHTBEAN`);
  console.log(`Auth Type:          API_KEY`);

  if (!isApply) {
    console.log('\n[DRY RUN] Nenhuma alteração foi realizada no banco de dados.');
    console.log('Para persistir a conexão, execute novamente com o argumento --apply');
    process.exit(0);
  }

  console.log('\nAplicando upsert da IntegrationConnection...');
  const result = await integrationConnectionService.upsertConnection({
    organizationId,
    clientId: null,
    provider: 'BRIGHTBEAN',
    authType: 'API_KEY',
    externalAccountId: workspaceId,
    displayName: 'BrightBean Studio (Workspace)',
    rawCredential: apiKey,
    status: 'ACTIVE',
    metadata: {
      hiddenPostIds,
      provisionedBy: 'script:provision-brightbean-connection',
      provisionedAt: new Date().toISOString(),
    },
  });

  console.log('Sucesso! Conexão provisionada com sucesso:');
  console.log(`ID da Conexão:      ${result.id}`);
  console.log(`Status:             ${result.status}`);
  console.log(`ExternalScopeId:    ${result.externalScopeId}`);
  console.log(`HasCredential:      ${result.hasCredential}`);
}

main().catch((err) => {
  console.error('Falha fatal no script de provisionamento:', err?.message || err);
  process.exit(1);
});
