# Bootstrap de permissões (RBAC) e verificação pré-deploy

> HM-1 / H1 (P22, DEC-HML-001). Vale para qualquer ambiente com banco persistente (homologação, produção). Nada aqui autoriza executar em ambiente real sem a autorização prevista no `AGENTS.md`.

## O que o bootstrap faz

`npm run rbac:bootstrap --workspace=@zafira/api` leva o banco ao estado canônico definido em `packages/domain/src/authorization`:

| Alvo | Efeito |
|---|---|
| Catálogo de permissões (`permissions`) | **Cria** os códigos que faltam. **Nunca remove** (a remoção em cascata apagaria exceções individuais). Códigos que deixaram de existir são só **relatados** como obsoletos |
| Permissões padrão por papel (`role_permissions`; globais por papel, não por organização) | **Acrescenta** as que faltam e **remove** as que deixaram de ser padrão, inclusive códigos que não existem mais no catálogo |
| Exceções individuais por membro (`organization_member_permissions`) | **Nunca lidas para alteração nem escritas.** Só contadas no relatório |
| Dados de organizações, membros, usuários e conteúdo | **Nunca tocados** |

Por isso o P22 se resolve: em um banco criado antes da F6-IMP.7B o `MEMBER` mantinha `deliverables.complete`; ao rodar o bootstrap atual a linha é removida. Quem recebeu `deliverables.complete` por **exceção individual** continua com ela (é decisão explícita da organização).

Garantias:
- **Idempotente:** a segunda execução não altera nada (relatório "em sincronia").
- **Transacional:** o estado é relido e aplicado em uma única transação serializável.
- **Trava de segurança:** antes de qualquer mudança, os padrões precisam estar completos (nenhum papel vazio), todos dentro do catálogo, e `MANAGER`/`MEMBER` nunca podem ter algo que o `ADMIN` não tem. Se falhar, **nada é alterado** e o comando sai com erro.
- **Sem credencial no relatório:** a URL do banco é impressa com a senha mascarada.

## Verificação pré-deploy (somente leitura)

```bash
npm run rbac:bootstrap --workspace=@zafira/api -- --check
```

- Mostra o que o bootstrap faria (`+` acrescenta, `-` remove) e as exceções individuais preservadas (contagem por código, sem dados pessoais).
- **Saída 0:** em sincronia. **Saída 2:** há divergência (o relatório lista cada item). **Saída 1:** erro (conexão ou padrões inválidos).
- Use antes de qualquer deploy com migrations ou troca de versão; em divergência, rode o bootstrap (sem `--check`) e repita a verificação.

## Efeito operacional
- A remoção vale **imediatamente**: o resolvedor lê `role_permissions` do banco a cada decisão (não há cache em processo). Não é preciso reiniciar a API.
- Usuários que dependiam do padrão antigo perdem a permissão na próxima requisição. Antes de rodar em ambiente com usuários reais, rode `--check` e leia a lista de remoções.
- Reversão: as linhas removidas são padrões que deixaram de existir; para devolver uma permissão a um papel, altere os padrões no domínio (por DEC) ou conceda exceção individual.

## Evidências automatizadas
- Unitários: `apps/api/src/modules/authorization/__tests__/rbac-sync.test.ts`.
- PostgreSQL com dados no formato antigo: `apps/api/src/integration-tests/rbac-bootstrap-postgres.test.ts` (P22 reproduzido e corrigido; exceções e organizações preservadas; idempotência).
- CI: o job PostgreSQL executa o bootstrap duas vezes e a verificação `--check` antes dos testes.
