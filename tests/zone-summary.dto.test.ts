// Сводка по зоне (тикет 34): три правила утечки и их проверка числом.
//
// Сводка — самое опасное место продукта после самой сетки: она рассказывает о
// зоне, в которую человек ещё не вошёл, и делает это ЧИСЛАМИ. А по числам
// восстанавливается то, чего показывать нельзя:
//   - счётчик занятых вещей по зоне превращает «N вещей уже забрали»
//     (единственное, что знает хозяйка) в «забрали ВОТ ЭТУ» — инвариант №1;
//   - вилка цен по двум вещам — это и есть обе цены, а цена бывает закрыта
//     (инвариант №8); одна марка при двух вещах — адрес конкретной вещи;
//   - спрятанная вещь, попавшая в счётчик, перестаёт быть спрятанной —
//     инвариант №5.
// Поэтому здесь не «тесты на функцию», а тесты на обещания продукта.
import { describe, expect, it } from "vitest";
import { Prisma, type Item } from "@prisma/client";
import {
  ZONE_SUMMARY_BRANDS_MIN,
  ZONE_SUMMARY_PRICE_MIN,
  ZONE_SUMMARY_THUMBS,
  brandFromDomain,
  emptyZoneSummary,
  guestSummaryItem,
  ownerSummaryItem,
  zoneSummaryForGuest,
  zoneSummaryForOwner,
} from "../src/server/dto/zone-summary";
import { demoGhostsFor } from "../src/config/demo-pools";
import { ghostForGuest } from "../src/server/dto/guest-items";

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
  eventWhen: null,
  eventWhere: null,
  validUntil: null,
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

/** «Хочу» с ценой: цена строкой в БД — Decimal, как в проде. */
function want(id: string, priceRub: number, extra: Partial<Item> = {}): Item {
  return dbItem({
    id,
    state: "WANT",
    price: new Prisma.Decimal(String(priceRub)),
    currency: "RUB",
    ...extra,
  });
}

function love(id: string, extra: Partial<Item> = {}): Item {
  return dbItem({ id, state: "LOVE", ...extra });
}

const ownerSummary = (items: Item[]) => zoneSummaryForOwner("jewelry", items.map(ownerSummaryItem));
const guestSummary = (items: Item[]) => zoneSummaryForGuest("jewelry", items.map(guestSummaryItem));

/** Ключи формы сводки — исчерпывающе. Новое поле = осознанная правка снапшота. */
const BASE_KEYS = ["count", "more", "thumbs", "wantCount", "zone"];

describe("правило 1 — счётчика занятых нет ни у кого, и у гостя тем более", () => {
  // Критерий тикета: «Гость не видит счётчик занятых — тест обязателен».
  // Проверяем сильнее, чем просит критерий: канала для брони нет В ФОРМЕ —
  // ни у гостя, ни у хозяйки. Хозяйке про брони по-прежнему видно ровно одно
  // число ПО КОМНАТЕ (ownerTakenCount) и только в шапке её комнаты.
  const zone = [
    want("w1", 4_000),
    want("w2", 9_000),
    want("w3", 21_000),
    love("l1", { title: "Цепочка" }),
  ];

  it("в guest-сводке ровно ключи формы — ни одного про бронь", () => {
    const dto = guestSummary(zone);
    expect(Object.keys(dto).sort()).toEqual([...BASE_KEYS, "price"].sort());
    for (const key of Object.keys(dto)) {
      expect(key).not.toMatch(/book|taken|reserv|purchas|cancel|занят|забра/i);
    }
  });

  it("в owner-сводке — те же ключи: счётчик занятых по зоне не существует", () => {
    const dto = ownerSummary(zone);
    expect(Object.keys(dto).sort()).toEqual([...BASE_KEYS, "price"].sort());
    for (const key of Object.keys(dto)) {
      expect(key).not.toMatch(/book|taken|reserv|purchas|cancel|занят|забра/i);
    }
  });

  it("загруженный relation booking не протекает в сводку ни строкой, ни числом", () => {
    // Вещь пришла из Prisma с include: { booking: true } — сводка обязана
    // остаться прежней, а не «заметить» бронь.
    const withBooking = zone.map((item) =>
      Object.assign(dbItem(item), {
        booking: {
          id: `booking_${item.id}`,
          guestName: "Оля",
          guestEmail: "olya@example.com",
          mode: "QUIET",
          purchased: true,
          cancelToken: "secret",
        },
      }),
    );

    expect(guestSummary(withBooking)).toEqual(guestSummary(zone));
    expect(ownerSummary(withBooking)).toEqual(ownerSummary(zone));
    expect(JSON.stringify(guestSummary(withBooking))).not.toMatch(/Оля|secret|booking|QUIET/i);
  });

  it("«помечено хочу» гостю можно: это про желания, а не про брони", () => {
    // handoff/answers-04.md: «19 в подарок» хозяйке = «19 можно подарить»
    // гостю. Число одно и то же, слова разные — слова живут в словаре.
    expect(guestSummary(zone).wantCount).toBe(3);
    expect(ownerSummary(zone).wantCount).toBe(3);
    expect(guestSummary(zone).count).toBe(4);
  });
});

describe("правило 1а — в ветке ХОЗЯЙКИ нет ни одного числа, производного от броней", () => {
  // Ответ дизайна, раунд 6 (тикет 41). Та же утечка, что в канале «занято»,
  // только в медленном варианте:
  //   гостю   — занято и свободно по зоне: это его координация;
  //   хозяйке — про занятость по зонам НИЧЕГО, один счётчик на комнату.
  // «7 свободно» при восьми положенных вещах — это «забрали одну из восьми»,
  // сказанное вежливее. `count` и `wantCount` у хозяйки остаются: это её
  // собственные данные о своих вещах, от броней они не зависят.
  const EIGHT = 8;
  const eight = Array.from({ length: EIGHT }, (_, index) =>
    want(`w${index + 1}`, 3_000 + index * 1_000),
  );

  /** Те же восемь вещей, но одна занята — строкой из БД с relation'ом. */
  const oneBooked = eight.map((item, index) =>
    index === 0
      ? Object.assign(dbItem(item), {
          booking: {
            id: "booking_w1",
            guestName: "Оля",
            guestEmail: "olya@example.com",
            mode: "QUIET",
            purchased: true,
            cancelToken: "secret",
          },
        })
      : item,
  );

  /** Все числа сводки, включая вложенные: цены — строки, они сюда не попадут. */
  function numbersIn(value: unknown): number[] {
    if (typeof value === "number") return [value];
    if (Array.isArray(value)) return value.flatMap(numbersIn);
    if (typeof value === "object" && value !== null) {
      return Object.values(value).flatMap(numbersIn);
    }
    return [];
  }

  it("бронь не меняет сводку хозяйки ни на одно число", () => {
    expect(ownerSummary(oneBooked)).toEqual(ownerSummary(eight));
  });

  it("каждое число объясняется её собственными вещами; «7 из 8» не появляется", () => {
    const dto = ownerSummary(oneBooked);

    expect(dto.count).toBe(EIGHT); // всего вещей — её данные
    expect(dto.wantCount).toBe(EIGHT); // помечено «хочу» — тоже её, НЕ «свободно»
    expect(dto.more).toBe(EIGHT - ZONE_SUMMARY_THUMBS); // хвост за миниатюрами

    // Числовые ключи — исчерпывающе: новый счётчик у хозяйки не заведётся молча.
    const numericKeys = Object.entries(dto)
      .filter(([, value]) => typeof value === "number")
      .map(([key]) => key)
      .sort();
    expect(numericKeys).toEqual(["count", "more", "wantCount"]);

    // И главное: числа «свободных» (8 − 1 занятая) в сводке нет нигде.
    expect(numbersIn(dto)).not.toContain(EIGHT - 1);
  });

  it("«свободно» не прячется и в других формулировках: ключей про занятость нет", () => {
    // Появится когда-нибудь «свободно» для гостя — оно обязано родиться в
    // ГОСТЕВОЙ ветке и получить брони на вход, которых у сводки сегодня нет.
    for (const key of Object.keys(ownerSummary(oneBooked))) {
      expect(key).not.toMatch(/free|available|left|remain|свобод|остал/i);
    }
  });
});

describe("правило 2 — вилка цен: только «хочу» с видимой ценой и только от трёх", () => {
  it("порог — три вещи: на двух вилки нет вовсе (ключа нет)", () => {
    expect(ZONE_SUMMARY_PRICE_MIN).toBe(3);
    const two = ownerSummary([want("w1", 4_000), want("w2", 90_000)]);
    expect("price" in two).toBe(false);

    const three = ownerSummary([want("w1", 4_000), want("w2", 90_000), want("w3", 12_000)]);
    expect(three.price).toEqual({ low: "4000", high: "90000", currency: "RUB" });
  });

  it("цена «люблю» не входит в вилку НИКОГДА — даже если в БД осталась от «хочу»", () => {
    // Инвариант №8 плюс ответ дизайна: вещь уже подарена, её незачем оценивать.
    const loved = [
      love("l1", { price: new Prisma.Decimal("100000"), currency: "RUB" }),
      love("l2", { price: new Prisma.Decimal("200"), currency: "RUB" }),
      love("l3", { price: new Prisma.Decimal("50000"), currency: "RUB" }),
    ];
    expect("price" in ownerSummary(loved)).toBe(false);
    expect("price" in guestSummary(loved)).toBe(false);

    // И не сдвигает краёв, когда «хочу» рядом хватает на вилку.
    const mixed = ownerSummary([...loved, want("w1", 4_000), want("w2", 9_000), want("w3", 12_000)]);
    expect(mixed.price).toEqual({ low: "4000", high: "12000", currency: "RUB" });
  });

  it("гость считает только по ценам, которые ему видны; хозяйка — по всем своим", () => {
    // Три «хочу», но одна цена закрыта от гостя (ME). Гостю видимых — две,
    // значит вилки нет вовсе; хозяйке видны все три.
    const zone = [
      want("w1", 4_000),
      want("w2", 9_000),
      want("w3", 90_000, { priceVisibility: "ME" }),
    ];
    expect("price" in guestSummary(zone)).toBe(false);
    expect(ownerSummary(zone).price).toEqual({ low: "4000", high: "90000", currency: "RUB" });

    // NONE ведёт себя так же, FRIENDS в Phase 1 читается как ALL.
    const hiddenNone = [...zone.slice(0, 2), want("w4", 15_000, { priceVisibility: "NONE" })];
    expect("price" in guestSummary(hiddenNone)).toBe(false);

    const friends = [...zone.slice(0, 2), want("w5", 15_000, { priceVisibility: "FRIENDS" })];
    expect(guestSummary(friends).price).toEqual({ low: "4000", high: "15000", currency: "RUB" });
  });

  it("вилка не смешивает валюты: порог трёх считается внутри одной", () => {
    const mixed = [
      want("w1", 4_000),
      want("w2", 9_000),
      want("w3", 300, { currency: "EUR" }),
      want("w4", 700, { currency: "USD" }),
    ];
    // Всего цен четыре, но в рублях — две: вилки нет.
    expect("price" in ownerSummary(mixed)).toBe(false);

    const rubles = [...mixed, want("w5", 12_000)];
    expect(ownerSummary(rubles).price).toEqual({ low: "4000", high: "12000", currency: "RUB" });
  });

  it("края вилки берутся по величине, а не по строке (деньги не float)", () => {
    const zone = [want("w1", 9_000), want("w2", 12_000), want("w3", 100_000)];
    // Лексикографически «100000» < «12000» < «9000» — проверка ловит наивную
    // сортировку строк, а Number() для денег в коде запрещён.
    expect(ownerSummary(zone).price).toEqual({ low: "9000", high: "100000", currency: "RUB" });

    const kopecks = [
      want("k1", 0, { price: new Prisma.Decimal("1000.50") }),
      want("k2", 0, { price: new Prisma.Decimal("1000.05") }),
      want("k3", 0, { price: new Prisma.Decimal("999.99") }),
    ];
    expect(ownerSummary(kopecks).price).toEqual({
      low: "999.99",
      high: "1000.5",
      currency: "RUB",
    });
  });
});

describe("правило 2б — марки: только от трёх РАЗЛИЧНЫХ", () => {
  // Условие дизайна (handoff/answers-04.md): одна марка при двух вещах в зоне
  // это адрес конкретной вещи, поэтому правило про цены без правила про марки
  // не работает.
  it("две различных марки — списка нет вовсе", () => {
    expect(ZONE_SUMMARY_BRANDS_MIN).toBe(3);
    const zone = [
      want("w1", 4_000, { domain: "lamoda.ru" }),
      want("w2", 9_000, { domain: "lamoda.ru" }),
      want("w3", 12_000, { domain: "asos.com" }),
    ];
    expect("brands" in ownerSummary(zone)).toBe(false);
    // При этом вилка цен есть: правила независимы.
    expect(ownerSummary(zone).price).toBeDefined();
  });

  it("три различных — список отдаётся, отсортированный", () => {
    const zone = [
      want("w1", 4_000, { domain: "www.zara.com" }),
      want("w2", 9_000, { domain: "lamoda.ru" }),
      want("w3", 12_000, { domain: "shop.nike.com" }),
    ];
    expect(ownerSummary(zone).brands).toEqual(["Lamoda", "Nike", "Zara"]);
  });

  it("марка «люблю» третьей не становится — агрегат её не видит", () => {
    // Две «хочу» с разными марками и «люблю» с третьей: порога нет, потому что
    // подаренная вещь в агрегат не идёт (ответ дизайна).
    const zone = [
      want("w1", 4_000, { domain: "zara.com" }),
      want("w2", 9_000, { domain: "lamoda.ru" }),
      love("l1", { domain: "gucci.com" }),
    ];
    expect("brands" in ownerSummary(zone)).toBe(false);
    expect("brands" in guestSummary(zone)).toBe(false);
  });

  it("марка с закрытой от гостя ценой в его список не идёт", () => {
    const zone = [
      want("w1", 4_000, { domain: "zara.com" }),
      want("w2", 9_000, { domain: "lamoda.ru" }),
      want("w3", 12_000, { domain: "nike.com", priceVisibility: "NONE" }),
      love("l1", { domain: "gucci.com" }),
    ];
    // Гостю видимы две цены — ни вилки, ни марок.
    expect("price" in guestSummary(zone)).toBe(false);
    expect("brands" in guestSummary(zone)).toBe(false);
    // Хозяйке видны все три её цены — марки есть, но марки «люблю» среди них нет.
    expect(ownerSummary(zone).brands).toEqual(["Lamoda", "Nike", "Zara"]);
  });

  it("марка из домена: хвосты отрезаны, регистр приведён", () => {
    expect(brandFromDomain("www.atelier-perle.fr")).toBe("Atelier-perle");
    expect(brandFromDomain("shop.nike.com")).toBe("Nike");
    expect(brandFromDomain("asos.co.uk")).toBe("Asos");
    expect(brandFromDomain("lamoda.ru")).toBe("Lamoda");
    expect(brandFromDomain(null)).toBeNull();
    expect(brandFromDomain("")).toBeNull();
  });
});

describe("правило 3 — спрятанные вещи не входят ни в один счётчик", () => {
  // Инвариант №5. У гостя спрятанное отсекается ещё в сервисе (guest-room.ts),
  // у хозяйки оно приходит в списке — фильтр стоит в сводке и работает на обе
  // формы, потому что «спрятана» значит «её нет», а не «её видно только мне».
  const visible = [want("w1", 4_000), want("w2", 9_000), love("l1")];
  const hiddenOnes = [
    want("h1", 999_000, { hidden: true, domain: "gucci.com" }),
    love("h2", { hidden: true, photoKey: "refs/p-lux.jpg" }),
  ];

  it("спрятанное не считается ни в «всего», ни в «помечено хочу»", () => {
    const dto = ownerSummary([...visible, ...hiddenOnes]);
    expect(dto.count).toBe(3);
    expect(dto.wantCount).toBe(2);
    // Сводка комнаты без спрятанных вещей — ровно та же.
    expect(dto).toEqual(ownerSummary(visible));
  });

  it("спрятанное не попадает в миниатюры и в «ещё N»", () => {
    const withHiddenFirst = ownerSummary([hiddenOnes[1] as Item, ...visible]);
    expect(withHiddenFirst.thumbs).toHaveLength(3);
    expect(withHiddenFirst.more).toBe(0);
    // Фотография спрятанной вещи не показалась бы даже миниатюрой.
    for (const thumb of withHiddenFirst.thumbs) {
      expect(thumb.photoUrl).toBeNull();
    }
  });

  it("спрятанное не двигает вилку цен и не добирает её до порога", () => {
    // Две видимых «хочу» + одна спрятанная = порога нет, вилки нет.
    const two = ownerSummary([...visible, hiddenOnes[0] as Item]);
    expect("price" in two).toBe(false);

    // Три видимых + спрятанная с запредельной ценой: край берётся по видимым.
    const three = ownerSummary([...visible, want("w3", 12_000), hiddenOnes[0] as Item]);
    expect(three.price).toEqual({ low: "4000", high: "12000", currency: "RUB" });
  });
});

describe("форма сводки: миниатюры, «ещё», пустая зона, примеры", () => {
  it("миниатюр не больше трёх, остальное уходит в «ещё N»", () => {
    expect(ZONE_SUMMARY_THUMBS).toBe(3);
    const zone = [
      love("l1", { photoKey: "refs/p-lux.jpg" }),
      want("w1", 4_000, { photoKey: "refs/p-earrings.jpg" }),
      want("w2", 9_000),
      want("w3", 12_000),
      want("w4", 15_000),
    ];
    const dto = ownerSummary(zone);
    expect(dto.thumbs).toHaveLength(3);
    expect(dto.more).toBe(2);
    // Пунктир кодирует «хочу», а не отсутствие фото (инвариант №3): у второй
    // миниатюры фото есть, а флаг want всё равно стоит; у третьей фото нет,
    // и флаг стоит по состоянию, а не по пустой картинке.
    expect(dto.thumbs.map((thumb) => thumb.want)).toEqual([false, true, true]);
    expect(dto.thumbs[0]?.photoUrl).not.toBeNull();
    expect(dto.thumbs[2]?.photoUrl).toBeNull();
  });

  it("демо-призраки в сводку не входят: зона без своих вещей пуста", () => {
    const ghosts = demoGhostsFor("jewelry", "jewel").map(ghostForGuest);
    expect(ghosts.length).toBeGreaterThan(ZONE_SUMMARY_PRICE_MIN);
    const dto = zoneSummaryForGuest("jewelry", ghosts);
    expect(dto).toEqual(emptyZoneSummary("jewelry"));
    expect("price" in dto).toBe(false);
  });

  it("пустая зона: форма та же, числа нулевые", () => {
    expect(ownerSummary([])).toEqual(emptyZoneSummary("jewelry"));
    expect(Object.keys(emptyZoneSummary("jewelry")).sort()).toEqual(BASE_KEYS);
  });
});
