-- CreateTable
CREATE TABLE "RoomGoal" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalPledge" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestUserId" TEXT,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "cancelToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalPledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomGoal_roomId_key" ON "RoomGoal"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "GoalPledge_cancelToken_key" ON "GoalPledge"("cancelToken");

-- CreateIndex
CREATE INDEX "GoalPledge_goalId_idx" ON "GoalPledge"("goalId");

-- AddForeignKey
ALTER TABLE "RoomGoal" ADD CONSTRAINT "RoomGoal_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPledge" ADD CONSTRAINT "GoalPledge_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "RoomGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
