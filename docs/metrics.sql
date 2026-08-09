-- ============================================================================
-- Метрики успеха MVP (PRD §11) — готовые SQL-запросы по прод-БД (PostgreSQL).
--
-- Как запускать (dev): docker compose exec -T postgres psql -U wishlist -d wishlist -f docs/metrics.sql
-- Или по одному запросу из psql / BI-инструмента. Все запросы только читают.
--
-- Общие оговорки Phase 1 (честно, чтобы не обмануться цифрами):
--  1. Событийного лога нет: Booking-строки ЖИВЫЕ (снятая бронь удаляется,
--     «Дошло» закрывает бронь и переносит факт в Item.giverName/receivedAt).
--     Где нужна история — считаем по следам (receivedAt/giverName), это
--     написано у каждого запроса. Полноценные события — PostHog в проде.
--  2. Анонимные визиты гостей нигде не хранятся (тихий продукт, инвариант №7):
--     «комнату открыл гость» считаем по следам действий гостей — связи VIEWED
--     (визит залогиненного гостя) и брони. Это НИЖНЯЯ оценка шаринга.
--  3. Демо-призраки в БД не пишутся — фильтровать их из Item не нужно.
--  4. Колонки Item.state больше НЕТ (тикет 124, 09.08.2026): состояния «хочу»
--     и «люблю» отменены, различие живёт в месте — Item.inHall (false —
--     комната, true — сокровищница). Запросы ниже переписаны под неё; правило
--     переноса прежних данных было «LOVE → inHall = true».
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. АКТИВАЦИЯ: доля пользователей, добавивших ≥3 вещи
--    за первые 7 дней после регистрации.
--    Учитываем только «созревшие» аккаунты (регистрация ≥7 дней назад) —
--    у свежих окно ещё не закрылось, и они бы занижали метрику.
-- ----------------------------------------------------------------------------
WITH mature_users AS (
  SELECT u."id", u."createdAt"
  FROM "User" u
  WHERE u."createdAt" <= now() - interval '7 days'
),
first_week_items AS (
  SELECT r."userId", count(i."id") AS items_7d
  FROM mature_users u
  JOIN "Room" r ON r."userId" = u."id"
  LEFT JOIN "Item" i
    ON i."roomId" = r."id"
   AND i."createdAt" <= u."createdAt" + interval '7 days'
  GROUP BY r."userId"
)
SELECT
  count(*)                                          AS mature_users,        -- все созревшие (включая не дошедших до комнаты)
  count(*) FILTER (WHERE f.items_7d >= 3)           AS activated,
  round(100.0 * count(*) FILTER (WHERE f.items_7d >= 3) / nullif(count(*), 0), 1)
                                                    AS activation_pct
FROM mature_users u
LEFT JOIN first_week_items f ON f."userId" = u."id";


-- ----------------------------------------------------------------------------
-- 2. БАЛАНС МЕСТ: доля вещей в сокровищнице среди всех вещей.
--    Здоровый коридор ~30–50%. Уехало на витрину почти всё — гостю нечего
--    дарить; на витрине пусто — цикл не замкнулся ни разу.
--    Плюс распределение по комнатам — медиана честнее среднего.
-- ----------------------------------------------------------------------------
SELECT
  count(*)                                        AS items_total,
  count(*) FILTER (WHERE i."inHall")              AS hall_items,
  round(100.0 * count(*) FILTER (WHERE i."inHall") / nullif(count(*), 0), 1)
                                                  AS hall_share_pct
FROM "Item" i;

-- Та же доля по комнатам (только комнаты с ≥3 вещами — иначе шум):
-- медиана по комнатам устойчивее к комнатам с сотней желаний.
WITH per_room AS (
  SELECT i."roomId",
         count(*) AS items_total,
         round(100.0 * count(*) FILTER (WHERE i."inHall") / count(*), 1) AS hall_pct
  FROM "Item" i
  GROUP BY i."roomId"
  HAVING count(*) >= 3
)
SELECT
  count(*)                                                      AS rooms_counted,
  round(avg(hall_pct), 1)                                       AS hall_pct_avg,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY hall_pct)::numeric(5,1) AS hall_pct_median
FROM per_room;


-- ----------------------------------------------------------------------------
-- 3. ШАРИНГ: доля комнат, которые открыл ≥1 гость.
--    Прямого счётчика визитов нет (оговорка 2 в шапке) — прокси по следам:
--    (а) связь VIEWED/любая у хозяйки (визит залогиненного гостя создаёт
--        VIEWED; подарок поднимает её до FOLLOW/MUTUAL — считаем все);
--    (б) живая бронь на вещи комнаты (гость точно заходил);
--    (в) след прошлой брони: вещь В СОКРОВИЩНИЦЕ с заполненным giverName
--        («Дошло»).
--    Это нижняя оценка: комната, которую только смотрели анонимы, не видна.
-- ----------------------------------------------------------------------------
SELECT
  count(*) AS rooms_total,
  count(*) FILTER (WHERE opened.room_id IS NOT NULL) AS rooms_opened_by_guest,
  round(100.0 * count(*) FILTER (WHERE opened.room_id IS NOT NULL) / nullif(count(*), 0), 1)
    AS shared_pct
FROM "Room" r
LEFT JOIN LATERAL (
  SELECT r."id" AS room_id
  WHERE EXISTS (SELECT 1 FROM "Connection" c WHERE c."aUserId" = r."userId")
     OR EXISTS (SELECT 1 FROM "Booking" b JOIN "Item" i ON i."id" = b."itemId"
                WHERE i."roomId" = r."id")
     OR EXISTS (SELECT 1 FROM "Item" i
                WHERE i."roomId" = r."id" AND i."inHall" AND i."giverName" IS NOT NULL)
) opened ON true;


-- ----------------------------------------------------------------------------
-- 4. ЯДРО: доля комнат с ≥1 тихой бронью за последние 30 дней.
--    Booking хранит только живые брони (оговорка 1) — чтобы не терять брони,
--    уже закрытые «Дошло», добавляем след receiveGift: вещь в сокровищнице с
--    giverName и receivedAt в окне. Отменённые гостями брони не видны — нижняя
--    оценка. Событийный лог для точной версии — кандидат Phase 2.
-- ----------------------------------------------------------------------------
SELECT
  count(*) AS rooms_total,
  count(*) FILTER (WHERE booked.room_id IS NOT NULL) AS rooms_with_booking_30d,
  round(100.0 * count(*) FILTER (WHERE booked.room_id IS NOT NULL) / nullif(count(*), 0), 1)
    AS core_pct
FROM "Room" r
LEFT JOIN LATERAL (
  SELECT r."id" AS room_id
  WHERE EXISTS (SELECT 1 FROM "Booking" b JOIN "Item" i ON i."id" = b."itemId"
                WHERE i."roomId" = r."id" AND b."createdAt" >= now() - interval '30 days')
     OR EXISTS (SELECT 1 FROM "Item" i
                WHERE i."roomId" = r."id" AND i."inHall"
                  AND i."giverName" IS NOT NULL
                  AND i."receivedAt" >= now() - interval '30 days')
) booked ON true;


-- ----------------------------------------------------------------------------
-- 5а. ЗАМЫКАНИЕ ЦИКЛА: доля праздников с ≥1 отмеченным «Дошло».
--     Праздник = OccasionSummary. «Дошло» этого праздника — вещь в
--     сокровищнице с giverName, чей receivedAt ≥ createdAt summary (receiveGift существует
--     только после закрытия праздника — контракт тикета 10). Для комнат с
--     несколькими праздниками окно режем следующим summary, чтобы подарки
--     позднего праздника не засчитались раннему.
-- ----------------------------------------------------------------------------
WITH summaries AS (
  SELECT s."id", s."roomId", s."createdAt",
         lead(s."createdAt") OVER (PARTITION BY s."roomId" ORDER BY s."createdAt")
           AS next_summary_at
  FROM "OccasionSummary" s
)
SELECT
  count(*) AS occasions_total,
  count(*) FILTER (WHERE closed.summary_id IS NOT NULL) AS occasions_with_received,
  round(100.0 * count(*) FILTER (WHERE closed.summary_id IS NOT NULL) / nullif(count(*), 0), 1)
    AS cycle_closed_pct
FROM summaries s
LEFT JOIN LATERAL (
  SELECT s."id" AS summary_id
  WHERE EXISTS (
    SELECT 1 FROM "Item" i
    WHERE i."roomId" = s."roomId"
      AND i."inHall"
      AND i."giverName" IS NOT NULL
      AND i."receivedAt" >= s."createdAt"
      AND (s.next_summary_at IS NULL OR i."receivedAt" < s.next_summary_at)
  )
) closed ON true;

-- 5б. СВЯЗИ НА ПОЛЬЗОВАТЕЛЯ: строка Connection соединяет двоих (обе
--     ориентации в одной строке — контракт тикета 11), поэтому «связей на
--     пользователя» = 2×строк / пользователей. Плюс разрез по видам.
SELECT
  (SELECT count(*) FROM "User")                                   AS users_total,
  count(*)                                                        AS connection_rows,
  round(2.0 * count(*) / nullif((SELECT count(*) FROM "User"), 0), 2)
                                                                  AS connections_per_user,
  count(*) FILTER (WHERE c."kind" = 'MUTUAL')                     AS mutual,
  count(*) FILTER (WHERE c."kind" = 'FOLLOW')                     AS follow,
  count(*) FILTER (WHERE c."kind" = 'VIEWED')                     AS viewed
FROM "Connection" c;


-- ----------------------------------------------------------------------------
-- 6. КАЧЕСТВО ПАРСЕРА: доля вещей, рождённых из ссылки (source = 'URL'),
--    и насколько парсер довёл их «до кондиции» (есть фото и цена без рук).
--
--    ОГРАНИЧЕНИЕ Phase 1 (честно): «доля ссылок без ручной правки» из PRD §11
--    напрямую НЕ считается — правки полей после парсинга не трекаются (нет
--    ни флага «поле правлено», ни события). Прокси ниже: у URL-вещи есть
--    photoKey (фото приехало ingest'ом или руками — не различимо) и цена.
--    Что добавить в Phase 2: флаг parsedUntouched при сохранении карточки
--    (форма ЗНАЕТ, какие поля правились после «Заполнить по ссылке») —
--    дешевле всего писать его в Item при создании; либо событие в PostHog.
-- ----------------------------------------------------------------------------
SELECT
  count(*)                                              AS items_total,
  count(*) FILTER (WHERE i."source" = 'URL')            AS url_items,
  round(100.0 * count(*) FILTER (WHERE i."source" = 'URL') / nullif(count(*), 0), 1)
                                                        AS url_share_pct,
  -- у URL-вещей: сколько с фото (ingest дотянулся или хозяйка доложила)
  round(100.0 * count(*) FILTER (WHERE i."source" = 'URL' AND i."photoKey" IS NOT NULL)
        / nullif(count(*) FILTER (WHERE i."source" = 'URL'), 0), 1)
                                                        AS url_with_photo_pct,
  -- у URL-вещей КОМНАТЫ: сколько с ценой (обязательна в форме, но парсер мог
  -- её предзаполнить — без трекинга правок это верхняя граница его заслуг).
  -- Вещи витрины исключены: цены у них может не быть вовсе, и они занижали бы
  -- оценку парсера ни за что.
  round(100.0 * count(*) FILTER (WHERE i."source" = 'URL' AND NOT i."inHall"
                                   AND i."price" IS NOT NULL)
        / nullif(count(*) FILTER (WHERE i."source" = 'URL' AND NOT i."inHall"), 0), 1)
                                                        AS url_room_with_price_pct
FROM "Item" i;

-- Разрез по магазинам: где парсер реально живёт (топ-15 доменов URL-вещей).
SELECT i."domain", count(*) AS items
FROM "Item" i
WHERE i."source" = 'URL' AND i."domain" IS NOT NULL
GROUP BY i."domain"
ORDER BY items DESC, i."domain"
LIMIT 15;
