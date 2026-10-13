import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { ObservabilityService } from '../modules/observability/observability.service.js';

export function createHealthRoutes(observabilityService?: ObservabilityService) {
  return async function healthRoutes(app: FastifyInstance) {
    // CLASSE: PUBLIC_INTENTIONAL
    app.get('/health', async () => {
      return {
        status: 'ok',
        service: 'zafira-hub-api',
      };
    });

    // CLASSE: PUBLIC_INTENTIONAL
    app.get('/health/database', async (request, reply) => {
      const startTime = process.hrtime.bigint();
      try {
        await prisma.$queryRaw`SELECT 1`;
        const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
        observabilityService?.recordDatabaseHealth(true, durationSeconds);
        return reply.status(200).send({
          status: 'ok',
          database: 'connected',
        });
      } catch (error) {
        const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
        observabilityService?.recordDatabaseHealth(false, durationSeconds);
        request.log.error({ err: error }, 'Falha na verificacao de saude do banco de dados');
        return reply.status(503).send({
          status: 'error',
          database: 'disconnected',
        });
      }
    });
  };
}

export async function healthRoutes(app: FastifyInstance) {
  return createHealthRoutes()(app);
}
