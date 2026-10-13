# F7-3 — Google Calendar: Especificação Funcional e Técnica da Integração (v2)

| Campo | Valor |
|---|---|
| Situação | **APROVADA (DEC-F7-012).** Autorizada **somente a F7-3a**; F7-3b/F7-3c não iniciadas. Ver §13. |
| Autoria | v1: Antigravity (2601c56) · v2: Claude, 2026-10-12 (DEC-F7-011) |
| Base | Mapa Mestre C2 §15; DEC-F7-001, DEC-F7-010, DEC-F7-011; DEC-F6-005 (fuso); F7-2 (execução) |
| Mudanças da v2 | Calendários **flexíveis** (sem estrutura prévia); conexão OAuth da organização reutilizando `IntegrationConnection`; estratégia de sincronização corrigida frente às restrições da API; recorrência sem presumir formato de ID; privacidade por padrão (evento sem cliente **não** é visível à agência); minimização de dados; retenção sem exclusão automática |

## 1. Princípios
1. **Google Calendar é a fonte** (DEC-F7-001). O Hub **só lê**: nenhuma criação, edição, exclusão ou convite. Escopo OAuth **somente leitura**.
2. **Nada é criado automaticamente**: nem calendários, nem eventos, nem categorias, nem vínculos. O Hub não presume nenhuma organização de agendas.
3. **Vínculos são locais** (cliente, projeto, categoria, nota) e nunca voltam ao Google.
4. **Permissão do Google ≠ permissão do Hub.** Ter acesso ao calendário no Google, ou ser participante, não concede acesso a dados do Hub, e o contrário também vale. A autorização é sempre do Hub (RBAC, organização, carteira).
5. **Privacidade por padrão e minimização**: armazena-se o mínimo necessário; mascaramento no backend.
6. **Sem contas reais** em desenvolvimento, testes e CI (simulador local). Sem worker ou serviço novo na VPS.
7. Fuso da organização para agrupar por dia (DEC-F6-005).

## 2. Conexão (reuso da infraestrutura existente)
- **Conta Google corporativa conectada por organização, via OAuth 2.0** (fluxo web, `access_type=offline`, PKCE, escopos `calendar.readonly` e identificação mínima da conta). **Não** exige OAuth individual dos colaboradores na primeira versão; conta de serviço com delegação de domínio fica fora desta fase.
- **Reuso:** `IntegrationConnection` com `provider = GOOGLE_CALENDAR` (novo valor do enum, por migration), `authType = OAUTH2`, credenciais cifradas por `encryptIntegrationCredential` em `credentialCiphertext` (refresh token e metadados; nunca em log ou resposta), `externalScopeId` = identificador da conta Google, estado e validação nas colunas existentes. `state` do OAuth assinado e de uso único pela biblioteca atual (`oauthState`). Execuções de sincronização registradas em `SyncRun` (`operation = calendar.sync`) e falhas em `IntegrationError`. **Nenhum mecanismo paralelo de credenciais.**
- **Regra de serviço:** no máximo uma conexão ativa por organização nesta versão; desconectar apaga o segredo e interrompe a sincronização, mantendo os dados locais.
- **Pré-requisito operacional (não bloqueia o código):** o proprietário cria o projeto/credencial OAuth no Google Cloud e informa `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` por variável de ambiente, **somente** quando houver autorização de homologação. O desenvolvimento usa simulador.

## 3. Calendários monitorados (flexível)
1. **Descoberta:** após conectar, o administrador lista os calendários **acessíveis à conta** (`calendarList`: primário, individuais e compartilhados), com nome, cor, papel de acesso e fuso. Calendários só com "livre/ocupado" aparecem sinalizados como de detalhes limitados.
2. **Seleção:** o administrador escolhe **quais monitorar**, podendo escolher vários e **alterar depois**.
3. **Desmarcar** um calendário interrompe a leitura; eventos e vínculos já locais **permanecem** (marcados como "origem não monitorada") e voltam a atualizar se o calendário for remarcado.
4. **Categoria padrão opcional por calendário** (ex.: tudo de "Captações" nasce como `CAPTURE`), decidida pelo administrador; nunca criada sozinha.
5. Sem calendário monitorado, o módulo mostra estado vazio explicativo.

## 4. Modelo de dados (nomes de trabalho)
| Tabela | Conteúdo |
|---|---|
| `calendar_sources` | `organizationId`, `connectionId`, `googleCalendarId`, `name`, `accessRole`, `timeZone`, `color`, `isMonitored`, `defaultCategory?`, `syncCursorAt?` (início da última sincronização **concluída**), `lastSyncedAt?`, `lastReconciledAt?`, `lastError?`. Único `(connectionId, googleCalendarId)`. |
| `calendar_events` | `organizationId`, `sourceId`, **`googleEventId`** (como veio da API), `recurringEventId?`, `originalStart*?` (valor bruto: `dateTime`/`date` e `timeZone`), `iCalUID?`, `title`, `start*/end*` (instante ou data, `isAllDay`), `timeZone?`, `status` (`CONFIRMED`/`TENTATIVE`/`CANCELLED`), `visibility` (valor do Google), `htmlLink?`, `location?`, `attendeeCount`, `attendeeHashes[]` (hash com pepper da organização, para decidir "participante" sem guardar e-mails), `organizerIsMonitoredAccount`, `googleUpdatedAt`, `syncedAt`, `missingFromSourceAt?`. Único `(sourceId, googleEventId)`. |
| `calendar_event_links` | `organizationId`, `eventId` **ou** `recurringKey`, `scope` (`EVENT`/`SERIES`), `clientId?`, `asanaProjectGid?` (somente vínculo local; exige cliente), `category`, `notes?`, `createdBy`, timestamps. |

- **Não armazenados na v1:** descrição, e-mails de participantes, links de videoconferência, anexos, payload bruto. Para abrir a reunião o usuário usa `htmlLink` (Google).
- **Categorias** (enum fechado): `MEETING`, `CAPTURE`, `TECHNICAL_VISIT`, `PRESENTATION`, `TRAINING`, `OTHER`.
- **Integridade:** FKs com a mesma política `NO ACTION DEFERRABLE` onde houver histórico; vínculo nunca é apagado por ressincronização; remoção de organização funciona em cascata. Migration **sem linhas** e **sem remover** índices/gatilhos já existentes.

## 5. Sincronização (corrigida frente à API)
**Restrição da API:** com `syncToken`, `events.list` **não aceita** `timeMin`, `timeMax`, `updatedMin`, `q`, `orderBy`; e um `singleEvents=true` sem `timeMax` expandiria séries sem limite. Combinar "carga com janela" e "syncToken" da v1 era, portanto, inconsistente.

**Estratégia adotada (v1 do Hub): janela móvel com cursor `updatedMin`, sem `syncToken`.**
1. **Carga inicial** (por calendário monitorado): `singleEvents=true`, `showDeleted=true`, `timeMin = hoje − 30 d`, `timeMax = hoje + 180 d`, `maxResults=250`, **paginando por `nextPageToken` até o fim**; upsert idempotente por `(sourceId, googleEventId)`.
2. **Ciclo incremental:** mesma janela + `updatedMin = syncCursorAt − 5 min` (sobreposição de segurança). Cancelados voltam porque `updatedMin` sempre inclui exclusões. O cursor só avança **após todas as páginas** concluírem; falha parcial mantém o cursor (nada se perde, reprocessar é idempotente).
3. **Reconciliação** (diária e após erro persistente): lê a janela completa; eventos locais **dentro da janela** que não vieram são marcados `missingFromSourceAt` (nunca apagados nem desvinculados); reaparecendo, limpam a marca.
4. **Erros:** `429` e `403 rateLimitExceeded`/`userRateLimitExceeded` → *backoff* exponencial com *jitter* (até 3 tentativas) e adiamento do ciclo; `5xx` idem; `401`/`invalid_grant` → conexão marcada "requer reconexão", sincronização pausada, alerta, **leituras locais continuam**; `410`/`syncToken` **não se aplica** (não há token), e qualquer resposta inesperada de cursor cai na reconciliação completa.
5. **Frequência:** *polling* de **15 minutos**, configurável (variável de ambiente e, depois, configuração da organização), com mínimo de 5; "Sincronizar agora" manual com intervalo mínimo. Agendador no **mesmo processo da API** (padrão do espelho do Asana), **desligado por padrão** (`GOOGLE_CALENDAR_SYNC_SCHEDULE_ENABLED=false`) e só ligado em ambiente real **após medição de capacidade e autorização** (mesma regra da P24).
6. **Capacidade (estimativa para avaliação):** 1 a 3 requisições por calendário por ciclo (páginas de 250); 20 calendários ≈ 20–60 req/15 min, muito abaixo das cotas padrão; a medição real fica para a homologação.
7. **Alternativa registrada e adiada:** `syncToken` com carga sem janela e *push notifications* (exigem URL pública HTTPS); reavaliar se a capacidade exigir.

## 6. Eventos recorrentes (sem presumir formato de ID)
- Com `singleEvents=true` cada ocorrência chega como evento próprio: o Hub guarda **`id` exatamente como veio**, `recurringEventId` e `originalStartTime` (valor bruto, `dateTime` ou `date`, com `timeZone`) **sem decompor ou construir IDs**.
- Ocorrência alterada ou cancelada chega com o mesmo `recurringEventId` e `originalStartTime`; a identidade da ocorrência é `(sourceId, id)`.
- **Vínculo de série:** `scope = SERIES` usa `recurringEventId` (+ `sourceId`) como chave; novas ocorrências **herdam por consulta**, sem copiar linhas. Um vínculo `EVENT` numa ocorrência sobrepõe o da série.
- Mudança de horário/fuso da série atualiza as ocorrências futuras pelas próprias respostas da API.

## 7. Acesso, privacidade e mascaramento (backend)
**Permissões novas:** `calendar.view`, `calendar.link`, `calendar.manage_connections`, `calendar.view_all` (explícita; padrão **ADMIN**). Padrões: ADMIN todas; MANAGER `view` + `link`; MEMBER `view`. Entram no `rbac:bootstrap` (P22 segue bloqueador).

| Situação do evento | Quem vê |
|---|---|
| Vinculado a cliente **na carteira** do usuário (visibilidade Google normal) | Detalhe completo permitido pelos campos armazenados |
| Vinculado a cliente **fora** da carteira | Omitido (404/ausente) |
| **Sem cliente** | **Só** participante/organizador (por *hash*) ou quem tem `calendar.view_all`. **Nunca** automaticamente toda a agência |
| `private`/`confidential` no Google | Mascarado para quem não é participante: título "Compromisso privado", sem local/participantes/link, só horário; participantes veem completo |

- O servidor decide e mascara **antes** de responder; o navegador nunca recebe o dado oculto. Filtro de carteira no SQL (`buildClientResourceScopeWhere`), nunca no cliente.
- Organização A nunca lê eventos da B. Vincular exige `calendar.link` **e** cliente na carteira. Participar de um evento no Google não dá acesso ao cliente no Hub.

## 8. Retenção (proposta, sem exclusão automática)
- Referência de **365 dias** de histórico operacional local após o término do evento (proposta, sujeita à aprovação).
- **Nenhuma rotina de exclusão é implementada** antes da política aprovada (relaciona-se à P28). O sistema só **mede** (contagem de elegíveis) e **preserva vínculos** e registros sujeitos a outras obrigações. Desconectar não apaga eventos locais.

## 9. Testes (sem contas reais)
- **Simulador** `scripts/homologation/google-calendar-mock.mjs`: `oauth2 token`, `calendarList`, `events.list` com `pageToken`, `updatedMin`, `showDeleted`, `singleEvents`, eventos recorrentes/alterados/cancelados/dia inteiro/fusos/privados; falhas `429`, `403`, `5xx`, `invalid_grant`. Base da API configurável por variável (`GOOGLE_CALENDAR_API_BASE`, `GOOGLE_OAUTH_TOKEN_URL`); proibido apontar para o Google em CI.
- **Domínio:** conversão de data/dia inteiro/fuso; mapeamento de recorrência; decisão de visibilidade e mascaramento; cursor e janela.
- **PostgreSQL:** isolamento A×B; carteira; sem cliente invisível à agência; idempotência (ressincronizar não duplica nem perde vínculo); reconciliação marca sem apagar; desmarcar/remarcar calendário; segredo cifrado e ausente de respostas; remoção de organização.
- **Browser Gate F7-3** (F7-3b): conexão simulada, seleção de calendários, agenda, vínculo, negativos de permissão/carteira/privacidade, 390 px.
- Segurança: nenhuma chamada de escrita ao Google (teste que falha se o cliente HTTP emitir método diferente de GET para a API do Calendar).

## 10. Integração com o onboarding (F7-2)
Etapas `CALENDAR_EVENT` / condição `CALENDAR_EVENT_LINKED` seguem **indisponíveis** (`ONBOARDING_CALENDAR_AVAILABLE=false`). Serão ligadas somente na fatia **F7-3c**, que usa **vínculos locais já existentes** (evento vinculado ao cliente da execução) para satisfazer a condição, sem escrita no Google.

## 11. Fatiamento
| Fatia | Conteúdo |
|---|---|
| **F7-3a** | Migration, contratos, domínio, conector de leitura OAuth/Calendar, sincronizador, simulador, RBAC, API e testes (domínio + PostgreSQL) |
| **F7-3b** | Telas: conexão, calendários monitorados, agenda, vínculo; Browser Gate F7-3 |
| **F7-3c** | Condição de etapa de onboarding por evento vinculado; liga a chave de Calendar |
Cada fatia exige autorização própria, CI verde e aceite.

## 12. Decisões
**Resolvidas pela Direção (DEC-F7-011):** conexão OAuth da organização com conta corporativa (Q1); calendários flexíveis, selecionados pelo administrador (Q2); evento sem cliente **não** é visível a toda a agência (Q3); *polling* de 15 min configurável (Q4); retenção de 365 dias como proposta, sem exclusão automática (Q5).

**Nenhuma decisão de produto bloqueia a F7-3a.** Padrões técnicos para confirmação (ajustáveis sem mudar o esquema):
| # | Tema | Padrão |
|---|---|---|
| T1 | Sincronização | Janela móvel + `updatedMin` + reconciliação diária; `syncToken` adiado |
| T2 | Dados armazenados | Sem descrição, e-mails, link de videoconferência ou payload; *hash* de participantes para decidir visibilidade |
| T3 | Visão total | Permissão explícita `calendar.view_all`, padrão ADMIN |
| T4 | Janela | −30 d / +180 d (ajustável) |
| T5 | Categoria padrão por calendário | Opcional, definida pelo administrador |

**Dependência operacional (fora do código):** credencial OAuth no Google Cloud, a ser fornecida pelo proprietário só na homologação, jamais em conversa ou repositório.

## 13. Aprovação e ajustes (DEC-F7-012)
T1–T5 aprovadas; **T2 com ajuste** abaixo. Autorizada exclusivamente a F7-3a.

**Identidade de participantes (substitui "hash com pepper" da §4):**
- `attendeeHashes[]` = **HMAC-SHA256** do e-mail normalizado (minúsculas) com **chave protegida** (`CALENDAR_IDENTITY_HMAC_KEY`, variável de ambiente; **ausente = recurso de participante desativado**, nunca um valor padrão). A chave é distinta das chaves de criptografia e de sessão; mensagem = `organizationId:email`.
- **Associação explícita:** tabela `calendar_member_identities` (`organizationMemberId` ↔ `identityHash`, `displayHint` mascarado, quem criou, quando). Só quem tem `calendar.manage_connections` cria/remove; o servidor calcula o HMAC e **descarta o e-mail em texto**. Nenhuma associação automática e **nenhum dado vindo do navegador** (identidade, e-mail ou "sou participante") influencia a decisão: o servidor usa apenas as identidades associadas ao **membro autenticado**.
- Evento "do participante" = interseção entre `attendeeHashes` e as identidades associadas ao membro, na mesma organização.
- `calendar.view_all` lista eventos (inclusive sem cliente), mas **privados/confidenciais continuam mascarados** para quem não é participante; `view_all` não revela o detalhe.

**Janela:** padrão −30/+180 dias, configurável por organização (1–365 e 1–365) em `IntegrationConnection.metadata`.

**Reconciliação (salvaguarda 2):** evento local dentro da janela que não veio na leitura completa recebe `missingFromSourceAt`; **evento cancelado, ausente ou movido para fora da janela deixa de contar como compromisso ativo** (consultas de agenda excluem `CANCELLED` e `missingFromSourceAt`), mas vínculos e histórico permanecem.

**Sincronização:** execução única por calendário via `scheduler_leases` (infraestrutura existente), cursor só avança após todas as páginas, idempotência por `(sourceId, googleEventId)`; revogação OAuth (`invalid_grant`/401) marca a conexão como "requer reconexão", pausa e preserva dados; reconectar retoma com reconciliação completa.

**Segurança:** cliente HTTP do Calendar expõe **apenas GET**; teste falha se qualquer método de escrita for emitido; o endpoint de token OAuth (POST) é a única exceção e não é a API de agenda. Agendamento automático desligado por padrão; nenhuma conta real.
