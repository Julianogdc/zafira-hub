import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../clients/clients.service.js';
import { AuthService } from './auth.service.js';
import { LoginRequestSchema, SessionResponse } from '@zafira/contracts';

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService();

  function handleError(error: unknown, reply: FastifyReply) {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        status: 'error',
        message: 'Dados inválidos na requisição',
        errors: error.flatten().fieldErrors,
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        status: 'error',
        message: error.message,
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      status: 'error',
      message: 'Ocorreu um erro interno no servidor',
    });
  }

  // POST /api/v1/auth/login
  // CLASSE: PUBLIC_INTENTIONAL
  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = LoginRequestSchema.parse(request.body);
        const { user, activeOrganizationId, sessionData } = await authService.login(body);

        const token = await reply.jwtSign(
          {
            sub: user.id,
            email: user.email,
            activeOrganizationId,
          },
          {
            expiresIn: '7d',
          }
        );

        const isProduction = process.env.NODE_ENV === 'production';
        const sameSiteConfig = (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') || 'lax';

        reply.setCookie('token', token, {
          path: '/',
          httpOnly: true,
          secure: isProduction,
          sameSite: sameSiteConfig,
          maxAge: 7 * 24 * 60 * 60, // 7 dias em segundos
        });

        return reply.status(200).send(sessionData);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // GET /api/v1/auth/session
  // CLASSE: HUMAN_AUTHENTICATED
  app.get(
    '/api/v1/auth/session',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = request.authContext;

        if (!auth) {
          const unauth: SessionResponse = { authenticated: false };
          return reply.status(401).send(unauth);
        }

        if (auth.type === 'api_key') {
          return reply.status(403).send({
            status: 'error',
            error: 'forbidden',
            code: 'MACHINE_CREDENTIAL_NOT_ALLOWED',
            message: 'Credencial de máquina não pode acessar sessão de usuário humano',
          });
        }

        const profile = await authService.resolveSession(auth.userId, (auth as any).activeOrganizationId);
        return reply.status(200).send(profile);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // POST /api/v1/auth/logout
  // CLASSE: PUBLIC_INTENTIONAL
  app.post('/api/v1/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const sameSiteConfig = (process.env.COOKIE_SAMESITE as 'lax' | 'strict' | 'none') || 'lax';

    reply.clearCookie('token', {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: sameSiteConfig,
    });

    return reply.status(200).send({
      status: 'ok',
      message: 'Sessão encerrada com sucesso',
    });
  });
}
