// Лента «Что происходит» — КОМУ она показывается (тикет 114, часть 2).
//
// Форму строки (свежесть, склейку, приоритет, кап) проверяет `feed.dto.test.ts`
// без базы. Здесь единственный вопрос, на который без базы не ответить: ЧЬИ
// события человек имеет право увидеть. Ответ один на весь продукт —
// `isConsentedConnection`: согласие получено И связь не «смотрели». Ошибись
// здесь, и лента начнёт рассказывать про комнаты чужих людей.
//
// Плюс два следствия, которые легко потерять:
// - выключенная зона исчезает вместе с мебелью (инвариант №5) — и её полка
//   в ленте тоже: иначе лента расскажет ровно то, что человек убрал;
// - адрес чужой комнаты отдаётся только тому, кто в ней уже был (решение
//   владельца 08.08, тикет 95): ссылка и есть ключ доступа (инвариант №7).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, RoomEventKind } from "@prisma/client";

import { prisma } from "../src/server/db";
import { listFriendsFeed } from "../src/server/services/friends-feed";

const TEST_EMAIL_DOMAIN = "@friends-feed.test";
const NOW = new Date("2026-08-09T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function person(displayName: string, options: { zonesOff?: string[] } = {}) {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `ff-${randomUUID().slice(0, 12)}`,
      zonesOff: options.zonesOff ?? [],
    },
  });
  return { user, room };
}

/** Связь пары фикстурой: сервис связей руками никого не заводит (инвариант №4). */
async function connect(
  viewerId: string,
  otherId: string,
  data: Partial<Prisma.ConnectionUncheckedCreateInput> = {},
) {
  return prisma.connection.create({
    data: {
      aUserId: viewerId,
      bUserId: otherId,
      kind: "MUTUAL",
      origin: "gift:test",
      ...data,
    },
  });
}

async function addEvent(
  roomId: string,
  kind: RoomEventKind,
  createdAt: Date,
  payload: Prisma.InputJsonObject = {},
) {
  await prisma.roomEvent.create({ data: { roomId, kind, payload, createdAt } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("лента отдаёт события ДРУЗЕЙ и только их", () => {
  it("событие друга видно, событие постороннего — нет", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Подруга");
    const stranger = await person("Посторонняя");

    await connect(viewer.user.id, friend.user.id);
    await addEvent(friend.room.id, "TREASURY_OPENED", ago(2));
    await addEvent(stranger.room.id, "TREASURY_OPENED", ago(1));

    const feed = await listFriendsFeed(viewer.user.id, NOW);
    expect(feed.map((row) => row.name)).toEqual(["Подруга"]);
  });

  it("«смотрели» другом не делает — сколько бы раз человек ни заходил", async () => {
    const viewer = await person("Смотрящая");
    const guest = await person("Заглянувший");

    await connect(viewer.user.id, guest.user.id, {
      kind: "VIEWED",
      origin: "visit",
      history: { visitsByB: 9 },
    });
    await addEvent(guest.room.id, "ROOM_CHANGED", ago(1), { preset: "emerald" });

    expect(await listFriendsFeed(viewer.user.id, NOW)).toEqual([]);
  });

  it("висящий вопрос ленты не открывает, а обоюдное «да» — открывает", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Дарительница");

    const row = await connect(viewer.user.id, friend.user.id, {
      consentAskedAt: ago(5),
      consentA: null,
      consentB: true,
    });
    await addEvent(friend.room.id, "TREASURY_OPENED", ago(2));

    expect(await listFriendsFeed(viewer.user.id, NOW)).toEqual([]);

    await prisma.connection.update({ where: { id: row.id }, data: { consentA: true } });
    expect(await listFriendsFeed(viewer.user.id, NOW)).toHaveLength(1);
  });

  it("отказ ленту закрывает — и молча", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Отказавшая");

    await connect(viewer.user.id, friend.user.id, {
      consentAskedAt: ago(5),
      consentA: true,
      consentB: false,
    });
    await addEvent(friend.room.id, "SHELF_OPENED", ago(2), { zone: "travel" });

    expect(await listFriendsFeed(viewer.user.id, NOW)).toEqual([]);
  });

  it("у новичка без связей лента пуста", async () => {
    const viewer = await person("Новенькая");
    await addEvent(viewer.room.id, "SHELF_OPENED", ago(1), { zone: "travel" });
    // Своих событий человек в ленте не видит: лента — про друзей.
    expect(await listFriendsFeed(viewer.user.id, NOW)).toEqual([]);
  });
});

describe("что именно доезжает до строки", () => {
  it("полка выключенной зоны в ленту не попадает (инвариант №5)", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Подруга", { zonesOff: ["travel"] });

    await connect(viewer.user.id, friend.user.id);
    await addEvent(friend.room.id, "SHELF_OPENED", ago(2), { zone: "travel" });
    await addEvent(friend.room.id, "SHELF_OPENED", ago(3), { zone: "jewelry" });

    const feed = await listFriendsFeed(viewer.user.id, NOW);
    expect(feed.map((row) => row.zone)).toEqual(["jewelry"]);
  });

  it("зона не из справочника строку не подписывает — её просто нет", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Подруга");

    await connect(viewer.user.id, friend.user.id);
    await addEvent(friend.room.id, "SHELF_OPENED", ago(2), { zone: "нет-такой-зоны" });

    expect(await listFriendsFeed(viewer.user.id, NOW)).toEqual([]);
  });

  it("зоны, которой в нынешнем интерьере нет, лента не показывает", async () => {
    // Комната «Кремовая» зоны `gaming` не содержит вовсе: полка из прошлого
    // интерьера — рассказ о комнате, которой уже нет.
    const viewer = await person("Смотрящая");
    const friend = await person("Подруга");

    await connect(viewer.user.id, friend.user.id);
    await addEvent(friend.room.id, "SHELF_OPENED", ago(2), { zone: "gaming" });

    expect(await listFriendsFeed(viewer.user.id, NOW)).toEqual([]);
  });

  it("взаимность приходит моментом связи, а не событием комнаты", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Соня");

    await connect(viewer.user.id, friend.user.id, {
      consentAskedAt: ago(4),
      consentA: true,
      consentB: true,
      mutualAt: ago(3),
    });

    const feed = await listFriendsFeed(viewer.user.id, NOW);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: "BECAME_MUTUAL", name: "Соня" });
    // В таблице событий этой строки нет — она посчитана из Connection.mutualAt.
    expect(await prisma.roomEvent.count({ where: { roomId: friend.room.id } })).toBe(0);
  });

  it("адрес комнаты — только тому, кто в ней уже был", async () => {
    const viewer = await person("Смотрящая");
    const never = await person("Незнакомая комната");
    const visited = await person("Знакомая комната");

    await connect(viewer.user.id, never.user.id);
    // Визиты направленные: смотрящая — сторона a, значит её визиты в чужую
    // комнату считает visitsByA. Ошибка стороной здесь раздала бы ключи.
    await connect(viewer.user.id, visited.user.id, { history: { visitsByA: 2 } });

    await addEvent(never.room.id, "TREASURY_OPENED", ago(1));
    await addEvent(visited.room.id, "TREASURY_OPENED", ago(2));

    const feed = await listFriendsFeed(viewer.user.id, NOW);
    expect(feed).toHaveLength(2);
    expect(feed.find((row) => row.name === "Незнакомая комната")?.roomSlug).toBeNull();
    expect(feed.find((row) => row.name === "Знакомая комната")?.roomSlug).toBe(
      visited.room.nick ?? visited.room.shareSlug,
    );
  });

  it("склейка работает и на настоящих событиях: день друга — одна строка", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Ира");

    await connect(viewer.user.id, friend.user.id);
    const day = new Date("2026-08-08T09:00:00.000Z");
    await addEvent(friend.room.id, "ROOM_CHANGED", day, { preset: "emerald" });
    await addEvent(friend.room.id, "ITEMS_ADDED", new Date("2026-08-08T15:00:00.000Z"), {
      zone: "travel",
    });
    await addEvent(friend.room.id, "ITEMS_ADDED", new Date("2026-08-08T16:00:00.000Z"), {
      zone: "travel",
    });

    const feed = await listFriendsFeed(viewer.user.id, NOW);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: "ROOM_CHANGED", preset: "emerald", wants: 2 });
  });
});

// Шов тикетов 114 и 116: строка «Сокровищница теперь открыта» живёт тридцать
// дней, а запереть витрину обратно можно за секунду. Оба тикета собирались
// параллельно, и каждый оставил этот вопрос соседу — поэтому проверка здесь.
describe("строка о сокровищнице сверяется с дверью СЕЙЧАС, а не в момент события", () => {
  it("витрину заперли — старая строка исчезает", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Ира");

    await connect(viewer.user.id, friend.user.id);
    await addEvent(friend.room.id, "TREASURY_OPENED", ago(2));

    const open = await listFriendsFeed(viewer.user.id, NOW);
    expect(open.map((row) => row.kind)).toContain("TREASURY_OPENED");

    await prisma.room.update({
      where: { id: friend.room.id },
      data: { hallVisibility: "NONE" },
    });

    const shut = await listFriendsFeed(viewer.user.id, NOW);
    expect(shut.map((row) => row.kind)).not.toContain("TREASURY_OPENED");
  });

  it("витрина «только взаимным»: взаимный друг строку видит", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Ира");

    await connect(viewer.user.id, friend.user.id, { mutualAt: ago(5) });
    await prisma.room.update({
      where: { id: friend.room.id },
      data: { hallVisibility: "MUTUAL" },
    });
    await addEvent(friend.room.id, "TREASURY_OPENED", ago(2));

    const feed = await listFriendsFeed(viewer.user.id, NOW);
    expect(feed.map((row) => row.kind)).toContain("TREASURY_OPENED");
  });

  it("витрина «только взаимным»: невзаимному другу строки нет", async () => {
    const viewer = await person("Смотрящая");
    const friend = await person("Ира");

    // Связь состоялась (её события лента показывает), но взаимной не стала —
    // а витрина открыта только взаимным. Строка звала бы в запертую дверь.
    await connect(viewer.user.id, friend.user.id, { mutualAt: null });
    await prisma.room.update({
      where: { id: friend.room.id },
      data: { hallVisibility: "MUTUAL" },
    });
    await addEvent(friend.room.id, "TREASURY_OPENED", ago(2));
    await addEvent(friend.room.id, "ROOM_CHANGED", ago(3), { preset: "emerald" });

    const feed = await listFriendsFeed(viewer.user.id, NOW);
    expect(feed.map((row) => row.kind)).not.toContain("TREASURY_OPENED");
    // Остальные события друга при этом на месте: заперта витрина, не связь.
    expect(feed.map((row) => row.kind)).toContain("ROOM_CHANGED");
  });
});
