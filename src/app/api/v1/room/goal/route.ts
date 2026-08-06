// Копилка ГЛАЗАМИ ХОЗЯЙКИ (тикет 44): прочитать свою цель, задать, убрать.
//
// Роут тонкий (CLAUDE.md): Zod и правила — в services/goal, сериализация — в
// dto/goal; здесь только сессия, коды ответов и no-store.
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: прогресса сбора, числа участников, обещанных сумм
// и имён. Инвариант №1 — прогресс своей копилки хозяйка не видит; форма ответа
// (OwnerGoalDto) этих ключей не содержит вовсе. Про движение в комнате ей
// говорит один общий счётчик /api/v1/room/taken-count, где копилка считается
// ОДНОЙ вещью при любом числе участников.
//
// Контракт:
//   GET    /api/v1/room/goal            → 200 { data: { goal: {title, amount, currency} | null } }
//   PUT    /api/v1/room/goal {title, amount, currency?} → 200 { data: { goal } }
//   DELETE /api/v1/room/goal            → 200 { data: { cleared: boolean } }
//   401 { error } — без сессии. Всегда Cache-Control: no-store.
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { GoalError, clearRoomGoal, getOwnerGoal, setRoomGoal } from "@/server/services/goal";
import { goalForOwner } from "@/server/dto/goal";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

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
    return errorResponse("VALIDATION", "проверь, на что копишь и сколько", 400);
  }
  return null;
}

/** userId сессии — цель правят только по сессии: слаг публичный. */
async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return getSessionUserId(session?.user);
}

export async function GET(): Promise<NextResponse> {
  const userId = await requireUserId();
  if (!userId) return errorResponse("AUTH", "нужна сессия — войди заново", 401);
  return NextResponse.json({ data: { goal: await getOwnerGoal(userId) } }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const userId = await requireUserId();
  if (!userId) return errorResponse("AUTH", "нужна сессия — войди заново", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION", "тело запроса — не JSON", 400);
  }

  try {
    const goal = await setRoomGoal(userId, body);
    return NextResponse.json({ data: { goal: goalForOwner(goal) } }, { headers: NO_STORE });
  } catch (error) {
    const known = mapKnownError(error);
    if (known) return known;
    throw error;
  }
}

export async function DELETE(): Promise<NextResponse> {
  const userId = await requireUserId();
  if (!userId) return errorResponse("AUTH", "нужна сессия — войди заново", 401);

  try {
    return NextResponse.json(
      { data: { cleared: await clearRoomGoal(userId) } },
      { headers: NO_STORE },
    );
  } catch (error) {
    const known = mapKnownError(error);
    if (known) return known;
    throw error;
  }
}
