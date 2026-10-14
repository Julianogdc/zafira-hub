import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPilotRequest, checkPilotSend, parsePilotPolicy } from '../content/publication-policy.js';

// F8-5p.3 (DEC-F8-031, P39): politica do piloto, fail closed.

const ORG = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

test('ausente, vazia ou invalida: envio bloqueado', () => {
  for (const env of [{}, { organizationIds: '', formats: '' }, { organizationIds: ORG }, { formats: 'STORY' }, { organizationIds: ORG, formats: 'STORY,GIF' }, { organizationIds: 'x;drop', formats: 'STORY' }]) {
    const p = parsePilotPolicy(env);
    assert.equal(p.valid, false, JSON.stringify(env));
    assert.equal(checkPilotSend(p, { organizationId: ORG, format: 'STORY' })?.code, 'PILOT_POLICY_INVALID', JSON.stringify(env));
  }
  assert.equal(parsePilotPolicy({}).configured, false);
  assert.equal(parsePilotPolicy({ organizationIds: '' }).configured, true, 'definida vazia conta como configurada (e bloqueia)');
});

test('valida: so a organizacao e os formatos listados', () => {
  const p = parsePilotPolicy({ organizationIds: ` ${ORG} , ${ORG}`, formats: 'story, FEED_IMAGE' });
  assert.equal(p.valid, true);
  assert.deepEqual(p.organizationIds, [ORG]);
  assert.deepEqual(p.formats, ['STORY', 'FEED_IMAGE']);
  assert.equal(checkPilotSend(p, { organizationId: ORG, format: 'STORY' }), null);
  assert.equal(checkPilotSend(p, { organizationId: OTHER, format: 'STORY' })?.code, 'PILOT_ORGANIZATION_NOT_AUTHORIZED');
  assert.equal(checkPilotSend(p, { organizationId: ORG, format: 'CAROUSEL' })?.code, 'PILOT_FORMAT_NOT_AUTHORIZED');
  assert.equal(checkPilotSend(p, { organizationId: ORG, format: 'REEL' })?.code, 'PILOT_FORMAT_NOT_AUTHORIZED');
});

test('pedido: livre so no modo de simulacao sem politica; estrito com politica ou com envio ligado', () => {
  const none = parsePilotPolicy({});
  assert.equal(checkPilotRequest(none, false, { organizationId: ORG, format: 'CAROUSEL' }), null, 'simulacao: nada sai do Hub');
  assert.equal(checkPilotRequest(none, true, { organizationId: ORG, format: 'STORY' })?.code, 'PILOT_POLICY_INVALID');
  const p = parsePilotPolicy({ organizationIds: ORG, formats: 'STORY' });
  assert.equal(checkPilotRequest(p, false, { organizationId: ORG, format: 'FEED_IMAGE' })?.code, 'PILOT_FORMAT_NOT_AUTHORIZED');
  assert.equal(checkPilotRequest(p, true, { organizationId: ORG, format: 'STORY' }), null);
});
