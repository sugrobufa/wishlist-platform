"use client";

// Вся комната списком (тикет 67, приёмка 07.08).
//
// ЗАЧЕМ. Сегодня к вещи ведёт единственная дорога: сцена → зона → лист. Кто
// пришёл по ссылке выбрать подарок за минуту, вынужден играть в комнату.
// Владелец: «новое представление, где просто список всех вещей — для тех, кто
// не готов и не хочет гулять по комнате».
//
// ЧТО ЭТО НЕ ЗАМЕНЯЕТ. Сцену. Список — второй вход в то же содержимое, и
// переключатель стоит рядом с комнатой, а не вместо неё.
//
// ЧЕГО ЗДЕСЬ НЕТ. Демо-призраков: они существуют, чтобы объяснить язык ЗОНЫ в
// сцене, а в плоском перечне читались бы как чужие вещи (фильтр — на сервере,
// в странице). Своих правил видимости: что показать, уже решили DTO-слой и
// сервис гостя — здесь только раскладка.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ItemTile } from "@/components/zone/ItemTile";
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
  /**
   * Куда ведёт заголовок группы. У хозяйки — её экран зоны; у гостя своего
   * экрана зоны нет, и заголовок остаётся просто заголовком.
   */
  zoneHref?: (key: string) => string;
};

type Filter = "all" | "want" | "love";

export function RoomListView({ groups, accent, zoneHref }: RoomListViewProps) {
  const t = useTranslations("RoomList");
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
              <span className={s.groupCount}>{group.items.length}</span>
            </h2>
            <ul className={s.grid}>
              {group.items.map((item, index) => (
                <ItemTile key={item.id} item={item} staggerIndex={index} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
