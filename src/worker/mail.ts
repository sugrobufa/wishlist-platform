// Обработчик очереди mail (тикет 12): превращает джобы в письма через общий
// mailer (src/server/mailer). Имена джоб — контракт: `occasion-owner` ставит
// closeOccasion (тикет 10), `reminder-guest` — ежечасный тик напоминаний
// (src/worker/reminders.ts). Неизвестные имена (в т.ч. hello при старте
// воркера) — лог и completed: очередь общая, крутиться в ретраях на чужой
// джобе нельзя. Чистая функция processMailJob тестируется напрямую
// (tests/mailer.worker.test.ts); воркер (index.ts) её лишь регистрирует.
import { z } from "zod";
import { prisma } from "../server/db";
import { appUrl, sendOccasionOwner, sendReminderGuest } from "../server/mailer";

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
  console.log(`[mail] незнакомая джоба «${name}» — пропускаю`);
  return { status: "skipped", reason: "unknown-job" };
}

/** Хозяйке после праздника: «открой „что подарили"». Ни вещей, ни имён —
 * только ссылка (инвариант №2: раскрытие живёт на самом экране). */
async function processOccasionOwner(data: unknown, deps: MailJobDeps): Promise<MailJobResult> {
  const parsed = occasionOwnerSchema.safeParse(data);
  if (!parsed.success) return { status: "skipped", reason: "bad-data" };

  // displayName достаём всегда; заодно это заслон GDPR: аккаунт удалён
  // между закрытием праздника и отправкой → писать некому и не о чем.
  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { email: true, displayName: true },
  });
  if (!user) return { status: "skipped", reason: "user-gone" };

  const to = parsed.data.email || user.email;
  if (!to) return { status: "skipped", reason: "no-recipient" };

  await (deps.sendOccasionOwnerImpl ?? sendOccasionOwner)(to, {
    ownerName: user.displayName,
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

  const booking = await prisma.booking.findUnique({
    where: { id: job.bookingId },
    select: { id: true },
  });
  if (!booking) return { status: "skipped", reason: "booking-gone" };

  await (deps.sendReminderGuestImpl ?? sendReminderGuest)(job.email, {
    guestName: job.guestName,
    ownerName: job.ownerName,
    itemTitle: job.itemTitle,
    occasionDate,
    roomSlug: job.roomSlug,
  });
  return { status: "sent" };
}
