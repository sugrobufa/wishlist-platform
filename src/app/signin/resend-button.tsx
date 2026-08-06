"use client";

// Повтор отправки с таймером — с доски (турн 13a, шаг 2): «Отправить снова
// через 0:42». Таймер — вежливость экрана, а не защита: он объясняет, что
// письмо уже едет, и не даёт колотить по кнопке. Серверного лимита у
// отправки нет и не появилось (механика — тикет 19, не трогаем).
//
// Без JS кнопка не появится вовсе (SSR рисует тихую строку) — рядом всегда
// работает «Другая почта», обычная ссылка на /signin.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** Стартовое ожидание, секунд. На доске таймер пойман на отметке 0:42. */
const RESEND_DELAY_S = 60;

export function ResendButton() {
  const t = useTranslations("SignIn");
  const [left, setLeft] = useState(RESEND_DELAY_S);

  useEffect(() => {
    if (left === 0) return;
    const tick = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(tick);
  }, [left]);

  if (left > 0) {
    const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    return (
      <span className="inline-flex min-h-[44px] items-center text-[12.5px] font-medium text-text-muted">
        {t("resendIn", { time })}
      </span>
    );
  }

  return (
    <button
      type="submit"
      className="pressable inline-flex min-h-[44px] items-center text-[12.5px] font-semibold text-[#E7C9A9]"
    >
      {t("resend")}
    </button>
  );
}
