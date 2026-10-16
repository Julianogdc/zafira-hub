import { pathToFileURL } from 'node:url';
import { assertSafeDatabaseTarget, assertConnectedDatabase, SyntheticSeedError } from './seed-modules/01-safety-guard.mjs';
import { assertPasswordConfiguration, seedCoreOrganizations } from './seed-modules/02-core-organizations.mjs';
import { seedTeamsAndClients } from './seed-modules/03-teams-and-clients.mjs';
import { buildDeliverableMirrorFixture, seedDeliverablesAndMirror } from './seed-modules/04-deliverables-and-mirror.mjs';

// Importing this module never connects. Prisma is loaded/constructed only AFTER validation.
async function createPrisma(databaseUrl) {
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
}

export async function runNavigableSeed({ env = process.env, createClient = createPrisma } = {}) {
  // Snapshot configuration: do not re-read mutable process.env after checking the destination.
  const config = { ...env };
  const target = assertSafeDatabaseTarget(config);
  assertPasswordConfiguration(config);
  const deliveryFixture = buildDeliverableMirrorFixture(config);
  const db = await createClient(config.DATABASE_URL);
  try {
    return await db.$transaction(async (tx) => {
      await assertConnectedDatabase(tx, target);
      const core = await seedCoreOrganizations(tx, config);
      const business = await seedTeamsAndClients(tx);
      const delivery = await seedDeliverablesAndMirror(tx, deliveryFixture);
      return { ...core, business, delivery };
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNavigableSeed().then((result) => {
    console.log(`Synthetic seed complete: ${result.organizations} organizations, ${result.users} users, ${result.business.client} clients, ${result.business.team} teams.`);
  }).catch((error) => {
    // Never print Prisma errors, connection strings, credentials or provider responses.
    console.error(error instanceof SyntheticSeedError ? error.message : 'Synthetic seed failed (details suppressed).');
    process.exitCode = 1;
  });
}
