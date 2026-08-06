import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MONEY_ZONE_KEY, type RoomZone } from "@/config/design";
import { MoneyGoalCard } from "@/components/zone/money-goal-card";
import { zoneLabel, zoneVerb } from "./zones";
import s from "./scene.module.css";

type ZonePanelProps = {
  zone: RoomZone | null;
  /** Фаза «сетка гаснет» (closeZone[0], 220 мс) перед отъездом камеры. */
  closing: boolean;
  /** Акцент комнаты — карточке копилки (полоса, плашка). */
  accent: string;
  /** ink комнаты — текст на акценте. */
  ink: string;
  /** Сетка вещей зоны — придёт тикетом 03; без неё честная заглушка. */
  children?: ReactNode;
};

/**
 * Панель открытой зоны под сценой. Заголовок и глагол — из zones.json;
 * у зоны без кадра «открыто» подпись честная. Появление — по партитуре
 * openZone[3] («вещи встают в сетку»), уход — closeZone[0].
 *
 * Зона «Просто деньги» — единственная, у которой содержимое рождается не из
 * вещей: в ней стоит копилка на мечту (тикет 44). Карточка добавляется К
 * сетке, а не вместо неё: цель вещью не является, но вещи в этой зоне никто не
 * запрещает — обе части живут рядом.
 */
export function ZonePanel({ zone, closing, accent, ink, children }: ZonePanelProps) {
  const t = useTranslations("Scene");
  if (!zone) return null;

  const verb = zoneVerb(zone);
  const overline = zone.openFrame
    ? (verb ?? "")
    : verb
      ? `${verb} · ${t("noOpenFrame")}`
      : t("noOpenFrame");

  return (
    <section className={s.panel} aria-label={zoneLabel(zone)}>
      <div key={zone.key} className={`${s.panelBody}${closing ? ` ${s.panelBodyOut}` : ""}`}>
        {overline && <p className={s.panelOverline}>{overline}</p>}
        {zone.key === MONEY_ZONE_KEY && <MoneyGoalCard accent={accent} ink={ink} />}
        {children ??
          (zone.key === MONEY_ZONE_KEY ? null : <p className={s.panelEmpty}>{t("itemsSoon")}</p>)}
      </div>
    </section>
  );
}
