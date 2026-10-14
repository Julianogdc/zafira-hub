/**
 * F8-5p.3 (DEC-F8-031, P39) - Politica do piloto de publicacao: organizacoes e formatos autorizados.
 * Fail closed: ausente, vazia ou invalida = NADA e enviado ao provedor. A barreira de envio (despachante) e
 * sempre estrita. A barreira do pedido so atua quando a politica foi configurada OU o envio esta ligado, para
 * que o modo de simulacao (envio desligado, nada sai do Hub) continue registrando pedidos.
 */

import { CONTENT_FORMATS, type ContentFormat } from './content-model.js';

export interface PilotPolicy {
  /** Alguma das variaveis foi definida (mesmo vazia). */
  configured: boolean;
  /** Ha ao menos uma organizacao e um formato, todos validos. */
  valid: boolean;
  organizationIds: string[];
  formats: ContentFormat[];
  invalidTokens: string[];
}

const ORG_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const tokens = (v: string | undefined) => (v ?? '').split(',').map((t) => t.trim()).filter(Boolean);

export function parsePilotPolicy(input: { organizationIds?: string; formats?: string }): PilotPolicy {
  const configured = input.organizationIds !== undefined || input.formats !== undefined;
  const invalidTokens: string[] = [];
  const organizationIds: string[] = [];
  for (const t of tokens(input.organizationIds)) (ORG_ID_PATTERN.test(t) ? organizationIds : invalidTokens).push(t);
  const formats: ContentFormat[] = [];
  for (const t of tokens(input.formats)) {
    const f = t.toUpperCase();
    if ((CONTENT_FORMATS as readonly string[]).includes(f)) formats.push(f as ContentFormat);
    else invalidTokens.push(t);
  }
  return {
    configured,
    valid: invalidTokens.length === 0 && organizationIds.length > 0 && formats.length > 0,
    organizationIds: [...new Set(organizationIds)],
    formats: [...new Set(formats)],
    invalidTokens,
  };
}

export type PilotProblemCode = 'PILOT_POLICY_INVALID' | 'PILOT_ORGANIZATION_NOT_AUTHORIZED' | 'PILOT_FORMAT_NOT_AUTHORIZED';

/** Barreira de envio: estrita (politica ausente, vazia ou invalida bloqueia). */
export function checkPilotSend(policy: PilotPolicy, target: { organizationId: string; format: ContentFormat }): { code: PilotProblemCode; message: string } | null {
  if (!policy.valid) {
    return { code: 'PILOT_POLICY_INVALID', message: 'Política de publicação do piloto ausente, vazia ou inválida: nada é enviado ao provedor.' };
  }
  if (!policy.organizationIds.includes(target.organizationId)) {
    return { code: 'PILOT_ORGANIZATION_NOT_AUTHORIZED', message: 'Esta organização não está autorizada a publicar no piloto.' };
  }
  if (!policy.formats.includes(target.format)) {
    return { code: 'PILOT_FORMAT_NOT_AUTHORIZED', message: 'Este formato não está autorizado no piloto de publicação.' };
  }
  return null;
}

/** Barreira do pedido: estrita quando a politica existe ou o envio esta ligado; livre so no modo de simulacao sem politica. */
export function checkPilotRequest(
  policy: PilotPolicy,
  dispatchEnabled: boolean,
  target: { organizationId: string; format: ContentFormat }
): { code: PilotProblemCode; message: string } | null {
  if (!policy.configured && !dispatchEnabled) return null;
  return checkPilotSend(policy, target);
}
