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
 * СОСТОЯНИЙ У ЭКРАНА ЧЕТЫРЕ, А НЕ ДВА (тикет 216): итог открыт · праздник
 * наступил, а итога нет · праздник впереди · комната без даты вовсе. Какое из
 * них сейчас и чем оно говорит — таблица `screen-state`, одна на разметку и на
 * тест; наступление праздника считает сервис тем же вопросом, которым тихая
 * строка комнаты, — раньше они считали порознь и разошлись.
 *
 * НАПОЛНЕНИЕ СОСТОЯНИЙ — СЛОВАМИ ПАКЕТА 48 (тикет 219, турны 54a и 54b):
 * порог с блоком «Что случится по нажатию» до нажатия, ожидание со счётчиком
 * забранного, комната без даты с громкой полосой к дате. Машина состояний та
 * же, что мы собрали утром, — переписано ровно то, чем каждое состояние
 * говорит.
 *
 * ЕДИНСТВЕННОЕ ЧИСЛО ДО РАСКРЫТИЯ — счётчик забранного по комнате
 * (`view.takenTotal`, инвариант №1): ни имени, ни названия вещи, ни списка.
 * Их у экрана до раскрытия и нет — сервис их не отдаёт вовсе.
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
  // Лид состояния. На пороге он несёт в себе счётчик забранного — то самое
  // единственное число, которое хозяйке видно до раскрытия (инвариант №1).
  const screenLead =
    screen.lead === null
      ? null
      : screen.taken === "lead"
        ? t(screen.lead, { count: view.takenTotal })
        : t(screen.lead);
  // Дата ближайшего праздника — тем же видом и тем же форматом, что в комнате
  // («День рождения · 14 сентября»): календарь платформы, пояс UTC.
  const nearestDate =
    view.next === null
      ? null
      : format.dateTime(new Date(view.next), {
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        });
  const nearestLine =
    screen.nearest && nearestDate
      ? t("nearestLine", { holiday: t("birthdayLabel"), date: nearestDate })
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
              {/* «Итог появится после праздника» без даты — половина ответа:
                  комната свою дату показывает, экран обязан показывать ту же
                  («День рождения · 14 сентября»). */}
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
            {screenLead && (
              <p className="text-[13.5px] leading-[1.6] text-text-body">{screenLead}</p>
            )}
            {/* «Комната работает и без даты — гости дарят»: у комнаты без
                праздника это вторая половина ответа, без неё первая звучит
                как поломка. */}
            {screen.aside && (
              <p className="text-[13.5px] leading-[1.6] text-text-muted">{t(screen.aside)}</p>
            )}

            {/* СЧЁТЧИК ЗАБРАННОГО БЛОКОМ — то же число, что в комнате, и
                единственное, что хозяйке видно до раскрытия (инвариант №1).
                `takenOnly` говорит это вслух: «Больше не покажем — даже
                себе». */}
            {screen.taken === "box" && (
              <div className="w-full border border-surface-hairline bg-[rgba(255,255,255,.03)] px-[17px] py-[15px]">
                <p className="text-[20px] font-bold leading-none text-text-primary">
                  {t("takenNumber", { count: view.takenTotal })}
                </p>
                <p className="mt-2 text-[12.5px] text-text-muted">{t("takenCaption")}</p>
                <p className="mt-3 text-xs leading-[1.5] text-text-faint">{t("takenOnly")}</p>
              </div>
            )}

            {/* «ЧТО СЛУЧИТСЯ ПО НАЖАТИЮ» — блок ДО нажатия, а не диалог
                поверх него (`warning.notADialog`): человек пришёл именно за
                этим. Раньше про необратимость говорила строка `hint`, то есть
                уже после раскрытия. */}
            {screen.whatHappens && (
              <div className="w-full">
                <p className="overline text-text-faint">{t("dueWhatOverline")}</p>
                <ul className="mt-3 flex flex-col gap-[11px]">
                  {screen.whatHappens.map((line) => (
                    <li
                      key={line}
                      className="flex items-start gap-[11px] text-[12.5px] leading-[1.5] text-text-body"
                    >
                      <svg
                        viewBox="0 0 17 17"
                        width="17"
                        height="17"
                        className="mt-[2px] flex-none"
                        aria-hidden
                      >
                        <circle cx="8.5" cy="8.5" r="2.4" fill={accent} />
                      </svg>
                      {t(line)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ПОЛОСА СВЕТА состояния. На пороге она открывает итог прямо
                здесь (перехода нет, стрелки нет); у комнаты без даты — ведёт к
                дате: итога у неё не будет никогда, и звать к нему нечем. */}
            {screen.loud?.action === "open" && <CloseOccasionButton accent={accent} tone="loud" />}
            {screen.loud?.action === "date" && (
              <div className="flex flex-col items-start gap-2.5">
                <Link
                  href="/settings"
                  className="pressable inline-flex items-center border-b-2 px-6 py-3 text-base font-bold text-text-primary"
                  style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
                >
                  {t(screen.loud.key)}
                </Link>
                <p className="text-xs leading-relaxed text-text-muted">{t(screen.loud.hint)}</p>
              </div>
            )}

            {/* ТИХАЯ ДОРОГА К РУЧНОМУ ИТОГУ — решение гриллинга №6: работает и
                без даты. Стоит на одном месте во всех состояниях, чтобы
                нашедший её однажды нашёл и в другом; громкость берётся из
                состояния (тикет 217) — гореть год до праздника ей нельзя. */}
            {screen.manual && (
              <div className="flex flex-col items-start gap-2">
                {screen.manual === "quiet" && (
                  <p className="overline text-text-faint">{t("manualOverline")}</p>
                )}
                <CloseOccasionButton accent={accent} tone={screen.manual} />
                {screen.manual === "quiet" && (
                  <p className="text-xs leading-relaxed text-text-muted">{t("manualHint")}</p>
                )}
              </div>
            )}

            {screen.dateLink && (
              <Link href="/settings" className="pressable text-[13px] font-medium text-text-body">
                {t("dateLink")}
              </Link>
            )}

            {/* Тихий выход с порога: раскрытие необратимо, и уйти, не открыв,
                должно быть так же просто, как открыть. */}
            {screen.notNow && (
              <Link href="/room" className="pressable text-[13px] font-medium text-text-body">
                {t("notNow")}
              </Link>
            )}

            {/* ПОДПИСИ «ПОЧЕМУ ЗДЕСЬ НЕТ КНОПКИ» БОЛЬШЕ НЕТ (пакет 49 снял
                `Occasion.aheadNoLoud`, тикет 223). Мы взяли её из контракта 48
                с сомнением и написали о нём письмом 53: строка объясняла
                хозяйке НАШЕ проектное решение — «горящая полоса семь месяцев
                подряд перестаёт что-либо значить». Дизайн согласился и пошёл
                дальше: её работу целиком делает `aheadHint`, а довод про
                полосу остался в контракте, где он и адресован — разработке. */}
          </div>
        )}
      </div>
    </main>
  );
}
