// DTO-инварианты вещи (тикет 03). Ключевые правила CLAUDE.md:
// №1 — owner-DTO НИКОГДА не содержит booking-полей (тихая бронь);
// №8 — цена «люблю» не сериализуется вовсе, даже если осталась в БД.
// Ключи объекта перечислены СТРОГО: появление любого нового поля в DTO —
// осознанное решение с правкой этого снапшота, а не случайность.
import { describe, expect, it } from "vitest";
import { Prisma, type Item } from "@prisma/client";
import { itemForOwner, itemPhotoUrl, type OwnerItemDto } from "../src/server/dto/items";
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

// Допустимые ключи owner-DTO — исчерпывающий список по форме состояния.
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

describe("itemForOwner — строгий состав ключей", () => {
  it("«хочу»: ровно ключи формы WANT, цена строкой, isDemo: false", () => {
    const dto = itemForOwner(
      dbItem({
        price: new Prisma.Decimal("14900"),
        currency: "RUB",
        priceVisibility: "ME",
        size: "M",
        color: "золотой",
        desire: 4,
        note: "на день рождения",
      }),
    );

    expect(Object.keys(dto).sort()).toEqual(WANT_KEYS);
    expect(dto.state).toBe("WANT");
    if (dto.state !== "WANT") throw new Error("unreachable");
    expect(dto.price).toBe("14900");
    expect(typeof dto.price).toBe("string");
    expect(dto.currency).toBe("RUB");
    // ME/NONE прячут цену у гостя; хозяйке поле отдаётся всегда (тикет 07).
    expect(dto.priceVisibility).toBe("ME");
    expect(dto.desire).toBe(4);
    expect(dto.isDemo).toBe(false);
    expect(dto.hidden).toBe(false);
  });

  it("«люблю»: ровно ключи формы LOVE, receivedAt — ISO-строкой", () => {
    const dto = itemForOwner(
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
  });

  it("цена «люблю» не сериализуется вовсе — даже если в БД осталась от «хочу»", () => {
    const dto = itemForOwner(
      dbItem({
        state: "LOVE",
        price: new Prisma.Decimal("9900"),
        currency: "RUB",
        size: "S",
        desire: 3,
      }),
    );

    expect("price" in dto).toBe(false);
    expect("currency" in dto).toBe(false);
    expect("priceVisibility" in dto).toBe(false);
    expect("size" in dto).toBe(false);
    expect("color" in dto).toBe(false);
    expect("desire" in dto).toBe(false);
  });

  it("НИКОГДА никаких полей брони — даже если relation booking загружен", () => {
    // Имитация случайно подцепленного include: { booking: true }.
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

    const dto = itemForOwner(polluted);
    const keys = Object.keys(dto);

    expect(keys.sort()).toEqual(WANT_KEYS);
    // Пояс и подтяжки: ни одного booking-подобного ключа ни под каким именем.
    for (const key of keys) {
      expect(key).not.toMatch(/book|guest|taken|reserv|purchas|cancel/i);
    }
  });

  it("owner-DTO структурно совместим с ZoneGridItem (контракт сетки для тикетов 04/07)", () => {
    const dto: OwnerItemDto = itemForOwner(dbItem());
    const gridItem: ZoneGridItem = dto; // компайл-проверка контракта
    expect(gridItem.id).toBe(dto.id);
  });
});

describe("itemPhotoUrl", () => {
  it("null → null (плитка отрисует серую заливку)", () => {
    expect(itemPhotoUrl(null)).toBeNull();
    expect(itemForOwner(dbItem()).photoUrl).toBeNull();
  });

  it("путь пакета refs/… → маршрут раздачи /rooms/…", () => {
    expect(itemPhotoUrl("refs/p-vinyl.jpg")).toBe("/rooms/p-vinyl.jpg");
  });

  it("готовые URL проходят как есть", () => {
    expect(itemPhotoUrl("https://cdn.example.com/x.jpg")).toBe("https://cdn.example.com/x.jpg");
    expect(itemPhotoUrl("/uploads/x.jpg")).toBe("/uploads/x.jpg");
  });

  it("голый S3-ключ пока не превращается в битую ссылку (маршрут раздачи — тикет 04)", () => {
    expect(itemPhotoUrl("items/abc123.webp")).toBeNull();
  });
});
