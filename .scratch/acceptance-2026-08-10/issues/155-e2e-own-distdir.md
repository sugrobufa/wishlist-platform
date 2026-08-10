# 155 — у e2e свой каталог сборки: блокировка Next по КАТАЛОГУ, а не по порту

**Откуда:** постановка владельца 10.08.2026. Цена уже заплачена: один агент
потерял на этом весь заход, второй подтвердил диагноз.

> Локальный `npm run test:e2e` НЕ ЗАПУСКАЕТСЯ, пока в том же каталоге работает
> обычный `npm run dev`.

## Что там было

Симптом воспроизводился стабильно — прогон падал ещё до первого теста:

    [WebServer] ⨯ Another next dev server is already running.
    [WebServer] - Local: http://localhost:3000
    [WebServer] - PID: <pid>
    [WebServer] - Dir: C:\Wishlist\wishlist-platform
    Error: Process from config.webServer was not able to start. Exit code: 1

Next 16 держит блокировку файлом `<distDir>/dev/lock` — внутри JSON
`{"pid","port","hostname","appUrl","startedAt"}` — и запрещает ВТОРОЙ `next dev`
в том же каталоге сборки (`experimental.lockDistDir`, по умолчанию включено).
**Блокировка по КАТАЛОГУ, а не по порту**, поэтому свой порт :3100 из
`e2e/env.ts` не спасал: каталог у обоих серверов был один, `.next`.

Это молча отменяло прямо записанный контракт тикета 15 — он есть и в `CLAUDE.md`
(«e2e: playwright сам поднимает dev-сервер на :3100»), и в комментарии
`playwright.config.ts` («СВОЙ dev-сервер на своём порту: возможный чужой на :3000
не переиспользуем и не трогаем»), и в `.scratch/HANDOFF.md`. Ночной CI был зелёный
только потому, что там нет второго dev-сервера.

## Делаем

Каталог сборки разводим **постоянно**, не лесами на один прогон:

- `next.config.ts` — `distDir: process.env.NEXT_DIST_DIR ?? ".next"`. По умолчанию
  всё как было: `npm run dev`, `npm run build`, Docker со `standalone` не
  замечают правки;
- `e2e/env.ts` — константа `E2E_DIST_DIR` (`.next/e2e`) рядом с `E2E_PORT`: файл
  и так единственный источник правды по стенду;
- `playwright.config.ts` — `NEXT_DIST_DIR: E2E_DIST_DIR` в `webServer.env`.
  Переменную не нужно помнить руками, `package.json` не меняется.

Два сервера живут рядом: обычный пишет в `.next/dev`, e2e — в `.next/e2e/dev`,
свои `lock`-файлы у каждого.

## Осторожно

Оба подводных камня наблюдались, оба закрыты **осознанно**, а не подчисткой
после прогона:

1. **`next dev` со своим `distDir` ПЕРЕПИСЫВАЕТ `next-env.d.ts`** — пути внутри
   зависят от каталога (`./.next/dev/types/...` против `./.next/e2e/dev/...`).
   Стабильного содержимого у файла нет ни при каком выборе: что ни закоммить,
   второй сервер это перепишет. Поэтому файл **убран из-под гита**
   (`git rm --cached` + `.gitignore`) — ровно так велит и сам Next:
   «Add it to .gitignore. If your project already tracks the file, remove it from
   Git» (`docs/01-app/03-api-reference/05-config/02-typescript.md`).
   Проверено, что свежий чекаут БЕЗ этого файла типизируется: CI гоняет
   `typecheck` до `build`, генерируемых типов там тоже ещё нет.
2. **`tsconfig.json`** Next не переписывает, а ДОПИСЫВАЕТ недостающие пути в
   `include` и не трогает уже лежащие (`writeConfigurationDefaults`: при пустом
   списке изменений файл не пишется вовсе). Поэтому пути обоих каталогов
   положены заранее, ровно в том виде, в каком их сложил бы сам Next:
   `.next/types/**/*.ts`, `.next/dev/types/**/*.ts`, `.next/e2e/types/**/*.ts`,
   `.next/e2e/dev/types/**/*.ts`. Больше файл не мигает.
3. **`.gitignore`**: `.next/` игнорируется целиком, `.next/e2e` попадает под него
   сам — проверено `git check-ignore -v`.

Лишние копии сгенерированных типов в программе `tsc` безопасны: `.d.ts` не
проверяются (`skipLibCheck`), а `validator.ts` — модуль со своими импортами,
глобальных имён не заводит.

## Тест

Прогон целиком **при живом `npm run dev` на :3000** — то, что раньше было
невозможно, — и он же без него, как гоняет CI. После прогона `git status` чист,
`npm run typecheck` чист.
