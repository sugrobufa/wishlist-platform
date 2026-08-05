// Тикет 13, вещи и призраки: setItemHidden ОБЯЗАН снимать бронь (контракт
// тикета 09, перекрёстно с ownerTakenCount), deleteItem снимает бронь и вещь,
// zonesOff НЕ рвёт брони (решение зафиксировано тестом), demoGhostsOff гасит
// демо-призраков и у хозяйки (zoneDisplayItems), и у гостя (getGuestRoom).
// Плюс (тикет 39): спрятанная вещь не попадает в счётчик шапки зоны.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import { deleteItem, listZoneItems, setItemHidden } from "../src/server/services/items";
import { bookItem, ownerTakenCount } from "../src/server/services/bookings";
import { setDemoGhostsOff, setZoneOff } from "../src/server/services/rooms";
import { getGuestRoom } from "../src/server/services/guest-room";
import { zoneDisplayItems } from "../src/components/zone/zone-display-items";
import type { OwnerItemDto } from "../src/server/dto/items";
import { ownerSummaryItem, zoneSummaryForOwner } from "../src/server/dto/zone-summary";

// Вне Next-рантайма у unstable_cache нет incremental cache — чтение напрямую.
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
  revalidateTag: () => undefined,
}));

const TEST_EMAIL_DOMAIN = "@settings-items.test";

async function createOwnerWithRoom() {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Мила" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `si${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    },
  });
  return { user, room };
}

async function createWantItem(roomId: string, zone = "jewelry", hidden = false) {
  return prisma.item.create({
    data: {
      roomId,
      zone,
      state: "WANT",
      title: `Вещь-${randomUUID().slice(0, 8)}`,
      price: "5000",
      currency: "RUB",
      hidden,
    },
  });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------- Скрытие вещи ----------

describe("setItemHidden — скрытие снимает бронь (контракт тикета 09)", () => {
  it("hidden=true: вещь спрятана, бронь исчезла, счётчик хозяйки упал; соседняя цела", async () => {
    const { user, room } = await createOwnerWithRoom();
    const target = await createWantItem(room.id, "jewelry");
    const neighbor = await createWantItem(room.id, "bags");
    await bookItem({ itemId: target.id, name: "Гостья" });
    await bookItem({ itemId: neighbor.id, name: "Второй Гость" });
    expect(await ownerTakenCount(user.id)).toBe(2);

    const updated = await setItemHidden(user.id, target.id, true);

    expect(updated.hidden).toBe(true);
    expect(await prisma.booking.findUnique({ where: { itemId: target.id } })).toBeNull();
    expect(await ownerTakenCount(user.id)).toBe(1); // перекрёстно со счётчиком
    expect(await prisma.booking.findUnique({ where: { itemId: neighbor.id } })).not.toBeNull();
  });

  it("показ обратно (hidden=false) бронь не воскрешает; вещь снова видна гостю", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id, "jewelry");
    await bookItem({ itemId: item.id, name: "Гостья" });

    await setItemHidden(user.id, item.id, true);
    const shown = await setItemHidden(user.id, item.id, false);

    expect(shown.hidden).toBe(false);
    expect(await ownerTakenCount(user.id)).toBe(0);
    const view = await getGuestRoom(room.shareSlug);
    expect(view?.itemsByZone.jewelry?.map((i) => i.id)).toContain(item.id);
  });

  it("повторное скрытие идемпотентно и закрывает бронь, повисшую до тикета 13", async () => {
    const { user, room } = await createOwnerWithRoom();
    // Дыра «до 13»: вещь уже hidden, а бронь на ней осталась (создаём напрямую).
    const item = await createWantItem(room.id, "perfume", true);
    await prisma.booking.create({
      data: {
        itemId: item.id,
        guestName: "Старая Гостья",
        cancelToken: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 16),
      },
    });
    expect(await ownerTakenCount(user.id)).toBe(1);

    const updated = await setItemHidden(user.id, item.id, true);

    expect(updated.hidden).toBe(true);
    expect(await ownerTakenCount(user.id)).toBe(0);
  });

  it("чужая вещь и незнакомый id → NOT_FOUND, ничего не меняется", async () => {
    const owner = await createOwnerWithRoom();
    const stranger = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);

    await expect(setItemHidden(stranger.user.id, item.id, true)).rejects.toMatchObject({
      name: "ItemMutationError",
      code: "NOT_FOUND",
    });
    await expect(setItemHidden(owner.user.id, "no-such-item", true)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).hidden).toBe(false);
  });
});

// ---------- Удаление вещи ----------

describe("deleteItem — бронь снимается, вещь исчезает", () => {
  it("удаляет вещь вместе с бронью; счётчик и соседи не задеты", async () => {
    const { user, room } = await createOwnerWithRoom();
    const target = await createWantItem(room.id, "jewelry");
    const neighbor = await createWantItem(room.id, "bags");
    await bookItem({ itemId: target.id, name: "Гостья" });
    await bookItem({ itemId: neighbor.id, name: "Второй Гость" });

    await deleteItem(user.id, target.id);

    expect(await prisma.item.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await prisma.booking.findUnique({ where: { itemId: target.id } })).toBeNull();
    expect(await ownerTakenCount(user.id)).toBe(1);
    expect(await prisma.item.findUnique({ where: { id: neighbor.id } })).not.toBeNull();
  });

  it("чужая вещь → NOT_FOUND и остаётся на месте; повторное удаление → NOT_FOUND", async () => {
    const owner = await createOwnerWithRoom();
    const stranger = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);

    await expect(deleteItem(stranger.user.id, item.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await prisma.item.findUnique({ where: { id: item.id } })).not.toBeNull();

    await deleteItem(owner.user.id, item.id);
    await expect(deleteItem(owner.user.id, item.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------- Счётчик в шапке зоны (тикет 39) ----------

describe("шапка /room/zone/{zone}: спрятанное в счётчик не входит (инвариант №5)", () => {
  it("«N вещей · M в подарок» считает только видимые вещи — тем же срезом, что панель зоны", async () => {
    const { user, room } = await createOwnerWithRoom();
    const visibleWant = await createWantItem(room.id, "jewelry");
    await prisma.item.create({
      data: { roomId: room.id, zone: "jewelry", state: "LOVE", title: "Цепочка" },
    });
    const hiddenWant = await createWantItem(room.id, "jewelry");

    // Ровно тот путь данных, которым живёт страница зоны: listZoneItems →
    // ownerSummaryItem → zoneSummaryForOwner. Своего подсчёта у шапки нет.
    const before = zoneSummaryForOwner(
      "jewelry",
      (await listZoneItems(room.id, "jewelry")).map(ownerSummaryItem),
    );
    expect(before).toMatchObject({ count: 3, wantCount: 2 });

    await setItemHidden(user.id, hiddenWant.id, true);

    const after = zoneSummaryForOwner(
      "jewelry",
      (await listZoneItems(room.id, "jewelry")).map(ownerSummaryItem),
    );
    // Вещь никуда не делась — она осталась в списке хозяйки, но из чисел ушла.
    expect((await listZoneItems(room.id, "jewelry")).length).toBe(3);
    expect(after).toMatchObject({ count: 2, wantCount: 1 });

    // Показали обратно — число вернулось.
    await setItemHidden(user.id, hiddenWant.id, false);
    const back = zoneSummaryForOwner(
      "jewelry",
      (await listZoneItems(room.id, "jewelry")).map(ownerSummaryItem),
    );
    expect(back).toMatchObject({ count: 3, wantCount: 2 });
    expect(visibleWant.hidden).toBe(false);
  });
});

// ---------- Выключение зоны и брони ----------

describe("setZoneOff — брони НЕ рвутся (решение тикета 13, зафиксировано)", () => {
  it("выключение зоны прячет её от гостя целиком, но бронь живёт и счётчик не падает", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id, "jewelry");
    await bookItem({ itemId: item.id, name: "Гостья" });
    expect(await ownerTakenCount(user.id)).toBe(1);

    await setZoneOff(user.id, "jewelry", true);

    // Зона исчезла из выдачи гостя целиком (инвариант №5)…
    const view = await getGuestRoom(room.shareSlug);
    expect(view?.itemsByZone.jewelry).toBeUndefined();
    // …а бронь цела: выключение обратимо, бронь гостя молча не рвём.
    expect(await prisma.booking.findUnique({ where: { itemId: item.id } })).not.toBeNull();
    expect(await ownerTakenCount(user.id)).toBe(1);
  });

  it("включение обратно возвращает зону гостю вместе с вещью и её бронью", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id, "jewelry");
    await bookItem({ itemId: item.id, name: "Гостья" });

    await setZoneOff(user.id, "jewelry", true);
    await setZoneOff(user.id, "jewelry", false);

    const view = await getGuestRoom(room.shareSlug);
    expect(view?.itemsByZone.jewelry?.map((i) => i.id)).toContain(item.id);
    expect(await ownerTakenCount(user.id)).toBe(1);
  });
});

// ---------- Демо-призраки: тумблер «Убрать примеры» ----------

describe("demoGhostsOff — призраки гаснут и у хозяйки, и у гостя", () => {
  it("гость: до тумблера пустые зоны полны призраков, после — честно пустые", async () => {
    const { user, room } = await createOwnerWithRoom();

    const before = await getGuestRoom(room.shareSlug);
    const zonesBefore = Object.values(before?.itemsByZone ?? {});
    expect(zonesBefore.length).toBeGreaterThan(0);
    expect(zonesBefore.every((items) => items.length > 0)).toBe(true);
    expect(
      zonesBefore.flat().every((item) => item.isDemo && item.id.startsWith("demo:")),
    ).toBe(true);

    await setDemoGhostsOff(user.id, true);

    const after = await getGuestRoom(room.shareSlug);
    const zonesAfter = Object.values(after?.itemsByZone ?? {});
    expect(zonesAfter.length).toBe(zonesBefore.length); // зоны на месте, исчезли только примеры
    expect(zonesAfter.every((items) => items.length === 0)).toBe(true);
  });

  it("гость: свои вещи выдаются и при выключенных примерах; тумблер обратим", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await createWantItem(room.id, "jewelry");
    await setDemoGhostsOff(user.id, true);

    const view = await getGuestRoom(room.shareSlug);
    expect(view?.itemsByZone.jewelry?.map((i) => i.id)).toEqual([item.id]);
    expect(view?.itemsByZone.beauty).toEqual([]);

    await setDemoGhostsOff(user.id, false);
    const back = await getGuestRoom(room.shareSlug);
    expect(back?.itemsByZone.beauty?.length).toBeGreaterThan(0); // призраки вернулись
  });

  it("хозяйка: zoneDisplayItems (общий шов страниц /room и /room/zone) гасит призраков", () => {
    // Пустая зона: без тумблера — призраки пула, с тумблером — честная пустота.
    const ghosts = zoneDisplayItems([], "jewelry", "jewel", false);
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every((item) => item.isDemo)).toBe(true);
    expect(zoneDisplayItems([], "jewelry", "jewel", true)).toEqual([]);

    // Своя вещь вытесняет призраков при любом положении тумблера.
    const own: OwnerItemDto[] = [
      {
        id: "own-1",
        zone: "jewelry",
        title: "Цепочка",
        note: null,
        photoUrl: null,
        hidden: false,
        isDemo: false,
        createdAt: "2026-01-10T10:00:00.000Z",
        state: "LOVE",
        giverName: null,
        receivedAt: null,
        inHall: false,
      },
    ];
    expect(zoneDisplayItems(own, "jewelry", "jewel", false)).toEqual(own);
    expect(zoneDisplayItems(own, "jewelry", "jewel", true)).toEqual(own);
  });
});
