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
import { useEffect, useId, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ShopLink } from "@/components/zone/shop-link";
import { useGuestBooking } from "./booking-context";
import { GiftTag } from "./gift-tag";
import s from "./booking-dialog.module.css";

type BookingDialogProps = {
  item: { id: string; title: string; shop?: { url: string; domain: string } | null };
  ownerName: string;
  /** Акцент комнаты из rooms.json — рамки активных элементов листа. */
  accent: string;
  onClose: () => void;
};

type Phase = "form" | "busy" | "done";
type ErrorKey = "taken" | "rate" | "validation" | "generic" | null;

export function BookingDialog({ item, ownerName, accent, onClose }: BookingDialogProps) {
  const t = useTranslations("Booking");
  const tShop = useTranslations("Shop");
  const { markBooked, markTaken } = useGuestBooking();
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<ErrorKey>(null);
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
      if (response.status === 409) {
        // Кто-то успел раньше — вещь честно помечаем занятой.
        markTaken(item.id);
        setError("taken");
      } else if (response.status === 429) {
        setError("rate");
      } else if (response.status === 400) {
        setError("validation");
      } else {
        setError("generic");
      }
    } catch {
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
            {shopBlock}
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

            {error && (
              <p className={s.error} role="alert">
                {t(
                  error === "taken"
                    ? "errTaken"
                    : error === "rate"
                      ? "errRate"
                      : error === "validation"
                        ? "errValidation"
                        : "errGeneric",
                )}
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
