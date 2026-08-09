// Стоимость в сокровищнице (тикет 35, ADR-0004, доска — турн 12d;
// ПЕРЕПИСАН тикетом 124).
//
// ЧТО ИЗМЕНИЛОСЬ. Раньше половина файла защищала ДВЕРЬ: гость видит цену
// подарка, когда хозяйка откроет её настройкой зала, скрытие у отдельной вещи
// перекрывает открытый зал, вещь шире зала не становится. Двери больше нет —
// цену вещи сокровищницы гость не видит НИКОГДА и ни при каком положении
// настройки (инвариант №8 в новой редакции). Вместе с дверью ушло и
// «скрыть цену у отдельной вещи» (`setHallPriceHidden`): прятать не от кого,
// а писать `priceVisibility: NONE` было бы прямо вредно — эта колонка теперь
// управляет ценой вещи В КОМНАТЕ, и «Вернуть в комнату» показало бы вещь без
// цены.
//
// Что защищается сейчас:
// - ГОСТЬ не видит цену вещи сокровищницы ни при каком положении настройки;
// - ХОЗЯЙКЕ её собственные цены видны ВСЕГДА (эта половина №8 не менялась);
// - цена вещи КОМНАТЫ живёт своим правилом (`priceVisibility`) и настройкой
//   витрины не задета — ни в одну, ни в другую сторону;
// - округление — только показ: сумма складывается по точным Decimal и
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
  guestSeesHallPrice,
  hallItemForOwner,
  hallItemForGuest,
  hallSettingsOf,
  hallTotals,
  priceAudienceHidden,
  roundHallPrice,
  type HallSettings,
} from "../src/server/dto/hall";
import { itemForGuest } from "../src/server/dto/guest-items";
import { getGuestRoom } from "../src/server/services/guest-room";
import { getGuestHall } from "../src/server/services/guest-hall";
import { setHallSettings } from "../src/server/services/rooms";

const TEST_EMAIL_DOMAIN = "@hall-prices.test";

/** Полный Item, как из БД; поля перекрываются точечно. */
function dbItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item_1",
    roomId: "room_1",
    zone: "bags",
    inHall: true,
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
  eventWhen: null,
  eventWhere: null,
  validUntil: null,
    giverName: "мама",
    receivedAt: new Date("2025-03-14T12:00:00.000Z"),
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

describe("гость и цена вещи сокровищницы: её нет никогда", () => {
  it("форма витрины не знает ключей price/currency вовсе", () => {
    const dto = hallItemForGuest(dbItem(), null);
    expect("price" in dto).toBe(false);
    expect("currency" in dto).toBe(false);
    expect("rounded" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("62000");
  });

  it("правило одно и без доводов: guestSeesHallPrice() === false", () => {
    // Аргументов у функции нет сознательно — любая настройка в сигнатуре
    // читалась бы как дверь, которой больше не существует.
    expect(guestSeesHallPrice()).toBe(false);
  });

  it("вещь сокровищницы в форме комнаты тоже без цены — при любом её priceVisibility", () => {
    for (const visibility of ["ALL", "FRIENDS", "ME", "NONE"] as const) {
      const dto = itemForGuest(dbItem({ priceVisibility: visibility }));
      expect("price" in dto).toBe(false);
      expect("currency" in dto).toBe(false);
      expect(JSON.stringify(dto)).not.toContain("62000");
    }
  });

  it("цена вещи КОМНАТЫ живёт своим правилом — витрина её не трогает", () => {
    // Инвариант №8 в части комнаты не менялся: ALL/FRIENDS отдают цену.
    const roomItem = itemForGuest(
      dbItem({ inHall: false, priceVisibility: "FRIENDS", giverName: null, receivedAt: null }),
    );
    if (roomItem.inHall) throw new Error("unreachable");
    expect(roomItem.price).toBe("62000");
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

  // ПЕРЕПИСАНО (тикет 124): значок повторял настройку зала и умел говорить
  // «скрыто у этой вещи». Теперь ответ один у любой вещи и при любой
  // настройке — «от гостей закрыто», потому что так оно и есть.
  it("значок всегда говорит «гость цену не видит» — и это правда", () => {
    for (const visibility of ["ALL", "FRIENDS", "ME", "NONE"] as const) {
      const view = hallItemForOwner(dbItem(), { ...OPEN_HALL, priceVisibility: visibility }, null);
      expect(view.priceAudience).toBe("NONE");
      expect(priceAudienceHidden(view.priceAudience)).toBe(true);
      expect(view.price).toBe("62000"); // хозяйке — всё равно видно
    }
  });

  it("тумблер «Кто подарил» прячет имя в витрине, но вещь остаётся подарком", () => {
    const shown = hallItemForOwner(dbItem(), OPEN_HALL, null);
    const hidden = hallItemForOwner(dbItem(), { ...OPEN_HALL, giverShown: false }, null);
    expect(shown.giverName).toBe("мама");
    expect(hidden.giverName).toBeNull();
    expect(hidden.receivedYear).toBe("2025");
  });

  it("заметка едет цитатой, пробельная — это её отсутствие (тикет 92)", () => {
    const written = hallItemForOwner(
      dbItem({ note: "  Ждала её два года. Ношу с чем угодно  " }),
      OPEN_HALL,
      null,
    );
    expect(written.note).toBe("Ждала её два года. Ношу с чем угодно");
    // Дорога в карточку вещи строится по зоне — до тикета 92 её в DTO не было.
    expect(written.zone).toBe("bags");

    for (const empty of [null, "", "   ", "\n\t "]) {
      expect(hallItemForOwner(dbItem({ note: empty }), OPEN_HALL, null).note).toBeNull();
    }
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

// ПЕРЕПИСАН ЦЕЛИКОМ (тикет 124). Здесь было три теста про
// `setHallPriceHidden` — «скрыть/показать цену отдельной вещи в зале». Сервис
// удалён: цену в сокровищнице не видит ни один гость, прятать не от кого, а
// колонка `priceVisibility`, которую он переписывал в NONE, теперь отвечает за
// цену вещи В КОМНАТЕ — «Вернуть в комнату» вернуло бы вещь без цены.
// Проверяем ЗАМЕНУ: переезд туда-обратно цену не портит.
describe("переезд не портит цену вещи (тикет 124)", () => {
  it("«Вернуть в комнату» показывает цену снова — priceVisibility не тронут", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        inHall: false,
        title: "Сумка",
        price: "62000",
        currency: "RUB",
        priceVisibility: "ALL",
      },
    });

    const { toggleHall } = await import("../src/server/services/items");
    const moved = await toggleHall(user.id, item.id, true);
    expect(moved.inHall).toBe(true);
    // Цена в БД никуда не делась — её просто перестают показывать.
    expect(moved.price?.toString()).toBe("62000");
    expect(moved.priceVisibility).toBe("ALL");

    const back = await toggleHall(user.id, item.id, false);
    expect(back.inHall).toBe(false);
    expect(back.priceVisibility).toBe("ALL");

    // …и гость снова видит её в комнате.
    const view = await getGuestRoom(room.shareSlug);
    const guestItem = Object.values(view?.itemsByZone ?? {})
      .flat()
      .find((row) => row.title === "Сумка");
    expect(guestItem).toBeDefined();
    expect(guestItem).toHaveProperty("price", "62000");
  });
});

describe("сквозной путь: витрина по ссылке", () => {
  // ПЕРЕПИСАНО (тикет 124). Три теста проверяли дверь настройки на живой БД:
  // закрыто по умолчанию, открывается при ALL, скрытие у вещи перекрывает.
  // Двери нет — проверяем, что её нет НА САМОМ ДЕЛЕ, на самом открытом
  // положении и сквозь весь путь до гостя.
  it("ни одно положение настройки не выдаёт гостю цену витрины", async () => {
    const { user, room } = await createOwnerWithRoom();
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        inHall: true,
        title: "Подарок в витрине",
        price: "62000",
        currency: "RUB",
        giverName: "мама",
        receivedAt: new Date("2025-03-14T12:00:00.000Z"),
      },
    });

    for (const visibility of ["FRIENDS", "ME", "NONE", "ALL"] as const) {
      await setHallSettings(user.id, { priceVisibility: visibility });
      const hall = await getGuestHall(room.shareSlug);
      const item = hall?.items.find((row) => row.title === "Подарок в витрине");
      expect(item, `настройка ${visibility}`).toBeDefined();
      expect("price" in (item ?? {})).toBe(false);
      expect(JSON.stringify(hall)).not.toContain("62000");
      // Имени дарителя гостю тоже нет ни при каком положении (раунд 19).
      expect(JSON.stringify(hall)).not.toContain("мама");
    }
  });

  it("вещь витрины не приезжает в комнату гостя вовсе", async () => {
    const { room } = await createOwnerWithRoom();
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        inHall: true,
        title: "Только в витрине",
        price: "77000",
        currency: "RUB",
      },
    });

    const view = await getGuestRoom(room.shareSlug);
    const inRoom = Object.values(view?.itemsByZone ?? {})
      .flat()
      .map((row) => row.title);
    expect(inRoom).not.toContain("Только в витрине");
    expect(JSON.stringify(view)).not.toContain("77000");
  });

  it("настройки хозяйки гостю не отдаются — ни значением, ни ключом", async () => {
    const { user, room } = await createOwnerWithRoom();
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "bags",
        inHall: true,
        title: "Подарок",
        price: "1000",
        currency: "RUB",
      },
    });
    await setHallSettings(user.id, { priceVisibility: "ALL" });

    const hall = await getGuestHall(room.shareSlug);
    const item = hall?.items[0];
    expect(item).toBeDefined();
    expect("priceVisibility" in (item ?? {})).toBe(false);
    expect("hidden" in (item ?? {})).toBe(false);
    expect(JSON.stringify(hall)).not.toContain("hallPriceVisibility");
  });
});

describe("значок «кто видит цену»", () => {
  // Значок стоит и в зале славы, и в истории вещи (тикет 39). Правило одно на
  // оба места, поэтому и живёт оно в dto/hall.ts, а не в разметке.
  it("перечёркнут везде, где гость цену не увидит", () => {
    expect(priceAudienceHidden("ITEM")).toBe(true);
    expect(priceAudienceHidden("ME")).toBe(true);
    expect(priceAudienceHidden("NONE")).toBe(true);
  });

  it("открыт там, где цену кто-то видит", () => {
    expect(priceAudienceHidden("ALL")).toBe(false);
    expect(priceAudienceHidden("FRIENDS")).toBe(false);
  });

  it("не спорит с подписью: закрытому адресату — закрытый глаз", () => {
    // Ровно этот случай и был сломан: «цену не видит никто» с открытым глазом.
    expect(guestSeesHallPrice()).toBe(false);
    for (const audience of ["ME", "NONE", "ITEM"] as const) {
      expect(priceAudienceHidden(audience)).toBe(true);
    }
  });
});
