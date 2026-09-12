import 'dotenv/config';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
  });

  app.register(cors, {
    origin: true,
  });

  app.register(healthRoutes);

  return app;
}

export const app = buildApp();
