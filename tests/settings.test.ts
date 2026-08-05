// Тикет 13, настройки комнаты: ник (занятие/уникальность/резерв/формат/
// смена/освобождение), смена пресета (переезд несовпавших зон в anything,
// ничего не потерялось — включая hidden), набор зон и вкл/выкл зон, дата
// праздника (полночь UTC), профиль (имя, аватар — своя валидация ключа).
// Интеграционно, через публичные функции сервиса с реальной тест-БД (spec).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import {
  AVATAR_MAX_BYTES,
  changeRoomPreset,
  getOwnerProfile,
  isReservedNick,
  newAvatarKey,
  setOccasionDate,
  setOwnerAvatar,
  setRoomNick,
  setZoneOff,
  setZoneSet,
  updateDisplayName,
} from "../src/server/services/rooms";
import { getGuestRoom } from "../src/server/services/guest-room";
import { rooms as roomPresets } from "../src/config/design";

// Вне Next-рантайма у unstable_cache нет incremental cache — чтение напрямую;
// revalidateTag вне request-scope гасится сервисами сам (try/catch).
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
  revalidateTag: () => undefined,
}));

const TEST_EMAIL_DOMAIN = "@settings.test";

/** Ник валидного формата, уникальный на прогон: [a-z0-9_]{3,30}. */
function freshNick(prefix = "nick"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

async function createOwnerWithRoom(preset = "cream", zoneSet = "F", shareSlug?: string) {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Мила" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset,
      zoneSet,
      shareSlug: shareSlug ?? `st${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    },
  });
  return { user, room };
}

async function roomOf(userId: string) {
  return prisma.room.findUniqueOrThrow({ where: { userId } });
}

// Чистим только своих пользователей; комнаты/вещи уходят каскадом.
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------- Ник ----------

describe("setRoomNick — занятие, смена, освобождение", () => {
  it("занимает ник; регистр прощается (toLowerCase); адрес резолвится гостю", async () => {
    const { user, room } = await createOwnerWithRoom();
    const nick = freshNick();

    const updated = await setRoomNick(user.id, nick.toUpperCase());
    expect(updated.nick).toBe(nick);

    // Гость находит комнату и по нику, и по старому коду (редирект — страница).
    const byNick = await getGuestRoom(nick);
    expect(byNick?.roomId).toBe(room.id);
    expect(byNick?.nick).toBe(nick);
    const bySlug = await getGuestRoom(room.shareSlug);
    expect(bySlug?.roomId).toBe(room.id);
    expect(bySlug?.nick).toBe(nick);
    expect(bySlug?.shareSlug).toBe(room.shareSlug);
  });

  it("смена освобождает старый ник — его может занять другая комната", async () => {
    const a = await createOwnerWithRoom();
    const b = await createOwnerWithRoom();
    const first = freshNick("first");
    const second = freshNick("second");

    await setRoomNick(a.user.id, first);
    await setRoomNick(a.user.id, second);
    expect((await roomOf(a.user.id)).nick).toBe(second);

    // Старый ник свободен — соседка занимает без конфликта.
    await setRoomNick(b.user.id, first);
    expect((await roomOf(b.user.id)).nick).toBe(first);
  });

  it("освобождение (null): ник снят, адрес по нему больше не резолвится", async () => {
    const { user, room } = await createOwnerWithRoom();
    const nick = freshNick("free");

    await setRoomNick(user.id, nick);
    await setRoomNick(user.id, null);
    expect((await roomOf(user.id)).nick).toBeNull();
    expect(await getGuestRoom(nick)).toBeNull();
    // Короткий код работает как раньше.
    expect((await getGuestRoom(room.shareSlug))?.roomId).toBe(room.id);
  });

  it("уникальность: занятый ник → NICK_TAKEN (P2002), у владельца ничего не меняется", async () => {
    const a = await createOwnerWithRoom();
    const b = await createOwnerWithRoom();
    const nick = freshNick("uniq");

    await setRoomNick(a.user.id, nick);
    await expect(setRoomNick(b.user.id, nick)).rejects.toMatchObject({
      name: "RoomSettingsError",
      code: "NICK_TAKEN",
    });
    expect((await roomOf(a.user.id)).nick).toBe(nick);
    expect((await roomOf(b.user.id)).nick).toBeNull();
  });

  it("резерв слов: системные маршруты не выдаются", async () => {
    const { user } = await createOwnerWithRoom();
    for (const reserved of ["settings", "api", "room", "signin", "demo", "onboarding"]) {
      expect(isReservedNick(reserved)).toBe(true);
      await expect(setRoomNick(user.id, reserved)).rejects.toMatchObject({
        code: "NICK_RESERVED",
      });
    }
    expect((await roomOf(user.id)).nick).toBeNull();
  });

  it("формат: короче 3, длиннее 30, дефис, кириллица, пробел → ZodError", async () => {
    const { user } = await createOwnerWithRoom();
    for (const bad of ["ab", "a".repeat(31), "with-dash", "павел", "has space", ""]) {
      await expect(setRoomNick(user.id, bad)).rejects.toThrow();
    }
    expect((await roomOf(user.id)).nick).toBeNull();
  });

  it("ник, совпадающий с ЧЬИМ-ТО shareSlug, не выдаётся (перехват чужих гостей)", async () => {
    // Слаг нарочно валидного никового формата — как настоящий [a-z0-9]{6}.
    const victim = await createOwnerWithRoom("cream", "F", `v${randomUUID().replace(/-/g, "").slice(0, 9)}`);
    const attacker = await createOwnerWithRoom();

    await expect(setRoomNick(attacker.user.id, victim.room.shareSlug)).rejects.toMatchObject({
      code: "NICK_TAKEN",
    });
    // Адрес жертвы по-прежнему ведёт к жертве.
    expect((await getGuestRoom(victim.room.shareSlug))?.roomId).toBe(victim.room.id);
  });

  it("без комнаты → NO_ROOM", async () => {
    const roomless = await prisma.user.create({
      data: { email: `roomless-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    await expect(setRoomNick(roomless.id, freshNick())).rejects.toMatchObject({
      code: "NO_ROOM",
    });
  });
});

// ---------- Смена пресета ----------

describe("changeRoomPreset — вещи не теряются (решение гриллинга №5)", () => {
  it("несовпавшие зоны переезжают в anything (включая hidden), общие не трогаются", async () => {
    const { user, room } = await createOwnerWithRoom("cream", "F");
    // Наборы зон раунда 2 (по 12 рендерящихся на комнату):
    // cream: fashion,beauty,jewelry,perfume,bags,travel,anything,events,books,music,flowers,home;
    // loft:  fashion,music,anything,sneakers,tech,books,sport,events,gaming,watches,grooming,travel.
    // Не совпадают только beauty,jewelry,perfume,bags,flowers,home — travel
    // теперь есть у обоих, поэтому переезжают две вещи, а не три.
    const mk = (zone: string, extra: object = {}) =>
      prisma.item.create({
        data: {
          roomId: room.id,
          zone,
          state: "WANT",
          title: `Вещь ${zone}`,
          price: "1000",
          currency: "RUB",
          ...extra,
        },
      });
    const fashion = await mk("fashion");
    const beautyHidden = await mk("beauty", { hidden: true });
    const jewelry = await mk("jewelry");
    const travel = await mk("travel");
    const anything = await mk("anything");

    const before = await prisma.item.count({ where: { roomId: room.id } });
    const { room: updated, movedToAnything } = await changeRoomPreset(user.id, "loft");

    expect(updated.preset).toBe("loft");
    expect(movedToAnything).toBe(2); // beauty, jewelry

    // Ни одна вещь не потерялась и не исчезла из выдачи (включая hidden).
    const after = await prisma.item.findMany({ where: { roomId: room.id } });
    expect(after).toHaveLength(before);

    const zonesById = new Map(after.map((item) => [item.id, item.zone]));
    expect(zonesById.get(fashion.id)).toBe("fashion"); // общий ключ — не тронут
    expect(zonesById.get(anything.id)).toBe("anything");
    expect(zonesById.get(beautyHidden.id)).toBe("anything");
    expect(zonesById.get(jewelry.id)).toBe("anything");
    expect(zonesById.get(travel.id)).toBe("travel"); // тоже общий с раунда 2

    // hidden пережил переезд, состояние вещи не изменилось.
    const hidden = after.find((item) => item.id === beautyHidden.id);
    expect(hidden?.hidden).toBe(true);
    expect(hidden?.state).toBe("WANT");

    // Все вещи — в зонах нового пресета (из выдачи ничего не выпало).
    const loftZones = new Set(
      roomPresets.find((preset) => preset.id === "loft")!.zones.map((zone) => zone.key),
    );
    for (const item of after) {
      expect(loftZones.has(item.zone)).toBe(true);
    }
  });

  it("идемпотентно: тот же пресет — no-op, moved 0", async () => {
    const { user } = await createOwnerWithRoom("warm");
    const { room: updated, movedToAnything } = await changeRoomPreset(user.id, "warm");
    expect(updated.preset).toBe("warm");
    expect(movedToAnything).toBe(0);
  });

  it("незнакомый пресет → ZodError, ничего не записано", async () => {
    const { user, room } = await createOwnerWithRoom("cream");
    await prisma.item.create({
      data: { roomId: room.id, zone: "beauty", state: "LOVE", title: "Крем" },
    });

    await expect(changeRoomPreset(user.id, "kitchen")).rejects.toThrow();

    const fresh = await roomOf(user.id);
    expect(fresh.preset).toBe("cream");
    const item = await prisma.item.findFirstOrThrow({ where: { roomId: room.id } });
    expect(item.zone).toBe("beauty");
  });
});

// ---------- Набор зон и вкл/выкл зоны ----------

describe("setZoneSet / setZoneOff", () => {
  it("набор зон меняется на F/M/ALL; мусор → ZodError", async () => {
    const { user } = await createOwnerWithRoom("cream", "F");
    expect((await setZoneSet(user.id, "M")).zoneSet).toBe("M");
    expect((await setZoneSet(user.id, "ALL")).zoneSet).toBe("ALL");
    await expect(setZoneSet(user.id, "X")).rejects.toThrow();
  });

  it("выключение/включение зоны текущего пресета; повтор без дублей", async () => {
    const { user } = await createOwnerWithRoom("cream");
    expect((await setZoneOff(user.id, "beauty", true)).zonesOff).toEqual(["beauty"]);
    expect((await setZoneOff(user.id, "beauty", true)).zonesOff).toEqual(["beauty"]);
    const withTwo = await setZoneOff(user.id, "bags", true);
    expect(new Set(withTwo.zonesOff)).toEqual(new Set(["beauty", "bags"]));
    expect((await setZoneOff(user.id, "beauty", false)).zonesOff).toEqual(["bags"]);
  });

  it("зона не из текущего пресета → ZONE_UNKNOWN", async () => {
    // Раунд 2 достроил женский набор: music в cream теперь есть. Чужая зона —
    // из мужского набора (gaming), он в женские комнаты не входит по контракту.
    const { user } = await createOwnerWithRoom("cream");
    await expect(setZoneOff(user.id, "gaming", true)).rejects.toMatchObject({
      code: "ZONE_UNKNOWN",
    });
  });

  it("ключи чужого пресета, осевшие в zonesOff после переезда, не стираются", async () => {
    const { user } = await createOwnerWithRoom("loft");
    await setZoneOff(user.id, "music", true); // валидно для loft
    await changeRoomPreset(user.id, "cream"); // music в cream не существует
    const updated = await setZoneOff(user.id, "beauty", true);
    // Выбор по music сохранён: вернётся loft — вернётся и выключенная зона.
    expect(new Set(updated.zonesOff)).toEqual(new Set(["music", "beauty"]));
  });
});

// ---------- Дата праздника ----------

describe("setOccasionDate — полночь UTC, честно", () => {
  it("YYYY-MM-DD пишется полночью UTC; null очищает", async () => {
    const { user } = await createOwnerWithRoom();
    const updated = await setOccasionDate(user.id, "2027-03-08");
    expect(updated.occasionDate?.getTime()).toBe(Date.UTC(2027, 2, 8));

    const cleared = await setOccasionDate(user.id, null);
    expect(cleared.occasionDate).toBeNull();
  });

  it("мусорный формат → ZodError", async () => {
    const { user } = await createOwnerWithRoom();
    for (const bad of ["08.03.2027", "2027-3-8", "завтра", "2027-13-40"]) {
      await expect(setOccasionDate(user.id, bad)).rejects.toThrow();
    }
  });
});

// ---------- Профиль: имя и аватар ----------

describe("профиль: displayName и аватар", () => {
  it("имя сохраняется; пустая строка — очистка", async () => {
    const { user } = await createOwnerWithRoom();
    expect((await updateDisplayName(user.id, "  Павел  ")).displayName).toBe("Павел");
    expect((await updateDisplayName(user.id, "   ")).displayName).toBeNull();
  });

  it("newAvatarKey: avatars/{userId}/{16hex}.{ext}; SVG и мусор — нет", async () => {
    const { user } = await createOwnerWithRoom();
    const key = newAvatarKey(user.id, "image/png");
    expect(key).toMatch(new RegExp(`^avatars/${user.id}/[0-9a-f]{16}\\.png$`));
    expect(newAvatarKey(user.id, "image/svg+xml")).toBeNull(); // XSS через /media
    expect(newAvatarKey(user.id, "application/pdf")).toBeNull();
    expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024); // лимит — контракт тикета
  });

  it("свой ключ сохраняется и отдаётся профилем и гостю; null убирает", async () => {
    const { user, room } = await createOwnerWithRoom();
    const key = newAvatarKey(user.id, "image/webp")!;

    await setOwnerAvatar(user.id, key);
    const profile = await getOwnerProfile(user.id);
    expect(profile?.avatarUrl).toBe(`/media/${key}`);

    // Аватар виден в шапке комнаты гостя (тикет 13).
    const view = await getGuestRoom(room.shareSlug);
    expect(view?.ownerAvatarUrl).toBe(`/media/${key}`);

    await setOwnerAvatar(user.id, null);
    expect((await getOwnerProfile(user.id))?.avatarUrl).toBeNull();
  });

  it("чужой/кривой ключ → FOREIGN_AVATAR_KEY (свой префикс обязателен)", async () => {
    const a = await createOwnerWithRoom();
    const b = await createOwnerWithRoom();
    const foreign = newAvatarKey(b.user.id, "image/png")!;

    for (const bad of [
      foreign, // ключ другого пользователя
      `items/${a.room.id}/aaaaaaaaaaaaaaaa.jpg`, // схема вещей сюда не подходит
      "https://evil.example/x.png", // URL не проходят (не хотлинкуем)
      `avatars/${a.user.id}/short.png`, // не 16 hex
      `avatars/${a.user.id}/aaaaaaaaaaaaaaaa.svg`, // svg не бывает ключом
    ]) {
      await expect(setOwnerAvatar(a.user.id, bad)).rejects.toMatchObject({
        code: "FOREIGN_AVATAR_KEY",
      });
    }
    expect((await getOwnerProfile(a.user.id))?.avatarUrl).toBeNull();
  });
});
