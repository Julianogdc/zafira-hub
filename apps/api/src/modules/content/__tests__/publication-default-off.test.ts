import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationDispatcher, publicationDispatchEnabled } from '../publication/publication-dispatcher.js';
import { PublicationScheduler } from '../publication/publication.scheduler.js';

/**
 * F8-4a (DEC-F8-023) - Prova de que, com a configuracao padrao, nenhuma publicacao real e possivel:
 * o despachante nao inicia, nao le a caixa de saida e nunca monta o gateway do provedor.
 */

const factoryProibida = async () => {
  throw new Error('o gateway do provedor NAO pode ser montado com a configuracao padrao');
};

test('flag: so "true" explicito liga o despachante', () => {
  assert.equal(publicationDispatchEnabled({}), false);
  for (const v of ['', 'false', '1', 'TRUE', 'yes', 'on']) assert.equal(publicationDispatchEnabled({ PUBLICATION_DISPATCH_ENABLED: v }), false, v);
  assert.equal(publicationDispatchEnabled({ PUBLICATION_DISPATCH_ENABLED: 'true' }), true);
});

test('padrao: despacho e reconciliacao retornam sem tocar no provedor', async () => {
  let chamadas = 0;
  const d = new PublicationDispatcher(async () => {
    chamadas += 1;
    return factoryProibida();
  }, () => {
    throw new Error('storage nao deve ser lido');
  }, {});
  assert.equal(d.isEnabled(), false);
  assert.deepEqual(await d.dispatchDue(), { enabled: false, claimed: 0, results: [] });
  assert.deepEqual(await d.reconcileDue(), { enabled: false, checked: 0 });
  assert.equal(chamadas, 0);
});

test('padrao: o agendador nao inicia o ciclo', () => {
  const logs: string[] = [];
  const logger = { info: (_o: unknown, msg?: string) => logs.push(String(msg)), error: () => {} };
  const s = new PublicationScheduler(new PublicationDispatcher(factoryProibida, undefined, {}), {}, logger);
  s.start();
  assert.ok(logs.some((m) => m.includes('nao iniciado')));
  assert.equal((s as unknown as { timer: unknown }).timer, null);
  s.stop();
});
