// Тикет 14 (GDPR), сервис account: экспорт «скачать мои данные» и полное
// удаление аккаунта. Реальная тест-БД; S3-часть — реальный MinIO из
// docker-compose (поднят рядом с postgres) плюс инъекция шва storage для
// сценариев «список ключей без листинга» и «S3 упал — операция не валится».
//
// Ключевые инварианты:
// - инвариант №1 распространяется на ЭКСПОРТ: JSON хозяйки не матчит
//   guestName/guestEmail/cancelToken и литеральные имена/почты гостей;
// - после deleteAccount в БД нет НИ ОДНОЙ строки пользователя (все модели,
//   включая безсвязные OccasionSummary/ParseJob/VerificationToken), чужие целы;
// - S3: удаляются и ключи из БД, и сироты по префиксам, и аватар; чужие живут.
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import {
  AccountError,
  DELETE_ACCOUNT_PHRASE,
  buildExport,
  deleteAccount,
  type AccountStorage,
} from "../src/server/services/account";
import { bookItem, listBookingsByTokens } from "../src/server/services/bookings";
import { getObjectStream, listKeysByPrefix, deleteObjects, presignPut } from "../src/server/s3";

const TEST_EMAIL_DOMAIN = "@account.test";

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function createOwnerWithRoom(overrides?: { occasionDate?: Date; nick?: string }) {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Мила" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `ac${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      occasionDate: overrides?.occasionDate ?? null,
      nick: overrides?.nick ?? null,
    },
  });
  return { user, room };
}

async function createWantItem(roomId: string, zone = "jewelry", data?: Record<string, unknown>) {
  return prisma.item.create({
    data: {
      roomId,
      zone,
      state: "WANT",
      title: `Вещь-${randomUUID().slice(0, 8)}`,
      price: "4900",
      currency: "RUB",
      ...data,
    },
  });
}

/** Шов хранилища-заглушки: БД-тесты не должны зависеть от MinIO. */
function blindStorage(): AccountStorage {
  return { listKeysByPrefix: async () => [], deleteObjects: async () => undefined };
}

/** Реальный PUT в MinIO через существующий presignPut (тот же путь, что у браузера). */
async function putTestObject(key: string): Promise<void> {
  const body = Buffer.from(`test-object ${key}`);
  const url = await presignPut(key, "image/jpeg", body.byteLength);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body,
  });
  if (!res.ok) throw new Error(`putTestObject: PUT ${key} → ${res.status}`);
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { id: true, room: { select: { id: true } } },
  });
  const userIds = users.map((entry) => entry.id);
  const roomIds = users.flatMap((entry) => (entry.room ? [entry.room.id] : []));
  // Модели без FK-связи с User каскад не заденет — чистим руками (как и сервис).
  await prisma.occasionSummary.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.parseJob.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.recognitionJob.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.verificationToken.deleteMany({
    where: { identifier: { endsWith: TEST_EMAIL_DOMAIN } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ====================================================================
// Экспорт
// ====================================================================

describe("buildExport — полнота", () => {
  it("отдаёт профиль, комнату (все поля тикета 13), все вещи включая hidden, счётчик и связи", async () => {
    const nick = `exp_${hex(4)}`;
    const { user, room } = await createOwnerWithRoom({
      occasionDate: new Date("2026-12-31T00:00:00.000Z"),
      nick,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarKey: `avatars/${user.id}/${hex(8)}.jpg` },
    });
    await prisma.room.update({
      where: { id: room.id },
      data: { zonesOff: ["beauty"], demoGhostsOff: true },
    });

    const wantItem = await createWantItem(room.id, "jewelry", { desire: 3, size: "M" });
    const hiddenItem = await createWantItem(room.id, "bags", {
      hidden: true,
      title: "Спрятанная сумка",
    });
    // Раскрытая вещь: даритель уже показан на «что подарили» — данные хозяйки.
    const lovedItem = await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "jewelry",
        state: "LOVE",
        title: "Серьги от бабушки",
        giverName: "Бабушка Аня",
        receivedAt: new Date("2026-01-07T00:00:00.000Z"),
        inHall: true,
      },
    });

    const stranger = await prisma.user.create({
      data: { email: `stranger-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    await prisma.connection.create({
      data: { aUserId: user.id, bUserId: stranger.id, kind: "VIEWED", origin: "visit" },
    });
    await prisma.connection.create({
      data: { aUserId: stranger.id, bUserId: user.id, kind: "MUTUAL", origin: `gift:${lovedItem.id}` },
    });

    await bookItem({ itemId: wantItem.id, name: "Тайная Гостья", email: "secret-guest@mail.test" });

    const exported = await buildExport(user.id);
    if (!exported) throw new Error("экспорт не собрался");

    expect(exported.user).toEqual({
      email: user.email,
      displayName: "Мила",
      locale: "ru",
      avatarKey: expect.stringMatching(new RegExp(`^avatars/${user.id}/[0-9a-f]{16}\\.jpg$`)),
      createdAt: expect.any(String),
    });
    expect(exported.room).toEqual({
      preset: "cream",
      zoneSet: "F",
      zonesOff: ["beauty"],
      shareSlug: room.shareSlug,
      nick,
      occasionDate: "2026-12-31T00:00:00.000Z",
      demoGhostsOff: true,
      createdAt: expect.any(String),
    });

    expect(exported.items).toHaveLength(3);
    const byId = new Map(exported.items.map((item) => [item.id, item]));
    expect(byId.get(hiddenItem.id)).toMatchObject({ hidden: true, title: "Спрятанная сумка" });
    expect(byId.get(wantItem.id)).toMatchObject({
      state: "WANT",
      price: "4900",
      currency: "RUB",
      desire: 3,
      size: "M",
    });
    // giverName РАСКРЫТОЙ вещи присутствует — раскрытие уже случилось.
    expect(byId.get(lovedItem.id)).toMatchObject({
      state: "LOVE",
      giverName: "Бабушка Аня",
      receivedAt: "2026-01-07T00:00:00.000Z",
      inHall: true,
    });

    // О бронях — только агрегат.
    expect(exported.bookings).toEqual({ takenCount: 1 });

    // Связи: ровно kind/origin/createdAt, обе стороны, без чужих email.
    expect(exported.connections).toHaveLength(2);
    for (const connection of exported.connections) {
      expect(Object.keys(connection).sort()).toEqual(["createdAt", "kind", "origin"]);
    }
    expect(exported.connections.map((c) => c.kind).sort()).toEqual(["MUTUAL", "VIEWED"]);
  });

  it("ИНВАРИАНТ №1 в экспорте: ни guestName/guestEmail/cancelToken, ни литеральных имён и почт гостей", async () => {
    const { user, room } = await createOwnerWithRoom();
    const wantItem = await createWantItem(room.id, "jewelry");
    const { cancelToken } = await bookItem({
      itemId: wantItem.id,
      name: "Тайная Гостья",
      email: "secret-guest@mail.test",
    });
    const stranger = await prisma.user.create({
      data: { email: `stranger-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    await prisma.connection.create({
      data: { aUserId: user.id, bUserId: stranger.id, kind: "FOLLOW", origin: "visit" },
    });

    const json = JSON.stringify(await buildExport(user.id));

    expect(json).not.toMatch(/guestName|guestEmail|cancelToken/);
    expect(json).not.toContain("Тайная Гостья");
    expect(json).not.toContain("secret-guest@mail.test");
    expect(json).not.toContain(cancelToken);
    // Чужой email не течёт и через связи.
    expect(json).not.toContain(stranger.email);
    // А счётчик при этом честный — бронь видна как число.
    expect(json).toContain('"takenCount":1');
  });

  it("без комнаты: user-часть отдаётся, room=null, вещей и броней нет; чужой id → null", async () => {
    const user = await prisma.user.create({
      data: { email: `roomless-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });

    const exported = await buildExport(user.id);
    if (!exported) throw new Error("экспорт не собрался");
    expect(exported.room).toBeNull();
    expect(exported.items).toEqual([]);
    expect(exported.bookings).toEqual({ takenCount: 0 });
    expect(exported.connections).toEqual([]);

    expect(await buildExport("нет-такого-пользователя")).toBeNull();
  });
});

// ====================================================================
// Удаление аккаунта: БД
// ====================================================================

describe("deleteAccount — в БД не остаётся ни одной строки пользователя", () => {
  it("каскад + явные deleteMany сносят всё; сосед с комнатой и бронью не тронут", async () => {
    // --- Полный граф пользователя A ---
    // Дата праздника — В БУДУЩЕМ, и это принципиально (тикет 30).
    // `processOccasionClose()` в соседнем форке выбирает ВСЕ комнаты базы с
    // `occasionDate < now` и заводит каждой `OccasionSummary`. С прошедшей
    // датой он успевал закрыть эту комнату раньше самого теста, и собственный
    // `occasionSummary.create` ниже падал с `P2002 (roomId, date)`.
    // Само значение даты ни на один ассерт не влияет — нужен лишь факт строки
    // в модели без FK на User, чтобы доказать, что её сносит явный deleteMany.
    // Дата считается от «сейчас», чтобы через год не стать снова прошедшей.
    const occasionDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const a = await createOwnerWithRoom({ occasionDate });
    await prisma.user.update({
      where: { id: a.user.id },
      data: { avatarKey: `avatars/${a.user.id}/${hex(8)}.jpg` },
    });
    await prisma.account.create({
      data: {
        userId: a.user.id,
        type: "email",
        provider: "test-provider",
        providerAccountId: `acct-${randomUUID()}`,
      },
    });
    await prisma.session.create({
      data: {
        userId: a.user.id,
        sessionToken: `sess-${randomUUID()}`,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.verificationToken.create({
      data: {
        identifier: a.user.email,
        token: `vt-${randomUUID()}`,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    const item1 = await createWantItem(a.room.id, "jewelry", {
      photoKey: `items/${a.room.id}/${hex(8)}.jpg`,
    });
    const item2 = await createWantItem(a.room.id, "bags");
    await prisma.priceSnapshot.create({
      data: { itemId: item1.id, price: "4900", currency: "RUB" },
    });
    const { cancelToken: tokenA } = await bookItem({
      itemId: item1.id,
      name: "Гостья Комнаты А",
      email: "guest-a@mail.test",
    });
    // Каркас складчины (Phase 2 в БД уже есть): бронь POOL со взносом.
    const poolBooking = await prisma.booking.create({
      data: {
        itemId: item2.id,
        mode: "POOL",
        guestName: "Складчица",
        cancelToken: hex(24),
        pool: { create: { name: "Складчица", amount: "1000" } },
      },
    });
    await prisma.occasionSummary.create({
      data: { roomId: a.room.id, date: occasionDate },
    });
    await prisma.parseJob.create({
      data: { url: "https://shop.example/x", userId: a.user.id, status: "DONE" },
    });
    await prisma.recognitionJob.create({
      data: { userId: a.user.id, imageKey: `private/${hex(8)}.jpg`, status: "PENDING" },
    });

    // --- Сосед B (должен уцелеть) и третий C для связи B–C ---
    const b = await createOwnerWithRoom();
    const c = await createOwnerWithRoom();
    const itemB = await createWantItem(b.room.id, "jewelry");
    const { cancelToken: tokenB } = await bookItem({
      itemId: itemB.id,
      name: "Гостья Комнаты Б",
    });
    await prisma.connection.create({
      data: { aUserId: a.user.id, bUserId: b.user.id, kind: "VIEWED", origin: "visit" },
    });
    await prisma.connection.create({
      data: { aUserId: b.user.id, bUserId: a.user.id, kind: "FOLLOW", origin: "visit" },
    });
    await prisma.connection.create({
      data: { aUserId: b.user.id, bUserId: c.user.id, kind: "MUTUAL", origin: "gift:test" },
    });

    // --- Удаление ---
    const result = await deleteAccount(a.user.id, blindStorage());
    expect(result).toEqual({ s3Cleaned: true });

    // --- A: count по всем моделям с фильтрами → 0 ---
    expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(0);
    expect(await prisma.room.count({ where: { OR: [{ id: a.room.id }, { userId: a.user.id }] } })).toBe(0);
    expect(await prisma.item.count({ where: { roomId: a.room.id } })).toBe(0);
    expect(
      await prisma.booking.count({
        where: { OR: [{ cancelToken: tokenA }, { id: poolBooking.id }] },
      }),
    ).toBe(0);
    expect(await prisma.poolContribution.count({ where: { bookingId: poolBooking.id } })).toBe(0);
    expect(await prisma.priceSnapshot.count({ where: { itemId: item1.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: a.user.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: a.user.id } })).toBe(0);
    expect(
      await prisma.connection.count({
        where: { OR: [{ aUserId: a.user.id }, { bUserId: a.user.id }] },
      }),
    ).toBe(0);
    expect(await prisma.occasionSummary.count({ where: { roomId: a.room.id } })).toBe(0);
    expect(await prisma.parseJob.count({ where: { userId: a.user.id } })).toBe(0);
    expect(await prisma.recognitionJob.count({ where: { userId: a.user.id } })).toBe(0);
    expect(await prisma.verificationToken.count({ where: { identifier: a.user.email } })).toBe(0);

    // --- Сосед B цел: комната, вещь, бронь, связь B–C ---
    expect(await prisma.user.count({ where: { id: b.user.id } })).toBe(1);
    expect(await prisma.room.count({ where: { id: b.room.id } })).toBe(1);
    expect(await prisma.item.count({ where: { id: itemB.id } })).toBe(1);
    expect(await prisma.booking.count({ where: { cancelToken: tokenB } })).toBe(1);
    expect(
      await prisma.connection.count({
        where: { aUserId: b.user.id, bUserId: c.user.id },
      }),
    ).toBe(1);

    // --- Гость после удаления: брони удалённой комнаты пропали, чужие остались ---
    const mine = await listBookingsByTokens([tokenA, tokenB]);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.itemId).toBe(itemB.id);
    // Cookie с одними мёртвыми токенами → пусто (страница покажет мягкое пустое состояние).
    expect(await listBookingsByTokens([tokenA])).toEqual([]);
  });

  it("повторное удаление → AccountError NOT_FOUND", async () => {
    const { user } = await createOwnerWithRoom();
    await deleteAccount(user.id, blindStorage());

    await expect(deleteAccount(user.id, blindStorage())).rejects.toMatchObject({
      name: "AccountError",
      code: "NOT_FOUND",
    });
    await expect(deleteAccount(user.id, blindStorage())).rejects.toBeInstanceOf(AccountError);
  });
});

// ====================================================================
// Удаление аккаунта: S3
// ====================================================================

describe("deleteAccount — чистка S3", () => {
  it("известные ключи уходят в deleteObjects даже при слепом листинге (СПИСОК + префиксы)", async () => {
    const { user, room } = await createOwnerWithRoom();
    const photoKey = `items/${room.id}/${hex(8)}.jpg`;
    const avatarKey = `avatars/${user.id}/${hex(8)}.jpg`;
    await createWantItem(room.id, "jewelry", { photoKey });
    await prisma.user.update({ where: { id: user.id }, data: { avatarKey } });

    const deleted = vi.fn(async (keys: string[]) => {
      void keys; // мок только записывает вызовы
    });
    const result = await deleteAccount(user.id, {
      listKeysByPrefix: async () => [],
      deleteObjects: deleted,
    });

    expect(result.s3Cleaned).toBe(true);
    expect(deleted).toHaveBeenCalledTimes(1);
    const keys = deleted.mock.calls[0]?.[0] ?? [];
    expect(keys).toContain(photoKey);
    expect(keys).toContain(avatarKey);
  });

  it("реальный MinIO: удаляются ключи вещей, сироты обоих префиксов и аватар; чужие объекты живы", async () => {
    // Двое независимых владельцев — заводим разом (тикет 30); сосед `t` нужен
    // только чтобы доказать, что его объекты уцелели.
    const [s, t] = await Promise.all([createOwnerWithRoom(), createOwnerWithRoom()]);

    const photoKey = `items/${s.room.id}/${hex(8)}.jpg`;
    const orphanPhotoKey = `items/${s.room.id}/${hex(8)}.jpg`; // в бакете есть, в БД нет
    const avatarKey = `avatars/${s.user.id}/${hex(8)}.jpg`;
    const orphanAvatarKey = `avatars/${s.user.id}/${hex(8)}.jpg`; // от прежней смены аватара
    const foreignPhotoKey = `items/${t.room.id}/${hex(8)}.jpg`;
    const foreignAvatarKey = `avatars/${t.user.id}/${hex(8)}.jpg`;

    // Вся подготовка разом (тикет 30): вещь, аватар и шесть объектов в бакете
    // друг от друга не зависят, порядок ни на что не влияет. Последовательный
    // цикл из шести загрузок стоил 1207 мс из 1770 мс теста — по ~200 мс на
    // круг до MinIO, и под полным прогоном именно он выносил тест за 5000 мс.
    await Promise.all([
      createWantItem(s.room.id, "jewelry", { photoKey }),
      prisma.user.update({ where: { id: s.user.id }, data: { avatarKey } }),
      ...[
        photoKey,
        orphanPhotoKey,
        avatarKey,
        orphanAvatarKey,
        foreignPhotoKey,
        foreignAvatarKey,
      ].map(putTestObject),
    ]);
    // Санити листинга: видны и ключ из БД, и сирота.
    expect((await listKeysByPrefix(`items/${s.room.id}/`)).sort()).toEqual(
      [photoKey, orphanPhotoKey].sort(),
    );

    const result = await deleteAccount(s.user.id); // настоящий storage по умолчанию

    expect(result).toEqual({ s3Cleaned: true });
    // Четыре независимых ЧТЕНИЯ одного и того же состояния «после удаления» —
    // спрашиваем разом (тикет 30). Порядок между ними ничего не значит, а
    // последовательно это были четыре отдельных круга до MinIO.
    const [ownItems, ownAvatars, foreignItems, foreignAvatar] = await Promise.all([
      listKeysByPrefix(`items/${s.room.id}/`),
      listKeysByPrefix(`avatars/${s.user.id}/`),
      listKeysByPrefix(`items/${t.room.id}/`),
      getObjectStream(foreignAvatarKey),
    ]);
    expect(ownItems).toEqual([]);
    expect(ownAvatars).toEqual([]);
    // Чужое не задето.
    expect(foreignItems).toEqual([foreignPhotoKey]);
    expect(foreignAvatar).not.toBeNull();

    // Прибираем чужие объекты — заодно deleteObjects проверен напрямую.
    await deleteObjects([foreignPhotoKey, foreignAvatarKey]);
    expect(await listKeysByPrefix(`items/${t.room.id}/`)).toEqual([]);
  });

  it("ошибка S3 НЕ валит операцию: аккаунт удалён, s3Cleaned=false, лог написан", async () => {
    const { user, room } = await createOwnerWithRoom();
    await createWantItem(room.id, "jewelry", { photoKey: `items/${room.id}/${hex(8)}.jpg` });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await deleteAccount(user.id, {
        listKeysByPrefix: async () => {
          throw new Error("S3 недоступен");
        },
        deleteObjects: async () => undefined,
      });

      expect(result).toEqual({ s3Cleaned: false });
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
    // Аккаунт при этом честно удалён.
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.room.count({ where: { id: room.id } })).toBe(0);
  });
});

// ====================================================================
// Фраза подтверждения — канон один
// ====================================================================

describe("фраза удаления", () => {
  it("канон «удалить комнату» — его перепроверяет сервер и требует клиент", () => {
    expect(DELETE_ACCOUNT_PHRASE).toBe("удалить комнату");
  });
});
