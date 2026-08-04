"use client";

// Сетка вещей зоны (тикет 03): вкладки «Люблю» / «Хочу» со счётчиками,
// стаггер появления по партитуре motion.json → openZone[3] («вещи встают
// в сетку»). Используется в панели открытой зоны сцены (проп zoneContent
// SceneStage) и на странице «зона целиком списком» /room/zone/[zone].
// Данные приходят DTO-объектами (владелец — itemForOwner, гость — тикет 07);
// пустые зоны новичка наполняет demoGhostsFor до первой своей вещи.
import { useId, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { sceneMotion } from "@/config/design";
import { ItemTile } from "./ItemTile";
import type { ZoneGridItem } from "./types";
import s from "./zone-grid.module.css";

// Стаггер не длиннее двух рядов: дальше вещи встают вместе с последней
// (партитура написана для ленты из 6 плиток, не для сетки на 50).
const STAGGER_CAP = 11;

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
};

type Tab = "LOVE" | "WANT";

export function ZoneGrid({ items, accent, ink, enterDelay = "scene", className }: ZoneGridProps) {
  const t = useTranslations("ZoneGrid");
  const baseId = useId();

  const love = items.filter((item) => item.state === "LOVE");
  const want = items.filter((item) => item.state === "WANT");

  // Дефолтная вкладка — где есть вещи; при полном нуле — «Люблю».
  const [tab, setTab] = useState<Tab>(() =>
    love.length > 0 || want.length === 0 ? "LOVE" : "WANT",
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

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "LOVE", label: t("tabLove"), count: love.length },
    { key: "WANT", label: t("tabWant"), count: want.length },
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
              <ItemTile key={item.id} item={item} staggerIndex={Math.min(index, STAGGER_CAP)} />
            ))}
          </ul>
        )}
        {hasDemo && <p className={s.demoHint}>{t("demoNote")}</p>}
      </div>
    </div>
  );
}
