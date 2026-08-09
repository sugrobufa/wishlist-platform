-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "consentA" BOOLEAN,
ADD COLUMN     "consentAskedAt" TIMESTAMP(3),
ADD COLUMN     "consentB" BOOLEAN;
