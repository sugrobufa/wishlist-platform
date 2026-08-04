"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import {
  CreateItemError,
  createItem,
  ITEM_PHOTO_MAX_BYTES,
  newItemPhotoKey,
} from "@/server/services/items";
import { presignPut } from "@/server/s3";

// Экшены тонкие (CLAUDE.md): валидация и бизнес-правила — в services/items.
// Коды ошибок клиент переводит в человеческие строки ns AddItem.

export type PresignPhotoResult =
  | { key: string; url: string }
  | { error: "AUTH" | "NO_ROOM" | "TOO_LARGE" | "BAD_TYPE" };

/**
 * Pre-signed PUT для фото вещи: файл ≤10 МБ, только растровые image/*.
 * Ключ — items/{roomId}/{random}.{ext} СВОЕЙ комнаты; подпись фиксирует
 * Content-Type и точный Content-Length (см. src/server/s3.ts → presignPut).
 */
export async function presignItemPhotoAction(input: {
  contentType: string;
  size: number;
}): Promise<PresignPhotoResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  const room = await getRoomForUser(userId);
  if (!room) return { error: "NO_ROOM" };

  const size = Number(input?.size);
  if (!Number.isInteger(size) || size <= 0 || size > ITEM_PHOTO_MAX_BYTES) {
    return { error: "TOO_LARGE" };
  }

  const contentType = String(input?.contentType ?? "");
  const key = newItemPhotoKey(room.id, contentType);
  if (!key) return { error: "BAD_TYPE" };

  const url = await presignPut(key, contentType, size);
  return { key, url };
}

export type CreateItemResult = {
  error: "VALIDATION" | "NO_ROOM" | "ZONE_NOT_VISIBLE" | "FOREIGN_PHOTO_KEY";
};

/**
 * Сохранение вещи (турн 8). Успех не возвращается — уводим redirect'ом
 * в зону, где вещь уже видна (демо-призраки зоны исчезают сами: сетка
 * тикета 03 показывает их только пока в зоне нет ни одной своей вещи).
 */
export async function createItemAction(input: unknown): Promise<CreateItemResult | undefined> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) redirect("/signin");

  let zone: string;
  try {
    zone = (await createItem(userId, input)).zone;
  } catch (error) {
    if (error instanceof ZodError) return { error: "VALIDATION" };
    if (error instanceof CreateItemError) {
      return { error: error.code };
    }
    throw error;
  }

  redirect(`/room/zone/${zone}`);
}
