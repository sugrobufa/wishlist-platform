"use server";

// Ответ на вопрос «остаться на связи?» (тикет 98, доска Б12).
//
// ИНВАРИАНТ №4 (друзья не добавляются) держится тем, что этот файл умеет
// РОВНО ДВА глагола — «да» и «не в этот раз» — и ни одного создающего:
// связь уже существует, её родил подарок (`receiveGift` → сервис связей).
// Ни поиска людей, ни приглашений, ни создания строки по вводу здесь нет и
// быть не может: сервис такой функции не экспортирует (негативный тест).
//
// Экшены тонкие (CLAUDE.md): сессия и код отказа — здесь, вся проверка прав
// (моя ли это связь, спрашивали ли вообще) — в services/connections.
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { respondToAllPending, respondToConnection } from "@/server/services/connections";

export type ConsentActionResult = { error: "AUTH" | "NOT_FOUND" | "GENERIC" } | undefined;

/** Обе страницы вопроса перерисовываются вместе: ответ виден там, где спросили. */
function refreshBothScreens(): void {
  revalidatePath("/connections");
  revalidatePath("/room/occasion");
}

/**
 * Ответ по одной связи. Чужая или несуществующая строка отвечает NOT_FOUND
 * (сервис не подтверждает её существование).
 */
export async function respondToConnectionAction(
  connectionId: string,
  agree: boolean,
): Promise<ConsentActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    const answered = await respondToConnection(userId, String(connectionId), Boolean(agree));
    if (!answered) return { error: "NOT_FOUND" };
  } catch (error) {
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  refreshBothScreens();
  return undefined;
}

/**
 * «Со всеми семью» с доски Б12 — один ответ на все висящие вопросы.
 * Отвечает только за СЕБЯ: связь всё равно состоится лишь при согласии
 * второй стороны.
 */
export async function respondToAllPendingAction(agree: boolean): Promise<ConsentActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await respondToAllPending(userId, Boolean(agree));
  } catch (error) {
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  refreshBothScreens();
  return undefined;
}
