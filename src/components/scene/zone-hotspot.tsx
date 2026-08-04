import type { CSSProperties } from "react";
import { sceneMotion, type RoomZone } from "@/config/design";
import { rectToPercent } from "./camera";
import s from "./scene.module.css";

type ZoneHotspotProps = {
  zone: RoomZone;
  /** Порядковый номер — стаггер пульса (motion.json → ambient.pulse.stagger). */
  index: number;
  ariaLabel: string;
  onOpen: (zone: RoomZone) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
};

/**
 * Невидимая область-кнопка поверх кадра. Позиция — проценты сцены из
 * rooms.json (телефонные и десктопные переменные, медиазапрос выбирает).
 * Контур пульсирует в покое, свечение — отдельный слой на hover/focus.
 */
export function ZoneHotspot({ zone, index, ariaLabel, onOpen, buttonRef }: ZoneHotspotProps) {
  const phone = rectToPercent(zone.rect, "phone");
  const desktop = rectToPercent(zone.rect, "desktop");
  const style = {
    "--hs-l": `${phone.left}%`,
    "--hs-t": `${phone.top}%`,
    "--hs-w": `${phone.width}%`,
    "--hs-h": `${phone.height}%`,
    "--hs-l-d": `${desktop.left}%`,
    "--hs-t-d": `${desktop.top}%`,
    "--hs-w-d": `${desktop.width}%`,
    "--hs-h-d": `${desktop.height}%`,
    "--pulse-delay": `${index * sceneMotion.pulse.staggerMs}ms`,
  } as CSSProperties;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={s.hotspot}
      style={style}
      aria-label={ariaLabel}
      onClick={() => onOpen(zone)}
    >
      <span className={`${s.contour} ${s.contourPulse}`} aria-hidden />
      <span className={s.glow} aria-hidden />
    </button>
  );
}
