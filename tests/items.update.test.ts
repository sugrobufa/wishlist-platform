// Тикет 39: правка вещи и перенос между зонами. Под замком три вещи:
// №2 — правкой нельзя вернуть вещь из «люблю» в «хочу» (переход необратим);
// №1 — вещь с активной бронью правится молча и бронь переживает правку:
//      отказать или предупредить нельзя, это раскрыло бы тихую бронь;
// №8 — цена в строку «люблю» не попадает даже полем.
// Плюс перенос: только в зону, которая есть в пресете и не выключена.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { prisma } from "../src/server/db";
import * as itemsService from "../src/server/services/items";
import { ItemMutationError, updateItem, getOwnItem } from "../src/server/services/items";
import { bookItem, ownerTakenCount } from "../src/server/services/bookings";
import { setZoneOff } from "../src/server/services/rooms";
import { itemForOwner } from "../src/server/dto/items";

// Вне Next-рантайма кэша не существует; revalidateTag глушим (как в соседях).
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
  revalidateTag: () => undefined,
}));

const TEST_EMAIL_DOMAIN = "@items-update.test";

async function createOwnerWithRoom() {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Мила" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `iu${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    },
  });
  return { user, room };
}

async function createWantItem(roomId: string, zone = "jewelry") {
  return prisma.item.create({
    data: {
      roomId,
      zone,
      state: "WANT",
      title: "Серьги-кольца",
      price: "7900",
      currency: "RUB",
      priceVisibility: "ALL",
      size: "one",
      color: "золотой",
      desire: 2,
    },
  });
}

async function createLoveItem(roomId: string, zone = "jewelry", receivedAt: Date | null = null) {
  return prisma.item.create({
    data: { roomId, zone, state: "LOVE", title: "Теннисный браслет", receivedAt },
  });
}

/** Полный набор полей формы «хочу» — правка присылает карточку целиком. */
function wantForm(overrides: Record<string, unknown> = {}) {
  return {
    zone: "jewelry",
    title: "Серьги-кольца",
    price: "7900",
    currency: "RUB",
    priceVisibility: "ALL",
    size: "one",
    color: "золотой",
    desire: 2,
    ...overrides,
  };
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------- Правка полей ----------

describe("updateItem — правка полей вещи", () => {
  it("«хочу»: название, цена, валюта, видимость, размер, цвет, желание и заметка", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id);

    const updated = await updateItem(
      user.id,
      item.id,
      wantForm({
        title: "  Серьги-кольца, крупные  ",
        price: "12900",
        currency: "usd",
        priceVisibility: "FRIENDS",
        size: "M",
        color: "белое золото",
        desire: 4,
        note: "  на день рождения  ",
      }),
    );

    expect(updated.title).toBe("Серьги-кольца, крупные"); // trim
    expect(updated.price?.toString()).toBe("12900");
    expect(updated.currency).toBe("USD"); // ISO 4217 в верхнем регистре
    expect(updated.priceVisibility).toBe("FRIENDS");
    expect(updated.size).toBe("M");
    expect(updated.color).toBe("белое золото");
    expect(updated.desire).toBe(4);
    expect(updated.note).toBe("на день рождения");
    expect(updated.state).toBe("WANT");
  });

  it("цена — Decimal, а не float: «14900,50» из формы доезжает копейка в копейку", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id);

    const updated = await updateItem(user.id, item.id, wantForm({ price: "14900,50" }));

    expect(updated.price?.toString()).toBe("14900.5");
    expect(typeof updated.price).not.toBe("number");
  });

  it("«люблю»: даритель и год; год тот же — точная дата «Дошло» не сбивается", async () => {
    const { user, room } = await createOwnerWithRoom();
    const exact = new Date("2026-03-08T19:30:00.000Z");
    const item = await createLoveItem(room.id, "jewelry", exact);

    const same = await updateItem(user.id, item.id, {
      zone: "jewelry",
      title: "Теннисный браслет",
      giverName: "мама",
      receivedYear: 2026,
      note: "ношу не снимая",
    });
    expect(same.giverName).toBe("мама");
    expect(same.receivedAt?.toISOString()).toBe(exact.toISOString()); // дата цела

    // Другой год — дата переезжает (полдень 1 января: год не съедет в чужой таймзоне).
    const moved = await updateItem(user.id, item.id, {
      zone: "jewelry",
      title: "Теннисный браслет",
      giverName: "мама",
      receivedYear: 2024,
    });
    expect(moved.receivedAt?.toISOString()).toBe("2024-01-01T12:00:00.000Z");

    // Год стёрли — «В комнате с» вернётся к дате появления вещи.
    const cleared = await updateItem(user.id, item.id, {
      zone: "jewelry",
      title: "Теннисный браслет",
    });
    expect(cleared.receivedAt).toBeNull();
    expect(cleared.giverName).toBeNull();
  });

  it("пустое название и цена нулём/буквами — ZodError, в БД ничего не меняется", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id);

    await expect(updateItem(user.id, item.id, wantForm({ title: "   " }))).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(updateItem(user.id, item.id, wantForm({ price: "0" }))).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      updateItem(user.id, item.id, wantForm({ price: "дорого" })),
    ).rejects.toBeInstanceOf(ZodError);

    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.title).toBe("Серьги-кольца");
    expect(after.price?.toString()).toBe("7900");
  });

  it("чужая вещь и незнакомый id → NOT_FOUND, чужая вещь цела", async () => {
    const owner = await createOwnerWithRoom();
    const stranger = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);

    await expect(updateItem(stranger.user.id, item.id, wantForm())).rejects.toMatchObject({
      name: "ItemMutationError",
      code: "NOT_FOUND",
    });
    await expect(
      updateItem(owner.user.id, "no-such-item", wantForm()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(
      "Серьги-кольца",
    );
  });
});

// ---------- Перенос между зонами ----------

describe("updateItem — перенос на другую полку", () => {
  it("вещь переезжает в другую зону комнаты", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id, "jewelry");

    const moved = await updateItem(user.id, item.id, wantForm({ zone: "bags" }));

    expect(moved.zone).toBe("bags");
    expect(await getOwnItem(user.id, item.id)).toMatchObject({ zone: "bags" });
  });

  it("зона не из пресета, выключенная зона и скрытая продуктом `money` → ZONE_NOT_VISIBLE", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id, "jewelry");

    await expect(
      updateItem(user.id, item.id, wantForm({ zone: "no-such-zone" })),
    ).rejects.toMatchObject({ code: "ZONE_NOT_VISIBLE" });

    // Зона «Просто деньги» есть в контракте, но продукт её не показывает
    // (ADR-0004) — перенести вещь туда нельзя.
    await expect(updateItem(user.id, item.id, wantForm({ zone: "money" }))).rejects.toMatchObject({
      code: "ZONE_NOT_VISIBLE",
    });

    // Выключенная полка исчезает вместе с мебелью (инвариант №5) — вещь
    // не должна проваливаться в невидимую комнату.
    await setZoneOff(user.id, "bags", true);
    await expect(updateItem(user.id, item.id, wantForm({ zone: "bags" }))).rejects.toMatchObject({
      code: "ZONE_NOT_VISIBLE",
    });
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).zone).toBe("jewelry");
  });
});

// ---------- Инвариант №2: «хочу → люблю» правкой не отменить ----------

describe("updateItem и необратимость перехода (инвариант №2)", () => {
  it("state в инпуте игнорируется: «люблю» остаётся «люблю», «хочу» — «хочу»", async () => {
    const { user, room } = await createOwnerWithRoom();
    const love = await createLoveItem(room.id);
    const want = await createWantItem(room.id, "bags");

    const stillLove = await updateItem(user.id, love.id, {
      zone: "jewelry",
      title: "Теннисный браслет",
      state: "WANT",
      price: "9900",
      currency: "RUB",
    });
    expect(stillLove.state).toBe("LOVE");

    const stillWant = await updateItem(
      user.id,
      want.id,
      wantForm({ zone: "bags", state: "LOVE", giverName: "мама" }),
    );
    expect(stillWant.state).toBe("WANT");
    expect(stillWant.giverName).toBeNull();
  });

  it("цена «люблю» не пишется даже полем (инвариант №8) и не сериализуется", async () => {
    const { user, room } = await createOwnerWithRoom();
    const love = await createLoveItem(room.id);

    const updated = await updateItem(user.id, love.id, {
      zone: "jewelry",
      title: "Теннисный браслет",
      price: "48000",
      currency: "RUB",
      priceVisibility: "ALL",
      size: "M",
      color: "золотой",
      desire: 4,
    });

    expect(updated.price).toBeNull();
    expect(updated.currency).toBeNull();
    expect(updated.size).toBeNull();
    expect(updated.color).toBeNull();
    expect(updated.desire).toBeNull();
    expect("price" in itemForOwner(updated)).toBe(false);
  });

  it("в поверхности сервиса нет ни одного экспорта со словом want", () => {
    // Тот же замок, что в tests/occasions.test.ts, — здесь он сторожит
    // именно правку: экспорт вида `updateWantItem` был бы первым шагом к
    // обратному переходу. Схемы правки поэтому и не экспортируются.
    expect(Object.keys(itemsService).filter((name) => /want/i.test(name))).toEqual([]);
    expect(new ItemMutationError("NOT_FOUND", "x")).toBeInstanceOf(Error);
  });
});

// ---------- Инвариант №1: вещь с активной бронью ----------

describe("updateItem и тихая бронь (инвариант №1)", () => {
  it("вещь с бронью правится молча: правка проходит, бронь и счётчик целы", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id, "jewelry");
    await bookItem({ itemId: item.id, name: "Гостья", email: "g@mail.test" });
    const booking = await prisma.booking.findUniqueOrThrow({ where: { itemId: item.id } });
    expect(await ownerTakenCount(user.id)).toBe(1);

    const updated = await updateItem(
      user.id,
      item.id,
      wantForm({ title: "Серьги-кольца, крупные", price: "12900", zone: "bags" }),
    );

    // Отказа нет: запрет или предупреждение сообщили бы хозяйке, что вещь
    // занята, — а этого ей знать нельзя.
    expect(updated.title).toBe("Серьги-кольца, крупные");
    expect(updated.zone).toBe("bags");

    // Бронь переживает и правку, и переезд: вещь у гостя осталась на месте,
    // просто на другой полке — снимают бронь только скрытие и удаление.
    const after = await prisma.booking.findUnique({ where: { itemId: item.id } });
    expect(after?.id).toBe(booking.id);
    expect(after?.guestName).toBe("Гостья");
    expect(await ownerTakenCount(user.id)).toBe(1);
  });

  it("ни ответ сервиса, ни DTO хозяйки не выдают ни имени гостьи, ни факта брони", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id);
    await bookItem({ itemId: item.id, name: "Гостья Тихая", email: "quiet@mail.test" });

    const updated = await updateItem(user.id, item.id, wantForm({ title: "Серьги" }));

    expect(JSON.stringify(updated)).not.toMatch(/Тихая|quiet@mail\.test/);
    const dto = itemForOwner(updated);
    for (const key of Object.keys(dto)) {
      expect(key).not.toMatch(/book|guest|taken|reserv|purchas|cancel/i);
    }
  });
});
