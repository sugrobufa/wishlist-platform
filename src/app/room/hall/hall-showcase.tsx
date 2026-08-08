"use client";

// Витрина зала славы (тикет 10): карточки вещей LOVE с мягким CSS-вращением
// фото (партитура макета, hall.module.css) и тихим «убрать из витрины».
// three.js здесь ЗАПРЕЩЁН до Phase 3 — только фотография и CSS.
//
// Стоимость (тикет 35, турн 12d): цена подарка + значок с подписью, кто её
// видит, и тихое «скрыть цену» у отдельной вещи. Хозяйке цена видна всегда
// (ADR-0004) — значок говорит про ОСТАЛЬНЫХ, а не про неё.
//
// Три действия вместо одного (тикет 89, замечание владельца «странная механика
// убирания вещей»). Раньше кнопка была одна — «Убрать с витрины», и по подписи
// нельзя было понять, что вещь никуда не делась, а вернулась в свою зону:
//   глазок  — прячет вещь от ГОСТЕЙ, у хозяйки она остаётся приглушённой;
//   убрать  — вещь уезжает в свою зону, вернуть можно оттуда;
//   удалить — насовсем и из комнаты, поэтому с предупреждением (два шага,
//             тот же приём, что на экране зоны).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { deleteItemAction, toggleHallAction } from "@/app/room/zone/[zone]/actions";
import { IconEye, IconEyeOff } from "@/components/icons";
import type { HallItemDto } from "@/server/dto/hall";
import { setHallHiddenAction, setHallPriceHiddenAction } from "./actions";
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
  /** Вещь, у которой «Удалить» превратилось в вопрос (двухшаговое согласие). */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(itemId: string, action: () => Promise<{ error?: string } | undefined>) {
    setBusyId(itemId);
    setFailed(false);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      setConfirmingId(null);
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
          const hidden = item.hiddenFromObservers;
          return (
            <li key={item.id} className={hidden ? s.dimmed : undefined}>
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

              {/* Скрытая вещь остаётся у хозяйки на витрине — иначе снять
                  скрытие было бы нечем; подпись говорит, кто её не видит. */}
              {hidden && (
                <p className={`overline mt-1.5 text-text-faint ${s.hiddenNote}`}>
                  {t("hiddenBadge")}
                </p>
              )}

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

              {/* Заметка хозяйки цитатой (тикет 92, доска Б22): «Ждала её два
                  года…». Поле принимает 2000 знаков, доска рисует одну фразу —
                  на плитке показываем три строки, целиком читается в карточке
                  вещи. Кавычки живут в словаре: в английском они другие. */}
              {item.note && (
                <p className={`mt-2 text-xs leading-relaxed text-text-muted ${s.note}`}>
                  {t("noteQuote", { note: item.note })}
                </p>
              )}

              {/* «Удалить» спрашивает до действия: вещь уходит из комнаты
                  насовсем, а не только с витрины (тикет 89). */}
              {confirmingId === item.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-text-muted">{t("deleteConfirm")}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(item.id, () => deleteItemAction(item.id))}
                    className="pressable font-semibold text-text-strong disabled:opacity-60"
                  >
                    {t("deleteYes")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingId(null)}
                    className="pressable font-semibold text-text-muted disabled:opacity-60"
                  >
                    {t("deleteNo")}
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {/* Дорога в карточку вещи (тикет 92): до неё заметку можно
                      было увидеть, но негде написать — с витрины не вело
                      ничего. Подпись зовёт написать, когда заметки нет. */}
                  <Link
                    href={`/room/zone/${item.zone}/i/${item.id}`}
                    className="pressable text-xs font-semibold text-text-muted hover:text-text-strong"
                  >
                    {item.note ? t("edit") : t("noteAdd")}
                  </Link>
                  {/* Глазок — про ВЕЩЬ; «Скрыть цену» рядом — про цену.
                      Две настройки не смешиваются (инвариант №8). */}
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={hidden}
                    onClick={() => run(item.id, () => setHallHiddenAction(item.id, !hidden))}
                    className="pressable inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
                  >
                    {hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                    {hidden ? t("show") : t("hide")}
                  </button>
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
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingId(item.id)}
                    className="pressable text-xs font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
                  >
                    {t("delete")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Одна строка на всю витрину вместо подписи под каждой кнопкой: три
          действия похожи на вид и расходятся по последствиям. */}
      <p className="mt-6 max-w-xl text-xs leading-relaxed text-text-faint">{t("actionsHint")}</p>
    </div>
  );
}
