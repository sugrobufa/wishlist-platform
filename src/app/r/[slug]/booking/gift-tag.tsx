"use client";

// Кнопка-бирка «подарить» (tokens.json → button.gift, турн 22).
// По конвенции CLAUDE.md это ЕДИНСТВЕННОЕ действие с такой кнопкой —
// компонент живёт в гостевой папке и наружу не экспортируется.
import s from "./gift-tag.module.css";

type GiftTagProps = {
  /**
   * ИМЕНИ ПОЛУЧАТЕЛЯ НА БИРКЕ БОЛЬШЕ НЕТ (тикет 248, пакет 55 → tag-geometry).
   * Оно уже стоит в шапке гостевой комнаты — на бирке это третий повтор, и
   * именно он держал её высоту. Ключ `Booking.tagFor` жив и остаётся в диалоге
   * брони, где имя произносится один раз и к месту.
   */
  /** Надпись бирки: «Подарить» на плитке, «Подарить это» в листе. */
  label: string;
  /**
   * РАЗМЕР У БИРКИ ОДИН — 124×44 на любой карточке (пакет 55, турн 61b), и
   * различие осталось только в месте. Прежде `tile` тянулся по контейнеру и
   * на широкой карточке разъезжался во всю ширину экрана: «218×66» читалось
   * как размер по умолчанию, который можно переопределить. Теперь ширину
   * задаёт содержимое.
   */
  size?: "tile" | "sheet";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
};

export function GiftTag({
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
          <span className={s.label}>{label}</span>
        </span>
      </span>
    </button>
  );
}
