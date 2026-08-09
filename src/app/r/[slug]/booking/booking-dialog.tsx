"use client";

// Лист тихой брони (тикет 08, US 25): имя обязательно, email опционально
// («напомним за 3 дня до праздника»), режим «тихо» / «подписаться под
// подарком» (SIGNED: подпись видна хозяйке только ПОСЛЕ праздника).
// Подтверждение — кнопка-бирка (единственное её применение, турн 22).
// Успех — «Вещь занята. Никому не скажем», вещь помечается занятой без
// перезагрузки (booking-context).
//
// Блок «Где купить» (тикет 37) стоит в листе дважды и намеренно: до брони —
// потому что здесь гость решает, потянет ли он подарок; после брони — потому
// что именно тут кончался сценарий продукта («забронировал и не знает, где
// оно продаётся»). Ссылку приносит guest-DTO, лист её не добывает.
//
// Предложение собрать свою комнату (тикет 38) — тоже здесь и только в
// успешном состоянии: доска просит спрашивать ровно один раз и ровно в тот
// момент, когда человек сделал доброе дело. Имя и почту оно берёт из этой же
// формы — второй раз их печатать не придётся.
import { useEffect, useId, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ShopLink } from "@/components/zone/shop-link";
import { useGuestBooking } from "./booking-context";
import {
  bookingErrorKey,
  marksItemTaken,
  BOOKING_ERROR_MESSAGE,
  type BookingErrorKey,
} from "./booking-errors";
import { GiftTag } from "./gift-tag";
import { ConnectionOffer } from "./connection-offer";
import { RoomOffer } from "./room-offer";
import s from "./booking-dialog.module.css";

type BookingDialogProps = {
  item: { id: string; title: string; shop?: { url: string; domain: string } | null };
  ownerName: string;
  /** Акцент комнаты из rooms.json — рамки активных элементов листа. */
  accent: string;
  onClose: () => void;
};

type Phase = "form" | "busy" | "done";

export function BookingDialog({ item, ownerName, accent, onClose }: BookingDialogProps) {
  const t = useTranslations("Booking");
  const tShop = useTranslations("Shop");
  // Строка приватности живёт в словаре комнаты гостя (турн 12b) и там же
  // и остаётся: тикет 77 сменил ей МЕСТО НА ЭКРАНЕ, а не владельца.
  const tGuest = useTranslations("GuestRoom");
  const { markBooked, markTaken, signedIn } = useGuestBooking();
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<BookingErrorKey | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"QUIET" | "SIGNED">("QUIET");
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === "busy") return;
    if (name.trim() === "") {
      setError("validation");
      return;
    }
    setPhase("busy");
    setError(null);
    try {
      const response = await fetch(`/api/v1/items/${encodeURIComponent(item.id)}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), mode }),
      });
      if (response.ok) {
        markBooked(item.id);
        setPhase("done");
        return;
      }
      setPhase("form");
      // Код из тела точнее статуса: 409 несут и «занято», и «вещь не „хочу"».
      let code: string | null = null;
      try {
        const payload = (await response.json()) as { error?: { code?: string } };
        code = payload.error?.code ?? null;
      } catch {
        // Тело не JSON (прокси, 502) — разбор упадёт на статус.
      }
      const key = bookingErrorKey(code, response.status);
      if (marksItemTaken(key)) markTaken(item.id);
      setError(key);
    } catch {
      // Сеть не дошла вовсе — тут кода нет и быть не может.
      setPhase("form");
      setError("generic");
    }
  };

  // Лист — портал в body: сцена живёт в transform-контексте (наезд камеры),
  // position:fixed внутри него считался бы от сцены, не от окна. Компонент
  // монтируется только по клику (после гидратации) — document здесь есть всегда.
  // Один блок на оба состояния листа: «Где купить» + строка магазина.
  const shopBlock = item.shop ? (
    <section className={s.shop}>
      <p className={s.shopTitle}>{tShop("title")}</p>
      <ShopLink itemId={item.id} url={item.shop.url} domain={item.shop.domain} place="sheet" />
    </section>
  ) : null;

  return createPortal(
    <div
      className={s.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={s.sheet}
        style={{ "--bk-accent": accent } as CSSProperties}
      >
        {phase === "done" ? (
          <div className={s.done}>
            <p className={s.overline}>{t("dialogOverline")}</p>
            <p className={s.doneTitle} id={titleId}>
              {t("successTitle")}
            </p>
            <p className={s.doneHint}>{t("successHint")}</p>
            {/* Вопрос связи — ОТДЕЛЬНОЙ плашкой сразу под строкой брони
                (тикет 98b, доска 32a): появляется вместе с подтверждением,
                не позже. Гостю без аккаунта не показывается — связывать
                некого, и сервер такой ответ всё равно не примет. */}
            {signedIn && (
              <ConnectionOffer itemId={item.id} ownerName={ownerName} accent={accent} />
            )}
            {shopBlock}
            {/* Имя и почта — те самые, что человек напечатал строкой выше;
                наружу они не уходят никуда, кроме его собственной комнаты. */}
            <RoomOffer guestName={name.trim()} guestEmail={email.trim()} accent={accent} />
            <div className={s.footer}>
              <button type="button" className={`pressable ${s.quiet}`} onClick={onClose}>
                {t("close")}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className={s.overline}>{t("dialogOverline")}</p>
            <h2 className={s.title} id={titleId}>
              {item.title}
            </h2>

            {shopBlock}

            {/* «Регистрация не нужна · {имя} не узнает, кто смотрел» (турн 12b).
                Стояло на первом экране комнаты; тикет 77 убрал его оттуда с
                телефона как лишнее и перенёс СЮДА — в момент, когда человек
                как раз печатает своё имя и вправе знать, что за этим не
                последует аккаунта. */}
            <p className={s.privacy}>{tGuest("noSignup", { name: ownerName })}</p>

            <div className={s.field}>
              <label className={s.fieldLabel} htmlFor={`${titleId}-name`}>
                {t("nameLabel")}
              </label>
              <input
                id={`${titleId}-name`}
                className={s.input}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
                autoComplete="name"
                autoFocus
              />
            </div>

            <div className={s.field}>
              <label className={s.fieldLabel} htmlFor={`${titleId}-email`}>
                {t("emailLabel")}
              </label>
              <input
                id={`${titleId}-email`}
                className={s.input}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                autoComplete="email"
              />
              <p className={s.hint}>{t("emailHint")}</p>
            </div>

            <div className={s.modes} role="radiogroup" aria-label={t("modeLegend")}>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "QUIET"}
                className={`pressable ${s.mode}${mode === "QUIET" ? ` ${s.modeActive}` : ""}`}
                onClick={() => setMode("QUIET")}
              >
                <span className={s.modeTitle}>{t("modeQuietTitle")}</span>
                <p className={s.modeHint}>{t("modeQuietHint")}</p>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "SIGNED"}
                className={`pressable ${s.mode}${mode === "SIGNED" ? ` ${s.modeActive}` : ""}`}
                onClick={() => setMode("SIGNED")}
              >
                <span className={s.modeTitle}>{t("modeSignedTitle")}</span>
                <p className={s.modeHint}>{t("modeSignedHint", { name: ownerName })}</p>
              </button>
            </div>

            {/* Что видят ОСТАЛЬНЫЕ гости — одинаково при обоих режимах (тикет
                105, доска Б11, решение владельца 08.08): «уже дарят» и ни
                слова о том, кто. Строка стоит под выбором режима, потому что
                выбор читается как «показать имя всем» — а он не про это:
                подпись видит только хозяйка и только после праздника. */}
            <p className={s.guestsNote}>{t("modeGuestsNote")}</p>

            {error && (
              <p className={s.error} role="alert">
                {t(BOOKING_ERROR_MESSAGE[error])}
              </p>
            )}

            <div className={s.footer}>
              <GiftTag
                size="sheet"
                type="submit"
                disabled={phase === "busy"}
                forName={t("tagFor", { name: ownerName })}
                label={phase === "busy" ? t("confirmBusy") : t("confirm")}
              />
              <button type="button" className={`pressable ${s.quiet}`} onClick={onClose}>
                {t("notNow")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
