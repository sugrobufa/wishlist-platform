// Разбор отказа брони: код сервера → строка, которую человек может понять.
// Чистый модуль отдельно от диалога — ровно затем, чтобы накрыть тестом
// (тот же приём, что у components/zone/tile-appearance.ts).
//
// ЗАЧЕМ ЭТО ПОЯВИЛОСЬ (тикет 76). В диалоге стояла лестница по HTTP-статусу:
// 409 → «занято», 429 → «часто», 400 → «проверь имя», ВСЁ ОСТАЛЬНОЕ →
// «Не получилось — попробуй ещё раз». В «остальное» попадал 403 `OWN_ITEM`,
// и владелец на приёмке 07.08 упёрся именно в него: вошёл на стенд под собой,
// открыл свою же комнату по гостевой ссылке и получил безымянный отказ.
// Сервер при этом отвечал прямым текстом «это твоя вещь» — мы его выбрасывали.
//
// Статуса мало и по второй причине: 409 несут ДВА разных случая —
// `ALREADY_BOOKED` («кто-то успел раньше») и `IN_HALL` («вещь уже своя»).
// По статусу их не различить, по коду видно сразу.

export type BookingErrorKey = "taken" | "rate" | "validation" | "own" | "gone" | "generic";

/** Ключ отказа → ключ строки в словаре (ns Booking). */
export const BOOKING_ERROR_MESSAGE: Record<BookingErrorKey, string> = {
  taken: "errTaken",
  rate: "errRate",
  validation: "errValidation",
  own: "errOwn",
  gone: "errGone",
  generic: "errGeneric",
};

/**
 * Коды роута `app/api/v1/items/[id]/book` (его `BOOKING_ERROR_STATUS` плюс
 * `RATE_LIMITED` и `VALIDATION`). Список закрытый: незнакомый код честно
 * падает в `generic`, а не притворяется знакомым.
 */
const BY_CODE: Record<string, BookingErrorKey> = {
  OWN_ITEM: "own",
  ALREADY_BOOKED: "taken",
  RATE_LIMITED: "rate",
  VALIDATION: "validation",
  NOT_FOUND: "gone",
  IN_HALL: "gone",
  DEMO_ITEM: "gone",
  POOL_NOT_SUPPORTED: "gone",
  TOKEN_NOT_FOUND: "gone",
};

/**
 * Какой отказ показать. Код точнее статуса и идёт первым; статус остаётся
 * запасным путём — тело может не доехать (прокси, 502, обрыв).
 *
 * @param code `error.code` из тела ответа; null, если тело не JSON.
 */
export function bookingErrorKey(code: string | null, status: number): BookingErrorKey {
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (status === 409) return "taken";
  if (status === 429) return "rate";
  if (status === 400) return "validation";
  return "generic";
}

/** Помечать ли вещь занятой в общем состоянии гостя. Только «успели раньше». */
export function marksItemTaken(key: BookingErrorKey): boolean {
  return key === "taken";
}
