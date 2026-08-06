// Счётчик хозяйки «N вещей уже забраны» (тикет 09) — единственный канал,
// которым хозяйка видит движение в комнате до праздника (инвариант №1):
// одно число, без id вещей и тем более без имён.
//
// Канал сознательно ОТДЕЛЬНЫЙ от гостевого /api/v1/rooms/{slug}/taken —
// тот отдаёт id занятых вещей, которые хозяйке видеть нельзя. И сознательно
// НЕкэшируемый (spec: «счётчик — отдельный некэшируемый GET /room/taken-count»):
// force-dynamic + Cache-Control: no-store — число не оседает ни в одном кэше.
//
// Роут тонкий: auth → ownerTakenTotal(userId) → {data:{takenCount}};
// вся логика (и инвариантные тесты) — в сервисах.
//
// Слагаемых у числа два (тикет 44): занятые вещи (services/bookings) и копилка
// на мечту — ОДНОЙ вещью при любом числе участников (services/goal). Складывает
// их `ownerTakenTotal`, и звать надо именно её: посчитай кто-нибудь слагаемые
// на месте — счётчик в шапке комнаты и счётчик здесь разъедутся.
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { ownerTakenTotal } from "@/server/services/goal";

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
  const takenCount = await ownerTakenTotal(userId);
  return NextResponse.json({ data: { takenCount } }, { headers: NO_STORE });
}
