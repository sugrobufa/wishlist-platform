// Лента «Что происходит» — ПОКАЗ (тикет 114, часть 2; задание 19, турн 35a).
//
// Запись событий проверяет `room-events.test.ts`, здесь — три правила, ради
// которых показ и ждал ответа дизайна:
//   1. память: желания живут 7 дней, вехи — 30, после фильтра кап 30 строк;
//   2. склейка: один друг в один день = одна строка, строка дня — высшая веха,
//      желания подклеиваются хвостом, вторая веха СГОРАЕТ;
//   3. новичок: ленты нет вовсе — ни строк, ни заголовка.
//
// Тесты без базы намеренно: правила формы строки живут в dto/feed.ts, и
// проверять «сгорела ли вторая веха» через Postgres значило бы проверять
// заодно и запросы. Кому лента показывается — отдельный вопрос и отдельный
// файл (`friends-feed.test.ts`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEED_MAX_ROWS,
  FEED_MILESTONE_DAYS,
  FEED_WANTS_DAYS,
  buildFeed,
  feedEventFresh,
  type FeedKind,
  type FeedSourceEvent,
} from "../src/server/dto/feed";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Момент «столько-то назад» — свежесть считается от NOW. */
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function event(
  friendId: string,
  kind: FeedKind,
  at: Date,
  extra: Partial<FeedSourceEvent> = {},
): FeedSourceEvent {
  return {
    friendId,
    friendName: friendId,
    roomSlug: `room-${friendId}`,
    roomPreset: "cream",
    kind,
    at,
    ...extra,
  };
}

describe("память ленты: желания 7 дней, вехи 30", () => {
  it("желание живёт неделю — на границе уже нет", () => {
    expect(feedEventFresh("ITEMS_ADDED", ago(FEED_WANTS_DAYS * DAY_MS - MINUTE_MS), NOW)).toBe(true);
    expect(feedEventFresh("ITEMS_ADDED", ago(FEED_WANTS_DAYS * DAY_MS), NOW)).toBe(false);
  });

  it("веха живёт месяц — на границе уже нет", () => {
    for (const kind of ["SHELF_OPENED", "TREASURY_OPENED", "ROOM_CHANGED", "BECAME_MUTUAL"] as const) {
      expect(feedEventFresh(kind, ago(FEED_MILESTONE_DAYS * DAY_MS - MINUTE_MS), NOW)).toBe(true);
      expect(feedEventFresh(kind, ago(FEED_MILESTONE_DAYS * DAY_MS), NOW)).toBe(false);
    }
  });

  it("в один и тот же день желание протухло, а веха ещё рассказывает", () => {
    const at = ago(10 * DAY_MS);
    const rows = buildFeed([event("мила", "ITEMS_ADDED", at), event("ира", "SHELF_OPENED", at)], NOW);
    expect(rows.map((row) => row.kind)).toEqual(["SHELF_OPENED"]);
  });

  it("протухшее желание не тащит за собой хвост к свежей вехе", () => {
    // Веха вчерашняя, желание — восьмидневное: в один день они не попадают,
    // но если бы фильтр свежести стоял ПОСЛЕ склейки, число хвоста осталось бы.
    const rows = buildFeed(
      [
        event("мила", "ROOM_CHANGED", ago(1 * DAY_MS), { preset: "emerald" }),
        event("мила", "ITEMS_ADDED", ago(8 * DAY_MS)),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.wants).toBe(0);
  });
});

describe("склейка: один друг в один день — одна строка", () => {
  it("три события одного друга за день дают одну строку", () => {
    const day = new Date("2026-08-08T09:00:00.000Z");
    const rows = buildFeed(
      [
        event("мила", "ITEMS_ADDED", day),
        event("мила", "ITEMS_ADDED", new Date("2026-08-08T15:00:00.000Z")),
        event("мила", "ITEMS_ADDED", new Date("2026-08-08T21:00:00.000Z")),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("ITEMS_ADDED");
    // Число в самой строке: «У Милы 3 новых желания».
    expect(rows[0]?.wants).toBe(3);
  });

  it("тот же друг в другой день — вторая строка", () => {
    const rows = buildFeed(
      [
        event("мила", "ITEMS_ADDED", new Date("2026-08-08T23:00:00.000Z")),
        event("мила", "ITEMS_ADDED", new Date("2026-08-07T23:00:00.000Z")),
      ],
      NOW,
    );
    expect(rows).toHaveLength(2);
  });

  it("разные друзья в один день не склеиваются", () => {
    const day = new Date("2026-08-08T09:00:00.000Z");
    const rows = buildFeed([event("мила", "ITEMS_ADDED", day), event("ира", "ITEMS_ADDED", day)], NOW);
    expect(rows).toHaveLength(2);
  });

  it("свежие строки сверху", () => {
    const rows = buildFeed(
      [
        event("давняя", "SHELF_OPENED", ago(12 * DAY_MS)),
        event("вчерашняя", "SHELF_OPENED", ago(1 * DAY_MS)),
        event("трёхдневная", "SHELF_OPENED", ago(3 * DAY_MS)),
      ],
      NOW,
    );
    expect(rows.map((row) => row.name)).toEqual(["вчерашняя", "трёхдневная", "давняя"]);
  });
});

describe("приоритет: связь → интерьер → сокровищница → полка → желания", () => {
  const day = new Date("2026-08-08T10:00:00.000Z");

  /** Все пять видов одного друга за один день, порядок прихода перемешан. */
  const all = (): FeedSourceEvent[] => [
    event("мила", "ITEMS_ADDED", new Date("2026-08-08T08:00:00.000Z")),
    event("мила", "SHELF_OPENED", new Date("2026-08-08T09:00:00.000Z"), { zone: "travel" }),
    event("мила", "TREASURY_OPENED", day),
    event("мила", "ROOM_CHANGED", new Date("2026-08-08T11:00:00.000Z"), { preset: "emerald" }),
    event("мила", "BECAME_MUTUAL", new Date("2026-08-08T12:00:00.000Z")),
  ];

  it("строка дня — высшее событие, и это связь", () => {
    const rows = buildFeed(all(), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("BECAME_MUTUAL");
  });

  it("порядок соблюдается на каждой ступени", () => {
    const ladder: FeedKind[] = [
      "BECAME_MUTUAL",
      "ROOM_CHANGED",
      "TREASURY_OPENED",
      "SHELF_OPENED",
      "ITEMS_ADDED",
    ];
    for (let step = 0; step < ladder.length; step += 1) {
      const rest = all().filter((candidate) => !ladder.slice(0, step).includes(candidate.kind));
      expect(buildFeed(rest, NOW)[0]?.kind).toBe(ladder[step]);
    }
  });

  it("две смены интерьера за день — побеждает поздняя: день кончился на ней", () => {
    const rows = buildFeed(
      [
        event("мила", "ROOM_CHANGED", new Date("2026-08-08T09:00:00.000Z"), { preset: "cream" }),
        event("мила", "ROOM_CHANGED", new Date("2026-08-08T20:00:00.000Z"), { preset: "emerald" }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.preset).toBe("emerald");
  });
});

describe("хвост желаний и сгоревшая веха", () => {
  const day = new Date("2026-08-08T10:00:00.000Z");

  it("желания подклеиваются к вехе хвостом", () => {
    const rows = buildFeed(
      [
        event("ира", "ROOM_CHANGED", day, { preset: "emerald" }),
        event("ира", "ITEMS_ADDED", new Date("2026-08-08T12:00:00.000Z")),
        event("ира", "ITEMS_ADDED", new Date("2026-08-08T13:00:00.000Z")),
        event("ира", "ITEMS_ADDED", new Date("2026-08-08T14:00:00.000Z")),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    // «Комната Иры — теперь „Изумруд" · и 3 новых желания».
    expect(rows[0]).toMatchObject({ kind: "ROOM_CHANGED", preset: "emerald", wants: 3 });
  });

  it("ВТОРАЯ ВЕХА ДНЯ СГОРАЕТ — хвост бывает только у желаний", () => {
    const rows = buildFeed(
      [
        event("ира", "ROOM_CHANGED", day, { preset: "emerald" }),
        event("ира", "TREASURY_OPENED", new Date("2026-08-08T11:00:00.000Z")),
        event("ира", "SHELF_OPENED", new Date("2026-08-08T12:00:00.000Z"), { zone: "travel" }),
        event("ира", "ITEMS_ADDED", new Date("2026-08-08T13:00:00.000Z")),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    // Ни сокровищницы, ни полки в строке не осталось: строка из трёх событий —
    // снова спам. Хвост считает ровно желания.
    expect(rows[0]).toMatchObject({ kind: "ROOM_CHANGED", zone: null, wants: 1 });
  });

  it("веха без желаний хвоста не получает", () => {
    const rows = buildFeed([event("ира", "TREASURY_OPENED", day)], NOW);
    expect(rows[0]?.wants).toBe(0);
  });

  it("тап ведёт в комнату друга при любой склейке", () => {
    const rows = buildFeed(
      [
        event("ира", "BECAME_MUTUAL", day, { roomSlug: "irina" }),
        event("ира", "ITEMS_ADDED", new Date("2026-08-08T13:00:00.000Z"), { roomSlug: "irina" }),
      ],
      NOW,
    );
    expect(rows[0]?.roomSlug).toBe("irina");
  });
});

describe("кап: 30 строк и никакого «показать ещё»", () => {
  it("после фильтра свежести остаётся не больше тридцати строк", () => {
    const events = Array.from({ length: 45 }, (_, index) =>
      event(`друг-${index}`, "SHELF_OPENED", ago((index + 1) * 60 * MINUTE_MS), { zone: "travel" }),
    );
    const rows = buildFeed(events, NOW);
    expect(rows).toHaveLength(FEED_MAX_ROWS);
    expect(FEED_MAX_ROWS).toBe(30);
    // Обрезается хвост, а не голова: лента показывает СВЕЖЕЕ.
    expect(rows[0]?.name).toBe("друг-0");
    expect(rows.at(-1)?.name).toBe("друг-29");
  });

  it("кап считается после свежести, а не вместо неё", () => {
    // Сорок старых вех и одно вчерашнее желание: капу нечего резать сверху.
    const events = [
      ...Array.from({ length: 40 }, (_, index) =>
        event(`старый-${index}`, "SHELF_OPENED", ago(FEED_MILESTONE_DAYS * DAY_MS + index * DAY_MS)),
      ),
      event("свежий", "ITEMS_ADDED", ago(1 * DAY_MS)),
    ];
    expect(buildFeed(events, NOW).map((row) => row.name)).toEqual(["свежий"]);
  });
});

describe("новичок: ленты нет вовсе", () => {
  const section = readFileSync(
    resolve(__dirname, "../src/app/connections/whats-happening.tsx"),
    "utf8",
  );

  it("пустая таблица событий даёт пустую ленту", () => {
    expect(buildFeed([], NOW)).toEqual([]);
  });

  it("протухло всё — тоже пусто, а не «здесь пока тихо»", () => {
    expect(buildFeed([event("мила", "ITEMS_ADDED", ago(30 * DAY_MS))], NOW)).toEqual([]);
  });

  it("без строк секция не рисуется целиком — заголовка тоже нет", () => {
    // Отказ стоит ПЕРЕД любым обращением к словарю: заголовок «Что
    // происходит» не может появиться раньше первой строки.
    const guard = section.indexOf("rows.length === 0");
    const heading = section.indexOf('t("title")');
    expect(guard).toBeGreaterThan(-1);
    expect(section.slice(guard, guard + 60)).toContain("return null");
    expect(heading).toBeGreaterThan(guard);
  });

  it("ключа пустого состояния у ленты нет — дизайн снял его заданием 19", () => {
    const ru = JSON.parse(
      readFileSync(resolve(__dirname, "../messages/ru.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(ru.Feed).toBeDefined();
    expect(ru.Feed).not.toHaveProperty("empty");
  });
});

describe("подарочного слоя в ленте нет ни в каком виде", () => {
  it("в форме строки нет ни броней, ни дарителей", () => {
    // Инварианты №1 и №2 плюс правило доски 34c: лента рассказывает про
    // комнату. Ключа, куда можно было бы положить бронь или имя дарителя,
    // в строке не существует — это и проверяем, а не «мы его не заполняем».
    const rows = buildFeed(
      [event("мила", "ITEMS_ADDED", ago(1 * DAY_MS)), event("ира", "BECAME_MUTUAL", ago(2 * DAY_MS))],
      NOW,
    );
    const keys = new Set(rows.flatMap((row) => Object.keys(row)));
    expect([...keys].sort()).toEqual([
      "at",
      "id",
      "kind",
      "name",
      "preset",
      "roomPreset",
      "roomSlug",
      "wants",
      "zone",
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/book|gift|giver|taken|бронь|подар/iu);
  });
});
