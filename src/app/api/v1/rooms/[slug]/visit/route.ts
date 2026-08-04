// Пинг визита гостевой комнаты (тикет 11): POST /api/v1/rooms/{slug}/visit.
// Auth ОПЦИОНАЛЕН: без сессии — 204 no-op (аноним не «смотрел» — связи без
// человека не бывает), с сессией — recordVisit пишет/обновляет связь VIEWED
// у хозяйки (дедуп пары и зеркала, спам-заслон 1/час — в сервисе).
//
// HTML комнаты одинаков для всех (инвариант кэшируемости, тикет 07): пинг —
// отдельный некэшируемый запрос ПОСЛЕ рендера (booking-context, fire-and-forget).
// Никакого тела, никакого ответа с данными: гостю не сообщается ничего.
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUserId } from "@/server/services/rooms";
import { recordVisitBySlug } from "@/server/services/connections";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Ctx = { params: Promise<{ slug: string }> };

/** userId сессии без требования сессии — тот же ленивый auth, что в роуте
 * брони (тикет 11): вне runtime Next гость честно считается анонимом. */
async function optionalSessionUserId(): Promise<string | null> {
  try {
    const { auth } = await import("@/server/auth");
    const session = await auth();
    return await getSessionUserId(session?.user);
  } catch {
    return null; // вне request-scope (vitest) или без сессии — аноним
  }
}

export async function POST(_request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { slug } = await params;

  const viewerUserId = await optionalSessionUserId();
  if (!viewerUserId) {
    // Аноним: визит не событие. 204 и тишина — без различий в поведении
    // страницы для гостей с сессией и без.
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }

  const found = await recordVisitBySlug(viewerUserId, slug);
  if (!found) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "такой комнаты нет" } },
      { status: 404, headers: NO_STORE },
    );
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
