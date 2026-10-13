import test from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../app.js';
import { FastifyInstance } from 'fastify';

test('Deny-by-Default API Surface', async (t) => {
  const app: FastifyInstance = buildApp();
  await app.ready();

  t.after(async () => {
    await app.close();
  });

  await t.test('PUBLIC_INTENTIONAL - GET /health deve retornar 200 sem token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health'
    });
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('PUBLIC_INTENTIONAL - POST /api/v1/auth/logout deve retornar 200 sem token (apenas limpa cookie)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout'
    });
    assert.strictEqual(res.statusCode, 200);
  });

  await t.test('HUMAN_AUTHENTICATED - GET /api/v1/auth/session deve retornar 401 sem token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session'
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('HUMAN_AUTHENTICATED - GET /api/financial/transactions deve retornar 401 sem token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/financial/transactions'
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('HUMAN_AUTHENTICATED - GET /api/financial/accounts/overview deve retornar 401 sem token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/financial/accounts/overview'
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('HUMAN_AUTHENTICATED - POST /api/financial/categories deve retornar 401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/financial/categories',
      payload: { name: 'Test' }
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('MACHINE_AUTHENTICATED - POST /api/webhooks/asaas deve retornar erro de permissão/validação sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/asaas',
      payload: { event: 'PAYMENT_CREATED' }
    });
    // O webhook do asaas pode retornar 400 ou 401 ou 403 dependendo da implementação, mas NUNCA 200.
    assert.notStrictEqual(res.statusCode, 200);
  });

});
