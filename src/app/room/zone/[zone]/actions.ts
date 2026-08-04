"use server";

// Мутации вещи со страницы зоны хозяйки (тикет 13): спрятать/показать и
// удалить. Экшены тонкие (CLAUDE.md): ownership, Zod и revalidateTag — в
// services/items; здесь только сессия и перевод отказов в коды для клиента.
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { ItemMutationError, deleteItem, setItemHidden } from "@/server/services/items";

export type ItemActionResult = { error: "AUTH" | "NOT_FOUND" | "GENERIC" } | undefined;

/**
 * Спрятать (hidden=true) или показать вещь. При скрытии сервис ОБЯЗАТЕЛЬНО
 * снимает активную бронь (releaseBookingForItem — контракт тикета 09).
 */
export async function setItemHiddenAction(itemId: string, hidden: boolean): Promise<ItemActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await setItemHidden(userId, String(itemId), Boolean(hidden));
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: "NOT_FOUND" };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}

/** Удалить вещь навсегда (подтверждение — на клиенте); бронь снимается до. */
export async function deleteItemAction(itemId: string): Promise<ItemActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await deleteItem(userId, String(itemId));
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: "NOT_FOUND" };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}
