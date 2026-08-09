"use server";

// Мутации со страницы сокровищницы (тикет 35). Экшен тонкий (CLAUDE.md):
// ownership, Zod и revalidateTag — в services/items; здесь только сессия и
// перевод отказа в код для клиента.
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { ItemMutationError, setHiddenFromHall } from "@/server/services/items";

export type HallActionResult = { error: "AUTH" | "NOT_FOUND" | "GENERIC" } | undefined;

// Действия «скрыть цену отдельной вещи» здесь больше нет (тикет 124): цену
// вещи сокровищницы гость не видит вовсе, и прятать её было не от кого.

/**
 * Глазок на витрине (тикет 89): скрыть вещь от НАБЛЮДАТЕЛЕЙ, оставив её на
 * витрине хозяйки.
 */
export async function setHallHiddenAction(
  itemId: string,
  hidden: boolean,
): Promise<HallActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await setHiddenFromHall(userId, String(itemId), Boolean(hidden));
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: "NOT_FOUND" };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}
