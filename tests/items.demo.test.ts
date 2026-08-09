// Демо-призраки (гриллинг №4, тикет 03): курируемые пулы покрывают все ключи
// пулов дизайн-пакета, призраки DTO-совместимы (те же строгие наборы ключей,
// что у owner-DTO) и ссылаются только на существующие предметные фото пакета.
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import zonesJson from "@design/zones.json";
import { rooms, zoneKeysHiddenByProduct } from "../src/config/design";
import { demoGhostsFor, demoPools } from "../src/config/demo-pools";

// `createdAt` приехал вместе с карточкой вещи хозяйки (тикет 39): у призрака
// он постоянный — призрака нет в БД, и «В комнате с» ему нечем считать.
// ПЕРЕПИСАНО (тикет 124): наборов ключей было два — по одному на состояние.
// Состояний нет, и все призраки теперь одной формы — вещь КОМНАТЫ
// (`inHall: false`). Витринных призраков не бывает: призрак рисуется в зоне,
// а зона показывает комнату.
const ROOM_KEYS = [
  "color",
  "createdAt",
  "currency",
  "desire",
  // Услуга-впечатление (тикет 97): у призрака поля пусты, но форма owner-DTO
  // одна на всех — ключи есть.
  "eventWhen",
  "eventWhere",
  "hidden",
  "id",
  "inHall",
  "isDemo",
  "note",
  "photoUrl",
  "price",
  "priceVisibility",
  "size",
  "title",
  "validUntil",
  "zone",
];

// Список ключей пулов брался из `items.json → demoPools.poolKeys`; в модели
// v2 (раунд 28) этого раздела в контракте нет вовсе — дизайн описывает вещь,
// а не наши демо-наборы. Ключи проверяем по СПРАВОЧНИКУ ЗОН, который их и
// назначает: он остаётся источником правды, и лишний пул он тоже поймает.
const PACKAGE_POOL_COUNT = 19;

/**
 * Пулы зон справочника — кроме тех зон, которые продукт не показывает вовсе,
 * и кроме зоны «Просто деньги».
 *
 * Раунд 4 дописал в справочник ключ `money` с пулом `money`, которого нет в
 * пакете. Пока зона была скрыта (ADR-0004), пустой пул никого не смущал.
 * ADR-0008 зону включил — и пул остаётся пустым СОЗНАТЕЛЬНО: пустоту этой
 * зоны заполняет не выдуманная вещь, а карточка копилки на мечту
 * (components/zone/money-goal-card). Демо-призрак «пример: 3 000 ₽» обещал бы
 * ровно тот перевод, которого в продукте нет (PRD §12а).
 */
const MONEY_POOL = "money";
const zonesPoolKeys = Object.entries(
  (zonesJson as unknown as { keys: Record<string, [string, string, string, string, string]> })
    .keys,
)
  .filter(([key]) => !zoneKeysHiddenByProduct.includes(key) && key !== MONEY_POOL)
  .map(([, row]) => row[3]);
const roomPoolKeys = rooms
  .flatMap((room) => room.zones.map((zone) => zone.pool))
  .filter((pool) => pool !== MONEY_POOL);

describe("demoPools — покрытие пулов дизайн-пакета", () => {
  it("есть все 19 ключей справочника зон, лишних нет", () => {
    const fromPackage = [...new Set([...zonesPoolKeys, ...roomPoolKeys])].sort();
    expect(Object.keys(demoPools).sort()).toEqual(fromPackage);
    expect(fromPackage).toHaveLength(PACKAGE_POOL_COUNT);
  });

  it("«Уход» смотрит в свой пул grooming — мужская комната без свечи с инжиром", () => {
    // Девятнадцатый пул (раунд 8, тикет 53; состав — ответ дизайна, ОТВЕТ-раунд-8
    // §4). До него зона «Уход» четырёх мужских комнат брала пул `perfume`, и
    // мужчина открывал «Уход» на «Свече с инжиром» и «Диффузоре для дома».
    const groomingRow = (
      zonesJson as unknown as { keys: Record<string, [string, string, string, string, string]> }
    ).keys.grooming;
    expect(groomingRow).toBeDefined();
    expect(groomingRow?.[3]).toBe("grooming");

    const ghosts = demoGhostsFor("grooming", "grooming");
    expect(ghosts).toHaveLength(5);
    // ПЕРЕПИСАНО (тикет 124): проверка «два „люблю" в пуле» умерла вместе с
    // состояниями. Осталось то, ради чего пул и заводили, — свой состав.
    const titles = ghosts.map((ghost) => ghost.title);
    expect(titles).not.toContain("Свеча с инжиром");
    expect(titles).not.toContain("Диффузор для дома");
  });

  it("каждый пул, на который ссылаются zones.json и rooms.json, наполнен", () => {
    for (const key of new Set([...zonesPoolKeys, ...roomPoolKeys])) {
      expect(demoPools[key], `пул ${key}`).toBeDefined();
    }
  });

  // ПЕРЕПИСАНО (тикет 124): «в пуле есть оба состояния» проверять нечем.
  // Осталось два требования и оба про содержимое: размер пула и то, что
  // названная цена — настоящие рубли (семя без цены её и не называет).
  it("в пуле 3–5 вещей; у названной цены — рубли и число больше нуля", () => {
    for (const poolKey of Object.keys(demoPools)) {
      const ghosts = demoGhostsFor("test-zone", poolKey);
      expect(ghosts.length, `пул ${poolKey}`).toBeGreaterThanOrEqual(3);
      expect(ghosts.length, `пул ${poolKey}`).toBeLessThanOrEqual(5);

      const priced = ghosts.filter((ghost) => !ghost.inHall && ghost.price !== null);
      expect(priced.length, `цены в пуле ${poolKey}`).toBeGreaterThan(0);
      for (const ghost of priced) {
        if (ghost.inHall) continue;
        expect(Number(ghost.price), `цена «${ghost.title}»`).toBeGreaterThan(0);
        expect(ghost.currency).toBe("RUB");
      }
    }
  });
});

describe("demoGhostsFor — DTO-совместимость", () => {
  it("ключи призраков совпадают со строгими наборами owner-DTO, isDemo: true", () => {
    for (const poolKey of Object.keys(demoPools)) {
      for (const ghost of demoGhostsFor("jewelry", poolKey)) {
        // Форма одна: призрак всегда вещь КОМНАТЫ (тикет 124).
        expect(Object.keys(ghost).sort()).toEqual(ROOM_KEYS);
        expect(ghost.inHall).toBe(false);
        expect(ghost.isDemo).toBe(true);
        expect(ghost.hidden).toBe(false);
        expect(ghost.zone).toBe("jewelry");
      }
    }
  });

  it("id стабильны и уникальны внутри зоны; результат детерминирован", () => {
    const first = demoGhostsFor("jewelry", "jewel");
    const second = demoGhostsFor("jewelry", "jewel");
    expect(second).toEqual(first);

    const ids = first.map((ghost) => ghost.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^demo:jewelry:\d+$/);
    }
  });

  it("фото — только существующие предметные кадры пакета через /rooms/…", () => {
    const refsDir = resolve(__dirname, "../design/package/refs");
    for (const poolKey of Object.keys(demoPools)) {
      for (const ghost of demoGhostsFor("z", poolKey)) {
        if (ghost.photoUrl === null) continue;
        const match = ghost.photoUrl.match(/^\/rooms\/(p-[a-z0-9-]+\.jpg)$/);
        expect(match, `photoUrl «${ghost.title}»: ${ghost.photoUrl}`).not.toBeNull();
        const file = (match as RegExpMatchArray)[1] as string;
        expect(existsSync(resolve(refsDir, file)), `нет файла ${file}`).toBe(true);
      }
    }
  });

  it("неизвестный пул — пустой список, не падение", () => {
    expect(demoGhostsFor("z", "nosuchpool")).toEqual([]);
  });
});
