"use server";

// Укрепление аккаунта перед первым шером (тикет 94, доска Б8). Экшены тонкие
// (CLAUDE.md): политика «просить ли» и запись — в services/harden.
import { auth, signIn } from "@/server/auth";
import { getSessionUserId } from "@/server/services/rooms";
import { availableSecondAuth, markHardenAsked } from "@/server/services/harden";

/**
 * Просьба состоялась — записать это и больше не спрашивать. Зовётся обоими
 * исходами: и «Привязать», и «Поделиться без этого». Отказ — тоже ответ.
 */
export async function markHardenAskedAction(): Promise<void> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return;
  await markHardenAsked(userId);
}

/**
 * «Привязать и поделиться»: уводим в провайдера и возвращаем в комнату.
 * Сама привязка — забота Auth.js: сессия уже есть, поэтому новый аккаунт
 * привяжется к ней, а событие `linkAccount` запишет `User.secondAuth`.
 *
 * Провайдер сверяется со списком подключённых: строка из браузера сюда не
 * доедет — в `signIn` уходит только то, что собрано из env.
 */
export async function linkSecondAuthAction(provider: string): Promise<void> {
  const session = await auth();
  const userId = await getSessionUserId(session?.user);
  if (!userId) return;
  if (!availableSecondAuth().includes(provider)) return;

  await markHardenAsked(userId);
  await signIn(provider, { redirectTo: "/room" });
}
