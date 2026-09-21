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
  // Sem role: 'ADMIN' — credencial de maquina nao representa um administrador humano
  allowedOrganizationIds?: string[];
}

export type AuthContext = AuthUserContext | AuthApiKeyContext;

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

/**
 * Middleware de autenticacao: aceita sessao de usuario (Cookie ou Bearer JWT)
 * OU chave de integracao de servidor (x-api-key).
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const configuredApiKey = process.env.HUB_INTERNAL_API_KEY;
  const incomingApiKey = request.headers['x-api-key'];

  // 1. Verificacao de API Key interna (Server-to-server)
  if (configuredApiKey && typeof incomingApiKey === 'string' && incomingApiKey === configuredApiKey) {
    const allowedOrgs = process.env.HUB_INTERNAL_API_KEY_ORGS
      ? process.env.HUB_INTERNAL_API_KEY_ORGS.split(',').map((id) => id.trim()).filter(Boolean)
      : (process.env.HUB_INTERNAL_API_KEY_ORGANIZATION_ID ? [process.env.HUB_INTERNAL_API_KEY_ORGANIZATION_ID.trim()] : undefined);

    // API key autentica como MACHINE — sem role humano
    request.authContext = {
      type: 'api_key',
      allowedOrganizationIds: allowedOrgs,
    };
    return;
  }

  // 2. Verificacao de Sessao do Usuario (Cookie 'token' ou Header 'Authorization: Bearer ...')
  let token: string | undefined = (request as any).cookies?.token;

  if (!token && request.headers.authorization) {
    const parts = request.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (token) {
    try {
      const decoded = await (request.server as any).jwt.verify<{ sub: string; email: string; activeOrganizationId?: string | null }>(token);

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
        const activeMemberships = user.memberships.filter((m) => !m.status || m.status === 'ACTIVE');
        request.authContext = {
          type: 'user',
          userId: user.id,
          email: user.email,
          activeOrganizationId: decoded.activeOrganizationId || null,
          memberships: activeMemberships.map((m) => ({
            organizationId: m.organization.id,
            organizationSlug: m.organization.slug,
            role: m.role as any,
          })),
        };
        return;
      }
    } catch {
      // Token invalido ou expirado, falha para 401 abaixo
    }
  }

  // 3. Nao autenticado por nenhum metodo valido
  return reply.status(401).send({
    error: 'unauthorized',
  });
}

/**
 * Middleware para exigir papeis especificos para acoes de modificacao (ex: ADMIN e MANAGER).
 * NOTA: Credenciais de maquina (api_key) sao negadas aqui — nao representam role humano.
 */
export function requireRole(allowedRoles: ('ADMIN' | 'MANAGER' | 'MEMBER')[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.authContext;

    if (!auth) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    // Credencial de maquina (API key) nao pode assumir role humano
    if (auth.type === 'api_key') {
      return reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        code: 'MACHINE_CREDENTIAL_NOT_ALLOWED',
        message: 'Credencial de maquina nao e autorizada para rotas com controle de role humano',
      });
    }

    // Determina a organizacao do contexto (ativa, cabecalho ou unica membership)
    const headerOrg = request.headers['x-organization-id'] as string | undefined;
    const explicitOrgId = auth.activeOrganizationId || headerOrg;

    let targetMembership = explicitOrgId
      ? auth.memberships.find((m) => m.organizationId === explicitOrgId || m.organizationSlug === explicitOrgId)
      : undefined;

    // Se o usuario especificou organizacao que nao pertence a ele: 403 Forbidden
    if (explicitOrgId && !targetMembership) {
      return reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        message: 'Usuario nao possui acesso a organizacao informada',
      });
    }

    // Se nao especificou:
    if (!targetMembership) {
      if (auth.memberships.length === 1) {
        targetMembership = auth.memberships[0];
      } else {
        // Multiplas memberships sem contexto explicito: NUNCA escolher a primeira nem nenhuma fixa!
        return reply.status(400).send({
          status: 'error',
          error: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Multiplas organizacoes disponiveis. Contexto de organizacao ativo e obrigatorio.',
        });
      }
    }

    if (!targetMembership || !allowedRoles.includes(targetMembership.role)) {
      return reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        message: 'Permissao insuficiente para executar esta acao',
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

    // Credencial de maquina (API key) e MACHINE auth — nao satisfaz requirePermission humana
    // API key sem allowlist ou com allowlist NAO obtém full access via requirePermission
    if (auth.type === 'api_key') {
      return reply.status(403).send({
        status: 'error',
        error: 'forbidden',
        code: 'MACHINE_CREDENTIAL_NOT_ALLOWED',
        message: 'Credencial de maquina nao e autorizada para rotas com controle de permissao humana',
      });
    }

    const headerOrg = request.headers['x-organization-id'] as string | undefined;
    const explicitOrgId = auth.activeOrganizationId || headerOrg;

    if (!explicitOrgId) {
      return reply.status(400).send({
        status: 'error',
        error: 'ORGANIZATION_CONTEXT_REQUIRED',
        message: 'Contexto de organizacao ativo e obrigatorio.',
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
        message: 'Permissao insuficiente para executar esta acao',
      });
    }

    // Attach resolved authorization info to request context so endpoints can use it
    (request as any).authorizationResult = authResult;
  };
}
