// Сервис «Комната» (Room): создание при онбординге, чтение для хозяйки и
// гостя, настройки хозяйки (тикет 13: профиль, ник, смена пресета, зоны,
// день рождения, демо-призраки).
// Бизнес-логика живёт здесь, роуты/экшены остаются тонкими (CLAUDE.md).
import { randomBytes } from "node:crypto";
import { revalidateTag } from "next/cache";
import { Prisma, type Room, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { birthdayColumns, parseBirthday } from "@/server/birthday";
import { recordRoomEvent } from "@/server/services/room-events";
import { rooms as roomPresets } from "@/config/design";
import { roomCacheTag } from "@/server/services/items";
import { itemPhotoUrl } from "@/server/dto/items";
import { LIGHT_COLORS, TIMES_OF_DAY } from "@/components/scene/grading";

// ---------- Валидация входов (Zod) ----------

const presetIds = roomPresets.map((room) => room.id);

/**
 * ПОЛ ВЫБИРАЕТ КОМНАТЫ, И ЗНАЧЕНИЙ У НЕГО ДВА (тикет 241, решение владельца
 * 14.08.2026). Третье — «Все десять» — отменено: «пусть женские комнаты едут в
 * женские, а мужские в мужские, никакого смешения комнат не должно быть».
 *
 * ПРИЧИНА ЧИСЛОМ, А НЕ ВКУСОМ. Объединение наборов 20 ключей, общих у женского
 * и мужского СЕМЬ. Переезд из женской комнаты в мужскую уносит шесть полок
 * (`jewelry`, `perfume`, `bags`, `beauty`, `flowers`, `home`) в «Что угодно»,
 * обратно — семь. Внутри пола переезд без потерь работает и закрыт сторожем
 * `design-contract` на 42 парах; «Все десять» открывало оставшиеся 48, в
 * которых переезд без потерь невозможен в принципе.
 *
 * Смена пола при этом НЕ запрещена — она остаётся последствием: меняешь пол,
 * меняется набор комнат, и вещи несовпавших полок уедут в «Что угодно», когда
 * будет выбран интерьер. Сколько именно — считает `itemsLeavingSet` ниже, ДО
 * согласия человека.
 *
 * Имя поля осталось `zoneSet` — оно в базе и в контракте дизайна; переименовать
 * его значит миграцию ради слова. Что оно выбирает КОМНАТЫ, а не полки,
 * подтвердил сам дизайн пакетом 52+.
 */
export const zoneSetSchema = z.enum(["F", "M"]);
export type ZoneSet = z.infer<typeof zoneSetSchema>;

/**
 * Набор комнаты, когда в базе лежит что-то другое (тикет 241, пункт 5).
 *
 * До 14.08.2026 значением могло быть `ALL`, и такие комнаты у людей есть.
 * Выбрать за человека пол молча нельзя, поэтому набор берётся по полу его
 * ТЕКУЩЕГО интерьера: комната уже стоит женская или мужская, и это ответ,
 * данный им самим. Записи в базу тут не происходит — она случится при первом
 * же сознательном выборе.
 */
export function zoneSetOf(room: { zoneSet: string; preset: string }): ZoneSet {
  const parsed = zoneSetSchema.safeParse(room.zoneSet);
  if (parsed.success) return parsed.data;
  return roomPresets.find((preset) => preset.id === room.preset)?.sex ?? "F";
}

/**
 * Ключи полок набора. Все комнаты одного пола несут одинаковый состав — это
 * ровно то, чего владелец добивался замечанием 7 приёмки 14.08, — поэтому
 * берётся первая комната пола, а совпадение остальных держит сторож
 * `design-contract` («переезд без потерь»).
 */
export function zoneKeysForSet(set: ZoneSet): string[] {
  const room = roomPresets.find((preset) => preset.sex === set);
  return (room?.zones ?? []).map((zone) => zone.key);
}

/** Пресет — только один из 10 интерьеров rooms.json. */
export const presetSchema = z.enum(presetIds as [string, ...string[]]);

export const createRoomInputSchema = z.object({
  preset: presetSchema,
  zoneSet: zoneSetSchema,
});
export type CreateRoomInput = z.infer<typeof createRoomInputSchema>;

/** Ответ «что хочется» — не больше четырёх ключей (доска 34b). */
export const WANTS_MAX = 4;

/**
 * Ключи зон ЭТОГО пресета, не больше четырёх. Мусор и чужие ключи молча
 * отбрасываются: ответ необязательный, и ронять на нём создание комнаты (или
 * запись ответа) было бы дико. Вход — строка через запятую или готовый список:
 * из формы приезжает первое, из экшена чипов — второе.
 */
function cleanWants(preset: string, raw: string | readonly string[]): string[] {
  const presetZones = new Set(
    (roomPresets.find((candidate) => candidate.id === preset)?.zones ?? []).map((zone) => zone.key),
  );
  const keys = typeof raw === "string" ? raw.split(",") : raw;
  return keys
    .map((key) => String(key).trim())
    .filter((key) => presetZones.has(key))
    .slice(0, WANTS_MAX);
}

// ---------- Короткий адрес комнаты ----------

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 6;
// 252 = 7 × 36: байты выше порога отбрасываем, чтобы все 36 символов
// алфавита выпадали равновероятно (rejection sampling).
const SLUG_BYTE_LIMIT = 252;

/**
 * Короткий код комнаты вида `x7k2m9` (решение гриллинга №3): 6 символов
 * [a-z0-9] через node:crypto — без внешних зависимостей.
 */
export function generateShareSlug(length: number = SLUG_LENGTH): string {
  let slug = "";
  while (slug.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= SLUG_BYTE_LIMIT) continue;
      slug += SLUG_ALPHABET.charAt(byte % SLUG_ALPHABET.length);
      if (slug.length === length) break;
    }
  }
  return slug;
}

// ---------- Создание и чтение ----------

const SLUG_CREATE_ATTEMPTS = 5;

/**
 * Создаёт комнату пользователю. Идемпотентно: комната одна на пользователя
 * (Room.userId @unique) — повторный вызов возвращает существующую комнату,
 * не меняя её. Гонка параллельных запросов гасится обработкой P2002.
 */
export async function createRoomForUser(
  userId: string,
  input: { preset: string; zoneSet: string; wants?: string },
): Promise<Room> {
  const { preset, zoneSet } = createRoomInputSchema.parse(input);
  // «Что хочется» (тикет 113, доска 34b). Онбординг этого ответа больше не
  // приносит — вопрос переехал в первое открытие «начни с готового» (письмо
  // 33), и обычный вызов идёт без него. Разбор входа оставлен: комната
  // создаётся и через посев стенда, и через тесты, где ответ известен заранее.
  const wants = cleanWants(preset, input.wants ?? "");

  const existing = await prisma.room.findUnique({ where: { userId } });
  if (existing) return existing;

  for (let attempt = 0; attempt < SLUG_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.room.create({
        data: { userId, preset, zoneSet, wants, shareSlug: generateShareSlug() },
      });
    } catch (error) {
      if (isUniqueViolation(error, "userId")) {
        // Параллельный запрос успел первым — возвращаем его комнату.
        return prisma.room.findUniqueOrThrow({ where: { userId } });
      }
      if (isUniqueViolation(error, "shareSlug")) {
        continue; // коллизия короткого кода — пробуем новый
      }
      throw error;
    }
  }
  throw new Error("rooms.createRoomForUser: не удалось подобрать свободный shareSlug");
}

/** Комната хозяйки (или null — тогда путь лежит в /onboarding). */
export async function getRoomForUser(userId: string): Promise<Room | null> {
  return prisma.room.findUnique({ where: { userId } });
}

/**
 * Комната для публичного маршрута /r/{slug}. Из владельца отдаём только
 * имя — email и прочие поля гостю не текут.
 */
export async function getRoomByShareSlug(shareSlug: string) {
  return prisma.room.findUnique({
    where: { shareSlug },
    include: { user: { select: { displayName: true, name: true } } },
  });
}

/**
 * Auth.js с database-сессией по умолчанию кладёт в session.user только
 * name/email/image — без id (каркас Phase 0 не настраивал session callback).
 * Резолвим владельца по email; если id однажды появится — используем его.
 */
export async function getSessionUserId(
  sessionUser: { id?: string | null; email?: string | null } | undefined,
): Promise<string | null> {
  if (!sessionUser) return null;
  if (sessionUser.id) return sessionUser.id;
  if (!sessionUser.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: sessionUser.email },
    select: { id: true },
  });
  return user?.id ?? null;
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  return typeof target === "string" && target.includes(field);
}

// ====================================================================
// Настройки хозяйки (тикет 13). Паттерн всех мутаций: комната ищется по
// userId СЕССИИ (ownership по построению — подменить некуда), вход — Zod,
// после записи — revalidateTag(roomCacheTag(roomId), "max").
// ====================================================================

/** Доменные отказы настроек — поверх ZodError самих схем. */
export class RoomSettingsError extends Error {
  constructor(
    readonly code:
      "NO_ROOM" | "NICK_TAKEN" | "NICK_RESERVED" | "ZONE_UNKNOWN" | "FOREIGN_AVATAR_KEY",
    message: string,
  ) {
    super(message);
    this.name = "RoomSettingsError";
  }
}

/** revalidateTag живёт только в request-scope Next; вне его (vitest) кэша
 * нет — и инвалидировать нечего (тот же приём, что в services/items). */
function revalidateRoom(roomId: string): void {
  try {
    revalidateTag(roomCacheTag(roomId), "max");
  } catch {
    // вне Next-запроса — сознательно молчим
  }
}

async function requireRoom(userId: string): Promise<Room> {
  const room = await prisma.room.findUnique({ where: { userId: z.string().min(1).parse(userId) } });
  if (!room) {
    throw new RoomSettingsError("NO_ROOM", "у пользователя нет комнаты — сначала онбординг");
  }
  return room;
}

// ---------- Ник: красивый адрес комнаты /r/{nick} (гриллинг №3) ----------

/** Формат ника — контракт спеки: [a-z0-9_]{3,30}. Регистр прощаем (toLowerCase). */
export const nickSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,30}$/, "ник: латиница в нижнем регистре, цифры и _, от 3 до 30");

/**
 * Резерв слов: наши маршруты и «системные» имена не могут стать ником — и
 * сегодняшние (/r/settings выглядел бы как чужая страница), и кандидаты на
 * корневые адреса будущих фаз. Дефис в нике невозможен по формату, но
 * словарь держит и дефисные написания — на случай смягчения формата.
 *
 * Имя площадки тоже в резерве: `wishlist` (техимя) и `grace` (продуктовое,
 * тикет 58) — чтобы /r/grace не оказался чьей-то личной комнатой.
 */
const RESERVED_NICKS = new Set([
  "r",
  "api",
  "room",
  "rooms",
  "settings",
  "signin",
  "signout",
  "signup",
  "login",
  "logout",
  "register",
  "onboarding",
  "my-bookings",
  "mybookings",
  "my_bookings",
  "media",
  "demo",
  "admin",
  "auth",
  "hall",
  "occasion",
  "occasions",
  "connections",
  "export",
  "account",
  "profile",
  "user",
  "users",
  "me",
  "my",
  "help",
  "about",
  "support",
  "terms",
  "privacy",
  "legal",
  "static",
  "assets",
  "public",
  "img",
  "images",
  "files",
  "mail",
  "email",
  "new",
  "edit",
  "delete",
  "search",
  "sitemap",
  "robots",
  "favicon",
  "manifest",
  "worker",
  "test",
  "www",
  "app",
  "blog",
  "docs",
  "status",
  "gdpr",
  "next",
  "_next",
  "wishlist",
  "grace",
]);

/** true — слово занято системой (для подсказки в UI до сабмита). */
export function isReservedNick(nick: string): boolean {
  return RESERVED_NICKS.has(nick);
}

/**
 * Занять / сменить / освободить (null) ник — красивый адрес комнаты.
 *
 * Правила:
 * - формат [a-z0-9_]{3,30} (ZodError), резерв слов → NICK_RESERVED;
 * - уникальность держит СХЕМА (Room.nick @unique): гонка двух хозяек
 *   решается P2002 → NICK_TAKEN, не проверкой заранее;
 * - ник, совпадающий с ЧЬИМ-ТО shareSlug, не выдаётся (NICK_TAKEN):
 *   иначе можно занять чужой опубликованный короткий код и перехватывать
 *   его гостей (резолв /r/{slug} смотрит и ники, и коды);
 * - смена освобождает старый ник сама (это одно поле), освобождение — null;
 *   старый короткий код продолжает работать всегда (редирект — маршрут /r).
 */
export async function setRoomNick(userId: string, rawNick: string | null): Promise<Room> {
  const room = await requireRoom(userId);

  if (rawNick === null) {
    const updated = await prisma.room.update({ where: { id: room.id }, data: { nick: null } });
    revalidateRoom(room.id);
    return updated;
  }

  const nick = nickSchema.parse(rawNick);
  if (RESERVED_NICKS.has(nick)) {
    throw new RoomSettingsError("NICK_RESERVED", `ник «${nick}» зарезервирован системой`);
  }
  // Ник не должен затенять существующий короткий код (в т.ч. свой же).
  const slugClash = await prisma.room.findUnique({
    where: { shareSlug: nick },
    select: { id: true },
  });
  if (slugClash) {
    throw new RoomSettingsError("NICK_TAKEN", `ник «${nick}» занят`);
  }

  try {
    const updated = await prisma.room.update({ where: { id: room.id }, data: { nick } });
    revalidateRoom(room.id);
    return updated;
  } catch (error) {
    if (isUniqueViolation(error, "nick")) {
      throw new RoomSettingsError("NICK_TAKEN", `ник «${nick}» занят`);
    }
    throw error;
  }
}

// ---------- Смена пресета интерьера (гриллинг №5) ----------

/**
 * Сменить пресет комнаты. Вещи НЕ трогаются вообще — ключи зон общие для
 * всех комнат; вещи зон, которых НЕТ в новой комнате, bulk-переезжают в
 * зону `anything` (есть в каждом из 10 пресетов — проверяется на входе).
 * Обе записи — ОДНА транзакция: полусостояния «пресет новый, вещи в
 * несуществующих зонах» не бывает. Идемпотентно: тот же пресет — no-op.
 * Ничего не удаляется и не прячется: сумма вещей до = после (тест).
 */
export async function changeRoomPreset(
  userId: string,
  presetId: string,
): Promise<{ room: Room; movedToAnything: number }> {
  const preset = presetSchema.parse(presetId);
  const room = await requireRoom(userId);
  if (room.preset === preset) return { room, movedToAnything: 0 };

  const target = roomPresets.find((candidate) => candidate.id === preset);
  const zoneKeys = (target?.zones ?? []).map((zone) => zone.key);
  if (!zoneKeys.includes("anything")) {
    // Контракт rooms.json: зона anything есть в каждом пресете. Если пакет
    // однажды изменится — падаем громко, а не теряем вещи молча.
    throw new Error(`rooms.changeRoomPreset: в пресете «${preset}» нет зоны anything`);
  }

  const [moved, updated] = await prisma.$transaction([
    prisma.item.updateMany({
      where: { roomId: room.id, zone: { notIn: zoneKeys } },
      data: { zone: "anything" },
    }),
    prisma.room.update({ where: { id: room.id }, data: { preset } }),
  ]);

  revalidateRoom(room.id);
  // «Комната Милы — теперь „Изумруд"» (тикет 114): момент смены интерьера
  // не хранит больше никто, а лента про него рассказывает.
  if (room.preset !== preset) await recordRoomEvent(room.id, "ROOM_CHANGED", { preset });
  return { room: updated, movedToAnything: moved.count };
}

// ---------- Набор зон и вкл/выкл отдельных зон ----------

/** Сменить пол (F/M) — он выбирает комнаты, а не полки (тикет 241). */
export async function setZoneSet(userId: string, zoneSet: string): Promise<Room> {
  const parsed = zoneSetSchema.parse(zoneSet);
  const room = await requireRoom(userId);
  const updated = await prisma.room.update({ where: { id: room.id }, data: { zoneSet: parsed } });
  revalidateRoom(room.id);
  return updated;
}

/**
 * СКОЛЬКО ВЕЩЕЙ СМЕНЯТ ПОЛКУ, ЕСЛИ СМЕНИТЬ ПОЛ (тикет 241, пункт 4).
 *
 * Считается ДО согласия человека и БЕЗ записи. Сама смена пола вещи не двигает
 * — двигает их выбор интерьера, который случится следом (`changeRoomPreset`
 * переводит в «Что угодно» всё, чей ключ не встретился в новом пресете).
 * Поэтому и считать надо не по комнате, а по НАБОРУ: все комнаты одного пола
 * несут одинаковый состав, значит ответ один для любого интерьера этого пола.
 *
 * Число обязано совпасть с `movedToAnything` после переезда — это под тестом.
 * Расхождение значило бы, что наборы комнат одного пола разошлись, а такого
 * быть не должно (сторож `design-contract`, «переезд без потерь»).
 */
export async function itemsLeavingSet(userId: string, zoneSet: string): Promise<number> {
  const parsed = zoneSetSchema.parse(zoneSet);
  const room = await requireRoom(userId);
  const keys = zoneKeysForSet(parsed);
  return prisma.item.count({ where: { roomId: room.id, zone: { notIn: keys } } });
}

/**
 * Выключить/включить зону текущего пресета. Выключенная зона исчезает из
 * сцены вместе с мебелью (инвариант №5), её вещи скрыты от гостя фильтром
 * на чтении (guest-room), но НЕ трогаются.
 *
 * РЕШЕНИЕ (спека молчит): активные брони вещей выключенной зоны НЕ
 * снимаются. Выключение обратимо — зона может вернуться вместе с вещами,
 * и рвать бронь гостя молча из-за перестановки мебели нечестно. Гость со
 * своей бронью ничего не теряет; новые брони по зоне невозможны (bookItem
 * отказывает по zonesOff). Скрытие ВЕЩИ (hidden) — другое: там бронь
 * снимается (items.setItemHidden). Закреплено тестом.
 */
export async function setZoneOff(userId: string, zoneKey: string, off: boolean): Promise<Room> {
  const key = z.string().min(1).max(64).parse(zoneKey);
  const isOff = z.boolean().parse(off);
  const room = await requireRoom(userId);

  const presetZones = roomPresets.find((candidate) => candidate.id === room.preset)?.zones ?? [];
  if (!presetZones.some((zone) => zone.key === key)) {
    throw new RoomSettingsError("ZONE_UNKNOWN", `зоны «${key}» нет в текущем пресете`);
  }

  // Ключи чужих пресетов, осевшие в zonesOff раньше, не трогаем: вернётся
  // старый пресет — вернётся и выбор хозяйки по его зонам.
  const next = new Set(room.zonesOff);
  if (isOff) next.add(key);
  else next.delete(key);

  const updated = await prisma.room.update({
    where: { id: room.id },
    data: { zonesOff: [...next] },
  });
  revalidateRoom(room.id);
  return updated;
}

// ---------- День рождения и демо-призраки ----------

/**
 * Задать/очистить (null) день рождения хозяйки — ЕДИНСТВЕННОЕ место записи
 * (и из онбординга, и из настроек). Вход — то, что назвал человек: `YYYY-MM-DD`
 * из прежнего поля даты и предзаполнения гостя или `{day, month, year?}` из
 * двух списков экрана.
 *
 * Дата тут больше не «момент праздника», а повторяющийся день (тикет 187):
 * храним день и месяц, год необязателен, ближайший праздник считается на
 * чтении (`birthday.nextOccasion`). Полночь UTC никуда не делась — она просто
 * переехала из колонки в вычисление, и всё, что считало по ней (напоминания,
 * «что подарили», отсчёт в гостевой комнате), считает по ней же.
 *
 * Мусор — отказ ZodError, как и раньше: 31 февраля и «завтра» днём рождения
 * не бывают.
 */
export async function setBirthday(userId: string, raw: unknown): Promise<Room> {
  const room = await requireRoom(userId);
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: birthdayColumns(birthdaySchema.parse(raw)),
  });
  revalidateRoom(room.id);
  return updated;
}

/** null — «убрать»; всё остальное разбирает домен, мусор — ZodError. */
const birthdaySchema = z.unknown().transform((raw, ctx) => {
  if (raw === null || raw === undefined) return null;
  const birthday = parseBirthday(raw);
  if (birthday === null) {
    ctx.addIssue({ code: "custom", message: "такого дня рождения не бывает" });
    return z.NEVER;
  }
  return birthday;
});

/**
 * Ответ «что чаще всего хочется» (тикет 113, доска 34b). Пишется теперь не из
 * онбординга, а из первого открытия «начни с готового» (письмо 33, турн 40b) —
 * место вопроса сменилось, смысл нет.
 *
 * КОМНАТУ ЭТО НЕ МЕНЯЕТ: ни `zonesOff`, ни `preset`, ни порядок полок. Ответ
 * красит подборку набора (`orderedByWants`) и порядок зон в форме добавления —
 * первые минуты после онбординга, а не саму комнату. Чужие ключи и мусор молча
 * отбрасываются, больше четырёх не берём; пустой список — законный ответ
 * («просто листать дальше»), он же и стирает прежний.
 */
export async function setRoomWants(userId: string, keys: readonly string[]): Promise<Room> {
  const room = await requireRoom(userId);
  const wants = cleanWants(room.preset, z.array(z.string()).max(64).parse(keys));
  const updated = await prisma.room.update({ where: { id: room.id }, data: { wants } });
  revalidateRoom(room.id);
  return updated;
}

/**
 * «Убрать примеры» скопом (гриллинг №4): demoGhostsOff=true — демо-призраки
 * не подмешиваются ни хозяйке, ни гостю (guest-room читает флаг в
 * некэшируемой части — как zonesOff). Обратимо.
 */
export async function setDemoGhostsOff(userId: string, off: boolean): Promise<Room> {
  const parsed = z.boolean().parse(off);
  const room = await requireRoom(userId);
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: { demoGhostsOff: parsed },
  });
  revalidateRoom(room.id);
  return updated;
}

// ---------- Сокровищница: кто входит (тикет 116) и стоимость (тикет 35) ----------

/**
 * Вход раздела «Сокровищница» в настройках. Поля необязательные: раздел
 * сохраняется целиком, но частичная правка возможна.
 *
 * ДВЕ НАСТРОЙКИ И ОНИ ПРО РАЗНОЕ (ADR-0011):
 * - `visibility` — кто вообще входит в ВИТРИНУ. Три положения: у экрана
 *   «только мне» и «никому» — одна и та же дверь. Дефолт открытый (`ALL`);
 * - `priceVisibility` — кто видит там ЦЕНУ. Четыре положения, не тумблер:
 *   «стоимость это чувствительно» (доска, турн 12d), дефолт `FRIENDS`.
 *
 * Открытая витрина с закрытой ценой — законное сочетание; закрытая витрина
 * настройку цены не сбрасывает (она понадобится, когда витрину откроют
 * обратно).
 */
export const hallSettingsSchema = z
  .object({
    visibility: z.enum(["ALL", "MUTUAL", "NONE"]).optional(),
    priceVisibility: z.enum(["ALL", "FRIENDS", "ME", "NONE"]).optional(),
    totalShown: z.boolean().optional(),
    giverShown: z.boolean().optional(),
    roundPrices: z.boolean().optional(),
  })
  .strict();

export type HallSettingsInput = z.infer<typeof hallSettingsSchema>;

/**
 * Сохранить настройки сокровищницы. Ревалидирует комнату тем же тегом, что и
 * остальные настройки, и это обязательно с ДВУХ сторон:
 * - от видимости цены зависит СОСТАВ guest-DTO подарков
 *   (services/guest-room → dto/guest-items);
 * - от `visibility` зависит, рисуется ли гостю вход «Сокровищница»
 *   (тикет 116): страница /r/{slug} кэшируется целиком, и без ревалидации
 *   закрытая витрина осталась бы со ссылкой ещё на всё окно ISR.
 */
export async function setHallSettings(userId: string, input: HallSettingsInput): Promise<Room> {
  const parsed = hallSettingsSchema.parse(input);
  const room = await requireRoom(userId);
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: {
      ...(parsed.visibility === undefined ? {} : { hallVisibility: parsed.visibility }),
      ...(parsed.priceVisibility === undefined
        ? {}
        : { hallPriceVisibility: parsed.priceVisibility }),
      ...(parsed.totalShown === undefined ? {} : { hallTotalShown: parsed.totalShown }),
      ...(parsed.giverShown === undefined ? {} : { hallGiverShown: parsed.giverShown }),
      ...(parsed.roundPrices === undefined ? {} : { hallRoundPrices: parsed.roundPrices }),
    },
  });
  revalidateRoom(room.id);

  // «Сокровищница Милы теперь открыта» (тикет 114). Событие ставится только
  // на ОТКРЫТИЕ и только на настоящее изменение: закрытие — не новость, а
  // повторное сохранение того же положения — не событие вовсе.
  //
  // СЧИТАЕТСЯ ПО ДВЕРИ, А НЕ ПО ЦЕНЕ (исправлено вместе с тикетом 116).
  // Пока настройки «кто входит в витрину» не существовало, поводом взяли
  // единственное, что было под рукой, — смену видимости ЦЕНЫ. Это было
  // неверно дважды: цена подарков и открытая витрина — разные события, а
  // положение FRIENDS у цены читается у нас ЗАКРЫТО (`guestSeesHallPrice`),
  // то есть строка «теперь открыта» появлялась там, где гостю не открылось
  // ничего. Теперь повод один и настоящий: дверь была заперта и отперлась.
  const opened =
    parsed.visibility !== undefined &&
    room.hallVisibility === "NONE" &&
    parsed.visibility !== "NONE";
  if (opened) await recordRoomEvent(room.id, "TREASURY_OPENED");
  return updated;
}

// ---------- Свет и время суток (тикет 96, доска Б6) ----------

/**
 * Две последние ручки персонализации. Значения — только из словаря сцены:
 * строка из браузера в комнату не попадает, а мусорное положение читается
 * как родное (`asTimeOfDay`/`asLightColor`), поэтому старая запись экран не
 * ломает.
 *
 * Ревалидирует комнату тем же тегом: свет виден ГОСТЮ (он смотрит выбор
 * хозяйки), а гостевая страница кэшируется.
 */
export const lightSettingsSchema = z
  .object({
    timeOfDay: z.enum(TIMES_OF_DAY).optional(),
    lightColor: z.enum(LIGHT_COLORS).optional(),
  })
  .strict();

export type LightSettingsInput = z.infer<typeof lightSettingsSchema>;

export async function setLightSettings(userId: string, input: LightSettingsInput): Promise<Room> {
  const parsed = lightSettingsSchema.parse(input);
  const room = await requireRoom(userId);
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: {
      ...(parsed.timeOfDay === undefined ? {} : { timeOfDay: parsed.timeOfDay }),
      ...(parsed.lightColor === undefined ? {} : { lightColor: parsed.lightColor }),
    },
  });
  revalidateRoom(room.id);
  return updated;
}

// ---------- Профиль: имя и аватар ----------

export type OwnerProfile = {
  displayName: string | null;
  /** URL раздачи /media — или null, если аватар не загружен. */
  avatarUrl: string | null;
  email: string;
};

/** Профиль хозяйки для страницы настроек. Только своё: userId — из сессии. */
export async function getOwnerProfile(userId: string): Promise<OwnerProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: z.string().min(1).parse(userId) },
    select: { displayName: true, avatarKey: true, email: true },
  });
  if (!user) return null;
  return {
    displayName: user.displayName,
    avatarUrl: itemPhotoUrl(user.avatarKey),
    email: user.email,
  };
}

const displayNameSchema = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? null : value),
  z.string().trim().max(80).nullable(),
);

/** Имя хозяйки в комнате (User.displayName); пустая строка — очистка. */
export async function updateDisplayName(userId: string, displayName: string | null): Promise<User> {
  const parsed = displayNameSchema.parse(displayName);
  const room = await requireRoom(userId);
  const user = await prisma.user.update({ where: { id: userId }, data: { displayName: parsed } });
  revalidateRoom(room.id); // имя видно в шапке комнаты гостя
  return user;
}

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Разрешённые типы аватара — только растровые; image/svg+xml намеренно НЕТ
 * (SVG со скриптом, отданный с нашего origin через /media, — это XSS; та же
 * причина, что у фото вещей). Валидация СВОЯ: photoKey-схема items не
 * подходит (там ключи items/{roomId}/…, здесь avatars/{userId}/…).
 */
const AVATAR_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/**
 * Ключ аватара `avatars/{userId}/{16hex}.{ext}` — или null, если тип не из
 * разрешённых. Ключ случайный, старый объект не перезаписывается (чистка
 * осиротевших — вместе с фото вещей, TODO тикет 16).
 */
export function newAvatarKey(userId: string, contentType: string): string | null {
  const ext = AVATAR_EXT[contentType.trim().toLowerCase()];
  if (!ext) return null;
  return `avatars/${z.string().min(1).parse(userId)}/${randomBytes(8).toString("hex")}.${ext}`;
}

// Расширение пиноится к словарю AVATAR_EXT: ключ .svg не бывает нашим
// даже по форме (заслон в глубину — newAvatarKey его и не выдаёт).
const avatarKeyShape = /^avatars\/[A-Za-z0-9-]+\/[0-9a-f]{16}\.(jpg|png|webp|avif|gif|heic|heif)$/;

/**
 * Сохранить аватар (null — убрать). Ключ обязан быть НАШЕГО вида и лежать
 * в `avatars/{userId}/` САМОГО пользователя — чужой ключ/URL/пути пакета
 * не проходят (заслон от хотлинка и подмены, как FOREIGN_PHOTO_KEY у вещей).
 */
export async function setOwnerAvatar(userId: string, avatarKey: string | null): Promise<User> {
  const room = await requireRoom(userId);
  if (avatarKey !== null) {
    if (!avatarKeyShape.test(avatarKey) || !avatarKey.startsWith(`avatars/${userId}/`)) {
      throw new RoomSettingsError("FOREIGN_AVATAR_KEY", "ключ аватара не нашего вида или чужой");
    }
  }
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarKey } });
  revalidateRoom(room.id); // аватар виден в шапке комнаты гостя
  return user;
}
