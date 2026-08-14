// Плитка вещи в сетке зоны. Визуального кода состояний НЕТ (тикет 124,
// модель v2 дизайна): у плитки одна граница на всех — rgba(255,255,255,.09).
// Пунктирный контур и акцентная полоса, которыми кодировалось «хочу», ушли
// вместе с самими состояниями — инвариант №3 отменён целиком.
// Серая заливка = «нет фото» и только это (классификатор tile-appearance.ts под
// тестом). Демо-призрак — полупрозрачность и бейдж «пример».
//
// ПЛИТКА — ДОРОГА В КАРТОЧКУ ВЕЩИ (тикет 186). До него `<li>` не нажималась
// вовсе: карточка была собрана, покрыта тестами и недостижима оттуда, где
// человек на вещь смотрит, — кликабельной внутри плитки была одна маленькая
// ссылка «Где купить». Адрес приходит пропом готовой строкой: собирать его
// плитка не вправе — у хозяйки и гостя он разный.
//
// «ГДЕ КУПИТЬ» С ПЛИТКИ СНЯТО (тикет 207, пакет 47: турн 8b в этой части
// снят). Довод дизайна сильнее нашего — мы жаловались на 28 против 44, он
// назвал причину: **вложенная ссылка была компромиссом времени, когда карточки
// вещи не существовало**. Теперь она есть (тикет 196), блок магазинов в ней
// первоклассный, и вторая дверь в плитке уводила человека мимо экрана, ради
// которого его туда и ведут. Плитка — ОДНА цель целиком; освободившиеся 28 px
// забирает название (zone-grid.module.css → .title: две строки вместо
// многоточия на первой).
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { DesireScale } from "@/components/item/desire-scale";
import { useLocale, useTranslations } from "next-intl";
import { PoolIcon } from "@/components/pool-icons";
import { tileAppearance } from "./tile-appearance";
import type { ZoneGridItem } from "./types";
import s from "./zone-grid.module.css";

type ItemTileProps = {
  item: ZoneGridItem;
  /** Номер в стаггере появления (openZone[3]: step на плитку). */
  staggerIndex: number;
  /** Опциональный слот действия (тикет 08): бирка «Подарить» / «занято» у гостя. */
  action?: ReactNode;
  /** Пул ЗОНЫ — значок вместо буквы у вещи без фото (тикет 82). */
  pool?: string | null;
  /**
   * Готовый адрес карточки вещи (тикет 186). Без него плитка не ведёт никуда —
   * ровно так живёт гостевая сетка: у неё вход в карточку стоит отдельной
   * ссылкой в слоте действия, и второго ей не нужно.
   */
  href?: string;
  /**
   * Акцент комнаты для шкалы желания (тикет 252). Без него шкалы нет: цвет
   * комнаты — данные, а шкала ими и горит. Плитка сокровищницы его не
   * получает и получать не должна — желание там исполнено.
   */
  accent?: string;
};

/** Цена «хочу» для подписи: "14 900 ₽". Деньги в DTO — строка Decimal. */
function formatPrice(item: ZoneGridItem, locale: string): string | null {
  if (item.price == null) return null;
  const value = Number(item.price);
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: item.currency ?? "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Неизвестный код валюты — показываем как есть, не падаем.
    return `${item.price} ${item.currency ?? ""}`.trim();
  }
}

export function ItemTile({ item, staggerIndex, action, pool, href, accent }: ItemTileProps) {
  const t = useTranslations("ZoneGrid");
  const locale = useLocale();
  const look = tileAppearance(item, pool);

  // Подпись под названием: у вещи КОМНАТЫ цена; у вещи сокровищницы —
  // «Подарок {год} года · от {даритель}» (cardCopy из items.json).
  // Витринная вещь в сетку зоны не приезжает (тикет 124) — ветка ниже жива
  // ради списка комнаты, где формы обеих сторон встречаются вместе.
  let meta: string | null;
  if (item.inHall !== true) {
    meta = formatPrice(item, locale);
  } else if (item.receivedAt) {
    // Год — строкой, чтобы ICU не расставил разряды («2 024»).
    const year = String(new Date(item.receivedAt).getFullYear());
    meta = item.giverName
      ? t("givenYearGiver", { year, giver: item.giverName })
      : t("givenYear", { year });
  } else if (item.giverName) {
    meta = t("givenGiver", { giver: item.giverName });
  } else {
    meta = t("loveCaption");
  }

  const mediaClass = look.greyFill ? `${s.media} ${s.mediaGrey}` : s.media;

  // Демо-призрак не ведёт НИКУДА (тикет 186): за ним нет вещи, его id ничего
  // не значит вне рендера. Решается здесь, а не у вызывающей стороны, — там
  // про призрака знают не все, а `look.ghost` уже посчитан.
  const openHref = look.ghost ? undefined : href;

  // Тело плитки — образ и подписи, и с тикета 207 это ВСЁ, что плитка рисует:
  // «Где купить» снято, вложенных <a> в ней больше нет ни одного. Снаружи
  // ссылки остаётся только слот действия — бирка «Подарить» и «Подробнее»
  // гостя: это второй нажимаемый узел, и внутри якоря ему не место (кнопка в
  // ссылке — та же поломка разметки, что и ссылка в ссылке). У плитки с
  // адресом слота действия не бывает: адрес передаёт комната хозяйки, слот
  // заполняет гостевая сетка, и второго входа в карточку ей не нужно.
  const body = (
    <>
      <div className={mediaClass}>
        {item.photoUrl && (
          <div
            className={s.photo}
            style={{ backgroundImage: `url(${item.photoUrl})` }}
            aria-hidden
          />
        )}
        {/* Плитка без фотографии — знаком ЗОНЫ, а не чёрной дырой (тикеты 68
            и 82). Значок точнее буквы: «Подарок маме» даёт бессмысленную «П»,
            а зона всегда знает свою категорию. Где значка нет (`money`) —
            остаётся буква. Читалке ни то ни другое не нужно: название стоит
            подписью ниже. */}
        {look.poolIcon && (
          <span className={s.monogram} aria-hidden>
            <PoolIcon pool={look.poolIcon} />
          </span>
        )}
        {look.monogram && (
          <span className={s.monogram} aria-hidden>
            {look.monogram}
          </span>
        )}
        {look.ghost && <span className={s.badge}>{t("demoBadge")}</span>}
      </div>
      <p className={s.title}>{item.title}</p>
      {/* СТЕПЕНЬ ЖЕЛАНИЯ — ГЛАВНАЯ ПОДСКАЗКА ГОСТЯ, И В СЕТКЕ ЕЁ НЕ БЫЛО
          (тикет 252, пакет 55). Дизайн признал дыру своими словами: «мы
          описали шкалу в форме, в карточке хозяйки и в строке зоны — и ни разу
          не сказали, что она показывается ГОСТЮ. Для гостя это главная
          подсказка при выборе: он затем и пришёл, чтобы угадать».

          Вид плитки: точка 5 с шагом 4, без слова. Пустая шкала здесь
          РИСУЕТСЯ — «хозяйка не сказала» тоже ответ, и дырка на месте шкалы
          читалась бы иначе. У вещи сокровищницы шкалы нет: желание исполнено. */}
      {accent !== undefined && item.inHall !== true && (
        <DesireScale desire={item.desire} accent={accent} variant="tile" />
      )}
      {meta && <p className={item.inHall === true ? `${s.meta} ${s.metaLove}` : s.meta}>{meta}</p>}
    </>
  );

  return (
    <li
      className={look.ghost ? `${s.tile} ${s.ghost}` : s.tile}
      style={{ "--zg-i": staggerIndex } as CSSProperties}
    >
      {/* ССЫЛКОЙ, А НЕ onClick (тикет 186, образец — гостевая сетка): долгое
          нажатие, «открыть в новой вкладке» и средняя кнопка обязаны работать,
          и у гостя они уже работают. */}
      {openHref ? (
        <Link href={openHref} className={`pressable ${s.open}`}>
          {body}
        </Link>
      ) : (
        body
      )}
      {/* «Где купить» здесь больше НЕ рисуется (тикет 207): дорога наружу
          живёт в карточке вещи, куда ведёт сама плитка. Ключ `shop` в DTO при
          этом на месте и при скрытой цене тоже (тикет 195) — читает его
          карточка. */}
      {action != null && <div className={s.action}>{action}</div>}
    </li>
  );
}
