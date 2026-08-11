"use client";

// Предложение собрать свою комнату — регистрация по пути (тикет 38, турн 12c).
//
// МОМЕНТ. Доска говорит прямо: спрашиваем РОВНО ОДИН РАЗ и сразу после того,
// как гость сделал доброе дело. Поэтому блок живёт в успешном состоянии листа
// брони, а не в шапке комнаты и не всплывашкой поверх сцены.
//
// «РОВНО ОДИН РАЗ» держится отметкой в localStorage браузера: показали —
// больше не показываем никогда, чем бы дело ни кончилось (согласился, нажал
// «Потом» или просто закрыл лист). Отметка ставится в момент ПОКАЗА, а не
// ответа: «Потом» и молчание для нас одно и то же — второй раз не спрашиваем.
// Сервер об этом не знает и знать не должен: это вежливость, а не право
// доступа, и цена ошибки — лишний вопрос, а не утечка.
//
// ЧТО ТУТ НЕ ПРОИСХОДИТ. Ни одной строки о хозяйке и её комнате наружу не
// уходит: блок знает только то, что человек сам напечатал в брони (имя и
// почту). Тихая бронь (инвариант №1) этим блоком не задета — он про гостя.
import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { alreadyAsked, browserAskStore, rememberAsked } from "./ask-once";
import { startOwnRoomAction } from "./offer-actions";
import s from "./booking-dialog.module.css";

type Phase = "form" | "busy" | "sent";
type ErrorKey = "rate" | "validation" | "generic" | null;

type RoomOfferProps = {
  /** Имя из брони — поедет в онбординг, чтобы не спрашивать дважды. */
  guestName: string;
  /** Почта из брони: сюда уйдёт ссылка входа. Может быть пустой — поле есть. */
  guestEmail: string;
  /** Акцент комнаты (rooms.json) — «полоса света» главной кнопки. */
  accent: string;
};

export function RoomOffer({ guestName, guestEmail, accent }: RoomOfferProps) {
  const t = useTranslations("Booking");
  const router = useRouter();
  // Лист брони монтируется только по нажатию, уже после гидратации, — значит
  // localStorage здесь есть и ленивая инициализация безопасна (на сервере
  // этот компонент не рендерится ни разу).
  const [visible, setVisible] = useState(() => !alreadyAsked(browserAskStore()));
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<ErrorKey>(null);
  const [email, setEmail] = useState(guestEmail);
  const [birthday, setBirthday] = useState("");
  const fieldId = useId();
  // Поле спрашивает БЛИЖАЙШИЙ день рождения — так оно и подписано, поэтому
  // браузеру говорим нижнюю границу. С тикета 187 комната берёт отсюда только
  // день и месяц (год в этой строке — год праздника, а не год рождения), и
  // прошедшая дата ничего бы не сломала: ближайшая считается сама. Граница
  // осталась ради самой подписи. Считается на клиенте — компонент и живёт
  // только там, расхождения с сервером быть не может.
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (visible) rememberAsked(browserAskStore());
  }, [visible]);

  if (!visible) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === "busy") return;
    setPhase("busy");
    setError(null);

    const payload = new FormData();
    payload.set("email", email.trim());
    payload.set("name", guestName);
    payload.set("occasionDate", birthday);

    try {
      const result = await startOwnRoomAction(payload);
      if (result.status === "sent") {
        setPhase("sent");
        return;
      }
      if (result.status === "signedIn") {
        // Уже вошёл — письмо ни к чему, ведём прямо в онбординг (а если
        // комната у него есть, /onboarding сам вернёт его в /room).
        router.push("/onboarding");
        return;
      }
      setPhase("form");
      setError(
        result.status === "rate" ? "rate" : result.status === "validation" ? "validation" : "generic",
      );
    } catch {
      setPhase("form");
      setError("generic");
    }
  };

  if (phase === "sent") {
    return (
      <section className={s.offer}>
        <p className={s.offerTitle}>{t("offerSentTitle")}</p>
        <p className={s.offerBody}>{t("offerSentBody", { email: email.trim() })}</p>
      </section>
    );
  }

  return (
    <section className={s.offer}>
      <p className={s.offerTitle}>{t("offerTitle")}</p>
      <p className={s.offerBody}>{t("offerBody")}</p>

      <form onSubmit={submit}>
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${fieldId}-birthday`}>
            {t("offerDateLabel")}
          </label>
          <input
            id={`${fieldId}-birthday`}
            className={s.input}
            type="date"
            min={today}
            value={birthday}
            onChange={(event) => setBirthday(event.target.value)}
          />
          <p className={s.hint}>{t("offerDateHint")}</p>
        </div>

        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${fieldId}-email`}>
            {t("offerEmailLabel")}
          </label>
          <input
            id={`${fieldId}-email`}
            className={s.input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
            autoComplete="email"
          />
          <p className={s.hint}>{t("offerEmailHint")}</p>
        </div>

        {error && (
          <p className={s.error} role="alert">
            {t(error === "rate" ? "errRate" : error === "validation" ? "offerErrEmail" : "offerErr")}
          </p>
        )}

        <div className={s.offerFooter}>
          {/* «Полоса света» — главная кнопка везде (турн 22). */}
          <button
            type="submit"
            disabled={phase === "busy"}
            className="pressable w-full border-b-2 px-5 py-3.5 text-sm font-semibold text-text-primary disabled:opacity-60"
            style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
          >
            {phase === "busy" ? t("offerSubmitBusy") : `${t("offerSubmit")} →`}
          </button>
          {/* «Потом» ничего не блокирует: лист остаётся открытым, бронь на
              месте, и второй раз мы уже не спросим. */}
          <button type="button" className={`pressable ${s.quiet}`} onClick={() => setVisible(false)}>
            {t("offerLater")}
          </button>
        </div>
      </form>
    </section>
  );
}
