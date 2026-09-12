import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Middleware/Hook para proteção temporária de rotas privadas por API Key.
 * Exige o envio do cabeçalho `x-api-key` compatível com a variável `HUB_INTERNAL_API_KEY`.
 */
export async function internalAuthHook(request: FastifyRequest, reply: FastifyReply) {
  const configuredKey = process.env.HUB_INTERNAL_API_KEY;
  const incomingKey = request.headers['x-api-key'];

  // Se a chave não estiver configurada no servidor ou se o header não for idêntico
  if (!configuredKey || typeof incomingKey !== 'string' || incomingKey !== configuredKey) {
    return reply.status(401).send({
      error: 'unauthorized',
    });
  }
}
