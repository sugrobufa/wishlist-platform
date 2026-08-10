// Строка списка зоны — форма экрана «зона целиком списком» (тикет 152,
// закрывает 144). Контракт целиком — `design/package/handoff/zone-row.json`,
// числа и разбор «почему так» лежат в соседнем zone-row.module.css.
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ КОМПОНЕНТ, А НЕ ПРАВКА `room-list`. В вердикте пакета
// три экрана с общими правилами и РАЗНЫМИ формами: сетка — ярусы; список
// зоны — строки 52 со знаками; комната списком — секции-зоны, без знаков.
// Экран зоны брал строку у «комнаты списком» и добавлял к ней знаки действий:
// от этого имени оставалось 71 px на 375. Правка в общем модуле развела бы
// два экрана в одну кучу — поэтому у списка зоны своя строка, а «комната
// списком» остаётся ровно такой, какой была.
//
// ФОРМА ОДНА НА ХОЗЯЙКУ И ГОСТЯ. Разница ровно в одном узле: у гостя знака
// «⋯» нет вовсе (у него одно действие, и оно бирка в карточке) — не рисуется
// `trailing`, и имени достаётся +38 px. Ширина имени нигде не задана числом:
// она ОСТАТОК полосы, поэтому «то же минус знак» получается само.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Состояния «занято» («уже дарят» вместо цены) в
// компоненте нет: единственный экран, который его показал бы, — гостевой
// список зоны, а такого экрана в продукте пока не существует (у гостя зона
// живёт плитками в сцене). Хозяйке этого состояния нельзя показывать никогда
// — тихая бронь, инвариант №1. Заводить проп, который всегда false, мы не
// станем: ровно так однажды вернулись «пунктирные» поля плитки.
import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { IconEyeOff } from "@/components/icons";
import { DESIRE_DREAM } from "@/components/item/desire-scale";
import { PoolIcon } from "@/components/pool-icons";
import s from "./zone-row.module.css";

/** Знак зоны на пустой миниатюре — 18 px при .35 (контракт → form.thumb). */
const MARK_SIZE = 18;

/** Знак «спрятана» перед ценой — 16 px (контракт → states.hidden). */
const HIDDEN_MARK_SIZE = 16;

/**
 * Кегль знака «⋯» в конце строки — 20 (контракт → form.trailing.glyph).
 * Сам знак строит вызывающая сторона (у неё лист действий и словарь), но
 * число это СТРОКИ, поэтому живёт здесь, рядом с остальной её геометрией.
 */
export const ZONE_ROW_GLYPH = 20;

export type ZoneRowProps = {
  /**
   * Куда ведёт строка. Дорога в вещь — САМА СТРОКА: отдельного знака
   * «Изменить» в списке зоны нет, его роль играет строка целиком. Без адреса
   * (режим выбора у хозяйки) полоса остаётся неинтерактивной.
   */
  href?: string;
  title: string;
  photoUrl: string | null;
  /** Значок пула ЗОНЫ на пустой миниатюре (tileAppearance → poolIcon). */
  poolIcon?: string | null;
  /** Буква названия — запасной путь там, где у пула значка нет (тикет 68). */
  monogram?: string | null;
  /** Готовая строка цены; null — цены нет (витрина, скрытая цена, инвариант №8). */
  price?: string | null;
  /** Степень желания 1–4 из DTO. Огонёк горит только у верхней ступени. */
  desire?: number | null;
  /** Акцент комнаты: им горят огонёк и знак зоны на пустой миниатюре. */
  accent: string;
  /** Спрятана хозяйкой: строка глушится и перед ценой встаёт знак. */
  hidden?: boolean;
  /** Знак «⋯» в конце. У гостя его нет вовсе — тогда имени +38 px. */
  trailing?: ReactNode;
  /** Кружок выбора слева — режим массового скрытия у хозяйки (тикет 74). */
  leading?: ReactNode;
  /** Вопрос-подтверждение под строкой: в её 52 он не помещается. */
  children?: ReactNode;
};

export function ZoneRow({
  href,
  title,
  photoUrl,
  poolIcon,
  monogram,
  price,
  desire,
  accent,
  hidden,
  trailing,
  leading,
  children,
}: ZoneRowProps) {
  const t = useTranslations("Settings");
  const tDesire = useTranslations("AddItem");

  const body = (
    <>
      <span
        className={s.thumb}
        style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined}
        aria-hidden
      >
        {poolIcon && (
          <span className={s.mark}>
            <PoolIcon pool={poolIcon} size={MARK_SIZE} />
          </span>
        )}
        {monogram && <span className={s.letter}>{monogram}</span>}
      </span>
      {/* Огонёк — точка акцентом со свечением, ТОЛЬКО у степени 4 («мечтаю»):
          строке достаточно верхней ступени, лестница целиком живёт в сетке и
          в карточке вещи. */}
      {desire === DESIRE_DREAM && (
        <span className={s.dot} role="img" aria-label={tDesire(`desire${DESIRE_DREAM}`)} />
      )}
      <span className={s.name}>{title}</span>
    </>
  );

  return (
    <li className={s.item}>
      <div
        className={hidden ? `${s.row} ${s.dim}` : s.row}
        style={{ "--zr-accent": accent } as React.CSSProperties}
      >
        {leading && <span className={s.leading}>{leading}</span>}
        {href ? (
          <Link href={href} className={`pressable ${s.main}`}>
            {body}
          </Link>
        ) : (
          <span className={s.main}>{body}</span>
        )}
        {(hidden || price) && (
          <span className={s.meta}>
            {hidden && (
              <span className={s.hiddenMark} role="img" aria-label={t("itemHiddenBadge")}>
                <IconEyeOff size={HIDDEN_MARK_SIZE} />
              </span>
            )}
            {price && <span className={s.price}>{price}</span>}
          </span>
        )}
        {trailing && <span className={s.more}>{trailing}</span>}
      </div>
      {children && <div className={s.under}>{children}</div>}
    </li>
  );
}
