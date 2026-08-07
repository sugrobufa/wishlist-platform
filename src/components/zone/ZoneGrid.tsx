"use client";

// Сетка вещей зоны (тикет 03): вкладки «Хочу» / «Люблю» со счётчиками
// («Хочу» первой и открытой — тикет 78),
// стаггер появления по партитуре motion.json → openZone[3] («вещи встают
// в сетку»). Используется в панели открытой зоны сцены (проп zoneContent
// SceneStage) и на странице «зона целиком списком» /room/zone/[zone].
// Данные приходят DTO-объектами (владелец — itemForOwner, гость — тикет 07);
// пустые зоны новичка наполняет demoGhostsFor до первой своей вещи.
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { sceneMotion } from "@/config/design";
import { ItemTile } from "./ItemTile";
import type { ZoneGridItem } from "./types";
import s from "./zone-grid.module.css";

// Стаггер не длиннее двух рядов: дальше вещи встают вместе с последней
// (партитура написана для ленты из 6 плиток, не для сетки на 50).
const STAGGER_CAP = 11;

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
  /** Акцент комнаты из rooms.json — пунктир, полоса, активная вкладка. */
  accent: string;
  /** ink комнаты из rooms.json — текст на акценте (активная вкладка). */
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
};

type Tab = "LOVE" | "WANT";

export function ZoneGrid({
  items,
  accent,
  ink,
  enterDelay = "scene",
  className,
  renderItemAction,
  pool,
}: ZoneGridProps) {
  const t = useTranslations("ZoneGrid");
  const baseId = useId();

  const love = items.filter((item) => item.state === "LOVE");
  const want = items.filter((item) => item.state === "WANT");

  // ДЕФОЛТ — «ХОЧУ» (тикет 78, приёмка 07.08: «сделать акцент на „Хочу" и
  // сделать выбором по умолчанию»). Продукт про подарки: гость пришёл
  // выбрать, что подарить, хозяйка завела комнату, чтобы её желания увидели.
  // «Люблю» — витрина, она ничего не запускает, и открывать зону ею значило
  // показывать первым делом то, что подарить нельзя.
  //
  // Пустая «Хочу» — падаем на «Люблю». Выбор между «всегда открывать „Хочу"»
  // и «открывать непустую» решён в пользу второго: пустое состояние на входе
  // в зону, где вещи ЕСТЬ, читается как «здесь ничего нет» — человек не станет
  // проверять вторую вкладку. Когда пусты обе, открыта всё равно «Хочу»: её
  // пустое состояние («Добавь первое желание») зовёт к делу, а «Расскажи, что
  // ты любишь» — нет.
  const [tab, setTab] = useState<Tab>(() =>
    want.length === 0 && love.length > 0 ? "LOVE" : "WANT",
  );
  // После первого переключения партитурная задержка не нужна — сцена уже открыта.
  const [switched, setSwitched] = useState(false);

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    setSwitched(true);
    setTab(next);
  };

  const immediate = enterDelay === "none" || switched;
  const shown = tab === "LOVE" ? love : want;
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

  // «Хочу» стоит ПЕРВЫМ, а не просто выбрано (тикет 78): порядок читается
  // раньше подсветки, и в списке кнопок для читалки он тоже первый.
  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "WANT", label: t("tabWant"), count: want.length },
    { key: "LOVE", label: t("tabLove"), count: love.length },
  ];

  return (
    <div className={className ? `${s.root} ${className}` : s.root} style={style}>
      <div className={s.tabs} role="tablist" aria-label={t("tabsAria")}>
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            id={`${baseId}-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`${baseId}-panel`}
            className={`pressable ${s.tab}${tab === key ? ` ${s.tabActive}` : ""}`}
            onClick={() => selectTab(key)}
          >
            {label} · {count}
          </button>
        ))}
      </div>

      <div
        key={tab}
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tab}`}
      >
        {shown.length === 0 ? (
          <p className={s.empty}>{tab === "LOVE" ? t("emptyLove") : t("emptyWant")}</p>
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
