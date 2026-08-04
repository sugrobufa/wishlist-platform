// POST /api/v1/parse (тикет 06): {url} → ParsedProduct для предзаполнения
// карточки добавления. Только для владельцев с сессией (auth-only): гостям
// парсер не нужен, а нам не нужен открытый SSRF-прокси.
//
// Роут тонкий (CLAUDE.md): весь конвейер (normalize → кэш → per-domain
// bucket → safeFetch → fastPath → zoneHint) — в src/server/parser.parseUrl;
// неудачный разбор — не ошибка, а «честная карточка» {domain, canonicalUrl,
// confidence: 0.1} (user story 9), поэтому 200 почти всегда.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { ParserError, parseUrl } from "@/server/parser";
import { getParseLimiter } from "./limiter";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ url: z.string().trim().min(1).max(2048) });

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return errorResponse("AUTH", "нужна сессия — войди заново", 401);

  const limiter = await getParseLimiter();
  if (!(await limiter.allow(userId))) {
    return errorResponse("RATE_LIMITED", "слишком часто — подожди минуту", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION", "тело запроса — не JSON", 400);
  }
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return errorResponse("VALIDATION", "нужно поле url строкой", 400);
  }

  try {
    const product = await parseUrl(parsedBody.data.url);
    return NextResponse.json({ data: product });
  } catch (error) {
    if (error instanceof ParserError && error.code === "invalid-url") {
      return errorResponse("INVALID_URL", "ссылка не похожа на адрес страницы товара", 422);
    }
    if (error instanceof ParserError && error.code === "rate-limited") {
      // per-domain bucket парсера: магазин и так под нагрузкой
      return errorResponse("RATE_LIMITED", "к этому магазину слишком часто — подожди минуту", 429);
    }
    throw error;
  }
}
