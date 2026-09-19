Versão 1.1 \| 19 de setembro de 2026

Responsável pelo produto Zafira Marketing

Status Fase 0 concluída e Fase 1 autorizada

Este documento é a fonte oficial de verdade do Zafira Hub 2.1. Ele organiza as decisões já tomadas, o escopo funcional, a arquitetura, as integrações, as regras de dados, a segurança, os testes e a sequência de construção. O projeto só avança de fase quando o respectivo critério de conclusão estiver atendido.

A identidade visual não será definida nesta etapa. Primeiro construiremos a fundação, os dados, os fluxos e os módulos. O documento visual já existente será aplicado na fase final, sem alterar as regras de negócio consolidadas aqui.

## Controle do documento

| **Campo**          | **Definição**                                                                   |
|--------------------|---------------------------------------------------------------------------------|
| Documento          | Mapa Mestre do Zafira Hub 2.1                                                   |
| Finalidade         | Guiar produto, desenvolvimento, validação, migração e lançamento                |
| Escopo             | Hub interno da Zafira, portal de aprovação do cliente e integrações autorizadas |
| Regra de alteração | Toda mudança relevante deve registrar decisão, impacto, responsável e versão    |
| Regra de avanço    | Nenhuma fase é concluída sem critérios de aceite, testes e evidências           |
| Visual             | Última fase, com base no documento de identidade visual da Zafira               |

# Sumário executivo

O Zafira Hub 2.1 será reconstruído como o cockpit operacional e administrativo da agência. O Hub concentrará a leitura do negócio, a memória operacional, os fluxos de aprovação e as ações essenciais. As ferramentas especializadas continuarão executando o que fazem melhor: Asana para projetos, Postiz para publicação, Twenty para CRM, Google Calendar para agenda, n8n para automações e Metabase para análises profundas.

A reconstrução será nova na camada de produto e interface, mas seletiva na camada técnica. O backend do Hub 2.0, o PostgreSQL com Prisma, organizações, usuários, clientes, vínculos de integrações, clientes Postiz e Asana, upload e contratos serão auditados e reaproveitados quando estiverem estáveis, seguros e compatíveis com a nova arquitetura.

## Decisões principais

• O Hub 2.0 permanece congelado como referência funcional e contingência durante a construção.

• O Hub 2.1 nasce em ambiente e linha de desenvolvimento separados, sem substituir a produção antes da homologação final.

• O PostgreSQL do Hub será a memória operacional da agência, inclusive para históricos que não podem depender de dados mutáveis no Asana, Postiz ou outros serviços.

• Integrações serão tratadas como fontes e motores. O usuário verá fluxos do Hub, não telas copiadas das ferramentas externas.

• Dashboards serão derivados de dados confiáveis. Eles entram depois da definição das métricas, sincronizações e históricos.

• Permissões serão aplicadas no backend e no banco, não apenas ocultadas no front-end.

• A IA usará contexto por organização e cliente, com rastreabilidade das fontes e proibição de mistura entre clientes.

• A identidade visual será aplicada apenas quando estrutura, componentes funcionais e estados estiverem estáveis.

## Resultado esperado

Ao final do projeto, o administrador deverá abrir o Hub e compreender a situação da Zafira sem visitar dezenas de projetos e sistemas. O colaborador deverá visualizar sua operação, suas prioridades e seus clientes. O cliente deverá aprovar conteúdo em um fluxo simples e controlado. Todos os dados relevantes deverão possuir origem, histórico, responsável, regra de acesso e evidência de sincronização.

## Indicadores de sucesso do produto

| **Objetivo**     | **Indicador**                              | **Critério inicial**                                                   |
|------------------|--------------------------------------------|------------------------------------------------------------------------|
| Visão da agência | Tempo para identificar pendências críticas | Admin encontra alertas principais em até 2 minutos                     |
| Operação         | Cobertura das entregas contratadas         | Cada entrega recorrente possui meta, estado e histórico                |
| Projetos         | Confiabilidade da leitura do Asana         | Sincronização monitorada e divergências visíveis                       |
| Conteúdo         | Rastreabilidade de aprovação               | Toda versão, comentário, decisão e publicação fica registrada          |
| Clientes         | Cobertura de contexto                      | Clientes ativos possuem briefing, responsáveis, contrato e integrações |
| Segurança        | Isolamento de dados                        | Nenhum acesso fora da organização, cliente ou permissão atribuída      |
| Adoção           | Uso semanal por função                     | Métricas definidas antes do piloto e acompanhadas após lançamento      |

# 1 Governança do projeto

## 1 1 Como usar este mapa

**1.** Toda tarefa de produto ou desenvolvimento deve apontar para uma fase, módulo e item deste documento.

**2.** Antes de iniciar um item, confirmar objetivo, regra, fonte de dados, permissões, dependências e critério de aceite.

**3.** Marcar um item como concluído somente após implementação, teste, registro de evidência e validação do responsável pelo produto.

**4.** Quando uma decisão mudar, atualizar a seção afetada e o registro de decisões. Não manter duas regras conflitantes.

**5.** A fase seguinte pode ser preparada, mas não homologada enquanto o portão da fase anterior estiver aberto.

## 1 2 Estados do checklist

| **Estado**            | **Significado**                                           |
|-----------------------|-----------------------------------------------------------|
| Não iniciado          | Item ainda não possui trabalho aprovado                   |
| Em análise            | Requisitos ou decisão técnica ainda estão sendo definidos |
| Pronto para construir | Dependências e critérios estão claros                     |
| Em desenvolvimento    | Implementação em andamento                                |
| Em validação          | Implementado e submetido a testes ou aceite               |
| Concluído             | Aceite atendido com evidência                             |
| Bloqueado             | Há impedimento explícito, responsável e próxima ação      |
| Adiado                | Fora da fase atual, sem ser descartado                    |

## 1 3 Definição de pronto para construir

☐ Objetivo e usuário do fluxo definidos.

☐ Entradas, saídas, estados vazios, erros e exceções descritos.

☐ Fonte de verdade de cada dado identificada.

☐ Permissões e limites por organização, cliente e função definidos.

☐ Dependências técnicas e de integração disponíveis.

☐ Critérios de aceite testáveis escritos.

☐ Impacto em migração, histórico e auditoria avaliado.

## 1 4 Definição de concluído

☐ Código revisado e integrado à linha de desenvolvimento do Hub 2.1.

☐ Migrações de banco versionadas e testadas em base descartável.

☐ Testes unitários, integração e fluxo crítico aprovados.

☐ Permissões verificadas com casos permitidos e negados.

☐ Logs, métricas, alertas e tratamento de erro disponíveis.

☐ Estados de carregamento, vazio, parcial, erro e sucesso cobertos.

☐ Documentação e mapa atualizados.

☐ Aceite do responsável pelo produto registrado.

☐ Plano de reversão validado quando houver risco de dados ou produção.

## 1 5 Registro mínimo de decisão

| **Campo**          | **Obrigatório**                                   |
|--------------------|---------------------------------------------------|
| Identificador      | ADR ou DEC seguido de número sequencial           |
| Data e responsável | Quem decidiu e quando                             |
| Problema           | Qual escolha precisava ser feita                  |
| Decisão            | O que foi escolhido                               |
| Alternativas       | Opções consideradas                               |
| Impacto            | Módulos, dados, segurança, prazo e infraestrutura |
| Revisão            | Condição que justificará reabrir a decisão        |

# 2 Direção do produto

## 2 1 Missão

O Zafira Hub 2.1 deve oferecer uma visão única, confiável e acionável da agência. Ele conecta pessoas, clientes, projetos, entregas, conteúdo, contratos, agenda, comercial, financeiro e indicadores sem recriar integralmente as ferramentas especializadas.

## 2 2 Princípios não negociáveis

• Uma fonte de verdade por domínio. O Hub pode espelhar dados, mas precisa indicar quem é o sistema mestre.

• Histórico empresarial pertence ao Hub. Eventos relevantes permanecem mesmo que o registro externo seja alterado ou removido.

• Toda automação deve ser observável, repetível quando seguro e protegida contra duplicação.

• Nenhuma tela administrativa pode depender de cálculos sem definição documentada.

• Acesso mínimo necessário. O usuário visualiza e altera apenas o que sua função, equipe e clientes permitem.

• Ações críticas exigem confirmação, auditoria e, quando aplicável, possibilidade de reversão.

• Integrações degradam com clareza. Se um serviço externo falhar, o Hub informa dado desatualizado e preserva o último estado válido.

• O visual serve ao fluxo. A identidade não pode encobrir ausência de regra, dado ou estado funcional.

## 2 3 Escopo incluído

• Dashboards diferentes para administrador, gestor, colaborador e áreas especializadas.

• Gestão de clientes, Cliente 360 e base de conhecimento por cliente.

• Projetos e tarefas lidos do Asana com visão consolidada da operação.

• Planejamento, acompanhamento e histórico de entregas contratadas.

• Onboarding configurável com etapas, responsáveis e automações.

• Agenda da agência integrada ao calendário externo escolhido.

• Criação, revisão, aprovação, agendamento e histórico de conteúdo com Postiz como motor de publicação.

• Contratos dentro do Hub, preservando o fluxo atual de assinatura e automação.

• Health Score, risco, churn, expansão e histórico do relacionamento.

• Cockpits comercial e financeiro conectados aos respectivos motores.

• Monitoramento de perfis dos clientes e, futuramente, creators externos.

• Gestão de usuários, equipes, funções e permissões granulares.

• Central de integrações, sincronizações, erros e credenciais protegidas.

• Camada de IA com contexto autorizado e rastreável.

## 2 4 Fora do escopo inicial

• Substituir o Asana por um gerenciador de projetos próprio.

• Substituir o Postiz por um publicador completo de redes sociais.

• Substituir o Twenty por um CRM completo.

• Substituir o Google Drive ou MinIO por um editor de arquivos.

• Criar folha de pagamento ou módulo completo de recursos humanos.

• Construir videoconferência, chat e armazenamento do zero.

• Replicar o Metabase dentro do front-end operacional.

• Automatizar decisões sensíveis da IA sem revisão humana.

• Aplicar a identidade visual definitiva antes da estabilização funcional.

## 2 5 Perfis de usuário

| **Perfil**      | **Objetivo principal**                     | **Visão inicial**                                   |
|-----------------|--------------------------------------------|-----------------------------------------------------|
| Administrador   | Compreender e dirigir toda a empresa       | Negócio, riscos, receita, operação e alertas        |
| Gestor          | Conduzir carteira, equipe e entregas       | Clientes, projetos, atrasos, agenda e aprovações    |
| Social media    | Planejar e mover conteúdo até a publicação | Pauta, produção, aprovação, agenda e contas sociais |
| Designer        | Executar demandas criativas                | Tarefas, prazos, referências, versões e feedback    |
| Financeiro      | Controlar contratos e movimentações        | Recebíveis, atrasos, vencimentos e documentos       |
| Comercial       | Mover oportunidades e contratos            | Pipeline, follow-ups, propostas e conversão         |
| Colaborador     | Acompanhar o próprio trabalho              | Minhas tarefas, agenda, clientes e avisos           |
| Cliente externo | Revisar e aprovar o que lhe foi enviado    | Conteúdo, comentários, versões e decisão            |

# 3 Reaproveitamento do Hub 2 0

O Hub 2.0 não será descartado nem promovido automaticamente. Cada parte passa por auditoria funcional, técnica e de segurança. O resultado da auditoria determina se a peça será mantida, adaptada, reescrita ou aposentada.

## 3 1 Matriz inicial

| **Componente**                            | **Direção**            | **Validação necessária**                                     |
|-------------------------------------------|------------------------|--------------------------------------------------------------|
| PostgreSQL e Prisma                       | Reaproveitar e evoluir | Migrações, isolamento por organização, índices, backups      |
| Organization User OrganizationMember Role | Reaproveitar e ampliar | Permissões granulares e escopo por equipe e cliente          |
| Client                                    | Reaproveitar e ampliar | Novos campos, contatos, histórico e conhecimento             |
| ClientIntegration                         | Reaproveitar e ampliar | Credenciais, status, sincronização e unicidade               |
| Postiz client e service                   | Reaproveitar           | Compatibilidade, erros, limites, segurança e idempotência    |
| Listagem e preview de conteúdo            | Adaptar                | Separar leitura de publicação do novo fluxo de aprovação     |
| Upload multipart até 100 MB               | Auditar                | Tipos, antivírus, cotas, armazenamento e URLs temporárias    |
| Asana conectado                           | Reaproveitar conector  | Cobertura de projetos, tarefas, campos, paginação e webhooks |
| Contratos e n8n                           | Incorporar ao produto  | Estados, assinatura, reenvio, auditoria e documentos         |
| Dashboard atual                           | Reconstruir            | Métricas por função e fontes confiáveis                      |
| Front-end e navegação                     | Reconstruir            | Nova arquitetura funcional antes do design final             |
| Hub 1.0 em produção                       | Preservar              | Plano de convivência e troca somente após homologação        |

## 3 2 Auditoria obrigatória

☐ Inventariar rotas, serviços, modelos, variáveis, jobs, integrações e telas do Hub 2.0.

☐ Classificar cada item como manter, adaptar, reescrever, migrar dados ou aposentar.

☐ Mapear dívidas conhecidas, falhas intermitentes e dependências implícitas.

☐ Confirmar que nenhum segredo está no repositório ou no front-end.

☐ Registrar contratos de API usados pelo front atual.

☐ Criar testes de caracterização para fluxos que serão reutilizados.

☐ Validar backup e restauração do banco antes de novas migrações.

☐ Escolher o commit de origem e criar a linha de trabalho hub-2.1.

☐ Proteger main, hub-2.0 e produção contra deploy acidental.

# 4 Arquitetura funcional e técnica

## 4 1 Camadas do sistema

| **Camada**      | **Responsabilidade**                                                                       |
|-----------------|--------------------------------------------------------------------------------------------|
| Experiência     | Telas, filtros, formulários, estados, acessibilidade e ações por perfil                    |
| Aplicação       | Casos de uso, validações, permissões, regras de negócio e orquestração                     |
| Domínio         | Clientes, entregas, conteúdo, contratos, agenda, saúde, churn, comercial e financeiro      |
| Integrações     | Adaptadores para Asana, Postiz, Twenty, Calendar, Drive, n8n, Asaas, Ads e demais serviços |
| Dados           | PostgreSQL, arquivos, snapshots, eventos, auditoria e configurações                        |
| Processamento   | Sincronizações, webhooks, filas, retries, jobs e cálculos agendados                        |
| Observabilidade | Logs, métricas, alertas, estado de integrações e trilhas de auditoria                      |
| Inteligência    | Busca, contexto por cliente, IA, recomendações e BI                                        |

## 4 2 Direção tecnológica

• Manter TypeScript, API Fastify e Prisma sempre que a auditoria confirmar compatibilidade.

• Manter PostgreSQL dedicado ao Hub 2.1 e controlar todas as mudanças por migração versionada.

• Organizar o backend por módulos de domínio, evitando serviços únicos com regras misturadas.

• Executar sincronizações e rotinas demoradas em workers, fora das requisições do usuário.

• Começar com fila apoiada no PostgreSQL para reduzir consumo de infraestrutura; reavaliar Redis quando volume e latência justificarem.

• Armazenar datas em UTC e apresentar conforme o fuso da organização.

• Definir contratos de API com validação de entrada, paginação, filtros e respostas de erro padronizadas.

• Versionar cálculos de métricas e manter snapshots para que relatórios históricos não mudem silenciosamente.

## 4 3 Fluxo padrão de integração

**1.** Receber webhook ou iniciar sincronização agendada.

**2.** Validar assinatura, organização, integração e permissões técnicas.

**3.** Registrar o evento bruto permitido ou seu identificador externo.

**4.** Deduplicar pelo identificador do provedor e chave de idempotência.

**5.** Converter o payload para o modelo interno do Hub.

**6.** Atualizar o espelho atual e, quando necessário, criar evento histórico imutável.

**7.** Registrar resultado, duração, quantidade, cursor, erro e próxima tentativa.

**8.** Atualizar indicadores derivados de forma assíncrona.

**9.** Exibir a última sincronização e o nível de frescor no produto.

## 4 4 Fonte de verdade por domínio

| **Domínio**                        | **Fonte mestre**                          | **Papel do Hub**                                          |
|------------------------------------|-------------------------------------------|-----------------------------------------------------------|
| Organização e permissões           | Hub                                       | Criar, aplicar e auditar acesso                           |
| Cadastro e conhecimento do cliente | Hub                                       | Manter contexto, vínculos e histórico                     |
| Projetos e tarefas                 | Asana                                     | Espelhar, consolidar, classificar e alertar               |
| Entregas contratadas               | Hub                                       | Planejar, vincular tarefas e preservar histórico          |
| Publicação social                  | Postiz                                    | Orquestrar aprovação, agendamento e leitura de estado     |
| Aprovação e versões                | Hub                                       | Registrar comentários, decisões e versões                 |
| Agenda compartilhada               | Google Calendar e Hub conforme tipo       | Sincronizar e contextualizar por cliente e projeto        |
| CRM                                | Twenty                                    | Espelhar pipeline e exibir cockpit comercial              |
| Contratos                          | Hub e serviço de assinatura atual         | Gerir ciclo, documento e eventos                          |
| Financeiro                         | Hub inicialmente e Asaas quando conectado | Consolidar recebíveis, despesas, fluxo e alertas          |
| BI profundo                        | Metabase sobre dados autorizados          | Oferecer navegação e links incorporados quando seguro     |
| Automação                          | n8n                                       | Disparar fluxos, acompanhar execução e receber resultados |

## 4 5 Multiempresa e isolamento

☐ Toda tabela de negócio possui organizationId direto ou uma relação obrigatória que permita comprovar a organização.

☐ Toda consulta aplica escopo no backend antes de acessar ou alterar dados.

☐ Identificadores externos nunca bastam para autorizar acesso.

☐ Cache inclui organização e, quando aplicável, cliente na chave.

☐ Arquivos usam caminho e política separados por organização e cliente.

☐ Jobs e webhooks resolvem a organização antes de processar o payload.

☐ Testes automatizados tentam acessar dados cruzados entre duas organizações.

☐ Logs não armazenam tokens, senhas, documentos completos ou conteúdo sensível desnecessário.

## 4 6 Infraestrutura e capacidade

A VPS atual possui 8 GB de RAM e já apresentou uso entre 92 e 95 por cento. A existência de 4 GB de swap reduz o risco de encerramento abrupto, mas não substitui capacidade real. O Hub 2.1 deve nascer com orçamento de recursos e não deve adicionar todos os serviços planejados ao mesmo tempo.

☐ Medir consumo por container durante sete dias antes de definir a topologia de homologação.

☐ Definir limites de memória e CPU por serviço no EasyPanel.

☐ Separar banco, API, front e worker conforme capacidade disponível.

☐ Não compartilhar banco, fila ou credenciais entre Postiz e Hub apenas por conveniência.

☐ Criar política de backup automático e testar restauração.

☐ Criar monitoramento de RAM, swap, disco, CPU, banco, filas e latência externa.

☐ Definir gatilho para upgrade ou segunda VPS antes de instalar Twenty, Metabase, MinIO, Outline, Novu e demais serviços.

☐ Documentar limites conhecidos de EasyPanel e estratégia caso o limite de projetos impeça a homologação.

# 5 Modelo de acesso

## 5 1 Estratégia

O controle de acesso combinará função, permissões explícitas e escopo. A função fornece um conjunto inicial; o administrador pode ajustar permissões individuais. O escopo limita a ação à organização, squad, clientes atribuídos ou ao próprio usuário.

## 5 2 Permissões mínimas

| **Área**      | **Exemplos de permissões**                                                          |
|---------------|-------------------------------------------------------------------------------------|
| Clientes      | listar, visualizar, criar, editar, arquivar, exportar, ver dados sensíveis          |
| Projetos      | visualizar, sincronizar, abrir no Asana, alterar vínculos                           |
| Entregas      | visualizar, planejar, concluir, reabrir, cancelar, ajustar meta                     |
| Conteúdo      | criar, revisar, enviar ao cliente, aprovar internamente, agendar, publicar, excluir |
| Financeiro    | visualizar resumo, ver detalhes, editar, conciliar, exportar                        |
| Contratos     | visualizar, criar, enviar, reenviar, cancelar, baixar documento                     |
| Comercial     | visualizar pipeline, editar negócio, ver valores, exportar                          |
| Usuários      | convidar, editar função, atribuir clientes, suspender, remover                      |
| Integrações   | visualizar estado, conectar, reconectar, sincronizar, remover                       |
| Administração | configurar organização, métricas, templates, auditoria e retenção                   |

## 5 3 Regras obrigatórias

☐ A API nega por padrão quando a permissão não estiver presente.

☐ O front-end reflete a permissão, mas não substitui a verificação do backend.

☐ Mudanças de acesso geram evento de auditoria com autor, antes, depois e data.

☐ Usuário suspenso perde sessões ativas e tokens de acesso.

☐ Convites expiram e só podem ser usados pelo destinatário autorizado.

☐ Acesso de cliente externo é limitado ao conteúdo enviado e nunca expõe dados internos.

☐ Ações críticas podem exigir nova autenticação ou confirmação adicional.

☐ Exportações respeitam os mesmos filtros e permissões da tela.

# 6 Arquitetura da informação

## 6 1 Navegação administrativa proposta

• Início

• Clientes com Visão geral, Gestão, Health Score e Churn

• Operação com Projetos, Entregas, Onboarding e Agenda

• Conteúdo com Planejamento, Aprovações, Calendário e Publicações

• Comercial com Pipeline, Propostas e Indicadores

• Financeiro com Visão geral, Recebíveis, Despesas e Fluxo de caixa

• Contratos

• Insights com Performance, Social e relatórios consolidados

• Integrações

• Usuários e equipes

• Configurações

## 6 2 Cliente 360

O Cliente 360 é a entidade organizadora do produto. Qualquer informação relacionada a um cliente deve poder ser encontrada a partir dele, respeitando permissão e fonte de verdade.

• Visão geral

• Briefing e conhecimento

• Contatos e responsáveis

• Entregas

• Conteúdo

• Projetos e tarefas

• Performance

• Financeiro

• Contratos

• Brand Kit e arquivos

• Reuniões e atas

• Solicitações

• Integrações

• Health Score e histórico

## 6 3 Experiências distintas

| **Experiência**    | **Conteúdo prioritário**                                                      |
|--------------------|-------------------------------------------------------------------------------|
| Admin              | Situação da empresa, alertas, receita, risco, operação, capacidade e decisões |
| Gestor             | Carteira, equipe, entregas, atrasos, aprovações, agenda e saúde dos clientes  |
| Colaborador        | Minhas tarefas, prazos, agenda, clientes atribuídos, feedback e avisos        |
| Área especializada | Fluxos e indicadores da função, como conteúdo, financeiro ou comercial        |
| Cliente externo    | Itens enviados para aprovação, versões, comentários e decisão                 |

# 7 Modelo de dados do domínio

Os nomes abaixo orientam o modelo conceitual. A modelagem física será confirmada após a auditoria do Prisma atual e poderá preservar nomes existentes para evitar migrações desnecessárias.

| **Domínio**   | **Entidades conceituais**                                                                                                       |
|---------------|---------------------------------------------------------------------------------------------------------------------------------|
| Identidade    | Organization, User, OrganizationMember, Role, Permission, Team, TeamMember, UserClientAssignment                                |
| Clientes      | Client, ClientContact, ClientOwner, ClientTag, ClientStatusHistory, ClientKnowledgeEntry, ClientAsset                           |
| Integrações   | IntegrationConnection, ClientIntegration, ExternalAccount, SyncRun, SyncCursor, WebhookEvent, IntegrationError                  |
| Projetos      | ExternalProject, ExternalTask, TaskAssignee, TaskSnapshot, ProjectHealthSnapshot, ProjectClientLink                             |
| Entregas      | DeliverableTemplate, DeliverablePlan, DeliverableItem, DeliverableLink, DeliverableEvent                                        |
| Onboarding    | OnboardingTemplate, OnboardingStepTemplate, OnboardingRun, OnboardingStepRun                                                    |
| Agenda        | CalendarConnection, CalendarEvent, EventParticipant, EventClientLink, EventProjectLink                                          |
| Conteúdo      | ContentItem, ContentVersion, ContentAsset, InternalReview, ClientApprovalRequest, ApprovalDecision, ContentComment, Publication |
| Contratos     | Contract, ContractVersion, ContractParty, SignatureRequest, SignatureEvent, ContractDocument                                    |
| Saúde e churn | HealthScoreDefinition, HealthScoreSnapshot, HealthSignal, RiskEvent, LifecycleEvent, ChurnEvent                                 |
| Comercial     | LeadMirror, DealMirror, PipelineSnapshot, Proposal, LossReason                                                                  |
| Financeiro    | FinancialAccount, Receivable, Payable, Transaction, Reconciliation, FinancialSnapshot                                           |
| Social        | SocialProfile, SocialMetricSnapshot, ContentMetricSnapshot, CreatorProfile                                                      |
| Governança    | AuditEvent, Notification, NotificationPreference, SavedView, MetricDefinition, FeatureFlag                                      |
| Inteligência  | KnowledgeDocument, KnowledgeChunk, AIConversation, AIAnswerSource, AIActionProposal                                             |

## 7 1 Regras de histórico

☐ Estados atuais e eventos históricos são separados quando a evolução precisa ser auditada.

☐ Snapshots registram data de referência, fonte, versão do cálculo e momento da coleta.

☐ Exclusão operacional usa arquivamento quando o dado possui valor histórico.

☐ Eventos financeiros, contratuais, aprovações e auditoria não são apagados por ações comuns.

☐ Registros externos guardam provider, externalId e vínculo interno único por organização.

☐ Toda alteração manual relevante registra autor e justificativa quando aplicável.

# 8 Especificação dos módulos

## 8 1 Início e dashboards por função

**Objetivo** Responder rapidamente o que exige atenção para cada perfil, usando apenas métricas definidas e dados com frescor conhecido.

**Usuários** Todos os usuários autenticados, com conteúdo filtrado por função e escopo.

### Capacidades

• Dashboard do administrador com clientes, receita, recebíveis, entregas, projetos críticos, aprovações, contratos, agenda e alertas.

• Dashboard do gestor com carteira, equipe, atrasos, carga, reuniões e riscos.

• Dashboard do colaborador com minhas tarefas, agenda, clientes, aprovações e avisos.

• Dashboards especializados para conteúdo, comercial e financeiro.

• Filtros por período, cliente, responsável, squad e status conforme permissão.

• Indicadores clicáveis que abrem a lista filtrada responsável pelo número.

### Dados e integrações

• Dados agregados do Hub, snapshots do Asana, Postiz, CRM e financeiro.

• MetricDefinition mantém fórmula, fonte, periodicidade e versão.

• Cada cartão informa última atualização e condição de indisponibilidade.

### Regras

• Nenhuma métrica pode existir apenas no front-end.

• Números de resumo devem reconciliar com a lista detalhada.

• Dados incompletos são identificados, sem transformar ausência em zero.

• Dashboard não substitui relatórios analíticos do Metabase.

### Checklist de construção

☐ Definir perguntas de negócio de cada função.

☐ Definir catálogo de métricas e fórmulas.

☐ Criar endpoints agregadores e cache com invalidação.

☐ Criar filtros e links para listas detalhadas.

☐ Implementar estados parcial, desatualizado, vazio e erro.

☐ Instrumentar tempo de carregamento e uso dos cartões.

### Critérios de aceite

☐ Administrador identifica pendências críticas em até dois minutos durante teste guiado.

☐ Todos os números auditados coincidem com as consultas de origem.

☐ Usuário sem permissão não recebe valores ou contagens restritas.

## 8 2 Clientes e dashboard da carteira

**Objetivo** Transformar a carteira de clientes em uma área de gestão, não apenas em um cadastro.

**Usuários** Administrador, gestor, comercial e usuários autorizados.

### Capacidades

• Indicadores de clientes ativos, novos, pausados, em risco, encerrados, expansão e churn.

• LTV, CAC, MRR, receita por cliente e tempo de contrato quando os dados estiverem disponíveis.

• Distribuição por responsável, squad, serviço, localização, estágio e faixa de Health Score.

• Lista com busca, filtros salvos, ordenação, colunas configuráveis e exportação autorizada.

• Drawer de consulta rápida e acesso ao Cliente 360 completo.

• Ações de criar, editar, arquivar, atribuir responsáveis e iniciar onboarding.

### Dados e integrações

• Client e entidades relacionadas são mestres no Hub.

• Receita, contrato, projetos e integrações aparecem por vínculos explícitos.

• Histórico de status registra início, pausa, reativação, expansão, redução e encerramento.

### Regras

• Cliente arquivado permanece nos relatórios históricos.

• Mudança de status exige data efetiva e, quando aplicável, motivo.

• LTV e CAC só aparecem quando a definição e a base de dados estiverem aprovadas.

• Um mesmo identificador de conta externa não pode ser vinculado a dois clientes da mesma organização quando a integração proibir duplicidade.

### Checklist de construção

☐ Auditar e migrar o modelo Client do Hub 2.0.

☐ Criar contatos, responsáveis, tags, serviços e histórico de status.

☐ Criar painel de carteira e lista operacional.

☐ Criar drawer com resumo e atalhos.

☐ Implementar importação com prévia, validação e relatório de erros.

☐ Criar deduplicação assistida sem mesclar automaticamente.

### Critérios de aceite

☐ Cadastro criado aparece na carteira e no Cliente 360.

☐ Mudanças de status alteram indicadores apenas na data efetiva correta.

☐ Filtros e exportações preservam escopo e permissão.

## 8 3 Cliente 360 e conhecimento

**Objetivo** Concentrar todo o contexto operacional e estratégico de um cliente, servindo pessoas e IA.

**Usuários** Equipe interna autorizada; cliente externo apenas em áreas especificamente publicadas.

### Capacidades

• Resumo com status, responsáveis, serviços, contrato, saúde, próximos eventos e alertas.

• Briefing estruturado por objetivos, público, oferta, diferenciais, concorrentes, tom, restrições e aprovações.

• Brand Kit com logos, fontes, cores, guias, links e arquivos versionados.

• Contatos, reuniões, atas, solicitações, links, integrações e histórico.

• Abas para entregas, conteúdo, projetos, performance, financeiro e contratos.

• Busca no contexto do cliente com indicação da fonte e data.

### Dados e integrações

• Campos estruturados no Hub e documentos autorizados no Drive ou storage definido.

• KnowledgeDocument e KnowledgeChunk são sempre vinculados à organização e ao cliente.

• Arquivos recebem metadados, versão, autor e política de acesso.

### Regras

• Informação sensível possui classificação e permissão própria.

• A IA não usa documento sem vínculo e autorização válidos.

• Atualização de briefing registra histórico quando muda orientação estratégica.

• Links externos não são tratados como conteúdo lido até que tenham sido importados ou autorizados.

### Checklist de construção

☐ Definir esquema mínimo de briefing.

☐ Definir categorias de ativos e documentos.

☐ Criar edição por seções e histórico.

☐ Criar upload e referência ao Drive com políticas de acesso.

☐ Criar busca textual e filtros.

☐ Preparar indexação para IA com exclusão e reindexação controladas.

### Critérios de aceite

☐ Equipe encontra briefing, contrato, responsáveis e últimos eventos sem sair do Cliente 360.

☐ Documento removido do contexto deixa de ser recuperado pela IA após reindexação.

☐ Usuário de outro cliente ou organização não consegue localizar o conteúdo.

## 8 4 Projetos e leitura do Asana

**Objetivo** Oferecer visão consolidada da operação do Asana sem transformar o Hub em um novo gerenciador de projetos.

**Usuários** Administrador, gestores e colaboradores com projetos ou clientes atribuídos.

### Capacidades

• Projetos ativos, concluídos, pausados e sem atualização.

• Progresso, tarefas totais, concluídas, atrasadas, sem responsável e próximas do prazo.

• Visão por cliente, projeto, responsável, squad e período.

• Projetos críticos com explicação do critério.

• Deep link para o projeto ou tarefa no Asana.

• Histórico de snapshots para tendências e entregas.

### Dados e integrações

• Asana é a fonte mestre de projetos e tarefas.

• Hub mantém espelho normalizado e snapshots necessários para histórico.

• Webhooks reduzem latência; sincronização completa corrige perdas.

### Regras

• A primeira fase é de leitura e vínculo, sem editar tarefas no Hub.

• O cálculo de progresso precisa ter fórmula definida por tipo de projeto.

• Tarefa concluída após o prazo mantém evidência de atraso histórico quando necessário.

• Campos personalizados do Asana são mapeados, não interpretados por texto solto.

### Checklist de construção

☐ Inventariar workspaces, projetos, campos e limites da API.

☐ Definir vínculo projeto cliente e tratamento de projetos internos.

☐ Implementar sincronização incremental, completa e manual.

☐ Criar monitor de webhooks, cursores e erros.

☐ Criar snapshots diários ou por mudança relevante.

☐ Construir visão geral, lista e detalhe do projeto.

### Critérios de aceite

☐ Contagens reconciliam com amostra selecionada no Asana.

☐ Falha de sincronização não apaga o último estado válido.

☐ Usuário vê claramente quando os dados estão desatualizados.

## 8 5 Gestão de entregas

**Objetivo** Comparar o que foi vendido, planejado e efetivamente entregue, preservando histórico empresarial.

**Usuários** Administrador, gestores, operação e usuários autorizados.

### Capacidades

• Catálogo de tipos de entrega por serviço.

• Planos mensais, por campanha, contrato ou projeto.

• Metas contratadas e contagens planejadas, em produção, entregues, atrasadas, canceladas e excedentes.

• Vínculo de uma entrega a tarefas do Asana, conteúdos, arquivos, campanhas ou evidências.

• Ajustes justificados, reabertura e histórico de eventos.

• Relatórios por cliente, serviço, responsável, squad e período.

### Dados e integrações

• O Hub é a fonte mestre do compromisso de entrega.

• Asana e Postiz fornecem evidências e eventos, não substituem o plano contratado.

• Contrato pode originar automaticamente um plano de entregas.

### Regras

• Excluir ou renomear tarefa no Asana não apaga a entrega histórica.

• Alteração de meta após início do período registra autor, motivo e valor anterior.

• Entrega só conta como concluída quando atende ao critério do seu tipo.

• Itens extras são identificados separadamente do contratado.

### Checklist de construção

☐ Definir taxonomia de entregas da Zafira.

☐ Criar templates por pacote ou contrato.

☐ Criar plano, itens, vínculos e eventos.

☐ Criar conciliação sugerida com Asana e Postiz.

☐ Criar tela mensal e detalhe por cliente.

☐ Criar fechamento do período com bloqueio e reabertura autorizada.

### Critérios de aceite

☐ Para um cliente piloto, o total contratado, entregue e pendente é reproduzível por evidências.

☐ Mudanças externas não alteram períodos já fechados.

☐ Ajustes manuais aparecem na auditoria e nos relatórios.

## 8 6 Onboarding

**Objetivo** Padronizar a entrada de clientes e conectar contrato, briefing, acessos, ferramentas e início da operação.

**Usuários** Comercial, gestor, operação, financeiro e administrador.

### Capacidades

• Templates por tipo de cliente ou serviço.

• Etapas, responsáveis, prazo relativo, dependências e evidências.

• Progresso geral, bloqueios, atrasos e próximos passos.

• Disparos para n8n quando etapas mudarem.

• Criação assistida de cliente, estrutura de arquivos, projeto Asana, contas Postiz e agenda de kickoff.

### Dados e integrações

• Hub mantém templates e execução.

• n8n executa automações externas.

• Asana pode receber projeto operacional após pré-requisitos.

### Regras

• Etapas dependentes não podem ser concluídas fora de ordem sem autorização e justificativa.

• Automações devem ser idempotentes.

• Falha automática não marca etapa como concluída.

• Mudança de template não altera silenciosamente onboardings em andamento.

### Checklist de construção

☐ Mapear o onboarding real da Zafira.

☐ Criar template versionado.

☐ Criar execução, responsáveis, prazos e anexos.

☐ Integrar eventos com n8n.

☐ Criar visão geral e detalhe.

☐ Criar alertas e relatório de tempo por etapa.

### Critérios de aceite

☐ Um cliente piloto percorre o fluxo completo sem checklist paralelo.

☐ Etapas automáticas podem ser repetidas sem duplicar projetos, pastas ou convites.

☐ Bloqueios e responsáveis são visíveis no dashboard do gestor.

## 8 7 Agenda da agência

**Objetivo** Reunir compromissos operacionais em um calendário contextualizado por cliente, projeto, equipe e tipo.

**Usuários** Todos os usuários internos; clientes apenas quando convidados pelo calendário externo.

### Capacidades

• Tipos como reunião, captação, visita, apresentação, treinamento, evento, entrega e rotina.

• Participantes, cliente, projeto, localização, links, lembretes e anexos.

• Visões mensal, semanal, diária e lista.

• Filtros por equipe, usuário, cliente e tipo.

• Conflitos de horário e eventos sem confirmação.

• Sincronização com Google Calendar e links para videoconferência quando disponíveis.

### Dados e integrações

• Eventos podem nascer no Hub ou Calendar conforme categoria definida.

• ExternalId e calendário de origem evitam duplicidade.

• Webhook e sincronização periódica resolvem alterações externas.

### Regras

• O sistema deve definir precedência em conflitos antes de permitir edição bidirecional.

• Exclusão externa preserva evento de auditoria quando o compromisso já ocorreu.

• Fuso horário é armazenado e exibido corretamente.

• Participantes veem apenas eventos que sua conta pode acessar.

### Checklist de construção

☐ Definir tipos e calendários oficiais.

☐ Conectar conta e mapear calendários.

☐ Criar evento, edição, cancelamento e recorrência.

☐ Implementar sincronização e resolução de conflitos.

☐ Criar filtros e vínculos com cliente e projeto.

☐ Criar notificações e lembretes.

### Critérios de aceite

☐ Evento criado no Hub aparece no calendário correto sem duplicidade.

☐ Alteração externa aparece no Hub dentro do intervalo acordado.

☐ Participantes e fusos permanecem corretos em eventos recorrentes.

## 8 8 Conteúdo e aprovação

**Objetivo** Controlar o conteúdo desde o rascunho até a aprovação, agendamento e publicação, com versões e decisões auditáveis.

**Usuários** Social media, designer, gestor, administrador e cliente externo convidado.

### Capacidades

• Conteúdo com cliente, canal, formato, texto, ativos, data desejada e responsáveis.

• Fluxo configurável de rascunho, revisão interna, correção, envio ao cliente, alteração, aprovação, agendamento, publicação e falha.

• Versões imutáveis do que foi enviado ao cliente.

• Comentários por versão, marcação de resolvido e histórico.

• Link seguro de aprovação com validade, identidade do aprovador e opção de autenticação.

• Preview correto de feed, reel, story, vídeo e carrossel.

• Agendamento no Postiz apenas para a versão aprovada.

### Dados e integrações

• Hub é mestre de versões, aprovação e comentários.

• Postiz é mestre de agendamento, tentativa e publicação.

• Contas sociais são vinculadas a clientes por ClientIntegration.

### Regras

• Uma alteração após envio cria nova versão e não modifica a versão revisada pelo cliente.

• Aprovação registra pessoa, data, versão, IP ou evidência disponível e decisão.

• Story não exige legenda quando o formato não a utiliza.

• Publicação não pode usar uma conta vinculada a outro cliente da mesma organização.

• Falha no Postiz mantém aprovação e registra estado de publicação separado.

• Tokens públicos expiram, podem ser revogados e não expõem dados internos.

### Checklist de construção

☐ Reaproveitar e testar o conector Postiz do Hub 2.0.

☐ Criar modelo ContentItem e ContentVersion.

☐ Criar revisão interna e pedido de aprovação.

☐ Criar portal externo e comentários.

☐ Criar transição aprovada para agendamento.

☐ Criar webhooks ou sincronização de estado de publicação.

☐ Criar calendário editorial e filtros.

### Critérios de aceite

☐ Cliente aprova exatamente a versão que será agendada.

☐ Pedido de alteração preserva comentários e versão anterior.

☐ Feed, reel, story, vídeo e carrossel são classificados e exibidos corretamente.

☐ Retentativa de agendamento não cria publicação duplicada.

## 8 9 Contratos

**Objetivo** Trazer o ciclo contratual para dentro do Hub, preservando o mecanismo atual de assinatura e automação.

**Usuários** Administrador, financeiro, comercial e gestores autorizados.

### Capacidades

• Lista por cliente, tipo, valor, início, término, renovação e status.

• Modelos, versões, partes, anexos e documento final.

• Enviar, reenviar, cancelar e acompanhar assinatura.

• Alertas de vencimento, renovação, pendência e assinatura.

• Vínculo com cliente, onboarding, entregas e financeiro.

### Dados e integrações

• Hub controla ciclo e metadados.

• Serviço atual e n8n continuam executando assinatura e envio até decisão posterior.

• Eventos recebidos atualizam estado de modo idempotente.

### Regras

• Documento assinado nunca é sobrescrito por uma nova versão.

• Status depende de eventos comprováveis.

• Reenvio não cria contrato novo.

• Valor e escopo sensíveis obedecem permissão própria.

### Checklist de construção

☐ Inventariar fluxo atual e webhook send-contract-signed.

☐ Modelar contrato, versão, partes e eventos.

☐ Integrar envio e retorno do n8n.

☐ Criar armazenamento e download seguro.

☐ Criar alertas e vínculo com onboarding.

☐ Testar assinatura, expiração, reenvio e falha.

### Critérios de aceite

☐ Contrato percorre rascunho, envio, assinatura e arquivamento sem operação paralela externa.

☐ Documento final pode ser localizado no Cliente 360.

☐ Eventos duplicados não alteram indevidamente o estado.

## 8 10 Health Score e risco

**Objetivo** Explicar a saúde do relacionamento e antecipar risco com fatores rastreáveis.

**Usuários** Administrador e gestores; visões limitadas para outras funções.

### Capacidades

• Pontuação atual, faixa de risco, tendência e motivos da variação.

• Componentes de entregas, relacionamento, financeiro, resultados, engajamento e contrato.

• Sinais automáticos e avaliações manuais justificadas.

• Histórico por período e alertas de deterioração.

• Lista de clientes prioritários com próxima ação e responsável.

### Dados e integrações

• Dados do Hub e snapshots de integrações alimentam sinais.

• HealthScoreDefinition versiona pesos, limites e regras.

• HealthScoreSnapshot preserva o resultado calculado e seus componentes.

### Regras

• O score nunca é exibido sem explicação dos fatores.

• Ausência de dado reduz confiança, não vira nota neutra silenciosamente.

• Mudança de fórmula não reescreve snapshots antigos.

• A primeira versão é apoio gerencial, não previsão automática de cancelamento.

### Checklist de construção

☐ Definir sinais disponíveis e qualidade dos dados.

☐ Aprovar pesos iniciais e faixas.

☐ Criar definição versionada e cálculo.

☐ Criar detalhes e histórico.

☐ Criar alertas, responsáveis e ações.

☐ Calibrar com casos reais por pelo menos três ciclos.

### Critérios de aceite

☐ Cada ponto da nota pode ser reproduzido pelos sinais armazenados.

☐ Usuário entende por que a nota subiu ou caiu.

☐ Score com baixa cobertura de dados informa confiança reduzida.

## 8 11 Churn e ciclo de vida

**Objetivo** Registrar perdas, reduções, expansões e retenção para entender comportamento da carteira.

**Usuários** Administrador, gestor, comercial e financeiro autorizado.

### Capacidades

• Eventos de entrada, renovação, expansão, redução, pausa, reativação, pedido de cancelamento e encerramento.

• Logo churn, churn de receita, expansão, contração e retenção por período.

• Motivo, categoria, receita afetada, tempo como cliente, serviço, responsável e score anterior.

• Coortes por mês de entrada e duração.

• Comparações por serviço, squad, origem comercial e faixa de contrato.

### Dados e integrações

• Hub é mestre dos eventos de ciclo de vida.

• Contrato e financeiro fornecem datas e valores de suporte.

• MetricDefinition versiona fórmulas e exclusões.

### Regras

• Cancelamento e pausa são eventos diferentes.

• Redução de contrato não conta como perda completa de cliente.

• Data efetiva e data de registro são armazenadas separadamente.

• Coortes não mudam por reclassificação sem histórico.

### Checklist de construção

☐ Definir taxonomia de motivos.

☐ Definir fórmulas de churn e retenção.

☐ Criar captura de eventos e validações.

☐ Criar dashboards, coortes e listas detalhadas.

☐ Vincular eventos ao Health Score e contrato.

☐ Criar revisão mensal de dados incompletos.

### Critérios de aceite

☐ Métricas do período podem ser reconciliadas cliente por cliente.

☐ Receita perdida usa o valor efetivo do período definido.

☐ Motivos não definidos aparecem como pendência, não são omitidos.

## 8 12 Comercial

**Objetivo** Exibir o desempenho comercial da Zafira usando o CRM como motor de pipeline.

**Usuários** Administrador, comercial e gestores autorizados.

### Capacidades

• Pipeline, negócios por etapa, valor, probabilidade e tempo parado.

• Leads por origem, conversão, ticket, ciclo, ganhos e perdidos.

• Follow-ups vencidos e próximos.

• Propostas e contratos relacionados.

• Motivos de perda e previsão com premissas explícitas.

### Dados e integrações

• Twenty será a fonte mestre quando implantado.

• Hub mantém espelho e snapshots para dashboards.

• Conversão de negócio ganho inicia contrato, cliente ou onboarding conforme regra aprovada.

### Regras

• O Hub não replica todos os recursos de CRM.

• Valores restritos exigem permissão comercial ou administrativa.

• Negócio ganho não cria registros duplicados em retentativas.

• Forecast é identificado como estimativa.

### Checklist de construção

☐ Definir pipeline e campos da Zafira.

☐ Implantar ou conectar Twenty quando houver capacidade.

☐ Mapear pessoas, empresas, negócios e etapas.

☐ Criar sincronização e snapshots.

☐ Criar cockpit e alertas.

☐ Integrar ganho ao onboarding e contrato.

### Critérios de aceite

☐ Pipeline no Hub reconcilia com amostra do Twenty.

☐ Negócio ganho inicia o fluxo definido uma única vez.

☐ Usuário sem acesso a valores recebe visão permitida sem vazamento por contagens ou exportações.

## 8 13 Financeiro

**Objetivo** Controlar a situação financeira operacional e relacioná-la a clientes, contratos e serviços.

**Usuários** Administrador, financeiro e usuários expressamente autorizados.

### Capacidades

• Receita, MRR, recebidos, contas a receber, atrasados, despesas, resultado e fluxo de caixa.

• Recebíveis por cliente, contrato, competência, vencimento e pagamento.

• Despesas por categoria, centro e recorrência.

• Inadimplência, próximos vencimentos e alertas.

• Receita e margem estimada por cliente quando custo estiver disponível.

• Importação controlada e futura integração com Asaas.

### Dados e integrações

• Hub pode ser mestre inicial dos registros operacionais.

• Asaas se torna mestre dos eventos de cobrança conectados quando implantado.

• Contratos originam previsões, mas não equivalem a pagamento recebido.

### Regras

• Competência, vencimento, pagamento e conciliação são datas diferentes.

• Valor contratado não é tratado como caixa.

• Cancelamento financeiro exige estorno ou evento correspondente.

• Dados financeiros nunca aparecem por padrão para funções sem permissão.

### Checklist de construção

☐ Auditar o módulo financeiro já construído.

☐ Definir plano de categorias e regras de competência.

☐ Criar recebíveis, despesas, transações e conciliação.

☐ Criar importação com prévia e idempotência.

☐ Criar dashboards e fechamento mensal.

☐ Planejar integração Asaas sem bloquear o MVP.

### Critérios de aceite

☐ Saldo e totais do período reconciliam com a fonte selecionada.

☐ Importar o mesmo arquivo novamente não duplica lançamentos.

☐ Mudança de permissão remove acesso a telas, endpoints e exportações.

## 8 14 Monitoramento social e performance

**Objetivo** Acompanhar contas dos clientes e, em etapa posterior, perfis externos relevantes.

**Usuários** Administrador, gestores, social media e performance.

### Capacidades

• Perfis dos clientes, seguidores, crescimento, alcance, engajamento e frequência.

• Desempenho por conteúdo, formato, período e canal.

• Perfis de creators com dados permitidos e origem identificada.

• Benchmark apenas quando dados forem comparáveis.

• Painel de mídia paga específico, separado do BI geral.

### Dados e integrações

• Postiz e APIs autorizadas fornecem dados orgânicos disponíveis.

• Meta Ads e Google Ads exigem credenciais, permissões e conectores próprios.

• Metabase pode executar análises amplas sobre dados consolidados.

### Regras

• Métricas orgânicas e pagas não são misturadas sem rótulo.

• Dados de creators externos dependem de fonte legal e tecnicamente disponível.

• Mudanças de definição das plataformas são versionadas.

• Limites e atrasos de API são exibidos como frescor do dado.

### Checklist de construção

☐ Inventariar métricas disponíveis no Postiz e APIs.

☐ Definir armazenamento de snapshots.

☐ Criar perfis de cliente e painéis orgânicos.

☐ Realizar descoberta técnica de creators externos.

☐ Definir arquitetura de Ads antes de implementar dashboards.

☐ Conectar ao Metabase apenas após governança de acesso.

### Critérios de aceite

☐ Cada indicador informa fonte, período e última atualização.

☐ Conta desconectada preserva histórico e mostra interrupção.

☐ Comparações usam a mesma definição e janela temporal.

## 8 15 Usuários equipes e configurações

**Objetivo** Administrar identidade, função, escopo, preferências e organização de forma segura.

**Usuários** Administrador; usuários editam apenas o próprio perfil e preferências permitidas.

### Capacidades

• Convites, ativação, suspensão, remoção e recuperação de acesso.

• Funções como administrador, gestor, social media, designer, financeiro, comercial e colaborador.

• Permissões individuais e atribuição a squads e clientes.

• Perfil com nome, foto, cargo, contato e preferências.

• Configurações da organização, fuso, notificações, templates e políticas.

• Sessões e auditoria de mudanças sensíveis.

### Dados e integrações

• User e OrganizationMember existentes serão auditados.

• Permissões são mantidas no Hub.

• Notificações podem ser entregues internamente e por conectores aprovados.

### Regras

• A função não concede acesso a todos os clientes automaticamente, salvo definição explícita.

• O último administrador não pode remover o próprio acesso sem transferir responsabilidade.

• Mudança de email exige verificação.

• Configuração de assinatura comercial não será tratada como plano SaaS, pois o Hub é interno.

### Checklist de construção

☐ Migrar usuários e organizações existentes.

☐ Criar catálogo de permissões e funções base.

☐ Criar convites e ciclo de conta.

☐ Criar equipes, clientes atribuídos e exceções.

☐ Criar perfil e preferências.

☐ Criar auditoria e tela de sessões.

### Critérios de aceite

☐ Matriz de permissões é confirmada em testes por função.

☐ Suspensão invalida acesso imediatamente.

☐ Alterações sensíveis podem ser rastreadas até o autor.

## 8 16 Central de integrações

**Objetivo** Permitir conectar, monitorar e recuperar serviços externos com clareza operacional.

**Usuários** Administrador e usuários técnicos autorizados.

### Capacidades

• Cards de Asana, Postiz, Twenty, Google Calendar, Google Drive, n8n, Meta, Google Ads, Asaas e futuros conectores.

• Estado, contas vinculadas, escopos, última sincronização, volume, falhas e próxima execução.

• Conectar, reconectar, testar, sincronizar e remover conforme permissão.

• Histórico de sincronizações e erros com orientação de recuperação.

• Mapeamento de contas externas para clientes.

### Dados e integrações

• Tokens são criptografados ou armazenados em serviço seguro fora de respostas e logs.

• IntegrationConnection representa conexão da organização; ClientIntegration representa vínculo por cliente.

• SyncRun, WebhookEvent e IntegrationError fornecem observabilidade.

### Regras

• Remover integração exige explicar impacto e preservar histórico permitido.

• Sincronizar agora respeita limite e não cria execuções concorrentes incompatíveis.

• Escopos insuficientes resultam em aviso específico.

• Credenciais nunca são enviadas ao navegador depois de salvas.

### Checklist de construção

☐ Refatorar providers atuais para contrato comum.

☐ Criar armazenamento seguro de credenciais.

☐ Criar monitor de sincronizações e erros.

☐ Criar mapeamento de contas por cliente.

☐ Criar ações de teste e reconexão.

☐ Criar runbook de cada provedor.

### Critérios de aceite

☐ Administrador identifica em uma tela qual integração falhou e desde quando.

☐ Reconectar não perde vínculos existentes.

☐ Falhas e retentativas podem ser acompanhadas sem acesso ao servidor.

## 8 17 Notificações e solicitações

**Objetivo** Levar cada pendência à pessoa certa e permitir solicitações rastreáveis entre áreas.

**Usuários** Usuários internos e, em fluxos limitados, clientes convidados.

### Capacidades

• Caixa de notificações, lidas, arquivadas e preferências.

• Eventos como atraso, aprovação, comentário, vencimento, falha de integração, risco e menção.

• Solicitações por cliente com tipo, prioridade, responsável, prazo, anexos e vínculo ao Asana.

• Entrega interna primeiro; email e outros canais conforme configuração.

### Dados e integrações

• Notification mantém evento e destinatário.

• Novu pode ser incorporado futuramente como infraestrutura de entrega, não como fonte de verdade.

• n8n pode executar comunicações específicas.

### Regras

• Evento repetido não gera tempestade de notificações.

• Preferência do usuário não desativa alertas obrigatórios de segurança.

• Solicitação convertida em tarefa mantém vínculo entre sistemas.

• Conteúdo sensível não é incluído integralmente em notificações externas.

### Checklist de construção

☐ Definir catálogo e prioridade de eventos.

☐ Criar caixa interna e preferências.

☐ Criar deduplicação e agrupamento.

☐ Criar solicitações e vínculo com Asana.

☐ Planejar canais externos e Novu.

☐ Criar métricas de entrega e leitura.

### Critérios de aceite

☐ Usuário recebe somente eventos do seu escopo.

☐ Notificações repetidas são agrupadas conforme regra.

☐ Solicitação possui responsável e estado rastreável até o encerramento.

## 8 18 Assistente de IA

**Objetivo** Responder e propor ações usando contexto autorizado da Zafira e de cada cliente.

**Usuários** Usuários internos autorizados; experiências externas exigem escopo específico futuro.

### Capacidades

• Perguntas sobre cliente, operação, entregas, contratos, reuniões e desempenho.

• Respostas com fontes internas, data e distinção entre fato e inferência.

• Resumo de cliente, preparação de reunião, riscos e pendências.

• Rascunhos e propostas de ação submetidos à confirmação humana.

• Busca restrita por organização, cliente, função e classificação do conteúdo.

### Dados e integrações

• Conhecimento estruturado, documentos indexados e consultas autorizadas ao banco.

• AIAnswerSource registra quais fontes fundamentaram a resposta.

• AIActionProposal registra intenção antes de qualquer execução.

### Regras

• Nunca misturar contexto entre organizações ou clientes.

• A IA não publica, envia, paga, exclui ou altera permissões sem confirmação e autorização explícitas.

• Dados sem fonte ou desatualizados devem ser identificados.

• Prompts, modelos e política de retenção são versionados.

• Conteúdo financeiro e contratual respeita permissões específicas.

### Checklist de construção

☐ Definir casos de uso iniciais e dados autorizados.

☐ Criar pipeline de indexação e exclusão.

☐ Criar filtros de autorização antes da recuperação.

☐ Criar resposta com fontes e feedback.

☐ Criar proposta de ação com confirmação humana.

☐ Executar testes de vazamento, prompt injection e dados desatualizados.

### Critérios de aceite

☐ Pergunta sobre um cliente nunca retorna dados de outro.

☐ Toda afirmação factual relevante aponta para registro ou documento acessível.

☐ Ações propostas não executam antes da confirmação e da checagem de permissão.

# 9 Métricas e fórmulas

As definições abaixo são o ponto de partida. Cada métrica precisa de definição aprovada, versão, fontes, periodicidade, regra para dados ausentes e testes com exemplos reais.

| **Métrica**        | **Definição inicial**                                                                                       |
|--------------------|-------------------------------------------------------------------------------------------------------------|
| Clientes ativos    | Clientes com status ativo na data de referência                                                             |
| MRR                | Receita recorrente mensal contratada e ativa, ajustada para a competência definida                          |
| Novo MRR           | MRR iniciado por novos clientes no período                                                                  |
| Expansão           | Aumento de MRR de clientes existentes no período                                                            |
| Contração          | Redução de MRR sem perda completa do cliente                                                                |
| Logo churn         | Clientes encerrados dividido pelos clientes ativos no início do período, conforme política aprovada         |
| Revenue churn      | MRR perdido por encerramento ou contração dividido pelo MRR inicial, com expansão separada                  |
| LTV                | Modelo a definir com base em receita, margem e retenção disponíveis; não publicar valor sem método aprovado |
| CAC                | Custos comerciais e de aquisição atribuíveis divididos por novos clientes no período definido               |
| Entrega no prazo   | Itens concluídos até o prazo dividido pelos itens concluídos elegíveis                                      |
| Taxa de retrabalho | Itens reabertos ou versões adicionais classificadas como retrabalho dividido pelos itens entregues          |
| Tempo de aprovação | Tempo entre envio ao cliente e decisão, descontando pausas definidas                                        |

## 9 1 Proposta inicial de Health Score

A primeira fórmula deve ser calibrada com dados reais. O total sugerido é 100 pontos, com cobertura e confiança exibidas separadamente.

| **Componente** | **Peso inicial** | **Exemplos de sinais**                              |
|----------------|------------------|-----------------------------------------------------|
| Entregas       | 25               | Atrasos, cumprimento, retrabalho, itens pendentes   |
| Relacionamento | 20               | Feedback, solicitações críticas, registro do gestor |
| Financeiro     | 20               | Atraso, recorrência, negociação e regularidade      |
| Resultados     | 15               | Metas disponíveis, tendência e percepção acordada   |
| Engajamento    | 10               | Aprovações, respostas, presença e envio de insumos  |
| Contrato       | 10               | Vencimento, redução, pedido de saída e estabilidade |

☐ Aprovar sinais e pesos com exemplos de clientes reais.

☐ Definir como dados ausentes afetam cobertura e nota.

☐ Definir limites de saudável, atenção e risco.

☐ Registrar explicação de cada variação relevante.

☐ Revisar falsos positivos e negativos mensalmente durante calibração.

# 10 Segurança privacidade e conformidade

## 10 1 Controles obrigatórios

☐ Autenticação segura com expiração, renovação controlada e invalidação de sessão.

☐ Hash forte de senha ou provedor de identidade aprovado.

☐ Proteção contra força bruta, enumeração de usuários e abuso de recuperação.

☐ Autorização no backend para toda leitura, alteração, exportação e arquivo.

☐ Criptografia de segredos e tokens em repouso; TLS em trânsito.

☐ CSRF, CORS, headers e cookies configurados para o ambiente real.

☐ Validação de upload por tipo real, tamanho, extensão, conteúdo e política de armazenamento.

☐ URLs de arquivo temporárias e revogáveis.

☐ Auditoria de login, permissões, contratos, financeiro, integrações, exportações e aprovações.

☐ Política de retenção, arquivamento e exclusão compatível com necessidade operacional e LGPD.

☐ Backups criptografados, restauração testada e acesso restrito.

☐ Dependências, imagens e segredos verificados no pipeline.

## 10 2 Classificação de dados

| **Classe**   | **Exemplos**                                    | **Tratamento**                                 |
|--------------|-------------------------------------------------|------------------------------------------------|
| Público      | Conteúdo já publicado                           | Acesso conforme regra do módulo                |
| Interno      | Tarefas, reuniões, notas operacionais           | Somente equipe autorizada                      |
| Confidencial | Contratos, preços, financeiro, tokens           | Permissão específica, auditoria e criptografia |
| Pessoal      | Nome, email, telefone e identidade de aprovador | Finalidade, acesso mínimo e retenção definida  |
| Segredo      | Senhas, chaves, refresh tokens                  | Nunca exibir, registrar ou exportar em claro   |

## 10 3 Threat model mínimo

☐ Tentativa de acessar outro organizationId por URL ou payload.

☐ Troca de clientId para abrir conteúdo, contrato ou arquivo de outro cliente.

☐ Reuso ou adivinhação de link público de aprovação.

☐ Webhook forjado, repetido ou fora da janela permitida.

☐ Upload malicioso, arquivo executável, conteúdo enganoso ou URL externa insegura.

☐ Exportação maior que o escopo visível na tela.

☐ Prompt injection em documento indexado para IA.

☐ Vazamento de token em log, erro, monitoramento ou navegador.

☐ Privilégio mantido após suspensão ou troca de função.

☐ Ação duplicada por clique repetido, retry ou reenvio de webhook.

# 11 Observabilidade e operação

## 11 1 Logs e rastreabilidade

☐ Gerar requestId e correlationId em chamadas, jobs e webhooks.

☐ Registrar organização, módulo e resultado sem conteúdo sensível.

☐ Padronizar níveis de log e códigos de erro.

☐ Registrar duração e contagem de sincronizações.

☐ Separar erro recuperável, falha permanente e ação exigida do usuário.

☐ Manter trilha de auditoria pesquisável por autor, entidade e período.

## 11 2 Alertas operacionais

• Banco indisponível ou conexões saturadas

• Uso elevado de RAM, swap, CPU ou disco

• Fila acumulada ou job sem progresso

• Webhook com falhas consecutivas

• Integração sem sincronizar além do limite

• Aumento de erros 5xx ou latência

• Backup ausente ou restauração de teste vencida

• Expiração de credencial, certificado ou domínio

## 11 3 Runbook mínimo por integração

☐ Como verificar conexão e escopos.

☐ Como repetir sincronização com segurança.

☐ Como identificar limite de API.

☐ Como recuperar webhook perdido.

☐ Como renovar credencial.

☐ Como desligar o conector sem apagar histórico.

☐ Quem é responsável e qual evidência coletar.

# 12 Estratégia de testes

| **Nível**   | **Cobertura esperada**                                                       |
|-------------|------------------------------------------------------------------------------|
| Unitário    | Regras, cálculos, permissões, transições e normalizadores                    |
| Integração  | Banco, migrações, repositórios, filas e adaptadores externos simulados       |
| Contrato    | Payloads de Asana, Postiz, Calendar, n8n, Twenty e futuros provedores        |
| End to end  | Login, cliente, conteúdo, aprovação, agendamento, contrato e fluxos críticos |
| Segurança   | Isolamento, escalada de privilégio, tokens, uploads, links e exportações     |
| Migração    | Conversão de dados 2.0 para 2.1 com reconciliação                            |
| Desempenho  | Listas, dashboards, sincronizações e concorrência esperada                   |
| Recuperação | Backup, restauração, retry, idempotência e rollback                          |
| Aceite      | Cenários reais executados pelo responsável de cada área                      |

## 12 1 Conjunto de dados de homologação

☐ Duas organizações fictícias para testar isolamento.

☐ Clientes ativos, pausados, encerrados e em risco.

☐ Projetos com tarefas atrasadas, sem responsável, concluídas e próximas do prazo.

☐ Entregas completas, parciais, extras, canceladas e reabertas.

☐ Conteúdos feed, reel, story, vídeo e carrossel em todos os estados.

☐ Contratos em rascunho, enviados, expirados, assinados e cancelados.

☐ Recebíveis pagos, pendentes, atrasados e conciliados.

☐ Integrações conectadas, expiradas, limitadas e com falha.

# 13 Migração e convivência

## 13 1 Estratégia

Hub 1.0 e Hub 2.0 permanecem disponíveis durante a construção. O Hub 2.1 inicia em homologação e recebe dados por migrações ensaiadas. A substituição só ocorre após reconciliação, aceite e plano de retorno.

**1.** Congelar o escopo do 2.0 e registrar correções críticas permitidas.

**2.** Inventariar dados e identificar campos sem destino no 2.1.

**3.** Criar scripts idempotentes de migração com relatório de entrada, saída, ignorados e erros.

**4.** Executar migração em cópia da base e reconciliar contagens e amostras.

**5.** Realizar piloto com usuários e clientes selecionados.

**6.** Definir janela de corte, congelamento e sincronização final.

**7.** Fazer backup verificável antes do corte.

**8.** Ativar 2.1 com monitoramento reforçado.

**9.** Manter possibilidade de retorno durante a janela aprovada sem perder novos eventos.

**10.** Aposentar versões anteriores apenas após aceite e retenção dos dados exigidos.

## 13 2 Reconciliação obrigatória

☐ Organizações, usuários, membros e funções.

☐ Clientes, status, responsáveis e integrações.

☐ Contas Postiz e vínculos únicos.

☐ Projetos e vínculos Asana.

☐ Contratos e documentos.

☐ Dados financeiros já existentes.

☐ Arquivos e URLs acessíveis.

☐ Auditoria de registros descartados ou transformados.

# 14 Plano de execução por fases

A ordem prioriza base, dados e operação antes dos dashboards finais e da identidade visual. Algumas atividades de descoberta podem ocorrer em paralelo, mas cada portão mantém dependências explícitas.

| **Fase** | **Nome**                          | **Resultado**                                                  |
|----------|-----------------------------------|----------------------------------------------------------------|
| 0        | Congelamento e inventário         | Baseline segura do 2.0 e decisão de reaproveitamento           |
| 1        | Fundação do 2.1                   | Repositório, ambientes, arquitetura, autenticação e permissões |
| 2        | Plataforma de integrações         | Conectores observáveis, jobs, webhooks e credenciais           |
| 3        | Clientes e conhecimento           | Carteira, Cliente 360, briefing e arquivos                     |
| 4        | Projetos Asana                    | Visão operacional confiável e histórica                        |
| 5        | Entregas                          | Contratado, planejado e realizado                              |
| 6        | Onboarding e agenda               | Entrada padronizada e calendário integrado                     |
| 7        | Conteúdo e aprovação              | Versões, cliente, agendamento e publicação                     |
| 8        | Contratos                         | Ciclo completo dentro do Hub                                   |
| 9        | Saúde e churn                     | Risco explicável e ciclo de vida                               |
| 10       | Comercial e financeiro            | Cockpits conectados aos motores                                |
| 11       | Social Ads e BI                   | Métricas especializadas e análises                             |
| 12       | IA e automações avançadas         | Contexto autorizado e ações assistidas                         |
| 13       | Dashboards finais                 | Visões por função sobre dados estáveis                         |
| 14       | Identidade visual                 | Aplicação do documento visual e refinamento                    |
| 15       | Homologação migração e lançamento | Troca segura e acompanhada                                     |

## 14 1 Fase 0 Congelamento e inventário

☒ Definir versão congelada do Hub 2.0.

☒ Criar inventário de código, banco, APIs, integrações, telas e infraestrutura.

☒ Classificar componentes para manter, adaptar, reescrever ou aposentar.

☒ Registrar problemas conhecidos e fluxos já validados.

☒ Validar backup e restauração.

☒ Criar critérios objetivos para escolher o ponto de origem do Hub 2.1.

☒ Aprovar relatório de auditoria e decisão de branch.

**Portão** Nenhuma reconstrução começa antes de sabermos exatamente o que será reaproveitado e como retornar ao estado anterior.

### Encerramento da Fase 0 em 19 de setembro de 2026

Fase 0 concluída e aprovada pelo responsável do produto. Baseline congelada: branch hub-2.0 no commit 43150df2b218b41575db5b1be5d96ccc8572de32. O GIT_SHA do deploy atual confirma o mesmo commit. Auditoria do código concluída; builds aprovados; 243 testes aprovados. A origem autorizada do Hub 2.1 é a hub-2.0 congelada, com reaproveitamento seletivo.

Portão concluído. API atual identificada pelo digest sha256:72f81d5deb80d65dd6de8bf844d7bc018b9b3bd6bb6fd0f6e98a83b075c2804e; frontend pelo digest sha256:d04e29f652682ed2b9e24d5d8c53bd50ed326478e45cd68710c298f719e02630. O PostgreSQL foi auditado, o backup lógico recebeu checksum SHA-256 e foi restaurado com sucesso em ambiente descartável, com 16 tabelas, 9 migrations concluídas e contagens reconciliadas. A produção permaneceu inalterada durante o ensaio.

Evidência e condições registradas: Relatório de Auditoria da Fase 0 do Zafira Hub 2.1; backup /root/zafira-backups/phase0/zafira_hub_v2_20260919T210342Z.dump com SHA-256 9055e555d14e4ccb2b1342059df101625b8b67e8a7692c8ee9dca4ce80bf55fe. O rollback da baseline usa o commit congelado, artefatos imutáveis/versionados e restauração de banco quando necessária; não depende de tags latest ou do histórico efêmero de containers. Permanecem como condições para homologação/produção do 2.1: monitorar a VPS por sete dias antes de definir a topologia de homologação, definir limites de CPU/RAM e gatilho de upgrade, adicionar healthchecks e rotacionar/endurecer o armazenamento das credenciais antes da substituição da produção.

## 14 2 Fase 1 Fundação do 2 1

☐ Criar branch ou estrutura separada hub-2.1.

☐ Configurar ambientes local, homologação e produção.

☐ Definir módulos, padrões de API e convenções de banco.

☐ Implementar autenticação, sessão e ciclo de usuário.

☐ Implementar RBAC, permissões e escopo por cliente e equipe.

☐ Criar auditoria, feature flags e configuração da organização.

☐ Configurar pipeline de teste, migração e deploy.

☐ Configurar logs, métricas e monitoramento básico.

☐ Executar testes de isolamento entre organizações.

**Portão** Dois usuários de organizações diferentes operam com isolamento comprovado e o deploy de homologação é reproduzível.

## 14 3 Fase 2 Plataforma de integrações

☐ Definir contrato comum de conectores.

☐ Criar armazenamento seguro de credenciais.

☐ Criar fila, workers, retries e idempotência.

☐ Criar SyncRun, WebhookEvent e IntegrationError.

☐ Migrar Postiz e Asana para o contrato comum.

☐ Criar central técnica inicial de integrações.

☐ Criar alertas e runbooks.

**Portão** Postiz e Asana sincronizam em homologação, falham de forma visível e podem ser recuperados com segurança.

## 14 4 Fase 3 Clientes e conhecimento

☐ Migrar e ampliar Client.

☐ Criar contatos, responsáveis, serviços, tags e histórico.

☐ Criar dashboard da carteira com métricas disponíveis.

☐ Criar drawer e Cliente 360.

☐ Criar briefing estruturado, Brand Kit, documentos e links.

☐ Criar importação e deduplicação assistida.

☐ Validar permissões e busca.

**Portão** Cliente piloto possui contexto suficiente para operação e todos os vínculos são encontrados a partir do Cliente 360.

## 14 5 Fase 4 Projetos Asana

☐ Mapear workspace, projetos, campos e clientes.

☐ Implementar sincronização incremental e completa.

☐ Criar snapshots e regras de criticidade.

☐ Criar visão geral, filtros e detalhes.

☐ Criar deep links e estados de frescor.

☐ Reconciliar amostra com o Asana.

**Portão** A visão operacional reproduz os dados do Asana dentro da tolerância definida e mostra qualquer atraso de sincronização.

## 14 6 Fase 5 Entregas

☐ Aprovar taxonomia e critérios de conclusão.

☐ Criar templates e planos.

☐ Vincular Asana, conteúdo e evidências.

☐ Criar histórico, fechamento e reabertura.

☐ Criar relatórios por cliente, serviço e período.

☐ Executar piloto mensal com um cliente.

**Portão** O piloto explica com evidências o contratado, entregue, pendente, atrasado e extra.

## 14 7 Fase 6 Onboarding e agenda

☐ Aprovar template de onboarding da Zafira.

☐ Criar execução, dependências, prazos e responsáveis.

☐ Integrar automações ao n8n.

☐ Conectar Google Calendar.

☐ Criar eventos, recorrência, participantes e conflitos.

☐ Executar onboarding piloto completo.

**Portão** Novo cliente atravessa onboarding e agenda sem controles paralelos indispensáveis.

## 14 8 Fase 7 Conteúdo e aprovação

☐ Criar conteúdo e versões.

☐ Criar revisão interna e comentários.

☐ Criar envio seguro ao cliente.

☐ Criar aprovação, alteração e nova versão.

☐ Integrar versão aprovada ao Postiz.

☐ Sincronizar agendamento, publicação e falhas.

☐ Testar formatos e prevenção de duplicidade.

**Portão** Conteúdo piloto percorre criação, revisão, aprovação, agendamento e publicação com trilha completa.

## 14 9 Fase 8 Contratos

☐ Mapear estados e documentos do fluxo atual.

☐ Criar contrato, versões, partes e eventos.

☐ Integrar n8n e assinatura.

☐ Criar alertas e renovação.

☐ Vincular onboarding, entrega e financeiro.

☐ Testar reenvio, expiração, duplicidade e falha.

**Portão** Contrato piloto é criado, enviado, assinado, arquivado e localizado dentro do Hub.

## 14 10 Fase 9 Saúde e churn

☐ Aprovar taxonomia do ciclo de vida e churn.

☐ Aprovar primeira definição de Health Score.

☐ Criar eventos, snapshots e explicações.

☐ Criar listas de risco e próximas ações.

☐ Criar coortes e reconciliação.

☐ Iniciar período de calibração.

**Portão** Métricas são reproduzíveis e cada score informa fatores, cobertura e versão da fórmula.

## 14 11 Fase 10 Comercial e financeiro

☐ Definir pipeline, campos e integrações do Twenty.

☐ Definir plano financeiro e regras de competência.

☐ Auditar o financeiro existente.

☐ Criar sincronização comercial e snapshots.

☐ Criar recebíveis, despesas e conciliação.

☐ Criar cockpits com permissões específicas.

☐ Planejar Asaas sem bloquear a primeira entrega.

**Portão** Pipeline e financeiro reconciliam com fontes escolhidas e não expõem valores a usuários sem permissão.

## 14 12 Fase 11 Social Ads e BI

☐ Definir métricas orgânicas disponíveis.

☐ Criar snapshots de perfis dos clientes.

☐ Decidir fonte permitida para creators externos.

☐ Desenhar conectores Meta Ads e Google Ads.

☐ Definir armazenamento e atualização dos dados de anúncio.

☐ Conectar Metabase com modelo de acesso seguro.

☐ Criar relatórios operacionais sem duplicar o BI profundo.

**Portão** Indicadores exibem fonte, período e frescor, e o acesso do Metabase respeita a separação de dados.

## 14 13 Fase 12 IA e automações avançadas

☐ Aprovar casos de uso e classes de dados permitidas.

☐ Criar indexação por organização e cliente.

☐ Criar resposta com fontes e feedback.

☐ Criar propostas de ação com confirmação humana.

☐ Testar isolamento, prompt injection e exclusão.

☐ Criar observabilidade de custo, latência e qualidade.

**Portão** Testes demonstram que a IA usa somente contexto autorizado, cita fontes internas e não executa ações sem confirmação.

## 14 14 Fase 13 Dashboards finais

☐ Confirmar catálogo de métricas.

☐ Criar agregações e cache.

☐ Montar dashboards por função.

☐ Criar filtros, drill down e estados de frescor.

☐ Validar números com áreas responsáveis.

☐ Medir desempenho e adoção.

**Portão** Cada indicador possui fórmula, fonte, dono, atualização e caminho até o detalhe que o compõe.

## 14 15 Fase 14 Identidade visual

☐ Ler e aprovar o documento visual oficial da Zafira.

☐ Transformar identidade em tokens de cor, tipografia, espaçamento, raio, sombra e movimento.

☐ Criar biblioteca de componentes e estados.

☐ Aplicar temas claro e escuro quando confirmados.

☐ Revisar acessibilidade, contraste, teclado e responsividade.

☐ Aplicar o visual a todas as telas sem alterar regras validadas.

☐ Realizar comparação visual e revisão de consistência.

**Portão** Todas as telas usam o mesmo sistema visual, preservam acessibilidade e mantêm os fluxos aprovados.

## 14 16 Fase 15 Homologação migração e lançamento

☐ Executar regressão completa.

☐ Executar auditoria de segurança e permissões.

☐ Executar migração ensaiada e reconciliar dados.

☐ Realizar piloto por função e por cliente externo.

☐ Corrigir bloqueadores e aceitar riscos residuais explicitamente.

☐ Aprovar backup, rollback e janela de corte.

☐ Treinar equipe e publicar guias operacionais.

☐ Executar migração final e monitoramento reforçado.

☐ Realizar revisão após 7, 30 e 60 dias.

**Portão** Produção estável, dados reconciliados, responsáveis treinados e retorno disponível dentro da janela aprovada.

# 15 Dependências e sequência crítica

| **Capacidade** | **Depende de**                       | **Bloqueia**                         |
|----------------|--------------------------------------|--------------------------------------|
| Permissões     | Fundação                             | Todos os módulos                     |
| Integrações    | Credenciais e workers                | Asana, Postiz, Calendar, CRM, Ads    |
| Clientes       | Permissões e migração                | Cliente 360, contratos, entregas, IA |
| Projetos       | Integração Asana                     | Entregas, dashboards operacionais    |
| Entregas       | Clientes e projetos                  | Health Score e margem                |
| Conteúdo       | Clientes, arquivos e Postiz          | Aprovação e métricas sociais         |
| Contratos      | Clientes e arquivos                  | Onboarding, financeiro e churn       |
| Health Score   | Histórico confiável                  | Alertas e risco                      |
| Dashboards     | Métricas e dados estáveis            | Visão final por função               |
| IA             | Conhecimento, permissões e auditoria | Assistência contextual segura        |
| Visual final   | Fluxos e componentes estáveis        | Homologação visual                   |

# 16 Backlog posterior ao lançamento

Os itens abaixo permanecem registrados, mas não podem atrasar o primeiro lançamento estável do Hub 2.1 salvo nova decisão formal.

• Aplicativo móvel nativo.

• Chat interno completo ou incorporação de Discord ou Mattermost.

• Videoconferência integrada com Jitsi.

• Portal completo do cliente além de aprovação de conteúdo.

• Creators externos com coleta automatizada ampla.

• Planejamento preditivo de capacidade e churn.

• Automação de cobrança e comunicações avançadas com Asaas.

• Notificações multicanal avançadas com Novu.

• Wiki interna completa com Outline.

• Pesquisa com LimeSurvey.

• Gestão documental ampla com Paperless ngx.

• Armazenamento próprio amplo com MinIO quando capacidade e governança permitirem.

# 17 Riscos e respostas

| **Risco**                        | **Resposta planejada**                                                        |
|----------------------------------|-------------------------------------------------------------------------------|
| Escopo crescer continuamente     | Fases com portões, backlog posterior e mudança formal                         |
| Copiar a referência sem adaptar  | Usar referências para arquitetura funcional e validar com processos da Zafira |
| Reescrever partes estáveis       | Auditoria e testes de caracterização antes de decidir                         |
| Dependência excessiva de APIs    | Snapshots, último estado válido, retries e comunicação de frescor             |
| Dados inconsistentes             | Fonte de verdade, reconciliação, eventos e definições versionadas             |
| Permissões frágeis               | Negação por padrão e testes de isolamento no backend                          |
| Infraestrutura saturada          | Orçamento de recursos, implantação gradual e gatilho de upgrade               |
| Dashboards bonitos e incorretos  | Catálogo de métricas e drill down até registros                               |
| IA vazar contexto                | Filtros antes da recuperação, testes adversariais e fontes registradas        |
| Migração interromper produção    | Convivência, ensaio, backup, reconciliação e rollback                         |
| Aprovação publicar versão errada | Versionamento imutável e vínculo explícito com a publicação                   |
| Automação duplicar ações         | Idempotência, chaves externas e histórico de execução                         |

# 18 Decisões pendentes

Estas escolhas precisam ser resolvidas no momento indicado. Elas não impedem a adoção do mapa, mas não devem ser preenchidas por suposição durante a implementação.

| **Decisão**                         | **Quando resolver**        | **Critério**                                        |
|-------------------------------------|----------------------------|-----------------------------------------------------|
| Commit de origem do 2.1             | Fim da Fase 0              | Menor dívida com maior reaproveitamento seguro      |
| Provedor definitivo de autenticação | Fase 1                     | Segurança, manutenção, custo e integração           |
| Fila PostgreSQL ou Redis            | Fase 1                     | Volume, capacidade da VPS e confiabilidade          |
| Storage principal de arquivos       | Fase 1 ou 3                | Custo, acesso, backup, links e capacidade           |
| Calendar como fonte por tipo        | Fase 6                     | Conflitos e fluxo real da equipe                    |
| Fórmula do Health Score             | Fase 9                     | Dados disponíveis e calibração real                 |
| Definição final de CAC e LTV        | Antes dos dashboards       | Disponibilidade e qualidade financeira              |
| Momento de implantar Twenty         | Fase 10                    | Capacidade de infraestrutura e maturidade comercial |
| Arquitetura de Ads                  | Fase 11                    | APIs, revisão, contas, histórico e volume           |
| Uso de Novu                         | Após notificações internas | Necessidade multicanal e consumo de recursos        |
| Ferramenta de chat                  | Backlog                    | Incorporação, identidade, segurança e experiência   |
| Topologia de produção               | Antes da Fase 15           | Carga medida, disponibilidade e orçamento           |

# 19 Checklist mestre de lançamento

## 19 1 Produto

☐ Fluxos críticos aprovados por administrador, gestor, colaborador, financeiro, comercial e cliente externo.

☐ Nenhuma métrica sem definição e fonte.

☐ Estados vazios, parciais, desatualizados e de erro revisados.

☐ Documentação operacional disponível.

☐ Itens adiados registrados com justificativa.

## 19 2 Dados

☐ Migração ensaiada e reconciliada.

☐ Backups válidos e restauração testada.

☐ Históricos preservados conforme política.

☐ Integrações mostram frescor e falha.

☐ Nenhuma duplicidade crítica em clientes, contas, contratos, tarefas ou publicações.

## 19 3 Segurança

☐ Permissões testadas em matriz positiva e negativa.

☐ Isolamento entre organizações e clientes aprovado.

☐ Segredos removidos do código, logs e navegador.

☐ Links públicos, arquivos, webhooks e uploads testados.

☐ Auditoria e retenção configuradas.

## 19 4 Operação

☐ Monitoramento, alertas e responsáveis definidos.

☐ Runbooks das integrações disponíveis.

☐ Limites de CPU, RAM e disco configurados.

☐ Plano de incidente e comunicação aprovado.

☐ Janela de rollback e critérios de acionamento definidos.

## 19 5 Experiência

☐ Identidade visual aplicada conforme documento oficial.

☐ Contraste, teclado, foco, formulários e mensagens revisados.

☐ Layout responsivo validado nas resoluções suportadas.

☐ Desempenho percebido e carregamento testados.

☐ Treinamento e onboarding dos usuários concluídos.

# 20 Próximo passo autorizado por este mapa

A Fase 0 foi concluída e aprovada em 19 de setembro de 2026. O próximo trabalho autorizado é a Fase 1 — Fundação do 2.1. A nova branch hub-2.1 deve nascer diretamente do commit congelado 43150df2b218b41575db5b1be5d96ccc8572de32, preservando main e hub-2.0. A fundação começa pelos limites de módulo, contratos, autenticação, banco, observabilidade e deploy reproduzível, sem antecipar a identidade visual final.

☒ Encerrar e aprovar formalmente a Fase 0.

☐ Criar a branch hub-2.1 diretamente do commit 43150df2b218b41575db5b1be5d96ccc8572de32.

☐ Configurar ambientes e deploy reproduzível para a nova linha 2.1.

☐ Definir módulos, contratos de API e convenções de banco da fundação.

☐ Implementar a fundação de autenticação, sessão, autorização e isolamento por organização.

◐ Monitorar infraestrutura por sete dias antes de definir a topologia de homologação.

☐ Adicionar healthchecks, observabilidade básica e limites de recursos por serviço.

☐ Versionar builds por Git SHA e preparar rollback imutável para os deploys do 2.1.

# Apêndice A Modelo de especificação de uma funcionalidade

| **Campo**           | **Preenchimento**                           |
|---------------------|---------------------------------------------|
| Identificador       | Módulo e número sequencial                  |
| Problema            | O que hoje impede o usuário                 |
| Resultado           | O que muda de forma observável              |
| Usuários            | Funções e escopos envolvidos                |
| Pré condições       | Dados, permissões e integrações necessárias |
| Fluxo principal     | Passos do caminho esperado                  |
| Exceções            | Falhas, vazios, duplicidades e alternativas |
| Dados               | Campos, fonte, histórico e retenção         |
| Permissões          | Quem lê, cria, altera, aprova e exclui      |
| Eventos             | Webhooks, jobs, notificações e auditoria    |
| Critérios de aceite | Cenários objetivos de aprovação             |
| Métricas            | Uso, qualidade, resultado e saúde técnica   |
| Rollback            | Como interromper ou reverter sem perda      |

# Apêndice B Modelo de revisão de fase

☐ Escopo planejado concluído ou itens removidos por decisão registrada.

☐ Critérios de aceite atendidos.

☐ Testes e evidências anexados.

☐ Riscos residuais aceitos e responsáveis definidos.

☐ Documentação atualizada.

☐ Impacto na infraestrutura medido.

☐ Backups ou rollback preparados quando aplicável.

☐ Próxima fase possui itens prontos para construir.

☐ Responsável pelo produto aprovou o portão.
