# 08 — Тихая бронь гостя: занять, отменить, «мои брони»

**What to build:** Гость бронирует вещь «хочу» без регистрации: имя обязательно,
email опционально, режим «тихо» или «подписаться» (SIGNED). Токен отмены в
cookie. Другие гости видят «занято» без имён. «Мои брони» — список по токенам
с отменой и отметкой «куплено». Кнопка «подарить» — бирка на нити (турн 22).

**Blocked by:** 07.

**Status:** done

- [x] POST /items/:id/book {name, email?, mode QUIET|SIGNED} → {cancelToken}; cookie гостя; бронировать можно только WANT без активной брони; демо-призраки не бронируются
- [x] «Занято» у забронированных — отдельным лёгким запросом поверх кэшированной комнаты (не в ISR-кэше)
- [x] DELETE /items/:id/book и POST …/purchased по cancelToken; бронь снимается при удалении/скрытии вещи хозяйкой *(автоснятие — зона тикетов 09/13; уникальность Booking.itemId и каскад onDelete им ничего не мешают)*
- [x] Страница «мои брони» гостя (по cookie): вещь, комната, статус, отмена
- [x] Rate limit по IP на бронь/отмену; Zod; без каких-либо уведомлений хозяйке
- [x] Кнопка «Подарить» — бирка (clip-path, поворот, имя хозяйки) ТОЛЬКО здесь

## Comments

- Сделано: полный цикл гостя. Сервис `src/server/services/bookings.ts`:
  `bookItem` (только WANT; demo-id `demo:…` → честный отказ DEMO_ITEM; hidden и
  вещь выключенной зоны → NOT_FOUND неотличимо от несуществующего id —
  инвариант №5; POOL → POOL_NOT_SUPPORTED с честным текстом; двойная бронь —
  НЕ проверка заранее, а уникальность Booking.itemId: P2002 → ALREADY_BOOKED),
  `cancelBooking`/`markPurchased(token, bool)` — только по токену (`deleteMany/
  updateMany`, count 0 → TOKEN_NOT_FOUND), `listBookingsByTokens` (allowlist-DTO
  БЕЗ ключей guestName/guestEmail вовсе — даже своих), `takenItemIds` (голые id,
  ничего больше), `takenForRoomSlug`, `findTokenForItem`, `countBookingsByTokens`
  + чистые cookie-помощники. Сервис сознательно НЕ ревалидирует кэш комнаты и
  ничего не шлёт хозяйке (инвариант №1); счётчик хозяйки — тикет 09.
- **Контракт канала «занято» (тикетам 09/15):**
  `GET /api/v1/rooms/{slug}/taken` → `200 { data: { itemIds: string[], mine:
  string[], myBookingsCount: number } }`, всегда `Cache-Control: no-store`
  (+`dynamic="force-dynamic"`); 404 на чужой слаг. `itemIds` — занятые вещи
  комнаты (только id, без имён/режимов/дат); `mine` — какие из них заняты
  запрашивающим гостем (вычисляется из ЕГО cookie, о чужих не говорит ничего);
  `myBookingsCount` — все живые брони гостя по cookie (строка «Мои брони · N»;
  cookie HTTP-only, клиентскому JS недоступна — потому счётчик едет этим же
  каналом). Клиент комнаты дергает канал ПОСЛЕ рендера (useEffect в
  GuestBookingProvider) и мержит в плитки — кэш/HTML комнаты не трогаются.
- **Контракт cookie (тикетам 09/15):** `guest_bookings` — HTTP-only, значение
  JSON-массив cancelToken'ов (48 hex каждый), `path=/`, `maxAge` год,
  `sameSite=lax`, `secure` в production; максимум 50 токенов, старейшие
  выпадают. Роуты отмены/«куплено» токен от клиента НЕ принимают — сервер сам
  находит подходящий токен вещи среди токенов cookie (`findTokenForItem`);
  отмена вычёркивает использованный токен из cookie.
- API (тонкие, `{data}|{error:{code,message}}`):
  `POST /api/v1/items/{id}/book` → 201 `{data:{cancelToken}}` + cookie
  (409 ALREADY_BOOKED/NOT_WANT, 400 DEMO_ITEM/POOL_NOT_SUPPORTED/VALIDATION,
  404 NOT_FOUND, 429 RATE_LIMITED); `DELETE …/book` → 200/404 NO_BOOKING;
  `POST …/book/purchased` `{purchased?:bool}` (пустое тело = true) → 200.
  itemId — только из URL (тело подменить не может).
- Rate limit: `src/server/rate-limit.ts` — token bucket 10/мин по IP
  (x-forwarded-for → x-real-ip → "local"), Lua в Redis (REDIS_URL) с
  graceful-фолбэком в память процесса и кулдауном 30 с; одна корзина
  `rl:v1:booking` на book+cancel+purchased. Парсерный cache.ts не тронут.
- UI: ZoneGrid/ItemTile получили ОПЦИОНАЛЬНЫЙ слот `renderItemAction`
  (обратная совместимость: без пропа ничего не меняется, /room хозяйки его не
  передаёт; тесты 03 остались зелёными без правок). Гостевые плитки собирает
  `src/app/r/[slug]/booking/guest-zone-grid.tsx`: бирка ТОЛЬКО у
  WANT && !isDemo; «занято» тихое, без имён; своя бронь — «занято тобой»
  акцентом. Бирка `gift-tag.tsx` — материал по tokens.json → button.gift
  (клип 0/50-15/0…, бумага 152°, отверстие с латунной окантовкой, нить с
  узелком, складка, «для {имя}» над надписью; rest rotate(-3deg), hover
  выравнивание за воротами hover:hover, active rotate(2deg)+translateY(3px),
  300ms easeOut, тень filter'ом; reduced-motion 120ms). Размер sheet — 218×66
  канонический (кнопка подтверждения в листе), tile — компактный ≥ hitTarget 44.
  Лист брони — портал в body (сцена — transform-контекст): имя обязательное,
  email с подсказкой «напомним за 3 дня…», радио «Тихо» / «Подписаться под
  подарком» («{имя} увидит подпись только после праздника»), успех — «Вещь
  занята. Никому не скажем», вещь помечается занятой без перезагрузки; 409 —
  честное «уже занято» + плитка гаснет в «занято».
- `/my-bookings` (`src/app/my-bookings/`): SSR по cookie (noindex), строки —
  вещь/фото/«Комната {имя}» (ссылка на /r/{slug})/режим; «Куплено» —
  переключатель, «Отменить бронь» — подтверждение в два касания; пустое
  состояние тихим текстом. Страница КОМНАТЫ по-прежнему cookie не читает —
  HTML одинаков для всех (ISR тикета 16 не заблокирован), «Мои брони · N»
  внизу комнаты появляется из канала «занято».
- messages: ns Booking и MyBookings добавлены точечными Edit в ru/en (соседние
  правки параллельного агента не задеты).
- Тесты (+35, все 246/246 зелёные): `tests/bookings.service.test.ts` (19 —
  happy/двойная P2002/LOVE/demo/POOL/hidden+зона-off/Zod; cancel/purchased по
  чужому токену; takenItemIds «ничего кроме id»; строгий allowlist «моих
  броней» и отсутствие guestName/guestEmail/чужих почт в JSON всех выдач;
  cookie-помощники и лимит 50), `tests/bookings.api.test.ts` (8 — статусы,
  Set-Cookie HttpOnly/год, вычёркивание токена, purchased-переключатель,
  канал taken: no-store + отсутствие имён + 404, rate limit 11-й → 429),
  `tests/rate-limit.test.ts` (8 — корзина/пополнение/изоляция ключей/Lua-путь/
  фолбэк с кулдауном/clientIp).
- Проверено: `npm run typecheck`, `npm run lint` — чисто; `npm test` 246/246
  (20 файлов). Живой смоук в браузере на настоящей вещи (сидовая /r/demo —
  призраки, не бронируются; комната создавалась напрямую через Prisma/SQL и
  удалена после): бирка «для Ира / Подарить» только на WANT-плитках (LOVE и
  призраки — без), клик → лист, бронь → «Вещь занята. Никому не скажем» →
  «занято тобой» без перезагрузки → «Мои брони · 1» внизу; после перезагрузки
  всё же самое из канала (cookie); канал отдаёт ровно
  `{itemIds:[…],mine:[…],myBookingsCount:1}` с no-store, cookie из JS не
  читается (HttpOnly); /my-bookings: «Куплено ✓» туда-обратно, отмена с
  подтверждением → пустое состояние; computed-стили бирки сверены с tokens.json
  (clip-path/градиент/rotate(-3deg)/drop-shadow/300ms cubic-bezier(.23,1,.32,1)).
- Отступления/заметки:
  1. Канал «занято» шире строки тикета (`{itemIds}` → +`mine`,
     `myBookingsCount`): «занято тобой» и «Мои брони · N» иначе не собрать —
     cookie HTTP-only, JS её не видит. Оба поля — производные ТОЛЬКО от cookie
     самого запрашивающего, чужого не раскрывают.
  2. purchased других гостей наружу сознательно НЕ отдаётся (spec упоминает
     «guest-DTO taken/purchased/isMine» — отложено до реальной нужды, меньше
     каналов — крепче инвариант №1).
  3. Rate limit накрывает и purchased (та же корзина 10/мин) — дешевле одного
     исключения.
  4. `bookItem` дополнительно отклоняет hidden-вещь и вещь выключенной зоны
     (NOT_FOUND) — прямое следствие инварианта №5, в строке тикета не значилось.
