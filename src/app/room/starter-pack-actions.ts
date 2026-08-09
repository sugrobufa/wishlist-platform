"use server";

// «Начни с готового» (тикет 100, доска Б23). Экшен тонкий (CLAUDE.md):
// сессия и код отказа — здесь, вся работа — в services/starter-pack.
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { applyStarterPack } from "@/server/services/starter-pack";

export type StarterPackActionResult =
  | { error: "AUTH" | "NO_ROOM" | "GENERIC" }
  | { created: number };

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
