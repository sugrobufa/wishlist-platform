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
//
// СТРОКА — ДОРОГА В КАРТОЧКУ ВЕЩИ (тикет 194). Тикет 186 открыл её от плитки,
// и граница того тикета была плиткой; строка осталась без входа — вещь есть,
// карточка есть, дороги нет, ровно первый пункт приёмки владельца, только в
// одной зоне из двадцати. Адрес приходит пропом готовой строкой: собирать его
// строка не вправе — у хозяйки и гостя он разный.
import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ZoneGridItem } from "./types";
import s from "./experience-rows.module.css";

type ExperienceRowsProps = {
  items: ZoneGridItem[];
  /** Слот действия строки: у гостя — бирка «Подарить», у хозяйки пусто. */
  renderItemAction?: (item: ZoneGridItem) => ReactNode;
  /**
   * Базовый адрес карточки вещи — к нему строка добавляет `item.id` (тикет
   * 194), тот же проп и тот же смысл, что у плитки. Без него строка не ведёт
   * никуда: так живёт гостевая сетка, у которой вход в карточку стоит
   * отдельной ссылкой в слоте действия (решение тикета 186, там же и тест).
   *
   * СТРОКА, А НЕ ФУНКЦИЯ: комната хозяйки — серверный компонент, а функции
   * границу RSC не переходят (`tests/rsc-boundary.test.ts`).
   */
  itemHrefBase?: string;
};

/** «Выходные · Суздаль · до 14 сент» — пустые поля выпадают, разделитель «·». */
function metaOf(item: ZoneGridItem, until: (date: string) => string): string {
  return [item.eventWhen, item.eventWhere, item.validUntil ? until(item.validUntil) : null]
    .filter((part): part is string => Boolean(part && part.trim() !== ""))
    .join(" · ");
}

export function ExperienceRows({ items, renderItemAction, itemHrefBase }: ExperienceRowsProps) {
  const t = useTranslations("Experience");

  return (
    <ul className={s.list}>
      {items.map((item) => {
        const meta = metaOf(item, (date) => `${t("validUntil").toLowerCase()} ${date}`);
        // Демо-призрак не ведёт НИКУДА (то же правило, что у плитки, тикет
        // 186): за ним нет вещи, его id ничего не значит вне рендера.
        // Просроченное впечатление ведёт туда же, куда живое: срок вышел — не
        // значит, что вещи нет (границы тикета 194).
        const href = itemHrefBase && !item.isDemo ? `${itemHrefBase}${item.id}` : undefined;

        // Содержательная часть строки — миниатюра и подписи. ОНА и есть цель
        // нажатия: в слоте действия у гостя живёт своя ссылка на карточку, а
        // вложенных <a> не бывает (требование разметки, а не вкус) — поэтому
        // оборачивается тело, а не вся <li>.
        const body = (
          <>
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
          </>
        );

        return (
          <li key={item.id} className={item.expired ? `${s.row} ${s.rowExpired}` : s.row}>
            {/* ССЫЛКОЙ, А НЕ onClick (тикет 194, образец — тикет 186): долгое
                нажатие, «открыть в новой вкладке» и средняя кнопка обязаны
                работать. */}
            {href ? (
              <Link href={href} className={`pressable ${s.open}`}>
                {body}
              </Link>
            ) : (
              body
            )}
            {renderItemAction ? <span className={s.action}>{renderItemAction(item)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
