-- F7-3a - Agenda Google Calendar, SOMENTE LEITURA (DEC-F7-011/012)
-- Cria origens (calendarios monitorados), eventos minimos, vinculos locais e identidades (HMAC).
-- NENHUMA linha e inserida. Sem descricao, e-mails, links de videoconferencia ou payload bruto.
-- NAO REMOVER indices parciais, GIN, CHECKs ou gatilhos desta nem das migrations F7-1a/F7-2a.
-- Nota: o diff sugere renomear a FK organization_invitations_..._fk (divergencia anterior; fora do escopo).
-- Ensaiar somente em base descartavel antes de qualquer ambiente real.

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarEventCategory" AS ENUM ('MEETING', 'CAPTURE', 'TECHNICAL_VISIT', 'PRESENTATION', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "CalendarLinkScope" AS ENUM ('EVENT', 'SERIES');

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'GOOGLE_CALENDAR';

-- CreateTable
CREATE TABLE "calendar_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessRole" TEXT NOT NULL,
    "timeZone" TEXT,
    "color" TEXT,
    "isMonitored" BOOLEAN NOT NULL DEFAULT false,
    "defaultCategory" "CalendarEventCategory",
    "syncCursorAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "recurringEventId" TEXT,
    "originalStartDateTime" TIMESTAMP(3),
    "originalStartDate" DATE,
    "originalStartTimeZone" TEXT,
    "iCalUID" TEXT,
    "title" TEXT NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3),
    "startDate" DATE,
    "endAt" TIMESTAMP(3),
    "endDate" DATE,
    "timeZone" TEXT,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "visibility" TEXT NOT NULL DEFAULT 'default',
    "location" TEXT,
    "htmlLink" TEXT,
    "attendeeCount" INTEGER NOT NULL DEFAULT 0,
    "attendeeHashes" TEXT[],
    "googleUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingFromSourceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "CalendarLinkScope" NOT NULL,
    "eventId" TEXT,
    "sourceId" TEXT,
    "recurringEventId" TEXT,
    "clientId" TEXT,
    "asanaProjectGid" TEXT,
    "category" "CalendarEventCategory" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_member_identities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "displayHint" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_member_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_sources_organizationId_idx" ON "calendar_sources"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sources_connectionId_googleCalendarId_key" ON "calendar_sources"("connectionId", "googleCalendarId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sources_organizationId_id_key" ON "calendar_sources"("organizationId", "id");

-- CreateIndex
CREATE INDEX "calendar_events_organizationId_startAt_idx" ON "calendar_events"("organizationId", "startAt");

-- CreateIndex
CREATE INDEX "calendar_events_organizationId_startDate_idx" ON "calendar_events"("organizationId", "startDate");

-- CreateIndex
CREATE INDEX "calendar_events_organizationId_sourceId_recurringEventId_idx" ON "calendar_events"("organizationId", "sourceId", "recurringEventId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_sourceId_googleEventId_key" ON "calendar_events"("sourceId", "googleEventId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_organizationId_id_key" ON "calendar_events"("organizationId", "id");

-- CreateIndex
CREATE INDEX "calendar_event_links_organizationId_clientId_idx" ON "calendar_event_links"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "calendar_event_links_organizationId_sourceId_recurringEvent_idx" ON "calendar_event_links"("organizationId", "sourceId", "recurringEventId");

-- CreateIndex
CREATE INDEX "calendar_member_identities_organizationId_identityHash_idx" ON "calendar_member_identities"("organizationId", "identityHash");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_member_identities_organizationId_organizationMembe_key" ON "calendar_member_identities"("organizationId", "organizationMemberId", "identityHash");

-- AddForeignKey
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "calendar_sources"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_organizationId_eventId_fkey" FOREIGN KEY ("organizationId", "eventId") REFERENCES "calendar_events"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_member_identities" ADD CONSTRAINT "calendar_member_identities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_member_identities" ADD CONSTRAINT "calendar_member_identities_organizationId_organizationMemb_fkey" FOREIGN KEY ("organizationId", "organizationMemberId") REFERENCES "organization_members"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regras no banco (nao expressas pelo Prisma). NAO REMOVER: um `prisma migrate diff` futuro
-- vai listar estes objetos como diferenca em relacao ao schema.prisma.
-- ---------------------------------------------------------------------------

-- Participantes por HMAC: busca por interseccao (identidades associadas ao membro)
CREATE INDEX "calendar_events_attendee_hashes_gin" ON "calendar_events" USING GIN ("attendeeHashes");

-- Vinculo: forma por escopo; projeto do Asana (so vinculo local) exige cliente
ALTER TABLE "calendar_event_links"
  ADD CONSTRAINT "calendar_links_scope_shape" CHECK (
    ("scope" = 'EVENT' AND "eventId" IS NOT NULL AND "recurringEventId" IS NULL)
    OR ("scope" = 'SERIES' AND "eventId" IS NULL AND "recurringEventId" IS NOT NULL AND "sourceId" IS NOT NULL)
  ),
  ADD CONSTRAINT "calendar_links_project_needs_client" CHECK ("asanaProjectGid" IS NULL OR "clientId" IS NOT NULL);

-- No maximo um vinculo por ocorrencia e um por serie (idempotencia dos vinculos locais)
CREATE UNIQUE INDEX "calendar_links_one_per_event" ON "calendar_event_links"("eventId") WHERE "scope" = 'EVENT';
CREATE UNIQUE INDEX "calendar_links_one_per_series"
  ON "calendar_event_links"("organizationId", "sourceId", "recurringEventId") WHERE "scope" = 'SERIES';

-- Coerencia do evento: dia inteiro usa datas; com horario usa instantes
ALTER TABLE "calendar_events"
  ADD CONSTRAINT "calendar_events_visibility_values" CHECK ("visibility" IN ('default', 'public', 'private', 'confidential'));
