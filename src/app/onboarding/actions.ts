"use server";

import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createRoomForUser, getSessionUserId } from "@/server/services/rooms";

/**
 * Финал онбординга: создать комнату {preset, zoneSet, shareSlug} и увести
 * хозяйку в /room. Экшен тонкий — валидация и идемпотентность в сервисе.
 */
export async function createRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) redirect("/signin");

  await createRoomForUser(userId, {
    preset: String(formData.get("preset") ?? ""),
    zoneSet: String(formData.get("zoneSet") ?? ""),
  });

  redirect("/room");
}
