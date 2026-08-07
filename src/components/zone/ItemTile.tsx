// Плитка вещи в сетке зоны. Визуальный код состояний — items.json:
// «хочу» — пунктирный контур акцентом комнаты + сплошная полоса 2px акцентом
// по нижнему краю; «люблю» — плитка без контура, граница rgba(255,255,255,.09).
// Серая заливка = «нет фото», состояние НЕ кодирует (инвариант №3, классификатор
// tile-appearance.ts под тестом). Демо-призрак — полупрозрачность и бейдж «пример».
import type { CSSProperties, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ShopLink } from "./shop-link";
import { tileAppearance } from "./tile-appearance";
import type { ZoneGridItem } from "./types";
import s from "./zone-grid.module.css";

type ItemTileProps = {
  item: ZoneGridItem;
  /** Номер в стаггере появления (openZone[3]: step на плитку). */
  staggerIndex: number;
  /** Опциональный слот действия (тикет 08): бирка «Подарить» / «занято» у гостя. */
  action?: ReactNode;
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

export function ItemTile({ item, staggerIndex, action }: ItemTileProps) {
  const t = useTranslations("ZoneGrid");
  const locale = useLocale();
  const look = tileAppearance(item);

  // Подпись под названием: у «хочу» цена; у «люблю» — «люблю» либо
  // «Подарен в {год} · {даритель}» (cardCopy из items.json).
  let meta: string | null;
  if (item.state === "WANT") {
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

  const mediaClass = [s.media, look.dashed ? s.mediaDashed : "", look.greyFill ? s.mediaGrey : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={look.ghost ? `${s.tile} ${s.ghost}` : s.tile}
      style={{ "--zg-i": staggerIndex } as CSSProperties}
    >
      <div className={mediaClass}>
        {item.photoUrl && (
          <div
            className={s.photo}
            style={{ backgroundImage: `url(${item.photoUrl})` }}
            aria-hidden
          />
        )}
        {/* Плитка без фотографии — буквой названия, а не чёрной дырой
            (тикет 68). Читалке она не нужна: название стоит подписью ниже. */}
        {look.monogram && (
          <span className={s.monogram} aria-hidden>
            {look.monogram}
          </span>
        )}
        {look.accentBar && <div className={s.bar} aria-hidden />}
        {look.ghost && <span className={s.badge}>{t("demoBadge")}</span>}
      </div>
      <p className={s.title}>{item.title}</p>
      {meta && <p className={item.state === "LOVE" ? `${s.meta} ${s.metaLove}` : s.meta}>{meta}</p>}
      {/* «Где купить» (тикет 37): ключ shop приезжает только из гостевого DTO
          и только у «хочу» с видимой ценой — плитка ничего не решает сама. */}
      {item.shop && (
        <ShopLink itemId={item.id} url={item.shop.url} domain={item.shop.domain} place="tile" />
      )}
      {action != null && <div className={s.action}>{action}</div>}
    </li>
  );
}
