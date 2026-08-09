"use client";

// Зоны списком под комнатой — телефонная раскладка (тикет 66, приёмка 07.08).
//
// ЗАЧЕМ. После тикета 57 комната на телефоне занимает верхние 352 px из 932, а
// ниже при закрытой зоне оставалось около 380 px размытого фона ни для чего.
// Владелец: «может, не строку нижних зон, а красивым списком под фото?»
//
// ЧТО ЭТО ЧИНИТ СВЕРХ ПУСТОТЫ. Горизонтальный указатель (zone-index.tsx) держит
// 33 зоны из 122 за правым краем окна: это не ошибка раскладки (ADR-0006), но
// найти их можно только прокруткой вбок вслепую. Вертикальный список показывает
// все зоны комнаты сразу.
//
// ЧЕГО ЗДЕСЬ НЕТ. Своего пути в зону: нажатие зовёт тот же `open`, что и пункт
// указателя и хотспот сцены. Своих счётчиков: числа приходят готовым
// `ZoneSummaryDto` — правило трёх и запрет на следы броней живут в DTO-слое,
// и второй раз их тут не переписывают (инварианты №1 и №8).
//
// НА ДЕСКТОПЕ ЕГО НЕТ вовсе (CSS-ворота в модуле): там под комнатой пустоты
// нет, а сводка по наведению делает ту же работу богаче.
import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import type { RoomZone } from "@/config/design";
import type { ZoneSummaryDto } from "@/server/dto/zone-summary";
import { visibleZones, zoneLabel } from "./zones";
import { useZoneIndexActions, useZoneIndexState } from "./zone-index-context";
import s from "./zone-list.module.css";

export type ZoneListProps = {
  zones: readonly RoomZone[];
  /** Room.zonesOff: выключенная зона исчезает и отсюда (инвариант №5). */
  zonesOff?: string[];
  summaries?: Record<string, ZoneSummaryDto>;
  /**
   * Чьими глазами читается счётчик: хозяйке «в подарок», гостю «можно
   * подарить» — одно и то же число про желания. Сколько уже забрали, здесь не
   * появляется никогда и ни в каком виде (инвариант №1).
   */
  viewer: "owner" | "guest";
  accent: string;
};

/** «01», «02» … — та же нумерация, что у меток сцены и у указателя. */
function ordinal(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function ZoneList({ zones, zonesOff, summaries, viewer, accent }: ZoneListProps) {
  const t = useTranslations("Scene");
  const tCounts = useTranslations("ZoneGrid");

  const actions = useZoneIndexActions();
  const { active } = useZoneIndexState();

  const shown = useMemo(() => visibleZones(zones, zonesOff), [zones, zonesOff]);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  // Открытая зона подтягивает свою строку в видимую часть: список длиннее
  // экрана, и он же единственный указатель «где я сейчас».
  useEffect(() => {
    if (!active) return;
    itemRefs.current.get(active)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (shown.length === 0) return null;

  return (
    <nav
      className={s.list}
      aria-label={t("indexAria")}
      style={{ "--zl-accent": accent } as React.CSSProperties}
    >
      <ul className={s.items}>
        {shown.map((zone, index) => {
          const label = zoneLabel(zone);
          const summary = summaries?.[zone.key];
          const count = summary?.count ?? 0;
          return (
            <li key={zone.key}>
              <button
                type="button"
                ref={(el) => {
                  if (el) itemRefs.current.set(zone.key, el);
                  else itemRefs.current.delete(zone.key);
                }}
                className={
                  zone.key === active ? `pressable ${s.row} ${s.rowActive}` : `pressable ${s.row}`
                }
                // Номер входит в имя по той же причине, что у указателя: без
                // него у строки списка и у хотспота сцены получается одно имя
                // на две кнопки (WCAG 2.5.3, разбор в zone-index.tsx).
                aria-label={t("zoneAria", { label: `${ordinal(index)} ${label}` })}
                aria-current={zone.key === active ? "true" : undefined}
                onClick={() => actions?.open(zone.key)}
              >
                <span className={s.ordinal}>{ordinal(index)}</span>

                <span className={s.text}>
                  <span className={s.label}>{label}</span>
                  <span className={s.sub}>
                    {count === 0
                      ? t("summaryEmpty")
                      : viewer === "owner"
                        ? tCounts("zoneCounts", { total: count, want: 0 })
                        : t("summaryCountsGuest", { total: count, want: 0 })}
                  </span>
                </span>

                {/* Миниатюры — те же три, что показывает сводка на десктопе.
                    Пунктира нет ни у одной (тикет 124, инвариант №3 отменён). */}
                {summary && summary.thumbs.length > 0 && (
                  <span className={s.thumbs} aria-hidden>
                    {summary.thumbs.map((thumb, i) => (
                      <span
                        key={i}
                        className={s.thumb}
                        style={
                          thumb.photoUrl ? { backgroundImage: `url(${thumb.photoUrl})` } : undefined
                        }
                      />
                    ))}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
