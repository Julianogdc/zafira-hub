# Zafira Hub 2.1 — Instruções para qualquer agente

AGENTS.md é a porta de entrada única. Codex, Claude Code e Antigravity compartilham igualmente direção técnica, planejamento, execução, testes, auditoria e continuidade do escopo aprovado (DEC-GOV-007/008). O proprietário mantém autoridade final do produto e decisões reservadas. Uma sessão modificadora por vez, em revezamento; nenhum agente é superior.

**Regra de ouro: se não está escrito na governança oficial, não aconteceu.**

## 1. Fontes e precedência

Leia este arquivo inteiro, docs/ESTADO_ATUAL.md, o topo de docs/REGISTRO.md e a seção aplicável do docs/MAPA_MESTRE.md. Ao assumir continuidade, leia o Mapa integral, decisões vigentes e ADRs/runbooks/propostas aplicáveis. Antes de implementar, confira contratos, schema, serviços e testes existentes.

Este repositório público é uma árvore saneada de código, testes, CI e documentos derivados (DEC-GOV-005). A governança oficial completa permanece no repositório privado Julianogdc/zafira-hub-internal. Consulte ali AGENTS.md, docs/ESTADO_ATUAL.md, docs/REGISTRO.md e docs/MAPA_MESTRE.md, sem presumir um caminho local fixo. Confirme o remote antes de ler ou escrever; nunca use hashes internos como baselines públicas. Sem acesso à governança integral, limite-se a leitura e testes locais independentes; não selecione implementação, publique ou aceite entrega dependente de decisão privada.

Precedência: REGISTRO (decisão vigente dentro da autoridade do responsável) → MAPA_MESTRE → ESTADO_ATUAL. AGENTS define o protocolo. Código e CI evidenciam o que existe; documentos registram o decidido. Investigue divergências; contradições de produto, autoridade, segurança ou alto risco interrompem a ação afetada. Histórico não define trabalho. Nenhuma DEC técnica dispensa portão ou altera requisito de produto.

## 2. Início de sessão e integridade pública

Confirme a sessão oficial livre no privado e público. Não interrompa outra sessão. Alterações locais de terceiros não podem ser apagadas, sobrescritas ou ocultadas. Trabalhe somente em hub-2.1; nunca altere main ou hub-2.0.

Em checkout conectado e com ação autorizada, execute:

```bash
git fetch origin
git status --short
git branch --show-current
git log --oneline -5 origin/hub-2.1
git log --oneline 4feacac95b474d980f94d74912c8207462f221eb..origin/hub-2.1 -- . ':(exclude)docs' ':(exclude)AGENTS.md' ':(exclude)CLAUDE.md' ':(exclude)GEMINI.md' ':(exclude)deploy/homologation/'
git log --oneline e547ff2..origin/hub-2.1 -- deploy/homologation/
```

Execute os dois logs também contra HEAD. São duas referências públicas independentes: aplicação 4feacac95b474d980f94d74912c8207462f221eb e pacote e547ff2. Permanecem preservadas até DEC de aceite com evidências e todos os portões. Commit detectado bloqueia nova implementação até reconciliação: desconhecido exige parada; candidato registrado pode ser auditado sob DEC própria, mas não aceito/ignorado por isso. Sem exclusões amplas, lista permanente de ignorados ou avanço para ocultar mudanças.

Preparação isolada DEC-CI-003 é exceção expressa: sem remote, sem fetch/push/CI, base pública fixada e ritual remoto conferido pelo executor no repositório oficial. Não adicionar remote, publicar ou executar CI até autorização específica do proprietário sobre manifesto e SHA concretos. Uma única revisão local consolida esta preparação; não criar commits intermediários de sessão para publicação.

Antes de editar, informe fase/microetapa, baseline, mudança e validação; registre sessão no estado oficial privado e na cópia pública quando aplicável. Em sessão conectada autorizada, faça commit e push documental de abertura conforme protocolo oficial. Nunca publique documentos privados para cumprir esse ritual.

## 3. Mandato e limites durante o trabalho

O executor escolhe a próxima microetapa tecnicamente elegível já aprovada, sem exigir prompt novo a cada passo, após conferir dependências/decisões/critérios. Registre a escolha. Produto, requisitos, escopo, prioridade estratégica, fornecedor/tecnologia de produto, riscos/exceções, gastos, produção, infraestrutura real, dados/contas/credenciais reais, deploy, publicações/integrações reais e ações irreversíveis/destrutivas/de alto impacto exigem autorização específica do proprietário. Bloqueio reservado permite somente atividades independentes já aprovadas.

Commits pequenos com microetapa; código sem skip ci, documentação com skip ci. Valide com typechecks, testes, build, scanner, public-guard e gates pertinentes. CI oficial tem cinco jobs e Browser Gates aplicáveis. **CI verde não é aceite**; executor só registra aceite técnico com evidências e todos os portões. Aceite final de produto, risco e exceções pertence ao proprietário. Testes locais não equivalem a CI 5/5, nem run antigo valida código novo. Não alterar cobrança, permissões, runners ou infraestrutura para contornar falha.

## 4. Encerramento e transferência

Nada fica sem commit; trabalho incompleto exige wip e pendências explícitas. Substitua ESTADO_ATUAL, separe baselines aceitas de candidatas, descreva próximo passo/proibições e libere Sessão ativa como nenhuma. Acrescente handoff no topo do REGISTRO preservando todo o histórico. Mapa só muda por decisão do proprietário sobre escopo/sequência/fase/portão. Handoff privado completo e público derivado saneado, com commits separados quando publicação estiver autorizada. Entregue evidências na conversa; não alegue trabalho em segundo plano sem execução ativa.

## 5. Segurança e produto

Nunca inserir segredos, dados pessoais, hosts/IPs reais, caminhos operacionais, auditorias ou detalhes de vulnerabilidade nesta árvore, mensagens públicas, artefatos ou imagens. Informações reservadas permanecem no registro privado; público recebe apenas referência saneada. Não copiar histórico Git privado, documentos completos, logs ou contextos do coordenador. Toda exportação exige allowlist nominal, diff/manifesto revisados, public-guard e secret-scan; guardas não substituem classificação/revisão.

Preserve Hub 1.0 e Hub 2.0. Sem acesso a ambiente real, migrações persistentes, reinício, instalação, credenciais, serviços ou deploy implícitos. Testes de banco só em instância descartável explicitamente validada/autorizada. Asana somente leitura no Hub; webhooks somente recebimento. Negação por padrão, RBAC no backend/dados, escopo por organização/cliente/equipe/função e testes positivos/negativos entre duas organizações. Uma fonte mestre por domínio; ausência de dado não vira zero, histórico/snapshots não são reescritos silenciosamente. Mocks não entram como fallback de produto.

## 6. Coordenação local

DEC-GOV-008 autoriza somente leitura/simulação, sem inferência/agentes escritores, serviços ou consumo implícito. Lease protege apenas participantes do mesmo protocolo; não impede editor externo. Escrita automática exige demonstração e autorização posterior, contenção de permissões, limites, interrupção, validação e handoff. O protótipo mantém verificação do remote privado: não operá-lo sobre esta cópia pública. Seus testes são locais e sintéticos; não consultam o privado nem iniciam agentes. Logs/runtime são evidência operacional privada e não fonte de escopo.

CLAUDE.md, GEMINI.md e regras .agents/.agent são pontes a este protocolo; não criam mapa paralelo. Cópias de leitura fora do Git nunca são fonte editável independente.
