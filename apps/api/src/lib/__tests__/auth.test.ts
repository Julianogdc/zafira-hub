import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { authRoutes } from '../../modules/auth/auth.routes.js';
import * as authServiceModule from '../../modules/auth/auth.service.js';
import { AppError } from '../../modules/clients/clients.service.js';

// The authenticate middleware is imported and used in auth.routes.ts
// We mock prisma.user.findUnique for the middleware
import { prisma } from '../prisma.js';

test('--- Canonical Auth Suite ---', async (t) => {
  let mockUser: any = null;
  let mockMemberships: any[] = [];
  let mockLoginThrows: any = null;
  let mockResolveSessionThrows: any = null;

  class FakeAuthService {
    async login(input: any) {
      if (mockLoginThrows) throw mockLoginThrows;
      
      let activeOrganizationId = null;
      if (mockMemberships.length === 1) {
        activeOrganizationId = mockMemberships[0].organizationId;
      } else if (input.organizationId) {
        const hasOrg = mockMemberships.find(m => m.organizationId === input.organizationId);
        if (hasOrg) activeOrganizationId = input.organizationId;
      }

      return {
        user: mockUser,
        activeOrganizationId,
        sessionData: {
          authenticated: true,
          user: { id: mockUser.id, email: mockUser.email, name: mockUser.name, status: mockUser.status },
          organizations: mockMemberships.map(m => ({
            id: m.organization.id,
            name: m.organization.name,
            slug: m.organization.slug,
            role: m.role,
          })),
          activeOrganizationId
        }
      };
    }

    async resolveSession(userId: string, activeOrgId?: string | null) {
      if (mockResolveSessionThrows) throw mockResolveSessionThrows;
      
      let finalActive = null;
      if (mockMemberships.length === 1) {
        finalActive = mockMemberships[0].organizationId;
      } else if (activeOrgId) {
        const hasOrg = mockMemberships.find(m => m.organizationId === activeOrgId);
        if (hasOrg) finalActive = activeOrgId;
      }

      return {
        authenticated: true,
        user: { id: mockUser.id, email: mockUser.email, name: mockUser.name, status: mockUser.status },
        organizations: mockMemberships.map(m => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
        })),
        activeOrganizationId: finalActive
      };
    }
  }

  // Override AuthService inside authRoutes
  const OriginalLogin = authServiceModule.AuthService.prototype.login;
  const OriginalResolve = authServiceModule.AuthService.prototype.resolveSession;
  
  authServiceModule.AuthService.prototype.login = new FakeAuthService().login as any;
  authServiceModule.AuthService.prototype.resolveSession = new FakeAuthService().resolveSession as any;

  // Mock Prisma for the authenticate middleware
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async ({ where }: any) => {
    if (mockUser && where.id === mockUser.id) {
      return { ...mockUser, memberships: mockMemberships };
    }
    return null;
  };

  t.after(() => {
    authServiceModule.AuthService.prototype.login = OriginalLogin;
    authServiceModule.AuthService.prototype.resolveSession = OriginalResolve;
    prisma.user.findUnique = originalFindUnique;
  });

  const app = fastify();
  await app.register(cookie, { secret: 'test_cookie_secret_32bytes_long' });
  await app.register(jwt, { secret: 'test_jwt_secret_32bytes_long', cookie: { cookieName: 'token', signed: false } });
  
  // Dummy authenticate middleware is already imported in authRoutes from '../../middleware/auth.js'
  // But wait, the authenticate middleware needs to be attached to the request or preHandler.
  // Actually, auth.routes.ts directly imports it. So registering authRoutes will use it.
  await app.register(authRoutes);
  await app.ready();

  t.afterEach(() => {
    mockUser = null;
    mockMemberships = [];
    mockLoginThrows = null;
    mockResolveSessionThrows = null;
  });

  await t.test('1. login válido, uma membership resolve organização', async () => {
    mockUser = { id: 'usr-1', email: 'test@zafira.com.br', name: 'Test', status: 'ACTIVE' };
    mockMemberships = [{ organizationId: 'org-1', organization: { id: 'org-1', name: 'Org 1', slug: 'org-1' }, role: 'ADMIN', status: 'ACTIVE' }];

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'test@zafira.com.br', password: 'ValidPassword123!' }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.activeOrganizationId, 'org-1');
    assert.equal(body.user.email, 'test@zafira.com.br');
    
    // Cookie is set
    const cookies = response.cookies;
    assert.ok(cookies.some(c => c.name === 'token' && c.httpOnly === true));
  });

  await t.test('2. senha inválida', async () => {
    mockLoginThrows = new AppError(401, 'Credenciais inválidas');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'test@zafira.com.br', password: 'Wrong' }
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test('3. usuário inexistente sem enumeração', async () => {
    mockLoginThrows = new AppError(401, 'Credenciais inválidas');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'notfound@zafira.com.br', password: 'pwd' }
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test('4. usuário não ativo rejeitado', async () => {
    mockLoginThrows = new AppError(401, 'Credenciais inválidas');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'suspended@zafira.com.br', password: 'pwd' }
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test('5. zero memberships rejeitado', async () => {
    mockLoginThrows = new AppError(403, 'Usuário não possui organizações associadas.');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'noorg@zafira.com.br', password: 'pwd' }
    });
    assert.equal(response.statusCode, 403);
  });

  await t.test('6. múltiplas memberships não escolhem primeira silenciosamente', async () => {
    mockUser = { id: 'usr-mult', email: 'mult@zafira.com.br', name: 'Mult', status: 'ACTIVE' };
    mockMemberships = [
      { organizationId: 'org-A', organization: { id: 'org-A', name: 'Org A', slug: 'org-a' }, role: 'ADMIN', status: 'ACTIVE' },
      { organizationId: 'org-B', organization: { id: 'org-B', name: 'Org B', slug: 'org-b' }, role: 'MEMBER', status: 'ACTIVE' }
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'mult@zafira.com.br', password: 'pwd' }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.activeOrganizationId, null);
  });

  await t.test('7. organizationId válido aceito para membership correspondente', async () => {
    mockUser = { id: 'usr-mult', email: 'mult@zafira.com.br', name: 'Mult', status: 'ACTIVE' };
    mockMemberships = [
      { organizationId: 'org-A', organization: { id: 'org-A', name: 'Org A', slug: 'org-a' }, role: 'ADMIN', status: 'ACTIVE' },
      { organizationId: 'org-B', organization: { id: 'org-B', name: 'Org B', slug: 'org-b' }, role: 'MEMBER', status: 'ACTIVE' }
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'mult@zafira.com.br', password: 'pwd', organizationId: 'org-B' }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.activeOrganizationId, 'org-B');
  });

  await t.test('8. organizationId de outra organização rejeitado', async () => {
    mockLoginThrows = new AppError(403, 'Organização inválida ou não autorizada.');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'mult@zafira.com.br', password: 'pwd', organizationId: 'org-C' }
    });
    assert.equal(response.statusCode, 403);
  });

  await t.test('9. session válida retorna usuário seguro', async () => {
    mockUser = { id: 'usr-sess', email: 'sess@zafira.com.br', name: 'Sess', status: 'ACTIVE' };
    mockMemberships = [{ organizationId: 'org-1', organization: { id: 'org-1', name: 'Org 1', slug: 'org-1' }, role: 'ADMIN', status: 'ACTIVE' }];

    const token = await app.jwt.sign({ sub: mockUser.id, email: mockUser.email, activeOrganizationId: 'org-1' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { token }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.authenticated, true);
    assert.equal(body.user.email, 'sess@zafira.com.br');
    assert.equal(body.activeOrganizationId, 'org-1');
    assert.equal(body.user.passwordHash, undefined);
  });

  await t.test('10. token/cookie inválido resulta em sessão não autenticada', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { token: 'invalid.jwt.token' }
    });

    assert.equal(response.statusCode, 401);
    const body = response.json();
    assert.equal(body.error, 'unauthorized');
  });

  await t.test('11. usuário suspenso perde acesso na sessão', async () => {
    mockUser = { id: 'usr-susp', email: 'susp@zafira.com.br', name: 'Susp', status: 'SUSPENDED' };
    const token = await app.jwt.sign({ sub: mockUser.id, email: mockUser.email });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { token }
    });

    assert.equal(response.statusCode, 401);
  });

  await t.test('12. logout limpa cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout'
    });

    assert.equal(response.statusCode, 200);
    const cookies = response.cookies;
    const tokenCookie = cookies.find(c => c.name === 'token');
    assert.ok(tokenCookie);
    assert.equal(tokenCookie?.maxAge, 0); // clearCookie sets maxAge to 0
    assert.equal(tokenCookie?.value, '');
  });

  await t.test('13. API key de máquina (x-api-key) retorna 403 MACHINE_CREDENTIAL_NOT_ALLOWED em /api/v1/auth/session', async () => {
    const originalApiKey = process.env.HUB_INTERNAL_API_KEY;
    process.env.HUB_INTERNAL_API_KEY = 'secret_internal_auth_key';

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { 'x-api-key': 'secret_internal_auth_key' }
      });

      assert.equal(response.statusCode, 403);
      const body = response.json();
      assert.equal(body.code, 'MACHINE_CREDENTIAL_NOT_ALLOWED');
      assert.equal(body.status, 'error');
    } finally {
      process.env.HUB_INTERNAL_API_KEY = originalApiKey;
    }
  });
});
