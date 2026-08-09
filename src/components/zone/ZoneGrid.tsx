"use client";

// Сетка вещей зоны (тикет 03) со стаггером появления по партитуре
// motion.json → openZone[3] («вещи встают в сетку»). Используется в панели
// открытой зоны сцены (проп zoneContent SceneStage) и на странице «зона
// целиком списком» /room/zone/[zone].
// Данные приходят DTO-объектами (владелец — itemForOwner, гость — тикет 07).
//
// ВКЛАДОК «ХОЧУ / ЛЮБЛЮ» БОЛЬШЕ НЕТ (тикет 124). Они показывали два состояния
// вещи, а состояний не осталось: в зоне лежит только то, чего хочется, —
// список один. Вещи сокровищницы сюда не приезжают вовсе (фильтр в сервисе).
// Слова вкладок и пустых состояний — работа захода про строки.
import { useId, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { sceneMotion } from "@/config/design";
import { ItemTile } from "./ItemTile";
import { EmptyZone } from "./empty-zone";
import { ExperienceRows } from "./experience-rows";
import type { ZoneGridItem } from "./types";
import s from "./zone-grid.module.css";

// Стаггер не длиннее двух рядов: дальше вещи встают вместе с последней
// (партитура написана для ленты из 6 плиток, не для сетки на 50).
const STAGGER_CAP = 11;

/** Зона, у которой форма списка своя — строки вместо плиток (тикет 115). */
const EXPERIENCE_ZONE = "events";

/**
 * Сколько вещей зоны лист на комнате показывает «на виду» — число ДИЗАЙНА, а
 * не наше (тикет 59, ответ на «а если вещей много?»).
 *
 * В `zones.json` пятым полем у каждой зоны стоит `moreLabel` — «+26», «+9»,
 * «—». Само число там от съёмки (счётчик-заглушка), но ПРАВИЛО читается по
 * всем семнадцати зонам со счётчиком без единого исключения: `moreLabel` =
 * «счётчик минус пять» (31 → +26, 26 → +21, 14 → +9, 6 → +1), а у зоны ровно
 * с пятью вещами (`flowers`, «5 вещей») вместо числа стоит прочерк. То есть
 * доска говорит: лист держит пять вещей, всё остальное — за ссылкой на экран
 * «зона целиком списком». Проверка правила — `tests/zone-sheet-more.test.ts`.
 *
 * Сама сетка этим числом НЕ обрезается: лист прокручивается (тикет 59, часть
 * 2 — «следующий ряд виден краем»). Число решает только, говорит ли дорога на
 * полный экран числом («ещё 21») или просто словами («Показать все»).
 */
export const SHEET_TILES = 5;

export type ZoneGridProps = {
  /** Вещи зоны (DTO). Демо-призраки — с isDemo: true. */
  items: ZoneGridItem[];
  /** Акцент комнаты из rooms.json. */
  accent: string;
  /** ink комнаты из rooms.json — текст на акценте. */
  ink: string;
  /**
   * Задержка первого появления: "scene" — по партитуре openZone[3]
   * (сетка в панели сцены ждёт наезд камеры), "none" — сразу
   * (страница «зона целиком списком»).
   */
  enterDelay?: "scene" | "none";
  className?: string;
  /**
   * Опциональный слот действия плитки (тикет 08): в режиме гостя сюда
   * приходит бирка «Подарить» / тихое «занято». Проп передают только
   * client-компоненты (функция не проходит серверную границу). Без пропа
   * ничего не меняется — комната хозяйки его НЕ передаёт и не должна:
   * «бирка» — ровно одно действие «подарить» в режиме гостя (турн 22).
   */
  renderItemAction?: (item: ZoneGridItem) => ReactNode;
  /**
   * Ключ пула ЗОНЫ (rooms.json → zone.pool): у вещи без фотографии вместо
   * буквы встаёт значок этого пула (тикет 82). Свойство зоны, а не вещи,
   * поэтому приходит пропом сетки, а не полем DTO.
   */
  pool?: string | null;
  /**
   * Ключ зоны. Решает ДВЕ вещи, и обе про форму, а не про данные:
   * форму списка («Впечатления» — строками, тикет 115) и адрес добавления
   * у пустой зоны (тикет 99).
   */
  zoneKey?: string;
  /**
   * Пустая зона показывается тремя местами (тикет 99) — только ХОЗЯЙКЕ.
   * Гостю чужая пустая полка предлагать «положить сюда первую» не должна:
   * судьбу её решает не он.
   */
  ownerEmpty?: boolean;
};

export function ZoneGrid({
  items,
  accent,
  ink,
  enterDelay = "scene",
  className,
  renderItemAction,
  pool,
  zoneKey,
  ownerEmpty = false,
}: ZoneGridProps) {
  const t = useTranslations("ZoneGrid");
  const baseId = useId();

  const immediate = enterDelay === "none";
  const shown = items;
  const hasDemo = items.some((item) => item.isDemo);

  // Вся партитура — CSS-переменными из motion.json (в css-модуле чисел нет).
  const style = {
    "--zg-accent": accent,
    "--zg-ink": ink,
    "--zg-ease": sceneMotion.easingOut,
    "--zg-at": immediate ? "0ms" : `${sceneMotion.gridEnter.atMs.phone}ms`,
    "--zg-at-d": immediate ? "0ms" : `${sceneMotion.gridEnter.atMs.desktop}ms`,
    "--zg-step": `${sceneMotion.gridEnter.stepMs}ms`,
    "--zg-in-o": `${sceneMotion.gridEnter.perTileMs.opacity}ms`,
    "--zg-in-t": `${sceneMotion.gridEnter.perTileMs.transform}ms`,
    "--zg-from": sceneMotion.gridEnter.from,
    "--zg-reduced": `${sceneMotion.reducedTransitionMs}ms`,
  } as CSSProperties;

  return (
    <div className={className ? `${s.root} ${className}` : s.root} style={style}>
      <div id={`${baseId}-panel`}>
        {shown.length === 0 && zoneKey && ownerEmpty ? (
          // Зона пуста — три места (тикет 99).
          <EmptyZone zoneKey={zoneKey} accent={accent} compact />
        ) : shown.length === 0 ? (
          <p className={s.empty}>{t("emptyWant")}</p>
        ) : zoneKey === EXPERIENCE_ZONE ? (
          // Форму выбирает ЗОНА (тикет 115, доска 34d): «Впечатления» —
          // всегда строками, и у гостя, и у хозяйки. Смешанной сетки нет.
          <ExperienceRows items={shown} renderItemAction={renderItemAction} />
        ) : (
          <ul className={s.grid}>
            {shown.map((item, index) => (
              <ItemTile
                key={item.id}
                item={item}
                staggerIndex={Math.min(index, STAGGER_CAP)}
                action={renderItemAction?.(item)}
                pool={pool}
              />
            ))}
          </ul>
        )}
        {hasDemo && <p className={s.demoHint}>{t("demoNote")}</p>}
      </div>
    </div>
  );
}
