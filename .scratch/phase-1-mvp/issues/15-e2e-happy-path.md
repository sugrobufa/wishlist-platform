# 15 — e2e happy path: полный цикл дарения + перф-бюджет

**What to build:** Playwright-сценарий всего цикла на реальном стеке (docker
compose): регистрация → комната → вещь «люблю» вручную → вещь «хочу» по URL
(фикстурный локальный магазин) → шер → гость тихо бронирует → хозяйка видит
только счётчик → «праздник прошёл» → «Дошло» → зал славы + связь. Плюс
Lighthouse-бюджет комнаты гостя.

**Blocked by:** 06, 08, 10.

**Status:** done

- [x] e2e-тест цикла зелёный локально (magic link перехватывается из тест-хука E2E_MAIL_FILE, консольная рамка не тронута байт-в-байт); два контекста браузера: хозяйка и гость
- [x] Ассерты инварианта в e2e: в DOM и network-ответах хозяйки (HTML/JSON/RSC за всю сессию) нет имени гостя до «что подарили»
- [x] Фикстурный «магазин» — фикстура ozon.html с JSON-LD за флагом E2E_FIXTURE_SHOP *(внутрипроцессно, а не отдельной страницей: localhost для парсера закрыт SSRF-защитой BY DESIGN — контракт Comments 06; normalize/каскад/zoneHint работают по-настоящему)*
- [x] Lighthouse mobile на /r/{slug} прогнан, цифры в Comments; первый экран сцены ≤2МБ — ассерт в перф-тесте, зелёный *(performance ≥90 на dev-сервере недостижим и по задаче не ассертится — прод-замер тикету 16)*
- [x] Прогон в CI отдельным workflow (.github/workflows/e2e.yml): workflow_dispatch + nightly 03:00, сервисы pgvector/redis/minio; основной ci.yml не тронут

## Comments

Сделано (2026-08-05). `npm run typecheck`, `npm run lint` — чисто; `npm test`
— **398/398** (33 файла, +8 этого тикета: 4 в tests/mailer.test.ts, 4 в
tests/api.parse.route.test.ts); `npm run test:e2e` — **6 passed за 55.4s**
(2 смоука home × 2 проекта, полный цикл 36s, перф-замер 2.4s), после прогона
dev-БД чиста (проверено запросом: e2e-пользователей/summary/токенов — 0).

**Файлы:**
- `src/server/mailer.ts` — тестовый шов E2E_MAIL_FILE: каждое письмо и magic
  link ДОПОЛНИТЕЛЬНО дописываются NDJSON-строкой `{kind, to, subject?, url?,
  at}` (append, mkdir -p). Флаг пуст → ветка мертва, консоль/SMTP байт-в-байт
  прежние (закреплено тестом); сбой записи глотается с console.error —
  шов не имеет права ломать отправку. `tests/mailer.test.ts` +4 кейса.
- `src/app/api/v1/parse/route.ts` — шов E2E_FIXTURE_SHOP: при флаге =1 И
  hostname === `e2e-shop.test` HTML берётся из `__fixtures__/ozon.html`
  (диск) и разбирается настоящим parseHtml — сеть не тронута, canonical/
  domain считаются от запрошенного URL. Ветка стоит ПОСЛЕ auth/rate limit/
  Zod (шов не отменяет защиту — под тестом). `tests/api.parse.route.test.ts`
  +4: «флаг выключен = прежнее поведение» (тот же URL уходит в parseUrl),
  перехват с данными фикстуры, чужой hostname не перехватывается, 401 при
  флаге.
- `playwright.config.ts` — СВОЙ dev-сервер: порт из `e2e/env.ts` (E2E_PORT,
  дефолт 3100 — чужой на :3000 не трогаем), `reuseExistingServer: false`,
  webServer.env = {PORT, APP_BASE_URL, E2E_MAIL_FILE, E2E_FIXTURE_SHOP};
  скрипты package.json не менялись (next dev сам читает PORT). Репортёр
  html с open:never + list. ПОЧИНКА СУЩЕСТВУЮЩЕГО КОНФИГА: проект mobile
  явно пересажен на chromium — у пресета iPhone 14 defaultBrowserType =
  webkit, который не ставится ни локально, ни в CI (смоуки mobile падали бы
  на «Executable doesn't exist», что и показал первый прогон).
- `e2e/env.ts` — единственный источник E2E_PORT/E2E_BASE_URL/E2E_MAIL_FILE
  (файл писем живёт в test-results/ — уже в .gitignore).
- `e2e/full-cycle.spec.ts` — два теста в serial-режиме:
  1) «полный цикл дарения»: хозяйка (контекст №1) / → signin → magic link из
     файла → онбординг «Все 10» + «Дерзкая» → LOVE вручную в зону музыки →
     WANT по https://e2e-shop.test/product (кнопка «Заполнить по ссылке»,
     проверено предзаполнение title/цены 74990/валюты RUB, фото магазина
     сознательно «Не сохранять» — image.ingest не пойдёт в сеть за
     выдуманным CDN) → адрес комнаты из UI → 403 OWN_ITEM fetch'ем из её
     контекста → гость (контекст №2, аноним): сцена, наезд на зону, бирка
     «Подарить» у WANT, у LOVE-плитки ни ₽, ни сумм → /r/nonexistent 404 →
     гость логинится → визит создаёт «Смотрел(а)» у хозяйки → тихая бронь
     («Тайный Гость», guest-e2e@, режим «Тихо») → «занято тобой» + «Мои
     брони · 1» → хозяйка: «1 вещь уже забрана» + ИНВАРИАНТ (regex
     /Тайный|guest-e2e/ по телам ВСЕХ её network-ответов за сессию и по DOM
     — пусто; сбор останавливается ровно перед «что подарили») → «Праздник
     прошёл» (вручную, даты нет) → строка «Подарил(а) Тайный Гость» →
     «Дошло» → «Тайный Гость · уже в зале славы» → /room/hall «Подарен в
     2026 · Тайный Гость» → /connections: строка «Гость без имени», бейдж
     «Я слежу» (FOLLOW — у гостя нет комнаты, апгрейд из VIEWED), «…она в
     зале славы» → в E2E_MAIL_FILE есть occasion-owner хозяйке.
  2) «перф комнаты гостя»: mobile-эмуляция (iPhone 14 на chromium), LCP
     через PerformanceObserver + вес ресурсов из Resource Timing; ассерт:
     документ + картинки ≤ 2МБ (бюджет СЦЕНЫ — dev-бандлы JS в бюджет
     сознательно не входят, полный вес в отчёте); цифры — attachment
     guest-room-perf.json + консоль.
  Очередь mail обрабатывает мини-воркер прямо в процессе теста (тот же
  processMailJob из src/worker/mail; reminder-tick — no-op): отдельный
  процесс воркера регистрировал бы планировщики и мог закрыть праздники
  чужих комнат dev-БД посреди прогона. Уборка beforeAll+afterAll: оба
  e2e-пользователя (каскад), OccasionSummary (FK на Room нет — каскад его
  не достаёт), VerificationToken; повторный прогон идемпотентен.
- `.github/workflows/e2e.yml` — workflow_dispatch + nightly cron 03:00 UTC;
  сервисы pgvector/pg17, redis:7, bitnami/minio (сервер стартует сам,
  бакеты через MINIO_DEFAULT_BUCKETS — обычному minio/minio в GitHub
  services не передать команду `server`); шаги npm ci → tokens → prisma
  migrate deploy → db seed → playwright install chromium --with-deps →
  test:e2e; на падении — артефакт playwright-report + test-results.

**Решения по краям (для ревью):**
- Гость логинится ПЕРЕД бронью: связь физически рождается только из брони с
  guestUserId (контракты 10/11) — иначе шаги «связь появилась»/«Я слежу»
  недостижимы. Просмотр комнаты БЕЗ регистрации (сцена, бирка, отсутствие
  цены «люблю») проверяется до логина; сама бронь анонима покрыта юнитами 08.
- «Цена LOVE не течёт»: у «люблю» цены не существует на уровне схемы
  (items.ts, price только у WANT) — e2e ассертит плитку гостя (подпись
  «люблю», ни «₽», ни трёхзначных сумм) и видимость цены WANT при
  visibility=ALL; сетевой инвариант DTO держат юниты 07/09.
- Регекс инварианта гоняется по телам ответов с content-type html/json/
  plain/x-component (RSC-потоки и server actions включены).

**Перф (цифры, dev-сервер):**
- Playwright, mobile-эмуляция, /r/{slug} свежей комнаты: **LCP 492 ms**,
  DCL 258 ms, load 636 ms; **сцена (документ 14.3КБ + картинки 179КБ) ≈
  193КБ ≤ 2МБ — ассерт зелёный**; всего с dev-JS 1.13МБ, 26 ресурсов.
- Lighthouse 13.4.1 mobile (`npx lighthouse --preset=perf`, headless
  Chrome), /r/demo на dev-сервере: **performance 51**, FCP 1.9s, LCP 7.0s,
  TBT 1140ms, CLS 0, вес 1091 KiB. Ассерт сознательно не повешен (задача):
  на dev-сервере скор топят неминифицированные turbopack-бандлы и
  отсутствие сжатия при 4x CPU + slow-4G эмуляции Lighthouse.

**Тикету 16:**
- Lighthouse ≥90 проверять на прод-сборке (`next build` + `next start`,
  сжатие включено) — на dev 51 при весе сцены всего 193КБ; sharp/AVIF из
  TODO 06 добавит запаса.
- Напоминание «за 3 дня» в e2e не проверяется (окно дат в happy path не
  воспроизвести без шва времени) — держат юниты 12 (границы окна,
  идемпотентность jobId); если захочется e2e — нужен шов «сегодня».
- next-intl шумит в dev-консоли ENVIRONMENT_FALLBACK на /connections
  (format.relativeTime без параметра now, connections-list.tsx:145) — на
  каждый рендер страницы; косметика тикета 11, полировке.
- Письмо occasion-owner в e2e рендерится процессом-воркером, у которого
  APP_BASE_URL из .env (:3000) — ссылка в тексте письма ведёт на дев-адрес;
  на ассерты не влияет, в проде URL один. Захочется педантичности — гонять
  URL письма от комнаты, не от env.
