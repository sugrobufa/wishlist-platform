import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { getOccasionView } from "@/server/services/occasions";
import { rooms } from "@/config/design";
import { formatHallMoney } from "@/app/room/hall/money";
import { CloseOccasionButton, OccasionRows } from "./occasion-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Occasion");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * «Что подарили» (тикет 10, турн 21a) — экран-итог праздника. Имена
 * дарителей раскрываются ровно здесь и ровно один раз (инвариант №2):
 * до закрытия праздника сервис не отдаёт ни строк, ни имён — страница
 * показывает пустое состояние с кнопкой «праздник прошёл».
 */
export default async function OccasionPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = await getSessionUserId(session.user);
  if (!userId) redirect("/signin");

  const room = await getRoomForUser(userId);
  if (!room) redirect("/onboarding");

  const t = await getTranslations("Occasion");
  const tGoal = await getTranslations("Goal");
  const locale = await getLocale();
  const format = await getFormatter();
  const preset = rooms.find((candidate) => candidate.id === room.preset);
  const accent = preset?.accent ?? "#E7C9A9";
  const ink = preset?.ink ?? "#241A0E";

  const view = await getOccasionView(userId);
  const giftsTotal = view.pending.length + view.received.length;

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto w-full max-w-xl px-5 lg:px-0">
        <header className="pb-6 pt-6 lg:pt-10">
          <Link href="/room" className="pressable text-xs font-semibold text-text-strong">
            ← {t("backToRoom")}
          </Link>

          {view.summary ? (
            <>
              {/* «14 марта · праздник прошёл» — дата итога, не клика.
                  Дата хранится полуночью UTC → форматируем в UTC, чтобы день
                  не съехал ни в одном поясе. */}
              <p className="overline mt-6" style={{ color: accent }}>
                {t("overlineClosed", {
                  date: format.dateTime(new Date(view.summary.date), {
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  }),
                })}
              </p>
              <h1 className="display mt-3 text-3xl lg:text-4xl">
                {giftsTotal > 0 ? t("headline", { count: giftsTotal }) : t("emptyTitle")}
              </h1>
            </>
          ) : (
            <>
              <p className="overline mt-6 text-text-muted">{t("title")}</p>
              <h1 className="display mt-3 text-3xl lg:text-4xl">{t("notClosedTitle")}</h1>
            </>
          )}
        </header>

        {view.summary ? (
          <>
            {view.pending.length > 0 && (
              <div
                className="mb-4 flex items-center gap-2.5 border px-3.5 py-3"
                style={{ borderColor: `${accent}4D`, background: `${accent}1A` }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke={accent}
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="flex-none"
                  aria-hidden
                >
                  <path d="M13 2.8l2 5.6 5.6 2-5.6 2-2 5.6-2-5.6-5.6-2 5.6-2z" />
                </svg>
                <p className="text-xs text-text-body">{t("hint")}</p>
              </div>
            )}

            {giftsTotal > 0 ? (
              <OccasionRows
                pending={view.pending}
                received={view.received}
                accent={accent}
                ink={ink}
              />
            ) : (
              <p className="text-sm text-text-muted">{t("emptyHint")}</p>
            )}

            {/* Копилка на мечту (тикет 44, доска — турн 6): «Просто деньги ·
                Вложились трое · 22 000 ₽» и имена. До этого экрана хозяйка не
                видела ни суммы, ни числа участников — раскрытие живёт ровно
                здесь и ровно один раз (инварианты №1 и №2). */}
            {view.goal && (
              <div className="mt-8 border-t border-surface-hairline pt-5">
                <p className="overline" style={{ color: accent }}>
                  {tGoal("badge")}
                </p>
                <p className="mt-2.5 text-[13px] font-semibold text-text-primary">
                  {view.goal.title}
                </p>
                <p className="mt-1.5 text-[10.5px] font-medium text-text-muted">
                  {tGoal("revealedRow", {
                    count: view.goal.givers.length,
                    amount: formatHallMoney(view.goal.pledged, view.goal.currency, locale),
                  })}
                </p>
                <p className="mt-2.5 text-xs leading-relaxed text-text-body">
                  {view.goal.givers.join(" · ")}
                </p>
              </div>
            )}

            {view.unclaimedCount > 0 && (
              <div className="mt-8 border-t border-surface-hairline pt-5">
                <p className="overline text-text-faint">
                  {t("unclaimed", { count: view.unclaimedCount })}
                </p>
                <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
                  {t("unclaimedHint")}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex max-w-md flex-col gap-5">
            <p className="text-sm leading-relaxed text-text-muted">{t("notClosedHint")}</p>
            {/* Ручное закрытие — решение гриллинга №6: работает и без даты. */}
            <CloseOccasionButton accent={accent} />
          </div>
        )}
      </div>
    </main>
  );
}
