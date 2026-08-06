import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { AFTER_SIGNIN_PATH, magicLinkVerifyAction } from "@/server/auth-links";
import { SigninBackdrop } from "../backdrop";

export const dynamic = "force-dynamic";

// Тайтл — «Вход — Grace» (Brand.name, тикет 56); robots как были: страница
// одноразовой ссылки в индексе не живёт.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SignIn");
  const brand = await getTranslations("Brand");
  return {
    title: `${t("confirmOverline")} — ${brand("name")}`,
    robots: { index: false, follow: false },
  };
}

/**
 * Подтверждение входа по ссылке из письма (тикет 19; стилизация — тикет 56:
 * тот же кадр «Кремовой» с ровной вуалью, что у экрана «письмо ушло»).
 *
 * GET этой страницы НЕ ТРАТИТ НИЧЕГО: предзагрузка адресной строки Chrome,
 * почтовый антивирус и корпоративный сканер, кликающий ссылки за человека,
 * увидят просто экран с кнопкой. Одноразовый токен расходуется только
 * нажатием — обычной формой (method="post"), поэтому вход не зависит от JS
 * и от гидрации.
 *
 * Форма шлёт POST прямо в callback провайдера Auth.js: он сам проверит
 * токен (срок и одноразовость — как были), заведёт сессию и уведёт в /room.
 * Отказ (протух, уже использован, нет токена) возвращается сюда же
 * параметром error — вместо сырого экрана Auth.js человек видит тихий текст
 * и кнопку «Прислать новую ссылку».
 */
export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string; error?: string }>;
}) {
  // Уже вошедшего вторая дверь не спрашивает (приёмка п.9).
  const session = await auth();
  if (session?.user) redirect(AFTER_SIGNIN_PATH);

  const { token, email, error } = await searchParams;
  const t = await getTranslations("SignIn");

  // Пустой заход и любой отказ Auth.js — один и тот же тихий экран.
  if (error || !token || !email) {
    const expired = !error || error === "Verification";
    return (
      <main className="relative min-h-[100dvh] overflow-hidden">
        <SigninBackdrop variant="quiet" />
        <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center gap-6 px-[22px] py-10 text-center">
          {/* Не класс .overline: его имя совпадает с утилитой Tailwind
              text-decoration: overline, рисующей черту над строкой. */}
          <p className="text-[9px] font-medium uppercase tracking-[.2em] text-text-muted">
            {t("confirmOverline")}
          </p>
          <h1 className="display text-3xl md:text-5xl">
            {expired ? t("expiredTitle") : t("failedTitle")}
          </h1>
          <p className="max-w-md text-text-body">
            {expired ? t("expiredBody") : t("failedBody")}
          </p>
          {/* Обычная ссылка, не next/link: экран обязан работать без JS. */}
          <a
            href="/signin"
            className="pressable border-b-2 border-[#E7C9A9] px-6 py-3 text-text-primary shadow-[0_4px_18px_-3px_rgba(231,201,169,.42)]"
          >
            {t("newLink")} →
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden">
      <SigninBackdrop variant="quiet" />
      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col items-center justify-center gap-6 px-[22px] py-10 text-center">
        <p className="text-[9px] font-medium uppercase tracking-[.2em] text-text-muted">
          {t("confirmOverline")}
        </p>
        <h1 className="display text-3xl md:text-5xl">{t("confirmTitle")}</h1>
        <p className="max-w-md text-text-body">{t("confirmBody")}</p>
        <p className="text-sm text-text-muted">{email}</p>

        {/* Строковый action + method="post" — браузерная отправка, без JS. */}
        <form method="post" action={magicLinkVerifyAction(token, email)}>
          <button
            type="submit"
            className="pressable border-b-2 border-[#E7C9A9] px-6 py-3 text-text-primary shadow-[0_4px_18px_-3px_rgba(231,201,169,.42)]"
          >
            {t("confirmSubmit")} →
          </button>
        </form>
      </div>
    </main>
  );
}
