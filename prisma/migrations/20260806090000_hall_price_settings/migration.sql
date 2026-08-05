-- Зал славы показывает стоимость по настройке хозяйки (тикет 35, ADR-0004,
-- доска — турн 12d). Миграция АДДИТИВНАЯ: четыре новые колонки Room с
-- дефолтами, ничего не удаляется и не переименовывается.
--
-- Дефолты:
-- - hallPriceVisibility = FRIENDS — так требует ADR-0004 («по умолчанию
--   только друзьям», не «всем»). В Phase 1 связей ещё нет, поэтому FRIENDS
--   для гостя читается закрыто (src/server/dto/hall.ts) — существующие
--   комнаты после миграции не начинают показывать цены никому новому;
-- - hallTotalShown / hallGiverShown = true — так нарисовано на доске;
--   сумма гостю всё равно не шире, чем сама настройка видимости цены;
-- - hallRoundPrices = false — на доске тумблер выключен.
--
-- Скрытие цены у ОТДЕЛЬНОЙ вещи новой колонки не потребовало: у вещи уже
-- есть Item.priceVisibility, он переживает переход «хочу → люблю», и зал
-- читает его тем же правилом, что комната (ME/NONE = цена скрыта).

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "hallGiverShown" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hallPriceVisibility" "PriceVisibility" NOT NULL DEFAULT 'FRIENDS',
ADD COLUMN     "hallRoundPrices" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hallTotalShown" BOOLEAN NOT NULL DEFAULT true;
