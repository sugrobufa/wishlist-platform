"use server";

// Мутации вещи со страницы зоны хозяйки: спрятать/показать и удалить
// (тикет 13), «уже моё» и зал славы (тикет 10), правка и перенос между
// зонами (тикет 39). Экшены тонкие (CLAUDE.md): ownership, Zod и
// revalidateTag — в services/items; здесь только сессия и перевод отказов
// в коды для клиента.
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { RoomSettingsError, getSessionUserId, setZoneOff } from "@/server/services/rooms";
import {
  ItemMutationError,
  deleteItem,
  selfFulfill,
  setItemHidden,
  setItemsHidden,
  toggleHall,
  updateItem,
} from "@/server/services/items";

export type ItemActionResult =
  | {
      error: "AUTH" | "NOT_FOUND" | "NOT_WANT" | "NOT_LOVE" | "ZONE_NOT_VISIBLE" | "VALIDATION" | "GENERIC";
    }
  | undefined;

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

/**
 * Скрыть несколько вещей разом (тикет 74). Идёт через тот же `setItemHidden`,
 * что и одиночное скрытие, — значит брони снимаются, а не повисают.
 */
export async function setItemsHiddenAction(
  itemIds: string[],
  hidden: boolean,
): Promise<ItemActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await setItemsHidden(userId, itemIds.map(String), Boolean(hidden));
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: "NOT_FOUND" };
    if (error instanceof ZodError) return { error: "VALIDATION" };
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

/**
 * «Уже моё» (тикет 10): ручной WANT → LOVE без дарителя и раскрытий;
 * бронь, если была, тихо снимается. Необратимо — подтверждение на клиенте.
 */
export async function selfFulfillAction(itemId: string): Promise<ItemActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await selfFulfill(userId, String(itemId));
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: error.code };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}

/**
 * Правка вещи и перенос между зонами (тикет 39). Состояние вещи правкой не
 * меняется: `state` в схемах сервиса нет вовсе — «хочу → люблю» остаётся
 * необратимым (инвариант №2). Вещь с активной бронью правится молча и
 * тем же путём: сказать «занято» нельзя (инвариант №1) — решение и
 * объяснение живут в комментарии к updateItem.
 */
export async function updateItemAction(itemId: string, input: unknown): Promise<ItemActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await updateItem(userId, String(itemId), input);
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: error.code };
    if (error instanceof ZodError) return { error: "VALIDATION" };
    throw error;
  }
  return undefined;
}

/** «В зал славы / Убрать из зала» (тикет 10): только для вещей «люблю». */
export async function toggleHallAction(itemId: string, on: boolean): Promise<ItemActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await toggleHall(userId, String(itemId), Boolean(on));
  } catch (error) {
    if (error instanceof ItemMutationError) return { error: error.code };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}

/**
 * «Убрать полку из комнаты» прямо из пустой зоны (тикет 99, доска Б27).
 * Тот же сервис, что у переключателя в настройках, — значит и правило то же:
 * зона исчезает с мебелью (инвариант №5), а ВЕЩИ остаются и вернутся вместе
 * с ней. Действие обратимо: включить обратно можно в настройках.
 */
export async function setZoneOffAction(zoneKey: string, off: boolean): Promise<ItemActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    await setZoneOff(userId, String(zoneKey), Boolean(off));
  } catch (error) {
    if (error instanceof RoomSettingsError) return { error: "NOT_FOUND" };
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
  return undefined;
}
