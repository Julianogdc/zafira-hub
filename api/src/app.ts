import 'dotenv/config';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { clientRoutes } from './modules/clients/clients.routes.js';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
  });

  app.register(cors, {
    origin: true,
  });

  app.register(healthRoutes);
  app.register(clientRoutes);

  return app;
}

export const app = buildApp();
