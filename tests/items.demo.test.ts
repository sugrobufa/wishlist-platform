// Демо-призраки (гриллинг №4, тикет 03): курируемые пулы покрывают все ключи
// пулов дизайн-пакета, призраки DTO-совместимы (те же строгие наборы ключей,
// что у owner-DTO) и ссылаются только на существующие предметные фото пакета.
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import zonesJson from "@design/zones.json";
import itemsJson from "@design/items.json";
import { rooms, zoneKeysHiddenByProduct } from "../src/config/design";
import { demoGhostsFor, demoPools } from "../src/config/demo-pools";

const WANT_KEYS = [
  "color",
  "currency",
  "desire",
  "hidden",
  "id",
  "isDemo",
  "note",
  "photoUrl",
  "price",
  "priceVisibility",
  "size",
  "state",
  "title",
  "zone",
];
const LOVE_KEYS = [
  "giverName",
  "hidden",
  "id",
  "inHall",
  "isDemo",
  "note",
  "photoUrl",
  "receivedAt",
  "state",
  "title",
  "zone",
];

const packagePoolKeys = (itemsJson as { demoPools: { poolKeys: string[] } }).demoPools.poolKeys;
// Пулы зон справочника — кроме тех зон, которые продукт не показывает вовсе.
// Раунд 4 дописал в справочник ключ `money` с пулом `money`, но зона скрыта
// решением владельца (PRD §12а, «деньги через сервис не ходят никогда»), и
// демо-вещей для неё нет и не должно быть: см. zoneKeysHiddenByProduct.
const zonesPoolKeys = Object.entries(
  (zonesJson as unknown as { keys: Record<string, [string, string, string, string, string]> })
    .keys,
)
  .filter(([key]) => !zoneKeysHiddenByProduct.includes(key))
  .map(([, row]) => row[3]);
const roomPoolKeys = rooms.flatMap((room) => room.zones.map((zone) => zone.pool));

describe("demoPools — покрытие пулов дизайн-пакета", () => {
  it("есть все 18 ключей из items.json → demoPools.poolKeys, лишних нет", () => {
    expect(Object.keys(demoPools).sort()).toEqual([...packagePoolKeys].sort());
  });

  it("каждый пул, на который ссылаются zones.json и rooms.json, наполнен", () => {
    for (const key of new Set([...zonesPoolKeys, ...roomPoolKeys])) {
      expect(demoPools[key], `пул ${key}`).toBeDefined();
    }
  });

  it("в пуле 3–5 вещей, есть и «люблю», и «хочу»; у «хочу» — цена в рублях", () => {
    for (const poolKey of Object.keys(demoPools)) {
      const ghosts = demoGhostsFor("test-zone", poolKey);
      expect(ghosts.length, `пул ${poolKey}`).toBeGreaterThanOrEqual(3);
      expect(ghosts.length, `пул ${poolKey}`).toBeLessThanOrEqual(5);

      const love = ghosts.filter((ghost) => ghost.state === "LOVE");
      const want = ghosts.filter((ghost) => ghost.state === "WANT");
      expect(love.length, `«люблю» в пуле ${poolKey}`).toBeGreaterThan(0);
      expect(want.length, `«хочу» в пуле ${poolKey}`).toBeGreaterThan(0);

      for (const ghost of want) {
        if (ghost.state !== "WANT") continue;
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
        expect(Object.keys(ghost).sort()).toEqual(ghost.state === "WANT" ? WANT_KEYS : LOVE_KEYS);
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
