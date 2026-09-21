-- CreateTable
CREATE TABLE "team_client_assignments" (
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_client_assignments_pkey" PRIMARY KEY ("teamId","clientId")
);

-- CreateIndex
CREATE INDEX "team_client_assignments_organizationId_idx" ON "team_client_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "team_client_assignments_clientId_idx" ON "team_client_assignments"("clientId");

-- AddForeignKey
ALTER TABLE "team_client_assignments" ADD CONSTRAINT "team_client_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_client_assignments" ADD CONSTRAINT "team_client_assignments_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "teams"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_client_assignments" ADD CONSTRAINT "team_client_assignments_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
