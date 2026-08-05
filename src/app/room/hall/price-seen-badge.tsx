"use client";

// Значок «кто видит цену» (тикет 35, доска 12d). Дословно с доски: «Рядом с
// ценой всегда стоит значок с подписью, кто её видит — хозяйка не должна
// лезть в настройки, чтобы вспомнить».
//
// Живёт отдельным файлом, потому что мест показа цены «люблю» стало два: зал
// славы и история вещи в её карточке (тикет 39). Говорить о цене в двух
// местах разными словами нельзя, поэтому и значок, и подпись — здесь одни.
import { useTranslations } from "next-intl";
import { priceAudienceHidden, type HallPriceAudience } from "@/server/dto/hall";

/** Глаз из набора иконок доски (турн 12a: контур 1.7, сетка 24). */
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/** Перечёркнутый глаз — цена этой вещи спрятана (турн 12a, «Скрыть»). */
function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.2 8.4C6.3 6.5 9 5.5 12 5.5c5.5 0 9.5 4 10.5 6.5-.4 1-1.4 2.4-2.9 3.7" />
      <path d="M16.4 17.6c-1.3.6-2.8.9-4.4.9-5.5 0-9.5-4-10.5-6.5.4-1.1 1.5-2.6 3.1-4" />
      <path d="M10 10.1a2.7 2.7 0 0 0 3.8 3.8" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  );
}

export function PriceSeenBadge({ audience }: { audience: HallPriceAudience }) {
  const t = useTranslations("Hall");
  return (
    <span
      className="inline-flex items-center gap-1.5 border border-surface-hairline-strong px-2 py-1 text-[9px] font-medium uppercase tracking-[0.1em] text-text-muted"
      title={t("priceSeenAria")}
    >
      {priceAudienceHidden(audience) ? <EyeOffIcon /> : <EyeIcon />}
      {t(`seen${audience}`)}
    </span>
  );
}
