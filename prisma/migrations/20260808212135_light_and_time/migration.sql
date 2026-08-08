-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "lightColor" TEXT NOT NULL DEFAULT 'warm',
ADD COLUMN     "timeOfDay" TEXT NOT NULL DEFAULT 'day';
