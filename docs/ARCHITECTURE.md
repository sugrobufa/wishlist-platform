# ARCHITECTURE — Grace (техимя репозитория — wishlist-platform)

Версия 0.4 (синхронизирована с PRD 0.4 и дизайн-пакетом `design/package/`).

0.4 (09.08.2026, тикет 124): состояний у вещи нет. `ItemState` (`LOVE | WANT`)
убран из модели; место вещи держит одно поле `inHall` — `false` комната,
`true` сокровищница. Прежнее имя витрины «зал славы» заменено на нынешнее —
«сокровищница»; это то же место, а не новое.

## 0. Принципы

- **Дизайн-пакет — источник правды UI**: `handoff/items.json` (модель вещи),
  `rooms.json` (зоны), `zones.json` (справочник), `tokens.json` (токены),
  `motion.json` (партитура движения). Код не изобретает значения — он их
  воплощает. Расхождение с макетом без согласования = баг.
- **Изображения комнат неприкосновенны.** 130 хотспотов привязаны к композиции
  кадров; перегенерация запрещена, retina — только апскейл существующего файла.
  `design/package/refs/` — единственный источник, хранится в репозитории.
- **Модульный монолит**: Next.js + worker на одной кодовой базе; масштаб —
  горизонтальный (§9), без микросервисов и Kubernetes на старте.
- Каталог (фиды) и AI-распознавание — модули за фичефлагами (§7–8); продукт
  полноценен без них.

## 1. Обзор системы

```
[Browser / PWA] ──► [Next.js 16: RSC + /api/v1/*] ──► [PostgreSQL 17 + pgvector (Prisma)]
      ▲                        │                          ▲
      │ CDN (кэш комнат,       ├──► [Redis / BullMQ] ──► [Worker: parse, image, mail,
      │ изображения)           │        feed.ingest, ai.recognize, price.refresh]
      └────────────────────────┴──► [S3: dev MinIO / prod R2 + CDN]
```

Dev — `docker-compose.yml`: postgres (+pgvector), redis, minio.
Prod MVP — 1–2 web + 1 worker + managed Postgres/Redis + R2/CDN.

## 2. Стек и дизайн-система

Next.js 16 (App Router, RSC) · React 19 · TS strict · Tailwind v4 (токены
генерируются из `handoff/tokens.json`) · Motion · Prisma + PostgreSQL 17
(+pgvector) · Redis + BullMQ · Auth.js (без пароля: magic link; второй способ
Apple/Google/Telegram) · Zod · S3/R2 + CDN · Playwright · next-intl ·
Sentry + OTel + PostHog (prod).

Шрифты: **Archivo** (display, 900, uppercase), **Onest** (UI),
**Instrument Sans** (аннотации) — self-host через `next/font`.
**three.js — только для сокровищницы** и только когда есть 3D-модель (не в MVP;
в MVP вращение — фото + CSS, как в макете).

## 3. Сцена комнаты

### 3.1 Контракт (из `rooms.json`)

- Все зоны заданы **один раз** прямоугольниками `x, y, w, h` в координатах
  телефонной сцены **430×352** (кадр комнаты 630×351, x-сдвиг −12).
- Десктоп: `(x+12)·1.7778, y·1.7778, w·1.7778, h·1.7778`. Отдельной карты для
  большого экрана **не существует и не должно появиться**.
- Наезд камеры **считается** из центра прямоугольника (формулы —
  `motion.json → openZone[0]`; scale: 1.72 phone / 1.45 desktop).
  Добавить зону = дописать четыре числа.
- **Наезд ≠ раскрытие.** Наезд бесплатен и работает для всех зон контракта
  (та же фотография). Раскрытие требует отдельной съёмки — кадров «открыто»
  по-прежнему **30**, по три на комнату, их число не растёт вместе с зонами;
  у зоны без кадра камера подъезжает, сетка вещей работает, мебель не
  двигается.
- **Зона без записи в `zones.json` не рендерится** (правило ADR-0003,
  реализовано в `src/config/design.ts`): у неё нет ни подписи, ни глагола
  раскрытия, ни пула демо-вещей. Так сейчас скрыта зона `money`, из-за чего
  продукт показывает 120 зон из 130. Допишут ключ в справочник — зона
  появится сама, без правок кода.
- Хитспоты ≥44 px; у трёх мужских комнат (спорт, кабинет, лофт) прямоугольники
  размечены на глаз — сверить перед продом.

### 3.2 Реализация

- `SceneStage` (client component): слой кадра комнаты + слой кадров «открыто»
  стопкой + хотспоты. Трансформы — CSS transform от конфига; никакой
  пиксельной магии в компонентах. Отдельного слоя «призраков» у сцены нет:
  пустую комнату закрывает затемнение, а не вещи-примеры (решение владельца
  09.08.2026).
- Партитура анимаций — из `motion.json` (длительности, кривая
  `cubic-bezier(.23,1,.32,1)`, стаггер сетки 60 мс, ambient-дрейф отдельным
  слоем ПОД камерой). `prefers-reduced-motion` — по контракту, не «всё в 0».
- Ворота наведения: `(hover:hover) and (pointer:fine)` на всё, что висит на
  hover — тач не должен получать ложные наведения.
- Изображения комнат раздаются со своего CDN (AVIF/WebP + JPG fallback,
  апскейл 2x из существующих файлов для retina — геометрия до пикселя).

## 4. Модель данных (Prisma, эскиз)

```prisma
model User {
  id          String   @id @default(cuid())
  email       String   @unique
  displayName String
  avatarKey   String?
  locale      String   @default("ru")
  secondAuth  Json?              // { provider: apple|google|telegram, sub } — «укрепление» перед шером
  createdAt   DateTime @default(now())
  room        Room?
  connectionsA Connection[] @relation("connA")
  connectionsB Connection[] @relation("connB")
}

// Комната одна на пользователя. Пресет из 10; акценты/кадры — rooms.json по preset.
model Room {
  id           String   @id @default(cuid())
  userId       String   @unique
  preset       String                 // 'cream' | 'warm' | ... из rooms.json
  zoneSet      String   @default("ALL") // 'F' | 'M' | 'ALL' — «набор зон»
  zonesOff     String[]               // выключенные зоны (исчезают с мебелью)
  shareSlug    String   @unique       // комната доступна по ссылке
  occasionDate DateTime?              // ближайший праздник (день рождения — P1)
  hallVisibility HallVisibility @default(ALL) // кто входит в сокровищницу (ADR-0011)
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id])
  items        Item[]
}

enum HallVisibility { ALL MUTUAL NONE }  // «всем по ссылке» | «взаимным» | «никому»

enum PriceVisibility { ALL FRIENDS ME NONE }
enum ItemSource { URL MANUAL PHOTO CATALOG SHARE EXTENSION BOT }

// Одна вещь, два МЕСТА (контракт items.json v2, тикет 124). Состояния нет:
// `inHall = false` — комната (бронируется, есть цена и степень желания),
// `inHall = true` — сокровищница (не бронируется, цены гостю нет вовсе).
// Пунктира нет ни у одной вещи — кодировать им больше нечего.
model Item {
  id           String     @id @default(cuid())
  roomId       String
  zone         String                    // ключ зоны; живёт и у вещи витрины
  title        String
  note         String?
  photoKey     String?                   // техническое поле, на место не влияет
  url          String?
  canonicalUrl String?
  domain       String?
  // --- поля вещи КОМНАТЫ ---
  // Живут у всего, но показываются, только пока вещь в комнате. Переезд их
  // не стирает: «Вернуть в комнату» показывает цену снова.
  price          Decimal?  @db.Decimal(12, 2)  // обязательна у вещи комнаты (Zod в сервисе)
  currency       String?
  priceVisibility PriceVisibility @default(ALL)
  size           String?
  color          String?
  desire         Int?                    // степень желания, 1–4; null = «не скажу»
  eventWhen      String?                 // услуга-впечатление: «14 марта», «выходные»
  eventWhere     String?                 // город, место или «онлайн»
  validUntil     DateTime?               // конец сертификата, последний день выставки
  // --- МЕСТО вещи и история подарка ---
  giverName    String?                   // «Подарила мама» / из брони при «Дошло»
  receivedAt   DateTime?                 // «Подарок 2024 года»
  inHall       Boolean    @default(false) // единственный признак места; ОБРАТИМ
  hiddenFromHall Boolean  @default(false) // глазок: спрятать вещь витрины от гостей
  // --- общее ---
  hidden       Boolean    @default(false) // видит только хозяйка
  source       ItemSource @default(MANUAL)
  catalogProductId String?
  priceCheckedAt DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  room         Room       @relation(fields: [roomId], references: [id])
  booking      Booking?
  priceSnapshots PriceSnapshot[]
  @@index([roomId, zone, inHall])
  @@index([canonicalUrl])
}

enum BookingMode { QUIET SIGNED POOL }

model Booking {
  id          String      @id @default(cuid())
  itemId      String      @unique
  mode        BookingMode @default(QUIET)
  guestName   String                     // хозяйке НЕ отдаётся до «что подарили»
  guestEmail  String?
  guestUserId String?                    // если гость зарегистрировался «по пути»
  cancelToken String      @unique
  purchased   Boolean     @default(false)
  createdAt   DateTime    @default(now())
  item        Item        @relation(fields: [itemId], references: [id])
  pool        PoolContribution[]
}

model PoolContribution {                  // складчина; «от пяти не спрятать» — правило в сервисе
  id        String   @id @default(cuid())
  bookingId String
  name      String
  amount    Decimal  @db.Decimal(12, 2)
  paidAt    DateTime?                    // оплата — P1, провайдер по решению рынка
  createdAt DateTime @default(now())
  booking   Booking  @relation(fields: [bookingId], references: [id])
}

// «Что подарили»: итог праздника. Заполняется бронями на дату; хозяйка отмечает «Дошло».
model OccasionSummary {
  id        String   @id @default(cuid())
  roomId    String
  date      DateTime
  revealedAt DateTime?                   // имена раскрыты ровно один раз
  createdAt DateTime @default(now())
}

enum ConnectionKind { MUTUAL FOLLOW VIEWED }

// Связи не создаются вручную: рождаются из подарка или открытой ссылки.
model Connection {
  id        String   @id @default(cuid())
  aUserId   String                       // владелец списка связей
  bUserId   String
  kind      ConnectionKind
  origin    String                       // 'gift:{itemId}' | 'visit' | 'pool:{bookingId}'
  history   Json?                        // «дарила тебе 2 раза · ты ей 1 раз»
  createdAt DateTime @default(now())
  a         User @relation("connA", fields: [aUserId], references: [id])
  b         User @relation("connB", fields: [bUserId], references: [id])
  @@unique([aUserId, bUserId])
}

model PriceSnapshot { id String @id @default(cuid())
  itemId String; price Decimal @db.Decimal(12,2); currency String
  available Boolean?; checkedAt DateTime @default(now())
  item Item @relation(fields: [itemId], references: [id])
  @@index([itemId, checkedAt]) }

model ParseJob { id String @id @default(cuid())
  url String; userId String
  status String // PENDING | FAST_DONE | BROWSER_PENDING | DONE | FAILED
  result Json?; error String?; attempts Int @default(0)
  createdAt DateTime @default(now()) }

// Каталог из партнёрских фидов и AI-распознавание — схемы заложены сразу
// (реализация Phase 2–3): CatalogSource, CatalogProduct (+pgvector embedding),
// OutboundClick, RecognitionJob — без изменений с v0.2, см. §7–8.
```

## 5. Тихая бронь: DTO и инварианты

DTO-слой (`src/server/dto/*`) — единственное место сериализации.

- **`itemForOwner`** — НИКОГДА не содержит `booking`, `guestName`, ничего о
  брони конкретной вещи. До «что подарили» хозяйка получает только агрегат:
  `GET /room → { takenCount: 3 }` («3 вещи уже забраны») — счётчик по комнате,
  не по вещам.
- Складчина для хозяйки неотличима от обычной тихой брони при любом числе
  участников: в счётчике — одна занятая вещь, порога не существует (PRD §12а).
  Прогресс сбора — отдельный гостевой канал (Phase 2), хозяйке не отдаётся.
  Счётчик может убывать (отмена брони, несобравшаяся складчина с автовозвратом
  взносов) — убывание не скрывается и не детализируется.
- **`itemForGuest`** — `taken: boolean`, `purchased: boolean`, `isMine`
  (по cancelToken); имена других гостей не отдаются.
- Вещи `hidden` и вещи выключенных зон гостю не отдаются вовсе; **вещь
  сокровищницы гость получает без цены всегда** — правило живёт одной функцией
  `guestSeesHallPrice()` (`src/server/dto/hall.ts`), у неё нет аргументов
  сознательно: любая настройка в сигнатуре читалась бы как дверь, которой
  больше нет.
- Unit-тесты фиксируют: (а) owner-DTO не содержит полей брони, (б) guest не
  видит hidden, (в) гость не получает цену вещи сокровищницы ни при какой
  настройке, (г) пунктира не бывает ни при каком входе.

## 6. Два переезда вещи: `receiveGift` и `toggleHall`

**«Дошло» (`receiveGift`) — единственный СИСТЕМНЫЙ переезд.** Одна транзакция,
вызывается с экрана «что подарили» (отмечает хозяйка):

1. `inHall = true` — вещь уезжает из комнаты в сокровищницу;
2. `receivedAt = now`, `giverName` ← из брони (или руками);
3. раскрытие имени — только в рамках `OccasionSummary.revealedAt` (один раз);
4. создание/обновление `Connection` (origin `gift:{itemId}`), гостю —
   предложение «остаться на связи»;
5. бронь закрывается.

Повторный вызов на вещи, которая уже на витрине, отказывает
(`ALREADY_IN_HALL`) — раскрытие бывает ровно один раз.

**Ручной переезд (`toggleHall`) — в обе стороны.** «В сокровищницу» и
«Вернуть в комнату»: по смыслу меняется только `inHall`. Зона и цена
сохраняются; `giverName` не трогается ни при въезде, ни при возврате;
`hiddenFromHall` сбрасывается при въезде (витрина показывает вещь, как бы её
раньше ни прятали глазком), а `receivedAt` проставляется, только если его ещё
нет — у подарка это момент «Дошло», и переезд не вправе его переписать.

**Что именно необратимо.** Не место вещи, а **раскрытие имени дарителя**.
Место обратимо, и возврат в комнату имя не отменяет и второй раз не запускает.
Имена и место — две разные вещи, связывать их нельзя (тикет 124, решение
владельца 09.08.2026). Отдельно: вещь витрины можно спрятать от гостей
глазком (`hiddenFromHall`) — это не переезд, вещь остаётся на витрине хозяйки.

**Бронь при ручном переезде на витрину снимается молча — для ХОЗЯЙКИ.**
Действие доступно всегда и выглядит одинаково на любой вещи: спрятанная кнопка
сама рассказала бы, какие вещи уже забрали (инвариант №1). Гостю при этом
уходит письмо «вещь уехала — выбери другую» (шаблон просрочки), складчине —
автовозврат взносов тем же механизмом, что у несобравшейся складчины. Ни один
экран хозяйки и ни один ответ сервера не зависят от того, была бронь или нет —
тест обязателен.

## 7. Наполнение №1: каталог и партнёрские фиды (Phase 2–3, флаг `CATALOG_ENABLED`)

Без изменений с v0.2: источники по рынку (Admitad/ePN/YML · Amazon PA-API ·
AliExpress), потоковый `feed.ingest` (SAX, upsert батчами, дедуп
GTIN → canonicalUrl → fuzzy), поиск (FTS + pg_trgm + pgvector HNSW),
использование: поиск при добавлении вещи, блок «где купить», монетизация.
Исходящие ссылки — только через `GET /out/:token` (+`OutboundClick`, `subId`),
в UI помечены. Партиционирование по источнику, отдельный worker.

## 8. Наполнение №2: скрин/фото + AI (Phase 2, флаг `RECOGNIZE_ENABLED`)

Вход уже в дизайне (карточка добавления, турн 8: «по скрину»). Флоу: фото →
приватный bucket → `ai.recognize` → vision (Claude API): `{zone, kind, brand?,
цвета, текст, confidence}` → кандидаты из каталога (embeddings) → пользователь
подтверждает; без кандидатов — карточка из фото и атрибутов. Лимит N/день,
кэш по хэшу изображения. Фото не публикуются без действия пользователя.

## 9. Масштабирование до миллионов

Профиль «читают в тысячи раз больше, чем пишут» (комнаты шарятся в мессенджерах):

- Stateless web × N за LB; сессии в HTTP-only cookie.
- Комната гостя — ISR + `revalidateTag` (инвалидация мутацией хозяйки), CDN
  stale-while-revalidate; пики шаринга не бьют в БД. Внимание: **счётчик броней
  хозяйки и «занято» гостя — не кэшировать вместе со сценой** (отдельный
  лёгкий эндпоинт без кэша).
- PostgreSQL managed + PgBouncer с первого дня; реплики чтения; партиции
  каталога/кликов; pgvector HNSW.
- Изображения: обработка при загрузке (sharp), раздача только через CDN.
- Worker'ы отдельно от web; тяжёлые очереди — выделенный процесс.
- OTel + Sentry + PostHog; SLO p95 API < 300 мс; алерты на глубину очередей.
- Rate limits: гостевые мутации по IP, парсинг/распознавание по пользователю.
- До ~100k MAU: 1–2 web + 1 worker + managed БД. K8s — только при реальной боли.

## 10. API (эскиз, `/api/v1`)

```
GET  /me · PATCH /me · POST /me/second-auth                     (auth)
GET  /room · PATCH /room (preset, zoneSet, zonesOff, occasion)  (auth)
GET  /room/taken-count                 счётчик «уже забраны»    (auth, без кэша)
CRUD /items · POST /items/:id/received  «Дошло» → сокровищница  (auth)
POST /items/:id/hall { on }            ручной переезд в обе стороны (auth)
POST /parse { url } → ParsedProduct | { jobId } · GET /parse/:id (auth)
POST /recognize { imageKey } → { jobId } · GET /recognize/:id   (auth, флаг)
GET  /catalog/search?q&zone                                     (auth, флаг)
GET  /r/:shareSlug                     комната гостя (guest DTO)
POST /items/:id/book { name, email?, mode } → { cancelToken }
POST /items/:id/book/purchased · DELETE /items/:id/book         (cancelToken)
POST /items/:id/pool { name, amount }                           (складчина)
GET  /occasions/:id/summary            «что подарили»           (auth)
GET  /connections                                               (auth)
GET  /out/:token                       клик → 302               (флаг)
POST /me/export · DELETE /me           GDPR                     (auth)
```

Zod на всех входах; ownership на мутациях; rate limit на гостевых; поиска
людей и импорта контактов в API **нет и не будет** (правило продукта).

## 11. Безопасность

- Auth.js: magic link (без пароля), второй способ перед первым шером;
  Telegram Login — по решению рынка. Сессии HTTP-only, CSRF из коробки.
- `assertOwner` на каждой мутации; guest-мутации — по cancelToken.
- Тихая бронь — §5; hidden/выключенные зоны фильтруются на чтении.
- Комната — по ссылке (shareSlug), вне sitemap; индексация — открытый вопрос.
- safeFetch для ЛЮБОГО чужого URL: http/https, порты 80/443, запрет приватных
  IP после DNS-резолва (каждый hop), ≤5 редиректов, тело ≤5 МБ, таймаут 3–10 с,
  content-type allowlist, UA `WishlistBot/1.0 (+https://<domain>/bot)`.
- Изображения не хотлинкуем — скачиваем в S3; загрузка по pre-signed URL ≤10 МБ.
- CSP, X-Frame-Options; статика со своего CDN.

## 12. Парсер ссылок (MVP)

`src/server/parser/` — изолированный модуль, без изменений с v0.2:
normalize (трекинг-параметры, короткие ссылки) → fastPath (адаптер → JSON-LD →
OG → эвристики; таймаут 3 с) → при неполноте `parse.browser` (Playwright,
Phase 2) → postprocess (изображение через safeFetch → sharp → S3; зона —
эвристикой, пользователь подтверждает). Redis-кэш по canonicalUrl (24 ч),
token-bucket на домен. Адаптеры: `SiteAdapter` + фикстура + unit-тест на
каждый. Правовая гигиена: парсим только по действию пользователя; фиды (§7) —
легальная замена скрейпингу.

## 13. Фоновые задачи (BullMQ)

| Очередь | Задача | Фаза |
|---|---|---|
| `image.ingest` | скачивание/resize/S3 | 1 |
| `mail` | magic link, письма гостям, **напоминание за 3 дня** | 1 |
| `occasion.close` | сборка «что подарили» после даты | 1 |
| `parse.browser` | Playwright-рендер | 2 |
| `feed.ingest` / `embeddings.build` | каталог | 2 |
| `price.refresh` | перепроверка цен у вещей комнаты | 2 |
| `ai.recognize` | vision-распознавание | 2 |

## 14. Переменные окружения (`.env.example`)

```
DATABASE_URL= REDIS_URL=
S3_ENDPOINT= S3_BUCKET= S3_PRIVATE_BUCKET= S3_ACCESS_KEY= S3_SECRET_KEY= CDN_BASE_URL=
AUTH_SECRET= AUTH_GOOGLE_ID= AUTH_GOOGLE_SECRET= AUTH_APPLE_ID= AUTH_APPLE_SECRET=
TELEGRAM_BOT_TOKEN=            # Telegram Login (по рынку)
EMAIL_SERVER= EMAIL_FROM=
APP_BASE_URL= PARSER_UA="WishlistBot/1.0"
ANTHROPIC_API_KEY=             # vision (Phase 2)
CATALOG_ENABLED=false RECOGNIZE_ENABLED=false
ADMITAD_TOKEN= EPN_KEY= AMAZON_PAAPI_KEY=
SENTRY_DSN= POSTHOG_KEY=
```
