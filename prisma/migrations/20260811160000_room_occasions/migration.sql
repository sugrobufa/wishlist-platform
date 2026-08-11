-- Праздники, которых не один (тикет 198, пакет дизайна 44 → `occasions.json`).
--
-- ПОЧЕМУ. Комната знала ровно один праздник — день рождения хозяйки (тикет
-- 187). Владелец 11.08.2026: «подарки ведь могут приходить не только на др, но
-- и на новый год, гендерные праздники и пр.». Праздников стало три вида, и два
-- новых — общие даты (Новый год, 8 марта, 23 февраля) и свои поводы
-- (годовщина, новоселье) — в колонки комнаты не помещаются: их может не быть
-- вовсе, а может быть сколько угодно.
--
-- ЧТО НЕ МЕНЯЕТСЯ. День рождения остаётся колонками `birthdayDay`/
-- `birthdayMonth`/`birthdayYear` и в эту таблицу НЕ переезжает: он ровно один
-- на комнату, он единственный, о котором продукт спрашивает, и вся его
-- арифметика уже под тестом. Переносить работающее ради единообразия — работа
-- без выгоды и с риском потерять дату.
--
-- ЧТО НЕ ЗАВОДИТСЯ. Ни одной строки существующим комнатам: строка появляется
-- только после ОТВЕТА хозяйки («Показать» или «Не в этом году»). Отсутствие
-- ответа — это отсутствие строки, а не строка со значением «не спрашивали»;
-- само предложение считается на чтении, из календаря (src/server/holidays.ts).
-- Поэтому backfill'а здесь нет и быть не должно — комнаты после миграции ведут
-- себя ровно как до неё, пока человек не нажмёт.
--
-- ОБРАТИМОСТЬ полная: таблица новая, чужих колонок миграция не трогает.

CREATE TYPE "OccasionKind" AS ENUM ('COMMON', 'OWN');

CREATE TABLE "RoomOccasion" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "kind" "OccasionKind" NOT NULL,
    "key" TEXT,
    "title" TEXT,
    "day" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT true,
    "skippedYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomOccasion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomOccasion_roomId_idx" ON "RoomOccasion"("roomId");

-- Один ответ на одну общую дату. У своих поводов `key` пуст, а NULL'ы в
-- Postgres различны — своих поводов бывает сколько угодно, и уникальность им
-- не мешает.
CREATE UNIQUE INDEX "RoomOccasion_roomId_key_key" ON "RoomOccasion"("roomId", "key");

ALTER TABLE "RoomOccasion"
  ADD CONSTRAINT "RoomOccasion_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
