// Счётчик хозяйки «N вещей уже забраны» (тикет 09) — единственный канал,
// которым хозяйка видит движение в комнате до праздника (инвариант №1):
// одно число, без id вещей и тем более без имён.
//
// Канал сознательно ОТДЕЛЬНЫЙ от гостевого /api/v1/rooms/{slug}/taken —
// тот отдаёт id занятых вещей, которые хозяйке видеть нельзя. И сознательно
// НЕкэшируемый (spec: «счётчик — отдельный некэшируемый GET /room/taken-count»):
// force-dynamic + Cache-Control: no-store — число не оседает ни в одном кэше.
//
// Роут тонкий: auth → ownerTakenCount(userId) → {data:{takenCount}};
// вся логика (и инвариантные тесты) — в services/bookings.
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { ownerTakenCount } from "@/server/services/bookings";

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

  // Нет комнаты — честный 0 (сервис), отдельного 404 у счётчика нет.
  const takenCount = await ownerTakenCount(userId);
  return NextResponse.json({ data: { takenCount } }, { headers: NO_STORE });
}
