// Тикет 09: счётчик хозяйки и тесты инварианта тихой брони (CLAUDE.md №1).
//
// Хозяйке — ТОЛЬКО число «N вещей уже забраны»: ни id вещей, ни имён, ни почт,
// ни токенов. Проверяем все три слоя канала:
//   сервис ownerTakenCount (реальная БД) → роут /api/v1/room/taken-count →
//   и — главное — сериализацию ЦЕЛОЙ страницы данных хозяйки, в которой
//   брони не должны существовать ни под каким ключом.
// Плюс механизм автоснятия releaseBookingForItem (звать его при скрытии
// вещи обязан UI тикета 13 — здесь прямые тесты самой функции).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/server/auth";
import { prisma } from "../src/server/db";
import {
  bookItem,
  cancelBooking,
  markPurchased,
  ownerTakenCount,
  releaseBookingForItem,
  takenForRoomSlug,
  GUEST_BOOKINGS_COOKIE,
} from "../src/server/services/bookings";
import { listZoneItems } from "../src/server/services/items";
import { itemForOwner, type OwnerItemDto } from "../src/server/dto/items";
import { rooms as roomPresets } from "../src/config/design";
import { visibleZones } from "../src/components/scene/zones";
import { GET as takenCountRoute } from "../src/app/api/v1/room/taken-count/route";
import { GET as takenRoute } from "../src/app/api/v1/rooms/[slug]/taken/route";

const TEST_EMAIL_DOMAIN = "@owner-counter.test";

const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;

async function createOwnerWithRoom(displayName = "Хозяйка") {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `oc-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

/** Зоны — только реальные зоны пресета cream (jewelry/bags/perfume/…). */
async function createWantItem(
  roomId: string,
  zone = "jewelry",
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  return prisma.item.create({
    data: {
      roomId,
      zone,
      inHall: false,
      title: `Вещь-${randomUUID().slice(0, 8)}`,
      price: "5000",
      currency: "RUB",
      ...overrides,
    },
  });
}

// Чистим только своих пользователей; комнаты/вещи/брони уходят каскадом.
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("ownerTakenCount — только СВОЯ комната, только живые брони", () => {
  it("чужие комнаты не считаются; отмена гостя уменьшает счётчик", async () => {
    const owner = await createOwnerWithRoom();
    const neighbor = await createOwnerWithRoom("Соседка");

    const a = await createWantItem(owner.room.id, "jewelry");
    const b = await createWantItem(owner.room.id, "bags");
    await createWantItem(owner.room.id, "perfume"); // свободная — не считается
    const foreign = await createWantItem(neighbor.room.id);

    const { cancelToken } = await bookItem({ itemId: a.id, name: "Первая Гостья" });
    await bookItem({ itemId: b.id, name: "Второй Гость" });
    await bookItem({ itemId: foreign.id, name: "Гость соседки" });

    expect(await ownerTakenCount(owner.user.id)).toBe(2);
    expect(await ownerTakenCount(neighbor.user.id)).toBe(1);

    // Гость передумал — бронь исчезла, счётчик сразу отражает факт.
    await cancelBooking(cancelToken);
    expect(await ownerTakenCount(owner.user.id)).toBe(1);
  });

  it("«куплено» вещь НЕ освобождает: purchased-бронь остаётся в счётчике", async () => {
    const owner = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);
    const { cancelToken } = await bookItem({ itemId: item.id, name: "Гостья" });

    await markPurchased(cancelToken);
    expect(await ownerTakenCount(owner.user.id)).toBe(1);
  });

  it("пользователь без комнаты и незнакомый userId → честный 0", async () => {
    const roomless = await prisma.user.create({
      data: { email: `roomless-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    expect(await ownerTakenCount(roomless.id)).toBe(0);
    expect(await ownerTakenCount("no-such-user")).toBe(0);
  });
});

describe("releaseBookingForItem — автоснятие брони (механизм для тикета 13)", () => {
  it("снимает бронь спрятанной вещи, счётчик уменьшается; чужие брони целы", async () => {
    const owner = await createOwnerWithRoom();
    const toHide = await createWantItem(owner.room.id, "jewelry");
    const other = await createWantItem(owner.room.id, "bags");
    await bookItem({ itemId: toHide.id, name: "Гостья Спрятанной" });
    await bookItem({ itemId: other.id, name: "Гость Другой" });
    expect(await ownerTakenCount(owner.user.id)).toBe(2);

    // Сценарий тикета 13: хозяйка прячет вещь → UI обязан снять бронь.
    await prisma.item.update({ where: { id: toHide.id }, data: { hidden: true } });
    expect(await releaseBookingForItem(toHide.id)).toBe(true);

    expect(await prisma.booking.findUnique({ where: { itemId: toHide.id } })).toBeNull();
    expect(await ownerTakenCount(owner.user.id)).toBe(1); // счётчик уменьшился
    // Соседняя бронь не тронута.
    expect(await prisma.booking.count({ where: { itemId: other.id } })).toBe(1);
  });

  it("идемпотентна: без брони и на незнакомом id — false, без ошибок", async () => {
    const owner = await createOwnerWithRoom();
    const free = await createWantItem(owner.room.id);

    expect(await releaseBookingForItem(free.id)).toBe(false); // брони не было
    await bookItem({ itemId: free.id, name: "Гостья" });
    expect(await releaseBookingForItem(free.id)).toBe(true);
    expect(await releaseBookingForItem(free.id)).toBe(false); // повтор — тихий no-op
    expect(await releaseBookingForItem("no-such-item")).toBe(false);
  });
});

describe("ИНВАРИАНТ-СЕРИАЛИЗАЦИЯ: страница хозяйки не знает о бронях вовсе", () => {
  it("owner-DTO всех зон при 3 бронях в БД: ни следа брони; счётчик отдельно равен факту", async () => {
    const owner = await createOwnerWithRoom("Мила");
    const preset = roomPresets.find((candidate) => candidate.id === owner.room.preset);
    expect(preset).toBeDefined();

    // Вещи в нескольких зонах: три занятых, свободная и ещё одна в «fashion».
    // ПЕРЕПИСАНО (тикет 124): пятой была вещь «люблю»; вещи сокровищницы в
    // сетку зоны больше не приезжают, а тест смотрит именно на неё.
    const ring = await createWantItem(owner.room.id, "jewelry");
    const bag = await createWantItem(owner.room.id, "bags");
    const scent = await createWantItem(owner.room.id, "perfume");
    await createWantItem(owner.room.id, "travel"); // свободная
    await createWantItem(owner.room.id, "fashion");

    // Три брони с сочными секретами — им нельзя всплыть нигде.
    await bookItem({
      itemId: ring.id,
      name: "Секретная Гостья",
      email: "top-secret-1@mail.test",
      mode: "SIGNED",
    });
    await bookItem({ itemId: bag.id, name: "Тайный Даритель", email: "top-secret-2@mail.test" });
    const { cancelToken } = await bookItem({ itemId: scent.id, name: "Третья Подруга" });

    // Данные страницы хозяйки ЦЕЛИКОМ — ровно как buildZoneContent в
    // src/app/room/page.tsx: по каждой видимой зоне listZoneItems → itemForOwner.
    const entries = await Promise.all(
      visibleZones(preset!.zones, owner.room.zonesOff).map(
        async (zone) =>
          [zone.key, (await listZoneItems(owner.room.id, zone.key)).map(itemForOwner)] as const,
      ),
    );
    const pageData: Record<string, OwnerItemDto[]> = Object.fromEntries(entries);

    // Мы сериализовали не пустоту: вещи на странице есть, включая занятые.
    expect(pageData.jewelry?.map((dto) => dto.id)).toContain(ring.id);
    expect(pageData.fashion?.[0]?.inHall).toBe(false);

    const serialized = JSON.stringify(pageData);
    // Ни ключей брони, ни производных — нигде, ни под каким именем.
    expect(serialized).not.toMatch(/guestName|guestEmail|cancelToken|booking/i);
    // И ни одного фактического секрета из БД: имена, почты, токен.
    expect(serialized).not.toMatch(/Секретная|Тайный|Третья|top-secret|mail\.test/);
    expect(serialized).not.toContain(cancelToken);
    // Занятость вещи не кодируется в DTO и косвенно (пояс и подтяжки).
    expect(serialized).not.toMatch(/taken|reserv|purchas/i);

    // Счётчик — ОТДЕЛЬНЫМ каналом — равен факту в БД: ровно 3 брони.
    const fact = await prisma.booking.count({ where: { item: { roomId: owner.room.id } } });
    expect(fact).toBe(3);
    expect(await ownerTakenCount(owner.user.id)).toBe(3);

    // Каналы не смешиваются: гостевой канал знает, КАКИЕ вещи заняты (id без
    // имён — тикет 08), хозяйкин — только ЧИСЛО. Пересечения форматов нет.
    const guestChannel = await takenForRoomSlug(owner.room.shareSlug, []);
    expect([...guestChannel!.itemIds].sort()).toEqual([ring.id, bag.id, scent.id].sort());
    expect(JSON.stringify(guestChannel)).not.toMatch(
      /guestName|guestEmail|Секретная|Тайный|Третья|top-secret/,
    );

    // …и тот же канал по той же ссылке САМОЙ хозяйке не говорит ничего
    // (тикет 41): «поделиться» больше не превращается в список забранного.
    expect(
      await takenForRoomSlug(owner.room.shareSlug, [], { viewerUserId: owner.user.id }),
    ).toEqual({
      itemIds: [],
      mine: [],
      myBookingsCount: 0,
      signedIn: true,
      // Тоже не про брони: «ты хозяин ЭТОЙ комнаты» (тикет 250).
      isOwner: true,
      // Не про брони: её собственная витрина ей открыта (тикет 116).
      hallOpen: true,
    });
  });

  it("даже вещь, загруженная с include: {booking}, сериализуется без следа брони", async () => {
    const owner = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Оля Секретова", email: "polluted@mail.test" });

    // Настоящая строка БД с настоящим relation'ом — не синтетический объект.
    const polluted = await prisma.item.findUniqueOrThrow({
      where: { id: item.id },
      include: { booking: true },
    });
    expect(polluted.booking?.guestName).toBe("Оля Секретова"); // relation правда загружен

    const dto = itemForOwner(polluted);
    expect(JSON.stringify(dto)).not.toMatch(
      /guestName|guestEmail|cancelToken|booking|Секретова|polluted/i,
    );
  });
});

describe("GET /api/v1/room/taken-count — auth-only, no-store, голое число", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("без сессии → 401 и no-store", async () => {
    authMock.mockResolvedValue(null);
    const response = await takenCountRoute();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("AUTH");
  });

  it("с сессией → ровно {data:{takenCount}} и no-store; ничего лишнего", async () => {
    const owner = await createOwnerWithRoom();
    const a = await createWantItem(owner.room.id, "jewelry");
    const b = await createWantItem(owner.room.id, "bags");
    await bookItem({ itemId: a.id, name: "Гостья Роута", email: "route-secret@mail.test" });
    await bookItem({ itemId: b.id, name: "Гость Роута" });

    authMock.mockResolvedValue({ user: { id: owner.user.id } });
    const response = await takenCountRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // toEqual пиноит форму ЦЕЛИКОМ: кроме числа, в ответе нет ничего.
    expect(await response.json()).toEqual({ data: { takenCount: 2 } });
  });

  it("сессия есть, комнаты ещё нет → {takenCount: 0}", async () => {
    const roomless = await prisma.user.create({
      data: { email: `route-roomless-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    authMock.mockResolvedValue({ user: { id: roomless.id } });
    const response = await takenCountRoute();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { takenCount: 0 } });
  });
});

// Тикет 41. Гостевой канал — единственное место, где занятость вообще
// покидает сервер, и хозяйка добиралась до него в один клик: кнопка
// «поделиться» → своя же ссылка → пометки «занято» поимённо.
describe("GET /api/v1/rooms/{slug}/taken — хозяйке своей комнаты пусто", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  /** Запрос канала: cookie гостя опциональна, как в проде. */
  function takenRequest(slug: string, tokens?: string[]) {
    const headers = new Headers();
    if (tokens) {
      headers.set(
        "cookie",
        `${GUEST_BOOKINGS_COOKIE}=${encodeURIComponent(JSON.stringify(tokens))}`,
      );
    }
    return new NextRequest(`http://localhost/api/v1/rooms/${slug}/taken`, {
      method: "GET",
      headers,
    });
  }

  const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

  async function roomWithOneBooking() {
    const owner = await createOwnerWithRoom();
    const taken = await createWantItem(owner.room.id, "jewelry");
    await createWantItem(owner.room.id, "bags"); // свободная
    const { cancelToken } = await bookItem({
      itemId: taken.id,
      name: "Секретная Гостья",
      email: "route41-secret@mail.test",
    });
    return { owner, taken, cancelToken };
  }

  it("вошла хозяйка этой комнаты → 200 с пустотой и no-store", async () => {
    const { owner } = await roomWithOneBooking();
    authMock.mockResolvedValue({ user: { id: owner.user.id } });

    const response = await takenRoute(
      takenRequest(owner.room.shareSlug),
      slugCtx(owner.room.shareSlug),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // toEqual пиноит ответ ЦЕЛИКОМ: id занятых вещей в нём нет ни одного.
    // `hallOpen` про брони не говорит ничего — это её собственная витрина
    // (тикет 116), и запирать хозяйку от своих же вещей не за чем.
    expect(await response.json()).toEqual({
      // `isOwner` — тикет 250: канал говорит «ты хозяин ЭТОЙ комнаты», и на
      // этом всё. Списки как были пустыми, так и остались.
      data: {
        itemIds: [],
        mine: [],
        myBookingsCount: 0,
        signedIn: true,
        isOwner: true,
        hallOpen: true,
      },
    });
  });

  it("сессия по почте (id в session.user нет) — хозяйка узнаётся так же", async () => {
    // Auth.js с database-сессией кладёт в session.user только name/email:
    // ownership резолвится через getSessionUserId, и защита не должна
    // зависеть от того, попал ли id в сессию.
    const { owner } = await roomWithOneBooking();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: owner.user.id },
      select: { email: true },
    });
    authMock.mockResolvedValue({ user: { email: user.email } });

    const response = await takenRoute(
      takenRequest(owner.room.shareSlug),
      slugCtx(owner.room.shareSlug),
    );
    expect(await response.json()).toEqual({
      // `isOwner` — тикет 250: канал говорит «ты хозяин ЭТОЙ комнаты», и на
      // этом всё. Списки как были пустыми, так и остались.
      data: {
        itemIds: [],
        mine: [],
        myBookingsCount: 0,
        signedIn: true,
        isOwner: true,
        hallOpen: true,
      },
    });
  });

  it("та же ссылка без сессии → гость видит занятое и свою бронь (ЧЕСТНАЯ граница ADR-0007)", async () => {
    const { owner, taken, cancelToken } = await roomWithOneBooking();
    authMock.mockResolvedValue(null); // хозяйка вышла — она обычный гость

    const response = await takenRoute(
      takenRequest(owner.room.shareSlug, [cancelToken]),
      slugCtx(owner.room.shareSlug),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: { itemIds: string[]; mine: string[]; myBookingsCount: number };
    };
    expect(payload.data.itemIds).toEqual([taken.id]);
    expect(payload.data.mine).toEqual([taken.id]);
    expect(payload.data.myBookingsCount).toBe(1);
    // Имён по-прежнему нет ни у кого (инвариант №1 — тикет 08).
    expect(JSON.stringify(payload)).not.toMatch(/Секретная|route41-secret|cancelToken/);
  });

  it("вошёл кто-то другой → гостевой ответ: соседке занятое видно (US 26)", async () => {
    const { owner, taken } = await roomWithOneBooking();
    const neighbor = await createOwnerWithRoom("Соседка");
    authMock.mockResolvedValue({ user: { id: neighbor.user.id } });

    const response = await takenRoute(
      takenRequest(owner.room.shareSlug),
      slugCtx(owner.room.shareSlug),
    );
    const payload = (await response.json()) as { data: { itemIds: string[] } };
    expect(payload.data.itemIds).toEqual([taken.id]);
  });
});
