-- Гонка cron+клик могла дать два OccasionSummary одной даты (NB тикета 10):
-- (roomId, date) становится уникальной, проигравший гонку ловит P2002 и
-- берёт существующий summary (closeOccasion — см. services/occasions.ts).
-- Обычный составной индекс заменяется уникальным: покрывает те же выборки.

-- DropIndex
DROP INDEX "OccasionSummary_roomId_date_idx";

-- CreateIndex
CREATE UNIQUE INDEX "OccasionSummary_roomId_date_key" ON "OccasionSummary"("roomId", "date");
