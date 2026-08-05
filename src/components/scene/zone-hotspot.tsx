import type { CSSProperties } from "react";
import { sceneMotion, type RoomZone } from "@/config/design";
import { zoneFramePercent } from "./camera";
import { bloomShape, labelAboveZone } from "./zone-marker";
import s from "./scene.module.css";

type ZoneHotspotProps = {
  zone: RoomZone;
  /** Порядковый номер — стаггер пульса (motion.json → ambient.pulse.stagger). */
  index: number;
  /** Подпись зоны: видна только при наведении и фокусе, в покое сцена чистая. */
  label: string;
  ariaLabel: string;
  onOpen: (zone: RoomZone) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
};

/**
 * Невидимая область-кнопка поверх кадра. Позиция — доля КАДРА из rooms.json
 * (zoneFramePercent): слой хотспотов лежит ровно на кадре, поэтому одни и те
 * же проценты верны на любой ширине экрана — отдельных десктопных чисел и
 * медиазапроса не нужно.
 *
 * Зона обозначена СВЕТОМ, а не рамкой (tokens.json → zoneMarker, тикет 23):
 * прямоугольник остался невидимой областью нажатия того же размера, а внутри
 * него живут три слоя — пятно, тень по краям и точка-искра. Четвёртый слой
 * метки (затемнение остального кадра) живёт выше, на уровне сцены.
 */
export function ZoneHotspot({
  zone,
  index,
  label,
  ariaLabel,
  onOpen,
  buttonRef,
}: ZoneHotspotProps) {
  const box = zoneFramePercent(zone.rect);
  const style = {
    "--hs-l": `${box.left}%`,
    "--hs-t": `${box.top}%`,
    "--hs-w": `${box.width}%`,
    "--hs-h": `${box.height}%`,
    "--pulse-delay": `${index * sceneMotion.pulse.staggerMs}ms`,
    // Форма пятна — из данных зоны: вытянутость и поворот вместо силуэтной маски.
    "--zone-bloom-bg": bloomShape(zone.bloomAR),
    "--zone-bloom-rot": `${zone.bloomRot}deg`,
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
      <span className={s.bloom} aria-hidden />
      <span className={s.vignette} aria-hidden />
      {/* Два элемента не случайно: пульс висит на внутреннем, состояние — на
          внешнем. Анимация и переход спорят за одно свойство, и анимация
          выигрывает: на одном элементе искра перестала бы гаснуть. */}
      <span className={s.spark} aria-hidden>
        <span className={s.sparkCore} />
      </span>
      {/* Подпись уже звучит в aria-label кнопки — экранному диктору она не нужна. */}
      <span
        className={labelAboveZone(box) ? `${s.zoneLabel} ${s.zoneLabelAbove}` : s.zoneLabel}
        aria-hidden
      >
        {label}
      </span>
    </button>
  );
}
