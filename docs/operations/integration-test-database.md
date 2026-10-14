# Banco dos testes de integração: proteção e repetibilidade

> HM-1 / H3 (P18, DEC-HML-001).

## Regras do banco de testes

`npm run test:integration:db` (e o script `ci:prepare-rbac-organizations`) só operam quando **todas** as condições valem (módulo único `apps/api/src/lib/test-database-guard.ts`, usado por todos os arquivos de teste):

| Condição | Efeito se falhar |
|---|---|
| `NODE_ENV` diferente de `production` | recusa |
| `ZAFIRA_TEST_DATABASE=1` (exatamente) | recusa |
| `DATABASE_URL` válida, protocolo `postgres(ql)` | recusa |
| nome do banco **exatamente** `zafira_hub_ci` (sem prefixo, sufixo ou parâmetro enganoso) | recusa |
| host `localhost`, `127.0.0.1`, `::1` ou listado em `ZAFIRA_TEST_DB_ALLOWED_HOSTS` | recusa |
| (antes de qualquer limpeza destrutiva) toda organização do banco tem slug `ci-*` | recusa |

As mensagens de erro nunca imprimem senha nem a URL completa. Substitui a verificação antiga por trecho de texto (`includes('/zafira_hub_ci')`), que aceitava, por exemplo, `zafira_hub_ci_prod`.

## Repetibilidade (P18)

Causa: `rbac-postgres.test.ts` usa as organizações fixas `ci-org-a`/`ci-org-b` e deixava estado alterado (configuração da organização em outro fuso e moeda, logs de auditoria que mudavam a contagem esperada), então a segunda execução falhava nos testes P e Q.

Correção:
- ao iniciar, o arquivo devolve ao estado-base somente o que ele próprio altera nessas duas organizações (configuração, flags, exceções individuais, logs de auditoria, equipes, clientes e usuários transitórios), depois de passar pelas travas acima;
- a permissão removida no teste M é restaurada em `finally`;
- as asserções do teste P ficam escopadas aos registros que ele cria;
- o teste Q restaura a configuração padrão ao terminar.

Os demais arquivos já criam dados próprios por execução (organizações com sufixo único) e se limpam.

## Como provar

```bash
npm run test:integration:db
npm run test:integration:db
```

Duas execuções seguidas, no mesmo banco, devem passar. O CI executa as duas em sequência (job "PostgreSQL Integration Gate").

Só use esses comandos contra o banco descartável de testes. Nunca aponte `DATABASE_URL` para homologação ou produção: a guarda recusa, e não deve ser contornada.
