import 'dotenv/config';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { createHealthRoutes } from './routes/health.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { clientRoutes } from './modules/clients/clients.routes.js';
import { asanaRoutes } from './modules/integrations/asana/asana.routes.js';
import { postizRoutes } from './modules/integrations/postiz/postiz.routes.js';
import { asaasRoutes } from './modules/integrations/asaas/asaas.routes.js';
import { financialRoutes } from './modules/financial/financial.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { organizationConfigRoutes } from './modules/organization-config/organization-config.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { invitationsRoutes } from './modules/users/invitations.routes.js';
import { teamRoutes } from './modules/teams/team.routes.js';
import { ObservabilityService } from './modules/observability/observability.service.js';
import { createMetricsRoutes } from './modules/observability/metrics.routes.js';
import { getFastifyLoggerConfig } from './modules/observability/logger-config.js';

export interface BuildAppOptions {
  logger?: any;
  observabilityService?: ObservabilityService;
}

const REQUEST_START_TIME = Symbol('requestStartTime');

export function buildApp(options?: BuildAppOptions): FastifyInstance {
  const loggerConfig = options?.logger !== undefined ? options.logger : getFastifyLoggerConfig();

  const app = fastify({
    logger: loggerConfig,
  });

  const observability = options?.observabilityService || new ObservabilityService();
  (app as any).observability = observability;

  // Header x-request-id canônico em todas as respostas HTTP (sucessos e erros)
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Medição monotônica de latência e contagem de requisições HTTP com route templates
  app.addHook('onRequest', async (request) => {
    (request as any)[REQUEST_START_TIME] = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any)[REQUEST_START_TIME];
    if (startTime) {
      const durationNs = process.hrtime.bigint() - startTime;
      const durationSeconds = Number(durationNs) / 1e9;
      const routeTemplate = (request as any).routeOptions?.url || request.routerPath || 'unmatched';
      observability.recordHttpRequest(request.method, routeTemplate, reply.statusCode, durationSeconds);
    }
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

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieSecret = process.env.COOKIE_SECRET;
  const jwtSecret = process.env.JWT_SECRET;

  if (isProduction) {
    if (!cookieSecret) throw new Error('COOKIE_SECRET must be defined in production');
    if (!jwtSecret) throw new Error('JWT_SECRET must be defined in production');
  }

  // 2. Suporte a Cookies HTTP-only
  app.register(cookie, {
    secret: cookieSecret || 'zafira_hub_cookie_secret_dev_32bytes_long',
    hook: 'onRequest',
  });

  // 3. Suporte a JWT com extração opcional de cookie
  app.register(jwt, {
    secret: jwtSecret || 'zafira_hub_jwt_secret_dev_key_32bytes_long',
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
  app.register(createHealthRoutes(observability));

  // 5.1 Rota Protegida de Métricas Prometheus (Machine-Only)
  app.register(createMetricsRoutes(observability));

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

  // 12. Rotas do Módulo de Auditoria Operacional
  app.register(auditRoutes);

  // 13. Rotas de Configuração da Organização e Feature Flags
  app.register(organizationConfigRoutes);

  // 14. Rotas de Gestão Administrativa de Usuários da Organização
  app.register(usersRoutes);

  // 15. Rotas Públicas de Convites e Ativação
  app.register(invitationsRoutes);

  // 16. Rotas de Gestão de Equipes e Squads (Teams)
  app.register(teamRoutes);

  return app;
}

export const app = buildApp();
