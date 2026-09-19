import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'zafira-hub-api',
    };
  });

  app.get('/health/database', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.status(200).send({
        status: 'ok',
        database: 'connected',
      });
    } catch (error) {
      app.log.error(error);
      return reply.status(503).send({
        status: 'error',
        database: 'disconnected',
      });
    }
  });
}

