# 10 — «Что подарили» → зал славы: «Дошло», раскрытие, ручное управление

**What to build:** После даты праздника (или по кнопке «праздник прошёл»)
хозяйка открывает «что подарили»: список забронированных вещей, отметка
«Дошло» переводит вещь в «люблю», отправляет в зал славы и раскрывает имя
дарителя — ровно один раз. Плюс ручные операции: «уже моё» (WANT→LOVE без
дарителя) и добавить/убрать вещь «люблю» из витрины зала славы.

**Blocked by:** 09.

**Status:** done

- [x] occasion.close (worker, раз в час): после occasionDate создаёт OccasionSummary; кнопка «праздник прошёл» делает то же вручную (и без даты)
- [x] Экран «что подарили» (турн 21a): вещи с активными бронями на момент праздника; «Дошло» отмечает хозяйка, не даритель
- [x] receiveGift(itemId) — одна транзакция: LOVE + receivedAt + giverName из брони + inHall + закрытие брони + Connection(origin gift:) + раскрытие только в рамках OccasionSummary.revealedAt (второй раз имена не раскрываются); тест атомарности
- [x] «Не дошло/осталось» — вещи остаются WANT до следующего повода, чистить не надо
- [x] selfFulfill(itemId): WANT→LOVE «уже моё» без дарителя/раскрытий/связи; LOVE→WANT не существует (тест)
- [x] Зал славы: витрина вещей LOVE с inHall (фото + CSS-вращение как в макете, БЕЗ three.js); toggleHall туда/обратно только для LOVE
- [x] Письмо хозяйке «открой „что подарили"» ставится в очередь mail при закрытии праздника (шаблон — тикет 12)

## Comments

- Сделано. Сервис `src/server/services/occasions.ts` (новый):
  - `closeOccasion(roomId, {manual?})` — дата итога: наступившая occasionDate
    (итог ПРАЗДНИКА, не клика — ручной запуск при прошедшей дате пишет ту же
    дату, и автозакрытие потом не плодит дубль); без даты/дата впереди —
    manual закрывает «сегодня» (now), автозапуск возвращает null.
    Идемпотентность — «summary этой даты» с точностью до UTC-суток: повтор
    (в т.ч. ручной поверх автоматического) возвращает существующий summary и
    НЕ ставит второе письмо. NB: unique-констрейнта на (roomId,date) в схеме
    нет — гонка cron+клик теоретически может дать дубль, принято (rare, MVP).
  - `getOccasionView(userId)` — ЕДИНСТВЕННЫЙ канал имён. БЕЗ summary не
    отдаёт о бронях ВООБЩЕ ничего повещного (ни имён, ни title/id занятых
    вещей — инвариант №1 живёт до самого раскрытия), только unclaimedCount
    (WANT без брони, спрятанные не считаются). С summary — pending-строки
    всех живых броней С именами (QUIET и SIGNED — на этом экране раскрываются
    все, README турн 21) + received-строки «Дошло» этого праздника
    (state=LOVE, giverName≠null, receivedAt≥summary.createdAt — selfFulfill
    и ручные «люблю» прошлых лет не подмешиваются). revealedAt проставляется
    при ПЕРВОМ открытии (updateMany с guard revealedAt=null) и больше никогда.
  - `receiveGift(userId, itemId)` — интерактивная транзакция: ownership
    fil'trom в запросе → guard-updateMany `{id, state:"WANT"}` (двойной клик
    вторым вызовом ловит count=0 → NOT_WANT, giverName не затирается) →
    state=LOVE/receivedAt/giverName из брони (или null)/inHall=true →
    tx.booking.deleteMany → Connection (см. контракт для 11). ТРЕБУЕТ
    существующего summary комнаты (NO_SUMMARY) — раскрытие не существует вне
    «что подарили». Порядок аргументов (userId, itemId) — конвенция items.ts.
  - `occasionBannerVisible(userId)` — голый boolean для тихой строки в /room:
    (дата прошла и не закрыта) ИЛИ (summary есть и живые брони остались);
    будущая occasionDate глушит баннер — комната молчит между праздниками.
- `src/server/services/items.ts` (дополнение): `selfFulfill(userId,itemId)` —
  guard-updateMany WANT→LOVE (receivedAt=now, giverName=null, inHall=false),
  затем releaseBookingForItem (одиночное снятие вне транзакций — контракт 09;
  порядок «переход → снятие», чтобы гонка не сняла бронь без перехода);
  `toggleHall(userId,itemId,on)` — только LOVE (NOT_LOVE), on сбрасывает
  hiddenFromHall; `listHallItems(roomId)` — ровно два фильтра поверх LOVE:
  inHall && !hiddenFromHall (hidden хозяйке в её же зале отдаётся), сортировка
  receivedAt desc (без даты — в конец). ItemMutationError расширен кодами
  NOT_WANT|NOT_LOVE. LOVE→WANT не существует: ни одна функция не пишет
  state=WANT существующей вещи — закрыто тестом (скан экспортов + поведение).
- Worker: `src/worker/occasion-close.ts` — чистая processOccasionClose(now):
  кандидаты ТОЛЬКО «occasionDate < now и нет summary этой даты (UTC-сутки)»,
  падение одной комнаты не роняет тик (failed[]). Регистрация в
  src/worker/index.ts: очередь `occasion.close`, upsertJobScheduler
  «occasion-close-hourly», cron `0 * * * *`.
- `src/server/queues.ts`: OCCASION_CLOSE_QUEUE_NAME + не бросающий
  `enqueueOccasionOwnerMail` (джоба `occasion-owner` в очереди mail).
- UI:
  - `/room/occasion` (src/app/room/occasion/{page,occasion-client,actions}) —
    турн 21a: оверлайн «{дата} · праздник прошёл», «Тебе подарили N вещей»,
    hint-плашка, строки received («{имя} · уже в зале славы», галочка,
    «Смотреть»→зал) и pending («Подарил(а) {имя}» + кнопка «Дошло»), блок
    «Осталось незабранным · N» с текстом про следующий повод; пустые
    состояния; при отсутствии summary — кнопка «Праздник прошёл» (полоса
    света), работает без даты.
  - `/room` — ссылка «Зал славы» в шапке рядом с настройками; тихая
    строка-ссылка «Праздник прошёл — открой «что подарили»» по
    occasionBannerVisible.
  - `/room/hall` (src/app/room/hall/{page,hall-showcase,hall.module.css}) —
    hero на refs/c-hall.jpg с виньеткой, витрина LOVE-вещей: фото с omSpin
    ровно по макету (9s ease-in-out, rotateY ±16°, origin 50% 62%,
    prefers-reduced-motion глушит; three.js НЕТ), подпись «Подарен в {год} ·
    {имя}» / «уже моё», «Убрать из витрины» (toggleHall off). Вещь без фото —
    серая заливка БЕЗ пунктира (инвариант №3). Цен в зале нет ни у кого.
  - Меню плитки хозяйки (owner-zone-grid, сосед с 13): у WANT — «Уже моё» с
    двухшаговым подтверждением (переход необратим), у LOVE — «В зал славы /
    Убрать из зала»; акцент — у переходов, «Спрятать»/«Удалить» приглушены.
- messages: ns Occasion (19 ключей) и Hall (11) в ru/en; Room.hallLink,
  Room.occasionBanner; Settings.itemAlreadyMine*/itemHall* (метки меню — там
  же, где остальные пункты меню плитки).
- Тесты: tests/occasions.test.ts (19) + tests/hall.test.ts (2), реальная БД,
  очереди замоканы. Покрыто: идемпотентность closeOccasion (одно письмо, и
  ручной-поверх-авто), manual без даты/с будущей датой; getOccasionView без
  summary — regex по JSON (ни guestName/mode/имён/почт/title/id занятых);
  revealedAt один раз; receiveGift happy/FOLLOW/аноним/чужая/повтор;
  АТОМАРНОСТЬ настоящим сбоем в середине транзакции (битый guestUserId →
  FK-ошибка на connection.create → откат item+booking); существующая связь
  не перезаписывается; processOccasionClose находит только просроченные без
  summary, повторный тик — no-op; selfFulfill (снимает бронь, без раскрытия
  имени, отказ на LOVE); toggleHall только LOVE + сброс hiddenFromHall;
  LOVE→WANT невозможен (скан поверхности сервисов + поведение); hall-выборка
  (не отдаёт hiddenFromHall/не-inHall/WANT, отдаёт hidden хозяйке, порядок).
  Всего в репо 348/348 зелёные (318 базовых + 21 моих + 9 GDPR тикета 14).
- **Тикету 11 (контракт Connection):** receiveGift создаёт МИНИМУМ —
  `{aUserId: хозяйка (получатель), bUserId: гость (даритель), kind: MUTUAL
  если у гостя есть Room, иначе FOLLOW, origin: "gift:{itemId}", history:
  null}` и ТОЛЬКО если у брони есть guestUserId ≠ хозяйка; существующая пара
  (aUserId,bUserId) НЕ трогается (ни kind, ни origin). Расширять в 11:
  history («дарила тебе N раз»), апгрейд VIEWED→gift-связи, дедуп зеркальной
  пары (b,a), «остаться на связи» для гостя, простановка booking.guestUserId
  при бронировании залогиненным гостем (сейчас поле никто не пишет — bookItem
  его не принимает).
- **Тикету 12 (контракт mail):** очередь `mail`, имя джобы `occasion-owner`,
  payload `{userId, email, roomId}` (интерфейс OccasionOwnerMailJobData в
  src/server/queues.ts), attempts 3 / exp backoff 3s. Ставится ТОЛЬКО при
  created=true (повторное закрытие письмо не дублирует). Обработчик в воркере
  сейчас — общий консольный лог очереди mail: шаблон и отправка — 12.
