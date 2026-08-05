// Дата праздника в онбординге (тикет 43). Модуль намеренно без React и без
// БД: правила чтения даты проверяются тестом (occasion-date.test.ts), а не
// прокликиванием формы.
//
// Два входа, одно правило: календарный день `YYYY-MM-DD` или ничего.
// - `readOccasionDate` — поле шага 3 на сервере (форма может прислать что
//   угодно, включая «Пока не знаю» с пустым полем);
// - `initialOccasionValue` — значение, пришедшее СНАРУЖИ (тикет 38 будет
//   подставлять дату из брони гостя). Мусор снаружи не должен уронить шаг.
//
// Момент времени тут не считается: перевод дня в полночь UTC живёт в
// services/rooms.setOccasionDate — единственном месте, которое пишет
// Room.occasionDate (и из настроек, и отсюда).

/** Ровно то, что отдаёт `<input type="date">`: день без времени и без зоны. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Календарный день из формы или `null`, если дня нет. Отклоняются пустое
 * поле, время в строке (`2026-12-31T12:00:00Z` — это момент, а не день) и
 * несуществующие числа: `2026-02-31` по форме проходит, но JS-датой
 * превращается в 3 марта — такой день не сохраняем.
 */
export function readOccasionDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!ISO_DAY.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Круг: день, который «переехал» при разборе, самим собой не остался.
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * Стартовое значение поля шага 3. Это шов для предзаполнения снаружи
 * (тикет 38): что не похоже на день — молча становится пустым полем, шаг
 * ведёт себя как обычно.
 */
export function initialOccasionValue(prefilled: string | null | undefined): string {
  return readOccasionDate(prefilled) ?? "";
}
