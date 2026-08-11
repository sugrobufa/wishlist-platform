"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { acceptHolidayAction, skipHolidayAction } from "@/app/room/occasion-actions";

/**
 * ПЛАШКА ПРЕДЛОЖЕНИЯ ОБЩЕЙ ДАТЫ (тикет 198, пакет 44 → `occasions.json`).
 *
 * «Праздник не заводят — его принимают или нет.» Новый год, 8 марта и 23
 * февраля у всех в один день, и спрашивать про них в онбординге нечего: продукт
 * знает дату сам. Вопрос не «когда», а «показывать ли», и он задаётся тогда,
 * когда живой — за три недели до даты.
 *
 * СТОИТ В КАДРЕ, А НЕ В НИЖНЕЙ ПОЛОСЕ (globals.css → `.imm-offer`): полоса —
 * то место, которое кончается и режется баром (тикет 188), а сверху у кадра уже
 * лежит затемнение под шапку. Слой абсолютный, сосед вуали: **вещи и полки не
 * сдвигаются ни на пиксель**.
 *
 * ДВА ДЕЙСТВИЯ И НИ ОДНОГО ТРЕТЬЕГО. «Показать» — полоса света, главная кнопка
 * везде (турн 22). «Не в этом году» — тихая: она убирает плашку до следующего
 * года и МОЛЧИТ, никаких «точно?» и никаких подтверждений. Цена человеку,
 * которому праздник не нужен, — одно нажатие раз в год, и она дешевле неверной
 * догадки о нём (правило «оба и всем», см. `src/server/holidays.ts`).
 *
 * КРЕСТИКА НЕТ НАРОЧНО: закрыть плашку, ничего не ответив, значило бы задать
 * тот же вопрос завтра.
 */
export function OccasionOffer({
  holidayKey,
  daysLeft,
  accent,
}: {
  /** Ключ общей даты: `newYear` | `feb23` | `march8`. */
  holidayKey: "newYear" | "feb23" | "march8";
  /** Сколько суток до неё — число для строки «Через {left} {holiday}». */
  daysLeft: number;
  accent: string;
}) {
  const t = useTranslations("Occasion");
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  // Ответ уже дан — плашка уходит сразу, не дожидаясь round-trip'а: она про
  // ОДИН вопрос, и висеть после ответа ей незачем. Правду всё равно принесёт
  // router.refresh() (страница force-dynamic).
  const [answered, setAnswered] = useState(false);

  if (answered) return null;

  const answer = (act: () => Promise<unknown>) => {
    setAnswered(true);
    startTransition(async () => {
      await act();
      router.refresh();
    });
  };

  const holiday = t(HOLIDAY_LABEL[holidayKey]);

  return (
    <section className="imm-offer" aria-label={holiday}>
      <p className="imm-offer-title">
        {t("offerTitle", { left: t("offerLeft", { days: daysLeft }), holiday })}
      </p>
      <p className="imm-offer-line">{t("offerLine")}</p>
      <div className="imm-offer-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(() => acceptHolidayAction(holidayKey))}
          className="pressable imm-offer-show"
          style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
        >
          <span>{t("offerShow")}</span>
          {/* Стрелка типографская, а не знак набора: так же её пишут остальные
              полосы света (турн 12a оговаривает это отдельно). */}
          <span aria-hidden>→</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(() => skipHolidayAction(holidayKey))}
          className="pressable imm-offer-skip"
        >
          {t("offerSkip")}
        </button>
      </div>
    </section>
  );
}

/**
 * Имена общих дат — ключи словаря, а не строки в коде. Значения взяты из
 * контракта дословно (`occasions.json → threeKinds.common.list`).
 */
export const HOLIDAY_LABEL = {
  newYear: "holidayNewYear",
  feb23: "holidayFeb23",
  march8: "holidayMarch8",
} as const;
