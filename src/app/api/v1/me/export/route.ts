// «Скачать мои данные» (тикет 14, GDPR): один JSON-файл со всеми данными
// пользователя. Роут тонкий: auth → buildExport(userId) → attachment.
//
// Инвариант тихой брони распространяется на экспорт: имён/почт гостей
// активных броней в файле НЕТ — сервис отдаёт только {takenCount}
// (allowlist-сериализация, под тест-регексом в tests/account.test.ts).
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { buildExport } from "@/server/services/account";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) {
    return NextResponse.json(
      { error: { code: "AUTH", message: "нужна сессия — войди заново" } },
      { status: 401, headers: NO_STORE },
    );
  }

  const data = await buildExport(userId);
  if (!data) {
    // Сессия пережила пользователя (аккаунт уже удалён) — экспортировать нечего.
    return NextResponse.json(
      { error: { code: "AUTH", message: "нужна сессия — войди заново" } },
      { status: 401, headers: NO_STORE },
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="room-export-${date}.json"`,
    },
  });
}
