import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  // Вошедший пользователь на лендинге не задерживается: с комнатой — в /room,
  // без комнаты — в онбординг (тикет 01).
  if (session?.user) {
    const userId = await getSessionUserId(session.user);
    if (userId) {
      const room = await getRoomForUser(userId);
      redirect(room ? "/room" : "/onboarding");
    }
  }

  const t = await getTranslations("Home");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="overline text-text-muted">{t("overline")}</p>
      <h1 className="display text-4xl md:text-6xl">{t("title")}</h1>
      <p className="max-w-md text-text-body">{t("subtitle")}</p>

      {/* «Полоса света» — главная кнопка (tokens.json → button.primary) */}
      <Link
        href="/signin"
        className="pressable border-b-2 px-6 py-3 text-text-primary"
        style={{
          borderColor: "#E7C9A9",
          boxShadow: "0 4px 18px -3px rgba(231,201,169,.42)",
        }}
      >
        {t("signIn")} →
      </Link>
    </main>
  );
}
