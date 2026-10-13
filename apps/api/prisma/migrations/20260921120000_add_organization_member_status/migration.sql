-- CreateEnum
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'ACTIVE';
