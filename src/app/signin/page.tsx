import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { signIn } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const t = await getTranslations("SignIn");
  const { sent } = await searchParams;
  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="overline text-text-muted">{t("overline")}</p>
      <h1 className="display text-3xl md:text-5xl">{t("title")}</h1>

      {sent ? (
        <p className="max-w-md text-text-body">{t("sent")}</p>
      ) : (
        <form
          className="flex w-full max-w-sm flex-col gap-4"
          action={async (formData) => {
            "use server";
            const email = String(formData.get("email") ?? "").trim();
            if (!email) return;
            await signIn("nodemailer", { email, redirect: false });
            redirect("/signin?sent=1");
          }}
        >
          <label className="text-left text-sm text-text-muted" htmlFor="email">
            {t("emailLabel")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="border border-white/16 bg-white/5 px-4 py-3 text-text-primary outline-none focus:border-white/40"
            placeholder="you@example.com"
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
      )}

      {googleEnabled && !sent && (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="pressable border border-white/16 px-6 py-3 text-text-strong"
          >
            {t("google")}
          </button>
        </form>
      )}
    </main>
  );
}
