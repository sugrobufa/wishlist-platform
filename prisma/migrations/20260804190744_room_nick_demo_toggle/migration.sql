-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "demoGhostsOff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nick" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Room_nick_key" ON "Room"("nick");
