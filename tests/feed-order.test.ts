// Порядок ленты друзей (тикет 95, доска Б7 · турн 11e).
//
// Что здесь защищается:
// - один порядок и никакого ручного: ближайший праздник выше;
// - без даты — после разделителя, по последней активности;
// - отсчёт появляется за 30 дней, пульс — за 7;
// - прошедший праздник не тащит связь наверх «минус пятым днём».
import { describe, expect, it } from "vitest";
import type { ConnectionRowDto } from "../src/server/services/connections";
import { countdownShown, orderFeed, urgent } from "../src/app/connections/feed-order";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function row(
  id: string,
  occasionDate: string | null,
  lastAt = "2026-08-01T00:00:00.000Z",
): ConnectionRowDto {
  return {
    id,
    kind: "MUTUAL",
    displayName: id,
    avatarUrl: null,
    origin: { type: "link" },
    lastAt,
    createdAt: lastAt,
    // Состоявшаяся связь: односторонние строки («знакомы · подарок в истории»,
    // хвост 98b) в ленту не попадают — у них комнаты нет по построению.
    consent: "active",
    room:
      occasionDate === null
        ? null
        : { slug: `s-${id}`, preset: "cream", occasionDate, freeGifts: 3 },
  };
}

/** Комната есть, а даты праздника в ней нет — тоже «без даты». */
function roomWithoutDate(id: string, lastAt: string): ConnectionRowDto {
  const base = row(id, "2026-09-01", lastAt);
  return { ...base, room: { ...base.room!, occasionDate: null } };
}

describe("orderFeed — ближайший праздник выше", () => {
  it("сортирует по дням до праздника, а не по последней активности", () => {
    const { upcoming, rest } = orderFeed(
      [
        row("через-месяц", "2026-09-07"),
        row("завтра", "2026-08-09"),
        row("через-неделю", "2026-08-15"),
      ],
      NOW,
    );
    expect(upcoming.map((item) => item.row.id)).toEqual(["завтра", "через-неделю", "через-месяц"]);
    expect(upcoming.map((item) => item.daysLeft)).toEqual([1, 7, 30]);
    expect(rest).toEqual([]);
  });

  it("сегодняшний праздник — самый верх, ноль дней", () => {
    const { upcoming } = orderFeed([row("завтра", "2026-08-09"), row("сегодня", "2026-08-08")], NOW);
    expect(upcoming[0]?.row.id).toBe("сегодня");
    expect(upcoming[0]?.daysLeft).toBe(0);
  });

  it("прошедший праздник уходит вниз, а не всплывает отрицательными днями", () => {
    const { upcoming, rest } = orderFeed(
      [row("вчера", "2026-08-07"), row("завтра", "2026-08-09")],
      NOW,
    );
    expect(upcoming.map((item) => item.row.id)).toEqual(["завтра"]);
    expect(rest.map((item) => item.row.id)).toEqual(["вчера"]);
  });

  it("без комнаты и без даты — вторая группа, по последней активности", () => {
    const { upcoming, rest } = orderFeed(
      [
        row("давний", null, "2026-07-01T00:00:00.000Z"),
        row("свежий", null, "2026-08-05T00:00:00.000Z"),
        roomWithoutDate("комната-без-даты", "2026-08-07T00:00:00.000Z"),
      ],
      NOW,
    );
    expect(upcoming).toEqual([]);
    expect(rest.map((item) => item.row.id)).toEqual(["комната-без-даты", "свежий", "давний"]);
    expect(rest.every((item) => item.daysLeft === null)).toBe(true);
  });

  it("равные дни разводятся последней активностью, свежая выше", () => {
    const { upcoming } = orderFeed(
      [
        row("старая", "2026-08-12", "2026-07-01T00:00:00.000Z"),
        row("свежая", "2026-08-12", "2026-08-06T00:00:00.000Z"),
      ],
      NOW,
    );
    expect(upcoming.map((item) => item.row.id)).toEqual(["свежая", "старая"]);
  });

  it("мусорная дата праздником не считается", () => {
    const { upcoming, rest } = orderFeed([row("31-февраля", "2026-02-31")], NOW);
    expect(upcoming).toEqual([]);
    expect(rest).toHaveLength(1);
  });
});

describe("окна отсчёта и срочности", () => {
  it("отсчёт — за 30 дней, раньше показываем дату", () => {
    expect(countdownShown(30)).toBe(true);
    expect(countdownShown(31)).toBe(false);
  });

  it("пульс — за 7 дней, не раньше", () => {
    expect(urgent(7)).toBe(true);
    expect(urgent(8)).toBe(false);
  });
});
