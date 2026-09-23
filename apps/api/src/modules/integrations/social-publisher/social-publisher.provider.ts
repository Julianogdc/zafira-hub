import {
  CreateSocialPostInput,
  ScheduleSocialPostInput,
  SocialAccount,
  SocialAccountAnalytics,
  SocialMediaUploadResult,
  SocialPost,
  SocialPostAnalytics,
  SocialPublisherStatus,
} from '@zafira/contracts';

/**
  Contexto operacional interno da API para comunicação com o provider externo.
  Contém as informações de autorização/escopo já resolvidas pelo Hub.
 */
export interface SocialPublisherContext {
  organizationId: string;
  connectionId?: string;
  workspaceId?: string;
}

/**
  Payload de upload de mídia contendo o buffer binário (exclusivo da camada de servidor API).
 */
export interface SocialMediaUploadInput {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  idempotencyKey?: string;
}

/**
  Interface canônica do provedor de Social Publishing (operações estritamente externas).
 
  NOTA DE ARQUITETURA E SEPARAÇÃO DE RESPONSABILIDADES:
  As seguintes operações PERTENCEM AO HUB e NÃO fazem parte desta interface:
  - getAvailableAccounts(): cruza dados do provider + ClientIntegration + regras Zafira
  - getAggregatedContent(): agregação multi-cliente + permissões + filtros Zafira Hub
  - linkAccountToClient() / unlinkAccountFromClient(): persistência do domínio Zafira Hub
 */
export interface SocialPublisherProvider {
  /**
    Verifica conectividade e status com o serviço/API remota do provider.
   */
  getStatus(ctx: SocialPublisherContext): Promise<SocialPublisherStatus>;

  /**
    Lista as contas sociais conectadas no workspace/instância do provider externo.
   */
  listAccounts(ctx: SocialPublisherContext): Promise<SocialAccount[]>;

  /**
    Envia mídia binária para o storage/serviço do provider externo.
   */
  uploadMedia(
    ctx: SocialPublisherContext,
    input: SocialMediaUploadInput
  ): Promise<SocialMediaUploadResult>;

  /**
    Cria ou agenda uma nova publicação no provider externo.
   */
  createPost(
    ctx: SocialPublisherContext,
    input: CreateSocialPostInput
  ): Promise<SocialPost>;

  /**
    Obtém detalhes e status de uma publicação específica no provider externo.
   */
  getPost(
    ctx: SocialPublisherContext,
    postId: string
  ): Promise<SocialPost | null>;

  /**
    Reagenda uma publicação existente no agendador técnico do provider externo.
   */
  schedulePost(
    ctx: SocialPublisherContext,
    input: ScheduleSocialPostInput
  ): Promise<SocialPost>;

  /**
    Cancela ou exclui uma agendamento pendente no provider externo.
   */
  cancelPost(
    ctx: SocialPublisherContext,
    postId: string
  ): Promise<{ success: boolean }>;

  /**
    Obtém métricas analíticas de uma publicação específica no provider externo.
   */
  getPostAnalytics?(
    ctx: SocialPublisherContext,
    postId: string
  ): Promise<SocialPostAnalytics | null>;

  /**
    Obtém métricas analíticas consolidadas de uma conta social no provider externo.
   */
  getAccountAnalytics?(
    ctx: SocialPublisherContext,
    accountId: string,
    period?: { startDate?: string; endDate?: string }
  ): Promise<SocialAccountAnalytics | null>;
}
