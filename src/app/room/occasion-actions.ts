"use server";

// Ответы на плашку праздника и свой повод (тикет 198). Экшены тонкие
// (CLAUDE.md): сессия здесь, ownership/Zod/календарь — в
// services/room-occasions и src/server/holidays.
import { ZodError } from "zod";
import { auth } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import {
  RoomOccasionError,
  acceptHoliday,
  addOwnOccasion,
  removeOccasion,
  skipHoliday,
} from "@/server/services/room-occasions";

export type OccasionActionResult = { ok: true } | { error: "AUTH" | "NO_ROOM" | "VALIDATION" };

async function runForOwner(
  mutate: (userId: string) => Promise<unknown>,
): Promise<OccasionActionResult> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return { error: "AUTH" };
  try {
    await mutate(userId);
  } catch (error) {
    if (error instanceof ZodError) return { error: "VALIDATION" };
    if (error instanceof RoomOccasionError) {
      return { error: error.code === "NO_ROOM" ? "NO_ROOM" : "VALIDATION" };
    }
    throw error;
  }
  return { ok: true };
}

/** «Показать» — общая дата принята и живёт в комнате наравне с днём рождения. */
export async function acceptHolidayAction(key: string): Promise<OccasionActionResult> {
  return runForOwner((userId) => acceptHoliday(userId, String(key ?? "")));
}

/** «Не в этом году» — плашка уходит до следующего года и молчит. */
export async function skipHolidayAction(key: string): Promise<OccasionActionResult> {
  return runForOwner((userId) => skipHoliday(userId, String(key ?? "")));
}

/** «Добавить свой повод» — годовщина, новоселье, выпускной. */
export async function addOwnOccasionAction(input: {
  title: string;
  day: number;
  month: number;
}): Promise<OccasionActionResult> {
  return runForOwner((userId) =>
    addOwnOccasion(userId, {
      title: String(input?.title ?? ""),
      day: Number(input?.day),
      month: Number(input?.month),
    }),
  );
}

/** Убрать праздник: свой повод или принятую общую дату. */
export async function removeOccasionAction(id: string): Promise<OccasionActionResult> {
  return runForOwner((userId) => removeOccasion(userId, String(id ?? "")));
}
