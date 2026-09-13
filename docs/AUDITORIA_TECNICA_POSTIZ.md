# Relatório de Auditoria Técnica: Postiz → Zafira Hub 2.0

> **Decisão Arquitetural Firmada:**
> - **Postiz** = Sistema operacional de conteúdo/social (fonte da verdade operacional).
> - **Zafira Hub** = Leitura, Cliente 360, métricas, alertas, relatórios e inteligência executiva.
> - O Hub **não** replica o agendador/editor do Postiz e **não** publica conteúdo nesta primeira etapa.

---

## 1. Versão e Estrutura do Postiz Encontrada

- **Arquitetura Base:** O Postiz (`gitroomhq/postiz-app`) é construído como um monorepo PNPM composto por:
  - `apps/backend`: Servidor NestJS (Node.js >= 22), disponibilizando tanto a API de Dashboard interno (`/api/*`) quanto a **Public API** oficial (`/public/v1/*`).
  - `apps/frontend`: Aplicação Next.js / React (Mantine + Tailwind).
  - `apps/orchestrator`: Motor de execução assíncrona baseado em workflows/activities para agendamento, publicação e processamento de mídias.
  - `libraries/nestjs-libraries`: Camada central de dados via **Prisma ORM** e integrações sociais com providers específicos.
- **Banco de Dados:** PostgreSQL com Prisma ORM (`@prisma/client` v6.5.0), suportando modelos relacionais como `Organization`, `Integration`, `Post`, `Webhooks`, `Errors`, `Customer` e `Media`.
- **Cache / Fila:** Redis (`ioredis`) para controle de cache de analytics e locks de requisições.

---

## 2. Como a Autenticação Funciona

A auditoria no middleware oficial do backend (`apps/backend/src/services/auth/public.auth.middleware.ts`) identificou a mecânica exata:

- **Cabeçalho Utilizado:**
  ```http
  Authorization: <SUA_API_KEY>
  ```
  *(Também suporta tokens de OAuth que começam com `pos_`, mas o padrão de integração para sistemas externos é a API Key da Organização).*
- **Origem da Chave:**
  - Gerada por organização no painel do Postiz em **Configurações > Developers / Public API / MCP**.
  - No banco do Postiz, a chave é armazenada na coluna `Organization.apiKey`.
- **Mapeamento de Contexto:**
  - Ao receber a requisição com a `Authorization: <apiKey>`, o middleware busca a organização pelo método `getOrgByApiKey`. Se válida, a requisição herda privilégios administrativos (`SUPERADMIN`) restritos ao escopo daquela organização (isolamento multi-tenant garantido).

---

## 3. Endpoints Úteis Encontrados

Os endpoints mais relevantes para alimentar o Zafira Hub estão concentrados sob a **Public API (`/public/v1`)**:

| Método | Endpoint | Finalidade para o Hub |
| :--- | :--- | :--- |
| `GET` | `/public/v1/is-connected` | Healthcheck para validar se a API Key do Postiz é válida. |
| `GET` | `/public/v1/integrations` | Lista todas as contas sociais conectadas na organização (Instagram, TikTok, YouTube, etc.). Permite filtrar por `?group=<customerId>`. |
| `GET` | `/public/v1/posts` | Lista de posts com filtros por período: `?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&customer=<id>`. |
| `GET` | `/public/v1/posts/:id/missing` | Informa dados ausentes em um post antes da publicação. |
| `GET` | `/public/v1/analytics/:integration` | Retorna métricas consolidadas da conta social no período informado (`?date=30` para 30 dias). |
| `GET` | `/public/v1/analytics/post/:postId` | Retorna métricas de performance do post individual específico (`?date=timestamp`). |
| `GET` | `/posts/list` *(API interna)* | Endpoint complementar com paginação (`?page=0&limit=20`) e filtro por status (`state=all|scheduled|draft|published|error`). |

---

## 4. Webhooks Reais Encontrados

A auditoria no frontend (`webhooks.tsx`), no DTO (`webhooks.dto.ts`) e no orchestrator (`post.activity.ts`) revelou como o Postiz implementa Webhooks:

- **Configuração no Postiz:**
  - `name`: Nome identificador.
  - `url`: URL pública HTTPS (com validação anti-SSRF).
  - `integrations`: Lista de IDs de contas sociais associadas (se vazio, envia de todas).
- **Mecanismo de Disparo:**
  - O Postiz **só dispara webhooks através do método `sendWebhooks` em `post.activity.ts`**.
  - O disparo ocorre exclusivamente **após a conclusão com sucesso da publicação de um post**.
- **Comportamento e Resiliência:**
  - **Não há assinatura HMAC:** O Postiz envia apenas `headers: { 'Content-Type': 'application/json' }`. Não há assinatura criptográfica como `X-Hub-Signature` nem segredo configurável na interface.
  - **Sem Retry Garantido:** A execução do webhook é considerada "best-effort" e envolvida em um bloco silencioso `catch (e) { /** empty **/ }` no worker. Se a URL de destino retornar erro 500 ou timeout, a mensagem é descartada sem novas tentativas.

---

## 5. Eventos de Webhook Disponíveis

> [!IMPORTANT]
> **Fato Crítico Revelado na Auditoria:** O Postiz **não possui seleção granular de eventos**.
> Ele **não suporta** eventos como `post.created`, `post.scheduled`, `post.failed`, `integration.connected` ou `analytics.updated`.
> O único evento real emitido é:
> - **`post.published`** (disparado unicamente quando o post é publicado na rede social).

---

## 6. Payloads Relevantes

### A. Payload do Webhook de Publicação (`post.published`)
O Postiz envia um array contendo os dados do post e da conta social que publicou:

```json
[
  {
    "id": "cm6tcts4f0005qcwit25cis26",
    "content": "Legenda do post publicado com sucesso!",
    "publishDate": "2026-09-13T18:00:00.000Z",
    "releaseURL": "https://www.instagram.com/p/DB12345678/",
    "state": "PUBLISHED",
    "integration": {
      "id": "cm6s4uyou0001i2r47pxix6z1",
      "name": "Instagram Grupo Lima",
      "providerIdentifier": "instagram",
      "picture": "https://uploads.postiz.com/avatars/perfil.jpg",
      "type": "social"
    }
  }
]
```

### B. Payload de Contas (`GET /public/v1/integrations`)
```json
[
  {
    "id": "cm6s4uyou0001i2r47pxix6z1",
    "name": "Grupo Lima Oficial",
    "identifier": "instagram",
    "picture": "https://uploads.postiz.com/avatars/perfil.jpg",
    "disabled": false,
    "profile": "@grupolima",
    "customer": {
      "id": "cust_12345",
      "name": "Grupo Lima"
    }
  }
]
```

### C. Payload de Post Individual (`GET /public/v1/posts`)
```json
{
  "id": "cm6tcts4f0005qcwit25cis26",
  "content": "Novo produto lançado hoje!",
  "publishDate": "2026-09-14T15:00:00.000Z",
  "releaseURL": null,
  "releaseId": null,
  "state": "QUEUE",
  "group": "grp_987654",
  "creationMethod": "WEB",
  "settings": "{\"is_reel\": true}",
  "integration": {
    "id": "cm6s4uyou0001i2r47pxix6z1",
    "providerIdentifier": "instagram",
    "name": "Grupo Lima Oficial",
    "picture": "https://..."
  }
}
```

---

## 7. Contas Sociais Suportadas

A auditoria no diretório `libraries/nestjs-libraries/src/integrations/social/` mapeou as seguintes plataformas ativas:
- **Instagram** (Facebook Business API e Instagram Standalone)
- **Facebook** (Pages Graph API)
- **TikTok** (TikTok Personal e TikTok for Business)
- **YouTube** (YouTube Data & Analytics API)
- **LinkedIn** (Perfil pessoal e Company Pages)
- **X / Twitter** (X API v2)
- **Threads** (Meta Threads API)
- **Pinterest** (Pinterest API)
- **Bluesky**, **Reddit**, **Telegram**, **Discord**, **Slack**, **Medium**, **WordPress**, **Google My Business (GMB)**

---

## 8. Dados de Posts Disponíveis

- **Identificadores:** `id` (cuid do post), `group` (id do lote de postagem), `integrationId`.
- **Estados do Post (`State`):**
  - `QUEUE`: Agendado / na fila para publicação.
  - `PUBLISHED`: Publicado com sucesso.
  - `ERROR`: Falhou na publicação (o Postiz armazena o log em `Errors`).
  - `DRAFT`: Rascunho.
- **Conteúdo e Mídia:** `content` (texto da legenda/post), `settings` (JSON com flags como reels, stories, formato), relação com mídias/thumbnails.
- **Links Externos:**
  - `releaseURL`: Link público direto na rede social (ex: `https://instagram.com/p/...`).
  - `releaseId`: ID interno do post retornado pela rede social.
- **Datas:** `publishDate` (data prevista ou da publicação), `createdAt`, `updatedAt`.

---

## 9. Métricas Realmente Disponíveis

> [!WARNING]
> **Atenção:** O suporte a métricas varia expressivamente entre as redes dentro do Postiz.

| Plataforma | Métricas da Conta (`analytics`) | Métricas do Post (`postAnalytics`) | Métricas Específicas Suportadas |
| :--- | :---: | :---: | :--- |
| **Instagram** | Sim | Sim | `follower_count`, `reach`, `likes`, `views`, `comments`, `shares`, `saves`, `replies` |
| **YouTube** | Sim | Sim | `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, `likes`, `subscribersLost` |
| **Facebook** | Sim | Sim | Impressões de página, engajamento, curtidas, comentários |
| **TikTok** | Sim | Sim | `video_views`, `profile_views`, `likes`, `comments`, `shares` |
| **X / Twitter** | Sim | Sim | Impressões, engajamentos, retweets, likes |
| **LinkedIn** | **NÃO** | **NÃO** | *Não implementado no código do Postiz (`analytics: false`)* |

---

## 10. Limitações Encontradas

1. **Webhooks Unidirecionais e Restritos:** Apenas disparam no evento de post publicado com sucesso. Não há notificação de post com falha, agendamento de post ou reconexão de contas.
2. **Ausência de Assinatura HMAC:** Webhooks do Postiz não enviam cabeçalho de autenticação/assinatura criptográfica nativa.
3. **LinkedIn sem Analytics:** A implementação do LinkedIn no Postiz não possui consulta de analytics.
4. **Dependência de Tokens Válidos:** Se o token social expirar no Postiz (ex: Meta OAuth 60 dias), a consulta de analytics retorna vazia até que a conta seja reconectada no Postiz.

---

## 11. Estratégia de Vinculação: Client do Hub ↔ Postiz

### Decisão de Modelagem:
No Zafira Hub, já possuímos o model:
- `OrganizationIntegration`: Conexão da organização Zafira com o Postiz (`provider: POSTIZ`, guardando a `API_KEY` criptografada e a `POSTIZ_URL`).
- `ClientIntegration`: Mapeamento de quais contas sociais pertencem a qual cliente.

### Mapeamento Proposto:
- `provider`: `'POSTIZ'`
- `externalId`: ID da integração no Postiz (`integration.id`, ex: `cm6s4uyou0001i2r47pxix6z1`).
- `name`: Nome da conta social (ex: `Grupo Lima (Instagram)`).
- `metadata`: Objeto JSON com dados da conta para exibição rápida:
  ```json
  {
    "providerIdentifier": "instagram",
    "profile": "@grupolima",
    "picture": "https://uploads.postiz.com/avatars/...",
    "internalId": "17841400000000"
  }
  ```
- **Suporte Multi-Contas:** Um cliente (ex: Grupo Lima) terá 1 linha em `ClientIntegration` para cada conta social conectada (Instagram, Facebook, TikTok, etc.), eliminando riscos de duplicação.
- **Permissões (RBAC):**
  - **ADMIN / MANAGER:** Podem vincular e desvincular contas sociais aos clientes.
  - **MEMBER:** Apenas leitura na aba de Conteúdo.

---

## 12. Arquitetura Recomendada

Como o Postiz não oferece webhooks completos com retries garantidos, a arquitetura ideal é:

```
[Postiz API] ◄─── (On-Demand / Polling Inteligente) ───► [Zafira Hub API]
      │                                                         │
      └─────── (Webhook 'post.published') ──► [Zafira Hub Webhook]
                                                        │
                                                        ▼
                                             [PostgreSQL Hub Cache]
                                                        │
                                                        ▼
                                                  [SSE Pipeline]
                                                        │
                                                        ▼
                                           [Cliente 360 > Conteúdo UI]
```

1. **On-Demand Fetch com Cache Inteligente (Fastify / Postgres):**
   - Ao abrir a aba **Cliente 360 > Conteúdo**, o frontend faz requisição a `/clients/:id/postiz/overview`.
   - A API do Hub consulta o Postiz via `/public/v1/posts` com base nos `externalId` vinculados ao cliente.
   - Os dados são cacheados e consolidados no Hub para garantir resposta imediata e disponibilidade offline.
2. **Webhook como Acelerador Opcional:**
   - O Hub expõe um endpoint `/webhooks/postiz/:secretToken`.
   - Ao receber `post.published`, atualiza o status do post no Hub e emite evento SSE para atualizar a UI em tempo real sem reload.

---

## 13. Banco de Dados do Hub: Recomendações

Para atender aos requisitos de relatórios, dashboards consolidados e IA:
- **Fase 1 (MVP de Leitura e Gestão):**
  - Utilizar a tabela `ClientIntegration` existente (`provider: POSTIZ`, `externalId: integration.id`).
  - Consulta direta da API do Postiz com cache em memória/Fastify (sem criar tabelas adicionais imediatamente).
- **Fase 2 (Consolidação de Métricas e Histórico):**
  - Adicionar as tabelas:
    - `postiz_accounts`: Cache local das contas sociais vinculadas.
    - `postiz_posts`: Espelho resumido dos posts (status, link, data, métricas) para consultas analíticas instantâneas.

---

## 14. Variáveis de Ambiente Necessárias no Hub

No backend do Zafira Hub (`api/.env`):
```env
# Conexão com o Postiz
POSTIZ_URL="https://postiz.sua-empresa.com.br"
POSTIZ_API_KEY="chave_da_organizacao_gerada_no_postiz"
POSTIZ_WEBHOOK_SECRET="token_secreto_para_validar_requisicoes_webhook"
```
*(Nenhuma variável do Postiz deve ser exposta no frontend `VITE_*`)*.

---

## 15. Plano da Aba Cliente 360 > Conteúdo

Substituir o placeholder atual em `src/pages/Cliente360.tsx` por uma visualização limpa e focada em gestão:

1. **Header do Cliente:**
   - Badges das contas sociais conectadas com ícone e status (Instagram ✅, Facebook ✅, TikTok ✅).
   - Botão para ADMIN/MANAGER: **"Vincular Conta Social"**.
   - CTA principal: **"Abrir no Postiz"** (abre a tela do Postiz em nova aba com o workspace do cliente).
2. **Cards de Resumo do Mês Atual:**
   - Total de Conteúdos no Mês.
   - Publicados (verde).
   - Agendados / Fila (azul/roxo).
   - Falhas (vermelho, com alerta explicativo).
3. **Próximas Publicações (Próximos 7 dias):**
   - Lista ordenada por data/hora, plataforma, resumo do conteúdo e status.
4. **Últimas Publicações:**
   - Grade ou tabela com thumbnail/mídia, plataforma, data publicada, status e link externo direto para a publicação.
5. **Painel de Falhas:**
   - Destaque claro com mensagem de erro amigável retornada pela API caso algum post tenha falhado.

---

## 16. Estratégia de Sincronização

- **Estratégia Recomendada: Tipo C (On-Demand / Polling Inteligente + Webhooks Opcionais).**
- Por não haver webhooks de agendamento ou erro no Postiz, a leitura em tempo de abertura da aba ou por polling espaçado (ex: a cada 10 minutos para clientes ativos) garante que posts agendados e falhas sejam detectados com 100% de exatidão.

---

## 17. Riscos e Mitigações

1. **Risco:** Postiz fora do ar ou latência na API pública.
   - *Mitigação:* Armazenar o último estado consultado em cache/banco com fallback gracioso e indicador visual de "Última atualização às HH:MM".
2. **Risco:** Ausência de assinatura HMAC no Webhook.
   - *Mitigação:* Utilizar path secreto com UUID seguro na URL registrada no Postiz (ex: `/api/webhooks/postiz/a8b9c0...`).
3. **Risco:** Token social expirado nas plataformas.
   - *Mitigação:* Exibir aviso na UI: *"A conta do Instagram precisa de reconexão no Postiz"*.

---

## 18. Plano de Execução por Fases

- **Fase 1: Credenciais e Conexão da Organização**
  - Implementar módulo `OrganizationIntegration` para POSTIZ na API do Hub.
  - Endpoint de teste de conexão com o Postiz (`/public/v1/is-connected`).
- **Fase 2: Vinculação de Contas Sociais ao Cliente 360**
  - Modal para ADMIN/MANAGER selecionar quais contas sociais do Postiz pertencem a qual cliente.
  - Gravação em `ClientIntegration`.
- **Fase 3: Aba Conteúdo no Cliente 360 (Visualização Read-Only)**
  - Componente de visualização com resumo do mês, próximas publicações, histórico recente e CTA "Abrir no Postiz".
- **Fase 4: Pipeline de Métricas e Webhook**
  - Integração com `/public/v1/analytics/:integration` e endpoint de recepção de `post.published`.

---

## Conclusão da Auditoria

### **POSTIZ INTEGRATION READY: YES**

**Justificativa:**
A API oficial do Postiz (`/public/v1`) disponibiliza todos os dados fundamentais para a leitura de contas sociais conectadas, listagem de posts por período, identificação de estados (`QUEUE`, `PUBLISHED`, `ERROR`, `DRAFT`) e links diretos de publicação. Embora os webhooks sejam limitados a posts publicados, a estratégia de **On-Demand Fetching com cache no Hub** atende integralmente à decisão arquitetural sem exigir agendamento ou publicação pelo Hub.
