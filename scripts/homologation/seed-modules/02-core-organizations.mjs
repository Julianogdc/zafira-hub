import argon2 from 'argon2';
import { refuse } from './01-safety-guard.mjs';

// Dedicated IDs: do not collide with or reset the existing Browser Gate fixtures.
export const ORGANIZATIONS = Object.freeze(['alpha', 'beta'].map((label, index) => Object.freeze({
  id: `a4b10000-0000-4000-8000-00000000000${index + 1}`,
  slug: `org-${label}-synthetic`, name: `Synthetic ${label}`,
})));
export const PEOPLE = Object.freeze(ORGANIZATIONS.flatMap((org, index) =>
  ['ADMIN', 'MANAGER', 'MEMBER'].map((role, position) => Object.freeze({
    id: `a4b10000-0001-4000-8000-0000000000${index + 1}${position + 1}`,
    membershipId: `a4b10000-0002-4000-8000-0000000000${index + 1}${position + 1}`,
    organizationId: org.id, role, name: `Synthetic ${index ? 'beta' : 'alpha'} ${role}`,
    email: `synthetic-${index ? 'beta' : 'alpha'}-${role.toLowerCase()}@zafira.invalid`,
    passwordKey: index ? 'HML_SEED_PASSWORD_BETA' : 'HML_SEED_PASSWORD_ALPHA',
  }))));

export function assertPasswordConfiguration(env) {
  for (const key of ['HML_SEED_PASSWORD_ALPHA', 'HML_SEED_PASSWORD_BETA']) {
    if (typeof env[key] !== 'string' || env[key].length < 16 || env[key].length > 128 || env[key].trim() !== env[key]) refuse('PASSWORD_CONFIGURATION');
  }
  if (env.HML_SEED_PASSWORD_ALPHA === env.HML_SEED_PASSWORD_BETA) refuse('PASSWORD_SEPARATION');
}

// Called only inside the guarded transaction. No delete, truncate or global update.
// Preflight identities BEFORE any upsert, so a reused ID/email never overwrites a foreign record.
export async function seedCoreOrganizations(tx, env) {
  assertPasswordConfiguration(env);
  const orgs = await tx.organization.findMany({ where: { OR: [
    { id: { in: ORGANIZATIONS.map((o) => o.id) } }, { slug: { in: ORGANIZATIONS.map((o) => o.slug) } },
  ] } });
  for (const row of orgs) {
    if (!ORGANIZATIONS.some((o) => o.id === row.id && o.slug === row.slug && o.name === row.name)) refuse('ORGANIZATION_COLLISION');
  }
  const users = await tx.user.findMany({ where: { OR: [
    { id: { in: PEOPLE.map((p) => p.id) } }, { email: { in: PEOPLE.map((p) => p.email) } },
  ] } });
  for (const row of users) {
    const person = PEOPLE.find((p) => p.id === row.id && p.email === row.email && p.name === row.name);
    if (!person || row.status !== 'ACTIVE' || !row.passwordHash?.startsWith('$argon2id$')) refuse('USER_COLLISION');
    if (!await argon2.verify(row.passwordHash, env[person.passwordKey])) refuse('PASSWORD_MISMATCH');
  }
  const members = await tx.organizationMember.findMany({ where: { OR: [
    { id: { in: PEOPLE.map((p) => p.membershipId) } },
    { organizationId: { in: ORGANIZATIONS.map((o) => o.id) } }, { userId: { in: PEOPLE.map((p) => p.id) } },
  ] } });
  for (const row of members) {
    if (row.status !== 'ACTIVE' || !PEOPLE.some((p) => p.membershipId === row.id && p.id === row.userId && p.organizationId === row.organizationId && p.role === row.role)) refuse('MEMBERSHIP_COLLISION');
  }
  const hashes = new Map();
  for (const person of PEOPLE) {
    if (!users.some((u) => u.id === person.id) && !hashes.has(person.passwordKey)) {
      hashes.set(person.passwordKey, await argon2.hash(env[person.passwordKey], { type: argon2.argon2id }));
    }
  }
  for (const org of ORGANIZATIONS) {
    await tx.organization.upsert({ where: { id: org.id }, update: {}, create: { ...org } });
  }
  for (const person of PEOPLE) {
    const passwordHash = users.find((u) => u.id === person.id)?.passwordHash || hashes.get(person.passwordKey);
    await tx.user.upsert({ where: { id: person.id }, update: {}, create: {
      id: person.id, email: person.email, name: person.name, passwordHash, status: 'ACTIVE',
    } });
    await tx.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: person.organizationId, userId: person.id } }, update: {},
      create: { id: person.membershipId, organizationId: person.organizationId, userId: person.id, role: person.role, status: 'ACTIVE' },
    });
  }
  return { organizations: ORGANIZATIONS.length, users: PEOPLE.length, memberships: PEOPLE.length };
}
