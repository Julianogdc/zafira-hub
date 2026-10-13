-- CreateEnum
CREATE TYPE "DeliverablePlanStatus" AS ENUM ('PLANNING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "DeliverableItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliverableLinkType" AS ENUM ('ASANA_TASK', 'CONTENT_ITEM', 'FILE_URL', 'EXTERNAL_URL');

-- CreateEnum
CREATE TYPE "DeliverableEventType" AS ENUM ('PLAN_CREATED', 'TARGET_ADJUSTED', 'ITEM_CREATED', 'ITEM_DELIVERED', 'ITEM_CANCELLED', 'PERIOD_CLOSED', 'PERIOD_REOPENED');

-- CreateTable
CREATE TABLE "deliverable_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "DeliverablePlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverable_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unidade',
    "targetQuantity" INTEGER NOT NULL DEFAULT 1,
    "deliveredQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" "DeliverableItemStatus" NOT NULL DEFAULT 'PENDING',
    "isExtra" BOOLEAN NOT NULL DEFAULT false,
    "expectedDeliveryDate" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverable_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "DeliverableLinkType" NOT NULL,
    "title" TEXT,
    "externalId" TEXT,
    "targetUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverable_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT,
    "itemId" TEXT,
    "eventType" "DeliverableEventType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultItems" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverable_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverable_plans_organizationId_idx" ON "deliverable_plans"("organizationId");
CREATE INDEX "deliverable_plans_clientId_idx" ON "deliverable_plans"("clientId");
CREATE INDEX "deliverable_plans_period_idx" ON "deliverable_plans"("period");
CREATE INDEX "deliverable_plans_status_idx" ON "deliverable_plans"("status");
CREATE UNIQUE INDEX "deliverable_plans_organizationId_id_key" ON "deliverable_plans"("organizationId", "id");
CREATE UNIQUE INDEX "deliverable_plans_organizationId_clientId_period_key" ON "deliverable_plans"("organizationId", "clientId", "period");

-- CreateIndex
CREATE INDEX "deliverable_items_organizationId_idx" ON "deliverable_items"("organizationId");
CREATE INDEX "deliverable_items_planId_idx" ON "deliverable_items"("planId");
CREATE INDEX "deliverable_items_status_idx" ON "deliverable_items"("status");
CREATE INDEX "deliverable_items_type_idx" ON "deliverable_items"("type");
CREATE UNIQUE INDEX "deliverable_items_organizationId_id_key" ON "deliverable_items"("organizationId", "id");

-- CreateIndex
CREATE INDEX "deliverable_links_organizationId_idx" ON "deliverable_links"("organizationId");
CREATE INDEX "deliverable_links_itemId_idx" ON "deliverable_links"("itemId");
CREATE INDEX "deliverable_links_type_idx" ON "deliverable_links"("type");
CREATE UNIQUE INDEX "deliverable_links_organizationId_id_key" ON "deliverable_links"("organizationId", "id");

-- CreateIndex
CREATE INDEX "deliverable_events_organizationId_idx" ON "deliverable_events"("organizationId");
CREATE INDEX "deliverable_events_planId_idx" ON "deliverable_events"("planId");
CREATE INDEX "deliverable_events_itemId_idx" ON "deliverable_events"("itemId");
CREATE INDEX "deliverable_events_eventType_idx" ON "deliverable_events"("eventType");
CREATE UNIQUE INDEX "deliverable_events_organizationId_id_key" ON "deliverable_events"("organizationId", "id");

-- CreateIndex
CREATE INDEX "deliverable_templates_organizationId_idx" ON "deliverable_templates"("organizationId");
CREATE UNIQUE INDEX "deliverable_templates_organizationId_id_key" ON "deliverable_templates"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "deliverable_plans" ADD CONSTRAINT "deliverable_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_plans" ADD CONSTRAINT "deliverable_plans_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_plans" ADD CONSTRAINT "deliverable_plans_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_items" ADD CONSTRAINT "deliverable_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_items" ADD CONSTRAINT "deliverable_items_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "deliverable_plans"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_items" ADD CONSTRAINT "deliverable_items_deliveredByUserId_fkey" FOREIGN KEY ("deliveredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_links" ADD CONSTRAINT "deliverable_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_links" ADD CONSTRAINT "deliverable_links_organizationId_itemId_fkey" FOREIGN KEY ("organizationId", "itemId") REFERENCES "deliverable_items"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "deliverable_plans"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_organizationId_itemId_fkey" FOREIGN KEY ("organizationId", "itemId") REFERENCES "deliverable_items"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_templates" ADD CONSTRAINT "deliverable_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
