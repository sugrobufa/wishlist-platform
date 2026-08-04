import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { RoomZone } from "@/config/design";
import { zoneLabel, zoneVerb } from "./zones";
import s from "./scene.module.css";

type ZonePanelProps = {
  zone: RoomZone | null;
  /** Фаза «сетка гаснет» (closeZone[0], 220 мс) перед отъездом камеры. */
  closing: boolean;
  /** Сетка вещей зоны — придёт тикетом 03; без неё честная заглушка. */
  children?: ReactNode;
};

/**
 * Панель открытой зоны под сценой. Заголовок и глагол — из zones.json;
 * у зоны без кадра «открыто» подпись честная. Появление — по партитуре
 * openZone[3] («вещи встают в сетку»), уход — closeZone[0].
 */
export function ZonePanel({ zone, closing, children }: ZonePanelProps) {
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
        {children ?? <p className={s.panelEmpty}>{t("itemsSoon")}</p>}
      </div>
    </section>
  );
}
