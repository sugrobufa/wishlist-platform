// «Где купить» доезжает до гостя при ЛЮБОЙ видимости цены (тикет 195).
//
// ЗАЧЕМ ТЕСТ. Приёмка владельца 11.08.2026: «если хозяйка при добавлении
// использовала ссылку на маркетплейс, она же должна быть указана в
// раскрывающейся карточке предмета для гостя». До этого тикета ключ `shop`
// появлялся в гостевом DTO только внутри `if (guestSeesPrice(...))`: у вещи с
// ценой «Только я» или «Никто» блок «Где купить» молча исчезал и с плитки, и
// с гостевой карточки. Гость приходил дарить, вещь видел, а куда за ней идти —
// нет. Поломка тихая: экран жив, DTO валиден, typecheck зелёный.
//
// ПОЧЕМУ ДТО И РАЗМЕТКА ВМЕСТЕ, А НЕ ПОРОЗНЬ. Правило одно («ссылка есть —
// ссылка показывается»), а мест, где его можно потерять, два: сериализация и
// два экрана, которые её читают. Тест идёт по всей цепочке от строки БД:
// `itemForGuest` → плитка сетки и карточка вещи. Проверять их по отдельности
// значит поверить, что между ними ничего не теряется, — а тикет 195 родился
// ровно из такой веры.
//
// ЦЕНА ПРИ ЭТОМ ОСТАЁТСЯ ПОД СВОИМ ПРАВИЛОМ (инвариант №8) — и здесь же это и
// проверяется: скрытая цена скрывает ЧИСЛО, а не путь к вещи.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Prisma, type Item } from "@prisma/client";

// Словарь настоящий: «Перейти →» и домен — это и есть то, что ищет глаз.
vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  const fill = (template: string, values?: Record<string, unknown>) =>
    values === undefined
      ? template
      : template.replace(/\{(\w+)\}/gu, (_, key: string) => String(values[key] ?? ""));
  return {
    useTranslations:
      (ns: string) =>
      (key: string, values?: Record<string, unknown>) =>
        fill(dict[ns]?.[key] ?? key, values),
    useLocale: () => "ru",
    useFormatter: () => ({
      dateTime: (date: Date, options?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat("ru", options).format(date),
    }),
  };
});

// Канал «занято» (тикет 08) к теме не относится и живёт своим тестом: здесь он
// заменён пустым — ни одна вещь не занята, бирка на месте.
vi.mock("../src/app/r/[slug]/booking/booking-context", () => ({
  useGuestBooking: () => ({
    taken: new Set<string>(),
    mine: new Set<string>(),
    myBookingsCount: 0,
    signedIn: false,
    hallOpen: false,
    bookedNow: 0,
    markBooked: () => {},
    markTaken: () => {},
  }),
}));

const { itemForGuest, ghostForGuest } = await import("../src/server/dto/guest-items");
const { ItemTile } = await import("../src/components/zone/ItemTile");
const { GuestItemView } = await import("../src/app/r/[slug]/i/[id]/guest-item-view");
const { demoGhostsFor } = await import("../src/config/demo-pools");

/** Полный Item, как из БД; поля перекрываются точечно. */
function dbItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item_1",
    roomId: "room_1",
    zone: "perfume",
    inHall: false,
    title: "Nº7 Eau de Parfum",
    note: null,
    photoKey: null,
    url: "https://WWW.GoldApple.ru/19000175823?utm_source=vk#top",
    canonicalUrl: "https://www.goldapple.ru/19000175823",
    domain: "goldapple.ru",
    price: new Prisma.Decimal("14900"),
    currency: "RUB",
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
    source: "URL",
    catalogProductId: null,
    priceCheckedAt: null,
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
    updatedAt: new Date("2026-01-10T10:00:00.000Z"),
    ...overrides,
  };
}

const SHOP_URL = "https://www.goldapple.ru/19000175823";
const GO = "Перейти →";
/** Цена так, как её напечатает карточка: тем же Intl, а не строкой из головы. */
const SUM = new Intl.NumberFormat("ru", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format(14900);

type GuestItem = ReturnType<typeof itemForGuest>;

/** Гостевая карточка вещи так, как её увидит браузер. */
const card = (item: GuestItem) =>
  renderToStaticMarkup(
    createElement(GuestItemView, {
      item,
      zoneLabel: "Ароматы",
      pool: "perfume",
      ownerName: "Мила",
      accent: "#E7C9A9",
      roomHref: "/r/mila",
    }),
  );

/** Плитка гостевой сетки: тот же DTO, второй экран. */
const tile = (item: GuestItem) =>
  renderToStaticMarkup(createElement(ItemTile, { item, staggerIndex: 0 }));

describe("скрытая цена не уносит ссылку (тикет 195)", () => {
  it.each(["ME", "NONE"] as const)(
    "priceVisibility=%s: у гостя в DTO ЕСТЬ shop и НЕТ price",
    (priceVisibility) => {
      const dto = itemForGuest(dbItem({ priceVisibility }));

      // Оба ключа в одном утверждении — правило одно, и разъехаться половинам
      // нельзя: без первой половины вещь недостижима, без второй — цена течёт.
      expect([("shop" in dto), ("price" in dto)]).toEqual([true, false]);
      if (dto.inHall) throw new Error("unreachable");
      expect(dto.shop).toEqual({ url: SHOP_URL, domain: "goldapple.ru" });
    },
  );

  it.each(["ME", "NONE"] as const)(
    "priceVisibility=%s: в карточке гостя блок «Где купить» ВИДЕН, цены нет",
    (priceVisibility) => {
      const markup = card(itemForGuest(dbItem({ priceVisibility })));

      expect(markup).toContain(`href="${SHOP_URL}"`);
      expect(markup).toContain("goldapple.ru");
      // СЛОВО ДЕЙСТВИЯ ЗДЕСЬ ДРУГОЕ (тикет 196, пакет 46). При скрытой цене
      // магазин становится ЯКОРЕМ экрана — «главной дверью» в рамке, и зовут
      // её «Открыть», а не «Перейти →». Проверка тикета 195 от этого не
      // ослабла: она про то, что ССЫЛКА НА МЕСТЕ, а не про подпись у неё.
      expect(markup).toContain("Открыть");
      expect(markup).toContain("Где купить");
      // Число не показано ни отформатированным, ни сырым, ни знаком валюты.
      expect(markup).not.toContain(SUM);
      expect(markup).not.toContain("14900");
      expect(markup).not.toContain("₽");
    },
  );

  it.each(["ME", "NONE"] as const)(
    "priceVisibility=%s: и на плитке сетки — тот же ответ",
    (priceVisibility) => {
      const markup = tile(itemForGuest(dbItem({ priceVisibility })));

      expect(markup).toContain(`href="${SHOP_URL}"`);
      expect(markup).not.toContain("₽");
    },
  );

  it("открытая цена ничего не потеряла: и ссылка, и число на месте", () => {
    // Сторож правки: если бы «вынести из-под if» сделали переносом самого
    // `if`, цена исчезла бы вместо ссылки — и первые тесты этого не увидели.
    const markup = card(itemForGuest(dbItem({ priceVisibility: "ALL" })));
    expect(markup).toContain(`href="${SHOP_URL}"`);
    expect(markup).toContain(SUM);
  });

  it("сырой Item.url в разметку не попадает — только канонический адрес", () => {
    // Инвариант №6: наружу уходит счёт сервера, а не пользовательский ввод.
    const markup = card(itemForGuest(dbItem({ priceVisibility: "NONE" })));
    expect(markup).not.toContain("utm_source");
    expect(markup).not.toContain("GoldApple");
  });
});

describe("кому ссылки не полагается — тому по-прежнему не полагается", () => {
  it("вещь сокровищницы: ни shop, ни price — ни в DTO, ни в разметке", () => {
    const dto = itemForGuest(
      dbItem({ inHall: true, priceVisibility: "ALL", receivedAt: new Date("2024-03-08T10:00:00Z") }),
    );

    expect([("shop" in dto), ("price" in dto)]).toEqual([false, false]);
    const markup = card(dto);
    expect(markup).not.toContain("goldapple");
    expect(markup).not.toContain(GO);
    expect(markup).not.toContain(SUM);
  });

  it("демо-призрак: адреса у выдуманной вещи нет — ключа shop тоже", () => {
    const ghosts = demoGhostsFor("perfume", "perfume").map(ghostForGuest);
    expect(ghosts.length).toBeGreaterThan(0);
    for (const ghost of ghosts) {
      expect("shop" in ghost).toBe(false);
      expect(tile(ghost)).not.toContain(GO);
    }
  });

  it("вещь, добавленная руками без ссылки: ни блока, ни пустой кнопки", () => {
    // «Ничего не разобралось» рисуется отсутствием элемента, а не заглушкой:
    // кнопка «Перейти →», ведущая в никуда, хуже, чем её отсутствие.
    const dto = itemForGuest(
      dbItem({ source: "MANUAL", url: null, canonicalUrl: null, domain: null }),
    );

    expect("shop" in dto).toBe(false);
    const markup = card(dto);
    expect(markup).not.toContain(GO);
    expect(markup).not.toContain("goldapple");
    expect(tile(dto)).not.toContain(GO);
  });
});
