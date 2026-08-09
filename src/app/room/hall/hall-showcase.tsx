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
//   вернуть — вещь уезжает в свою зону, вернуть можно оттуда;
//   удалить — насовсем и из комнаты, поэтому с предупреждением (два шага,
//             тот же приём, что на экране зоны).
//
// ЗНАКИ ВМЕСТО СТЕНЫ ТЕКСТА (тикет 123, турн 36b). Те же три действия стояли
// строкой подписей, а под ними — ещё и поясняющий абзац на всю витрину.
// Теперь на виду перо-заметка (главное действие витрины) и «⋯»; лист под «⋯»
// объясняет каждое действие подстрокой, и абзац умер вместе с надобностью.
// «Убрать из сокровищницы» переименовано в «Вернуть в комнату» — решение
// владельца 09.08: вещь попадает на витрину и по ошибке, дорога назад обязана
// называться дорогой назад. Механика та же, что была с тикета 89.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { deleteItemAction, toggleHallAction } from "@/app/room/zone/[zone]/actions";
import {
  IconActionDelete,
  IconActionNote,
  IconActionReturn,
  IconEye,
  IconEyeOff,
} from "@/components/icons";
import { ItemActions, SIGN_SIZE, type ItemActionRow } from "@/components/item/item-actions";
import { zoneInfo } from "@/config/design";
import type { HallItemDto } from "@/server/dto/hall";
import { setHallHiddenAction } from "./actions";
import { formatHallMoney } from "./money";
import { PriceSeenBadge } from "./price-seen-badge";
import s from "@/components/hall/hall.module.css";

export type HallItemView = HallItemDto;

/** Человеческое имя зоны из zones.json — для подсказки «вернётся в „{зона}“». */
function zoneLabel(zone: string): string {
  return zoneInfo(zone)?.label ?? zone;
}

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

  /**
   * Лист «⋯» витрины — ровно три строки (36b): Скрыть от гостей · Вернуть в
   * комнату · Удалить. Подстроки и есть тот самый поясняющий абзац, разнесённый
   * по своим действиям: «глазок прячет от гостей», «встанет в свою зону — в
   * „{зона}“», «спросим ещё раз».
   */
  const sheetRows = (item: HallItemView): ItemActionRow[] => {
    const hidden = item.hiddenFromObservers;
    return [
      {
        key: "hide",
        icon: hidden ? <IconEye size={SIGN_SIZE} /> : <IconEyeOff size={SIGN_SIZE} />,
        title: hidden ? t("show") : t("hide"),
        hint: hidden ? t("showHint") : t("hideHint"),
        onSelect: () => run(item.id, () => setHallHiddenAction(item.id, !hidden)),
      },
      {
        // Дорога назад: вещь возвращается в СВОЮ зону, и подсказка называет её
        // по имени — «убрать» и «удалить» перестают быть похожими на слух.
        key: "return",
        icon: <IconActionReturn size={SIGN_SIZE} />,
        title: t("remove"),
        hint: t("removeHint", { zone: zoneLabel(item.zone) }),
        onSelect: () => run(item.id, () => toggleHallAction(item.id, false)),
      },
      {
        key: "delete",
        icon: <IconActionDelete size={SIGN_SIZE} />,
        title: t("delete"),
        hint: t("deleteHint"),
        danger: true,
        onSelect: () => setConfirmingId(item.id),
      },
    ];
  };

  return (
    <div>
      {failed && <p className="mb-3 text-sm text-text-muted">{t("errGeneric")}</p>}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {items.map((item) => {
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

              {/* Цена — только ХОЗЯЙКЕ и только здесь: её собственные цены
                  видны ей всегда (инвариант №8). Значок рядом теперь говорит
                  одно и то же у любой вещи — «гость цену не видит»: тикет 124
                  закрыл витрину для чужих цен целиком, и тумблера «скрыть
                  цену» рядом больше нет — прятать её не от кого. */}
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
                // Безопасный выход — главный (раунд 19): «Оставить» стоит
                // первой и заметной, удаление уходит тихой строкой. И вопрос
                // отвечает на страх: история подарка удалением не стирается.
                <div className="mt-2 flex flex-col gap-2 text-xs">
                  <span className="font-semibold text-text-strong">{t("deleteConfirm")}</span>
                  <span className="leading-snug text-text-muted">{t("deleteConfirmBody")}</span>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmingId(null)}
                      className="pressable border border-surface-hairline-strong px-3 py-1.5 font-semibold text-text-strong disabled:opacity-60"
                    >
                      {t("deleteNo")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(item.id, () => deleteItemAction(item.id))}
                      className="pressable font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
                    >
                      {t("deleteYes")}
                    </button>
                  </div>
                </div>
              ) : (
                // Два знака на виду (36b): перо — главное действие витрины
                // (заметка-цитата, тикет 92; она же дорога в карточку вещи) и
                // «⋯» со всем остальным. Слов на экране нет — они в листе.
                <div className="mt-1">
                  <ItemActions
                    primary={{
                      icon: <IconActionNote size={SIGN_SIZE} />,
                      label: item.note ? t("edit") : t("noteAdd"),
                      href: `/room/zone/${item.zone}/i/${item.id}`,
                    }}
                    rows={sheetRows(item)}
                    moreLabel={t("more")}
                    disabled={busy}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* ПОЯСНЯЮЩЕГО АБЗАЦА ЗДЕСЬ БОЛЬШЕ НЕТ (тикет 123, 36b). Он объяснял
          три похожих на вид действия одной строкой на всю витрину; теперь
          каждое объясняет себя подстрокой в листе «⋯», и повторять то же
          самое внизу экрана значило бы вернуть стену текста другим краем. */}
    </div>
  );
}
