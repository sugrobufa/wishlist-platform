-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "eventWhen" TEXT,
ADD COLUMN     "eventWhere" TEXT,
ADD COLUMN     "validUntil" TIMESTAMP(3);
