export interface ResolveBrightBeanApiUrlOptions {
  required?: boolean;
}

export function isPublicationOrMetricsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.PUBLICATION_DISPATCH_ENABLED === 'true' ||
    env.PUBLICATION_METRICS_ENABLED === 'true'
  );
}

/**
 * Configuração e resolução de ambiente da API BrightBean.
 *
 * REGRAS DE GOVERNANÇA (HM-4a / HM-4b, DEC-HML-007):
 * - Em produção (NODE_ENV === 'production'):
 *   - Se BRIGHTBEAN_API_URL estiver definida e não-vazia: retorna a URL configurada.
 *   - Se BRIGHTBEAN_API_URL estiver ausente/vazia:
 *     - Se publicação ou métricas estiverem ativadas (PUBLICATION_DISPATCH_ENABLED === 'true' || PUBLICATION_METRICS_ENABLED === 'true' || options?.required === true):
 *       Falha fechado lançando erro explícito (sem vazar segredos).
 *     - Se publicação e métricas estiverem desativadas:
 *       Retorna null (modo desconectado seguro). NUNCA utilizar localhost, endpoint sintético ou URL falsa como fallback em produção.
 * - Em ambientes de teste e desenvolvimento:
 *   - Se BRIGHTBEAN_API_URL estiver definida: retorna a URL configurada.
 *   - Se ausente/vazia:
 *     - Se options?.required === true: lança erro fail-closed.
 *     - Caso contrário: http://localhost:8000/api/v1 é permitido como fallback padrão para testes locais.
 * - NENHUM segredo deve ser impresso ou incluído em mensagens de erro.
 */
export function resolveBrightBeanApiUrl(
  env: Record<string, string | undefined> = process.env,
  options?: ResolveBrightBeanApiUrlOptions
): string | null {
  const apiUrl = env.BRIGHTBEAN_API_URL?.trim();
  const isProduction = env.NODE_ENV === 'production';
  const publicationActive = isPublicationOrMetricsEnabled(env);
  const isRequired = options?.required ?? publicationActive;

  if (apiUrl && apiUrl.length > 0) {
    return apiUrl;
  }

  if (isProduction) {
    if (isRequired) {
      throw new Error(
        'Configuração inválida: BRIGHTBEAN_API_URL é obrigatória em ambiente de produção quando o despachante ou métricas de publicação estão habilitados.'
      );
    }
    // Em produção com publicação desligada: modo desconectado seguro (sem fallback para localhost/sintético)
    return null;
  }

  if (options?.required === true) {
    throw new Error(
      'Configuração inválida: BRIGHTBEAN_API_URL é obrigatória quando exigida e não pode ser vazia.'
    );
  }

  return 'http://localhost:8000/api/v1';
}
