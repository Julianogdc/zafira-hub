import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { resolveTrustProxy, isValidIpOrCidr } from '../trust-proxy.js';
import { buildApp } from '../../app.js';

test('trust-proxy (HM-3) — validação estrita de IP e CIDR', () => {
  assert.equal(isValidIpOrCidr('127.0.0.1'), true);
  assert.equal(isValidIpOrCidr('10.0.0.1'), true);
  assert.equal(isValidIpOrCidr('192.168.1.100'), true);
  assert.equal(isValidIpOrCidr('::1'), true);
  assert.equal(isValidIpOrCidr('2001:db8::1'), true);
  assert.equal(isValidIpOrCidr('172.18.0.0/16'), true);
  assert.equal(isValidIpOrCidr('10.0.0.1/32'), true);

  // Rejeições de segurança
  assert.equal(isValidIpOrCidr(''), false);
  assert.equal(isValidIpOrCidr('   '), false);
  assert.equal(isValidIpOrCidr('*'), false);
  assert.equal(isValidIpOrCidr('all'), false);
  assert.equal(isValidIpOrCidr('0.0.0.0/0'), true); // sintaxe valida, mas testaremos rejeicao de curingas
  assert.equal(isValidIpOrCidr('banana'), false);
  assert.equal(isValidIpOrCidr('127.0.0.256'), false);
  assert.equal(isValidIpOrCidr('172.18.0.0/33'), false);
});

test('trust-proxy (HM-3) — comportamento padrão é seguro (false)', () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(''), false);
  assert.equal(resolveTrustProxy(false), false);
  assert.equal(resolveTrustProxy('false'), false);
});

test('trust-proxy (HM-3) — trustProxy: true irrestrito é TERMINANTEMENTE PROIBIDO', () => {
  assert.throws(
    () => resolveTrustProxy(true),
    /trustProxy: true.*irrestrito é expressamente proibido/
  );
  assert.throws(
    () => resolveTrustProxy('true'),
    /trustProxy: true.*irrestrito é expressamente proibido/
  );
});

test('trust-proxy (HM-3) — suporta contagem de saltos inteiros controlados', () => {
  const fn1 = resolveTrustProxy(1);
  assert.equal(typeof fn1, 'function');
  assert.equal((fn1 as any)('127.0.0.1', 0), true);
  assert.equal((fn1 as any)('127.0.0.1', 1), false);

  const fn2 = resolveTrustProxy('2');
  assert.equal(typeof fn2, 'function');
  assert.equal((fn2 as any)('127.0.0.1', 0), true);
  assert.equal((fn2 as any)('127.0.0.1', 1), true);
  assert.equal((fn2 as any)('127.0.0.1', 2), false);

  // Limites e valores invalidos
  assert.throws(() => resolveTrustProxy(0), /número de saltos deve ser um inteiro entre 1 e 10/);
  assert.throws(() => resolveTrustProxy(-1), /número de saltos deve ser um inteiro entre 1 e 10/);
  assert.throws(() => resolveTrustProxy(11), /número de saltos deve ser um inteiro entre 1 e 10/);
  assert.throws(() => resolveTrustProxy('0'), /número de saltos deve ser um inteiro entre 1 e 10/);
});

test('trust-proxy (HM-3) — suporta lista explícita de IPs/CIDRs confiáveis', () => {
  assert.deepEqual(resolveTrustProxy('127.0.0.1,::1,172.18.0.10/32'), ['127.0.0.1', '::1', '172.18.0.10/32']);
  assert.deepEqual(resolveTrustProxy(['127.0.0.1', '10.0.0.5']), ['127.0.0.1', '10.0.0.5']);

  // Rejeita entradas com lixo ou curingas
  assert.throws(
    () => resolveTrustProxy('127.0.0.1,inválido'),
    /entrada "inválido" não é um IP nem CIDR válido/
  );
  assert.throws(
    () => resolveTrustProxy('127.0.0.1,*'),
    /entrada "\*" não é um IP nem CIDR válido/
  );
});

test('trust-proxy (HM-3) — Fastify ignora X-Forwarded-For com padrão seguro (desativado)', async () => {
  const app = fastify({
    trustProxy: resolveTrustProxy(false),
  });

  app.get('/test-ip', async (req) => {
    return { ip: req.ip, ips: req.ips };
  });

  await app.ready();

  // Requisição simulando tentativa de falsificação de IP externo
  const res = await app.inject({
    method: 'GET',
    url: '/test-ip',
    headers: {
      'x-forwarded-for': '203.0.113.195',
      'x-real-ip': '203.0.113.195',
    },
  });

  assert.equal(res.statusCode, 200);
  const data = res.json();
  // Como trustProxy esta desativado, o IP atribuido pelo Fastify e o socket (127.0.0.1 na injecao), nunca o header forjado
  assert.equal(data.ip, '127.0.0.1');
  assert.equal(data.ips, undefined);

  await app.close();
});

test('trust-proxy (HM-3) — Fastify extrai IP real apenas através de proxy confiável configurado', async () => {
  // Configura confiando em 127.0.0.1 (IP do proxy reverso local)
  const app = fastify({
    trustProxy: resolveTrustProxy('127.0.0.1'),
  });

  app.get('/test-ip', async (req) => {
    return { ip: req.ip, ips: req.ips };
  });

  await app.ready();

  // 1. Requisição vindo do proxy 127.0.0.1 repassando o cliente legítimo
  const resValid = await app.inject({
    method: 'GET',
    url: '/test-ip',
    headers: {
      'x-forwarded-for': '198.51.100.42',
    },
  });

  assert.equal(resValid.statusCode, 200);
  assert.equal(resValid.json().ip, '198.51.100.42');

  // 2. Requisição com cadeia: cliente real + spoofing anterior
  // X-Forwarded-For: spoofed-client, client-real
  // Como apenas 127.0.0.1 é proxy confiável (o injetor), o IP imediatamente anterior a 127.0.0.1 é client-real
  const resChain = await app.inject({
    method: 'GET',
    url: '/test-ip',
    headers: {
      'x-forwarded-for': '203.0.113.50, 198.51.100.42',
    },
  });

  assert.equal(resChain.statusCode, 200);
  assert.equal(resChain.json().ip, '198.51.100.42');

  await app.close();
});

test('trust-proxy (HM-3) — Preservação de Rate Limiting por IP resolvido', async () => {
  const app = fastify({
    trustProxy: resolveTrustProxy('127.0.0.1'),
  });

  await app.register(rateLimit, {
    max: 2,
    timeWindow: '1 minute',
  });

  app.get('/limited', async (req) => ({ ip: req.ip }));

  await app.ready();

  // IP A: 2 requisicoes permitidas, 3a bloqueada
  const res1A = await app.inject({ method: 'GET', url: '/limited', headers: { 'x-forwarded-for': '198.51.100.1' } });
  assert.equal(res1A.statusCode, 200);

  const res2A = await app.inject({ method: 'GET', url: '/limited', headers: { 'x-forwarded-for': '198.51.100.1' } });
  assert.equal(res2A.statusCode, 200);

  const res3A = await app.inject({ method: 'GET', url: '/limited', headers: { 'x-forwarded-for': '198.51.100.1' } });
  assert.equal(res3A.statusCode, 429);

  // IP B: cota independente, continua funcionando
  const res1B = await app.inject({ method: 'GET', url: '/limited', headers: { 'x-forwarded-for': '198.51.100.2' } });
  assert.equal(res1B.statusCode, 200);

  await app.close();
});

test('trust-proxy (HM-3) — buildApp integra trustProxy opcional e padrão seguro', async () => {
  // Sem opcao: padrao seguro false
  const defaultApp = buildApp({ trustProxy: false });
  await defaultApp.ready();
  const resDef = await defaultApp.inject({
    method: 'GET',
    url: '/health',
    headers: { 'x-forwarded-for': '203.0.113.99' },
  });
  assert.equal(resDef.statusCode, 200);
  await defaultApp.close();

  // Proibição expressa de trustProxy: true no buildApp
  assert.throws(
    () => buildApp({ trustProxy: true }),
    /trustProxy: true.*irrestrito é expressamente proibido/
  );
});
