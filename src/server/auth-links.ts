// Адреса входа по ссылке (тикет 19). Один модуль знает две вещи:
// какой адрес уходит в письмо и куда шлёт форма подтверждения.
//
// ЗАЧЕМ: одноразовый токен Auth.js тратится ПЕРВЫМ ЖЕ запросом к callback.
// Chrome предзагружает адрес, пока человек ещё печатает его в строке; то же
// делают почтовые антивирусы и корпоративные сканеры, открывающие ссылки за
// получателя, — токен сгорает до человека и вход падает «Verification».
// Поэтому в письмо уходит адрес НАШЕЙ страницы (/signin/confirm), которая на
// GET не делает ничего, а настоящая проверка происходит по нажатию — обычным
// POST в тот же callback провайдера (Auth.js его принимает: CSRF там
// требуется только для credentials, а токен/почту он читает из query).
//
// Модуль намеренно чистый (никаких импортов) — его зовут и провайдер письма
// (src/server/auth.ts), и страница подтверждения, и юниты.

/** id провайдера входа по ссылке в Auth.js (next-auth/providers/nodemailer). */
export const MAGIC_PROVIDER_ID = "nodemailer";

/** basePath Auth.js — маршрут src/app/api/auth/[...nextauth]/route.ts. */
export const AUTH_BASE_PATH = "/api/auth";

/** Наша страница подтверждения: GET ничего не тратит, вход — по кнопке. */
export const CONFIRM_PATH = "/signin/confirm";

/** Куда человек попадает после входа: /room сам уводит в /onboarding, если
 * комнаты ещё нет (src/app/room/page.tsx). */
export const AFTER_SIGNIN_PATH = "/room";

/**
 * Адрес для письма из «сырого» callback-адреса Auth.js
 * (`{origin}/api/auth/callback/nodemailer?callbackUrl=…&token=…&email=…`).
 * Возвращает `{origin}/signin/confirm?token=…&email=…`; origin берётся из
 * исходной ссылки — его Auth.js считает по адресу запроса.
 *
 * Чужой формат (нет token/email, не URL) возвращается как есть: письмо
 * важнее нашей догадки о его содержимом.
 */
export function magicLinkUrl(callbackUrl: string): string {
  let source: URL;
  try {
    source = new URL(callbackUrl);
  } catch {
    return callbackUrl;
  }
  const token = source.searchParams.get("token");
  const email = source.searchParams.get("email");
  if (!token || !email) return callbackUrl;

  const confirm = new URL(CONFIRM_PATH, source.origin);
  confirm.searchParams.set("token", token);
  confirm.searchParams.set("email", email);
  return confirm.toString();
}

/**
 * `action` формы подтверждения — POST в callback провайдера. token и email
 * лежат в query, потому что оттуда их читает Auth.js (тело он смотрит только
 * у credentials). callbackUrl — куда увести после входа.
 */
export function magicLinkVerifyAction(token: string, email: string): string {
  const params = new URLSearchParams({ token, email, callbackUrl: AFTER_SIGNIN_PATH });
  return `${AUTH_BASE_PATH}/callback/${MAGIC_PROVIDER_ID}?${params.toString()}`;
}
