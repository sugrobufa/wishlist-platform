// DTO-инварианты вещи (тикет 03). Ключевые правила CLAUDE.md:
// №1 — owner-DTO НИКОГДА не содержит booking-полей (тихая бронь);
// №8 — цена вещи СОКРОВИЩНИЦЫ не сериализуется вовсе, даже если осталась
//      в БД от жизни вещи в комнате (тикет 124: переезд цену не стирает,
//      он её перестаёт показывать — «Вернуть в комнату» покажет снова).
// Ключи объекта перечислены СТРОГО: появление любого нового поля в DTO —
// осознанное решение с правкой этого снапшота, а не случайность.
//
// ФОРМ ПО-ПРЕЖНЕМУ ДВЕ, но различает их МЕСТО (`inHall`), а не состояние.
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
    inHall: false,
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
    eventWhen: null,
    eventWhere: null,
    validUntil: null,
    giverName: null,
    receivedAt: null,
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
// `createdAt` — «В комнате с {год}» в карточке вещи хозяйки (тикет 39,
// турн 8c). Поле owner-only: гостевой DTO собирается своим allowlist'ом и
// про дату появления вещи по-прежнему ничего не знает.
const ROOM_KEYS = [
  "color",
  "createdAt",
  "currency",
  "desire",
  // Услуга-впечатление (тикет 97): три необязательных поля живут у вещи
  // комнаты, как размер и цвет. Пустые не рисуются, но КЛЮЧИ у формы есть
  // всегда — allowlist перечисляет форму, а не заполненность.
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
// ПЕРЕПИСАНО 09.08.2026 вместе с починкой стирания полей впечатления.
// «Когда · Где · Годен до» переехали из формы КОМНАТЫ в общую часть, и у
// витрины эти ключи теперь тоже есть. Причина не косметическая: `updateItem`
// пишет их безусловно, поэтому карточка, которая их не ЗНАЕТ, стирает их при
// первом же сохранении — а витринную вещь правят (даритель, год). Сертификат,
// уехавший на витрину после «Дошло», не перестаёт истекать.
const HALL_KEYS = [
  "createdAt",
  "eventWhen",
  "eventWhere",
  "giverName",
  "hidden",
  "id",
  "inHall",
  "isDemo",
  "note",
  "photoUrl",
  "receivedAt",
  "title",
  "validUntil",
  "zone",
];

describe("itemForOwner — строгий состав ключей", () => {
  it("вещь комнаты: ровно ключи формы КОМНАТЫ, цена строкой, isDemo: false", () => {
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

    expect(Object.keys(dto).sort()).toEqual(ROOM_KEYS);
    expect(dto.inHall).toBe(false);
    if (dto.inHall) throw new Error("unreachable");
    expect(dto.price).toBe("14900");
    expect(typeof dto.price).toBe("string");
    expect(dto.currency).toBe("RUB");
    // ME/NONE прячут цену у гостя; хозяйке поле отдаётся всегда (тикет 07).
    expect(dto.priceVisibility).toBe("ME");
    expect(dto.desire).toBe(4);
    expect(dto.isDemo).toBe(false);
    expect(dto.hidden).toBe(false);
    expect(dto.createdAt).toBe("2026-01-10T10:00:00.000Z");
  });

  it("вещь сокровищницы: ровно ключи формы ВИТРИНЫ, receivedAt — ISO-строкой", () => {
    const dto = itemForOwner(
      dbItem({
        inHall: true,
        title: "Теннисный браслет",
        giverName: "мама",
        receivedAt: new Date("2024-03-08T10:00:00.000Z"),
      }),
    );

    expect(Object.keys(dto).sort()).toEqual(HALL_KEYS);
    expect(dto.inHall).toBe(true);
    if (!dto.inHall) throw new Error("unreachable");
    expect(dto.giverName).toBe("мама");
    expect(dto.receivedAt).toBe("2024-03-08T10:00:00.000Z");
  });

  it("цена витринной вещи не сериализуется — хотя в БД осталась (тикет 124)", () => {
    const dto = itemForOwner(
      dbItem({
        inHall: true,
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

    expect(keys.sort()).toEqual(ROOM_KEYS);
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

  it("голый S3-ключ → маршрут раздачи /media/{key} (тикет 04)", () => {
    expect(itemPhotoUrl("items/room_1/abc123.webp")).toBe("/media/items/room_1/abc123.webp");
    expect(itemPhotoUrl("items/abc123.webp")).toBe("/media/items/abc123.webp");
  });
});
