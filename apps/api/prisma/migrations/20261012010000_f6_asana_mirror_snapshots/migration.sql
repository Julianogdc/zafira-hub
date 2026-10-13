-- F6-IMP.8 - Espelho e snapshots do Asana (DEC-F6-003)
-- Espelho de projetos/tarefas, registro de mudancas, foto diaria por projeto e trava do agendador.
-- Somente leitura do Asana. Ensaiar somente em base descartavel antes de qualquer ambiente real.

-- CreateTable
CREATE TABLE "asana_project_mirrors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectGid" TEXT NOT NULL,
    "name" TEXT,
    "baselineAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asana_project_mirrors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asana_task_mirrors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectGid" TEXT NOT NULL,
    "taskGid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "dueOn" TEXT,
    "dueAt" TEXT,
    "assigneeGid" TEXT,
    "assigneeName" TEXT,
    "sectionGid" TEXT,
    "sectionName" TEXT,
    "permalinkUrl" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asana_task_mirrors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asana_task_changes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectGid" TEXT NOT NULL,
    "taskGid" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT,

    CONSTRAINT "asana_task_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asana_project_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectGid" TEXT NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "totalTasks" INTEGER NOT NULL,
    "completedTasks" INTEGER NOT NULL,
    "pendingTasks" INTEGER NOT NULL,
    "overdueTasks" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT,

    CONSTRAINT "asana_project_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduler_leases" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "asana_project_mirrors_organizationId_idx" ON "asana_project_mirrors"("organizationId");

-- CreateIndex
CREATE INDEX "asana_project_mirrors_projectGid_idx" ON "asana_project_mirrors"("projectGid");

-- CreateIndex
CREATE UNIQUE INDEX "asana_project_mirrors_organizationId_clientId_projectGid_key" ON "asana_project_mirrors"("organizationId", "clientId", "projectGid");

-- CreateIndex
CREATE INDEX "asana_task_mirrors_organizationId_idx" ON "asana_task_mirrors"("organizationId");

-- CreateIndex
CREATE INDEX "asana_task_mirrors_clientId_idx" ON "asana_task_mirrors"("clientId");

-- CreateIndex
CREATE INDEX "asana_task_mirrors_removedAt_idx" ON "asana_task_mirrors"("removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "asana_task_mirrors_organizationId_clientId_projectGid_taskG_key" ON "asana_task_mirrors"("organizationId", "clientId", "projectGid", "taskGid");

-- CreateIndex
CREATE INDEX "asana_task_changes_organizationId_clientId_detectedAt_idx" ON "asana_task_changes"("organizationId", "clientId", "detectedAt");

-- CreateIndex
CREATE INDEX "asana_task_changes_detectedAt_idx" ON "asana_task_changes"("detectedAt");

-- CreateIndex
CREATE INDEX "asana_project_snapshots_organizationId_clientId_snapshotDat_idx" ON "asana_project_snapshots"("organizationId", "clientId", "snapshotDate");

-- CreateIndex
CREATE INDEX "asana_project_snapshots_snapshotDate_idx" ON "asana_project_snapshots"("snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "asana_project_snapshots_organizationId_clientId_projectGid__key" ON "asana_project_snapshots"("organizationId", "clientId", "projectGid", "snapshotDate");


-- AddForeignKey
ALTER TABLE "asana_project_mirrors" ADD CONSTRAINT "asana_project_mirrors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_project_mirrors" ADD CONSTRAINT "asana_project_mirrors_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_task_mirrors" ADD CONSTRAINT "asana_task_mirrors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_task_mirrors" ADD CONSTRAINT "asana_task_mirrors_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_task_changes" ADD CONSTRAINT "asana_task_changes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_task_changes" ADD CONSTRAINT "asana_task_changes_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_project_snapshots" ADD CONSTRAINT "asana_project_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asana_project_snapshots" ADD CONSTRAINT "asana_project_snapshots_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "clients"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;



