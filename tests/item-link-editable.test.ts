import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { demoPools } from "../src/config/demo-pools";
import { createInputFor } from "../src/server/services/pack-seeds";

const CARD = readFileSync(
  resolve(process.cwd(), "src/app/room/zone/[zone]/i/[id]/item-card.tsx"),
  "utf8",
);
const ITEMS = readFileSync(resolve(process.cwd(), "src/server/services/items.ts"), "utf8");

/**
 * 244 — ССЫЛКУ МОЖНО ДОБАВИТЬ И ИСПРАВИТЬ.
 *
 * Приёмка владельца 14.08.2026: «не вижу, как добавить возможные точки продаж
 * данного подарка». До тикета ссылка была свойством РОЖДЕНИЯ вещи: её
 * принимало только создание. Вещь, заведённую руками, дополнить магазином
 * нельзя было никогда, ошибочную из парсера — поправить.
 *
 * Живой базой это проверяет `tests/items.update.test.ts`; здесь — что поле
 * есть во всех трёх местах сразу, потому что дырка была именно в связке.
 */
describe("244 — ссылка правится", () => {
  it("схема правки вещи КОМНАТЫ принимает ссылку", () => {
    expect(ITEMS).toMatch(/const updateRoomSchema = z\.object\(\{[\s\S]*?url: urlSchema,/u);
  });

  it("вещь СОКРОВИЩНИЦЫ ссылки не получает — звать в магазин за подаренным нечем", () => {
    const hall = /const updateHallSchema = z\.object\(\{([\s\S]*?)\}\);/u.exec(ITEMS);
    expect(hall, "схема правки витрины не найдена").toBeTruthy();
    expect((hall as RegExpExecArray)[1]).not.toContain("url");
  });

  it("запись считает производные сервером, а не берёт их с клиента", () => {
    // Правило тикета 195: url пишется как дан, canonicalUrl и domain считает
    // сервер. Клиент этих полей не отдаёт и отдать не может.
    expect(ITEMS).toContain("url: data.url ?? null,");
    expect(ITEMS).toContain("...urlMetaFor(data),");
  });

  it("поле стоит в форме и отправляется всегда — иначе ссылку нечем стереть", () => {
    expect(CARD).toContain('tField("urlLabel")');
    expect(CARD).toContain("value={url}");
    expect(CARD).toContain("url: url.trim(),");
  });
});

/**
 * 245 — НА СТЕНДЕ БЛОК «ГДЕ КУПИТЬ» ВИДНО.
 *
 * «Накидай в тестовые данные товаров с точками продаж. Сейчас совершенно не
 * вижу, как выглядит этот блок на любом предмете» — та же приёмка. Блок собран
 * с тикета 37, но посев звал `createItem` без ссылки, и показывать ему было
 * нечего ни на одной вещи.
 */
describe("245 — точки продаж в тестовых данных", () => {
  const withUrl = Object.entries(demoPools).flatMap(([pool, seeds]) =>
    seeds.filter((seed) => !seed.mine && seed.url).map((seed) => ({ pool, seed })),
  );

  it("ссылки есть, и не у одной вещи — блок должен встретиться в разных зонах", () => {
    expect(withUrl.length).toBeGreaterThanOrEqual(5);
    // Разные пулы, а не пять ссылок в одном: иначе блок виден ровно на одном
    // экране, и замечание владельца закрыто наполовину.
    expect(new Set(withUrl.map((row) => row.pool)).size).toBeGreaterThanOrEqual(5);
  });

  it("ссылки живые по форме: http(s) и домен из тех, что знает парсер", () => {
    // Домены — те шесть, что перечислены в AddItem.urlShops. Выдуманный
    // магазин на стенде учил бы неправде.
    const known = /(goldapple|wildberries|ozon|lamoda|dns-shop|market\.yandex)\.ru$/u;
    for (const { pool, seed } of withUrl) {
      const url = new URL(seed.url as string);
      expect(["http:", "https:"], `${pool}: схема ссылки`).toContain(url.protocol);
      expect(url.hostname.replace(/^www\./u, ""), `${pool}: незнакомый магазин`).toMatch(known);
    }
  });

  it("посев доносит ссылку до вещи, а «уже своё» её не получает", () => {
    const wish = withUrl[0]!.seed;
    const input = createInputFor("fashion", wish, null) as { url?: string };
    expect(input.url).toBe(wish.url);

    // У вещи витрины ссылки нет и быть не должно — она уже дома.
    const mine = Object.values(demoPools)
      .flat()
      .find((seed) => seed.mine);
    const hallInput = createInputFor("fashion", mine!, null) as { url?: string };
    expect(hallInput.url).toBeUndefined();
  });
});
