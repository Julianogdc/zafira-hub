import { isIP } from 'node:net';

/**
 * HM-3 - Suporte configuravel e seguro a proxies confiaveis no Fastify.
 *
 * REQUISITOS DE SEGURANCA:
 * - Comportamento padrao seguro: false (desativado por padrao, confia somente no socket TCP direto).
 * - "trustProxy: true" irrestrito e TERMINANTEMENTE PROIBIDO (rejeitado com erro de inicializacao).
 * - Nao confiar indiscriminadamente em todas as redes privadas Docker.
 * - Suporta:
 *   - false / '' / undefined: desativado (padrao seguro).
 *   - numero inteiro positivo (ex: 1, 2): numero exato de saltos confiaveis como TrustProxyFn.
 *   - string ou array de strings com IPs ou CIDRs explicitos (ex: "127.0.0.1,::1,172.18.0.10/32").
 */

const IPV4_CIDR_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/(?:[0-9]|[12][0-9]|3[0-2])$/;
const IPV6_CIDR_REGEX = /^[0-9a-fA-F:]+\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/;

export function isValidIpOrCidr(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  if (isIP(trimmed) !== 0) return true;
  if (IPV4_CIDR_REGEX.test(trimmed)) return true;
  if (IPV6_CIDR_REGEX.test(trimmed)) {
    const [ipPart] = trimmed.split('/');
    return isIP(ipPart) === 6;
  }
  return false;
}

export type TrustProxyFn = (address: string, hop: number) => boolean;
export type TrustProxyConfig = boolean | string | string[] | TrustProxyFn;

export function resolveTrustProxy(raw?: string | boolean | number | string[]): TrustProxyConfig {
  if (raw === undefined || raw === null || raw === '' || raw === false || raw === 'false') {
    return false;
  }

  if (raw === true || raw === 'true') {
    throw new Error(
      "Configuração de segurança inválida: 'trustProxy: true' irrestrito é expressamente proibido. " +
      'Defina explicitamente IPs, redes CIDR ou o número de saltos confiáveis na variável TRUST_PROXY.'
    );
  }

  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1 || raw > 10) {
      throw new Error(`Configuração de trustProxy inválida: número de saltos deve ser um inteiro entre 1 e 10 (recebido: ${raw}).`);
    }
    const maxHops = raw;
    return (_addr: string, hop: number) => hop < maxHops;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const hops = parseInt(trimmed, 10);
      if (hops < 1 || hops > 10) {
        throw new Error(`Configuração de trustProxy inválida: número de saltos deve ser um inteiro entre 1 e 10 (recebido: ${hops}).`);
      }
      return (_addr: string, hop: number) => hop < hops;
    }

    const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return false;

    for (const part of parts) {
      if (!isValidIpOrCidr(part)) {
        throw new Error(
          `Configuração de trustProxy inválida: entrada "${part}" não é um IP nem CIDR válido. ` +
          'Proibido usar curingas ou nomes arbitrários.'
        );
      }
    }
    return parts;
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) return false;
    for (const part of raw) {
      if (typeof part !== 'string' || !isValidIpOrCidr(part)) {
        throw new Error(
          `Configuração de trustProxy inválida: entrada "${String(part)}" não é um IP nem CIDR válido.`
        );
      }
    }
    return [...raw];
  }

  throw new Error('Configuração de trustProxy não suportada.');
}
