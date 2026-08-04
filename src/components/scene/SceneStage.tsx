"use client";

// Живая сцена комнаты (тикет 02): кадр интерьера + стопка кадров «открыто» +
// хотспоты. Тап по зоне — вычисленный наезд камеры (motion.json → openZone),
// выход — «сетка гаснет → камера отъезжает» (closeZone). Координаты только из
// rooms.json через src/config/design; телефон и десктоп — одна карта.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { hitTargetMin, scene, sceneMotion, type Room, type RoomZone } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { computeZoneCamera, frameRect, rectToPercent, type SceneView } from "./camera";
import { visibleZones, zoneLabel, zoneVerb } from "./zones";
import { useMediaQuery } from "./use-media-query";
import { ZoneHotspot } from "./zone-hotspot";
import { ZonePanel } from "./zone-panel";
import s from "./scene.module.css";

/** Десктопная сцена начинается с 1024px (spec Phase 1); это брейкпоинт, не координата. */
const DESKTOP_MQ = "(min-width: 1024px)";
const REDUCED_MQ = "(prefers-reduced-motion: reduce)";

export type SceneStageProps = {
  /** Пресет комнаты из rooms.json (через src/config/design). */
  preset: Room;
  /** Выключенные зоны (Room.zonesOff) — не рендерятся вовсе. */
  zonesOff?: string[];
  /**
   * Содержимое панели по ключу зоны — сюда тикет 03 монтирует сетку вещей
   * («люблю»/«хочу»). Без него панель показывает честную заглушку.
   * RSC-узлы проходят через client-границу как children.
   */
  zoneContent?: Record<string, ReactNode>;
  className?: string;
};

type Phase = "idle" | "open" | "closing";

// Геометрия кадра и партитура не зависят от инстанса — считаем один раз.
const FRAME_PHONE = rectToPercent(frameRect("phone"), "phone");
const FRAME_DESKTOP = rectToPercent(frameRect("desktop"), "desktop");

const BASE_VARS = {
  "--ease-out": sceneMotion.easingOut,
  "--cam-origin": sceneMotion.camera.origin,
  "--cam-ms": `${sceneMotion.camera.durationMs.phone}ms`,
  "--cam-ms-d": `${sceneMotion.camera.durationMs.desktop}ms`,
  "--veil-ms": `${sceneMotion.veil.durationMs}ms`,
  "--frame-ms": `${sceneMotion.openFrame.durationMs}ms`,
  "--frame-delay": `${sceneMotion.openFrame.delayMs.phone}ms`,
  "--frame-delay-d": `${sceneMotion.openFrame.delayMs.desktop}ms`,
  "--grid-ms": `${sceneMotion.closeGrid.durationMs}ms`,
  "--grid-at": `${sceneMotion.gridEnter.atMs.phone}ms`,
  "--grid-at-d": `${sceneMotion.gridEnter.atMs.desktop}ms`,
  "--grid-in-o": `${sceneMotion.gridEnter.perTileMs.opacity}ms`,
  "--grid-in-t": `${sceneMotion.gridEnter.perTileMs.transform}ms`,
  "--grid-from": sceneMotion.gridEnter.from,
  "--drift-ms": `${sceneMotion.drift.durationMs.phone}ms`,
  "--drift-ms-d": `${sceneMotion.drift.durationMs.desktop}ms`,
  "--drift-t": `${sceneMotion.drift.translatePct}%`,
  "--drift-s0": `${sceneMotion.drift.scaleFrom}`,
  "--drift-s1": `${sceneMotion.drift.scaleTo}`,
  "--pulse-ms": `${sceneMotion.pulse.durationMs}ms`,
  "--glow-ms": `${sceneMotion.hoverGlow.durationMs}ms`,
  "--reduced-ms": `${sceneMotion.reducedTransitionMs}ms`,
  "--hit-min": `${hitTargetMin}px`,
  "--scene-ar": `${scene.phone.w} / ${scene.phone.h}`,
  "--scene-ar-d": `${scene.desktop.w} / ${scene.desktop.h}`,
  "--frame-l": `${FRAME_PHONE.left}%`,
  "--frame-t": `${FRAME_PHONE.top}%`,
  "--frame-w": `${FRAME_PHONE.width}%`,
  "--frame-h": `${FRAME_PHONE.height}%`,
  "--frame-l-d": `${FRAME_DESKTOP.left}%`,
  "--frame-t-d": `${FRAME_DESKTOP.top}%`,
  "--frame-w-d": `${FRAME_DESKTOP.width}%`,
  "--frame-h-d": `${FRAME_DESKTOP.height}%`,
} satisfies Record<string, string>;

export function SceneStage({ preset, zonesOff, zoneContent, className }: SceneStageProps) {
  const t = useTranslations("Scene");
  const zones = useMemo(() => visibleZones(preset.zones, zonesOff), [preset.zones, zonesOff]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Ленивые кадры «открыто»: слой зоны монтируется при первом открытии,
  // дальше остаётся в стопке — браузерный кэш делает повторы мгновенными.
  const [openedEver, setOpenedEver] = useState<ReadonlySet<string>>(() => new Set());

  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const reducedMotion = useMediaQuery(REDUCED_MQ);
  const view: SceneView = isDesktop ? "desktop" : "phone";

  const timerRef = useRef<number | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const hotspotRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreKeyRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  // Смена пресета — сцена начинает с чистого листа (сброс во время рендера,
  // рекомендованный паттерн «adjusting state when props change»).
  const [renderedPresetId, setRenderedPresetId] = useState(preset.id);
  if (renderedPresetId !== preset.id) {
    setRenderedPresetId(preset.id);
    setPhase("idle");
    setActiveKey(null);
    setOpenedEver(new Set());
  }

  const openZone = useCallback(
    (zone: RoomZone) => {
      clearTimer();
      restoreKeyRef.current = zone.key;
      setOpenedEver((prev) => (prev.has(zone.key) ? prev : new Set(prev).add(zone.key)));
      setActiveKey(zone.key);
      setPhase("open");
    },
    [clearTimer],
  );

  const closeZone = useCallback(() => {
    if (phase !== "open") return;
    // Партитура closeZone: сетка гаснет (220 мс) → камера отъезжает.
    const gridMs = reducedMotion ? sceneMotion.reducedTransitionMs : sceneMotion.closeGrid.durationMs;
    setPhase("closing");
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setPhase("idle");
      setActiveKey(null);
    }, gridMs);
  }, [phase, reducedMotion, clearTimer]);

  // Esc закрывает открытую зону.
  useEffect(() => {
    if (phase !== "open") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeZone();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phase, closeZone]);

  // Фокус уходит на «Отойти», когда зона открылась, и возвращается на
  // хотспот после выхода (когда слой хотспотов уже не inert).
  useEffect(() => {
    if (phase === "open") {
      backRef.current?.focus({ preventScroll: true });
      return;
    }
    if (phase === "idle" && restoreKeyRef.current) {
      const key = restoreKeyRef.current;
      restoreKeyRef.current = null;
      hotspotRefs.current.get(key)?.focus({ preventScroll: true });
    }
  }, [phase]);

  const activeZone = useMemo(
    () => zones.find((zone) => zone.key === activeKey) ?? null,
    [zones, activeKey],
  );
  const zoomedIn = phase !== "idle" && activeZone !== null;

  // Наезд считается формулой для актуального вида; в покое — transform из
  // партитуры (scale 1.02). Смена вида при открытой зоне пересчитает наезд.
  const cameraTransform = zoomedIn
    ? computeZoneCamera(activeZone.rect, view).transform
    : sceneMotion.camera.restTransform;

  const styleVars = useMemo(
    () => ({ ...BASE_VARS, "--accent": preset.accent }) as React.CSSProperties,
    [preset.accent],
  );

  const captionSub = (() => {
    if (!activeZone) return "";
    const verb = zoneVerb(activeZone);
    if (activeZone.openFrame) return verb ?? "";
    // Честная подпись зоны без кадра «открыто» (handoff/README.md).
    return verb ? `${verb} · ${t("noOpenFrame")}` : t("noOpenFrame");
  })();

  return (
    <section className={className ? `${s.stage} ${className}` : s.stage} style={styleVars}>
      <div className={s.viewport}>
        <div className={s.camera} style={{ transform: cameraTransform }}>
          <div className={s.drift} aria-hidden>
            <div
              className={s.frame}
              style={{ backgroundImage: `url(${roomImageUrl(preset.base)})` }}
            />
          </div>
        </div>

        {/* Кадры «открыто» лежат стопкой над камерой, активный — к единице. */}
        {zones
          .filter((zone) => zone.openFrame && openedEver.has(zone.key))
          .map((zone) => (
            <div
              key={zone.key}
              aria-hidden
              className={
                zoomedIn && zone.key === activeKey ? `${s.openFrame} ${s.openFrameOn}` : s.openFrame
              }
              style={{ backgroundImage: `url(${roomImageUrl(zone.openFrame as string)})` }}
            />
          ))}

        <div className={s.scrim} aria-hidden />
        {/* Радиальная вуаль гасит периферию; клик по ней — выход. */}
        <div
          className={zoomedIn ? `${s.veil} ${s.veilOn}` : s.veil}
          onClick={closeZone}
          aria-hidden
        />

        <div
          className={zoomedIn ? `${s.hotspots} ${s.hotspotsHidden}` : s.hotspots}
          inert={zoomedIn}
        >
          {zones.map((zone, index) => (
            <ZoneHotspot
              key={zone.key}
              zone={zone}
              index={index}
              ariaLabel={t("zoneAria", { label: zoneLabel(zone) })}
              onOpen={openZone}
              buttonRef={(el) => {
                if (el) hotspotRefs.current.set(zone.key, el);
                else hotspotRefs.current.delete(zone.key);
              }}
            />
          ))}
        </div>

        {zoomedIn && (
          <div className={phase === "closing" ? `${s.caption} ${s.captionOut}` : s.caption}>
            <h2 className={s.captionTitle}>{zoneLabel(activeZone)}</h2>
            {captionSub && (
              <p className={s.captionSub}>
                <span className={s.captionDot} aria-hidden />
                {captionSub}
              </p>
            )}
            <button
              ref={backRef}
              type="button"
              className={`pressable ${s.backButton}`}
              onClick={closeZone}
            >
              ← {t("back")}
            </button>
          </div>
        )}

        <div className={zoomedIn ? `${s.hint} ${s.hintHidden}` : s.hint} aria-hidden>
          <span className={s.hintPill}>{t("hint")}</span>
        </div>
      </div>

      <ZonePanel zone={zoomedIn ? activeZone : null} closing={phase === "closing"}>
        {activeZone ? zoneContent?.[activeZone.key] : null}
      </ZonePanel>
    </section>
  );
}
