// Порядок ленты друзей (тикет 95, доска Б7 · турн 11e, `task15.json →
// friendsFeed`). Модуль намеренно без React и без БД: правило порядка
// проверяется тестом, а не прокликиванием страницы.
//
// ПОЧЕМУ НЕ В СЕРВИСЕ. «Через сколько дней праздник» — свойство СЕГОДНЯШНЕГО
// ДНЯ, а не связи: посчитай его в сервисе, и оно попадёт в любой будущий кэш,
// где протухнет на смене суток. Та же причина, по которой отдельно живёт
// `welcome.ts` у гостевой комнаты.
import type { ConnectionRowDto } from "@/server/services/connections";
import { daysUntilOccasion } from "@/app/r/[slug]/welcome";

/** Отсчёт показываем за 30 дней; раньше — просто дату (`friendsFeed`). */
export const COUNTDOWN_WINDOW_DAYS = 30;
/** Ближе этого — точка пульсирует: «пора действовать». */
export const URGENT_DAYS = 7;

export type FeedRow = {
  row: ConnectionRowDto;
  /**
   * Дней до ближайшего праздника друга — ЛЮБОГО вида (тикет 204: до него
   * лента считала только день рождения и сортировала по неполным данным).
   * `null` — праздника нет, дата непонятна, он уже прошёл или комната друга
   * нам недоступна (тогда и кадра нет).
   */
  daysLeft: number | null;
};

/**
 * Один порядок и никакого ручного: сначала те, у кого праздник ближе, потом —
 * все остальные по последнему событию (прежний порядок страницы). Смысл
 * экрана в этом и есть: «карточка сама говорит, что пора действовать».
 *
 * Группы возвращаются раздельно, а не одним списком с флагом: между ними на
 * экране стоит разделитель, и склеивать их значит потом их же расклеивать.
 */
export function orderFeed(
  rows: readonly ConnectionRowDto[],
  now: Date,
): { upcoming: FeedRow[]; rest: FeedRow[] } {
  const upcoming: FeedRow[] = [];
  const rest: FeedRow[] = [];

  for (const row of rows) {
    const daysLeft = daysUntilOccasion(row.room?.occasion?.date, now);
    (daysLeft === null ? rest : upcoming).push({ row, daysLeft });
  }

  // Ближайший праздник выше; равные дни — по последнему событию, свежие выше.
  upcoming.sort((a, b) => {
    const byDays = (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
    if (byDays !== 0) return byDays;
    return a.row.lastAt < b.row.lastAt ? 1 : a.row.lastAt > b.row.lastAt ? -1 : 0;
  });
  rest.sort((a, b) => (a.row.lastAt < b.row.lastAt ? 1 : a.row.lastAt > b.row.lastAt ? -1 : 0));

  return { upcoming, rest };
}

/**
 * Как подписать срок: отсчёт («через 9 дней») внутри окна, дата — раньше.
 * Возвращается ключ строки и значение, чтобы саму строку собрал next-intl:
 * форматирование дат живёт на стороне разметки (CLAUDE.md).
 */
export function countdownShown(daysLeft: number): boolean {
  return daysLeft <= COUNTDOWN_WINDOW_DAYS;
}

/** Праздник совсем близко — точка карточки пульсирует. */
export function urgent(daysLeft: number): boolean {
  return daysLeft <= URGENT_DAYS;
}
