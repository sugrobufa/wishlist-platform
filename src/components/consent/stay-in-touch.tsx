"use client";

// «Остаться на связи?» (тикет 98, доска Б12) — один блок на два экрана:
// «что подарили» у хозяйки и «Друзья» у дарителя. Спрашивают обоих, поэтому
// и вопрос один и тот же; на доске он нарисован только со стороны хозяйки,
// со второй стороны мы держим ту же форму (письмо дизайну — задание 16).
//
// Блок ничего не раскрывает сам: строки приходят с сервера уже проверенными
// (`listPendingConsent`), имена в них — те же, что экран «что подарили» уже
// показал по инварианту №2.
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { IconPerson } from "@/components/icons";
import type { PendingConsentRow } from "@/server/services/connections";
import {
  respondToAllPendingAction,
  respondToConnectionAction,
  type ConsentActionResult,
} from "@/app/connections/actions";

type StayInTouchProps = {
  rows: PendingConsentRow[];
  accent: string;
  ink: string;
  /**
   * `bulk` — форма доски: «Со всеми N» плюс поштучный выбор (экран «что
   * подарили», где вопрос и возникает). `plain` — только поштучно: у второй
   * стороны вопрос обычно один, и кнопка «со всеми» звучала бы странно.
   */
  variant?: "bulk" | "plain";
  /** Отступы блока задаёт экран: под шапкой и в конце страницы они разные. */
  className?: string;
};

/** Аватар собеседника: фото — или тихий силуэт (как в списке друзей). */
function Face({ url }: { url: string | null }) {
  return (
    <span
      aria-hidden
      className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-surface-hairline bg-surface-fill"
      style={
        url
          ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }
          : undefined
      }
    >
      {!url && <IconPerson size={20} className="text-text-faint" />}
    </span>
  );
}

export function StayInTouch({
  rows,
  accent,
  ink,
  variant = "plain",
  className = "mt-8 border-t border-surface-hairline pt-5",
}: StayInTouchProps) {
  const t = useTranslations("Consent");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  if (rows.length === 0) return null;

  // Ответ обновляет страницу сам (revalidatePath в экшене): строка исчезает
  // из вопроса, а при согласии обеих сторон появляется в друзьях.
  function answer(key: string, run: () => Promise<ConsentActionResult>) {
    setBusy(key);
    setFailed(false);
    startTransition(async () => {
      const result = await run();
      setBusy(null);
      if (result?.error) setFailed(true);
    });
  }

  // «Выбрать» с доски — это не отдельный экран, а то, что уже есть на этом:
  // список с ответом у каждой строки. Кнопка «со всеми» просто отвечает разом.
  const waiting = rows.filter((row) => !row.answered);

  return (
    <section className={className} aria-label={t("title")}>
      <p className="overline" style={{ color: accent }}>
        {t("badge")}
      </p>
      <h2 className="display mt-2 text-lg">{t("title")}</h2>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">{t("hint")}</p>

      {failed && <p className="mt-3 text-sm text-text-muted">{t("errGeneric")}</p>}

      {variant === "bulk" && waiting.length > 1 && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => answer("all", () => respondToAllPendingAction(true))}
          className="pressable mt-4 border-b-2 px-5 py-2.5 text-[13px] font-semibold text-text-primary disabled:opacity-60"
          style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
        >
          {t("agreeAll", { count: waiting.length })}
        </button>
      )}

      <ul className="mt-4 flex flex-col gap-px bg-surface-hairline">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 bg-surface-app-ground py-3">
            <Face url={row.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text-primary">
                {row.displayName ?? t("nameFallback")}
              </p>
              <p className="mt-1.5 text-[11px] leading-snug text-text-muted">
                {row.giftTitle ? t("rowGift", { title: row.giftTitle }) : t("rowPlain")}
              </p>
            </div>

            {row.answered ? (
              // Своё «да» уже сказано. Чужой ответ не показываем никогда:
              // отказ — личное дело, объясняться человек не должен.
              <span className="flex-none text-[11px] font-medium text-text-faint">
                {t("waiting")}
              </span>
            ) : (
              <div className="flex flex-none items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => answer(row.id, () => respondToConnectionAction(row.id, false))}
                  className="pressable min-h-11 px-3 text-[11px] font-semibold text-text-muted disabled:opacity-60"
                >
                  {t("decline")}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => answer(row.id, () => respondToConnectionAction(row.id, true))}
                  className="pressable min-h-11 px-3.5 text-[11px] font-bold disabled:opacity-60"
                  style={{ background: accent, color: ink }}
                >
                  {t("agree")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
