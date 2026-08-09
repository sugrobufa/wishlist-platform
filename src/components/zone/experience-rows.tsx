"use client";

// Зона «Впечатления» — СТРОКАМИ, а не плитками (тикет 115, доска 34d ·
// турн 9b). Числа дословно из `task18.json → experienceRows`.
//
// ПРАВИЛО: форму выбирает ЗОНА, а не человек. Смешанной сетки нет: `events`
// строками всегда — и у гостя, и у хозяйки.
//
// ПОЧЕМУ. Поля впечатления — текст, а не образ: «Выходные · Суздаль · до
// 14 сент» на плитке 150×150 не помещается и уезжает в многоточие, а именно
// эти три слова и решают, дарить или нет. У вещи наоборот: образ важнее
// подписи, и там плитка остаётся.
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ZoneGridItem } from "./types";
import s from "./experience-rows.module.css";

type ExperienceRowsProps = {
  items: ZoneGridItem[];
  /** Слот действия строки: у гостя — бирка «Подарить», у хозяйки пусто. */
  renderItemAction?: (item: ZoneGridItem) => ReactNode;
};

/** «Выходные · Суздаль · до 14 сент» — пустые поля выпадают, разделитель «·». */
function metaOf(item: ZoneGridItem, until: (date: string) => string): string {
  return [item.eventWhen, item.eventWhere, item.validUntil ? until(item.validUntil) : null]
    .filter((part): part is string => Boolean(part && part.trim() !== ""))
    .join(" · ");
}

export function ExperienceRows({ items, renderItemAction }: ExperienceRowsProps) {
  const t = useTranslations("Experience");

  return (
    <ul className={s.list}>
      {items.map((item) => {
        const meta = metaOf(item, (date) => `${t("validUntil").toLowerCase()} ${date}`);
        return (
          <li key={item.id} className={item.expired ? `${s.row} ${s.rowExpired}` : s.row}>
            <span
              className={s.thumb}
              aria-hidden
              style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}
            />
            <span className={s.body}>
              <span className={s.title}>{item.title}</span>
              {/* У просроченной услуги тройка «когда · где · до» заменяется
                  одной строкой: она больше не помогает решить, а мешает. */}
              <span className={s.meta}>
                {item.expired ? t("expiredOwner", { date: item.validUntil ?? "" }) : meta}
              </span>
            </span>
            {renderItemAction ? <span className={s.action}>{renderItemAction(item)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
