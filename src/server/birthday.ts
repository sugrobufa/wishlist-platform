// День рождения хозяйки (тикет 187) — вся арифметика повторяющейся даты.
//
// ЧТО ИЗМЕНИЛОСЬ. Раньше комната хранила ОДИН момент — `Room.occasionDate`, и
// это была разовая дата: она протухала молча, а онбординг спрашивал её так,
// будто праздник один и навсегда («Дата» — слово, которое ничего не называет).
// Теперь комната хранит ДЕНЬ и МЕСЯЦ (+ необязательный год), а «ближайший
// праздник» считается ОТ СЕГОДНЯ — прошёл, и следующий сам становится через
// год. Спрашивать больше нечего.
//
// Модуль намеренно без БД, без React и без next: правила даты проверяются
// тестом (tests/birthday.test.ts), а не прокликиванием формы. Поэтому его
// одинаково безопасно читают и сервисы, и воркеры, и выбор дня на клиенте.
//
// ВСЁ СЧИТАЕТСЯ В UTC — тем же поясом, которым цикл праздника жил всегда
// (полночь UTC, mailer.formatOccasionDate, welcome.daysUntilOccasion). Считать
// «сегодня» поясом машины значило бы получать разные дни на сервере и у гостя.

/** День рождения: день и месяц обязательны, год — нет (возраст продукту не нужен). */
export type Birthday = {
  day: number;
  month: number;
  /** Год рождения; null — человек его не называл, и спрашивать мы не будем. */
  year: number | null;
};

/** Строки комнаты, из которых складывается день рождения. */
export type BirthdayColumns = {
  birthdayDay: number | null;
  birthdayMonth: number | null;
  birthdayYear: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «Хвост праздника» — сколько суток после дня рождения он ещё считается
 * НАСТУПИВШИМ: в эти дни закрывается итог («что подарили») и висит тихая
 * строка в комнате. Дальше комната молчит до следующего года.
 *
 * У разовой даты хвоста не было и быть не могло: прошедшая дата оставалась
 * прошедшей навсегда, а тишину между праздниками включала рукой сама хозяйка,
 * поставив новую. Повторяющаяся дата эту руку убрала — «впереди» она теперь
 * всегда, и без хвоста «праздник прошёл» означало бы «прошёл год назад».
 *
 * Две недели, а не сутки: воркер закрывает итог ежечасно, но простой в
 * половину дня и подарок, доехавший на выходных, — обычное дело, и терять
 * из-за них весь праздник нельзя.
 */
export const OCCASION_TAIL_DAYS = 14;

/** Ровно то, что отдаёт `<input type="date">`: день без времени и без зоны. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Сколько дней в месяце. Год неизвестен (`null`) — февраль вмещает 29:
 * 29 февраля законный день рождения, и требовать год ради него мы не станем.
 */
export function daysInMonth(month: number, year: number | null = null): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (month === 2 && year !== null) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

/** Год рождения, который вообще бывает. Год мы не показываем — только храним. */
function isYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2100;
}

/** Такой день рождения существует? 31 февраля не бывает ни с годом, ни без. */
export function isBirthday(value: {
  day: unknown;
  month: unknown;
  year?: unknown;
}): value is Birthday {
  const { day, month } = value;
  const year = value.year ?? null;
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year !== null && !(typeof year === "number" && isYear(year))) return false;
  const max = daysInMonth(month as number, typeof year === "number" ? year : null);
  return max > 0 && (day as number) >= 1 && (day as number) <= max;
}

/**
 * День рождения из того, что напечатал человек или прислала форма.
 * Понимает две формы и обе — календарный день, а не момент времени:
 * - `"YYYY-MM-DD"` (поле даты, cookie предзаполнения, прежняя колонка);
 * - `{ day, month, year? }` — два списка шага онбординга и настроек.
 * Всё остальное (пустое поле, время в строке, 31 февраля) — `null`.
 */
export function parseBirthday(raw: unknown): Birthday | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!ISO_DAY.test(value)) return null;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    return isBirthday({ day, month, year }) ? { day, month, year } : null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as { day?: unknown; month?: unknown; year?: unknown };
  const day = toNumber(record.day);
  const month = toNumber(record.month);
  const year = record.year === null || record.year === undefined ? null : toNumber(record.year);
  if (day === null || month === null) return null;
  const candidate = { day, month, year };
  return isBirthday(candidate) ? candidate : null;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** День рождения комнаты; null — не задан («Пока не знаю» и после него). */
export function birthdayOf(room: BirthdayColumns): Birthday | null {
  if (room.birthdayDay === null || room.birthdayMonth === null) return null;
  const candidate = {
    day: room.birthdayDay,
    month: room.birthdayMonth,
    year: room.birthdayYear,
  };
  // Мусор в колонках (ручная правка БД) днём рождения не считается: комната
  // ведёт себя как без даты, а не падает.
  return isBirthday(candidate) ? candidate : null;
}

/** Колонки комнаты из дня рождения — единственная форма записи в БД. */
export function birthdayColumns(birthday: Birthday | null): BirthdayColumns {
  return {
    birthdayDay: birthday?.day ?? null,
    birthdayMonth: birthday?.month ?? null,
    birthdayYear: birthday?.year ?? null,
  };
}

/** Полночь UTC этого дня — отметка, которой праздник живёт везде. */
function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * День рождения в конкретном году, полночь UTC.
 *
 * 29 ФЕВРАЛЯ В НЕВИСОКОСНЫЙ ГОД — 28-го: последним днём февраля, а не первым
 * днём марта. Праздник остаётся в своём месяце, и напоминание приходит до
 * него, а не после.
 */
export function occasionInYear(birthday: Birthday, year: number): Date {
  const day = Math.min(birthday.day, daysInMonth(birthday.month, year));
  return new Date(Date.UTC(year, birthday.month - 1, day));
}

/**
 * БЛИЖАЙШИЙ праздник от «сегодня», полночь UTC. Сегодняшний день рождения —
 * ближайший (праздник идёт, а не прошёл); вчерашний уже отдан следующему году.
 * Именно эту дату видят гость в комнате, письмо-напоминание и лента друзей.
 */
export function nextOccasion(birthday: Birthday, now: Date): Date {
  const today = utcMidnight(now);
  const thisYear = occasionInYear(birthday, today.getUTCFullYear());
  return thisYear.getTime() >= today.getTime()
    ? thisYear
    : occasionInYear(birthday, today.getUTCFullYear() + 1);
}

/**
 * НАСТУПИВШИЙ праздник — тот, по которому закрывается итог: последнее
 * вхождение даты, если оно случилось не раньше `tailDays` суток назад.
 * `null` — комната МЕЖДУ праздниками: закрывать нечего, напоминать не о чем,
 * тихая строка в комнате молчит.
 */
export function dueOccasion(
  birthday: Birthday,
  now: Date,
  tailDays: number = OCCASION_TAIL_DAYS,
): Date | null {
  const today = utcMidnight(now);
  const thisYear = occasionInYear(birthday, today.getUTCFullYear());
  const passed =
    thisYear.getTime() <= now.getTime()
      ? thisYear
      : occasionInYear(birthday, today.getUTCFullYear() - 1);
  return today.getTime() - passed.getTime() <= tailDays * DAY_MS ? passed : null;
}

/** Календарный день `YYYY-MM-DD` из отметки. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` ближайшего праздника; null — дня рождения нет. */
export function nextOccasionDay(birthday: Birthday | null, now: Date): string | null {
  return birthday === null ? null : isoDay(nextOccasion(birthday, now));
}

/** Ближайший праздник прямо из строки комнаты; null — дня рождения нет. */
export function nextOccasionOf(room: BirthdayColumns, now: Date): Date | null {
  const birthday = birthdayOf(room);
  return birthday === null ? null : nextOccasion(birthday, now);
}

/** Пара «месяц·день», которой день рождения записан в комнате. */
export type BirthdayKey = { month: number; day: number };

/**
 * Какие ХРАНИМЫЕ пары «месяц·день» празднуются в окне `(after, until]`.
 *
 * Нужна выборке в БД: колонки хранят день и месяц, а не отметку, поэтому
 * «у кого праздник в ближайшие трое суток» — это перечисление дней окна.
 * Окно короткое (трое суток у напоминаний, две недели у закрытия итога), и
 * пар получается полтора десятка — обычный `OR` по двум целым колонкам.
 *
 * 28 февраля невисокосного года празднуют ДВЕ пары: своя и 29 февраля
 * (`occasionInYear` переносит её на последний день месяца).
 */
export function occasionKeysBetween(after: Date, until: Date): BirthdayKey[] {
  const keys: BirthdayKey[] = [];
  const seen = new Set<string>();
  const last = utcMidnight(until);
  // Первый день окна — полночь ПОСЛЕ `after` (окно полуоткрытое слева).
  let cursor = utcMidnight(after);
  if (cursor.getTime() <= after.getTime()) cursor = new Date(cursor.getTime() + DAY_MS);

  // Предохранитель от бесконечного цикла на битом окне: год с запасом.
  for (let guard = 0; guard < 400 && cursor.getTime() <= last.getTime(); guard += 1) {
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    push(keys, seen, { month, day });
    if (month === 2 && day === 28 && !isLeapYear(cursor.getUTCFullYear())) {
      push(keys, seen, { month: 2, day: 29 });
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return keys;
}

function push(keys: BirthdayKey[], seen: Set<string>, key: BirthdayKey): void {
  const id = `${key.month}-${key.day}`;
  if (seen.has(id)) return;
  seen.add(id);
  keys.push(key);
}

/**
 * Окно «праздник уже наступил» для выборки комнат: от `tailDays` суток назад
 * по «сейчас» включительно.
 */
export function dueOccasionKeys(
  now: Date,
  tailDays: number = OCCASION_TAIL_DAYS,
): BirthdayKey[] {
  return occasionKeysBetween(new Date(utcMidnight(now).getTime() - (tailDays + 1) * DAY_MS), now);
}
