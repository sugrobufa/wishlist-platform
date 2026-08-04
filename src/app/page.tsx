import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth, signOut } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const t = await getTranslations("Home");
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="overline text-text-muted">{t("overline")}</p>
      <h1 className="display text-4xl md:text-6xl">{t("title")}</h1>
      <p className="max-w-md text-text-body">{t("subtitle")}</p>

      {session?.user ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-text-strong">{t("signedInAs", { email: session.user.email ?? "" })}</p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="pressable border border-white/16 px-6 py-3 text-text-strong"
            >
              {t("signOut")}
            </button>
          </form>
        </div>
      ) : (
        /* «Полоса света» — главная кнопка (tokens.json → button.primary) */
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
      )}
    </main>
  );
}
