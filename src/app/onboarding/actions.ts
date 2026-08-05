"use server";

import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { createRoomForUser, getSessionUserId, setOccasionDate } from "@/server/services/rooms";
import { readOccasionDate } from "./occasion-date";

/**
 * Финал онбординга: создать комнату {preset, zoneSet, shareSlug}, записать
 * дату праздника и увести хозяйку в /room. Экшен тонкий — валидация и
 * идемпотентность в сервисе.
 *
 * Дата идёт ТЕМ ЖЕ путём, что из настроек: `setOccasionDate` остаётся
 * единственным местом, которое пишет `Room.occasionDate` (и единственным,
 * которое знает про полночь UTC). Второго пути специально не заводим — иначе
 * таймзона однажды разъедется между онбордингом и настройками.
 */
export async function createRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) redirect("/signin");

  await createRoomForUser(userId, {
    preset: String(formData.get("preset") ?? ""),
    zoneSet: String(formData.get("zoneSet") ?? ""),
  });

  // «Пока не знаю» — сабмит с пометкой: поле даты вообще не читаем.
  const skipped = formData.get("skipDate") === "1";
  const occasionDate = skipped ? null : readOccasionDate(formData.get("occasionDate"));
  // Пропуск — это «не задавать», а не «стереть»: у новой комнаты даты и так
  // нет, а повторный проход онбординга (комната уже есть) не должен обнулять
  // дату, выставленную в настройках.
  if (occasionDate !== null) {
    await setOccasionDate(userId, occasionDate);
  }

  redirect("/room");
}
