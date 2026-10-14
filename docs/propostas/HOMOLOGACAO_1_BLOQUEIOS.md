# Primeira homologação controlada com dados sintéticos — bloqueios e o que falta

> Situação: **levantamento, somente análise** (DEC-F8-028). Nada aqui autoriza deploy, VPS, EasyPanel, DNS, banco real ou credenciais.
> Objetivo considerado: uma primeira versão do Hub 2.1 rodando num ambiente controlado de homologação, só com **organizações, pessoas, clientes e arquivos fictícios**, **sem integrações externas reais** (Asana, Google, n8n, BrightBean, Asaas e Inter desligados ou não configurados) e **sem publicação**.
> Base: `docs/operations/homologation-*.md`, pendências do `ESTADO_ATUAL`, código em `ad44325` e CI 5/5 (run 38570183115).

## 1. O que já está pronto

- Imagens de API e Web publicadas no GHCR por SHA, a cada CI verde; imagens-base fixadas por digest (DEC-F8-025).
- Ensaio completo de homologação no CI: migrações num banco descartável, proxy same-origin, Browser Gates F6–F8 e isolamento entre duas organizações (mecânica validada; o Portão da Fase 1 continua aberto até a homologação física).
- Runbooks de implantação, backup/rollback, prontidão e portão final em `docs/operations/`.
- Agendadores e despachantes **desligados por padrão** (Asana, Calendar, n8n, publicação).

## 2. Bloqueadores (sem eles não há homologação)

| # | Bloqueio | Por quê | O que fecha | Quem |
|---|---|---|---|---|
| H1 | **P22 — `rbac:bootstrap` só acrescenta permissões** | bloqueador declarado do primeiro deploy de homologação: em banco antigo o MEMBER mantém `deliverables.complete` | bootstrap que sincroniza papéis com os padrões (sem tocar exceções individuais), teste com banco no formato antigo, checagem pré-deploy de divergências | agente (código), com DEC |
| H2 | **Armazenamento de arquivos em produção não existe** | com `NODE_ENV=production` o driver local é **recusado** (`file-storage.ts`) e o driver S3 não está implementado: upload, prévia e aprovação do cliente não funcionam | decidir o provedor S3-compatível privado (decisão "Storage principal de arquivos", aberta no Mapa) e implementar o driver com testes; **ou** decidir, por DEC, um modo provisório só para a homologação sintética (volume local), com risco registrado | Direção decide; agente implementa |
| H3 | **P18 — teste de RBAC não roda duas vezes no mesmo banco** | limite absoluto declarado: antes do primeiro deploy de homologação | testes limpam o que criam ou usam sufixo único; `test:integration:db` passa duas vezes seguidas | agente, com DEC |
| H4 | **Massa de dados sintéticos para homologação não existe** | só há seeds por Browser Gate (`seed-f6-gate`, `seed-f7-*`, `seed-multiorg-gate`), feitos para o CI e não para uso guiado | seed único, idempotente e reexecutável: 2 organizações, papéis (admin, gerente, membro), clientes, contratos/metas, onboarding, conteúdos com arquivos de teste, nomes e e-mails `.invalid`; nunca dado real; comando de limpeza | agente, com DEC |
| H5 | **Perfil de ambiente da homologação desatualizado** | `apps/api/.env.example` lista 20 variáveis; o código lê cerca de 70 (storage, `INTEGRATION_ENCRYPTION_KEY`, `APPROVAL_MEDIA_SECRET`, `CALENDAR_IDENTITY_HMAC_KEY`, flags dos despachantes etc.); o checklist de prontidão cita 14 migrações e hoje são 32 | referência de variáveis por ambiente (obrigatória, opcional, deve ficar vazia na homologação sintética), sem valores; runbook revisado; checagem na subida que recuse configuração insegura | agente (documentação e checagem), com DEC |
| H6 | **Comportamento sem integrações não foi verificado** | no CI todo o ensaio roda com simuladores (Asana, Calendar, n8n, BrightBean); na homologação sintética eles não existem | ensaio extra no CI sem os simuladores: telas mostram "não conectado"/"indisponível" (nunca erro ou zero), API sobe sem as variáveis dessas integrações | agente, com DEC |
| H7 | **Infraestrutura da homologação não decidida** | checklist de `homologation-readiness.md` §11–§12 em aberto: evidência de capacidade da VPS, topologia (A/B/C), banco dedicado isolado, acesso de leitura ao GHCR, HTTPS com certificado, proxy same-origin, limites de CPU/RAM | Direção escolhe a topologia; proprietário fornece capacidade e acesso; implantação segue o runbook | **proprietário/Direção** (infra e credenciais são exceção da DEC-GOV-004) |
| H8 | **Segredos próprios da homologação** | `JWT_SECRET`, `COOKIE_SECRET`, `HUB_INTERNAL_API_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `APPROVAL_MEDIA_SECRET`, senha do banco; a senha de exemplo do `docker-compose.reference.yml` (P12) precisa ser sempre sobrescrita | proprietário gera e guarda os valores no ambiente (nunca no repositório nem na conversa); a checagem do H5 recusa os valores de exemplo | **proprietário** |
| H9 | **Ensaio de backup e restauração no banco de homologação** | o runbook existe, mas nunca foi executado fora do CI | um backup e uma restauração completos no banco de homologação antes de convidar usuários | proprietário executa; agente prepara os comandos |

> **Atualização HM-1 (DEC-HML-001, 2026-10-14):** H1 (P22) e H3 (P18) implementadas e com CI 5/5 (run 38615589824), pendentes de aceite técnico. H2, H4–H9 seguem abertas.

## 3. Não bloqueiam a homologação sintética (mas bloqueiam etapas seguintes)

| Item | Por que não bloqueia agora | Bloqueia |
|---|---|---|
| P28 — exclusão de cliente e retenção | dados fictícios | dados reais |
| P5 — OAuth corporativo do Asana | Asana desligado | conectar Asana |
| P24–P26 — espelho e webhooks do Asana | Asana desligado | homologação com histórico real |
| Google Calendar e n8n reais | desligados | homologação dessas integrações |
| P33, P35, P37, RS1–RS7 e o despachante de publicação | sem publicação | ligar o despachante; piloto do Portão F8 (F8-5e) |
| P27 — 23 vulnerabilidades em dependências de produção (0 críticas, 20 altas) | ambiente fechado e sintético; **recomenda-se triagem das 20 altas antes de expor a homologação à internet** | F18 (limite) |
| P13 — lint completo | qualidade, não segurança | F8/F18 |
| Portão da Fase 1 (isolamento em infraestrutura real) | é **executado** na própria homologação (runbook `homologation-final-gate.md`) | fechamento formal da Fase 1 |

## 4. Sequência sugerida

1. **Direção decide:** H2 (provedor S3 ou modo provisório), H7 (topologia) e o escopo da homologação sintética (módulos abertos aos usuários de teste).
2. **Agente (uma DEC, sem infraestrutura):** H1, H3, H5 e H6 no código e no CI; depois H4 (seed sintético) e o driver de armazenamento (H2). Rodada única de CI.
3. **Proprietário:** H7, H8 e H9 seguindo o runbook revisado. Comandos prontos são fornecidos pelo agente, sem segredos.
4. **Execução assistida:** migração, seed sintético, Portão da Fase 1 (duas organizações), roteiro de uso por módulo e aceite da Direção.

Estimativa de esforço do agente (passo 2): H1, H3, H5 e H6 numa rodada; H4 e H2 em outra. Nenhum desses passos toca VPS, produção, credenciais ou serviços reais.
