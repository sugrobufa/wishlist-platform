import type { CSSProperties, ReactNode } from "react";

// Канонический набор иконок доски — турн 25a (тикет 52), плюс две иконки
// добавления фото из турна 24 (23a). Контракт пакета (tokens.json → icons):
// сетка 24, контур 1.7, скруглённые концы и углы, без заливки; глифов из
// шрифта в интерфейсе не бывает. Пути сняты с доски посимвольно — рисовать
// свои варианты этих знаков больше нельзя, только импортировать отсюда.
//
// Отклонения толщины у отдельных знаков (1.6 у двойной звезды, 1.9 у плюса,
// 2.1 у плюса в кружке таб-бара) — авторские, с доски: дизайн назвал их
// оптической компенсацией (Comments тикета 51). По той же причине галочка
// «Дошло» на размерах 11–13 px рисуется толщиной 3–3.2: канон рисован под
// 22–30 px, и на маленьком бейдже контур 1.7 исчезает. Толщину задаёт
// вызывающая сторона через `strokeWidth`.

export type IconProps = {
  /** Сторона квадрата в px; сетка всегда 24. */
  size?: number;
  /** Толщина контура; канон 1.7, отклонения — только авторские (см. выше). */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

export function Icon24({
  size = 24,
  strokeWidth = 1.7,
  className,
  style,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={style}
    >
      {children}
    </svg>
  );
}

/**
 * «Комната» — арка с тёплой точкой. Точка-лампа — единственная законная
 * заливка набора (tokens.json → icons.exception); в таб-баре она горит только
 * у активной вкладки — так рисует 25a (шторка против состояния «в списках»).
 */
export function IconRoom({ dot = true, ...props }: IconProps & { dot?: boolean }) {
  return (
    <Icon24 {...props}>
      <path d="M4 20.5V11a8 8 0 0 1 16 0v9.5" />
      <path d="M2.5 20.5h19" />
      {dot && <circle cx="8" cy="14" r="1.1" fill="currentColor" stroke="none" />}
    </Icon24>
  );
}

/** «Друзья» — двое, второй контуром позади. */
export function IconPeople(props: IconProps) {
  return (
    <Icon24 {...props}>
      <circle cx="9" cy="8.5" r="3.1" />
      <path d="M3.4 19.5c0-3.1 2.5-5.6 5.6-5.6s5.6 2.5 5.6 5.6" />
      <path d="M16.4 6.1a3.1 3.1 0 0 1 0 5.4" />
      <path d="M17.6 14.4c2.1.8 3.5 2.7 3.5 5.1" />
    </Icon24>
  );
}

/** «Добавить» — плюс; в наборе 1.9, в кружке таб-бара 2.1 (передать явно). */
export function IconPlus({ strokeWidth = 1.9, ...props }: IconProps) {
  return (
    <Icon24 strokeWidth={strokeWidth} {...props}>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </Icon24>
  );
}

/** «Профиль» по 25a — один человек. У нас это же — силуэт-заглушка аватара. */
export function IconPerson(props: IconProps) {
  return (
    <Icon24 {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
    </Icon24>
  );
}

/**
 * «Зал славы» — двойная звезда, авторская толщина 1.6. Одиночная звезда —
 * другой знак («Уже моё», 25b): навигация в зал — всегда двойная (тикет 51).
 */
export function IconHall({ strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <Icon24 strokeWidth={strokeWidth} {...props}>
      <path d="M13 2.8l2 5.6 5.6 2-5.6 2-2 5.6-2-5.6-5.6-2 5.6-2z" />
      <path d="M5.5 17.2l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </Icon24>
  );
}

/** «Подарок» — коробка с бантом. */
export function IconGift(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M3.5 9.5h17V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <path d="M3.5 13.5h17" />
      <path d="M12 9.5V21" />
      <path d="M12 9.5C10.6 6.9 9.4 5.5 8 5.5a2 2 0 0 0 0 4" />
      <path d="M12 9.5c1.4-2.6 2.6-4 4-4a2 2 0 0 1 0 4" />
    </Icon24>
  );
}

/** «Складчина» — часы: сбор идёт до праздника. */
export function IconPool(props: IconProps) {
  return (
    <Icon24 {...props}>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 3.3V12l7.6 4.3" />
    </Icon24>
  );
}

/** «Деньги» — ₽ контуром. Не глиф: знак отрисован путями, как весь набор. */
export function IconMoney(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M9 20.5V5h4.6a4.2 4.2 0 0 1 0 8.4H9" />
      <path d="M6.2 9.2h6.4" />
      <path d="M6.2 13.4h6.4" />
    </Icon24>
  );
}

/** «Скрыть» — перечёркнутый глаз (цену не видно). */
export function IconEyeOff(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M4.2 8.4C6.3 6.5 9 5.5 12 5.5c5.5 0 9.5 4 10.5 6.5-.4 1-1.4 2.4-2.9 3.7" />
      <path d="M16.4 17.6c-1.3.6-2.8.9-4.4.9-5.5 0-9.5-4-10.5-6.5.4-1.1 1.5-2.6 3.1-4" />
      <path d="M10 10.1a2.7 2.7 0 0 0 3.8 3.8" />
      <path d="M3.5 3.5l17 17" />
    </Icon24>
  );
}

/**
 * Открытый глаз — НАШ знак, канона в 25a нет (там только перечёркнутый).
 * Оставлен по решению тикета 51, дизайн спрошен письмом
 * (design/ANSWERS-turn-25.md); появится канон — заменить пути здесь, в одном
 * месте.
 */
export function IconEye(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </Icon24>
  );
}

/** «Приватность» — замок. */
export function IconLock(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </Icon24>
  );
}

/** «Поделиться» — стрелка из лотка (заменила наши три узла с рёбрами). */
export function IconShare(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M12 3v11.5" />
      <path d="M7.8 7.2L12 3l4.2 4.2" />
      <path d="M4.5 14v5.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V14" />
    </Icon24>
  );
}

/** «Напомнить» — колокольчик. */
export function IconBell(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M18.5 15.5V10a6.5 6.5 0 1 0-13 0v5.5L3.8 18.5h16.4z" />
      <path d="M9.8 21a2.4 2.4 0 0 0 4.4 0" />
    </Icon24>
  );
}

/** «Дата» — календарь с отмеченным днём (точка — заливка с доски). */
export function IconDate(props: IconProps) {
  return (
    <Icon24 {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3.5V6" />
      <path d="M16 3.5V6" />
      <circle cx="12" cy="14.5" r="2.2" fill="currentColor" stroke="none" />
    </Icon24>
  );
}

/** «Перенести» — лист с загнутым углом. */
export function IconMove(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M14.5 3.5H6a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M14.5 3.5V8a.5.5 0 0 0 .5.5h4.5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16.5h4" />
    </Icon24>
  );
}

/** «Удалить» — корзина. */
export function IconTrash(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M4.5 7.5h15" />
      <path d="M9.5 7.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.5" />
      <path d="M6.5 7.5l.9 12a1 1 0 0 0 1 .95h7.2a1 1 0 0 0 1-.95l.9-12" />
    </Icon24>
  );
}

/** «Изменить» — карандаш. */
export function IconEdit(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M17.5 3.9l2.6 2.6a1.3 1.3 0 0 1 0 1.9L9.4 19.1l-5.2 1 1-5.2L15.6 3.9a1.3 1.3 0 0 1 1.9 0z" />
      <path d="M14.2 5.3l4.5 4.5" />
    </Icon24>
  );
}

/** «В магазин» — стрелка, уходящая вправо с разворота. */
export function IconShop(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M14.5 5.5L21 12l-6.5 6.5" />
      <path d="M21 12H8.5a5 5 0 0 0-5 5v2" />
    </Icon24>
  );
}

/** «Дошло» — галочка. На бейджах 11–13 px толщину передать явно (3–3.2). */
export function IconCheck(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Icon24>
  );
}

/** «Снять фото» — камера, турн 24 (23a). */
export function IconCamera(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M3.5 7.5h4l1.6-2.2h5.8L18.5 7.5h2v11.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </Icon24>
  );
}

/** «Из галереи» — рамка с горами, турн 24 (23a); заменила нашу с кружком. */
export function IconGallery(props: IconProps) {
  return (
    <Icon24 {...props}>
      <path d="M4 5.5h16v13H4z" />
      <path d="M4 15l4.5-4 4 3.5 3-2.5L20 16" />
    </Icon24>
  );
}
