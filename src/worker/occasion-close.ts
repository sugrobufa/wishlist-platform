// occasion.close (тикет 10): ежечасная repeat-джоба. Находит комнаты, у
// которых occasionDate уже прошла, а OccasionSummary ЭТОЙ даты ещё нет, и
// закрывает праздник (services/occasions.closeOccasion: summary + письмо
// хозяйке в очередь mail). Чистая функция processOccasionClose тестируется
// напрямую (tests/occasions.test.ts); воркер (index.ts) лишь регистрирует её.
import { prisma } from "../server/db";
import { closeOccasion } from "../server/services/occasions";

/** Идемпотентность дат — UTC-сутки, как в closeOccasion. */
function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type OccasionCloseResult = {
  /** Комнаты, которым в этот тик создан summary. */
  closed: string[];
  /** Комнаты, на которых closeOccasion упал (тик продолжается, не падает). */
  failed: string[];
};

/**
 * Один тик автозакрытия. Кандидаты — ТОЛЬКО просроченные без summary своей
 * даты: будущие даты, комнаты без даты и уже закрытые (в т.ч. вручную —
 * ручной запуск при наступившей дате пишет summary той же даты) не трогаются.
 * Повторный тик поверх закрытого — no-op и без второго письма (двойной пояс:
 * фильтр здесь + идемпотентность самого closeOccasion).
 */
export async function processOccasionClose(now: Date = new Date()): Promise<OccasionCloseResult> {
  const due = await prisma.room.findMany({
    where: { occasionDate: { lt: now } },
    select: { id: true, occasionDate: true },
  });
  if (due.length === 0) return { closed: [], failed: [] };

  const summaries = await prisma.occasionSummary.findMany({
    where: { roomId: { in: due.map((room) => room.id) } },
    select: { roomId: true, date: true },
  });
  const alreadyClosed = new Set(
    summaries.map((summary) => `${summary.roomId}:${utcDayKey(summary.date)}`),
  );

  const closed: string[] = [];
  const failed: string[] = [];
  for (const room of due) {
    if (!room.occasionDate || alreadyClosed.has(`${room.id}:${utcDayKey(room.occasionDate)}`)) {
      continue;
    }
    try {
      const result = await closeOccasion(room.id);
      if (result?.created) closed.push(room.id);
    } catch (error) {
      // Одна упавшая комната (например, удалена параллельно) не роняет тик.
      failed.push(room.id);
      console.error(
        `[occasion.close] комната ${room.id} не закрылась:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { closed, failed };
}
