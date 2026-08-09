"use server";

// Экшены экрана «что подарили» (тикет 10). Тонкие (CLAUDE.md): ownership,
// Zod, транзакция и revalidateTag — в services/occasions; здесь только
// сессия и перевод доменных отказов в коды для клиента.
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { OccasionError, closeOccasion, receiveGift } from "@/server/services/occasions";

export type OccasionActionResult =
  | { error: "AUTH" | "NOT_FOUND" | "ALREADY_IN_HALL" | "NO_SUMMARY" | "NO_ROOM" | "GENERIC" }
  | undefined;

/**
 * «Дошло» на строке подарка: одна транзакция receiveGift — переезд в
 * сокровищницу + раскрытие дарителя + закрытие брони + связь. Повтор на вещи,
 * которая уже на витрине, → ALREADY_IN_HALL.
 */
export async function receiveGiftAction(itemId: string): Promise<OccasionActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await receiveGift(userId, String(itemId));
  } catch (error) {
    if (error instanceof OccasionError) return { error: error.code };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}

/**
 * «Праздник прошёл» — ручное закрытие СВОЕЙ комнаты (работает и без даты:
 * решение гриллинга №6). Идемпотентно: повтор в тот же день не плодит
 * summary и не дублирует письмо.
 */
export async function closeOccasionAction(): Promise<OccasionActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  const room = await getRoomForUser(userId);
  if (!room) return { error: "NO_ROOM" };

  try {
    await closeOccasion(room.id, { manual: true });
  } catch (error) {
    if (error instanceof OccasionError) return { error: error.code };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}
