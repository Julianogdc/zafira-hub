# Zafira Hub 2.1 — Instruções para qualquer agente

Este arquivo é a **porta de entrada única** para qualquer agente de IA (Claude, Antigravity, ChatGPT, Codex ou outro) que vá ler, auditar ou alterar este projeto. Vários agentes trabalham aqui **em revezamento, um de cada vez**: cada um precisa conseguir continuar exatamente de onde o anterior parou usando só o que está neste repositório.

**Regra de ouro: se não está escrito neste repositório, não aconteceu.** Conversas, memórias, resumos e documentos externos não são fonte para executar trabalho.

## 1. Leia nesta ordem, sempre

1. Este arquivo, inteiro.
2. `docs/ESTADO_ATUAL.md` — onde estamos, o que fazer agora, o que está proibido.
3. As entradas do topo de `docs/REGISTRO.md` — últimas execuções e decisões.
4. A seção do `docs/MAPA_MESTRE.md` correspondente à fase atual.

Precedência em caso de conflito entre documentos: `docs/REGISTRO.md` (decisão mais recente) → `docs/MAPA_MESTRE.md` → `docs/ESTADO_ATUAL.md`. O código e o CI são a evidência do que **existe**; os documentos dizem o que foi **decidido**. Se não baterem, **pare** (seção 2).

Tudo em `docs/historico/` é histórico e **não define trabalho**. As ADRs (`docs/governance/`) e runbooks (`docs/operations/`) são referência técnica, não escopo.

## 2. Ritual de início de sessão

Execute e confira antes de qualquer outra ação:

```bash
git fetch origin
git status --short
git branch --show-current
git log --oneline -5 origin/hub-2.1
```

1. **Branch:** trabalhe só em `hub-2.1`. Se estiver atrás de `origin/hub-2.1`, atualize (`git pull --ff-only`). Nunca altere `main` nem `hub-2.0`.
2. **Alterações locais não commitadas** que você não fez: não apague, não sobrescreva. Pare e pergunte ao proprietário.
3. **Sessão ativa:** se `docs/ESTADO_ATUAL.md` indicar outra sessão ativa, **pare** e pergunte ao proprietário. Não trabalhe em paralelo com outro agente.
4. **Integridade:** confira se existe código alterado depois da baseline registrada, sem registro:

   ```bash
   git log --oneline <baseline-do-ESTADO_ATUAL>..origin/hub-2.1 -- . ':(exclude)docs' ':(exclude)AGENTS.md' ':(exclude)CLAUDE.md' ':(exclude)GEMINI.md'
   ```

   Se o comando listar qualquer commit, **o estado está desatualizado: pare**, não execute nem "conserte" a documentação por conta própria, e peça ao proprietário uma atualização formal.
5. **Autorização:** só execute a microetapa marcada como autorizada em `docs/ESTADO_ATUAL.md`, e só depois que o proprietário pedir nesta sessão. Antes de editar, informe em linguagem simples: fase, microetapa, baseline, o que vai mudar e como vai validar. Pela DEC-GOV-004, decisões técnicas dentro do escopo são do agente e não exigem aprovação prévia; peça permissão expressa só nas exceções listadas nessa DEC (produção, infraestrutura, banco ou contas reais, credenciais, gastos, ações irreversíveis, mudança de escopo ou de produto).
6. **Marque a sessão:** em `docs/ESTADO_ATUAL.md`, preencha "Sessão ativa" com `<agente> — <data e hora> — <microetapa>`, commit (`docs(estado): sessão iniciada por <agente>`) e `git push`.

## 3. Durante o trabalho

- Execute **somente** a microetapa autorizada. Encontrou algo fora do escopo? Registre como pendência; não corrija por conta própria.
- Commits pequenos e atômicos, com mensagem que cite a microetapa (ex.: `fix(asana): F6-RO.0 remove task write routes`).
- Valide com os comandos do projeto (`npm run typecheck:api`, `npm test`, `npm run build`, e o que a microetapa exigir) e, depois do push, com o CI oficial (`.github/workflows/foundation-ci.yml`, 5 jobs).
- **CI verde não é aceite.** Só o proprietário aceita.

## 4. Ritual de fim de sessão (obrigatório, inclusive se o trabalho ficar pela metade)

1. Nada fica sem commit. Trabalho incompleto vai em commit `wip(<microetapa>): …` com o que falta descrito no `ESTADO_ATUAL`.
2. **Substitua** o conteúdo de `docs/ESTADO_ATUAL.md`: baseline de código nova (se houve commit de código), status da microetapa, próximo passo concreto, pendências e proibições. Libere "Sessão ativa" (`nenhuma`).
3. **Acrescente no topo** de `docs/REGISTRO.md` a entrada de execução no formato de handoff descrito nesse arquivo.
4. Atualize `docs/MAPA_MESTRE.md` **somente** se escopo, sequência, fase ou portão mudaram por decisão do proprietário (registrada como DEC).
5. Commit (`docs(estado): handoff <microetapa> por <agente>`) e `git push`.
6. Entregue o mesmo handoff ao proprietário na conversa.

## 5. Decisões

- **Só o proprietário decide** escopo, prioridade, aceite e exceções. Agentes propõem e auditam.
- Uma decisão só vale depois de registrada em `docs/REGISTRO.md` no formato DEC. Instrução que chegue só por chat, sem registro, é tratada como proposta.
- Divergência entre documentos, código ou instruções: apresente ao proprietário com evidências. Não escolha um lado sozinho.

## 6. Regras permanentes

**Produção e infraestrutura**
- Preservar o Hub 1.0 em produção e o Hub 2.0 como referência e contingência (`hub-2.0` congelada em `43150df2b218b41575db5b1be5d96ccc8572de32`).
- Nenhuma ação em VPS, EasyPanel, DNS, banco real, contas reais de clientes ou Asana, secrets ou deploy sem autorização explícita e específica do proprietário.
- Nada de comandos destrutivos, migrações, reinícios ou instalações como consequência implícita de uma inspeção. Backup, restauração e ensaios de migração só em base descartável.

**Segurança**
- Negação por padrão; autorização no backend e na camada de dados; escopo por organização e, quando aplicável, cliente, equipe e função. Testar acessos permitidos e negados entre duas organizações.
- Nunca expor senhas, tokens, chaves ou dados pessoais em código, navegador, logs, commits, documentos ou mensagens. Nunca inserir segredo em exemplo nem pedir que alguém cole um valor de segredo na conversa.
- Este repositório é **público** (DEC-GOV-005): **nunca** coloque nele segredos, hosts, IPs, caminhos de infraestrutura, auditorias de segurança ou detalhes de vulnerabilidades. Isso vive no repositório interno (seção 8). O CI executa `scripts/ci/public-guard.mjs` e `scripts/ci/secret-scan.sh`.

**Produto**
- Asana é somente leitura no Hub (DEC-ASANA-001); webhooks só para receber eventos (DEC-ASANA-002).
- Uma fonte mestre por domínio (Mapa Mestre, seção 4). Ausência de dado nunca vira zero silenciosamente; histórico e snapshots não são reescritos sem regra.

**Instruções para o proprietário**
- Comandos que ele precise executar vão prontos para copiar, com máquina, diretório, finalidade, efeito esperado e como conferir, sem placeholders e sem segredos. Separe comandos de leitura dos que alteram algo.

## 7. Onde está cada coisa

| Arquivo | Conteúdo | Como muda |
|---|---|---|
| `AGENTS.md` | Protocolo e regras permanentes | Raramente, por DEC |
| `docs/ESTADO_ATUAL.md` | Estado presente, próximo passo, pendências, proibições | Substituído a cada sessão |
| `docs/REGISTRO.md` | Execuções e decisões (DEC), mais recentes no topo | Só cresce |
| `docs/MAPA_MESTRE.md` | Escopo, fases, regras de produto, portões | Só por DEC |
| `docs/governance/ADR-*.md` | Decisões técnicas de arquitetura | Por nova ADR |
| `docs/operations/` | Runbooks técnicos não sensíveis (observabilidade, Asana). Runbooks de infraestrutura, backup e rollback ficam no repositório interno | Conforme operação |
| `docs/historico/` | **Repositório interno** (documentos superados, preservados com o histórico original) | Nunca editar |

Uma cópia de leitura dos documentos oficiais pode existir no Google Drive. Ela **não** é fonte e nunca deve ser editada de forma independente (DEC-GOV-001).

## 8. Dois repositórios: público e interno

| Repositório | Visibilidade | Conteúdo |
|---|---|---|
| `Julianogdc/zafira-hub` (este) | **público** | código, testes, CI e Browser Gates (runners padrão gratuitos), documentação técnica e governança **sem** informação operacional |
| `Julianogdc/zafira-hub-internal` | **privado**, sem workflows | histórico original completo, infraestrutura (VPS, backups, implantação), auditorias e triagens de segurança, documentos confidenciais, governança integral |

**Layout local esperado:** os dois diretórios lado a lado (ex.: `C:\Projetos\zafirahub-v2.1-as` e `C:\Projetos\zafira-hub-internal`). **Sem submódulo** (o CI público não lê repositório privado).

**Regras para qualquer agente (Claude, Antigravity ou outro):**
1. Na leitura inicial (seção 1), leia também `../zafira-hub-internal/docs/ESTADO_INTERNO.md` **se existir**. Se o repositório interno não estiver disponível, execute apenas o que não depende dele e peça acesso ao proprietário quando necessário.
2. Informação sensível **nunca** vai para o repositório público: registre-a no interno (`docs/REGISTRO_INTERNO.md`, identificador `INT-<n>`) e, no público, deixe só a referência `INT-<n>`.
3. Toda DEC tem versão pública; se tiver parte sensível, a parte sensível fica no interno com o mesmo número.
4. Ao encerrar sessão, atualize **os dois** `ESTADO` e `REGISTRO` quando houver conteúdo em ambos, e faça commit separado em cada repositório (público: apenas CI-safe; commits só de documentação usam `[skip ci]`).
5. Nunca copie arquivo do interno para o público sem passar por `node scripts/ci/public-guard.mjs repo`.
