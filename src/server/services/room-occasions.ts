// Праздники комнаты (тикет 198): общие даты, свои поводы и тот единственный,
// что виден в комнате.
//
// ШОВ. Календарь — в `src/server/holidays.ts` (без БД, без React), запись и
// чтение — здесь, экраны остаются тонкими. Разделение не косметическое:
// правило «8 марта и 23 февраля предлагаются оба и всем» проверяется на
// календаре, и проверять его на слое, который умеет читать комнату, было бы
// нечестно — читать он не должен ничего, кроме прежних ответов.
//
// ИНВАРИАНТ №2 НЕ ЗАДЕТ. Праздников стало больше, поводов раскрыть имя дарителя
// не прибавилось: имя пишет одна `receiveGift` (services/occasions.ts), и этот
// файл в неё не заходит и её не зовёт.
import { revalidateTag } from "next/cache";
import type { RoomOccasion as RoomOccasionRow } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { birthdayOf, isBirthday } from "@/server/birthday";
import {
  holidayByKey,
  holidayOffer,
  isHolidayKey,
  nearestOccasion,
  nextHoliday,
  OWN_TITLE_MAX,
  type DatedOccasion,
  type HolidayKey,
  type HolidayOffer,
  type RoomOccasion,
} from "@/server/holidays";
import { roomCacheTag } from "@/server/services/items";

const idSchema = z.string().min(1).max(64);

export type OccasionErrorCode = "NO_ROOM" | "UNKNOWN_HOLIDAY" | "VALIDATION" | "NOT_FOUND";

export class RoomOccasionError extends Error {
  constructor(
    readonly code: OccasionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoomOccasionError";
  }
}

/** revalidateTag живёт только в request-scope Next (паттерн services/items). */
function revalidateRoom(roomId: string): void {
  try {
    revalidateTag(roomCacheTag(roomId), "max");
  } catch {
    // вне Next-запроса — сознательно молчим
  }
}

/**
 * Комната глазами праздников: свой id и колонки дня рождения — больше отсюда
 * ничего не читается. Тип экспортирован, потому что комнаты приезжают сюда и
 * пачкой, из чужого сервиса (`nearestOccasionByRoom`, тикет 204).
 */
export type OccasionRoomColumns = {
  id: string;
  birthdayDay: number | null;
  birthdayMonth: number | null;
  birthdayYear: number | null;
};

async function requireRoom(userId: string): Promise<OccasionRoomColumns> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { id: true, birthdayDay: true, birthdayMonth: true, birthdayYear: true },
  });
  if (!room) {
    throw new RoomOccasionError("NO_ROOM", "у пользователя нет комнаты — сначала онбординг");
  }
  return room;
}

// ---------- Чтение ----------

/**
 * ВСЕ праздники комнаты одним списком: день рождения из колонок (тикет 187),
 * принятые общие даты и свои поводы из строк. Порядок устойчив — сперва день
 * рождения, дальше строки по времени появления: «ближайший» при равных датах
 * не должен прыгать между обновлениями страницы.
 *
 * Отказанные общие даты («Не в этом году») сюда не входят: отказ — это ответ
 * про ПЛАШКУ, а не праздник комнаты.
 */
export function occasionsOf(
  room: OccasionRoomColumns,
  rows: readonly RoomOccasionRow[],
): RoomOccasion[] {
  const occasions: RoomOccasion[] = [];
  const birthday = birthdayOf(room);
  if (birthday) {
    occasions.push({
      kind: "birthday",
      key: null,
      title: null,
      day: birthday.day,
      month: birthday.month,
    });
  }
  for (const row of rows) {
    if (!row.accepted) continue;
    const own = row.kind === "OWN";
    // Общая дата без известного ключа — мусор (ручная правка БД или снятый
    // праздник): называть её нечем, и комната ведёт себя так, будто строки
    // нет. То же недоверие, что у `birthdayOf` к битым колонкам.
    if (!own && !isHolidayKey(row.key)) continue;
    occasions.push({
      kind: own ? "own" : "common",
      key: isHolidayKey(row.key) ? row.key : null,
      title: row.title,
      day: row.day,
      month: row.month,
    });
  }
  return occasions;
}

/** Строки праздников комнаты в устойчивом порядке. */
async function occasionRows(roomId: string): Promise<RoomOccasionRow[]> {
  return prisma.roomOccasion.findMany({
    where: { roomId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * БЛИЖАЙШИЙ ПРАЗДНИК СРАЗУ ПО НЕСКОЛЬКИМ КОМНАТАМ — ОДНИМ ЗАПРОСОМ (тикет 204).
 *
 * Лента друзей задаёт тот же вопрос, что и комната, но не про одну комнату, а
 * про десяток разом. Спрашивать по строке значит завести `N+1` — тихо и
 * незаметно, ровно так же, как это было бы у «сколько свободно»
 * (`countFreeGiftsByRoom`, тот же приём и та же причина).
 *
 * КОМНАТА И ЛЕНТА ОТВЕЧАЮТ ОДНО И ТО ЖЕ ПО УСТРОЙСТВУ, А НЕ ПО ДОГОВОРЁННОСТИ:
 * `nearestRoomOccasion` — это ОНА ЖЕ на списке из одной комнаты. Двух правил
 * «какой праздник ближе» в продукте нет, поэтому и разъехаться нечему; до
 * тикета 204 их было два, и лента считала только день рождения.
 *
 * В карте лежат ТОЛЬКО комнаты, у которых праздник есть: пустое значение и
 * отсутствие ключа — одно и то же, и `null` в карте был бы третьим способом
 * сказать «праздников нет».
 */
export async function nearestOccasionByRoom(
  rooms: readonly OccasionRoomColumns[],
  now: Date = new Date(),
): Promise<Map<string, DatedOccasion>> {
  const nearest = new Map<string, DatedOccasion>();
  if (rooms.length === 0) return nearest;

  // Один запрос на весь список. Порядок тот же, что у `occasionRows`:
  // «ближайший» при равных датах не должен прыгать между обновлениями
  // страницы — ни в комнате, ни в ленте.
  const rows = await prisma.roomOccasion.findMany({
    where: { roomId: { in: rooms.map((room) => room.id) }, accepted: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const rowsByRoom = new Map<string, RoomOccasionRow[]>();
  for (const row of rows) {
    const bucket = rowsByRoom.get(row.roomId);
    if (bucket) bucket.push(row);
    else rowsByRoom.set(row.roomId, [row]);
  }

  for (const room of rooms) {
    const found = nearestOccasion(occasionsOf(room, rowsByRoom.get(room.id) ?? []), now);
    if (found) nearest.set(room.id, found);
  }
  return nearest;
}

/**
 * В КОМНАТЕ ВИДЕН РОВНО ОДИН ПРАЗДНИК — ближайший (`occasions.json → inRoom`).
 * null — праздников нет вовсе: день рождения пропущен, общих не приняли, своих
 * не завели. Это законное состояние, а не ошибка.
 */
export async function nearestRoomOccasion(
  userId: string,
  now: Date = new Date(),
): Promise<DatedOccasion | null> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { id: true, birthdayDay: true, birthdayMonth: true, birthdayYear: true },
  });
  if (!room) return null;
  return (await nearestOccasionByRoom([room], now)).get(room.id) ?? null;
}

/** Все праздники комнаты со строками — список настроек праздников. */
export async function listRoomOccasions(
  userId: string,
): Promise<{ birthday: RoomOccasion | null; rows: RoomOccasionRow[] }> {
  const room = await requireRoom(userId);
  const birthday = birthdayOf(room);
  return {
    birthday: birthday
      ? { kind: "birthday", key: null, title: null, day: birthday.day, month: birthday.month }
      : null,
    rows: await occasionRows(room.id),
  };
}

/**
 * ПРЕДЛОЖЕНИЕ ОБЩЕЙ ДАТЫ — или его отсутствие.
 *
 * Единственное, что уходит в календарь, — прежние ОТВЕТЫ хозяйки. Ни `zoneSet`,
 * ни пол, ни пресет, ни вещи комнаты сюда не попадают и попасть не могут:
 * `holidayOffer` их не принимает (см. `holidays.ts`, правило «оба и всем»).
 */
export async function occasionOffer(
  userId: string,
  now: Date = new Date(),
): Promise<HolidayOffer | null> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { id: true },
  });
  if (!room) return null;
  const rows = await prisma.roomOccasion.findMany({
    where: { roomId: room.id, kind: "COMMON" },
    select: { key: true, accepted: true, skippedYear: true },
  });
  return holidayOffer(
    now,
    rows.flatMap((row) =>
      isHolidayKey(row.key)
        ? [{ key: row.key, accepted: row.accepted, skippedYear: row.skippedYear }]
        : [],
    ),
  );
}

// ---------- Ответы на плашку ----------

/** Общая дата по ключу; чужая строка сюда не доедет. */
function requireHoliday(key: string): { key: HolidayKey; month: number; day: number } {
  const holiday = holidayByKey(key);
  if (!holiday) {
    throw new RoomOccasionError("UNKNOWN_HOLIDAY", "такой общей даты нет");
  }
  return holiday;
}

/**
 * «Показать» — общая дата принята и с этого мгновения живёт в комнате наравне
 * с днём рождения. Идемпотентно: повторное нажатие (двойной клик, две вкладки)
 * ничего не ломает и второй строки не заводит.
 */
export async function acceptHoliday(userId: string, rawKey: string): Promise<void> {
  const room = await requireRoom(userId);
  const holiday = requireHoliday(z.string().max(64).parse(rawKey));
  await prisma.roomOccasion.upsert({
    where: { roomId_key: { roomId: room.id, key: holiday.key } },
    create: {
      roomId: room.id,
      kind: "COMMON",
      key: holiday.key,
      day: holiday.day,
      month: holiday.month,
      accepted: true,
    },
    update: { accepted: true, skippedYear: null },
  });
  revalidateRoom(room.id);
}

/**
 * «Не в этом году» — плашка уходит ДО СЛЕДУЮЩЕГО ГОДА и молчит.
 *
 * Запоминается год САМОЙ ДАТЫ, а не нажатия: Новый год предлагают в декабре, а
 * случается он в январе — год нажатия увёл бы отказ не на тот праздник, и
 * плашка вернулась бы через две недели.
 */
export async function skipHoliday(
  userId: string,
  rawKey: string,
  now: Date = new Date(),
): Promise<void> {
  const room = await requireRoom(userId);
  const holiday = requireHoliday(z.string().max(64).parse(rawKey));
  const skippedYear = nextHoliday(holiday, now).getUTCFullYear();
  await prisma.roomOccasion.upsert({
    where: { roomId_key: { roomId: room.id, key: holiday.key } },
    create: {
      roomId: room.id,
      kind: "COMMON",
      key: holiday.key,
      day: holiday.day,
      month: holiday.month,
      accepted: false,
      skippedYear,
    },
    update: { accepted: false, skippedYear },
  });
  revalidateRoom(room.id);
}

// ---------- Свой повод ----------

const ownOccasionSchema = z.object({
  title: z.string().trim().min(1).max(OWN_TITLE_MAX),
  day: z.number().int(),
  month: z.number().int(),
});

/**
 * «Добавить свой повод» — годовщина, новоселье, выпускной. Продукт их НИКОГДА
 * не предлагает: про свой повод знает только хозяйка, и подсказывать ей
 * примеры в самом поле мы не станем (граница тикета — `occasions.json →
 * threeKinds.own.note`).
 *
 * Дата проверяется тем же `isBirthday`, что и день рождения: 31 февраля не
 * бывает ни у кого, а 29 февраля законно и у повода тоже.
 */
export async function addOwnOccasion(
  userId: string,
  input: { title: string; day: number; month: number },
): Promise<RoomOccasionRow> {
  const room = await requireRoom(userId);
  const parsed = ownOccasionSchema.parse(input);
  if (!isBirthday({ day: parsed.day, month: parsed.month })) {
    throw new RoomOccasionError("VALIDATION", "такого дня не бывает");
  }
  const created = await prisma.roomOccasion.create({
    data: {
      roomId: room.id,
      kind: "OWN",
      key: null,
      title: parsed.title,
      day: parsed.day,
      month: parsed.month,
      accepted: true,
    },
  });
  revalidateRoom(room.id);
  return created;
}

/**
 * Убрать праздник — свой повод или принятую общую дату. Чужая строка неотличима
 * от несуществующей (тот же приём, что у вещей): фильтр по комнате прямо в
 * запросе.
 */
export async function removeOccasion(userId: string, occasionId: string): Promise<void> {
  const room = await requireRoom(userId);
  const removed = await prisma.roomOccasion.deleteMany({
    where: { id: idSchema.parse(occasionId), roomId: room.id },
  });
  if (removed.count === 0) {
    throw new RoomOccasionError("NOT_FOUND", "такого праздника нет");
  }
  revalidateRoom(room.id);
}
