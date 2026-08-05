// Переход гостя в магазин (тикет 37): POST /api/v1/items/{id}/outbound.
// Роут тонкий (CLAUDE.md): правила записи — в services/outbound, здесь только
// rate limit по IP и коды ответов.
//
// Ответ ВСЕГДА 204 — и когда переход записан, и когда нет. Разные коды на
// «вещь есть» и «вещи нет» превратили бы этот роут в способ проверить, живёт
// ли в комнате спрятанная вещь с таким id (инвариант №5). Гостю здесь не
// сообщается ничего: он в этот момент уже открывает магазин.
import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/server/rate-limit";
import {
  allowOutboundClick,
  outboundClickSchema,
  recordOutboundClick,
} from "@/server/services/outbound";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await allowOutboundClick(clientIp(request.headers)))) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "слишком часто — попробуй через минуту" } },
      { status: 429, headers: NO_STORE },
    );
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // itemId — только из URL: тело его не подменит (спред раньше поля).
  const parsed = outboundClickSchema.safeParse({
    ...(typeof body === "object" && body !== null ? body : {}),
    itemId: id,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "проверь вещь и место перехода" } },
      { status: 400, headers: NO_STORE },
    );
  }

  await recordOutboundClick(parsed.data);
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
