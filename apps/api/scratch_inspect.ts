import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function isZeroDecimal(val: any): boolean {
  if (!val) return false;
  if (val instanceof Prisma.Decimal) return val.isZero();
  if (typeof val === 'number') return val === 0;
  if (typeof val === 'string') {
    try { return new Prisma.Decimal(val).isZero(); } catch { return false; }
  }
  if (typeof val === 'object' && val !== null && 's' in val && 'e' in val && 'd' in val) {
    try { return new Prisma.Decimal(val).isZero(); } catch { return false; }
  }
  return false;
}

function isPositiveDecimal(val: any): boolean {
  if (!val) return false;
  if (val instanceof Prisma.Decimal) return val.gt(0);
  if (typeof val === 'number') return val > 0;
  if (typeof val === 'string') {
    try { return new Prisma.Decimal(val).gt(0); } catch { return false; }
  }
  if (typeof val === 'object' && val !== null && 's' in val && 'e' in val && 'd' in val) {
    try { return new Prisma.Decimal(val).gt(0); } catch { return false; }
  }
  return false;
}

function areDecimalsEqual(a: any, b: any): boolean {
  try {
    const da = a instanceof Prisma.Decimal ? a : new Prisma.Decimal(a);
    const db = b instanceof Prisma.Decimal ? b : new Prisma.Decimal(b);
    return da.equals(db);
  } catch {
    return false;
  }
}

const normalizeStrict = (str?: string | null): string => {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
};

const getCivilDate = (tx: any): string => {
  const raw = (tx.rawPayload as any) || {};
  const rawDate =
    raw.dataHoraMovimento ||
    raw.dataEntrada ||
    raw.dataMovimento ||
    raw.dataInclusao ||
    raw.dataLancamento ||
    raw.data;

  if (typeof rawDate === 'string') {
    const isoMatch = rawDate.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const brMatch = rawDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }

  const occ = tx.occurredAt;
  if (occ) {
    if (typeof occ === 'string') {
      const m = occ.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    } else if (occ instanceof Date && !isNaN(occ.getTime())) {
      return occ.toISOString().slice(0, 10);
    }
  }

  if (typeof tx.externalId === 'string') {
    const m = tx.externalId.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }

  return '';
};

const getTitlesStrict = (tx: any): string[] => {
  const set = new Set<string>();
  const raw = (tx.rawPayload as any) || {};
  if (raw.titulo) set.add(normalizeStrict(raw.titulo));
  if (raw.descricao) set.add(normalizeStrict(raw.descricao));
  if (tx.description) set.add(normalizeStrict(tx.description));
  return Array.from(set).filter(Boolean);
};

const hasMatchingTitle = (txA: any, txB: any): boolean => {
  const titlesA = getTitlesStrict(txA);
  const titlesB = getTitlesStrict(txB);
  for (const tA of titlesA) {
    if (titlesB.includes(tA)) return true;
  }
  return false;
};

const extractLegacyAmount = (extId: string): Prisma.Decimal | null => {
  if (!extId || typeof extId !== 'string') return null;
  const matchDir = extId.match(/(?:CREDIT|DEBIT)_([0-9.]+)(?:_|$)/);
  if (matchDir && matchDir[1]) {
    try {
      const dec = new Prisma.Decimal(matchDir[1]);
      if (dec.gt(0)) return dec;
    } catch {}
  }
  const matchFallback = extId.match(/^inter_.*_([0-9.]+)(?:_|$)/);
  if (matchFallback && matchFallback[1]) {
    try {
      const dec = new Prisma.Decimal(matchFallback[1]);
      if (dec.gt(0)) return dec;
    } catch {}
  }
  return null;
};

async function main() {
  const transactions = await prisma.financialTransaction.findMany({
    where: { account: { provider: 'INTER' } },
  });
  
  const zeroTxs = transactions.filter((t) => isZeroDecimal(t.amount));
  const validTxs = transactions.filter((t) => isPositiveDecimal(t.amount));

  console.log(`Total: ${transactions.length}`);
  console.log(`Zero: ${zeroTxs.length}`);
  console.log(`Valid: ${validTxs.length}`);

  let rejectedByAccount = 0;
  let rejectedByDate = 0;
  let rejectedByDirection = 0;
  let rejectedByTitle = 0;
  let rejectedByAmount = 0;
  let matchesByLegacyAmount = 0;
  let matchesByStrictFallback = 0;

  for (const dup of zeroTxs) {
    const dupDateStr = getCivilDate(dup);
    const dupLegacyAmount = extractLegacyAmount(dup.externalId || '');
    
    // Check all validTxs against this dup to see where they fail
    for (const c of validTxs) {
      if (c.accountId !== dup.accountId) {
        rejectedByAccount++;
        continue;
      }
      
      const cDateStr = getCivilDate(c);
      if (cDateStr !== dupDateStr) {
        rejectedByDate++;
        continue;
      }
      
      if (c.direction !== dup.direction) {
        rejectedByDirection++;
        continue;
      }
      
      const titleMatch = hasMatchingTitle(dup, c);
      if (!titleMatch) {
        rejectedByTitle++;
        continue;
      }
      
      // If we got here, they match by Account, Date, Direction, Title
      if (dupLegacyAmount !== null && dupLegacyAmount.gt(0)) {
        if (areDecimalsEqual(c.amount, dupLegacyAmount)) {
          matchesByLegacyAmount++;
        } else {
          rejectedByAmount++;
        }
      } else {
         matchesByStrictFallback++;
      }
    }
  }

  console.log({
    rejectedByAccount,
    rejectedByDate,
    rejectedByDirection,
    rejectedByTitle,
    rejectedByAmount,
    matchesByLegacyAmount,
    matchesByStrictFallback,
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
