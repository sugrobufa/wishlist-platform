"use server";

// «Начни с готового» (тикет 100, доска Б23). Экшен тонкий (CLAUDE.md):
// сессия и код отказа — здесь, вся работа — в services/starter-pack.
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { getSessionUserId, RoomSettingsError, setRoomWants } from "@/server/services/rooms";
import {
  applyStarterPack,
  starterPackWants,
  type StarterWants,
} from "@/server/services/starter-pack";

export type StarterPackActionResult =
  { error: "AUTH" | "NO_ROOM" | "GENERIC" } | { created: number };

/**
 * Положить набор в СВОЮ комнату — чужую положить нечем: комната берётся по
 * userId сессии, параметра «кому» у экшена нет.
 */
export async function applyStarterPackAction(): Promise<StarterPackActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };

  try {
    const result = await applyStarterPack(userId);
    if (!result.roomFound) return { error: "NO_ROOM" };
    revalidatePath("/room");
    return { created: result.created };
  } catch (error) {
    if (error instanceof ZodError) return { error: "GENERIC" };
    throw error;
  }
}

/**
 * Чипы вопроса «что чаще всего хочется» для своей комнаты (письмо 33, турн
 * 40b). Спрашиваются экшеном, а не пропом: блок набора стоит в потоке пустой
 * комнаты, и добавлять ради вопроса ещё один проп в страницу комнаты — значит
 * тащить чипы через весь экран туда, где они не нужны.
 *
 * Отказы тихие: комнаты или сессии нет — вопроса просто не будет.
 */
export async function starterPackWantsAction(): Promise<StarterWants | null> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return null;
  return starterPackWants(userId);
}

/**
 * Записать ответ. Пустой список — законный ответ («просто листать дальше»), и
 * он же снимает прежний: правило «спрашиваем один раз» держит экран, а не
 * запрет в сервисе.
 *
 * `revalidatePath` здесь НЕ зовём: ответ не меняет ни одной вещи в комнате —
 * он лишь красит порядок наполнения, когда человек нажмёт «начни с готового».
 */
export async function saveWantsAction(keys: string[]): Promise<{ ok: boolean }> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { ok: false };

  try {
    await setRoomWants(userId, keys);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) return { ok: false };
    // Комнаты нет (онбординг не пройден) — ответ записывать некуда.
    if (error instanceof RoomSettingsError) return { ok: false };
    throw error;
  }
}
