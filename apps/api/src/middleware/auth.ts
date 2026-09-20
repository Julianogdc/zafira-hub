import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { PermissionCode } from '@zafira/domain';
import { resolveAuthorizationContext } from '../modules/authorization/resolver.js';


export interface AuthUserContext {
  type: 'user';
  userId: string;
  email: string;
  activeOrganizationId: string | null;
  memberships: {
    organizationId: string;
    organizationSlug: string;
    role: 'ADMIN' | 'MANAGER' | 'MEMBER';
  }[];
}

export interface AuthApiKeyContext {
  type: 'api_key';
  role: 'ADMIN';
  allowedOrganizationIds?: string[];
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
    const allowedOrgs = process.env.HUB_INTERNAL_API_KEY_ORGS
      ? process.env.HUB_INTERNAL_API_KEY_ORGS.split(',').map((id) => id.trim()).filter(Boolean)
      : (process.env.HUB_INTERNAL_API_KEY_ORGANIZATION_ID ? [process.env.HUB_INTERNAL_API_KEY_ORGANIZATION_ID.trim()] : undefined);

    request.authContext = {
      type: 'api_key',
      role: 'ADMIN',
      allowedOrganizationIds: allowedOrgs,
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
      const decoded = await request.server.jwt.verify<{ sub: string; email: string; activeOrganizationId?: string | null }>(token);

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
          activeOrganizationId: decoded.activeOrganizationId || null,
          memberships: user.memberships.map((m) => ({
            organizationId: m.organization.id,
            organizationSlug: m.organization.slug,
            role: m.role as any,
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

    // Integração via API Key possui privilégios para organizações que estejam no seu escopo
    if (auth.type === 'api_key') {
      const headerOrg = request.headers['x-organization-id'] as string | undefined;
      if (headerOrg && auth.allowedOrganizationIds && !auth.allowedOrganizationIds.includes(headerOrg)) {
        return reply.status(403).send({
          status: 'error',
          error: 'forbidden',
          message: 'Chave de integração não autorizada para a organização informada',
        });
      }
      return;
    }

    // Determina a organização do contexto (ativa, cabeçalho ou única membership)
    const headerOrg = request.headers['x-organization-id'] as string | undefined;
    const explicitOrgId = auth.activeOrganizationId || headerOrg;

    let targetMembership = explicitOrgId
      ? auth.memberships.find((m) => m.organizationId === explicitOrgId || m.organizationSlug === explicitOrgId)
      : undefined;

    // Se o usuário especificou organização que não pertence a ele: 403 Forbidden
    if (explicitOrgId && !targetMembership) {
      return reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        message: 'Usuário não possui acesso à organização informada',
      });
    }

    // Se não especificou:
    if (!targetMembership) {
      if (auth.memberships.length === 1) {
        targetMembership = auth.memberships[0];
      } else {
        // Múltiplas memberships sem contexto explícito: NUNCA escolher a primeira nem nenhuma fixa!
        return reply.status(400).send({
          status: 'error',
          error: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Múltiplas organizações disponíveis. Contexto de organização ativo é obrigatório.',
        });
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

export function requirePermission(permissionCode: PermissionCode) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.authContext;

    if (!auth) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    if (auth.type === 'api_key') {
      const headerOrg = request.headers['x-organization-id'] as string | undefined;
      if (headerOrg && auth.allowedOrganizationIds && !auth.allowedOrganizationIds.includes(headerOrg)) {
        return reply.status(403).send({
          status: 'error',
          error: 'forbidden',
          message: 'Chave de integra��o n�o autorizada para a organiza��o informada',
        });
      }
      // API Key with no restriction has full privileges
      return;
    }

    const headerOrg = request.headers['x-organization-id'] as string | undefined;
    const explicitOrgId = auth.activeOrganizationId || headerOrg;

    if (!explicitOrgId) {
      return reply.status(400).send({
        status: 'error',
        error: 'ORGANIZATION_CONTEXT_REQUIRED',
        message: 'Contexto de organiza��o ativo � obrigat�rio.',
      });
    }

    const authResult = await resolveAuthorizationContext({
      userId: auth.userId,
      activeOrganizationId: explicitOrgId,
      permissionCode,
    });

    if (!authResult.allowed) {
      return reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        message: 'Permiss�o insuficiente para executar esta a��o',
      });
    }

    // Attach resolved authorization info to request context so endpoints can use it
    (request as any).authorizationResult = authResult;
  };
}
