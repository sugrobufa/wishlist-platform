"use client";

// Витрина зала славы (тикет 10): карточки вещей LOVE с мягким CSS-вращением
// фото (партитура макета, hall.module.css) и тихим «убрать из витрины».
// three.js здесь ЗАПРЕЩЁН до Phase 3 — только фотография и CSS.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toggleHallAction } from "@/app/room/zone/[zone]/actions";
import s from "./hall.module.css";

export type HallItemView = {
  id: string;
  title: string;
  photoUrl: string | null;
  giverName: string | null;
  /** Год «Подарен в {год}» строкой — или null (ручное «уже моё» без даты). */
  receivedYear: string | null;
};

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
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function removeFromHall(itemId: string) {
    setBusyId(itemId);
    setFailed(false);
    startTransition(async () => {
      const result = await toggleHallAction(itemId, false);
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
        {items.map((item) => (
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
            <p className="mt-1.5 text-[10.5px] font-medium" style={{ color: accent }}>
              {caption(item, t)}
            </p>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => removeFromHall(item.id)}
              className="pressable mt-2 text-xs font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
            >
              {t("remove")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
