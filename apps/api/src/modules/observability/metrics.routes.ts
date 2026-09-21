import { FastifyInstance } from 'fastify';
import { authenticate, requireMachineCredential } from '../../middleware/auth.js';
import { ObservabilityService } from './observability.service.js';

export function createMetricsRoutes(observabilityService: ObservabilityService) {
  return async function metricsRoutes(app: FastifyInstance) {
    app.get(
      '/metrics',
      {
        preHandler: [authenticate, requireMachineCredential()],
      },
      async (_request, reply) => {
        const metrics = await observabilityService.getMetrics();
        return reply
          .header('Content-Type', observabilityService.getContentType())
          .send(metrics);
      }
    );
  };
}
