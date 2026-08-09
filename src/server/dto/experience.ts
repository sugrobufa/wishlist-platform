// Услуга-впечатление (тикет 97, доска Б20 · турн 8e, `task15.json →
// experienceCard`). Зона «Впечатления» есть в каждой из десяти комнат, а
// карточки под неё не было: мастер-класс показывался формой предмета, где
// спрашивают размер и цвет. У впечатления другие вопросы — «Когда · Где ·
// Годен до».
//
// Модуль чистый: правила ячеек и срока проверяются тестом, а не экраном.

/** Ключ зоны впечатлений из zones.json — она одна на все комнаты. */
export const EXPERIENCE_ZONE = "events";

export function isExperienceZone(zone: string): boolean {
  return zone === EXPERIENCE_ZONE;
}

/** Одна ячейка полосы: ключ строки словаря и значение. */
export type ExperienceCell = { key: "when" | "where" | "validUntil"; value: string };

export type ExperienceFields = {
  eventWhen?: string | null;
  eventWhere?: string | null;
  /** ISO-строка или null — форма показа, а не Date: DTO уезжает клиенту. */
  validUntil?: string | null;
};

/**
 * Ячейки полосы в порядке доски. **Пустое поле не рисуется** — «ячейки
 * 3→2→1, прочерков нет»: полоса из трёх клеток, где две пустые, читается как
 * незаполненная анкета, а не как рассказ о впечатлении.
 *
 * Дата «годен до» отдаётся календарным днём — форматирует её разметка через
 * next-intl: в словаре живут слова, а не формат даты.
 */
export function experienceCells(item: ExperienceFields): ExperienceCell[] {
  const cells: ExperienceCell[] = [];
  const when = item.eventWhen?.trim();
  const where = item.eventWhere?.trim();
  if (when) cells.push({ key: "when", value: when });
  if (where) cells.push({ key: "where", value: where });
  if (item.validUntil) cells.push({ key: "validUntil", value: item.validUntil });
  return cells;
}

/**
 * Срок вышел — НАУТРО ПОСЛЕ `validUntil` (доска: «trigger — наутро после»).
 * То есть последний день срока вещь ещё живая: сертификат, годный до 14
 * марта, четырнадцатого числа принимают.
 *
 * Считается В UTC — тем же поясом, которым дата пишется (полночь UTC), той же
 * логикой, что `daysUntilOccasion`. Считать «сегодня» по поясу машины значило
 * бы гасить вещь на сутки раньше у гостя восточнее Гринвича.
 */
export function isExpired(validUntil: Date | string | null | undefined, now: Date): boolean {
  if (validUntil === null || validUntil === undefined) return false;
  const target = validUntil instanceof Date ? validUntil.getTime() : Date.parse(validUntil);
  if (Number.isNaN(target)) return false;

  const day = new Date(target);
  const lastDay = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return today > lastDay;
}

/** За сколько дней до срока хозяйку предупреждают (доска: warnMail). */
export const EXPIRY_WARN_DAYS = 7;
