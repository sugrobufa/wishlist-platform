// Граница «сервер → клиент»: через неё не ходят функции.
//
// ЗАЧЕМ ТЕСТ. `/room/list` падал с 500 с самого тикета 67 и молчал: серверная
// страница передавала в клиентский `RoomListView` проп-функцию
// `zoneHref={(key) => …}`, а React отвечает «Functions cannot be passed
// directly to Client Components». Ошибка РАНТАЙМОВАЯ — её не ловят ни
// `tsc`, ни `next build`, ни юниты; экран просто не открывается.
//
// Нашлась она только потому, что тикет 86 сделал ссылку «Списком» заметной
// кнопкой и владелец на неё нажал. Полгода тихого 500 — слишком дорого,
// чтобы полагаться на случай.
//
// Проверка простая и грубая: у клиентских компонентов, которые зовут из
// серверных страниц, в объявлении пропов не должно быть функциональных типов.
// Исключение — компоненты, которые монтируются только из другого КЛИЕНТСКОГО
// кода: там функции законны (`renderItemAction` у ZoneGrid, `onClick` у бирки).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

const root = fileURLToPath(new URL("../src", import.meta.url));

/** Все .ts/.tsx под src, рекурсивно. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/u.test(name) ? [full] : [];
  });
}

const all = files(root).map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** Объявляет ли модуль клиентскую границу сам. */
const declaresClient = (text: string) => /^\s*["']use client["']/mu.test(text.slice(0, 200));

/**
 * Клиентская сторона — это НЕ только файлы с "use client": всё, что они
 * импортируют, тоже уезжает в браузерный бандл, и функции внутри такого
 * поддерева законны (`onClick` у хотспота живёт именно так). Поэтому строим
 * замыкание по импортам от объявленных границ и проверяем только то, что
 * осталось снаружи, — настоящие серверные модули.
 */
function clientClosure(): Set<string> {
  const byPath = new Map(all.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const queue = all.filter(({ text }) => declaresClient(text)).map(({ path }) => path);
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const text = byPath.get(current)?.text ?? "";
    for (const match of text.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const spec = match[1] ?? "";
      // Разрешаем только свои модули: "@/…" и относительные.
      const base = spec.startsWith("@/")
        ? join(root, spec.slice(2))
        : spec.startsWith(".")
          ? join(current, "..", spec)
          : null;
      if (base === null) continue;
      for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
        if (byPath.has(candidate)) queue.push(candidate);
      }
    }
  }
  return seen;
}

const client = clientClosure();
const isServer = (path: string) => !client.has(path);

describe("функции не пересекают границу RSC", () => {
  it("серверные страницы не передают стрелок в пропы компонентов", () => {
    // Ищем ровно то, на чём подорвались: `проп={(…) => …}` в СЕРВЕРНОМ файле,
    // в JSX. Строки-шаблоны, объекты и массивы не трогаем — они ходят.
    const arrowProp = /\s[a-zA-Z][\w]*=\{\s*(?:async\s*)?\([^)]*\)\s*=>/u;
    const guilty = all
      .filter(({ path }) => isServer(path) && /\.tsx$/u.test(path))
      .filter(({ text }) => {
        // Только JSX-часть: в серверных экшенах стрелки внутри вызовов законны.
        const jsx = text.split("\n").filter((line) => arrowProp.test(line));
        return jsx.length > 0;
      })
      .map(({ path }) => path.slice(root.length + 1).split(sep).join("/"));

    expect(
      guilty,
      "функция в пропе серверного JSX — это 500 на живом экране, а не предупреждение",
    ).toEqual([]);
  });

  it("у RoomListView адрес зоны — строка, а не функция", () => {
    const view = all.find(({ path }) => path.endsWith("room-list-view.tsx"));
    expect(view, "компонент на месте").toBeTruthy();
    expect(view?.text).toMatch(/zoneHrefBase\?: string;/u);
    expect(view?.text, "функцию сюда не возвращать").not.toMatch(/zoneHref\?: \(/u);
  });
});
