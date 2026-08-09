// Интеграционные тесты сервиса «Тихая бронь» (тикет 08) через публичные
// функции с реальной тест-БД — самый высокий шов (spec Phase 1).
//
// Главный инвариант (CLAUDE.md №1): имена и почты гостей НЕ выходят из
// сервиса нигде — ни в канале «занято», ни в чужих «моих бронях»; ключей
// guestName/guestEmail не существует даже в СВОИХ бронях (allowlist-DTO).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import {
  addGuestBookingToken,
  BookingError,
  bookItem,
  cancelBooking,
  countBookingsByTokens,
  findTokenForItem,
  listBookingsByTokens,
  markPurchased,
  MAX_GUEST_BOOKING_TOKENS,
  parseGuestBookingTokens,
  removeGuestBookingToken,
  takenForRoomSlug,
  takenItemIds,
} from "../src/server/services/bookings";

const TEST_EMAIL_DOMAIN = "@bookings-service.test";

async function createTestRoom(options: { zonesOff?: string[]; displayName?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}`,
      displayName: options.displayName,
    },
  });
  return prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `b-${randomUUID().slice(0, 12)}`,
      zonesOff: options.zonesOff ?? [],
    },
  });
}

function wantItem(
  roomId: string,
  title = "Серьги-кольца",
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
): Prisma.ItemUncheckedCreateInput {
  return {
    roomId,
    zone: "jewelry",
    state: "WANT",
    title,
    price: "7900",
    currency: "RUB",
    ...overrides,
  };
}

async function createWantItem(
  roomId: string,
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  return prisma.item.create({ data: wantItem(roomId, "Серьги-кольца", overrides) });
}

/** Валидный вход брони: тесты перекрывают поля точечно. */
function bookingInput(itemId: string, overrides: Record<string, unknown> = {}) {
  return { itemId, name: "Тихий гость", mode: "QUIET", ...overrides };
}

// Чистим только своих пользователей; комнаты, вещи и брони уходят каскадом.
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function expectBookingError(promise: Promise<unknown>, code: BookingError["code"]) {
  try {
    await promise;
    expect.unreachable(`ожидался BookingError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(BookingError);
    expect((error as BookingError).code).toBe(code);
  }
}

describe("bookItem", () => {
  it("happy path: бронь создана, возвращён только cancelToken (48 hex)", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);

    const result = await bookItem(bookingInput(item.id, { email: "guest@mail.test" }));

    expect(Object.keys(result)).toEqual(["cancelToken"]);
    expect(result.cancelToken).toMatch(/^[0-9a-f]{48}$/);

    const booking = await prisma.booking.findUnique({ where: { itemId: item.id } });
    expect(booking?.mode).toBe("QUIET");
    expect(booking?.guestName).toBe("Тихий гость");
    expect(booking?.guestEmail).toBe("guest@mail.test");
    expect(booking?.purchased).toBe(false);
  });

  it("режим SIGNED сохраняется; пустой email → null; mode по умолчанию QUIET", async () => {
    const room = await createTestRoom();
    const signed = await createWantItem(room.id);
    await bookItem(bookingInput(signed.id, { mode: "SIGNED", email: "" }));
    const signedBooking = await prisma.booking.findUnique({ where: { itemId: signed.id } });
    expect(signedBooking?.mode).toBe("SIGNED");
    expect(signedBooking?.guestEmail).toBeNull();

    const defaulted = await createWantItem(room.id);
    await bookItem({ itemId: defaulted.id, name: "Без режима" });
    const defaultBooking = await prisma.booking.findUnique({ where: { itemId: defaulted.id } });
    expect(defaultBooking?.mode).toBe("QUIET");
  });

  it("двойная бронь → ALREADY_BOOKED (уникальность itemId, P2002)", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);

    await bookItem(bookingInput(item.id));
    await expectBookingError(
      bookItem(bookingInput(item.id, { name: "Второй гость" })),
      "ALREADY_BOOKED",
    );
    // Бронь первого гостя цела.
    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(1);
  });

  it("вещь «люблю» → NOT_WANT (бронируются только «хочу»)", async () => {
    const room = await createTestRoom();
    const love = await prisma.item.create({
      data: { roomId: room.id, zone: "jewelry", state: "LOVE", title: "Цепочка" },
    });
    await expectBookingError(bookItem(bookingInput(love.id)), "NOT_WANT");
  });

  it("демо-призрак (id demo:…) → DEMO_ITEM, в БД не ходим", async () => {
    await expectBookingError(bookItem(bookingInput("demo:jewelry:1")), "DEMO_ITEM");
  });

  it("складчина POOL → POOL_NOT_SUPPORTED (Phase 1 её не принимает)", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    await expectBookingError(bookItem(bookingInput(item.id, { mode: "POOL" })), "POOL_NOT_SUPPORTED");
  });

  it("незнакомый id → NOT_FOUND", async () => {
    await expectBookingError(bookItem(bookingInput("cl-no-such-item")), "NOT_FOUND");
  });

  it("спрятанная вещь и вещь выключенной зоны → NOT_FOUND (инвариант №5, без утечки факта)", async () => {
    const room = await createTestRoom({ zonesOff: ["bags"] });
    const hidden = await createWantItem(room.id, { hidden: true });
    await expectBookingError(bookItem(bookingInput(hidden.id)), "NOT_FOUND");

    const offZone = await createWantItem(room.id, { zone: "bags" });
    await expectBookingError(bookItem(bookingInput(offZone.id)), "NOT_FOUND");
  });

  it("валидация: без имени и с кривой почтой — ZodError", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    await expect(bookItem(bookingInput(item.id, { name: "  " }))).rejects.toThrow(ZodError);
    await expect(bookItem(bookingInput(item.id, { email: "не почта" }))).rejects.toThrow(ZodError);
  });
});

describe("cancelBooking / markPurchased — только по своему токену", () => {
  it("отмена по токену снимает бронь, вещь снова свободна", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    const { cancelToken } = await bookItem(bookingInput(item.id));

    await cancelBooking(cancelToken);
    expect(await prisma.booking.findUnique({ where: { itemId: item.id } })).toBeNull();

    // Вещь бронируется заново — уникальность не пострадала.
    await bookItem(bookingInput(item.id, { name: "Следующий гость" }));
  });

  it("чужой/несуществующий токен → TOKEN_NOT_FOUND, чужая бронь не тронута", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    await bookItem(bookingInput(item.id));

    const foreign = "a".repeat(48);
    await expectBookingError(cancelBooking(foreign), "TOKEN_NOT_FOUND");
    await expectBookingError(markPurchased(foreign), "TOKEN_NOT_FOUND");
    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(1);
  });

  it("«куплено» — переключатель: туда и обратно", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    const { cancelToken } = await bookItem(bookingInput(item.id));

    await markPurchased(cancelToken);
    expect((await prisma.booking.findUnique({ where: { itemId: item.id } }))?.purchased).toBe(true);

    await markPurchased(cancelToken, false);
    expect((await prisma.booking.findUnique({ where: { itemId: item.id } }))?.purchased).toBe(false);
  });
});

describe("takenItemIds / takenForRoomSlug — канал «занято» без имён", () => {
  it("отдаёт ТОЛЬКО id занятых вещей своей комнаты — ничего больше", async () => {
    const room = await createTestRoom();
    const other = await createTestRoom();
    const bookedA = await createWantItem(room.id);
    const bookedB = await createWantItem(room.id);
    await createWantItem(room.id); // свободная — в выдачу не попадает
    const foreign = await createWantItem(other.id);

    await bookItem(bookingInput(bookedA.id, { email: "secret-a@mail.test" }));
    await bookItem(bookingInput(bookedB.id));
    await bookItem(bookingInput(foreign.id, { name: "Гость чужой комнаты" }));

    const ids = await takenItemIds(room.id);
    expect([...ids].sort()).toEqual([bookedA.id, bookedB.id].sort());
    // Каждый элемент — голая строка-id: ни объектов, ни имён, ни режимов.
    for (const id of ids) expect(typeof id).toBe("string");
    const serialized = JSON.stringify(ids);
    expect(serialized).not.toMatch(/guestName|guestEmail|mail\.test|Гость/);
  });

  it("«подписаться под подарком» НЕ показывает имя другим гостям (тикет 105)", async () => {
    // Доска Б11 рисовала «Уже дарят · Аня забрала» — имя занявшего другим
    // гостям ещё до праздника. Владелец 08.08.2026 закрыл расхождение
    // компромиссом: смысл берём (двое не подарят одно и то же), имя нет.
    // Значит режим брони на канал влиять НЕ должен: подписался человек или
    // нет — соседний гость видит один и тот же голый id.
    const room = await createTestRoom();
    const signed = await createWantItem(room.id);
    const quiet = await createWantItem(room.id);

    await bookItem({ ...bookingInput(signed.id, { name: "Аня" }), mode: "SIGNED" });
    await bookItem({ ...bookingInput(quiet.id, { name: "Кирилл" }), mode: "QUIET" });

    // Токенов чужого гостя у нас нет — смотрим комнату как посторонний.
    const asOtherGuest = await takenForRoomSlug(room.shareSlug, []);
    expect([...(asOtherGuest?.itemIds ?? [])].sort()).toEqual([signed.id, quiet.id].sort());
    expect(asOtherGuest?.mine).toEqual([]);
    expect(JSON.stringify(asOtherGuest)).not.toMatch(/Аня|Кирилл|SIGNED|QUIET/);
  });

  it("takenForRoomSlug: itemIds + mine по токенам самого гостя; чужой слаг → null", async () => {
    const room = await createTestRoom();
    const myItem = await createWantItem(room.id);
    const strangersItem = await createWantItem(room.id);
    const { cancelToken } = await bookItem(bookingInput(myItem.id));
    await bookItem(bookingInput(strangersItem.id, { name: "Другой гость" }));

    const result = await takenForRoomSlug(room.shareSlug, [cancelToken]);
    expect(result).not.toBeNull();
    expect([...result!.itemIds].sort()).toEqual([myItem.id, strangersItem.id].sort());
    expect(result!.mine).toEqual([myItem.id]); // чужая бронь «моей» не становится
    expect(result!.myBookingsCount).toBe(1);

    expect(await takenForRoomSlug("no-such-slug", [cancelToken])).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/guestName|guestEmail|Другой/);
  });

  it("канал отвечает и по НИКУ комнаты: /r/{nick} — канонический адрес", async () => {
    // Страница /r/{shareSlug} уводит на /r/{nick} (тикет 13), и клиент
    // спрашивает канал уже по нику. Резолв здесь тот же, что в guest-room.
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    await bookItem(bookingInput(item.id));
    const nick = `nick_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    await prisma.room.update({ where: { id: room.id }, data: { nick } });

    const byNick = await takenForRoomSlug(nick, []);
    expect(byNick?.itemIds).toEqual([item.id]);
    // Старый короткий код продолжает работать — ссылки живут вечно.
    expect((await takenForRoomSlug(room.shareSlug, []))?.itemIds).toEqual([item.id]);
  });
});

// Тикет 41: главный инвариант ломался в самом дешёвом месте — хозяйка
// открывала СВОЮ ЖЕ ссылку и видела поимённо, какие её вещи заняты.
describe("takenForRoomSlug — хозяйке своей комнаты канал отвечает пустотой", () => {
  it("вошла хозяйка: itemIds/mine пусты, myBookingsCount 0 — как будто не занято ничего", async () => {
    const room = await createTestRoom();
    const a = await createWantItem(room.id, { title: "Занятая раз" });
    const b = await createWantItem(room.id, { title: "Занятая два" });
    await createWantItem(room.id, { title: "Свободная" });
    await bookItem(bookingInput(a.id, { name: "Секретная Гостья" }));
    await bookItem(bookingInput(b.id, { name: "Тайный Даритель" }));

    // Брони в БД есть — проверяем не пустую комнату.
    expect(await prisma.booking.count({ where: { item: { roomId: room.id } } })).toBe(2);

    const forOwner = await takenForRoomSlug(room.shareSlug, [], {
      viewerUserId: room.userId,
    });
    // toEqual пиноит ответ ЦЕЛИКОМ: ни одного непустого поля ПРО БРОНИ.
    // `signedIn` и `hallOpen` о бронях не говорят ничего — первое про вход
    // в аккаунт (тикет 98b), второе про её же витрину (тикет 116): запирать
    // хозяйку от собственных вещей не за чем.
    expect(forOwner).toEqual({
      itemIds: [],
      mine: [],
      myBookingsCount: 0,
      signedIn: true,
      hallOpen: true,
    });
  });

  it("её собственные брони в ЧУЖИХ комнатах в этот ноль не попадают как факт: чужая комната отвечает ей как гостю", async () => {
    // Хозяйка — обычный гость в комнате подруги: там канал работает полностью.
    const mine = await createTestRoom();
    const friend = await createTestRoom();
    const friendsItem = await createWantItem(friend.id, { title: "Подарок подруге" });
    const { cancelToken } = await bookItem(bookingInput(friendsItem.id), {
      sessionUserId: mine.userId,
    });

    const inFriendsRoom = await takenForRoomSlug(friend.shareSlug, [cancelToken], {
      viewerUserId: mine.userId,
    });
    expect(inFriendsRoom?.itemIds).toEqual([friendsItem.id]);
    expect(inFriendsRoom?.mine).toEqual([friendsItem.id]);
    expect(inFriendsRoom?.myBookingsCount).toBe(1);

    // А в своей — по-прежнему пусто, включая счётчик её же броней.
    const inOwnRoom = await takenForRoomSlug(mine.shareSlug, [cancelToken], {
      viewerUserId: mine.userId,
    });
    expect(inOwnRoom).toEqual({
      itemIds: [],
      mine: [],
      myBookingsCount: 0,
      signedIn: true,
      hallOpen: true,
    });
  });

  it("пустота — только СВОЕЙ хозяйке: соседка и аноним видят занятое как раньше", async () => {
    const room = await createTestRoom();
    const neighbor = await createTestRoom();
    const item = await createWantItem(room.id);
    await bookItem(bookingInput(item.id));

    // Вошедшая соседка — такой же гость: занятое ей видно (US 26).
    const asNeighbor = await takenForRoomSlug(room.shareSlug, [], {
      viewerUserId: neighbor.userId,
    });
    expect(asNeighbor?.itemIds).toEqual([item.id]);

    // Аноним и «сессии нет» (null/undefined) — прежнее поведение без изменений.
    expect((await takenForRoomSlug(room.shareSlug, []))?.itemIds).toEqual([item.id]);
    expect(
      (await takenForRoomSlug(room.shareSlug, [], { viewerUserId: null }))?.itemIds,
    ).toEqual([item.id]);

    // Чужой userId, похожий на мусор, ничего не открывает и не ломает.
    expect(
      (await takenForRoomSlug(room.shareSlug, [], { viewerUserId: "no-such-user" }))?.itemIds,
    ).toEqual([item.id]);
  });

  it("хозяйка вышла из аккаунта — видит комнату как гость: это ЧЕСТНАЯ граница, а не дыра", async () => {
    // ADR-0007: инвариант обещает, что продукт ей не показывает, а не что она
    // не может подсмотреть. Ссылка публична по устройству — иначе гости не
    // зашли бы. Тест фиксирует границу словами, чтобы её не «чинили» молча.
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    await bookItem(bookingInput(item.id));

    const loggedOut = await takenForRoomSlug(room.shareSlug, []);
    expect(loggedOut?.itemIds).toEqual([item.id]);
  });
});

describe("listBookingsByTokens — «мои брони» без чужих секретов", () => {
  it("строгий allowlist ключей: guestName/guestEmail не существуют даже у своих", async () => {
    const room = await createTestRoom({ displayName: "Мила" });
    const item = await createWantItem(room.id, { photoKey: null });
    const { cancelToken } = await bookItem(
      bookingInput(item.id, { email: "my-own@mail.test", mode: "SIGNED" }),
    );

    const bookings = await listBookingsByTokens([cancelToken]);
    expect(bookings).toHaveLength(1);
    expect(Object.keys(bookings[0]!).sort()).toEqual([
      // «Показаться после праздника · да/нет» (хвост тикета 98b): ключ есть
      // всегда, значение — только у гостя с аккаунтом (ниже отдельный тест).
      "connection",
      "createdAt",
      "itemId",
      "mode",
      "ownerName",
      "photoUrl",
      "purchased",
      "roomSlug",
      "title",
    ]);
    expect(bookings[0]).toMatchObject({
      itemId: item.id,
      title: "Серьги-кольца",
      photoUrl: null,
      roomSlug: room.shareSlug,
      ownerName: "Мила",
      mode: "SIGNED",
      purchased: false,
      // Бронь анонимная — связывать некого, строки о связи не будет вовсе.
      connection: null,
    });
    expect(JSON.stringify(bookings)).not.toMatch(/guestName|guestEmail|my-own/);
  });

  it("чужие токены не раскрываются: выдача — только по перечисленным", async () => {
    const room = await createTestRoom();
    const mineItem = await createWantItem(room.id);
    const foreignItem = await createWantItem(room.id);
    const { cancelToken: myToken } = await bookItem(bookingInput(mineItem.id));
    await bookItem(
      bookingInput(foreignItem.id, { name: "Чужой Гость", email: "foreign-secret@mail.test" }),
    );

    const bookings = await listBookingsByTokens([myToken, "f".repeat(48), "мусор"]);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.itemId).toBe(mineItem.id);
    expect(JSON.stringify(bookings)).not.toMatch(/foreign-secret|Чужой/);

    expect(await listBookingsByTokens([])).toEqual([]);
    expect(await countBookingsByTokens([myToken, "junk"])).toBe(1);
  });

  it("findTokenForItem находит токен вещи только среди СВОИХ токенов", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    const { cancelToken } = await bookItem(bookingInput(item.id));

    expect(await findTokenForItem(item.id, [cancelToken])).toBe(cancelToken);
    expect(await findTokenForItem(item.id, ["b".repeat(48)])).toBeNull();
    expect(await findTokenForItem(item.id, [])).toBeNull();
  });
});

describe("cookie guest_bookings — чистые помощники", () => {
  const token = () => randomUUID().replaceAll("-", "").padEnd(48, "0").slice(0, 48);

  it("parse: мусор любого вида → []; валидные токены выживают, дубли схлопываются", () => {
    expect(parseGuestBookingTokens(undefined)).toEqual([]);
    expect(parseGuestBookingTokens("не json")).toEqual([]);
    expect(parseGuestBookingTokens('{"a":1}')).toEqual([]);
    const a = token();
    expect(parseGuestBookingTokens(JSON.stringify([a, a, "junk", 42, "b".repeat(47)]))).toEqual([a]);
  });

  it("add/remove: дубль не плодится, хвост режется со старого конца", () => {
    const a = token();
    const b = token();
    expect(addGuestBookingToken([a], a)).toEqual([a]);
    expect(addGuestBookingToken([a], b)).toEqual([a, b]);
    expect(removeGuestBookingToken([a, b], a)).toEqual([b]);

    const many = Array.from({ length: MAX_GUEST_BOOKING_TOKENS }, token);
    const overflow = addGuestBookingToken(many, b);
    expect(overflow).toHaveLength(MAX_GUEST_BOOKING_TOKENS);
    expect(overflow.at(-1)).toBe(b);
    expect(overflow).not.toContain(many[0]); // выпал самый старый
  });
});
