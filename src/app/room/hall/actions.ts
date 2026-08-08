"use server";

// Мутации со страницы зала славы (тикет 35). Экшен тонкий (CLAUDE.md):
// ownership, Zod и revalidateTag — в services/items; здесь только сессия и
// перевод отказа в код для клиента.
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { ItemMutationError, setHallPriceHidden, setHiddenFromHall } from "@/server/services/items";

export type HallActionResult = { error: "AUTH" | "NOT_FOUND" | "GENERIC" } | undefined;

/**
 * Скрыть/показать цену отдельной вещи в зале — поверх общей настройки зала
 * («даже если весь зал её показывает», доска 12d).
 */
export async function setHallPriceHiddenAction(
  itemId: string,
  hidden: boolean,
): Promise<HallActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await setHallPriceHidden(userId, String(itemId), Boolean(hidden));
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: "NOT_FOUND" };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}

/**
 * Глазок на витрине (тикет 89): скрыть вещь от НАБЛЮДАТЕЛЕЙ, оставив её на
 * витрине хозяйки. Отдельно от `setHallPriceHiddenAction`: та про цену, эта
 * про саму вещь — две настройки не смешиваются.
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
