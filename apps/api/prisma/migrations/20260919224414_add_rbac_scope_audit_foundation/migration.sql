-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" "Role" NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","permissionCode")
);

-- CreateTable
CREATE TABLE "organization_member_permissions" (
    "organizationId" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_member_permissions_pkey" PRIMARY KEY ("organizationMemberId","permissionCode")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("teamId","organizationMemberId")
);

-- CreateTable
CREATE TABLE "user_client_assignments" (
    "organizationId" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_client_assignments_pkey" PRIMARY KEY ("organizationMemberId","clientId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_permissions_permissionCode_idx" ON "role_permissions"("permissionCode");

-- CreateIndex
CREATE INDEX "organization_member_permissions_organizationId_idx" ON "organization_member_permissions"("organizationId");

-- CreateIndex
CREATE INDEX "organization_member_permissions_permissionCode_idx" ON "organization_member_permissions"("permissionCode");

-- CreateIndex
CREATE INDEX "teams_organizationId_idx" ON "teams"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organizationId_name_key" ON "teams"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organizationId_id_key" ON "teams"("organizationId", "id");

-- CreateIndex
CREATE INDEX "team_members_organizationId_idx" ON "team_members"("organizationId");

-- CreateIndex
CREATE INDEX "team_members_organizationMemberId_idx" ON "team_members"("organizationMemberId");

-- CreateIndex
CREATE INDEX "user_client_assignments_organizationId_idx" ON "user_client_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "user_client_assignments_clientId_idx" ON "user_client_assignments"("clientId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_idx" ON "audit_logs"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_idx" ON "audit_logs"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_id_key" ON "organization_members"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organizationId_id_key" ON "clients"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_member_permissions" ADD CONSTRAINT "organization_member_permissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_member_permissions" ADD CONSTRAINT "organization_member_permissions_organizationId_organizatio_fkey" FOREIGN KEY ("organizationId", "organizationMemberId") REFERENCES "organization_members"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_member_permissions" ADD CONSTRAINT "organization_member_permissions_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organizationId_teamId_fkey" FOREIGN KEY ("organizationId", "teamId") REFERENCES "teams"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organizationId_organizationMemberId_fkey" FOREIGN KEY ("organizationId", "organizationMemberId") REFERENCES "organization_members"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_organizationId_organizationMemberI_fkey" FOREIGN KEY ("organizationId", "organizationMemberId") REFERENCES "organization_members"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

