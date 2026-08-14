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
//
// КОЛИЧЕСТВО ЛЕЧИТСЯ ЯРУСАМИ ШИРИНЫ (раунд 29,
// `design/package/handoff/round29/task31.json` → gridTiers), а не заголовками:
// заголовков по степеням нет никогда — делить список больше нечем. Три яруса
// и их числа живут в CSS-модуле, здесь только выбор яруса по количеству.
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

/**
 * Ярус ширины по количеству вещей (task31.json → gridTiers). Пороги — числа
 * дизайна, не подобранные: 1–2 «во всю ширину», 3–6 «первая широкая плюс
 * двухколонник», 7+ «плотный двухколонник».
 *
 * Отдельной функцией и с экспортом — чтобы пороги проверялись тестом, а не
 * пересказывались в разметке.
 */
export function gridTier(count: number): "wide" | "lead" | "dense" {
  if (count <= 2) return "wide";
  if (count <= 6) return "lead";
  return "dense";
}

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
  /**
   * Базовый адрес карточки вещи — к нему плитка добавляет `item.id` (тикет
   * 186), а с тикета 194 и СТРОКА впечатления: форму списка выбирает зона, но
   * дорога в вещь у обеих форм одна. Комната хозяйки передаёт
   * `/room/zone/{зона}/i/`; гостевая сетка не передаёт ничего — у неё вход в
   * карточку стоит отдельной ссылкой в слоте действия (`/r/{slug}/i/{id}`), и
   * трогать её тикеты не велят.
   *
   * СТРОКА, А НЕ ФУНКЦИЯ: комната хозяйки — серверный компонент, а функции
   * границу RSC не переходят (`tests/rsc-boundary.test.ts`, тот же довод, что
   * у `zoneHrefBase` в RoomListView).
   */
  itemHrefBase?: string;
  /**
   * Подвал зоны — тихая строка-мост «Ещё {n} — в сокровищнице» (раунд 29,
   * task31.json → treasuryBridge). Узел приходит снаружи, потому что решает
   * его вызывающая сторона: мост есть ТОЛЬКО у хозяйки и только когда в
   * витрине правда лежат вещи ЭТОЙ зоны. У гостя моста нет — его дверь в
   * витрину стоит знаком в углу сцены.
   */
  footer?: ReactNode;
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
  itemHrefBase,
  footer,
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
          <p className={s.empty}>{t("empty")}</p>
        ) : zoneKey === EXPERIENCE_ZONE ? (
          // Форму выбирает ЗОНА (тикет 115, доска 34d): «Впечатления» —
          // всегда строками, и у гостя, и у хозяйки. Смешанной сетки нет.
          // Адрес карточки строке нужен тот же, что плитке (тикет 194): форма
          // списка — дело зоны, а дорога в вещь одна на обе формы.
          <ExperienceRows
            items={shown}
            renderItemAction={renderItemAction}
            itemHrefBase={itemHrefBase}
          />
        ) : (
          <ul className={`${s.grid} ${TIER_CLASS[gridTier(shown.length)]}`}>
            {shown.map((item, index) => (
              <ItemTile
                key={item.id}
                item={item}
                staggerIndex={Math.min(index, STAGGER_CAP)}
                action={renderItemAction?.(item)}
                pool={pool}
                href={itemHrefBase ? `${itemHrefBase}${item.id}` : undefined}
                accent={accent}
              />
            ))}
          </ul>
        )}
        {hasDemo && <p className={s.demoHint}>{t("demoNote")}</p>}
        {/* Мост в витрину — подвалом зоны и последним: он про то, чего в этой
            зоне УЖЕ нет, и вставать выше самих вещей ему не за что. */}
        {footer}
      </div>
    </div>
  );
}

/** Ярус → класс модуля. Плотный двухколонник — сама `.grid`, класса ему не надо. */
const TIER_CLASS: Record<ReturnType<typeof gridTier>, string> = {
  wide: s.tierWide as string,
  lead: s.tierLead as string,
  dense: "",
};
