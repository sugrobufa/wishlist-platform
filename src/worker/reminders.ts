// Планировщик напоминаний (тикет 12): ежечасная джоба reminder-tick находит
// комнаты, чей праздник в окне «за 3 суток», и ставит каждой живой брони с
// guestEmail джобу reminder-guest в очередь mail. Гость без email — молча
// пропущен (продукт тихий, никаких обходных каналов).
//
// ИДЕМПОТЕНТНОСТЬ БЕЗ МИГРАЦИИ: детерминированный jobId
// `reminder-{bookingId}-{yyyymmdd(occasionDate)}` (queues.reminderGuestJobId)
// + хранение completed-джоб очереди mail 14 суток (MAIL_KEEP_COMPLETED).
// Повторный add с тем же jobId, пока прежняя джоба жива (в т.ч. completed),
// BullMQ игнорирует — второй тик того же окна письма не дублирует. Поле вида
// Booking.reminderSentAt отвергнуто: миграции параллельно с тикетом 11
// запрещены, а BullMQ-дедупа для MVP достаточно.
//
// Чистая функция processReminderTick тестируется напрямую
// (tests/reminders.test.ts); воркер (index.ts) её лишь регистрирует.
import { prisma } from "../server/db";
import { enqueueReminderGuest, reminderGuestJobId } from "../server/queues";
import type { ReminderGuestMailJobData } from "../server/queues";

/** Окно напоминания: (occasionDate − 3 суток) ≤ now < occasionDate. */
export const REMINDER_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderTickResult = {
  /** jobId поставленных напоминаний (детерминированы: повторный тик отдаёт те же). */
  enqueued: string[];
  /** jobId броней, для которых очередь mail оказалась недоступна: следующий тик доберёт. */
  failed: string[];
};

export interface ReminderTickDeps {
  /** Шов очереди — тесты не трогают Redis. */
  enqueue?: (data: ReminderGuestMailJobData) => Promise<boolean>;
}

/**
 * Один тик напоминаний. Границы окна: ровно за 3 суток (occasionDate − 3д ==
 * now) бронь уже в деле, день праздника и всё после — нет; комнаты без даты
 * не участвуют. Payload самодостаточен — обработчик (worker/mail) письма
 * рендерит без БД.
 */
export async function processReminderTick(
  now: Date = new Date(),
  deps: ReminderTickDeps = {},
): Promise<ReminderTickResult> {
  const enqueue = deps.enqueue ?? enqueueReminderGuest;

  const bookings = await prisma.booking.findMany({
    where: {
      guestEmail: { not: null },
      item: {
        room: {
          occasionDate: {
            gt: now,
            lte: new Date(now.getTime() + REMINDER_WINDOW_DAYS * DAY_MS),
          },
        },
      },
    },
    select: {
      id: true,
      guestName: true,
      guestEmail: true,
      item: {
        select: {
          title: true,
          room: {
            select: {
              shareSlug: true,
              occasionDate: true,
              user: { select: { displayName: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const enqueued: string[] = [];
  const failed: string[] = [];
  for (const booking of bookings) {
    const room = booking.item.room;
    // where уже отфильтровал; guard сужает типы и отсекает гипотетическую "".
    if (!booking.guestEmail || !room.occasionDate) continue;

    const data: ReminderGuestMailJobData = {
      bookingId: booking.id,
      email: booking.guestEmail,
      guestName: booking.guestName,
      ownerName: room.user.displayName,
      occasionDate: room.occasionDate.toISOString(),
      itemTitle: booking.item.title,
      roomSlug: room.shareSlug,
    };
    const jobId = reminderGuestJobId(booking.id, room.occasionDate);
    if (await enqueue(data)) {
      enqueued.push(jobId);
    } else {
      failed.push(jobId);
    }
  }
  return { enqueued, failed };
}
