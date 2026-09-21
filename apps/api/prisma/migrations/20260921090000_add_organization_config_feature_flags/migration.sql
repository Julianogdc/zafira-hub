-- CreateTable
CREATE TABLE "organization_configs" (
    "organizationId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_configs_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "organization_feature_flags" (
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_feature_flags_pkey" PRIMARY KEY ("organizationId","key")
);

-- CreateIndex
CREATE INDEX "organization_feature_flags_organizationId_idx" ON "organization_feature_flags"("organizationId");

-- AddForeignKey
ALTER TABLE "organization_configs" ADD CONSTRAINT "organization_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_feature_flags" ADD CONSTRAINT "organization_feature_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
