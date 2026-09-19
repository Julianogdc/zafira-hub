import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { AppError } from '../clients/clients.service.js';
import { loginSchema } from './auth.schemas.js';
import { AuthService } from './auth.service.js';

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

  // POST /auth/login (com rate-limit mais estrito: máx 10 tentativas por minuto)
  app.post(
    '/auth/login',
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
        const body = loginSchema.parse(request.body);
        const user = await authService.validateUser(body);

        const token = await reply.jwtSign(
          {
            sub: user.id,
            email: user.email,
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

        return reply.status(200).send({
          status: 'ok',
          user,
        });
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // GET /auth/me
  app.get(
    '/auth/me',
    {
      preHandler: [authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const auth = request.authContext;

        if (!auth) {
          return reply.status(401).send({ error: 'unauthorized' });
        }

        if (auth.type === 'api_key') {
          return reply.status(200).send({
            type: 'api_key',
            service: 'zafira-hub-internal',
            role: 'ADMIN',
          });
        }

        const profile = await authService.getUserProfile(auth.userId);
        return reply.status(200).send(profile);
      } catch (error) {
        return handleError(error, reply);
      }
    }
  );

  // POST /auth/logout
  app.post('/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
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
