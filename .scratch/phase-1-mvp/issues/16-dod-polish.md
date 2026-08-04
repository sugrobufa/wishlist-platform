# 16 — DoD-полировка: метрики, доки, чистота

**What to build:** Закрытие Definition of Done фазы: SQL-метрики PRD §11
считаются готовыми запросами, документация синхронизирована, репозиторий чист.

**Blocked by:** 15.

**Status:** done

- [x] docs/metrics.sql: активация (≥3 вещи за 7 дней), доля LOVE, шаринг (≥1 гость), ≥1 бронь за 30 дней, замыкание цикла («что подарили» заполнен), качество парсера (доля URL без ручной правки — по source+флагу правки) *(флага правки в Phase 1 нет — метрика парсера считается честным прокси, ограничение и план на Phase 2 прописаны в самом файле)*
- [x] README: раздел запуска актуален; CLAUDE.md: команды/конвенции не разошлись с кодом
- [x] ROADMAP: Phase 1 отмечена, отклонения задокументированы
- [x] lint + typecheck + unit + design-contract зелёные; PROGRESS.md финализирован
- [x] Итоговый отчёт по фазе в .scratch/phase-1-mvp/ (что построено, что вне скоупа, открытые вопросы)

## Comments

Сделано (2026-08-05). Финальные прогоны: `npm run tokens` (без диффа),
`npm run lint`, `npm run typecheck` — чисто; `npm test` — **400/400** (34
файла; +2 этого тикета: tests/occasion-summary-unique.test.ts);
`npm run test:e2e` — **6 passed** (~48 с). Отчёт фазы — `REPORT.md` рядом.

**1. docs/metrics.sql** — 6 блоков метрик PRD §11 с комментариями по-русски;
каждый прогнан на dev-БД (`docker compose exec -T postgres psql … -f`), а
математика проверена на синтетике внутри `BEGIN…ROLLBACK` (значения совпали с
ручным расчётом). Оговорки честно в файле: Booking-строки живые → метрики
«ядра»/шаринга — нижние оценки по следам (receiveGift → giverName/receivedAt);
анонимные визиты не хранятся; правки после парсинга не трекаются — прокси +
план Phase 2 (флаг «сохранена без правок» при сабмите формы).

**2. Lighthouse ≥90 на проде (DoD)** — `next build` + `next start` на :3200:
- до полировки: **80** (FCP 1.9 с, LCP 3.8 с, TBT 320 мс) — LCP-кадр комнаты
  живёт CSS-фоном, загрузка стартовала после гидрации (~1.6 с);
- фикс: `ReactDOM.preload(roomImageUrl(preset.base), {as:"image",
  fetchPriority:"high"})` в SceneStage — при SSR уезжает в `<head>` (проверено
  в HTML). A/B: без fetchPriority=high LCP откатывается к 3.8 с / perf 84;
- после: **90 = медиана 6 прогонов (87,88,90,90,90,90)**, FCP 2.4 с, LCP
  2.7 с, TBT 190–250 мс, CLS 0, вес 404 KiB. Разброс — вариация TBT
  симуляции; запас Phase 2 — next-intl-диета клиенту и AVIF-производные
  кадров (потребует решения владельца: кадры неприкосновенны).

**3. Полировка из долга:**
- (а) **ISR /r/{slug} включён** (план 07): снят force-dynamic, добавлены
  `revalidate = 300` и **пустой `generateStaticParams`** — грабля Next 16:
  без него динамический сегмент рендерится на каждый запрос (build: ƒ,
  Cache-Control: no-store), с ним — ● SSG, на next start проверено:
  `x-nextjs-cache: HIT`, `s-maxage=300`, а в `.next/…/r/demo.meta` в
  `x-next-cache-tags` лежит **room-{id}** — мутации хозяйки инвалидируют и
  данные, и HTML. «Занято»/визиты — прежние некэшируемые каналы (в кэш не
  попадают by design 07/08). Окно 300 с — страховка для photoKey из воркера
  (Comments 06: revalidateTag из чужого процесса до кэша не достаёт).
  unstable_cache вещей получил то же revalidate: 300. e2e зелёный.
- (б) next-intl ENVIRONMENT_FALLBACK убран: /connections передаёт `now`
  с сервера в ConnectionsList → `format.relativeTime(date, now)` (один момент
  на рендер, без гидрационных расхождений; eslint react-hooks/purity —
  точечный disable с обоснованием, страница force-dynamic).
- (в) subtitle зоны (/room/zone/[zone]) — живые счётчики своих вещей в
  формате пакета («N вещей · M в подарок», ключ ZoneGrid.zoneCounts ru/en);
  пустая зона (одни призраки) — без подписи, у призраков свой бейдж.
- (г) вход в /room/add повешен (раньше — только прямой URL, долг 04/06):
  маленькая «полоса света» «Добавить вещь» в шапке /room + тихие ссылки
  «+ Добавить вещь» в панели каждой зоны сцены и на странице зоны списком —
  все с `?zone={key}` (предвыбор зоны — контракт 04).
- (д) дедуп компараторов: `compareZoneItems` экспортирован из services/items,
  guest-room.ts потребляет его же — дубль compareGuestItems удалён (заметка
  07/13).
- (е) **миграция `20260805083000_occasion_unique_room_date`**: @@index →
  @@unique(roomId, date) (SQL собран `migrate diff`, применён `migrate
  deploy` — migrate dev без TTY не работает, путь 13-го); в closeOccasion
  P2002 → вернуть существующий summary (created:false, письмо не ставится).
  +2 теста (tests/occasion-summary-unique.test.ts): P2002 самой схемы и
  ДЕТЕРМИНИРОВАННАЯ гонка cron+клик (незакоммиченный «победитель» в
  транзакции, «проигравший» виснет на уникальном индексе → P2002 → берёт
  существующий; в БД одна строка, письмо одно). Все 19 тестов 10-го зелёные.
- (ж) S3-сироты при живом аккаунте и ретрай s3Cleaned:false — НЕ делались,
  перенос в Phase 2 (джоба s3.cleanup поверх listKeysByPrefix/deleteObjects)
  — зафиксировано в ROADMAP и REPORT.

**4. Доки:** README (Phase 1 готова; test:e2e на :3100 + nightly workflow;
снята устаревшая «складчина ≥5» — противоречила PRD §12а; открытые вопросы
сверены с §12/§12а), ROADMAP (Phase 1 ✅ 2026-08-05 + итог + 9 отклонений
честно), CLAUDE.md (npm run tokens в командах; e2e «сам поднимает :3100»),
PROGRESS.md (16 done, «Phase 1 закрыта 2026-08-05»).

**Файлы тикета:** docs/metrics.sql (новый) · src/app/r/[slug]/page.tsx ·
src/server/services/guest-room.ts · src/server/services/items.ts ·
src/server/services/occasions.ts · prisma/schema.prisma ·
prisma/migrations/20260805083000_occasion_unique_room_date/ ·
src/components/scene/SceneStage.tsx · src/app/room/page.tsx ·
src/app/room/zone/[zone]/page.tsx · src/app/connections/{page,connections-list}.tsx ·
messages/{ru,en}.json · tests/occasion-summary-unique.test.ts (новый) ·
README.md · docs/ROADMAP.md · CLAUDE.md · PROGRESS.md · REPORT.md (новый).
