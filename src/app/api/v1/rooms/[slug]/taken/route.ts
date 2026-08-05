// Канал «занято» гостевой комнаты (тикет 08): лёгкий НЕкэшируемый запрос
// ПОВЕРХ кэшируемой страницы /r/{slug} — брони не живут ни в каком кэше
// (инвариант №1, решение тикета 07).
//
// Тикет 41 добавил сюда ЗРИТЕЛЯ. Страница /r/{slug} сессию не читает и читать
// не будет (полностраничный ISR, шапка page.tsx) — а этот роут некэшируем и
// может: если вошедший — хозяйка ЭТОЙ комнаты, ответ такой, будто не занято
// ничего. Иначе «поделиться» показывало бы ей поимённо, какие её вещи забрали.
// Правка живёт целиком здесь и в сервисе; ISR не тронут.
//
// Контракт (для тикетов 09/15):
//   GET /api/v1/rooms/{slug}/taken →
//   200 { data: { itemIds: string[]   — занятые вещи комнаты, ТОЛЬКО id, без имён;
//                 mine: string[]      — какие из них заняты ЭТИМ гостем (по его cookie);
//                 myBookingsCount: number — всего живых броней гостя, для «Мои подарки · N» } }
//   200 { data: { itemIds: [], mine: [], myBookingsCount: 0 } } — хозяйке этой комнаты
//   404 { error } — неизвестный слаг. Всегда Cache-Control: no-store.
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUserId } from "@/server/services/rooms";
import {
  GUEST_BOOKINGS_COOKIE,
  parseGuestBookingTokens,
  takenForRoomSlug,
} from "@/server/services/bookings";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Ctx = { params: Promise<{ slug: string }> };

/**
 * userId сессии БЕЗ требования сессии — тот же ленивый auth, что в роутах
 * брони и визита (тикеты 08/11): `@/server/auth` живёт только в runtime Next
 * (request-scope), а вне его — vitest зовёт роут напрямую — зритель честно
 * считается анонимом, и гостевой канал работает как раньше.
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

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { slug } = await params;
  const tokens = parseGuestBookingTokens(request.cookies.get(GUEST_BOOKINGS_COOKIE)?.value);

  // Роут тонкий (CLAUDE.md): развилку «хозяйка/гость» и всю сборку ответа
  // держит сервис — одно место, где решается, что зритель узнаёт о бронях.
  const taken = await takenForRoomSlug(slug, tokens, {
    viewerUserId: await optionalSessionUserId(),
  });
  if (!taken) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "такой комнаты нет" } },
      { status: 404, headers: NO_STORE },
    );
  }

  return NextResponse.json({ data: taken }, { headers: NO_STORE });
}
