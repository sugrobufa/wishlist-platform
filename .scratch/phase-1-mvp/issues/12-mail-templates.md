# 12 — Письма: напоминание гостям за 3 дня + письмо хозяйке

**What to build:** Два письма цикла дарения. Гостям с email — напоминание за
три дня до праздника («вы заняли подарок для Милы, праздник 14 марта»).
Хозяйке — письмо после праздника («открой „что подарили"»). В dev (без
EMAIL_SERVER) письма печатаются в консоль воркера.

**Blocked by:** 10.

**Status:** done

- [x] Шаблоны reminder-guest и occasion-owner (ru, plain+html, тон продукта — тихий и тёплый)
- [x] Планировщик в worker: ежечасный тик находит комнаты с occasionDate−3д и ставит reminder-guest всем активным броням с email (одно письмо на бронь, идемпотентно — повторный тик не дублирует)
- [x] occasion-owner ставится из occasion.close (тикет 10)
- [x] Отправка через nodemailer при EMAIL_SERVER, иначе консоль; общий mailer-модуль с magic link
- [x] Unit: идемпотентность напоминаний; гость без email — молча пропущен

## Comments

- Сделано. `src/server/mailer.ts` (новый) — единственная точка отправки:
  - `sendMail({to, subject, text, html})`: EMAIL_SERVER есть → nodemailer
    (динамический импорт, транспорт кэшируется через globalThis — паттерн
    db.ts); нет → консоль рамкой `✉  [письмо] кому / Тема: … / текст`
    (многострочный текст с отступом внутри рамки).
  - `sendMagicLink(to, url)` — magic link входа; dev-рамка
    `✉  [magic link] …` сохранена БАЙТ-В-БАЙТ с Phase 0 (закреплено тестом):
    e2e тикета 15 будет перехватывать ссылку из консоли по ней. auth.ts
    пересажен на mailer — `sendVerificationRequest` теперь одна строка,
    текст письма «Вход в вашу комнату» не изменился.
  - Шаблоны `reminderGuestMail` / `occasionOwnerMail`: plain + минимальный
    светлый HTML (инлайн-стили, системный шрифт; веб-шрифты продукта в
    письма не тащим). Пользовательский ввод в HTML экранируется. Имена в
    фразах — только в именительном падеже (displayName не склоняем:
    «Мила отмечает праздник 14 марта», не «У Мила»). Дата — ru,
    UTC-сутки (`Intl.DateTimeFormat`, timeZone UTC — полночь не уезжает).
  - ИНВАРИАНТ №1/№2: письмо хозяйке не содержит НИ имён, ни вещей — шаблон
    физически принимает только `{ownerName, occasionUrl}`; под тестом
    (консольный вывод occasion-owner проверяется на отсутствие имени
    гостя/вещи/почты гостя).
- Worker:
  - `src/worker/mail.ts` — чистая `processMailJob(name, data, deps)`:
    `occasion-owner` → email из payload, пустой — добирается по userId из
    БД; displayName оттуда же; аккаунт удалён (GDPR, 14) → skip user-gone.
    `reminder-guest` → payload самодостаточен; перед отправкой два guard'а:
    бронь ещё жива (снял — skip booking-gone) и праздник ещё впереди
    (воркер пролежал — skip occasion-passed: письмо «за 3 дня» после
    праздника хуже, чем никакого). Незнакомое имя (hello и будущие) — лог
    и completed (unknown-job), заглушка hello живёт.
  - `src/worker/reminders.ts` — чистая `processReminderTick(now)`: брони с
    guestEmail в комнатах с occasionDate в окне `(date−3сут) ≤ now < date`
    (границы: ровно −3д входит, −4д и день праздника — нет; комнаты без
    даты не участвуют). Гость без email — молча пропущен.
  - **Идемпотентность БЕЗ миграции**: детерминированный jobId
    `reminder-{bookingId}-{yyyymmdd(occasionDate)}` + очередь mail хранит
    completed 14 суток (`MAIL_KEEP_COMPLETED`, removeOnComplete по
    ВОЗРАСТУ) — повторный add с тем же jobId, пока джоба жива (в т.ч.
    completed), BullMQ игнорирует. Поле `Booking.reminderSentAt`
    отвергнуто: миграции параллельно с тикетом 11 запрещены, BullMQ-дедупа
    для MVP достаточно. Из-за этого же `enqueueOccasionOwnerMail`
    переведён с removeOnComplete:1000 на возраст: count-чистка общего
    completed-набора очереди могла бы выселить дедуп-записи напоминаний
    раньше срока. Смена даты праздника внутри окна = новый jobId = второе
    письмо с новой датой — принято (каждое письмо честно несёт свою дату).
  - Регистрация (src/worker/index.ts): `upsertJobScheduler
    "reminder-tick-hourly"`, cron `30 * * * *` — сдвинут от occasion-close
    (`0 * * * *`). Тик живёт В ОЧЕРЕДИ mail (джоба `reminder-tick`, роутинг
    по имени в index) — новых имён очередей вне ARCHITECTURE §13 не
    заводим. Обработчик mail — настоящий processMailJob вместо
    console-заглушки Phase 0.
- `src/server/queues.ts` (дополнение): `ReminderGuestMailJobData`,
  `reminderGuestJobId`, не бросающий `enqueueReminderGuest` (очередь легла →
  false, следующий тик доберёт), `MAIL_KEEP_COMPLETED`.
- Тесты: tests/mailer.test.ts (9: рамки консоли, magic link байт-в-байт,
  шаблоны — имя/вещь/дата/ссылки, без «null», HTML-экранирование),
  tests/mailer.worker.test.ts (10: оба имени джоб + незнакомое, email-фолбэк
  по userId, user-gone/booking-gone/occasion-passed/bad-data, инвариант
  тихой брони в письме хозяйке), tests/reminders.test.ts (5: границы окна
  ±3д/день праздника/без даты, «без email — молча», детерминизм jobId на
  двух тиках + формат, самодостаточность payload, failed при лежащей
  очереди). Все 24 зелёные; typecheck/lint чистые.
- Живой смоук (Redis+Postgres в docker): воркер дочерним процессом, обе
  джобы поставлены (reminder — дважды с одним jobId) → в консоли ровно два
  письма (хозяйке — со ссылкой /room/occasion и без имён; гостю — с
  /my-bookings и /r/{slug}), дубль напоминания не родился, hello →
  completed(unknown-job). Скрипт смоука временный, удалён.
- Вне территории: tests/bookings.api.test.ts на момент прогона падал на
  резолве next/server — book/route.ts получил `import { auth }` (работа
  тикета 11 в полёте), а сьют ещё не мокает `@/server/auth` (ср.
  tests/api.parse.route.test.ts). К тикету 12 не относится, не трогал.
