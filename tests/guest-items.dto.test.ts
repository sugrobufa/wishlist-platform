// Guest-DTO-инварианты вещи (тикет 07). Ключевые правила CLAUDE.md:
// №1 — никаких booking-полей (тихая бронь; «занято» — отдельный канал, тикет 08);
// №5 — флаг hidden гостю не отдаётся даже ключом (фильтр — в сервисе);
// №8 — цена «люблю» не сериализуется никому; цена «хочу» — по priceVisibility,
//      причём скрытая цена = ключей price/currency нет вовсе;
// №6 — ссылка на магазин (тикет 37) отдаётся только канонической, а домен —
//      из неё же, а не из пользовательского ввода и не из колонки domain.
// Ключи объекта перечислены СТРОГО: новое поле в guest-DTO — осознанное
// решение с правкой этих снапшотов, а не случайность.
import { describe, expect, it } from "vitest";
import { Prisma, type Item } from "@prisma/client";
import {
  ghostForGuest,
  guestSeesPrice,
  guestShop,
  itemForGuest,
  type GuestItemDto,
} from "../src/server/dto/guest-items";
import { demoGhostsFor } from "../src/config/demo-pools";
import type { ZoneGridItem } from "../src/components/zone/types";

/** Полный Item, как из БД; поля перекрываются точечно. */
function dbItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item_1",
    roomId: "room_1",
    zone: "jewelry",
    state: "WANT",
    title: "Серьги-кольца",
    note: null,
    photoKey: null,
    url: null,
    canonicalUrl: null,
    domain: null,
    price: null,
    currency: null,
    priceVisibility: "ALL",
    size: null,
    color: null,
    desire: null,
    giverName: null,
    receivedAt: null,
    inHall: false,
    hiddenFromHall: false,
    hidden: false,
    source: "MANUAL",
    catalogProductId: null,
    priceCheckedAt: null,
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
    updatedAt: new Date("2026-01-10T10:00:00.000Z"),
    ...overrides,
  };
}

// Допустимые ключи guest-DTO — исчерпывающие списки по форме.
const WANT_KEYS_PRICED = [
  "color",
  "currency",
  "desire",
  "id",
  "isDemo",
  "note",
  "photoUrl",
  "price",
  "size",
  "state",
  "title",
  "zone",
];
const WANT_KEYS_PRICE_HIDDEN = [
  "color",
  "desire",
  "id",
  "isDemo",
  "note",
  "photoUrl",
  "size",
  "state",
  "title",
  "zone",
];
/** То же «хочу» с видимой ценой, но пришедшее по ссылке из магазина. */
const WANT_KEYS_PRICED_SHOP = [...WANT_KEYS_PRICED, "shop"].sort();
const LOVE_KEYS = [
  "giverName",
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

/** Вещь, добавленная по ссылке: url — сырой ввод, canonicalUrl — счёт сервера. */
const fromShop = (overrides: Partial<Item> = {}): Partial<Item> => ({
  source: "URL",
  url: "https://WWW.GoldApple.ru/19000175823?utm_source=vk#top",
  canonicalUrl: "https://www.goldapple.ru/19000175823",
  domain: "goldapple.ru",
  price: new Prisma.Decimal("14900"),
  currency: "RUB",
  ...overrides,
});

// Пояс и подтяжки поверх снапшотов: ни настроек хозяйки, ни следов брони.
function expectNoOwnerOrBookingKeys(dto: GuestItemDto) {
  expect("hidden" in dto).toBe(false);
  expect("priceVisibility" in dto).toBe(false);
  for (const key of Object.keys(dto)) {
    expect(key).not.toMatch(/hidden|visib|book|guest|taken|reserv|purchas|cancel/i);
  }
}

describe("itemForGuest — строгий состав ключей", () => {
  it("«хочу» с ценой ALL: ровно ключи формы, цена строкой", () => {
    const dto = itemForGuest(
      dbItem({
        price: new Prisma.Decimal("14900"),
        currency: "RUB",
        priceVisibility: "ALL",
        size: "M",
        color: "золотой",
        desire: 4,
        note: "на день рождения",
      }),
    );

    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICED);
    expect(dto.state).toBe("WANT");
    if (dto.state !== "WANT") throw new Error("unreachable");
    expect(dto.price).toBe("14900");
    expect(typeof dto.price).toBe("string");
    expect(dto.currency).toBe("RUB");
    expect(dto.desire).toBe(4);
    expect(dto.isDemo).toBe(false);
    expectNoOwnerOrBookingKeys(dto);
  });

  it("FRIENDS в Phase 1 = ALL: цена отдаётся (TODO градации связей — в DTO)", () => {
    expect(guestSeesPrice("FRIENDS")).toBe(true);
    const dto = itemForGuest(
      dbItem({ price: new Prisma.Decimal("500"), currency: "RUB", priceVisibility: "FRIENDS" }),
    );
    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICED);
  });

  it.each(["ME", "NONE"] as const)(
    "«хочу» с priceVisibility=%s: ключей price/currency НЕТ вовсе",
    (visibility) => {
      expect(guestSeesPrice(visibility)).toBe(false);
      const dto = itemForGuest(
        dbItem({
          price: new Prisma.Decimal("14900"),
          currency: "RUB",
          priceVisibility: visibility,
        }),
      );

      expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICE_HIDDEN);
      expect("price" in dto).toBe(false);
      expect("currency" in dto).toBe(false);
      expectNoOwnerOrBookingKeys(dto);
    },
  );

  it("«люблю»: ровно ключи формы LOVE, receivedAt — ISO-строкой", () => {
    const dto = itemForGuest(
      dbItem({
        state: "LOVE",
        title: "Теннисный браслет",
        giverName: "мама",
        receivedAt: new Date("2024-03-08T10:00:00.000Z"),
        inHall: true,
      }),
    );

    expect(Object.keys(dto).sort()).toEqual(LOVE_KEYS);
    expect(dto.state).toBe("LOVE");
    if (dto.state !== "LOVE") throw new Error("unreachable");
    expect(dto.giverName).toBe("мама");
    expect(dto.receivedAt).toBe("2024-03-08T10:00:00.000Z");
    expect(dto.inHall).toBe(true);
    expectNoOwnerOrBookingKeys(dto);
  });

  it("цена «люблю» не течёт гостю — даже если в БД осталась от «хочу» и стоит ALL", () => {
    const dto = itemForGuest(
      dbItem({
        state: "LOVE",
        price: new Prisma.Decimal("9900"),
        currency: "RUB",
        priceVisibility: "ALL",
        size: "S",
        desire: 3,
      }),
    );

    expect(Object.keys(dto).sort()).toEqual(LOVE_KEYS);
    expect("price" in dto).toBe(false);
    expect("currency" in dto).toBe(false);
    expect("size" in dto).toBe(false);
    expect("desire" in dto).toBe(false);
  });

  it("спрятанная вещь не уносит флага: ключа hidden в guest-форме не существует", () => {
    // Фильтр hidden — в сервисе; DTO страхует второй линией (allowlist).
    const dto = itemForGuest(dbItem({ hidden: true }));
    expect("hidden" in dto).toBe(false);
    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICED);
  });

  it("НИКОГДА никаких полей брони — даже если relation booking загружен", () => {
    const polluted = Object.assign(dbItem({ price: new Prisma.Decimal("500") }), {
      booking: {
        id: "booking_1",
        guestName: "Оля",
        guestEmail: "olya@example.com",
        mode: "QUIET",
        purchased: true,
        cancelToken: "secret",
      },
    });

    const dto = itemForGuest(polluted);
    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICED);
    expectNoOwnerOrBookingKeys(dto);
  });

  it("guest-DTO структурно совместим с ZoneGridItem (сетка тикета 03 берёт его как есть)", () => {
    const dto: GuestItemDto = itemForGuest(dbItem());
    const gridItem: ZoneGridItem = dto; // компайл-проверка контракта
    expect(gridItem.id).toBe(dto.id);
  });
});

describe("guestShop — ссылка на магазин (тикет 37)", () => {
  it("домен — хост канонического адреса без «www.»", () => {
    expect(guestShop("https://www.goldapple.ru/19000175823")).toEqual({
      url: "https://www.goldapple.ru/19000175823",
      domain: "goldapple.ru",
    });
  });

  it("ссылки нет — нет и магазина", () => {
    expect(guestShop(null)).toBeNull();
    expect(guestShop("")).toBeNull();
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>", "file:///etc/passwd", "не ссылка"])(
    "не http(s)-адрес (%s) магазина не даёт вовсе",
    (raw) => {
      expect(guestShop(raw)).toBeNull();
    },
  );
});

describe("itemForGuest — где купить (тикет 37)", () => {
  it("«хочу» с открытой ценой: ключ shop есть, домен из canonicalUrl", () => {
    const dto = itemForGuest(dbItem(fromShop()));

    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICED_SHOP);
    if (dto.state !== "WANT") throw new Error("unreachable");
    expect(dto.shop).toEqual({
      url: "https://www.goldapple.ru/19000175823",
      domain: "goldapple.ru",
    });
    expectNoOwnerOrBookingKeys(dto);
  });

  it("сырой Item.url наружу не идёт ни адресом, ни доменом (инвариант №6)", () => {
    const dto = itemForGuest(dbItem(fromShop()));
    if (dto.state !== "WANT") throw new Error("unreachable");
    // Пользовательский ввод нёс трекинг-параметр, фрагмент и верхний регистр —
    // гостю уезжает только то, что посчитал сервер.
    expect(JSON.stringify(dto)).not.toContain("utm_source");
    expect(JSON.stringify(dto)).not.toContain("GoldApple");
    expect("url" in dto).toBe(false);
    expect("canonicalUrl" in dto).toBe(false);
    expect("domain" in dto).toBe(false);
  });

  it("вещь без канонического адреса (добавлена руками) магазина не отдаёт", () => {
    const dto = itemForGuest(
      dbItem({
        source: "MANUAL",
        url: "https://ozon.ru/product/1",
        canonicalUrl: null,
        domain: null,
        price: new Prisma.Decimal("14900"),
        currency: "RUB",
      }),
    );

    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICED);
    expect("shop" in dto).toBe(false);
  });

  it.each(["ME", "NONE"] as const)(
    "«хочу» со скрытой ценой (%s): ссылки НЕТ — она открыла бы цену страницей магазина",
    (visibility) => {
      const dto = itemForGuest(dbItem(fromShop({ priceVisibility: visibility })));

      expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICE_HIDDEN);
      expect("shop" in dto).toBe(false);
      expect(JSON.stringify(dto)).not.toContain("goldapple");
    },
  );

  it("«люблю»: ссылки нет никогда — даже с ценой ALL и живым canonicalUrl", () => {
    // ADR-0004: дверь для «люблю» открывает настройка зала (тикет 35), а не
    // отдельное правило про ссылки. Пока настройки нет — нет и ссылки.
    const dto = itemForGuest(dbItem(fromShop({ state: "LOVE", priceVisibility: "ALL" })));

    expect(Object.keys(dto).sort()).toEqual(LOVE_KEYS);
    expect("shop" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("goldapple");
  });

  it("спрятанная вещь: наружу не уходит ничего — ни флага, ни ссылки", () => {
    // Сама спрятанная вещь до гостя не доезжает (фильтр в guest-room.ts);
    // здесь — вторая линия: форма не несёт ни hidden, ни следа настроек.
    const dto = itemForGuest(dbItem(fromShop({ hidden: true, priceVisibility: "NONE" })));

    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS_PRICE_HIDDEN);
    expect("hidden" in dto).toBe(false);
    expect("shop" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("goldapple");
  });
});

describe("ghostForGuest — демо-призраки в guest-форме", () => {
  const ghosts = demoGhostsFor("jewelry", "jewel").map(ghostForGuest);

  it("призраки помечены isDemo и не несут ключей хозяйки", () => {
    expect(ghosts.length).toBeGreaterThan(0);
    for (const ghost of ghosts) {
      expect(ghost.isDemo).toBe(true);
      expectNoOwnerOrBookingKeys(ghost);
    }
  });

  it("формы призраков — те же строгие словари, что у настоящих вещей", () => {
    for (const ghost of ghosts) {
      const keys = Object.keys(ghost).sort();
      if (ghost.state === "WANT") {
        // Цены пулов открыты (ALL в demo-pools) — у WANT-призрака цена есть.
        expect(keys).toEqual(WANT_KEYS_PRICED);
        expect(typeof ghost.price).toBe("string");
        expect(ghost.currency).toBe("RUB");
      } else {
        expect(keys).toEqual(LOVE_KEYS);
        expect("price" in ghost).toBe(false);
      }
    }
  });
});
