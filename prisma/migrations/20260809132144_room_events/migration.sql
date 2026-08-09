-- CreateEnum
CREATE TYPE "RoomEventKind" AS ENUM ('ITEMS_ADDED', 'SHELF_OPENED', 'TREASURY_OPENED', 'ROOM_CHANGED', 'BECAME_MUTUAL');

-- CreateTable
CREATE TABLE "RoomEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "kind" "RoomEventKind" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomEvent_roomId_createdAt_idx" ON "RoomEvent"("roomId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
