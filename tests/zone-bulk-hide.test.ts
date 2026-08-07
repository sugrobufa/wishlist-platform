// Массовое скрытие вещей (тикет 74, турн 29b).
//
// ЗАЧЕМ ТЕСТ. Условие тикета звучит так: массовое скрытие ОБЯЗАНО ходить той же
// дорогой, что одиночное, — через `setItemHidden`. Это не про красоту: при
// скрытии сервис снимает активную бронь (`releaseBookingForItem`, контракт
// тикета 09), и свой batch-update молча оставил бы брони висеть. Ровно эта
// «дыра до тикета 13» однажды уже чинилась.
//
// Проверка идёт по ИСТОЧНИКУ, а не по БД: юнит-набор поднимается без docker,
// а вопрос здесь структурный — какой функцией ходит операция.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const service = read("../src/server/services/items.ts");
const action = read("../src/app/room/zone/[zone]/actions.ts");
const grid = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");

/** Тело функции сервиса по имени — от сигнатуры до следующей на верхнем уровне. */
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `в items.ts нет ${name}`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("массовое скрытие ходит той же дорогой", () => {
  const bulk = body(service, "setItemsHidden");

  it("зовёт setItemHidden, а не свой update", () => {
    expect(bulk).toMatch(/await setItemHidden\(userId, id, hidden\);/u);
    expect(bulk, "своего prisma.item.update тут быть не должно").not.toMatch(/prisma\.item/u);
    expect(bulk, "и своего снятия броней тоже — оно внутри setItemHidden").not.toMatch(
      /releaseBooking/u,
    );
  });

  it("одиночное скрытие по-прежнему снимает бронь — дорога, которой ходит массовое", () => {
    const single = body(service, "setItemHidden");
    expect(single).toMatch(/await releaseBookingForItem\(item\.id\);/u);
  });

  it("список проверяется Zod и ограничен сверху — не заглушка", () => {
    expect(bulk).toMatch(/z\.array\(z\.string\(\)\.min\(1\)\)\.min\(1\)\.max\(200\)\.parse\(itemIds\)/u);
  });

  it("чужая вещь роняет всю операцию, а не половину", () => {
    // requireOwnItem внутри setItemHidden бросает — цикл не глотает ошибок.
    expect(bulk, "try/catch внутри цикла превратил бы отказ в тишину").not.toMatch(/catch/u);
  });
});

describe("экшен и экран", () => {
  it("экшен тонкий: сессия, вызов сервиса, перевод отказа в код", () => {
    expect(action).toMatch(/export async function setItemsHiddenAction\(/u);
    expect(action).toMatch(/await setItemsHidden\(userId, itemIds\.map\(String\), Boolean\(hidden\)\);/u);
    expect(action).toMatch(/if \(!userId\) return \{ error: "AUTH" \};/u);
  });

  it("экран зовёт массовый экшен, а не цикл одиночных", () => {
    expect(grid).toMatch(/await setItemsHiddenAction\(ids, true\)/u);
    // Ровно один вызов: цикл по вещам на клиенте — это N круговых поездок и
    // половинчатый результат при обрыве.
    expect([...grid.matchAll(/setItemsHiddenAction\(/gu)]).toHaveLength(1);
  });

  it("демо-призраки в выбор не попадают: их нет в БД", () => {
    expect(grid).toMatch(/const pickable = shown\.filter\(\(item\) => !item\.isDemo\);/u);
    expect(grid).toMatch(/const ids = pickable\.filter\(\(item\) => picked\.has\(item\.id\)\)/u);
  });
});

describe("гостевой фильтр «только свободные»", () => {
  const view = read("../src/components/room-list/room-list-view.tsx");
  const guest = read("../src/app/r/[slug]/list/guest-room-list.tsx");
  const ownerList = read("../src/app/room/list/page.tsx");

  it("фильтрует по отсутствию брони и только среди «хочу»", () => {
    expect(view).toMatch(/item\.state === "WANT" && !takenIds\.has\(item\.id\)/u);
  });

  it("набор занятых приходит из канала броней, а не из кэшируемой страницы", () => {
    expect(guest).toMatch(/const \{ taken \} = useGuestBooking\(\);/u);
    expect(guest).toMatch(/<GuestBookingProvider slug=\{slug\}>/u);
  });

  it("ХОЗЯЙКЕ набор занятых не передаётся — инвариант №1", () => {
    expect(ownerList, "у хозяйки только счётчик по комнате").not.toMatch(/takenIds/u);
    // И сам переключатель без набора не рисуется.
    expect(view).toMatch(/\{takenIds && \(/u);
  });
});
