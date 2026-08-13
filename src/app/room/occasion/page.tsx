import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoomForUser, getSessionUserId } from "@/server/services/rooms";
import { getOccasionView } from "@/server/services/occasions";
import { rooms } from "@/config/design";
import { formatHallMoney } from "@/app/room/hall/money";
import { StayInTouch } from "@/components/consent/stay-in-touch";
import { CloseOccasionButton, OccasionRows } from "./occasion-client";
import { OCCASION_SCREEN, occasionScreenState } from "./screen-state";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Occasion");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * «Что подарили» (тикет 10, турн 21a) — экран-итог праздника. Имена
 * дарителей раскрываются ровно здесь и ровно один раз (инвариант №2):
 * до закрытия праздника сервис не отдаёт ни строк, ни имён.
 *
 * СОСТОЯНИЙ У ЭКРАНА ТРИ, А НЕ ДВА (тикет 216): итог открыт · праздник
 * наступил, а итога нет · праздник впереди (плюс комната без даты вовсе).
 * Какое из них сейчас и чем оно говорит — таблица `screen-state`, одна на
 * разметку и на тест; наступление праздника считает сервис тем же вопросом,
 * которым тихая строка комнаты, — раньше они считали порознь и разошлись.
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
  const screen = OCCASION_SCREEN[occasionScreenState(view)];
  const screenTitle = screen.title === null ? null : t(screen.title);
  const screenHint = screen.hint === null ? null : t(screen.hint);
  // Дата ближайшего праздника — тем же видом и тем же форматом, что в комнате
  // («День рождения · 14 сентября»): календарь платформы, пояс UTC.
  const nearestLine =
    screen.nearest && view.next
      ? t("nearestLine", {
          holiday: t("birthdayLabel"),
          date: format.dateTime(new Date(view.next), {
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          }),
        })
      : null;

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
              <h1 className="display mt-3 text-3xl lg:text-4xl">{screenTitle}</h1>
              {/* «Праздник ещё впереди» без даты — половина ответа: комната
                  свою дату показывает, экран обязан показывать ту же. */}
              {nearestLine && <p className="overline mt-3 text-text-muted">{nearestLine}</p>}
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
                // Висящий вопрос = друга ещё нет (тикет 98). Проверять
                // список друзей ради одной ссылки не идём: вопрос и есть
                // ровно то состояние, в котором обещать друга нельзя.
                connectionReady={view.consent.length === 0}
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

            {/* «Остаться на связи?» (тикет 98, доска Б12) — здесь и только
                здесь вопрос возникает сам: связь родил подарок, отмеченный
                строкой выше. Форма доски: «Со всеми N» плюс выбор поштучно. */}
            <StayInTouch rows={view.consent} accent={accent} ink={ink} variant="bulk" />

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
          <div className="flex max-w-md flex-col items-start gap-5">
            <p className="text-sm leading-relaxed text-text-muted">{screenHint}</p>
            {/* Ручное закрытие — решение гриллинга №6: работает и без даты.
                Тон берётся из состояния (тикет 217): горит, только когда дело
                есть прямо сейчас, а не десять месяцев до праздника. */}
            {screen.close && <CloseOccasionButton accent={accent} tone={screen.close} />}
            {/* Комнате без дня рождения сказать «когда он пройдёт» нечем —
                у неё одна дорога, и это назвать дату. */}
            {screen.settings && (
              <Link href="/settings" className="pressable text-xs font-semibold text-text-strong">
                {t("toSettings")}
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
