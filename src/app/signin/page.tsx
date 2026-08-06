import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { AFTER_SIGNIN_PATH } from "@/server/auth-links";
import { requestMagicLink } from "./actions";
import { SigninBackdrop } from "./backdrop";
import { ResendButton } from "./resend-button";

export const dynamic = "force-dynamic";

// Тайтл вкладки: «Вход — Grace». Хвост « — Grace» добавляет template
// корневого layout (тикет 58) — здесь остаётся только своё имя страницы.
// Само имя площадки живёт одним ключом Brand.name (тикет 56).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SignIn");
  return { title: t("overline") };
}

/**
 * Вход по турну 13a доски (тикет 56): манифест на кадре комнаты вместо голой
 * формы. Один маршрут, два состояния: без `sent` — шаг 1 «Вход» (манифест +
 * почта + строка приватности), с `sent=1&email=…` — шаг 2 «Письмо ушло»
 * (адрес, повтор с таймером, «другая почта», подсказка про спам).
 *
 * Соцкнопок нет — решение владельца («нам не нужен вход по мессенджерам»),
 * поэтому нет и разделителя «или»: почта — единственная дверь. Кнопки
 * «Открыть почту» с доски тоже нет: mailto: открывает НАПИСАНИЕ письма, а не
 * входящие, а веб-ссылки на входящие по домену — это хардкод почтовых
 * сервисов, который тикет прямо запрещает.
 *
 * Акцент экрана — акцент «Кремовой» из rooms.json (#E7C9A9): её же кадр лежит
 * фоном. В классах он литералом — Tailwind собирает классы из статических
 * строк.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; email?: string }>;
}) {
  // Вошедшему форма входа не нужна: он думал, что вход не сработал
  // (приёмка п.9). /room сам уведёт в /onboarding, если комнаты нет.
  const session = await auth();
  if (session?.user) redirect(AFTER_SIGNIN_PATH);

  const t = await getTranslations("SignIn");
  const brand = await getTranslations("Brand");
  const { sent, email } = await searchParams;

  // ---- Шаг 2 · «Письмо ушло» --------------------------------------------
  if (sent) {
    return (
      <main className="relative min-h-[100dvh] overflow-hidden">
        <SigninBackdrop variant="quiet" />
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col px-[22px] pb-10 pt-[30px]">
          <a
            href="/signin"
            aria-label={t("back")}
            className="pressable flex h-[34px] w-[34px] shrink-0 items-center justify-center self-start rounded-full bg-white/10"
          >
            <svg
              viewBox="0 0 24 24"
              width="19"
              height="19"
              fill="none"
              stroke="rgba(255,249,242,.8)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5.5L4.5 12l6.5 6.5" />
              <path d="M4.5 12h15" />
            </svg>
          </a>

          <div className="mt-[86px]">
            <h1 className="display text-[30px] leading-[1.05]">{t("sentTitle")}</h1>

            {email && (
              <p className="mt-[26px] flex items-center gap-[13px] border border-[rgba(231,201,169,.35)] bg-[rgba(231,201,169,.1)] px-5 py-[18px]">
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="#E7C9A9"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path d="M3 7.5h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
                  <path d="M3 8l9 6.5L21 8" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-primary">
                  {email}
                </span>
              </p>
            )}

            <p className="mt-4 text-[14px] leading-[1.55] text-text-muted">{t("sentBody")}</p>

            <div className="mt-3 flex min-h-[44px] items-center justify-between gap-4">
              {email && (
                <form action={requestMagicLink}>
                  <input type="hidden" name="email" value={email} />
                  <ResendButton />
                </form>
              )}
              <a
                href="/signin"
                className="pressable ml-auto inline-flex min-h-[44px] items-center text-[12.5px] font-semibold text-[#E7C9A9]"
              >
                {t("otherEmail")}
              </a>
            </div>

            {/* Оверлайн набран руками, а не классом .overline: имя класса
                совпадает со встроенной утилитой Tailwind text-decoration:
                overline — она рисует черту над строкой (глобальная чинка —
                отдельным тикетом). Значения — те же, что у .overline. */}
            <div className="mt-[22px] border-t border-surface-hairline pt-[22px]">
              <p className="text-[9px] font-semibold uppercase tracking-[.2em] text-text-faint">
                {t("notArrived")}
              </p>
              <p className="mt-[11px] text-[12.5px] leading-[1.55] text-text-muted">
                {t("spamHint")}
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ---- Шаг 1 · «Вход» ----------------------------------------------------
  return (
    <main className="relative min-h-[100dvh] overflow-hidden">
      <SigninBackdrop variant="hero" />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col px-[22px] pb-10 pt-[30px]">
        {/* Знак продукта (турн 13a): дом с лампой; имя «Grace» — временный
            вордмарк текстом (Archivo), пока не приехал SVG-логотип; под ним
            «Тихое пространство» с доски — имя его не вытесняет. */}
        <p className="flex items-center gap-3">
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="#E7C9A9"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0"
          >
            <path d="M4 20.5V11a8 8 0 0 1 16 0v9.5" />
            <path d="M2.5 20.5h19" />
            <circle cx="8" cy="14" r="1.1" fill="#E7C9A9" stroke="none" />
          </svg>
          <span className="flex flex-col gap-[5px]">
            <span className="font-display text-[14px] font-black uppercase leading-none tracking-[.24em] text-text-primary">
              {brand("name")}
            </span>
            <span className="whitespace-pre-line font-display text-[9.5px] font-semibold uppercase leading-[1.5] tracking-[.24em] text-text-strong">
              {t("brand")}
            </span>
          </span>
        </p>

        {/* Манифест. Перенос строки живёт в словаре (whitespace-pre-line) —
            как на доске, а не как решит ширина окна. */}
        <div className="flex flex-1 flex-col justify-center py-10">
          <h1 className="display whitespace-pre-line text-[44px] leading-[.98]">
            {t("manifestTitle")}
          </h1>
          <p className="mt-5 max-w-[340px] text-[15px] leading-[1.55] text-text-body">
            {t("manifestBody")}
          </p>
        </div>

        {/* Почта — единственная дверь; кнопка — «полоса света» (tokens.json →
            button.primary), как везде. */}
        <div>
          <form action={requestMagicLink} className="flex flex-col gap-[9px]">
            <label className="sr-only" htmlFor="email">
              {t("emailLabel")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              className="w-full border border-[rgba(231,201,169,.5)] bg-[rgba(231,201,169,.08)] px-5 py-[17px] text-[15px] font-semibold text-text-primary outline-none placeholder:text-text-faint focus:border-[#E7C9A9]"
            />
            <button
              type="submit"
              className="pressable w-full border-b-2 border-[#E7C9A9] px-6 py-[17px] text-center text-[14px] font-bold text-text-primary shadow-[0_4px_18px_-3px_rgba(231,201,169,.42)]"
            >
              {t("submit")} →
            </button>
          </form>

          <p className="mt-5 flex items-center justify-center gap-2 text-[11.5px] font-medium text-text-muted">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="rgba(255,249,242,.4)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />
              <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
            </svg>
            {t("noPassword")}
          </p>
        </div>
      </div>
    </main>
  );
}
