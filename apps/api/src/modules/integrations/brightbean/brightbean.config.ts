/**
 * Configuração e resolução de ambiente da API BrightBean.
 *
 * REGRA DE GOVERNANÇA:
 * - Em produção (NODE_ENV === 'production'): BRIGHTBEAN_API_URL é obrigatória e deve falhar fechado se ausente/vazia.
 * - Em ambientes de teste e desenvolvimento: http://localhost:8000/api/v1 é permitido como fallback padrão.
 * - NENHUM segredo deve ser impresso ou incluído em mensagens de erro.
 */
export function resolveBrightBeanApiUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const apiUrl = env.BRIGHTBEAN_API_URL?.trim();
  const isProduction = env.NODE_ENV === 'production';

  if (apiUrl && apiUrl.length > 0) {
    return apiUrl;
  }

  if (isProduction) {
    throw new Error(
      'Configuração inválida: BRIGHTBEAN_API_URL é obrigatória em ambiente de produção e não pode ser vazia.'
    );
  }

  return 'http://localhost:8000/api/v1';
}
