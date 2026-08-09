// Тихая бронь вещи гостем (тикет 08): занять и отменить.
// Роут тонкий (CLAUDE.md): Zod и правила — в services/bookings; здесь —
// rate limit по IP, cookie `guest_bookings` и коды ответов.
// Никаких уведомлений хозяйке и никакой инвалидации кэша комнаты — бронь
// не существует в кэшируемых данных (инвариант №1).
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getSessionUserId } from "@/server/services/rooms";
import { allowBookingAction, clientIp } from "@/server/rate-limit";
import {
  addGuestBookingToken,
  BookingError,
  bookItem,
  cancelBooking,
  findTokenForItem,
  GUEST_BOOKINGS_COOKIE,
  guestBookingsCookieOptions,
  parseGuestBookingTokens,
  removeGuestBookingToken,
} from "@/server/services/bookings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const BOOKING_ERROR_STATUS: Record<BookingError["code"], number> = {
  NOT_FOUND: 404,
  DEMO_ITEM: 400,
  NOT_WANT: 409,
  OWN_ITEM: 403,
  ALREADY_BOOKED: 409,
  // Срок впечатления вышел (тикет 97) — тот же класс, что «уже занято»:
  // вещь есть, но взять её нельзя.
  EXPIRED: 409,
  POOL_NOT_SUPPORTED: 400,
  TOKEN_NOT_FOUND: 404,
};

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function rateLimited(): NextResponse {
  return errorResponse("RATE_LIMITED", "слишком часто — попробуй через минуту", 429);
}

function mapKnownError(error: unknown): NextResponse | null {
  if (error instanceof BookingError) {
    return errorResponse(error.code, error.message, BOOKING_ERROR_STATUS[error.code]);
  }
  if (error instanceof ZodError) {
    return errorResponse("VALIDATION", "проверь имя, почту и режим брони", 400);
  }
  return null;
}

/** Токены гостя из его cookie (HTTP-only, JSON-массив). */
function guestTokens(request: NextRequest): string[] {
  return parseGuestBookingTokens(request.cookies.get(GUEST_BOOKINGS_COOKIE)?.value);
}

/**
 * userId сессии БЕЗ требования сессии (тикет 11): гость-аноним бронирует как
 * раньше, залогиненный получает booking.guestUserId — семя будущей связи.
 * auth импортируется лениво и под try/catch: он живёт только в runtime Next
 * (request-scope); вне его — vitest зовёт роут напрямую — гость честно
 * считается анонимом, и тихая бронь работает как раньше.
 */
async function optionalSessionUserId(): Promise<string | null> {
  try {
    const { auth } = await import("@/server/auth");
    const session = await auth();
    return await getSessionUserId(session?.user);
  } catch {
    return null;
  }
}

/** Ответ с обновлённой cookie гостя — опции всегда одни и те же. */
function withGuestCookie(response: NextResponse, tokens: string[]): NextResponse {
  response.cookies.set(GUEST_BOOKINGS_COOKIE, JSON.stringify(tokens), guestBookingsCookieOptions());
  return response;
}

/**
 * POST /api/v1/items/{id}/book {name, email?, mode?} → 201 {data:{cancelToken}}.
 * Токен дополнительно кладётся в HTTP-only cookie `guest_bookings` — «мои
 * брони» работают без всякой регистрации.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await allowBookingAction(clientIp(request.headers)))) return rateLimited();

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION", "тело запроса — не JSON", 400);
  }

  try {
    // itemId — только из URL: тело его не подменит (спред раньше поля).
    // sessionUserId — только из сессии: телу гостя это поле не доверяется.
    const { cancelToken } = await bookItem(
      {
        ...(typeof body === "object" && body !== null ? body : {}),
        itemId: id,
      },
      { sessionUserId: await optionalSessionUserId() },
    );
    const tokens = addGuestBookingToken(guestTokens(request), cancelToken);
    return withGuestCookie(
      NextResponse.json({ data: { cancelToken } }, { status: 201 }),
      tokens,
    );
  } catch (error) {
    const known = mapKnownError(error);
    if (known) return known;
    throw error;
  }
}

/**
 * DELETE /api/v1/items/{id}/book → 200 {data:{cancelled:true}}.
 * Токена в запросе нет: сервер сам находит подходящий токен вещи среди
 * токенов cookie гостя. Чужую бронь так не снять — своего токена на неё нет.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await allowBookingAction(clientIp(request.headers)))) return rateLimited();

  const { id } = await params;
  const tokens = guestTokens(request);
  const token = await findTokenForItem(id, tokens);
  if (!token) {
    return errorResponse("NO_BOOKING", "твоей брони на этой вещи нет", 404);
  }

  try {
    await cancelBooking(token);
  } catch (error) {
    const known = mapKnownError(error);
    if (known) return known;
    throw error;
  }
  return withGuestCookie(
    NextResponse.json({ data: { cancelled: true } }),
    removeGuestBookingToken(tokens, token),
  );
}
