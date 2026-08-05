"use server";

// «Собрать свою комнату» — регистрация по пути (тикет 38, турн 12c).
// Единственный источник новых хозяек: человек только что тихо занял подарок,
// и ровно в эту минуту мы один раз предлагаем ему такую же комнату.
//
// Что делает экшен и чего НЕ делает:
// - НЕ создаёт ни пользователя, ни комнату. Он только открывает дверь: шлёт
//   письмо со ссылкой входа на почту, которую человек сам напечатал в брони.
//   Пароля в продукте нет — «Вход потом по той же почте, куда пришло
//   напоминание» (доска, турн 12c);
// - НЕ трогает бронь и НЕ шлёт хозяйке ничего. Тихая бронь (инвариант №1)
//   этим маршрутом не задета вовсе: ни одной записи, видимой хозяйке, здесь
//   не появляется;
// - имя и дату кладёт в cookie самого человека (guest-intro.ts), чтобы
//   онбординг не спрашивал их второй раз.
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { allowBookingAction, clientIp } from "@/server/rate-limit";
import {
  GUEST_INTRO_COOKIE,
  guestIntroCookieOptions,
  hasGuestIntro,
  parseGuestIntro,
  serializeGuestIntro,
} from "@/app/onboarding/guest-intro";

/**
 * Чем кончилось нажатие:
 * - `sent` — письмо со ссылкой ушло на указанную почту;
 * - `signedIn` — человек уже вошёл; письмо ему не нужно, клиент уводит его
 *   прямо в онбординг (комната уже есть → /onboarding сам вернёт в /room);
 * - `rate` — слишком часто с одного адреса;
 * - `validation` — почта не похожа на почту;
 * - `error` — письмо не ушло (почтовый сервер молчит).
 */
export type RoomOfferResult = { status: "sent" | "signedIn" | "rate" | "validation" | "error" };

const emailSchema = z.email().max(254);

/**
 * Кладёт «что мы уже знаем о человеке» в его же cookie. Пусто — cookie не
 * ставим вовсе (и гасим прежнюю): предзаполнять нечем.
 */
async function rememberIntro(name: unknown, occasionDate: unknown): Promise<void> {
  const value = serializeGuestIntro({ name, occasionDate });
  const jar = await cookies();
  if (hasGuestIntro(parseGuestIntro(value))) {
    jar.set(GUEST_INTRO_COOKIE, value, guestIntroCookieOptions());
  } else {
    jar.delete(GUEST_INTRO_COOKIE);
  }
}

/**
 * Открыть дверь в свою комнату. Форма приходит из листа брони
 * (booking/room-offer.tsx): почта (предзаполнена из брони), имя (оттуда же) и
 * необязательный день рождения.
 *
 * Бюджет — та же корзина, что у брони (10/мин на IP): предложение живёт
 * вплотную к ней, и одна дверь гостя должна иметь один бюджет, иначе наш
 * почтовый сервер становится бесплатной рассылкой для чужого адреса. Мы уже
 * шлём такие письма с открытой формы /signin — новой поверхности здесь не
 * появляется, но и бесплатной она быть не должна.
 */
export async function startOwnRoomAction(formData: FormData): Promise<RoomOfferResult> {
  const ip = clientIp(await headers());
  if (!(await allowBookingAction(ip))) return { status: "rate" };

  const name = formData.get("name");
  const occasionDate = formData.get("occasionDate");
  const email = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) return { status: "validation" };

  await rememberIntro(name, occasionDate);

  // Вошедшему письмо не нужно — он уже свой. Сессия читается лениво и под
  // try/catch тем же приёмом, что в роутах брони и визита: вне request-scope
  // (юниты) это честно считается «аноним».
  try {
    const { auth } = await import("@/server/auth");
    const session = await auth();
    if (session?.user) return { status: "signedIn" };
  } catch {
    // нет сессии и нет рантайма — дальше обычная дорога с письмом
  }

  try {
    const { signIn } = await import("@/server/auth");
    await signIn("nodemailer", { email: email.data, redirect: false });
  } catch {
    // Почта не ушла — говорим об этом честно и не притворяемся, что ушла.
    return { status: "error" };
  }
  return { status: "sent" };
}
