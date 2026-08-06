"use client";

// Значок «кто видит цену» (тикет 35, доска 12d). Дословно с доски: «Рядом с
// ценой всегда стоит значок с подписью, кто её видит — хозяйка не должна
// лезть в настройки, чтобы вспомнить».
//
// Живёт отдельным файлом, потому что мест показа цены «люблю» стало два: зал
// славы и история вещи в её карточке (тикет 39). Говорить о цене в двух
// местах разными словами нельзя, поэтому и значок, и подпись — здесь одни.
//
// Иконки — из общего канонического набора (тикет 52): перечёркнутый глаз —
// «Скрыть» из 25a (наш и был каноном, теперь импорт), открытый — наш знак,
// канона в 25a нет, дизайн спрошен (см. components/icons.tsx).
import { useTranslations } from "next-intl";
import { IconEye, IconEyeOff } from "@/components/icons";
import { priceAudienceHidden, type HallPriceAudience } from "@/server/dto/hall";

export function PriceSeenBadge({ audience }: { audience: HallPriceAudience }) {
  const t = useTranslations("Hall");
  return (
    <span
      className="inline-flex items-center gap-1.5 border border-surface-hairline-strong px-2 py-1 text-[9px] font-medium uppercase tracking-[0.1em] text-text-muted"
      title={t("priceSeenAria")}
    >
      {priceAudienceHidden(audience) ? <IconEyeOff size={13} /> : <IconEye size={13} />}
      {t(`seen${audience}`)}
    </span>
  );
}
