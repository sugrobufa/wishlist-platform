// Что мы уже знаем о человеке к началу онбординга (тикет 38, турн 12c).
//
// Холодный гость приходит в чужую комнату, тихо занимает подарок — и в этот
// момент называет о себе две вещи: имя (обязательное поле брони) и, если
// захочет, день рождения (вопрос предложения «А когда твой день рождения?»).
// Спрашивать их ВТОРОЙ раз в онбординге было бы невежливо: человек только что
// их напечатал.
//
// ПОЧЕМУ COOKIE, А НЕ ЗАПРОС В БАЗУ. Имя лежит в `Booking.guestName`, и
// достать его по токенам из `guest_bookings` технически можно. Но это значило
// бы завести в сервисе броней вторую функцию, отдающую имена гостей наружу, —
// ровно то, чего инвариант №1 избегает тем, что таких функций нет вовсе
// (`MyBookingDto` собран allowlist'ом БЕЗ guestName/guestEmail, и это записано
// в шапке services/bookings.ts). Здесь же данные не «достаются из брони», а
// едут в браузере самого человека, который их и напечатал: cookie ставит его
// собственное нажатие «Собрать свою комнату», читает её только его же
// онбординг, и хозяйке она не видна ни при каком стечении обстоятельств.
//
// Кто пишет: `src/app/r/[slug]/booking/offer-actions.ts` (предложение после
// брони). Кто читает и СРАЗУ гасит: `src/app/onboarding/page.tsx` и
// `actions.ts` — предзаполнение одноразовое, второй онбординг начнётся с
// чистого листа.
//
// Модуль намеренно без React, без БД и без next/headers: правила разбора
// проверяются тестом (guest-intro.test.ts), а не прокликиванием формы.
import { readOccasionDate } from "./occasion-date";

/** Имя cookie. Соседка `guest_bookings` (тикет 08) живёт своей жизнью. */
export const GUEST_INTRO_COOKIE = "guest_intro";

/**
 * Сутки. Предзаполнение — вежливость на один заход («забронировал → пришло
 * письмо → собрал комнату»), а не профиль человека: жить дольше ему незачем.
 */
export const GUEST_INTRO_MAX_AGE = 24 * 60 * 60;

/** Тот же предел, что у имени в брони (services/bookings.bookItemInputSchema). */
const NAME_MAX = 120;

export type GuestIntro = {
  /** Имя из брони — предзаполняет «Как тебя зовут» на последнем шаге. */
  name: string | null;
  /** День рождения `YYYY-MM-DD` — предзаполняет дату праздника (тикет 43). */
  occasionDate: string | null;
};

/** Пусто: ни имени, ни даты. Форма одна, чтобы вызывающим не гадать про null. */
export const EMPTY_GUEST_INTRO: GuestIntro = { name: null, occasionDate: null };

/** Есть ли что предзаполнять. Пустое — cookie не ставим и не храним. */
export function hasGuestIntro(intro: GuestIntro): boolean {
  return intro.name !== null || intro.occasionDate !== null;
}

function readName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, NAME_MAX);
  return value === "" ? null : value;
}

/**
 * Значение cookie из того, что напечатал человек. Дата проходит тот же
 * разбор, что поле онбординга (`readOccasionDate`): «завтра», момент времени
 * и 31 февраля до шага не доезжают.
 */
export function serializeGuestIntro(intro: {
  name?: unknown;
  occasionDate?: unknown;
}): string {
  const value: GuestIntro = {
    name: readName(intro.name),
    occasionDate: readOccasionDate(intro.occasionDate),
  };
  return JSON.stringify({ n: value.name, d: value.occasionDate });
}

/**
 * Разбор значения cookie. Cookie — это ввод: любой мусор (не JSON, не объект,
 * числа вместо строк, гигантское имя) молча превращается в «ничего не
 * известно», и онбординг открывается как обычно. Уронить его чужой cookie
 * нельзя.
 */
export function parseGuestIntro(raw: string | null | undefined): GuestIntro {
  if (!raw) return EMPTY_GUEST_INTRO;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_GUEST_INTRO;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return EMPTY_GUEST_INTRO;
  }
  const record = parsed as { n?: unknown; d?: unknown };
  return {
    name: readName(record.n),
    occasionDate: readOccasionDate(record.d),
  };
}

/** Опции cookie — одни и те же у того, кто ставит, и у того, кто гасит. */
export function guestIntroCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_INTRO_MAX_AGE,
  } as const;
}
