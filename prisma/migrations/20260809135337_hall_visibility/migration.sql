-- CreateEnum
CREATE TYPE "HallVisibility" AS ENUM ('ALL', 'MUTUAL', 'NONE');

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "hallVisibility" "HallVisibility" NOT NULL DEFAULT 'ALL';
