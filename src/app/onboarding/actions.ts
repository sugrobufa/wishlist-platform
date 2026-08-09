"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import {
  createRoomForUser,
  getSessionUserId,
  setOccasionDate,
  updateDisplayName,
} from "@/server/services/rooms";
import { GUEST_INTRO_COOKIE } from "./guest-intro";
import { readOccasionDate } from "./occasion-date";

/**
 * Финал онбординга: создать комнату {preset, zoneSet, shareSlug}, записать имя
 * и дату праздника и увести хозяйку в /room. Экшен тонкий — валидация и
 * идемпотентность в сервисах.
 *
 * Имя и дата идут ТЕМИ ЖЕ путями, что из настроек: `updateDisplayName` и
 * `setOccasionDate` остаются единственными местами, которые пишут
 * `User.displayName` и `Room.occasionDate` (и единственным, которое знает про
 * полночь UTC). Вторых путей специально не заводим — иначе таймзона однажды
 * разъедется между онбордингом и настройками.
 */
export async function createRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) redirect("/signin");

  await createRoomForUser(userId, {
    preset: String(formData.get("preset") ?? ""),
    zoneSet: String(formData.get("zoneSet") ?? ""),
    // «Что чаще всего хочется» (тикет 113): три-четыре ключа зон через
    // запятую. Пусто — вопрос пропустили, и это законный ответ.
    wants: String(formData.get("wants") ?? ""),
  });

  // Имя (тикет 38, предзаполняется из брони). Пустое поле — не «стереть»:
  // человек мог пройти онбординг молча, и это не повод сносить имя, которое
  // уже могло приехать из профиля OAuth. Оба сервиса требуют существующую
  // комнату, поэтому зовём их после createRoomForUser.
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName !== "") {
    await updateDisplayName(userId, displayName);
  }

  // «Пока не знаю» — сабмит с пометкой: поле даты вообще не читаем.
  const skipped = formData.get("skipDate") === "1";
  const occasionDate = skipped ? null : readOccasionDate(formData.get("occasionDate"));
  // Пропуск — это «не задавать», а не «стереть»: у новой комнаты даты и так
  // нет, а повторный проход онбординга (комната уже есть) не должен обнулять
  // дату, выставленную в настройках.
  if (occasionDate !== null) {
    await setOccasionDate(userId, occasionDate);
  }

  // Предзаполнение одноразовое: комната собрана, дальше cookie только вводила
  // бы в заблуждение (человек сменил имя в настройках, а онбординг соседа с
  // того же браузера подставил бы старое).
  (await cookies()).delete(GUEST_INTRO_COOKIE);

  redirect("/room");
}
