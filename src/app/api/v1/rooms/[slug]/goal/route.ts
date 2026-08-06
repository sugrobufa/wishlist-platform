// Копилка ГЛАЗАМИ ГОСТЯ (тикет 44): цель, прогресс сбора, «я участвую».
//
// Некэшируемый запрос ПОВЕРХ кэшируемой страницы /r/{slug} — тем же приёмом,
// что канал «занято» (тикет 08): в кэше комнаты копилки нет вовсе, и хозяйке
// её прогресс не достаётся ни через кэш, ни через HTML.
//
// ЗРИТЕЛЬ ВАЖЕН. Хозяйка, открывшая свою же ссылку, получает ответ ветки
// `owner` — цель без прогресса (services/goal.goalForRoomSlug). Иначе кнопка
// «поделиться» показывала бы ей то, чего инвариант №1 не разрешает.
//
// ДЕНЕГ ЗДЕСЬ НЕ ХОДИТ. Ни платежа, ни провайдера, ни «быстрых сумм» с доски:
// участие — это договорённость, деньги передаются напрямую, мимо сервиса
// (PRD §12а, ADR-0008).
//
// Контракт:
//   GET    /api/v1/rooms/{slug}/goal → 200 { data: { viewer, goal } }
//   POST   /api/v1/rooms/{slug}/goal {name, email?, amount?} → 201 { data: { cancelToken } }
//   DELETE /api/v1/rooms/{slug}/goal → 200 { data: { cancelled: true } }
//   404 { error } — неизвестный слаг. Всегда Cache-Control: no-store.
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getSessionUserId } from "@/server/services/rooms";
import { allowBookingAction, clientIp } from "@/server/rate-limit";
import {
  GUEST_PLEDGES_COOKIE,
  GoalError,
  addGuestPledgeToken,
  cancelPledge,
  findPledgeTokenForRoom,
  goalForRoomSlug,
  guestPledgesCookieOptions,
  parseGuestPledgeTokens,
  pledgeToGoal,
  removeGuestPledgeToken,
} from "@/server/services/goal";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Ctx = { params: Promise<{ slug: string }> };

const GOAL_ERROR_STATUS: Record<GoalError["code"], number> = {
  NO_ROOM: 404,
  ROOM_NOT_FOUND: 404,
  NO_GOAL: 404,
  OWN_GOAL: 403,
  ALREADY_PLEDGED: 409,
  TOKEN_NOT_FOUND: 404,
};

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

function mapKnownError(error: unknown): NextResponse | null {
  if (error instanceof GoalError) {
    return errorResponse(error.code, error.message, GOAL_ERROR_STATUS[error.code]);
  }
  if (error instanceof ZodError) {
    return errorResponse("VALIDATION", "проверь имя и сумму", 400);
  }
  return null;
}

/** Токены участия гостя из его cookie (HTTP-only, JSON-массив). */
function guestTokens(request: NextRequest): string[] {
  return parseGuestPledgeTokens(request.cookies.get(GUEST_PLEDGES_COOKIE)?.value);
}

/**
 * userId сессии БЕЗ требования сессии — тот же ленивый auth, что в роутах
 * брони и визита: `@/server/auth` живёт только в runtime Next (request-scope),
 * а вне его — vitest зовёт роут напрямую — зритель честно считается анонимом.
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

function withPledgeCookie(response: NextResponse, tokens: string[]): NextResponse {
  response.cookies.set(GUEST_PLEDGES_COOKIE, JSON.stringify(tokens), guestPledgesCookieOptions());
  return response;
}

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { slug } = await params;
  const channel = await goalForRoomSlug(slug, guestTokens(request), {
    viewerUserId: await optionalSessionUserId(),
  });
  if (!channel) return errorResponse("ROOM_NOT_FOUND", "такой комнаты нет", 404);
  return NextResponse.json({ data: channel }, { headers: NO_STORE });
}

/** «Я участвую» → 201 {data:{cancelToken}}; токен уходит и в HTTP-only cookie. */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await allowBookingAction(clientIp(request.headers)))) {
    return errorResponse("RATE_LIMITED", "слишком часто — попробуй через минуту", 429);
  }

  const { slug } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION", "тело запроса — не JSON", 400);
  }

  const tokens = guestTokens(request);
  try {
    const { cancelToken } = await pledgeToGoal(slug, body, {
      // sessionUserId — только из сессии: телу гостя это поле не доверяется.
      sessionUserId: await optionalSessionUserId(),
      tokens,
    });
    return withPledgeCookie(
      NextResponse.json({ data: { cancelToken } }, { status: 201, headers: NO_STORE }),
      addGuestPledgeToken(tokens, cancelToken),
    );
  } catch (error) {
    const known = mapKnownError(error);
    if (known) return known;
    throw error;
  }
}

/** «Передумал» → 200. Токена в запросе нет: сервер находит свой в cookie. */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await allowBookingAction(clientIp(request.headers)))) {
    return errorResponse("RATE_LIMITED", "слишком часто — попробуй через минуту", 429);
  }

  const { slug } = await params;
  const tokens = guestTokens(request);
  const token = await findPledgeTokenForRoom(slug, tokens);
  if (!token) return errorResponse("NO_PLEDGE", "твоего участия здесь нет", 404);

  try {
    await cancelPledge(token);
  } catch (error) {
    const known = mapKnownError(error);
    if (known) return known;
    throw error;
  }
  return withPledgeCookie(
    NextResponse.json({ data: { cancelled: true } }, { headers: NO_STORE }),
    removeGuestPledgeToken(tokens, token),
  );
}
