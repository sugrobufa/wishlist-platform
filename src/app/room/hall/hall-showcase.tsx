"use client";

// Витрина зала славы (тикет 10): карточки вещей LOVE с мягким CSS-вращением
// фото (партитура макета, hall.module.css) и тихим «убрать из витрины».
// three.js здесь ЗАПРЕЩЁН до Phase 3 — только фотография и CSS.
//
// Стоимость (тикет 35, турн 12d): цена подарка + значок с подписью, кто её
// видит, и тихое «скрыть цену» у отдельной вещи. Хозяйке цена видна всегда
// (ADR-0004) — значок говорит про ОСТАЛЬНЫХ, а не про неё.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toggleHallAction } from "@/app/room/zone/[zone]/actions";
import type { HallItemDto } from "@/server/dto/hall";
import { setHallPriceHiddenAction } from "./actions";
import { formatHallMoney } from "./money";
import { PriceSeenBadge } from "./price-seen-badge";
import s from "./hall.module.css";

export type HallItemView = HallItemDto;

type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Подпись витрины: «Подарен в {год} · {имя}» / «уже моё» (селфгифт). */
function caption(item: HallItemView, t: Translator): string {
  if (item.receivedYear && item.giverName) {
    return t("captionYearGiver", { year: item.receivedYear, giver: item.giverName });
  }
  if (item.giverName) return t("captionGiver", { giver: item.giverName });
  if (item.receivedYear) return t("captionYear", { year: item.receivedYear });
  return t("captionMine");
}

export function HallShowcase({ items, accent }: { items: HallItemView[]; accent: string }) {
  const t = useTranslations("Hall");
  const locale = useLocale();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function run(itemId: string, action: () => Promise<{ error?: string } | undefined>) {
    setBusyId(itemId);
    setFailed(false);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      if (result?.error) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {failed && <p className="mb-3 text-sm text-text-muted">{t("errGeneric")}</p>}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {items.map((item) => {
          const hiddenPrice = item.priceAudience === "ITEM";
          const busy = busyId === item.id;
          return (
            <li key={item.id}>
              <div className={s.showcase}>
                <div
                  className={item.photoUrl ? s.spin : `${s.spin} ${s.spinEmpty}`}
                  style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}
                  aria-hidden
                />
                <div className={s.vignette} aria-hidden />
              </div>
              <p className="mt-3 truncate text-[13px] font-semibold text-text-primary">
                {item.title}
              </p>

              {/* Цена и значок «кто её видит» — рядом всегда, чтобы хозяйке
                  не приходилось лезть в настройки, чтобы вспомнить (12d). */}
              {item.price !== null && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="text-[15px] font-bold" style={{ color: accent }}>
                    {item.rounded
                      ? t("priceAbout", {
                          price: formatHallMoney(item.price, item.currency, locale),
                        })
                      : formatHallMoney(item.price, item.currency, locale)}
                  </span>
                  <PriceSeenBadge audience={item.priceAudience} />
                </div>
              )}

              <p className="mt-1.5 text-[10.5px] font-medium" style={{ color: accent }}>
                {caption(item, t)}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {item.price !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(item.id, () => setHallPriceHiddenAction(item.id, !hiddenPrice))
                    }
                    className="pressable text-xs font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
                  >
                    {hiddenPrice ? t("priceShow") : t("priceHide")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(item.id, () => toggleHallAction(item.id, false))}
                  className="pressable text-xs font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
                >
                  {t("remove")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
