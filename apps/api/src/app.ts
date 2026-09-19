import 'dotenv/config';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { clientRoutes } from './modules/clients/clients.routes.js';
import { asanaRoutes } from './modules/integrations/asana/asana.routes.js';
import { postizRoutes } from './modules/integrations/postiz/postiz.routes.js';
import { asaasRoutes } from './modules/integrations/asaas/asaas.routes.js';
import { financialRoutes } from './modules/financial/financial.routes.js';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
  });

  // 1. Configuração de CORS com origens explícitas e credenciais (sem wildcard)
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  });

  // Preserva o payload bruto (rawBody) para validação de assinaturas HMAC em Webhooks (ex: Asana)
  app.addContentTypeParser(['application/json', /^application\/json/], { parseAs: 'buffer' }, (req, body, done) => {
    try {
      const buffer = body as Buffer;
      const rawString = buffer.length ? buffer.toString('utf-8') : '';
      (req as any).rawBody = rawString;
      if (!rawString || rawString.trim().length === 0) {
        return done(null, {});
      }
      const json = JSON.parse(rawString);
      return done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      return done(err, undefined);
    }
  });

  // Permite requisições comuns sem body ou com Content-Type vazio/urlencoded (como logout)
  app.addContentTypeParser(['application/x-www-form-urlencoded', 'text/plain'], (req, _payload, done) => {
    (req as any).rawBody = '';
    done(null, null);
  });

  // 2. Suporte a Cookies HTTP-only
  app.register(cookie, {
    secret: process.env.COOKIE_SECRET || 'zafira_hub_cookie_secret_dev_32bytes_long',
    hook: 'onRequest',
  });

  // 3. Suporte a JWT com extração opcional de cookie
  app.register(jwt, {
    secret: process.env.JWT_SECRET || 'zafira_hub_jwt_secret_dev_key_32bytes_long',
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });

  // 4. Rate Limiting para mitigação de ataques de força bruta
  app.register(rateLimit, {
    global: false, // aplicado especificamente em rotas sensíveis como /auth/login
  });

  // 4.1 Suporte a Uploads Multipart sem retenção na VPS (encaminhado ao Asana e Postiz)
  app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB (suporta vídeos de Reels e Stories para o Postiz)
      files: 1,
    },
  });

  // 5. Rotas Públicas de diagnóstico e infraestrutura
  app.register(healthRoutes);

  // 6. Rotas de Autenticação (/auth/login, /auth/me, /auth/logout)
  app.register(authRoutes);

  // 7. Rotas de Clientes (protegidas por sessão ou HUB_INTERNAL_API_KEY)
  app.register(clientRoutes);

  // 8. Rotas de Integração Asana
  app.register(asanaRoutes);

  // 9. Rotas de Integração Postiz
  app.register(postizRoutes);

  // 10. Rotas de Integração Asaas
  app.register(asaasRoutes);

  // 11. Rotas do Módulo Financeiro Unificado (Asaas + Inter PJ + Extrato Unificado)
  app.register(financialRoutes);

  return app;
}

export const app = buildApp();
