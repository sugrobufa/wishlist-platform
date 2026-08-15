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
      {/* НИТЬ — ГОТОВЫЙ РИСУНОК ДИЗАЙНА (тикет 248, пакет 56 → tag-thread.svg).
          Владелец: «как-то странно отрисована нитка». Дизайн подтвердил и
          назвал причину: «нить выходила из воздуха — контракт говорил „нить с
          узелком сверху" и ни с чем её не связывал». Теперь три дуги: два
          конца от кромки проёма вверх к узелку и третья ЧЕРЕЗ сам проём —
          нить видно сквозь отверстие, поэтому она с ним связана.

          Рисуется ВНЕ элемента с `clip-path`: скошенный торец бирки обрезал
          бы её вместе с бумагой. */}
      <svg
        className={s.thread}
        viewBox="0 0 124 60"
        width="124"
        height="60"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M16.5,50.5 C 15,40 10,28 7,16"
          fill="none"
          stroke="#C9A87A"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M16.5,50.5 C 19,40 12.5,26 7,16"
          fill="none"
          stroke="#B9946A"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        {/* Третья дуга — та, что идёт через проём: без неё нить снова повиснет
            над отверстием, не касаясь его. */}
        <path
          d="M12.5,56 Q 16.5,49.5 20.5,56"
          fill="none"
          stroke="#C9A87A"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <circle cx="7" cy="13" r="2.6" fill="#C9A87A" />
      </svg>
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
