-- CreateTable
CREATE TABLE "asana_webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceGid" TEXT NOT NULL,
    "webhookGid" TEXT,
    "target" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asana_webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asana_webhook_subscriptions_organizationId_resourceGid_key" ON "asana_webhook_subscriptions"("organizationId", "resourceGid");

-- CreateIndex
CREATE INDEX "asana_webhook_subscriptions_resourceGid_idx" ON "asana_webhook_subscriptions"("resourceGid");

-- CreateIndex
CREATE INDEX "asana_webhook_subscriptions_webhookGid_idx" ON "asana_webhook_subscriptions"("webhookGid");

-- AddForeignKey
ALTER TABLE "asana_webhook_subscriptions" ADD CONSTRAINT "asana_webhook_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
