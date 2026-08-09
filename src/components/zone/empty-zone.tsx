"use client";

// Пустая зона (тикет 99, доска Б27 · турн 25c; числа — `task15.json →
// emptyStates.emptyZone`). Доска объясняет, зачем это отдельный экран:
// «пустая полка не должна выглядеть как невыполненное задание».
//
// Поэтому здесь ТРИ места, а не сетка из двадцати: три читаются как «сюда
// поставят», двадцать — как «двадцать раз не сделано». Ближнее место ярче
// остальных и подчёркнуто полосой — с него начинают.
//
// Язык тот же, что у пустой комнаты (тикет 104): пустота показывается
// темнотой и ожиданием, а не чужими вещами-примерами.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconEyeOff } from "@/components/icons";
import { setZoneOffAction } from "@/app/room/zone/[zone]/actions";

type EmptyZoneProps = {
  zoneKey: string;
  accent: string;
  /** Место зоны в комнате: «полка 02 из 13» — подпись шапки. */
  position?: { index: number; total: number };
  /**
   * «Убрать полку из комнаты» — только на экране зоны (доска просит это
   * действие «прямо из зоны»). В панели сцены его нет: там не решают судьбу
   * мебели, там смотрят вещи.
   */
  removable?: boolean;
  /** Компактный вид для панели сцены: места меньше, без крупного текста. */
  compact?: boolean;
};

/** Прозрачность трёх мест по глубине — `emptyZone.slots.alpha`, в hex. */
const SLOT_ALPHA = ["73", "47", "29"] as const;

export function EmptyZone({
  zoneKey,
  accent,
  position,
  removable = false,
  compact = false,
}: EmptyZoneProps) {
  const t = useTranslations("EmptyZone");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function removeShelf() {
    setBusy(true);
    setFailed(false);
    startTransition(async () => {
      const result = await setZoneOffAction(zoneKey, true);
      setBusy(false);
      if (result?.error) {
        setFailed(true);
        return;
      }
      // Зоны в комнате больше нет — оставаться на её экране незачем.
      router.push("/room");
    });
  }

  return (
    <div className={compact ? "" : "mt-5"}>
      {position && !compact && (
        <p className="overline text-text-faint">
          {t("position", { index: position.index, total: position.total })}
        </p>
      )}

      {/* Три места. Ближнее — ярче и с полосой света понизу: она обещает то
          же, что метка зоны в комнате, — здесь загорится, когда встанет вещь. */}
      <ul
        className={`flex gap-2.5 ${compact ? "mt-1" : "mt-4"}`}
        aria-hidden
      >
        {SLOT_ALPHA.map((alpha, index) => (
          <li
            key={alpha}
            className={`relative flex-1 ${compact ? "h-16" : "h-26 max-w-31"}`}
            style={{
              border: `1px dashed ${accent}${alpha}`,
              background: `linear-gradient(180deg,${accent}17,transparent)`,
            }}
          >
            {index === 0 && (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5"
                style={{ background: `${accent}73` }}
              />
            )}
          </li>
        ))}
      </ul>

      {compact ? (
        <p className="mt-3 text-[11px] leading-snug text-text-muted">{t("compactBody")}</p>
      ) : (
        <>
          <h2 className="display mt-6 text-xl">{t("title")}</h2>
          <p className="mt-2.5 max-w-md text-[13px] leading-relaxed text-text-muted">
            {t("body")}
          </p>

          {/* Главная кнопка — «полоса света» (турн 22). */}
          <Link
            href={`/room/add?zone=${zoneKey}`}
            className="pressable mt-5 inline-block border-b-2 px-6 py-3 font-semibold text-text-primary"
            style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${accent}6B` }}
          >
            {t("cta")} →
          </Link>
        </>
      )}

      {removable && (
        <div className="mt-8 border-t border-surface-hairline pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={removeShelf}
            className="pressable flex min-h-11 w-full items-center gap-3 text-left disabled:opacity-60"
          >
            <IconEyeOff size={19} strokeWidth={1.6} className="flex-none text-text-faint" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text-primary">
                {t("removeTitle")}
              </span>
              {/* Вторая строка — наша, не с доски: человек, убирающий полку,
                  должен знать, что вещи при этом не исчезают (setZoneOff их
                  не трогает), иначе кнопка читается как удаление. */}
              <span className="mt-1 block text-[11px] leading-snug text-text-muted">
                {t("removeSub")}
              </span>
            </span>
          </button>
          {failed && <p className="mt-2 text-sm text-text-muted">{t("errGeneric")}</p>}
        </div>
      )}
    </div>
  );
}
