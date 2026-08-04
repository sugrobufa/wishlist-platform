// Канал «занято» гостевой комнаты (тикет 08): лёгкий НЕкэшируемый запрос
// ПОВЕРХ кэшируемой страницы /r/{slug} — брони не живут ни в каком кэше
// (инвариант №1, решение тикета 07).
//
// Контракт (для тикетов 09/15):
//   GET /api/v1/rooms/{slug}/taken →
//   200 { data: { itemIds: string[]   — занятые вещи комнаты, ТОЛЬКО id, без имён;
//                 mine: string[]      — какие из них заняты ЭТИМ гостем (по его cookie);
//                 myBookingsCount: number — всего живых броней гостя, для «Мои брони · N» } }
//   404 { error } — неизвестный слаг. Всегда Cache-Control: no-store.
import { NextResponse, type NextRequest } from "next/server";
import {
  countBookingsByTokens,
  GUEST_BOOKINGS_COOKIE,
  parseGuestBookingTokens,
  takenForRoomSlug,
} from "@/server/services/bookings";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { slug } = await params;
  const tokens = parseGuestBookingTokens(request.cookies.get(GUEST_BOOKINGS_COOKIE)?.value);

  const taken = await takenForRoomSlug(slug, tokens);
  if (!taken) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "такой комнаты нет" } },
      { status: 404, headers: NO_STORE },
    );
  }

  const myBookingsCount = await countBookingsByTokens(tokens);
  return NextResponse.json(
    { data: { itemIds: taken.itemIds, mine: taken.mine, myBookingsCount } },
    { headers: NO_STORE },
  );
}
