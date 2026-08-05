import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { AFTER_SIGNIN_PATH, magicLinkVerifyAction } from "@/server/auth-links";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Подтверждение входа по ссылке из письма (тикет 19).
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
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="overline text-text-muted">{t("confirmOverline")}</p>
        <h1 className="display text-3xl md:text-5xl">
          {expired ? t("expiredTitle") : t("failedTitle")}
        </h1>
        <p className="max-w-md text-text-body">
          {expired ? t("expiredBody") : t("failedBody")}
        </p>
        {/* Обычная ссылка, не next/link: экран обязан работать без JS. */}
        <a
          href="/signin"
          className="pressable border-b-2 px-6 py-3 text-text-primary"
          style={{
            borderColor: "#E7C9A9",
            boxShadow: "0 4px 18px -3px rgba(231,201,169,.42)",
          }}
        >
          {t("newLink")} →
        </a>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="overline text-text-muted">{t("confirmOverline")}</p>
      <h1 className="display text-3xl md:text-5xl">{t("confirmTitle")}</h1>
      <p className="max-w-md text-text-body">{t("confirmBody")}</p>
      <p className="text-sm text-text-muted">{email}</p>

      {/* Строковый action + method="post" — браузерная отправка, без JS. */}
      <form method="post" action={magicLinkVerifyAction(token, email)}>
        <button
          type="submit"
          className="pressable border-b-2 px-6 py-3 text-text-primary"
          style={{
            borderColor: "#E7C9A9",
            boxShadow: "0 4px 18px -3px rgba(231,201,169,.42)",
          }}
        >
          {t("confirmSubmit")} →
        </button>
      </form>
    </main>
  );
}
