-- F6-IMP.7B - Operacao de Entregas (DEC-F6-002)
-- 1) Alinha os enums do banco aos nomes do contrato @zafira/contracts (RENAME VALUE preserva os dados).
-- 2) Cria a peca de entrega com etapas PRODUCED -> APPROVED -> DELIVERED (ou CANCELLED).
-- Ensaiar somente em base descartavel antes de qualquer ambiente real.

-- AlterEnum: DeliverablePlanStatus
ALTER TYPE "DeliverablePlanStatus" RENAME VALUE 'PLANNING' TO 'DRAFT';
ALTER TYPE "DeliverablePlanStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- AlterEnum: DeliverableEventType
ALTER TYPE "DeliverableEventType" RENAME VALUE 'ITEM_CREATED' TO 'ITEM_ADDED';
ALTER TYPE "DeliverableEventType" RENAME VALUE 'ITEM_CANCELLED' TO 'ITEM_REMOVED';
ALTER TYPE "DeliverableEventType" RENAME VALUE 'PERIOD_CLOSED' TO 'PLAN_CLOSED';
ALTER TYPE "DeliverableEventType" RENAME VALUE 'PERIOD_REOPENED' TO 'PLAN_REOPENED';
ALTER TYPE "DeliverableEventType" ADD VALUE IF NOT EXISTS 'STATUS_CHANGED';
ALTER TYPE "DeliverableEventType" ADD VALUE IF NOT EXISTS 'LINK_ATTACHED';
ALTER TYPE "DeliverableEventType" ADD VALUE IF NOT EXISTS 'LINK_DETACHED';
ALTER TYPE "DeliverableEventType" ADD VALUE IF NOT EXISTS 'PIECE_ADDED';
ALTER TYPE "DeliverableEventType" ADD VALUE IF NOT EXISTS 'PIECE_ADVANCED';
ALTER TYPE "DeliverableEventType" ADD VALUE IF NOT EXISTS 'PIECE_REVERTED';
ALTER TYPE "DeliverableEventType" ADD VALUE IF NOT EXISTS 'PIECE_CANCELLED';

-- CreateEnum
CREATE TYPE "DeliverablePieceStage" AS ENUM ('PRODUCED', 'APPROVED', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "deliverable_pieces" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT,
    "stage" "DeliverablePieceStage" NOT NULL DEFAULT 'PRODUCED',
    "url" TEXT,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "producedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverable_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverable_pieces_organizationId_idx" ON "deliverable_pieces"("organizationId");
CREATE INDEX "deliverable_pieces_itemId_idx" ON "deliverable_pieces"("itemId");
CREATE INDEX "deliverable_pieces_stage_idx" ON "deliverable_pieces"("stage");
CREATE UNIQUE INDEX "deliverable_pieces_organizationId_id_key" ON "deliverable_pieces"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "deliverable_pieces" ADD CONSTRAINT "deliverable_pieces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_pieces" ADD CONSTRAINT "deliverable_pieces_organizationId_itemId_fkey" FOREIGN KEY ("organizationId", "itemId") REFERENCES "deliverable_items"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverable_pieces" ADD CONSTRAINT "deliverable_pieces_producedByUserId_fkey" FOREIGN KEY ("producedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deliverable_pieces" ADD CONSTRAINT "deliverable_pieces_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deliverable_pieces" ADD CONSTRAINT "deliverable_pieces_deliveredByUserId_fkey" FOREIGN KEY ("deliveredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
