// «Остаться в связях?» — ответ гостя на подтверждении брони (тикет 98b,
// доска 32a). Токен клиент не присылает — сервер находит его в cookie, как
// у соседнего «куплено».
//
// Этой же дверью гость ПЕРЕДУМЫВАЕТ из «Моих подарков» (хвост 98b): ответ
// один на пару гость↔хозяйка, значит и роут на оба случая один. Срок ответа
// сторожит сервис — после праздника он отвечает OCCASION_PASSED.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allowBookingAction, clientIp } from "@/server/rate-limit";
import {
  BookingError,
  findTokenForItem,
  GUEST_BOOKINGS_COOKIE,
  offerConnection,
  parseGuestBookingTokens,
} from "@/server/services/bookings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Тело опционально: пустой POST означает «да, предложить». */
const bodySchema = z.object({ offers: z.boolean().default(true) });

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
    raw = {};
  }
  const parsed = bodySchema.safeParse(typeof raw === "object" && raw !== null ? raw : {});
  if (!parsed.success) {
    return errorResponse("VALIDATION", "offers — true или false", 400);
  }

  const tokens = parseGuestBookingTokens(request.cookies.get(GUEST_BOOKINGS_COOKIE)?.value);
  const token = await findTokenForItem(id, tokens);
  if (!token) {
    return errorResponse("NO_BOOKING", "твоей брони на этой вещи нет", 404);
  }

  try {
    await offerConnection(token, parsed.data.offers);
  } catch (error) {
    if (error instanceof BookingError) {
      // Праздник уже прошёл — это не «не нашли», а «поздно» (хвост 98b).
      return errorResponse(error.code, error.message, error.code === "OCCASION_PASSED" ? 409 : 404);
    }
    throw error;
  }
  return NextResponse.json({ data: { offers: parsed.data.offers } });
}
