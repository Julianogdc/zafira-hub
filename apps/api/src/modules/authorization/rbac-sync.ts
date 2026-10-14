import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * HM-1 / H1 (P22, DEC-HML-001) - Sincronizacao das permissoes PADRAO dos papeis com o catalogo canonico.
 *
 * Escopo (deliberadamente estreito):
 *  - catalogo (`permissions`): cria os codigos que faltam; NUNCA remove (a remocao em cascata apagaria excecoes individuais);
 *  - permissoes padrao dos papeis (`role_permissions`, globais por papel): acrescenta as que faltam e REMOVE as que
 *    deixaram de ser padrao (inclusive codigos que nao existem mais no catalogo canonico);
 *  - excecoes individuais (`organization_member_permissions`, por organizacao e membro): NUNCA lidas para alteracao,
 *    nunca escritas. Sao apenas contadas no relatorio.
 * Idempotente: a segunda execucao nao altera nada. Nao toca em nenhum dado de organizacao.
 */

export const RBAC_ROLES = ['ADMIN', 'MANAGER', 'MEMBER'] as const;
export type RbacRole = (typeof RBAC_ROLES)[number];

export type RbacDefaults = Record<RbacRole, readonly string[]>;

export interface RbacState {
  catalogCodes: readonly string[];
  rolePermissions: readonly { role: string; permissionCode: string }[];
}

export interface RbacGrant {
  role: RbacRole;
  permissionCode: string;
}

export interface RbacSyncPlan {
  /** Codigos canonicos ausentes do catalogo (serao criados). */
  catalogToCreate: string[];
  /** Codigos no catalogo que nao existem mais no canonico: somente relatados, nunca removidos. */
  catalogObsolete: string[];
  /** Permissoes padrao que faltam em algum papel (serao acrescentadas). */
  grantsToAdd: RbacGrant[];
  /** Permissoes que um papel tem mas que nao sao mais padrao (serao removidas). */
  grantsToRemove: RbacGrant[];
  /** Linhas de papeis desconhecidos (nunca alteradas; so relatadas). */
  unknownRoleRows: number;
  /** Quantidade de permissoes padrao ja corretas. */
  unchanged: number;
  /** Nada a criar, acrescentar ou remover. */
  inSync: boolean;
}

export class RbacDefaultsInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RbacDefaultsInvalidError';
  }
}

/**
 * Trava de seguranca antes de qualquer remocao: os padroes precisam estar completos e coerentes com o catalogo.
 * Evita que um import vazio ou quebrado revogue as permissoes de todo um papel.
 */
export function assertRbacDefaultsSane(catalog: readonly string[], defaults: RbacDefaults): void {
  const canonical = new Set(catalog);
  if (canonical.size === 0) throw new RbacDefaultsInvalidError('Catalogo canonico de permissoes vazio.');
  for (const role of RBAC_ROLES) {
    const list = defaults[role];
    if (!Array.isArray(list) || list.length === 0) throw new RbacDefaultsInvalidError(`Padroes do papel ${role} vazios.`);
    const unknown = list.filter((c) => !canonical.has(c));
    if (unknown.length) throw new RbacDefaultsInvalidError(`Padroes do papel ${role} com codigos fora do catalogo: ${unknown.join(', ')}.`);
  }
  // o administrador nunca pode ter menos permissoes que os outros papeis
  for (const role of ['MANAGER', 'MEMBER'] as const) {
    const adminSet = new Set(defaults.ADMIN);
    const extra = defaults[role].filter((c) => !adminSet.has(c));
    if (extra.length) throw new RbacDefaultsInvalidError(`O papel ${role} tem padroes que o ADMIN nao tem: ${extra.join(', ')}.`);
  }
}

/** Funcao pura: dado o estado atual e os padroes, calcula o que precisa mudar. */
export function computeRbacSyncPlan(canonicalCodes: readonly string[], defaults: RbacDefaults, state: RbacState): RbacSyncPlan {
  const canonical = new Set(canonicalCodes);
  const catalog = new Set(state.catalogCodes);
  const catalogToCreate = [...canonical].filter((c) => !catalog.has(c)).sort();
  const catalogObsolete = [...catalog].filter((c) => !canonical.has(c)).sort();

  const have = new Map<RbacRole, Set<string>>(RBAC_ROLES.map((r) => [r, new Set<string>()]));
  let unknownRoleRows = 0;
  for (const row of state.rolePermissions) {
    const bucket = have.get(row.role as RbacRole);
    if (bucket) bucket.add(row.permissionCode);
    else unknownRoleRows += 1;
  }

  const grantsToAdd: RbacGrant[] = [];
  const grantsToRemove: RbacGrant[] = [];
  let unchanged = 0;
  for (const role of RBAC_ROLES) {
    const wanted = new Set(defaults[role]);
    const current = have.get(role)!;
    for (const code of [...wanted].sort()) {
      if (current.has(code)) unchanged += 1;
      else grantsToAdd.push({ role, permissionCode: code });
    }
    for (const code of [...current].sort()) {
      if (!wanted.has(code)) grantsToRemove.push({ role, permissionCode: code });
    }
  }

  return {
    catalogToCreate,
    catalogObsolete,
    grantsToAdd,
    grantsToRemove,
    unknownRoleRows,
    unchanged,
    inSync: catalogToCreate.length === 0 && grantsToAdd.length === 0 && grantsToRemove.length === 0,
  };
}

type Db = Pick<PrismaClient, 'permission' | 'rolePermission' | 'organizationMemberPermission' | '$transaction'>;

export async function loadRbacState(db: Pick<PrismaClient, 'permission' | 'rolePermission'>): Promise<RbacState> {
  const [catalog, rolePermissions] = await Promise.all([
    db.permission.findMany({ select: { code: true } }),
    db.rolePermission.findMany({ select: { role: true, permissionCode: true } }),
  ]);
  return { catalogCodes: catalog.map((c) => c.code), rolePermissions };
}

export interface IndividualExceptionsReport {
  /** Total de excecoes individuais (nao alteradas). */
  total: number;
  /** Excecoes que CONCEDEM (allowed = true) uma permissao que o papel do membro nao tem por padrao: sao decisao explicita. */
  grantsByCode: Record<string, number>;
}

/**
 * Somente leitura e sem dado pessoal: quantas excecoes concedentes existem por codigo, para o operador saber
 * que elas permanecem (nao sao revogadas pela sincronizacao).
 */
export async function reportIndividualExceptions(db: Pick<PrismaClient, 'organizationMemberPermission'>): Promise<IndividualExceptionsReport> {
  const grouped = await db.organizationMemberPermission.groupBy({
    by: ['permissionCode', 'allowed'],
    _count: { _all: true },
  });
  const grantsByCode: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    total += g._count._all;
    if (g.allowed) grantsByCode[g.permissionCode] = (grantsByCode[g.permissionCode] ?? 0) + g._count._all;
  }
  return { total, grantsByCode };
}

export interface RbacApplyResult {
  created: number;
  added: number;
  removed: number;
}

/**
 * Aplica o plano em uma transacao. Recalcula o plano DENTRO da transacao (estado fresco), para que duas execucoes
 * simultaneas nao se atropelem, e so entao grava. Retorna o que realmente mudou.
 */
export async function applyRbacSync(db: Db, canonicalCodes: readonly string[], defaults: RbacDefaults): Promise<{ result: RbacApplyResult; plan: RbacSyncPlan }> {
  assertRbacDefaultsSane(canonicalCodes, defaults);
  return db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const state = await loadRbacState(tx);
      const plan = computeRbacSyncPlan(canonicalCodes, defaults, state);
      for (const code of plan.catalogToCreate) {
        await tx.permission.create({ data: { code, area: code.split('.')[0], description: `Permissão do sistema: ${code}` } });
      }
      if (plan.grantsToAdd.length) {
        await tx.rolePermission.createMany({
          data: plan.grantsToAdd.map((g) => ({ role: g.role, permissionCode: g.permissionCode })),
          skipDuplicates: true,
        });
      }
      let removed = 0;
      for (const g of plan.grantsToRemove) {
        const r = await tx.rolePermission.deleteMany({ where: { role: g.role, permissionCode: g.permissionCode } });
        removed += r.count;
      }
      return { result: { created: plan.catalogToCreate.length, added: plan.grantsToAdd.length, removed }, plan };
    },
    { isolationLevel: 'Serializable' }
  );
}

/** Relatorio textual (sem segredos e sem dados pessoais). */
export function formatRbacSyncReport(plan: RbacSyncPlan, exceptions: IndividualExceptionsReport | null, mode: 'check' | 'apply'): string {
  const lines: string[] = [];
  const verb = mode === 'check' ? 'a fazer' : 'feito';
  lines.push(`Catálogo: ${plan.catalogToCreate.length} código(s) a criar; ${plan.catalogObsolete.length} obsoleto(s) (mantidos).`);
  lines.push(`Padrões dos papéis: ${plan.unchanged} já corretos; ${plan.grantsToAdd.length} a acrescentar; ${plan.grantsToRemove.length} a remover (${verb}).`);
  for (const g of plan.grantsToAdd) lines.push(`  + ${g.role} ${g.permissionCode}`);
  for (const g of plan.grantsToRemove) lines.push(`  - ${g.role} ${g.permissionCode}`);
  for (const c of plan.catalogToCreate) lines.push(`  + catálogo ${c}`);
  for (const c of plan.catalogObsolete) lines.push(`  ! catálogo obsoleto (não removido; exceções individuais preservadas): ${c}`);
  if (plan.unknownRoleRows) lines.push(`  ! ${plan.unknownRoleRows} linha(s) de papel desconhecido (não alteradas)`);
  if (exceptions) {
    const codes = Object.entries(exceptions.grantsByCode).sort(([a], [b]) => a.localeCompare(b));
    lines.push(`Exceções individuais: ${exceptions.total} (preservadas, nunca alteradas).`);
    for (const [code, n] of codes) lines.push(`  = ${n} concessão(ões) individual(is) de ${code}`);
  }
  lines.push(plan.inSync ? 'Resultado: em sincronia.' : mode === 'check' ? 'Resultado: DIVERGENTE.' : 'Resultado: sincronizado.');
  return lines.join('\n');
}
