"use client";

// «Остаться в связях с {name}?» — вопрос гостю на подтверждении брони
// (тикет 98b, доска 32a).
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ ПОСЛЕ ПРАЗДНИКА. Тикет 98 спрашивал обоих на своих
// экранах после праздника, и гость до того экрана мог не вернуться вовсе.
// Дизайн переставил вопрос в момент, когда человек уже сделал доброе дело:
// «тихим блоком ПОСЛЕ действия, не модалом», пропускаемо.
//
// ЧТО ОН НЕ ДЕЛАЕТ. Не создаёт связи — её ещё нет и не будет до «Дошло».
// Ответ ложится на СВОЮ бронь (по токену из cookie) и переносится в связь
// позже. Инвариант №4 цел: добавить человека этой кнопкой нельзя, можно
// только предложить показать своё имя тому, кому ты и так уже даришь.
import { useState } from "react";
import { useTranslations } from "next-intl";
import s from "./guest-booking.module.css";

type ConnectionOfferProps = {
  itemId: string;
  /** Имя хозяйки — вопрос всегда про конкретного человека. */
  ownerName: string;
  accent: string;
};

type Answer = "none" | "yes" | "no";

export function ConnectionOffer({ itemId, ownerName, accent }: ConnectionOfferProps) {
  const t = useTranslations("Consent");
  const [answer, setAnswer] = useState<Answer>("none");
  const [busy, setBusy] = useState(false);

  async function reply(offers: boolean) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/items/${itemId}/book/offer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offers }),
      });
      // Не получилось — молчим и оставляем вопрос: бронь уже сделана, и
      // ронять на человека отказ сети посреди доброго дела незачем.
      if (response.ok) setAnswer(offers ? "yes" : "no");
    } catch {
      // то же самое: вопрос остаётся, повторить можно
    } finally {
      setBusy(false);
    }
  }

  if (answer === "yes") {
    return (
      <p className={s.offerAnswered} style={{ color: accent }}>
        {t("guestPending", { name: ownerName })}
      </p>
    );
  }
  // «Подарить тихо» — тоже ответ: блок уходит совсем, уговоров нет.
  if (answer === "no") return null;

  return (
    <div className={s.offer}>
      <p className={s.offerTitle}>{t("offerTitle", { name: ownerName })}</p>
      <p className={s.offerBody}>{t("offerBody")}</p>
      <div className={s.offerRow}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void reply(true)}
          className="pressable"
          style={{ background: accent }}
        >
          {t("offerYes")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void reply(false)}
          className="pressable"
        >
          {t("offerNo")}
        </button>
      </div>
      <p className={s.offerHint}>{t("offerSkipHint")}</p>
    </div>
  );
}
