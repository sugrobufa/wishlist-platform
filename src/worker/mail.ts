// Обработчик очереди mail (тикет 12): превращает джобы в письма через общий
// mailer (src/server/mailer). Имена джоб — контракт: `occasion-owner` ставит
// closeOccasion (тикет 10), `reminder-guest` — ежечасный тик напоминаний
// (src/worker/reminders.ts), `item-gone` — переезд вещи в сокровищницу
// (services/items.toggleHall, тикет 124). Неизвестные имена (в т.ч. hello при старте
// воркера) — лог и completed: очередь общая, крутиться в ретраях на чужой
// джобе нельзя. Чистая функция processMailJob тестируется напрямую
// (tests/mailer.worker.test.ts); воркер (index.ts) её лишь регистрирует.
import { z } from "zod";
import { rooms as roomPresets } from "@/config/design";
import { visibleZones } from "@/components/scene/zones";
import { prisma } from "../server/db";
import { appUrl, sendItemGone, sendOccasionOwner, sendReminderGuest } from "../server/mailer";
import { countFreeGiftsByRoom, findRoomBySlug } from "../server/services/guest-room";

const occasionOwnerSchema = z.object({
  userId: z.string().min(1),
  // email по контракту тикета 10 приходит в payload; пустой — добираем по
  // userId из БД (см. processOccasionOwner).
  email: z.string().default(""),
  roomId: z.string().min(1),
});

const reminderGuestSchema = z.object({
  bookingId: z.string().min(1),
  email: z.string().min(1),
  guestName: z.string().min(1),
  ownerName: z.string().nullable().default(null),
  occasionDate: z.string().min(1),
  itemTitle: z.string().min(1),
  roomSlug: z.string().min(1),
});

const itemGoneSchema = z.object({
  bookingId: z.string().min(1),
  email: z.string().min(1),
  guestName: z.string().default(""),
  itemTitle: z.string().default(""),
  roomSlug: z.string().min(1),
});

export type MailJobSkipReason =
  | "unknown-job" // не наше имя (hello и будущие) — completed без письма
  | "bad-data" // мусор вместо payload'а — повтор не поможет
  | "user-gone" // хозяйка удалила аккаунт (GDPR, тикет 14) — писать некому
  | "no-recipient" // email пуст и в payload, и в БД
  | "booking-gone" // гость снял бронь, пока письмо ждало, — молчим
  | "occasion-passed"; // праздник уже прошёл — напоминание «за 3 дня» опоздало

export type MailJobResult = { status: "sent" } | { status: "skipped"; reason: MailJobSkipReason };

export interface MailJobDeps {
  /** Швы отправки — в тестах письма не уходят и не печатаются. */
  sendReminderGuestImpl?: typeof sendReminderGuest;
  sendOccasionOwnerImpl?: typeof sendOccasionOwner;
  sendItemGoneImpl?: typeof sendItemGone;
  now?: () => Date;
}

/**
 * Обработчик джобы очереди mail. Возвращает результат вместо исключения для
 * всех «окончательных» исходов (completed, повторы не нужны); исключение —
 * только от самой отправки (SMTP икнул) — её доиграет BullMQ по attempts.
 */
export async function processMailJob(
  name: string,
  data: unknown,
  deps: MailJobDeps = {},
): Promise<MailJobResult> {
  if (name === "occasion-owner") return processOccasionOwner(data, deps);
  if (name === "reminder-guest") return processReminderGuest(data, deps);
  if (name === "item-gone") return processItemGone(data, deps);
  console.log(`[mail] незнакомая джоба «${name}» — пропускаю`);
  return { status: "skipped", reason: "unknown-job" };
}

/** Хозяйке после праздника: «открой „что подарили"». Ни вещей, ни имён —
 * только ссылка (инвариант №2: раскрытие живёт на самом экране). */
async function processOccasionOwner(data: unknown, deps: MailJobDeps): Promise<MailJobResult> {
  const parsed = occasionOwnerSchema.safeParse(data);
  if (!parsed.success) return { status: "skipped", reason: "bad-data" };

  // Пользователя читаем всегда: это заслон GDPR — аккаунт удалён между
  // закрытием праздника и отправкой → писать некому и не о чем. Из полей
  // нужна только почта: имени письмо с раунда 41 не принимает вовсе
  // (`OccasionOwnerParams` — одна ссылка, тикет 171).
  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { email: true },
  });
  if (!user) return { status: "skipped", reason: "user-gone" };

  const to = parsed.data.email || user.email;
  if (!to) return { status: "skipped", reason: "no-recipient" };

  await (deps.sendOccasionOwnerImpl ?? sendOccasionOwner)(to, {
    occasionUrl: appUrl("/room/occasion"),
  });
  return { status: "sent" };
}

/** Гостю за 3 дня: «вы заняли подарок…». Payload самодостаточен; в БД —
 * только проверка, что бронь ещё жива (снятая бронь = никакого письма). */
async function processReminderGuest(data: unknown, deps: MailJobDeps): Promise<MailJobResult> {
  const parsed = reminderGuestSchema.safeParse(data);
  if (!parsed.success) return { status: "skipped", reason: "bad-data" };
  const job = parsed.data;

  const occasionDate = new Date(job.occasionDate);
  if (Number.isNaN(occasionDate.getTime())) return { status: "skipped", reason: "bad-data" };
  // Воркер мог пролежать: напоминание «за 3 дня» ПОСЛЕ праздника хуже,
  // чем никакого, — продукт тихий.
  if (occasionDate <= (deps.now ?? (() => new Date()))()) {
    return { status: "skipped", reason: "occasion-passed" };
  }

  // Тем же запросом, что проверяет живость брони, добираем ЦЕНУ, ВАЛЮТУ,
  // НАСТРОЙКУ ПОКАЗА ЦЕНЫ и ЗОНУ вещи — плашку письма из контракта round41
  // («название, цена, полка, комната»). В payload'е их нет и не будет: цена и
  // особенно `priceVisibility` могли смениться, пока джоба ждала своего часа,
  // а показывать гостю цену, которую комната уже прячет, письмо не вправе
  // (инвариант №8). Свежесть здесь бесплатна — запрос всё равно делается.
  const booking = await prisma.booking.findUnique({
    where: { id: job.bookingId },
    select: {
      id: true,
      item: {
        select: { zone: true, price: true, currency: true, priceVisibility: true },
      },
    },
  });
  if (!booking) return { status: "skipped", reason: "booking-gone" };

  await (deps.sendReminderGuestImpl ?? sendReminderGuest)(job.email, {
    ownerName: job.ownerName,
    itemTitle: job.itemTitle,
    occasionDate,
    itemZone: booking.item.zone,
    price: booking.item.price === null ? null : booking.item.price.toString(),
    currency: booking.item.currency,
    priceVisibility: booking.item.priceVisibility,
  });
  return { status: "sent" };
}

/**
 * Гостю: «вещь уехала — выбери другую» (тикет 124, слова и вёрстка — контракт
 * round41). ЗА БРОНЬЮ В БД НЕ ХОДИМ ВОВСЕ, и это не оптимизация: бронь к
 * этому моменту уже удалена — письмо ровно об этом. Проверка «жива ли бронь»,
 * как у напоминания, отменила бы здесь каждое письмо.
 *
 * ЗА КОМНАТОЙ ХОДИМ (тикет 160): контракт просит в подвале «сколько свободно
 * и когда праздник», а имя хозяйки стоит в самой фразе. Всё это — свойства
 * КОМНАТЫ, а не брони, и берутся они на момент ОТПРАВКИ: письмо пролежало в
 * очереди, а число свободных вещей за это время могло смениться. Комната
 * пропала (аккаунт удалён) — письмо всё равно уходит, просто без этих строк:
 * гость обязан узнать, что подарок отменился.
 *
 * ХОЗЯЙКЕ ЭТО ПИСЬМО НЕ УХОДИТ НИКОГДА (инвариант №1): адрес в payload'е —
 * гостевой, и второго адреса в джобе нет.
 */
async function processItemGone(data: unknown, deps: MailJobDeps): Promise<MailJobResult> {
  const parsed = itemGoneSchema.safeParse(data);
  if (!parsed.success) return { status: "skipped", reason: "bad-data" };
  const job = parsed.data;

  const room = await findRoomBySlug(job.roomSlug);
  // «Свободно» считается ТЕМ ЖЕ правилом, что и на странице комнаты
  // (guest-room.countFreeGiftsByRoom по ВИДИМЫМ зонам): разъедься оно на два
  // места — и письмо начало бы спорить числом с той страницей, куда зовёт.
  const preset = room === null ? undefined : roomPresets.find((row) => row.id === room.preset);
  const zoneKeys =
    room === undefined || room === null || preset === undefined
      ? []
      : visibleZones(preset.zones, room.zonesOff).map((zone) => zone.key);
  const freeCount =
    room === null || zoneKeys.length === 0
      ? null
      : ((await countFreeGiftsByRoom([{ roomId: room.id, zoneKeys }])).get(room.id) ?? null);

  await (deps.sendItemGoneImpl ?? sendItemGone)(job.email, {
    itemTitle: job.itemTitle,
    roomSlug: job.roomSlug,
    ownerName: room?.user.displayName ?? null,
    freeCount,
    occasionDate: room?.occasionDate ?? null,
  });
  return { status: "sent" };
}
