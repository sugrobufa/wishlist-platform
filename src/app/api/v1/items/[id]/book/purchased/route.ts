// Отметка «куплено» на своей брони (тикет 08). Переключатель: {purchased:false}
// снимает отметку. Токен клиент не присылает — сервер находит его в cookie.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allowBookingAction, clientIp } from "@/server/rate-limit";
import {
  BookingError,
  findTokenForItem,
  GUEST_BOOKINGS_COOKIE,
  markPurchased,
  parseGuestBookingTokens,
} from "@/server/services/bookings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Тело опционально: пустой POST означает «куплено». */
const bodySchema = z.object({ purchased: z.boolean().default(true) });

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await allowBookingAction(clientIp(request.headers)))) {
    return errorResponse("RATE_LIMITED", "слишком часто — попробуй через минуту", 429);
  }

  const { id } = await params;
  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    raw = {}; // тела нет — дефолт «куплено»
  }
  const parsed = bodySchema.safeParse(typeof raw === "object" && raw !== null ? raw : {});
  if (!parsed.success) {
    return errorResponse("VALIDATION", "purchased — true или false", 400);
  }

  const tokens = parseGuestBookingTokens(request.cookies.get(GUEST_BOOKINGS_COOKIE)?.value);
  const token = await findTokenForItem(id, tokens);
  if (!token) {
    return errorResponse("NO_BOOKING", "твоей брони на этой вещи нет", 404);
  }

  try {
    await markPurchased(token, parsed.data.purchased);
  } catch (error) {
    if (error instanceof BookingError) {
      return errorResponse(error.code, error.message, 404);
    }
    throw error;
  }
  return NextResponse.json({ data: { purchased: parsed.data.purchased } });
}
