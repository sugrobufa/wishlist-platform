"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import {
  createRoomForUser,
  getSessionUserId,
  setBirthday,
  updateDisplayName,
} from "@/server/services/rooms";
import { GUEST_INTRO_COOKIE } from "./guest-intro";
import { readBirthdayForm } from "./occasion-date";

/**
 * Финал онбординга: создать комнату {preset, zoneSet, shareSlug}, записать имя
 * и день рождения и увести хозяйку в /room. Экшен тонкий — валидация и
 * идемпотентность в сервисах.
 *
 * Имя и дата идут ТЕМИ ЖЕ путями, что из настроек: `updateDisplayName` и
 * `setBirthday` остаются единственными местами, которые пишут
 * `User.displayName` и день рождения комнаты. Вторых путей специально не
 * заводим — иначе правила даты однажды разъедутся между онбордингом и
 * настройками.
 */
export async function createRoomAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) redirect("/signin");

  // «Что чаще всего хочется» ОТСЮДА УШЛО (письмо 33, турн 40b): вопрос больше
  // не шаг онбординга, его задают чипами при первом открытии «начни с готового»
  // (`room/starter-pack.tsx` → `saveWantsAction`). Комната заводится без ответа,
  // и это законно: `Room.wants` необязателен и был необязателен всегда.
  await createRoomForUser(userId, {
    preset: String(formData.get("preset") ?? ""),
    zoneSet: String(formData.get("zoneSet") ?? ""),
  });

  // Имя (тикет 38, предзаполняется из брони). Пустое поле — не «стереть»:
  // человек мог пройти онбординг молча, и это не повод сносить имя, которое
  // уже могло приехать из профиля OAuth. Оба сервиса требуют существующую
  // комнату, поэтому зовём их после createRoomForUser.
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (displayName !== "") {
    await updateDisplayName(userId, displayName);
  }

  // «Пока не знаю» — сабмит с пометкой: списки даты вообще не читаем.
  const skipped = formData.get("skipDate") === "1";
  const birthday = skipped
    ? null
    : readBirthdayForm(formData.get("birthdayDay"), formData.get("birthdayMonth"));
  // Пропуск — это «не задавать», а не «стереть»: у новой комнаты даты и так
  // нет, а повторный проход онбординга (комната уже есть) не должен обнулять
  // день рождения, выставленный в настройках.
  if (birthday !== null) {
    await setBirthday(userId, birthday);
  }

  // Предзаполнение одноразовое: комната собрана, дальше cookie только вводила
  // бы в заблуждение (человек сменил имя в настройках, а онбординг соседа с
  // того же браузера подставил бы старое).
  (await cookies()).delete(GUEST_INTRO_COOKIE);

  redirect("/room");
}
