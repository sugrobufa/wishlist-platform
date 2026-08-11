// occasion.close (тикет 10): ежечасная repeat-джоба. Находит комнаты, у
// которых день рождения уже наступил, а OccasionSummary ЭТОЙ даты ещё нет, и
// закрывает праздник (services/occasions.closeOccasion: summary + письмо
// хозяйке в очередь mail). Чистая функция processOccasionClose тестируется
// напрямую (tests/occasions.test.ts); воркер (index.ts) лишь регистрирует её.
//
// ВЫБОРКА ПО ДНЮ И МЕСЯЦУ (тикет 187). Отметки праздника в комнате больше нет
// — есть повторяющийся день рождения, поэтому «у кого праздник уже прошёл»
// это перечисление дней хвоста (две недели, `birthday.dueOccasionKeys`): полтора
// десятка пар «месяц·день» обычным OR по двум целым колонкам. Точную дату
// каждой комнаты досчитывает `dueOccasion` — выборка лишь сужает круг.
import { prisma } from "../server/db";
import { birthdayOf, dueOccasion, dueOccasionKeys } from "../server/birthday";
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
 * Один тик автозакрытия. Кандидаты — ТОЛЬКО наступившие праздники без summary
 * своей даты: комнаты, у которых день рождения впереди (или прошёл больше двух
 * недель назад), комнаты без даты и уже закрытые (в т.ч. вручную — ручной
 * запуск при наступившем празднике пишет summary той же даты) не трогаются.
 * Повторный тик поверх закрытого — no-op и без второго письма (двойной пояс:
 * фильтр здесь + идемпотентность самого closeOccasion).
 */
export async function processOccasionClose(now: Date = new Date()): Promise<OccasionCloseResult> {
  const keys = dueOccasionKeys(now);
  const candidates = await prisma.room.findMany({
    where: {
      OR: keys.map((key) => ({ birthdayMonth: key.month, birthdayDay: key.day })),
    },
    select: { id: true, birthdayDay: true, birthdayMonth: true, birthdayYear: true },
  });

  // Дата праздника у каждого кандидата — своя (29 февраля в невисокосный год
  // празднуется 28-го), поэтому считаем её поштучно, а не по дню выборки.
  const due = candidates.flatMap((room) => {
    const birthday = birthdayOf(room);
    const date = birthday ? dueOccasion(birthday, now) : null;
    return date ? [{ id: room.id, date }] : [];
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
    if (alreadyClosed.has(`${room.id}:${utcDayKey(room.date)}`)) continue;
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
