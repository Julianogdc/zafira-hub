import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../../../app.js';

describe('Social Publisher HTTP Routes & Auth Guard Suite', () => {
  it('GET /api/v1/social/status sem auth retorna 401', async () => {
    const app = buildApp();
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/social/status',
      });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/social/content sem auth retorna 401', async () => {
    const app = buildApp();
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/social/content',
      });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it('POST /api/v1/social/upload sem auth retorna 401', async () => {
    const app = buildApp();
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/social/upload',
      });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/clients/:clientId/social/content sem auth retorna 401', async () => {
    const app = buildApp();
    await app.ready();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/clients/client-1/social/content',
      });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it('POST /api/v1/clients/:clientId/social/content sem auth retorna 401', async () => {
    const app = buildApp();
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/clients/client-1/social/content',
      });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});
