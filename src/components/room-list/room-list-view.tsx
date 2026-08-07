"use client";

// Вся комната списком (тикет 67, приведено к турну 29a тикетом 73).
//
// ЗАЧЕМ. К вещи вела единственная дорога: сцена → зона → лист. Кто пришёл по
// ссылке выбрать подарок за минуту, был вынужден играть в комнату. Владелец:
// «новое представление, где просто список всех вещей — для тех, кто не готов
// и не хочет гулять по комнате».
//
// ПОЧЕМУ СТРОКА, А НЕ ПЛИТКА. Тикет 67 собрал экран без макета — его тогда не
// было — и взял сетку плиток из зоны. Турн 29a рисует строки, и это верно по
// сути задачи: строка отдаёт название, состояние и цену одним взглядом, а
// плитка прячет цену под картинку. Ради взгляда экран и затевался.
//
// ЧЕГО ЗДЕСЬ НЕТ. Демо-призраков: они объясняют язык ЗОНЫ в сцене, а в плоском
// перечне читались бы как чужие вещи (фильтр — на сервере, в странице). Своих
// правил видимости: что показать, решили DTO-слой и сервис гостя.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { tileAppearance } from "@/components/zone/tile-appearance";
import type { ZoneGridItem } from "@/components/zone/types";
import s from "./room-list.module.css";

export type RoomListGroup = {
  /** Ключ зоны — он же адрес её отдельного экрана. */
  key: string;
  label: string;
  items: ZoneGridItem[];
};

export type RoomListViewProps = {
  groups: RoomListGroup[];
  accent: string;
  /** Куда ведёт «Комната» в переключателе: сцена хозяйки или гостя. */
  roomHref: string;
  /**
   * Куда ведёт заголовок группы. У хозяйки — её экран зоны; у гостя своего
   * экрана зоны нет, и заголовок остаётся просто заголовком.
   */
  zoneHref?: (key: string) => string;
};

type Filter = "all" | "want" | "love";

/** Цена строкой: "14 900 ₽". Деньги в DTO — строка Decimal (CLAUDE.md). */
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

export function RoomListView({ groups, accent, roomHref, zoneHref }: RoomListViewProps) {
  const t = useTranslations("RoomList");
  const tGrid = useTranslations("ZoneGrid");
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    if (filter === "all") return groups.filter((group) => group.items.length > 0);
    const want = filter === "want";
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => (item.state === "WANT") === want),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, filter]);

  const total = useMemo(() => shown.reduce((sum, group) => sum + group.items.length, 0), [shown]);

  const filters: Array<[Filter, string]> = [
    ["all", t("filterAll")],
    ["want", t("filterWant")],
    ["love", t("filterLove")],
  ];

  return (
    <div style={{ "--rl-accent": accent } as React.CSSProperties}>
      {/* Переключатель «Комната / Список» (29a): список не заменяет сцену, он
          стоит рядом с ней, и вернуться должно быть так же дёшево, как уйти. */}
      <div className={s.segmented} role="group" aria-label={t("viewAria")}>
        <Link href={roomHref} className={`pressable ${s.segment}`}>
          {t("toRoom")}
        </Link>
        <span className={`${s.segment} ${s.segmentOn}`} aria-current="page">
          {t("toList")}
        </span>
      </div>

      <div className={s.filters} role="group" aria-label={t("filterAria")}>
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            className={
              filter === key ? `pressable ${s.filter} ${s.filterOn}` : `pressable ${s.filter}`
            }
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {total === 0 ? (
        <p className={s.empty}>{t("empty")}</p>
      ) : (
        shown.map((group) => (
          <section key={group.key} className={s.group}>
            <h2 className={s.groupHead}>
              {zoneHref ? (
                <Link href={zoneHref(group.key)} className="pressable">
                  {group.label}
                </Link>
              ) : (
                group.label
              )}
              <span className={s.groupCount}>·{group.items.length}</span>
            </h2>
            <ul className={s.rows}>
              {group.items.map((item) => {
                const look = tileAppearance(item);
                const price = item.state === "WANT" ? formatPrice(item, locale) : null;
                return (
                  <li key={item.id} className={s.row}>
                    <div
                      className={look.dashed ? `${s.thumb} ${s.thumbWant}` : s.thumb}
                      style={
                        item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined
                      }
                      aria-hidden
                    >
                      {/* Буква названия вместо чёрной дыры — тот же приём, что
                          на плитке (тикет 68). Инвариант №3 не затронут: буква
                          ходит с отсутствием фото, пунктир — с «хочу». */}
                      {look.monogram && <span className={s.monogram}>{look.monogram}</span>}
                    </div>
                    <div className={s.body}>
                      <p className={s.title}>{item.title}</p>
                      <span className={item.state === "WANT" ? `${s.chip} ${s.chipWant}` : s.chip}>
                        {item.state === "WANT" ? tGrid("tabWant") : tGrid("loveCaption")}
                      </span>
                    </div>
                    {price && <span className={s.price}>{price}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
