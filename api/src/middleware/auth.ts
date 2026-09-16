import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';

export interface AuthUserContext {
  type: 'user';
  userId: string;
  email: string;
  memberships: {
    organizationId: string;
    organizationSlug: string;
    role: 'ADMIN' | 'MANAGER' | 'MEMBER';
  }[];
}

export interface AuthApiKeyContext {
  type: 'api_key';
  role: 'ADMIN';
}

export type AuthContext = AuthUserContext | AuthApiKeyContext;

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

/**
 * Middleware de autenticação: aceita sessão de usuário (Cookie ou Bearer JWT)
 * OU chave de integração de servidor (x-api-key).
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const configuredApiKey = process.env.HUB_INTERNAL_API_KEY;
  const incomingApiKey = request.headers['x-api-key'];

  // 1. Verificação de API Key interna (Server-to-server)
  if (configuredApiKey && typeof incomingApiKey === 'string' && incomingApiKey === configuredApiKey) {
    request.authContext = {
      type: 'api_key',
      role: 'ADMIN',
    };
    return;
  }

  // 2. Verificação de Sessão do Usuário (Cookie 'token' ou Header 'Authorization: Bearer ...')
  let token: string | undefined = request.cookies?.token;

  if (!token && request.headers.authorization) {
    const parts = request.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (token) {
    try {
      const decoded = await request.server.jwt.verify<{ sub: string; email: string }>(token);

      const user = await prisma.user.findUnique({
        where: { id: decoded.sub },
        include: {
          memberships: {
            include: {
              organization: true,
            },
          },
        },
      });

      if (user && user.status === 'ACTIVE') {
        request.authContext = {
          type: 'user',
          userId: user.id,
          email: user.email,
          memberships: user.memberships.map((m) => ({
            organizationId: m.organization.id,
            organizationSlug: m.organization.slug,
            role: m.role,
          })),
        };
        return;
      }
    } catch {
      // Token inválido ou expirado, falha para 401 abaixo
    }
  }

  // 3. Não autenticado por nenhum método válido
  return reply.status(401).send({
    error: 'unauthorized',
  });
}

/**
 * Middleware para exigir papéis específicos para ações de modificação (ex: ADMIN e MANAGER).
 */
export function requireRole(allowedRoles: ('ADMIN' | 'MANAGER' | 'MEMBER')[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.authContext;

    if (!auth) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    // Integração via API Key possui privilégios de sistema
    if (auth.type === 'api_key') {
      return;
    }

    // Determina a organização do contexto (ativa, cabeçalho ou única membership)
    const headerOrg = request.headers['x-organization-id'] as string | undefined;
    const explicitOrgId = (auth as any).activeOrganizationId || headerOrg;

    let targetMembership = explicitOrgId
      ? auth.memberships.find((m) => m.organizationId === explicitOrgId || m.organizationSlug === explicitOrgId)
      : undefined;

    if (!targetMembership) {
      if (auth.memberships.length === 1) {
        targetMembership = auth.memberships[0];
      } else {
        targetMembership = auth.memberships.find((m) => m.organizationSlug === 'zafira') || auth.memberships[0];
      }
    }

    if (!targetMembership || !allowedRoles.includes(targetMembership.role)) {
      return reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        message: 'Permissão insuficiente para executar esta ação',
      });
    }
  };
}
