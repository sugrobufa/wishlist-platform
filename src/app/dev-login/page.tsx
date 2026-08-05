import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createTranslator } from "next-intl";
import { getLocale } from "next-intl/server";
import { clientIp } from "@/server/rate-limit";
import {
  attemptQuickLogin,
  readQuickLoginConfig,
  QUICK_LOGIN_KEY_PARAM,
  QUICK_LOGIN_PATH,
} from "@/server/quick-login";
import devLoginRu from "../../../messages/dev-login.ru.json";
import devLoginEn from "../../../messages/dev-login.en.json";

/**
 * Тексты лежат ОТДЕЛЬНО от messages/{ru,en}.json намеренно.
 *
 * src/app/layout.tsx отдаёт весь общий словарь в NextIntlClientProvider, а тот
 * сериализует его в разметку КАЖДОЙ страницы. Пространство имён «DevLogin» в
 * общем файле означало бы, что слова «Быстрый вход» и «Ключ» видит любой гость
 * на любом экране — то есть само существование обхода перестало бы быть тайной
 * (а мы даже 404 держим неотличимым). Поэтому словарь свой, next-intl тот же
 * (createTranslator), ru + en на месте, но в общий payload он не попадает:
 * страница целиком серверная и клиентских компонентов не содержит.
 */
async function devLoginTranslator() {
  const locale = await getLocale();
  const messages = locale === "en" ? devLoginEn : devLoginRu;
  return createTranslator({ locale, messages, namespace: "DevLogin" });
}

// Служебный экран: не кэшируется, не индексируется, в интерфейсе штатного
// входа не упоминается вообще — ни при включённом флаге, ни при выключенном.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Быстрый вход на тестовом стенде (тикет 29) — обход письма, пока нет SMTP.
 *
 * Две двери, одна дорога: `/dev-login?key=…` из закладки владельца и форма на
 * этой же странице ведут в один и тот же обработчик. Форма — обычный
 * `method="get"` на этот же адрес, поэтому она работает без JS и без серверных
 * действий: браузер просто собирает `?key=…` сам.
 *
 * Любой отказ — 404 через notFound(): выключенный флаг, кривая настройка,
 * неверный ключ и исчерпанный бюджет попыток выглядят снаружи одинаково, и по
 * ответу нельзя понять, существует ли механизм вообще.
 *
 * Сессию эта страница не выдаёт: при успехе она только уводит на настоящий
 * callback Auth.js (см. src/server/quick-login.ts).
 */
export default async function DevLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string | string[] }>;
}) {
  // Механизма нет — страницы тоже нет (форму рисовать не для кого).
  if (!readQuickLoginConfig()) notFound();

  const params = await searchParams;
  const raw = params[QUICK_LOGIN_KEY_PARAM];
  const key = Array.isArray(raw) ? raw[0] : raw;

  if (typeof key === "string") {
    const outcome = await attemptQuickLogin({ key, ip: clientIp(await headers()) });
    if (!outcome.ok) notFound();
    // Дальше всё делает Auth.js: гасит токен, заводит сессию, ставит cookie
    // и уводит в /room (а /room сам — в /onboarding, если комнаты ещё нет).
    redirect(outcome.redirectTo);
  }

  const t = await devLoginTranslator();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="overline text-text-muted">{t("overline")}</p>
      <h1 className="display text-3xl md:text-5xl">{t("title")}</h1>
      <p className="max-w-md text-text-body">{t("body")}</p>

      {/* method="get" на этот же адрес — та же дорога, что у ссылки; JS не нужен. */}
      <form
        method="get"
        action={QUICK_LOGIN_PATH}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <label className="text-left text-sm text-text-muted" htmlFor={QUICK_LOGIN_KEY_PARAM}>
          {t("keyLabel")}
        </label>
        <input
          id={QUICK_LOGIN_KEY_PARAM}
          name={QUICK_LOGIN_KEY_PARAM}
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          className="border border-white/16 bg-white/5 px-4 py-3 text-text-primary outline-none focus:border-white/40"
        />
        <button
          type="submit"
          className="pressable border-b-2 px-6 py-3 text-text-primary"
          style={{
            borderColor: "#E7C9A9",
            boxShadow: "0 4px 18px -3px rgba(231,201,169,.42)",
          }}
        >
          {t("submit")} →
        </button>
      </form>
    </main>
  );
}
