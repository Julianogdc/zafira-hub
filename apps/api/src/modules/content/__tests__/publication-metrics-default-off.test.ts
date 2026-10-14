import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRawMetrics } from '../publication/publication-gateway.js';
import { PublicationMetricsCollector, publicationMetricsEnabled } from '../publication/publication-metrics.collector.js';
import { PublicationSimulator } from '../publication/publication-simulator.js';

/**
 * F8-5a (DEC-F8-029) - O coletor de metricas fica desligado por padrao e nunca monta o gateway do provedor;
 * so liga com PUBLICATION_METRICS_ENABLED=true E o despachante ligado.
 */

test('flag: coletor exige "true" explicito e o despachante ligado', () => {
  assert.equal(publicationMetricsEnabled({}), false);
  assert.equal(publicationMetricsEnabled({ PUBLICATION_METRICS_ENABLED: 'true' }), false, 'sem despachante nao ha o que medir');
  assert.equal(publicationMetricsEnabled({ PUBLICATION_DISPATCH_ENABLED: 'true' }), false);
  for (const v of ['', 'false', '1', 'TRUE', 'yes']) {
    assert.equal(publicationMetricsEnabled({ PUBLICATION_DISPATCH_ENABLED: 'true', PUBLICATION_METRICS_ENABLED: v }), false, v);
  }
  assert.equal(publicationMetricsEnabled({ PUBLICATION_DISPATCH_ENABLED: 'true', PUBLICATION_METRICS_ENABLED: 'true' }), true);
});

test('padrao: coleta retorna sem tocar no provedor', async () => {
  let chamadas = 0;
  const c = new PublicationMetricsCollector(async () => {
    chamadas += 1;
    throw new Error('o gateway NAO pode ser montado com a configuracao padrao');
  }, {});
  assert.equal(c.isEnabled(), false);
  assert.deepEqual(await c.collectDue(), { enabled: false, checked: 0, inserted: 0, outcomes: {} });
  assert.equal(chamadas, 0);
});

test('mapeamento da resposta do BrightBean descarta next_sync_eta e preserva captured_at nulo', () => {
  const m = mapRawMetrics({
    platform_posts: [
      {
        analytics_available: true,
        captured_at: null,
        metric_tiles: [{ key: 'reach', kind: 'count', value: 0 }, { kind: 'count', value: 1 } as never],
        next_sync_eta: '2026-10-14T00:31:00Z',
      } as never,
    ],
  });
  assert.deepEqual(m, { analyticsAvailable: true, unavailableReason: null, capturedAt: null, tiles: [{ key: 'reach', kind: 'count', value: 0 }] });
  assert.equal(mapRawMetrics({ platform_posts: [] }).analyticsAvailable, false);
});

test('simulador: sem coleta devolve zeros com captured_at nulo (como no T30)', async () => {
  const sim = new PublicationSimulator();
  const post = await sim.createDraft({ socialAccountId: 'sim-ig-1', caption: 'x', mediaIds: [], postType: null, idempotencyKey: 'k1' });
  const before = await sim.getPostMetrics(post.id);
  assert.equal(before?.capturedAt, null);
  assert.ok(before?.tiles.every((t) => t.value === 0));
  sim.collectMetrics(post.id, new Date('2026-10-14T01:00:00Z'), { reach: 10, engagement: 2.5 });
  const after = await sim.getPostMetrics(post.id);
  assert.equal(after?.capturedAt, '2026-10-14T01:00:00.000Z');
  assert.equal(await sim.getPostMetrics('inexistente'), null);
});
