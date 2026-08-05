// Стоимость в зале славы (тикет 35, ADR-0004, доска — турн 12d).
//
// Что здесь защищается:
// - ГОСТЬ не видит цену подарка, пока хозяйка не открыла её настройкой зала
//   (инвариант №8 в формулировке ADR-0004) — обязательный тест тикета;
// - скрытие цены у ОТДЕЛЬНОЙ вещи перекрывает открытый зал («даже если весь
//   зал её показывает»), а обратно — не расширяет;
// - хозяйке её собственные цены видны ВСЕГДА, при любом положении настройки;
// - округление — только показ: сумма зала складывается по точным Decimal и
//   округляется уже готовой (иначе «около» каждой вещи копится в ошибку);
// - деньги остаются Decimal-строкой и во float по дороге не превращаются.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, type Item } from "@prisma/client";

// Вне Next-рантайма кэша нет: unstable_cache — сквозной, revalidateTag молчит
// (тот же приём, что в tests/guest-room.service.test.ts).
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
  revalidateTag: () => undefined,
}));

import { prisma } from "../src/server/db";
import {
  guestSeesHallItemPrice,
  guestSeesHallPrice,
  hallItemForOwner,
  hallSettingsOf,
  hallTotals,
  roundHallPrice,
  type HallSettings,
} from "../src/server/dto/hall";
import { itemForGuest } from "../src/server/dto/guest-items";
import { getGuestRoom } from "../src/server/services/guest-room";
import { setHallSettings } from "../src/server/services/rooms";
import { ItemMutationError, setHallPriceHidden } from "../src/server/services/items";

const TEST_EMAIL_DOMAIN = "@hall-prices.test";

/** Полный Item, как из БД; поля перекрываются точечно. */
function dbItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item_1",
    roomId: "room_1",
    zone: "bags",
    state: "LOVE",
    title: "Стёганая сумка, кремовая кожа",
    note: null,
    photoKey: null,
    url: null,
    canonicalUrl: null,
    domain: null,
    price: new Prisma.Decimal("62000"),
    currency: "RUB",
    priceVisibility: "ALL",
    size: null,
    color: null,
    desire: null,
    giverName: "мама",
    receivedAt: new Date("2025-03-14T12:00:00.000Z"),
    inHall: true,
    hiddenFromHall: false,
    hidden: false,
    source: "MANUAL",
    catalogProductId: null,
    priceCheckedAt: null,
    createdAt: new Date("2025-03-14T12:00:00.000Z"),
    updatedAt: new Date("2025-03-14T12:00:00.000Z"),
    ...overrides,
  };
}

const OPEN_HALL: HallSettings = {
  priceVisibility: "ALL",
  totalShown: true,
  giverShown: true,
  roundPrices: false,
};

// ====================================================================
// Гость: дверь открывает настройка зала, и только она
// ====================================================================

describe("гость и цена подарка", () => {
  it("без контекста зала цены нет вовсе — форма ведёт себя как до тикета 35", () => {
    const dto = itemForGuest(dbItem());
    expect("price" in dto).toBe(false);
    expect("currency" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("62000");
  });

  it.each(["FRIENDS", "ME", "NONE"] as const)(
    "настройка зала %s: ключей price/currency у гостя НЕТ",
    (visibility) => {
      const dto = itemForGuest(dbItem(), { priceVisibility: visibility });
      expect("price" in dto).toBe(false);
      expect("currency" in dto).toBe(false);
      expect(JSON.stringify(dto)).not.toContain("62000");
    },
  );

  it("FRIENDS в Phase 1 закрыт — иначе дефолт настройки стал бы «всем»", () => {
    // ADR-0004: дефолт обязан быть «только друзьям», а не «всем». Связей,
    // по которым можно отличить своего, в Phase 1 ещё нет.
    expect(guestSeesHallPrice("FRIENDS")).toBe(false);
    expect(guestSeesHallPrice("ME")).toBe(false);
    expect(guestSeesHallPrice("NONE")).toBe(false);
    expect(guestSeesHallPrice("ALL")).toBe(true);
  });

  it("настройка зала ALL: цена приезжает строкой Decimal, валюта — отдельным полем", () => {
    const dto = itemForGuest(dbItem(), { priceVisibility: "ALL" });
    if (dto.state !== "LOVE") throw new Error("unreachable");
    expect(dto.price).toBe("62000");
    expect(typeof dto.price).toBe("string");
    expect(dto.currency).toBe("RUB");
  });

  it.each(["ME", "NONE"] as const)(
    "цена скрыта у самой вещи (%s) — открытый зал её не открывает",
    (itemVisibility) => {
      expect(guestSeesHallItemPrice("ALL", itemVisibility)).toBe(false);
      const dto = itemForGuest(dbItem({ priceVisibility: itemVisibility }), {
        priceVisibility: "ALL",
      });
      expect("price" in dto).toBe(false);
      expect("currency" in dto).toBe(false);
    },
  );

  it("вещь шире зала не становится: ALL у вещи при закрытом зале ничего не даёт", () => {
    expect(guestSeesHallItemPrice("NONE", "ALL")).toBe(false);
    expect(guestSeesHallItemPrice("FRIENDS", "ALL")).toBe(false);
  });

  it("цена «хочу» живёт по своему правилу — настройка зала её не трогает", () => {
    // Инвариант №8 в части «хочу» не менялся: ALL/FRIENDS отдают цену.
    const want = itemForGuest(
      dbItem({ state: "WANT", priceVisibility: "FRIENDS", giverName: null, receivedAt: null }),
      { priceVisibility: "NONE" },
    );
    if (want.state !== "WANT") throw new Error("unreachable");
    expect(want.price).toBe("62000");
  });
});

// ====================================================================
// Хозяйка: цена видна всегда, значок говорит про остальных
// ====================================================================

describe("витрина глазами хозяйки", () => {
  it.each(["ALL", "FRIENDS", "ME", "NONE"] as const)(
    "при настройке %s хозяйка видит свою цену",
    (visibility) => {
      const view = hallItemForOwner(dbItem(), { ...OPEN_HALL, priceVisibility: visibility }, null);
      expect(view.price).toBe("62000");
      expect(view.currency).toBe("RUB");
    },
  );

  it("значок повторяет настройку зала — «кто видит цену» без похода в настройки", () => {
    const view = hallItemForOwner(dbItem(), { ...OPEN_HALL, priceVisibility: "FRIENDS" }, null);
    expect(view.priceAudience).toBe("FRIENDS");
  });

  it.each(["ME", "NONE"] as const)(
    "цена скрыта у вещи (%s): значок говорит про вещь, а не про зал",
    (itemVisibility) => {
      const view = hallItemForOwner(
        dbItem({ priceVisibility: itemVisibility }),
        OPEN_HALL,
        null,
      );
      expect(view.priceAudience).toBe("ITEM");
      expect(view.price).toBe("62000"); // хозяйке — всё равно видно
    },
  );

  it("тумблер «Кто подарил» прячет имя в витрине, но вещь остаётся подарком", () => {
    const shown = hallItemForOwner(dbItem(), OPEN_HALL, null);
    const hidden = hallItemForOwner(dbItem(), { ...OPEN_HALL, giverShown: false }, null);
    expect(shown.giverName).toBe("мама");
    expect(hidden.giverName).toBeNull();
    expect(hidden.receivedYear).toBe("2025");
  });

  it("вещь без цены не выдумывает валюту", () => {
    const view = hallItemForOwner(dbItem({ price: null, currency: null }), OPEN_HALL, null);
    expect(view.price).toBeNull();
    expect(view.currency).toBeNull();
    expect(view.rounded).toBe(false);
  });
});

// ====================================================================
// Округление «около 60 000» и сумма зала
// ====================================================================

describe("округление цены", () => {
  it("пример доски: 62 000 показывается как «около 60 000»", () => {
    expect(roundHallPrice(new Prisma.Decimal("62000")).toString()).toBe("60000");
  });

  it.each([
    ["14900", "15000"],
    ["48000", "48000"],
    ["340000", "340000"],
    ["999", "1000"],
    ["1250", "1300"],
    ["0", "0"],
  ])("%s → %s", (raw, expected) => {
    expect(roundHallPrice(new Prisma.Decimal(raw)).toString()).toBe(expected);
  });

  it("ошибка показа не больше 5% — «около» остаётся правдой", () => {
    for (const raw of ["199", "2340", "62000", "87500", "1234567"]) {
      const exact = new Prisma.Decimal(raw);
      const shown = roundHallPrice(exact);
      const drift = shown.minus(exact).abs().div(exact);
      expect(drift.lessThanOrEqualTo(new Prisma.Decimal("0.05"))).toBe(true);
    }
  });

  it("округление включается тумблером и помечает себя признаком rounded", () => {
    const exact = hallItemForOwner(dbItem(), OPEN_HALL, null);
    expect(exact.price).toBe("62000");
    expect(exact.rounded).toBe(false);

    const about = hallItemForOwner(dbItem(), { ...OPEN_HALL, roundPrices: true }, null);
    expect(about.price).toBe("60000");
    expect(about.rounded).toBe(true);
  });

  it("цена, которую округление не изменило, «около» не подписывается", () => {
    const view = hallItemForOwner(
      dbItem({ price: new Prisma.Decimal("48000") }),
      { ...OPEN_HALL, roundPrices: true },
      null,
    );
    expect(view.price).toBe("48000");
    expect(view.rounded).toBe(false);
  });
});

describe("сумма всего зала", () => {
  const priced = (...values: string[]) =>
    values.map((value) => ({ price: new Prisma.Decimal(value), currency: "RUB" }));

  it("складывается по точным значениям", () => {
    expect(hallTotals(priced("62000", "48000", "230000"))).toEqual([
      { currency: "RUB", amount: "340000" },
    ]);
  });

  it("копейки не теряются — Decimal, а не float", () => {
    expect(hallTotals(priced("0.1", "0.2"))).toEqual([{ currency: "RUB", amount: "0.3" }]);
  });

  it("округление НЕ искажает сумму: сначала точный итог, потом «около»", () => {
    // Округли мы каждую цену по отдельности — вышло бы 45 000 (15 000 × 3).
    const rounded = hallTotals(priced("14900", "14900", "14900"), { round: true });
    expect(hallTotals(priced("14900", "14900", "14900"))).toEqual([
      { currency: "RUB", amount: "44700" },
    ]);
    expect(rounded).toEqual([{ currency: "RUB", amount: "44000" }]);
    expect(rounded[0]?.amount).not.toBe("45000");
  });

  it("вещи без цены в сумму не входят; валюты не смешиваются", () => {
    const totals = hallTotals([
      { price: new Prisma.Decimal("62000"), currency: "RUB" },
      { price: null, currency: "RUB" },
      { price: new Prisma.Decimal("300"), currency: "EUR" },
    ]);
    expect(totals).toEqual([
      { currency: "RUB", amount: "62000" },
      { currency: "EUR", amount: "300" },
    ]);
  });

  it("валюта не указана — считаем рублями, как и формат цены в плитке", () => {
    expect(hallTotals([{ price: new Prisma.Decimal("500"), currency: null }])).toEqual([
      { currency: "RUB", amount: "500" },
    ]);
  });
});

// ====================================================================
// Хранение настроек и сквозной путь до гостя (реальная тест-БД)
// ====================================================================

async function createOwnerWithRoom() {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Хозяйка" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `hp-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("настройки зала в БД", () => {
  it("дефолт — «только друзьям» (ADR-0004), а не «всем»", async () => {
    const { room } = await createOwnerWithRoom();
    expect(room.hallPriceVisibility).toBe("FRIENDS");
    expect(hallSettingsOf(room)).toEqual({
      priceVisibility: "FRIENDS",
      totalShown: true,
      giverShown: true,
      roundPrices: false,
    });
  });

  it("раздел сохраняется целиком и по частям", async () => {
    const { user, room } = await createOwnerWithRoom();

    const all = await setHallSettings(user.id, {
      priceVisibility: "ALL",
      totalShown: false,
      giverShown: false,
      roundPrices: true,
    });
    expect(hallSettingsOf(all)).toEqual({
      priceVisibility: "ALL",
      totalShown: false,
      giverShown: false,
      roundPrices: true,
    });

    // Частичная правка не сбрасывает соседей.
    const partial = await setHallSettings(user.id, { roundPrices: false });
    expect(partial.hallPriceVisibility).toBe("ALL");
    expect(partial.hallTotalShown).toBe(false);
    expect(partial.hallRoundPrices).toBe(false);
    expect(partial.id).toBe(room.id);
  });

  it("мусорное значение видимости не проходит", async () => {
    const { user } = await createOwnerWithRoom();
    await expect(
      setHallSettings(user.id, { priceVisibility: "EVERYONE" as never }),
    ).rejects.toThrow();
  });
});

describe("скрыть цену у отдельной вещи", () => {
  it("скрывает и возвращает — через собственную видимость вещи", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        state: "LOVE",
        title: "Сумка",
        price: "62000",
        currency: "RUB",
        inHall: true,
      },
    });

    const hidden = await setHallPriceHidden(user.id, item.id, true);
    expect(hidden.priceVisibility).toBe("NONE");
    expect(guestSeesHallItemPrice("ALL", hidden.priceVisibility)).toBe(false);

    const shown = await setHallPriceHidden(user.id, item.id, false);
    expect(shown.priceVisibility).toBe("ALL");
    expect(guestSeesHallItemPrice("ALL", shown.priceVisibility)).toBe(true);
  });

  it("«хочу» этой кнопкой не трогается — зал состоит из «люблю»", async () => {
    const { user, room } = await createOwnerWithRoom();
    const want = await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        state: "WANT",
        title: "Хочу сумку",
        price: "62000",
        currency: "RUB",
      },
    });
    await expect(setHallPriceHidden(user.id, want.id, true)).rejects.toBeInstanceOf(
      ItemMutationError,
    );
  });

  it("чужую вещь не тронуть", async () => {
    const mine = await createOwnerWithRoom();
    const stranger = await createOwnerWithRoom();
    const item = await prisma.item.create({
      data: {
        roomId: stranger.room.id,
        zone: "bags",
        state: "LOVE",
        title: "Чужая сумка",
        price: "1000",
        currency: "RUB",
        inHall: true,
      },
    });
    await expect(setHallPriceHidden(mine.user.id, item.id, true)).rejects.toBeInstanceOf(
      ItemMutationError,
    );
  });
});

describe("сквозной путь: комната по ссылке", () => {
  /** Найти вещь в выдаче гостя по названию. */
  function findGuestItem(
    view: Awaited<ReturnType<typeof getGuestRoom>>,
    title: string,
  ): Record<string, unknown> {
    const found = Object.values(view?.itemsByZone ?? {})
      .flat()
      .find((item) => item.title === title);
    if (!found) throw new Error(`вещи «${title}» нет в комнате гостя`);
    return found as unknown as Record<string, unknown>;
  }

  it("гость не видит цену подарка, пока настройка закрыта, и видит, когда открыта", async () => {
    const { user, room } = await createOwnerWithRoom();
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        state: "LOVE",
        title: "Подарок в зале",
        price: "62000",
        currency: "RUB",
        giverName: "мама",
        receivedAt: new Date("2025-03-14T12:00:00.000Z"),
        inHall: true,
      },
    });

    // Дефолт комнаты — FRIENDS: цены у гостя нет ни ключом, ни значением.
    const byDefault = await getGuestRoom(room.shareSlug);
    const closed = findGuestItem(byDefault, "Подарок в зале");
    expect("price" in closed).toBe(false);
    expect(JSON.stringify(byDefault)).not.toContain("62000");

    // «Только мне» и «никому» — тоже закрыто.
    for (const visibility of ["ME", "NONE"] as const) {
      await setHallSettings(user.id, { priceVisibility: visibility });
      const view = await getGuestRoom(room.shareSlug);
      expect("price" in findGuestItem(view, "Подарок в зале")).toBe(false);
      expect(JSON.stringify(view)).not.toContain("62000");
    }

    // «Всем, у кого есть ссылка» — дверь открыта.
    await setHallSettings(user.id, { priceVisibility: "ALL" });
    const opened = findGuestItem(await getGuestRoom(room.shareSlug), "Подарок в зале");
    expect(opened.price).toBe("62000");
    expect(opened.currency).toBe("RUB");
  });

  it("скрытая у вещи цена не течёт гостю даже при открытом зале", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        state: "LOVE",
        title: "Подарок с тихой ценой",
        price: "77000",
        currency: "RUB",
        inHall: true,
      },
    });
    await setHallSettings(user.id, { priceVisibility: "ALL" });
    await setHallPriceHidden(user.id, item.id, true);

    const view = await getGuestRoom(room.shareSlug);
    expect("price" in findGuestItem(view, "Подарок с тихой ценой")).toBe(false);
    expect(JSON.stringify(view)).not.toContain("77000");
  });

  it("настройка зала гостю не отдаётся — ни значением, ни ключом", async () => {
    const { user, room } = await createOwnerWithRoom();
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        state: "LOVE",
        title: "Подарок",
        price: "1000",
        currency: "RUB",
        inHall: true,
      },
    });
    await setHallSettings(user.id, { priceVisibility: "ALL" });

    const view = await getGuestRoom(room.shareSlug);
    const item = findGuestItem(view, "Подарок");
    expect("priceVisibility" in item).toBe(false);
    expect("hidden" in item).toBe(false);
    expect(JSON.stringify(view)).not.toContain("hallPriceVisibility");
  });
});
