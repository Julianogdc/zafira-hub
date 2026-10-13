-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressCountryCode" VARCHAR(2),
ADD COLUMN     "addressDistrict" TEXT,
ADD COLUMN     "addressLatitude" DECIMAL(9,6),
ADD COLUMN     "addressLongitude" DECIMAL(9,6),
ADD COLUMN     "addressNumber" TEXT,
ADD COLUMN     "addressPostalCode" TEXT,
ADD COLUMN     "addressState" TEXT,
ADD COLUMN     "addressStreet" TEXT;
