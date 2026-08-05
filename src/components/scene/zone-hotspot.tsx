import type { CSSProperties } from "react";
import { sceneMotion, type RoomZone } from "@/config/design";
import { zoneFramePercent } from "./camera";
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
 * Невидимая область-кнопка поверх кадра. Позиция — доля КАДРА из rooms.json
 * (zoneFramePercent): слой хотспотов лежит ровно на кадре, поэтому одни и те
 * же проценты верны на любой ширине экрана — отдельных десктопных чисел и
 * медиазапроса не нужно. Контур пульсирует в покое, свечение — отдельный слой
 * на hover/focus.
 */
export function ZoneHotspot({ zone, index, ariaLabel, onOpen, buttonRef }: ZoneHotspotProps) {
  const box = zoneFramePercent(zone.rect);
  const style = {
    "--hs-l": `${box.left}%`,
    "--hs-t": `${box.top}%`,
    "--hs-w": `${box.width}%`,
    "--hs-h": `${box.height}%`,
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
