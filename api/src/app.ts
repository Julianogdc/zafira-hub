import 'dotenv/config';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { clientRoutes } from './modules/clients/clients.routes.js';
import { internalAuthHook } from './middleware/internalAuth.js';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
  });

  app.register(cors, {
    origin: true,
  });

  // Rotas públicas de diagnóstico e infraestrutura
  app.register(healthRoutes);

  // Rotas privadas protegidas por x-api-key (HUB_INTERNAL_API_KEY)
  app.register(async (privateApp) => {
    privateApp.addHook('preHandler', internalAuthHook);
    privateApp.register(clientRoutes);
  });

  return app;
}

export const app = buildApp();
