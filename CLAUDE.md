# CLAUDE.md — wishlist-platform

Ты работаешь над «комнатой»: личная страница человека — фотореальный интерьер,
где объекты — зоны его мира (полки → книги, гардероб → одежда, проигрыватель →
музыка). У вещи два состояния: **«люблю»** (уже моё, показываю, без цены) и
**«хочу»** (жду в подарок, с ценой, бронируется). Гости **тихо** бронируют
подарки; после праздника хозяйка отмечает «Дошло» — вещь уезжает в зал славы,
имя дарителя раскрывается, появляется связь.

**Источники правды:**
- продукт — `docs/PRD.md`; архитектура — `docs/ARCHITECTURE.md`; порядок — `docs/ROADMAP.md`;
- UI и поведение — **дизайн-пакет `design/package/`**: `handoff/items.json`
  (модель вещи), `rooms.json` (130 зон в контракте, 120 в рендере — зона без
  записи в `zones.json` не показывается, ADR-0003), `zones.json`, `tokens.json`,
  `motion.json`, макет `Main Screen.dc.html`. Код воплощает эти значения, а не
  изобретает свои. Расхождение с пакетом без согласования = баг.

## Стек (зафиксирован)

- **Next.js 16+ (App Router, RSC) + React 19 + TypeScript strict**
- **Tailwind CSS v4** — токены генерируются из `handoff/tokens.json`; **Motion**
- Шрифты: Archivo (display) / Onest (UI) / Instrument Sans — через next/font
- **PostgreSQL 17 + Prisma** (+ pgvector) · **Redis + BullMQ**
- **Auth.js** — вход без пароля (magic link); второй способ Apple/Google/
  Telegram — один раз, перед первым шером. СМС нет.
- **Zod** · **S3/MinIO + CDN** · **Playwright** (e2e + fallback-парсер) ·
  **next-intl** (ru + каркас en) · Sentry + OTel + PostHog (prod)
- **three.js — НЕ тащить вообще** (ADR-0001): оживление вещей — CSS-покачивание
  (в проде) и 2.5D-параллакс по карте глубины (Phase 2). Платная генерация
  3D-моделей отвергнута владельцем; пересмотр — только явным решением.

Крупные зависимости не добавлять без явного согласования.

## Команды

```bash
docker compose up -d          # postgres + redis + minio
npm run dev                   # Next.js dev server
npx prisma migrate dev        # миграции
npx prisma studio             # просмотр БД
npm run worker                # BullMQ worker (отдельный процесс)
npm run tokens                # Tailwind-токены из handoff/tokens.json
npm run lint && npm run typecheck
npm run test                  # vitest (unit)
npm run test:e2e              # playwright: сам поднимает dev-сервер на :3100
```

Поддерживай команды рабочими; меняется структура — обнови этот файл.

## Конвенции

- Серверные компоненты по умолчанию; `"use client"` — только интерактив.
- **Координаты зон — только из `rooms.json`** (430×352, десктоп ×1.7778).
  Наезд камеры считается формулой из `motion.json`, руками не задаётся.
  Отдельной десктопной карты координат не существует и не должно появиться.
- **Изображения комнат (`design/package/refs/`) неприкосновенны**: не
  перегенерировать, не кадрировать; retina — апскейл существующего файла.
- Анимации — по `motion.json` (кривая, длительности, стаггер);
  `prefers-reduced-motion` по контракту; hover — за воротами
  `(hover:hover) and (pointer:fine)`; любой нажимаемый элемент проседает
  scale(.97) 160ms.
- Кнопки: «полоса света» — главная везде; «бирка» — ровно одно действие
  «подарить» в режиме гостя, больше нигде (турн 22).
- API: route handlers `app/api/v1/...`, ответы `{ data } | { error: { code, message } }`.
- Бизнес-логика в `src/server/services/*`; роуты тонкие; DTO-слой
  `src/server/dto/*` — единственное место сериализации.
- Деньги: `Decimal`, никогда float; валюта ISO 4217 отдельным полем.
- Парсер — изолированный модуль `src/server/parser/` с адаптерами (+фикстуры).
- Каталог и AI — за флагами `CATALOG_ENABLED` / `RECOGNIZE_ENABLED`.
- Тесты обязательны: парсер (фикстуры), сервис брони, DTO-инварианты, переход
  `receiveGift`; e2e на happy path фазы.
- Коммиты conventional (`feat:` …), атомарные. Секреты только через env.

## Критичные инварианты (никогда не нарушать)

1. **Тихая бронь — без исключений.** Хозяйке — только счётчик «N вещей уже
   забраны» по комнате. Ни имени, ни вещи, ни в API, ни в кэше. Складчина
   тиха при любом числе участников (в счётчике — одна вещь); прогресс сбора —
   только гостям. Счётчик может убывать (отмена/несбор) — не скрывать.
   `itemForOwner` не содержит booking — покрыто тестом.
2. **Имена дарителей раскрываются ровно один раз** — экран «что подарили»
   (`OccasionSummary.revealedAt`). Переход `хочу → люблю` необратим.
3. **Пунктир кодирует «хочу», а не отсутствие фото.** Вещь «люблю» без фото —
   серая заливка БЕЗ пунктира. Тест обязателен (в прототипе это уже путали).
4. **Друзья не добавляются.** В API нет и не будет поиска людей и импорта
   контактов. Связь — из подарка или открытой ссылки.
5. Спрятанные вещи и выключенные зоны не отдаются гостям (фильтр на чтении,
   тест). Выключенная зона исчезает с мебелью.
6. **SSRF-защита**: любой чужой URL — только через `safeFetch`
   (ARCHITECTURE §11). Чужие изображения не хотлинкуем — в своё S3.
7. Комната гостя доступна по shareSlug и не попадает в sitemap (индексация —
   открытый вопрос, дефолт закрытый).
8. **Цена «люблю» не показывается ГОСТЮ**, пока хозяйка не разрешила настройкой;
   хозяйке её собственные цены видны всегда. В зале славы показ управляется
   настройкой из четырёх положений, дефолт — «только друзьям» (ADR-0004).
   Цена «хочу» — по `priceVisibility`. Агрегаты (диапазон цен, марки в сводке
   зоны) считаются только по «хочу» с открытой ценой и не показываются, если
   таких вещей меньше трёх или различных марок меньше трёх; вещь «люблю»
   в агрегат не входит никогда.
9. **Зона `money` в продукте не показывается** — за ней нет ни экрана, ни
   сценария, а денежные переводы запрещены решением владельца (PRD §12а).
   Продукт показывает 120 зон из 130; снимается решением владельца, не кодом
   (ADR-0004).

## Agent skills

### Issue tracker

Local markdown: спеки и тикеты — файлы в `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Дефолтный словарь пяти ролей (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` в корне (глоссарий — канон терминов) + `docs/adr/`. See `docs/agents/domain.md`.

## Порядок работы

- Строго по фазам `docs/ROADMAP.md`; фаза закрыта по DoD (тесты + доки).
- Перед крупной фичей — короткий план (файлы, схема, миграции), потом код.
- Смотри соответствующий турн макета перед вёрсткой экрана (номера — в
  `handoff/README.md`); чего в макете нет — список 19b, приоритеты P0/P1/P2.
- Открытые вопросы (PRD §12) не решай молча — варианты пользователю, в коде
  нейтральный дефолт за флагом.
- Пользователь — продакт с банковским бэкграундом, не full-time разработчик:
  объясняй решения кратко, по-русски, без жаргона.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
