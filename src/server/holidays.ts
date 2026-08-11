// Праздники, которых не один (тикет 198, пакет 44 → `occasions.json`, турн 51e).
//
// ПРИНЦИП ПАКЕТА: **праздник не заводят — его принимают или нет.** Новый год,
// 8 марта и 23 февраля у всех в один день, и спрашивать про них нечего:
// продукт знает дату сам. Значит вопрос не «когда», а «показывать ли», и задать
// его можно тогда, когда он живой — за три недели до даты.
//
// МОДУЛЬ СТОИТ НА ТИКЕТЕ 187, А НЕ РЯДОМ С НИМ. Вся арифметика повторяющейся
// даты уже живёт в `birthday.ts` (полночь UTC, «ближайшее вхождение от
// сегодня», 29 февраля в невисокосный год — 28-го). Общая дата — та же
// повторяющаяся дата без года, поэтому здесь нет ни одной своей календарной
// формулы: `occasionInYear` и `nextOccasion` зовутся как есть. Второй календарь
// разъехался бы с первым на первом же високосном году.
//
// БЕЗ БД, БЕЗ REACT И БЕЗ NEXT — как и сосед: правила проверяются тестом
// (tests/occasion-offer.test.ts), а не прокликиванием комнаты.
import { isBirthday, nextOccasion, type Birthday } from "@/server/birthday";

/**
 * Ключ общей даты. Три штуки, список закрыт пакетом
 * (`occasions.json → threeKinds.common.list`).
 */
export type HolidayKey = "newYear" | "feb23" | "march8";

/** Общая дата: ключ и её день в календаре. Года у неё нет — она повторяется. */
export type CommonHoliday = {
  key: HolidayKey;
  month: number;
  day: number;
};

/**
 * ВСЕ ТРИ — ВСЕМ, И 8 МАРТА С 23 ФЕВРАЛЯ ТОЖЕ.
 *
 * Соблазн выбрать праздник по полу пакет называет вслух и отвергает, и довод
 * совпадает с нашим: **пол в продукте — предустановка набора зон, а не свойство
 * человека**. Продукт не знает, кто в комнате; в положении «Все 10» набор не
 * говорит о человеке ничего. Цена правила — одно нажатие «Не в этом году» раз в
 * год, и она дешевле неверной догадки о человеке.
 *
 * Отсюда устройство модуля: **предложение не получает НИ комнаты, НИ набора
 * зон, НИ пола — их неоткуда прочитать** (`holidayOffer` принимает «сегодня» и
 * прежние ответы, и всё). Это заведено тестом, а не только кодом: иначе первая
 * же «оптимизация» вернула бы догадку о человеке.
 */
export const COMMON_HOLIDAYS: readonly CommonHoliday[] = [
  { key: "newYear", month: 1, day: 1 },
  { key: "feb23", month: 2, day: 23 },
  { key: "march8", month: 3, day: 8 },
];

/**
 * За сколько суток до даты приходит плашка — три недели
 * (`occasions.json → threeKinds.common.how`).
 *
 * Окно ПОЛУОТКРЫТОЕ: `1 ≤ left ≤ 21`. Ровно за 21 сутки плашка появляется,
 * за 22 её ещё нет, а в сам день праздника уже нет: предложение «показать
 * гостям, что комната ждёт подарков», сделанное утром праздника, опоздало —
 * гостям по нему уже не успеть.
 */
export const OFFER_LEAD_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Общая дата как повторяющаяся дата тикета 187: день, месяц, года нет. */
function asRepeating(holiday: CommonHoliday): Birthday {
  return { day: holiday.day, month: holiday.month, year: null };
}

/** Полночь UTC этого дня — тот же пояс, которым праздник живёт везде. */
function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Ближайшее вхождение общей даты от «сегодня», полночь UTC. */
export function nextHoliday(holiday: CommonHoliday, now: Date): Date {
  return nextOccasion(asRepeating(holiday), now);
}

/** Сколько ПОЛНЫХ суток осталось до даты. Сегодняшняя дата — ноль. */
export function daysUntil(date: Date, now: Date): number {
  return Math.round((utcMidnight(date).getTime() - utcMidnight(now).getTime()) / DAY_MS);
}

/**
 * Прежний ответ хозяйки про одну общую дату. Двух ответов у одной даты не
 * бывает: «Показать» — насовсем, «Не в этом году» — до следующего года.
 */
export type HolidayAnswer = {
  key: HolidayKey;
  /** true — «Показать»: дата принята и живёт в комнате как день рождения. */
  accepted: boolean;
  /**
   * Год ПРАЗДНИКА, на который сказано «Не в этом году»; null — не отказывались.
   *
   * Хранится год самой даты, а не год нажатия, и это не придирка: Новый год
   * предлагается в декабре, а случается в январе — год нажатия увёл бы отказ
   * не на тот праздник и вернул бы плашку через две недели.
   */
  skippedYear: number | null;
};

/** Что показывает плашка предложения. */
export type HolidayOffer = {
  holiday: CommonHoliday;
  /** Дата этого праздника, полночь UTC. */
  date: Date;
  /** Сколько суток до неё — число для строки «Через {left} {holiday}». */
  daysLeft: number;
};

/**
 * КАКУЮ ОБЩУЮ ДАТУ ПРЕДЛАГАТЬ ПРЯМО СЕЙЧАС — или ни одной.
 *
 * Аргументов ровно два, и это главное свойство функции: «сегодня» и прежние
 * ответы. Ни комнаты, ни набора зон, ни пола — предлагать их сюда не через что
 * (см. `COMMON_HOLIDAYS`).
 *
 * Дата отпадает, если:
 * - до неё дальше трёх недель или она уже сегодня (окно `OFFER_LEAD_DAYS`);
 * - её уже приняли — она в комнате, предлагать нечего;
 * - на ЭТОТ её год сказано «Не в этом году» — молчим до следующего.
 *
 * Из оставшихся берётся ближайшая: двух плашек разом не бывает — 23 февраля и
 * 8 марта стоят в тринадцати сутках друг от друга, и их окна пересекаются.
 */
export function holidayOffer(now: Date, answers: readonly HolidayAnswer[]): HolidayOffer | null {
  const answerOf = new Map(answers.map((answer) => [answer.key, answer] as const));

  const offers = COMMON_HOLIDAYS.flatMap((holiday) => {
    const answer = answerOf.get(holiday.key);
    if (answer?.accepted) return [];
    const date = nextHoliday(holiday, now);
    const daysLeft = daysUntil(date, now);
    if (daysLeft < 1 || daysLeft > OFFER_LEAD_DAYS) return [];
    if (answer?.skippedYear === date.getUTCFullYear()) return [];
    return [{ holiday, date, daysLeft }];
  });

  return offers.reduce<HolidayOffer | null>(
    (nearest, offer) => (nearest === null || offer.daysLeft < nearest.daysLeft ? offer : nearest),
    null,
  );
}

// ---------------------------------------------------------------------------
// Ближайший праздник — тот единственный, что виден в комнате
// ---------------------------------------------------------------------------
//
// «Список из пяти праздников в комнате — та же анкета, только показанная вместо
// спрошенной» (`occasions.json → inRoom.why`). Поэтому комната показывает РОВНО
// ОДИН — ближайший, полоской в кадре; остальные живут списком в настройках.

/** Откуда праздник взялся: спросили, приняли или завели своей рукой. */
export type OccasionKind = "birthday" | "common" | "own";

/**
 * Праздник комнаты в том виде, в каком его сравнивают между собой: день, месяц
 * и откуда он. Имени здесь нет — его знает словарь (общие даты) или сама
 * хозяйка (свой повод), а сравнивать праздники по имени незачем.
 */
export type RoomOccasion = {
  kind: OccasionKind;
  /** Ключ общей даты; null у дня рождения и у своего повода. */
  key: HolidayKey | null;
  /** Имя своего повода; null у дня рождения и у общей даты. */
  title: string | null;
  day: number;
  month: number;
};

/** Праздник с посчитанной ближайшей датой. */
export type DatedOccasion = RoomOccasion & { date: Date };

/**
 * БЛИЖАЙШИЙ ПРАЗДНИК КОМНАТЫ — ровно один при любом их числе, или null, когда
 * праздников нет вовсе (день рождения пропущен, общих не приняли, своих не
 * завели — законное состояние).
 *
 * Считается тем же `nextOccasion`, что и день рождения: у каждого праздника
 * берётся ближайшее вхождение от сегодня, и из них — самое раннее. Ничьей
 * между двумя праздниками одного дня быть не может по построению порядка:
 * при равных датах остаётся первый по списку, а список приходит из БД в
 * устойчивом порядке.
 *
 * Дня рождения 29 февраля это касается наравне с прочими: `occasionInYear`
 * переносит его на 28-е в невисокосный год, и в сравнение он входит уже
 * перенесённым.
 */
export function nearestOccasion(
  occasions: readonly RoomOccasion[],
  now: Date,
): DatedOccasion | null {
  return occasions.reduce<DatedOccasion | null>((nearest, occasion) => {
    if (!isBirthday({ day: occasion.day, month: occasion.month })) return nearest;
    const date = nextOccasion({ day: occasion.day, month: occasion.month, year: null }, now);
    if (nearest === null || date.getTime() < nearest.date.getTime()) return { ...occasion, date };
    return nearest;
  }, null);
}

/**
 * Длина своего имени повода. Живёт здесь, а не в сервисе, потому что число
 * нужно ОБОИМ берегам: полю ввода (`maxLength`) и проверке на записи. Модуль
 * без БД читается и с клиента — тем же путём, каким `birthday.daysInMonth`
 * читает выбор дня рождения.
 */
export const OWN_TITLE_MAX = 60;

/** Есть ли такой ключ среди общих дат: строка из браузера сюда не доедет. */
export function isHolidayKey(value: unknown): value is HolidayKey {
  return COMMON_HOLIDAYS.some((holiday) => holiday.key === value);
}

/** Общая дата по ключу; null — ключа нет. */
export function holidayByKey(key: string): CommonHoliday | null {
  return COMMON_HOLIDAYS.find((holiday) => holiday.key === key) ?? null;
}
