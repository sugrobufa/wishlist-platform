# 06 — Добавление по ссылке: превью, image.ingest, дедуп

**What to build:** В карточке добавления хозяйка вставляет URL — за ≤4с
появляется предзаполненная карточка (название, фото, цена, магазин, зона-
подсказка), всё редактируемо; сохранение скачивает изображение в своё S3.
Дубликат по canonicalUrl — предупреждение, не запрет.

**Blocked by:** 04, 05.

**Status:** done

- [x] POST /api/v1/parse {url} → ParsedProduct (auth, rate limit по userId); ошибка парсинга → карточка с url+domain, руки дозаполняют
- [x] image.ingest (BullMQ): safeFetch картинки → sharp resize ≤1600 → AVIF/WebP → MinIO; вещь ссылается на свой ключ, хотлинков нет *(sharp сознательно отложен — см. Comments, TODO тикету 16; оригинал ≤5 МБ кладётся как есть)*
- [x] Дедуп-предупреждение по canonicalUrl в комнате (сохранить можно)
- [x] source=URL у вещи; price+currency предзаполнены; зона-подсказка подставлена
- [x] Живой тест на 2–3 реальных URL руками при приёмке (фикстурные юниты уже в 05) *(живой прогон parseUrl на 3 реальных URL и живой смоук воркера сделаны — см. Comments; клик-проверка хозяйкой в браузере остаётся на приёмке фазы)*

## Comments

Сделано (2026-08-04). `npm run typecheck` и `npm run lint` — чисто;
`npm test` — 276/276 (23 файла), из них **30 новых** этого тикета:
`tests/api.parse.route.test.ts` (7), `tests/items.create-url.test.ts` (12),
`tests/worker.image-ingest.test.ts` (11). Тесты тикета 04 не тронуты и зелёные.

**Файлы:**
- `src/app/api/v1/parse/{route.ts, limiter.ts}` — POST /api/v1/parse: auth-only
  (гостям парсер не нужен, открытый SSRF-прокси — тем более), Zod на вход,
  лимит 10/мин на userId (переиспользован `RateLimiter` тикета 08, свой
  префикс `rl:v1:parse`; Redis → in-memory fallback). Маппинг:
  `ParserError("invalid-url")` → 422, `("rate-limited")` → 429 (both:
  и per-domain bucket парсера, и userId-лимит роута); неудачный разбор — НЕ
  ошибка, а «честная карточка» от parseUrl → 200 (user story 9).
- `src/server/queues.ts` (новый) — ленивые Queue-клиенты app-стороны (mail,
  image.ingest): bullmq/ioredis грузятся динамически при первом обращении,
  инстансы в globalThis (HMR), `enableOfflineQueue: false` + явный connect —
  Redis лежит → `enqueueImageIngest()` возвращает false и НЕ бросает:
  сохранение вещи не блокируется, вещь просто остаётся без фото магазина.
  Джоба: attempts 3, exponential backoff 3с, removeOnComplete/Fail.
- `src/worker/image-ingest.ts` (новый) — чистая функция
  `processImageIngest(data, deps?)`: job {itemId, imageUrl} → чтение вещи
  (нет/есть photoKey → skip) → `safeFetch(accept: "image")` из парсер-модуля
  (инвариант №6; ≤5 МБ, таймаут картинкам 10с) → ключ через `newItemPhotoKey`
  (`items/{roomId}/{16hex}.{ext}`, SVG и не-растровое → skip, XSS-заслон) →
  S3 pre-signed PUT (`src/server/s3.ts`, тот же путь, что у фото из браузера)
  → `updateMany({id, photoKey: null})` — **условная запись: пользовательское
  фото, успевшее раньше, не перетирается даже в гонке** → revalidateTag.
  Исходы разделены: окончательные (SSRF-блок, 4xx, не-картинка, вещь
  удалена) — `{status:"skipped", reason}` без ретрая; переходные (timeout/
  network/dns/5xx/хранилище) — исключение, доигрывает BullMQ. Швы
  `{fetchImpl, lookupImpl, putObject}` — тестируется напрямую, без сети.
- `src/worker/index.ts` — только регистрация: Worker("image.ingest",
  processImageIngest, concurrency 2) + логи completed/failed; очередь mail
  не тронута, имена очередей — константы из queues.ts.
- `src/server/services/items.ts` — `source: z.enum(["MANUAL","URL"]).default
  ("MANUAL")` в общих полях схемы (дефолт = контракт тикета 04, его тесты
  зелёные без изменений; PHOTO/CATALOG и прочее из формы не прислать);
  `.refine`: source=URL требует url. В `createItem`: canonicalUrl/domain
  считаются ТОЛЬКО сервером из url (`normalizeUrl`/`domainOf` парсера —
  клиентскому canonicalUrl не верим, это ключ дедупа), не нормализуется →
  честный null. После записи: source=URL + imageUrl + НЕТ photoKey →
  `await enqueueImageIngest({itemId, imageUrl})` (не бросает). Новый
  `findDuplicateByUrl(userId, rawUrl)` → `{id,title,zone}|null` — только
  СВОЯ комната, поиск по индексу canonicalUrl, мусорный URL → null.
- `src/app/room/add/{add-item-flow.tsx, actions.ts, page.tsx, add-item.module.css}`
  — поле «Ссылка» переехало первым полем шага 2 (точка входа флоу «по URL»):
  кнопка «Заполнить по ссылке» + авто-подхват на paste валидного http(s)-URL;
  лоадер «Читаем страницу…» (сам parseUrl ≤ ~3.5с по таймаутам парсера).
  Мерж ответа: **пустые поля заполняются, занятые руками не трогаются**
  (title/price+currency парой/description→note); zoneHint встаёт только если
  зону не выбирали руками и не пришли по `?zone=…` (новый проп
  `zonePreselected`), с бейджем «предложено по ссылке» (снимается при ручном
  выборе зоны). confidence < 0.4 → мягкая плашка «заполнили что смогли —
  проверь поля». imageUrl → превью «фото из магазина — сохраним копию к себе»
  (хотлинк живёт ТОЛЬКО в браузере хозяйки до сохранения, с
  referrerPolicy=no-referrer; можно «Не сохранять»); своё фото приоритетнее —
  превью магазина прячется, imageUrl не уходит. Дедуп: server action
  `checkDuplicateAction` после parse (по canonicalUrl ответа) и на blur поля —
  жёлтая панель «такая ссылка уже есть в комнате: {title}» со ссылкой на
  `/room/zone/{zone}`; сохранению не мешает. source=URL уходит только если
  parse реально применился и ссылка всё ещё в поле; валюта вне малого набора
  (KZT…) дорисовывается в select. Парсер может вернуть любой ISO-код — форма
  честно его показывает.
- `messages/{ru,en}.json` — ns AddItem, точечные вставки 10 ключей
  (fillFromUrl/parsing/parsedLow/zoneSuggested/storePhoto*/dupWarn/dupOpen/
  errParseUrl/errParseRate).

**Живой смоук (Redis/MinIO/Postgres живые):**
- Воркер дочерним процессом (`tsx src/worker/index.ts`) + реальный enqueue
  через `enqueueImageIngest`: реальная картинка (wikimedia, image/jpeg,
  5309 байт) скачана safeFetch'ем → легла в MinIO ключом
  `items/{roomId}/5c0395….jpg` → photoKey записан; джоба на несуществующую
  вещь → `skipped (item-missing)`. Смоук-объект и тест-данные удалены.
- Прямой вызов parseUrl на 3 реальных URL: Wildberries (бот-заслон из ДЦ) →
  честная карточка `{domain, canonicalUrl, confidence 0.1}` — путь стори 9;
  books.toscrape.com → title+description+imageUrl+**zoneHint "books"**
  (confidence 0.3 → в UI будет плашка «проверь»); Wikipedia → OG title+image
  (0.5). Клик-проверка хозяйкой на живых Ozon/WB из резидентного браузера —
  на приёмке фазы (из датацентра магазины отдают анти-бот).

**Решения по краям (для ревью):**
- «Родилась из ссылки» = успешный parse применён к форме. Честная карточка
  (confidence 0.1) — тоже URL-рождение: вещь получает source=URL и
  canonicalUrl, дозаполняется руками (стори 9).
- Дедуп ловит только URL-вещи: MANUAL-вещь тикета 04 хранит url без
  canonicalUrl и в дедупе не участвует (осознанно, по тикету).
- `revalidateTag` из воркера гасится try/catch: в отдельном процессе без
  общего cache-store он не достаёт до кэша Next (photoKey подъедет штатной
  ревалидацией гостевой страницы); при переезде на общий cache handler
  заработает как задумано. Не блокер Phase 1.
- Сирота в S3 при гонке (наш объект остался, а победило фото пользователя) —
  не чистится здесь; уборка мусора — тикет 14/16 (там же GDPR-чистка ключей).
- limiter.ts лежит рядом с роутом (colocation), а не в rate-limit.ts —
  территория тикета 08 не тронута, класс переиспользован.

**Тикету 15 (e2e):** для стабильного e2e «добавила по URL» нужен фикстурный
магазин, до которого safeFetch дотянется (localhost заблокирован SSRF-защитой
by design) — поднимать страницу на non-loopback адресе/хосте docker-сети или
мокать fetchImpl на уровне тестового сервера. Фикстуры HTML уже есть в
`src/server/parser/__fixtures__`.

**Тикету 16:** TODO в `src/worker/image-ingest.ts` — sharp resize ≤1600px +
AVIF/WebP (Phase 1 кладёт оригинал как есть, sharp не в зависимостях —
жёсткое ограничение этого тикета); плюс чистка S3-сирот и ссылка «добавить
вещь» из комнаты (перенос из комментов 04).
