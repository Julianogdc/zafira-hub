import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';

/**
 * Trava de execução única entre instâncias da API — e entre execuções da mesma instância (DEC-F6-003).
 * Uma única instrução SQL atômica: só adquire se a trava não existe ou já expirou.
 * O prazo (ttl) evita trava eterna se a instância cair no meio da execução.
 * Devolve o identificador do dono (para liberar) ou null quando outra execução está em andamento.
 */
export async function acquireLease(name: string, ttlMs: number): Promise<string | null> {
  const holder = `${process.pid}:${randomUUID()}`;
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    INSERT INTO scheduler_leases (name, holder, "expiresAt", "acquiredAt")
    VALUES (${name}, ${holder}, ${expiresAt}, now())
    ON CONFLICT (name) DO UPDATE
      SET holder = EXCLUDED.holder, "expiresAt" = EXCLUDED."expiresAt", "acquiredAt" = now()
      WHERE scheduler_leases."expiresAt" < now()
    RETURNING name`;
  return rows.length === 1 ? holder : null;
}

/** Libera a trava somente se ainda pertence a este dono. */
export async function releaseLease(name: string, holder: string): Promise<void> {
  await prisma.schedulerLease.deleteMany({ where: { name, holder } });
}
