"use client";

// Кнопка-бирка «подарить» (tokens.json → button.gift, турн 22).
// По конвенции CLAUDE.md это ЕДИНСТВЕННОЕ действие с такой кнопкой —
// компонент живёт в гостевой папке и наружу не экспортируется.
import s from "./gift-tag.module.css";

type GiftTagProps = {
  /** Строка над надписью — «для {имя}» (имя получателя на бирке). */
  forName: string;
  /** Надпись бирки: «Подарить» на плитке, «Подарить это» в листе. */
  label: string;
  /** tile — компактная на плитке; sheet — канонические 218×66 в листе брони. */
  size?: "tile" | "sheet";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
};

export function GiftTag({
  forName,
  label,
  size = "tile",
  type = "button",
  disabled = false,
  onClick,
}: GiftTagProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${s.root} ${size === "sheet" ? s.sheet : s.tile}`}
    >
      <span className={s.thread} aria-hidden />
      <span className={s.knot} aria-hidden />
      <span className={s.body}>
        <span className={s.paper} aria-hidden />
        <span className={s.fold} aria-hidden />
        <span className={s.hole} aria-hidden />
        <span className={s.text}>
          <span className={s.for}>{forName}</span>
          <span className={s.label}>{label}</span>
        </span>
      </span>
    </button>
  );
}
