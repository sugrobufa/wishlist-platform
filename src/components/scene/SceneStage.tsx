"use client";

// Живая сцена комнаты (тикет 02): кадр интерьера + стопка кадров «открыто» +
// хотспоты. Тап по зоне — вычисленный наезд камеры (motion.json → openZone),
// выход — «сетка гаснет → камера отъезжает» (closeZone). Координаты только из
// rooms.json через src/config/design; телефон и десктоп — одна карта.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { preload } from "react-dom";
import { useTranslations } from "next-intl";
import { hitTargetMin, scene, sceneMotion, type Room, type RoomZone } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import { computeZoneCamera, frameRect, rectToPercent, walkScore, type SceneView } from "./camera";
import { visibleZones, zoneLabel, zoneVerb } from "./zones";
import { useMediaQuery } from "./use-media-query";
import { focusOutline, markerWeights, vignetteShape } from "./zone-marker";
import { ZoneHotspot } from "./zone-hotspot";
import { ZonePanel } from "./zone-panel";
import { useSceneZoneIndex } from "./zone-index-context";
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

// «Походка»: пять слоёв, у каждого своя задержка, длительность и кривая
// (camera.ts → walkScore). Телефон и десктоп отличаются только числами.
const WALK_PHONE = walkScore("phone");
const WALK_DESKTOP = walkScore("desktop");

const BASE_VARS = {
  "--ease-out": sceneMotion.easingOut,
  "--ease-walk": sceneMotion.easingWalk,
  "--ease-settle": sceneMotion.easingSettle,
  "--cam-origin": sceneMotion.camera.origin,
  "--cam-ms": `${sceneMotion.camera.durationMs.phone}ms`,
  "--cam-ms-d": `${sceneMotion.camera.durationMs.desktop}ms`,
  // Фаза 1 «Вес переносится назад» — одинакова на обоих видах.
  "--lead-ms": `${WALK_PHONE.lead.durationMs}ms`,
  "--lead-rest": WALK_PHONE.lead.rest,
  "--lead-on": WALK_PHONE.lead.on,
  // Фаза 2 «Шаг: масштаб» — цель на слое .zoom, перелёт на слое .over.
  "--step-at": `${WALK_PHONE.zoom.atMs}ms`,
  "--step-ms": `${WALK_PHONE.zoom.durationMs}ms`,
  "--step-ms-d": `${WALK_DESKTOP.zoom.durationMs}ms`,
  "--over-on": WALK_PHONE.over.on,
  // Фаза 3 «Шаг: сдвиг к зоне» — длиннее масштаба (100 мс телефон, 110 десктоп),
  // в этом расхождении и живёт вся походка.
  "--pan-at": `${WALK_PHONE.pan.atMs}ms`,
  "--pan-ms": `${WALK_PHONE.pan.durationMs}ms`,
  "--pan-ms-d": `${WALK_DESKTOP.pan.durationMs}ms`,
  // Фаза 4 «Оседание» — возврат перелёта.
  "--settle-at": `${WALK_PHONE.settle.atMs}ms`,
  "--settle-at-d": `${WALK_DESKTOP.settle.atMs}ms`,
  "--settle-ms": `${WALK_PHONE.settle.durationMs}ms`,
  "--settle-on": WALK_PHONE.settle.on,
  "--veil-at": `${sceneMotion.veil.delayMs}ms`,
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
  // Размах дыхания: 1 в покое, вблизи срезан (motion.json → amplitudeZoomed).
  "--drift-k": "1",
  "--drift-k-zoom": `${sceneMotion.drift.zoomedFactor}`,
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
  // Рамка фокуса метки зоны: акцент берётся из --accent, поэтому строка одна
  // на все комнаты (tokens.json → zoneMarker.focus).
  "--zone-focus-outline": focusOutline(),
} satisfies Record<string, string>;

export function SceneStage({ preset, zonesOff, zoneContent, className }: SceneStageProps) {
  const t = useTranslations("Scene");
  const zones = useMemo(() => visibleZones(preset.zones, zonesOff), [preset.zones, zonesOff]);

  // Кадр комнаты — LCP-элемент, но живёт CSS-фоном: сканер браузера его не
  // видит, и на медленной сети загрузка стартовала бы только после гидрации
  // (Lighthouse: старт ~1.6с, LCP 3.8с). preload при SSR уезжает в <head>
  // начального HTML — кадр едет с первого байта (полировка 16).
  // fetchPriority=high обязателен: A/B на прод-сборке (slow-4G симуляция) —
  // с high LCP 2.7с / perf 90, без него браузер держит preload картинки в
  // низком приоритете за скриптами и LCP откатывается к 3.8с / perf 84.
  preload(roomImageUrl(preset.base), { as: "image", fetchPriority: "high" });

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
    const gridMs = reducedMotion
      ? sceneMotion.reducedTransitionMs
      : sceneMotion.closeGrid.durationMs;
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

  // Указатель зон в нижней полосе (тикет 34) живёт в соседнем поддереве
  // страницы, поэтому связь с ним — через контекст: сцена отдаёт вход в зону
  // и открытую зону, забирает подсвеченную. Наведение и фокус всплывают, и
  // обработчики стоят на слое хотспотов целиком — метка зоны (zone-hotspot.tsx)
  // ничего об указателе не знает. Указателя на странице может и не быть —
  // тогда мост молчит, а сцена работает по-прежнему.
  const openZoneByKey = useCallback(
    (key: string) => {
      const zone = zones.find((candidate) => candidate.key === key);
      if (zone) openZone(zone);
    },
    [zones, openZone],
  );
  const { lit, zoneEvents } = useSceneZoneIndex(openZoneByKey, zoomedIn ? activeKey : null);

  // Наезд считается формулой для актуального вида и раскладывается по двум
  // слоям: внешний везёт сдвиг, внутренний — масштаб. В покое инлайновых
  // значений нет вовсе — слои возвращаются к своим `transform` из CSS, и это
  // же запускает обратный переход. Смена вида при открытой зоне пересчитает
  // наезд (масштаб у телефона и десктопа разный — формула, не число).
  const camera = zoomedIn ? computeZoneCamera(activeZone.rect, view) : null;

  // Метка зоны: одно число комнаты решает, чем она обозначена — светом
  // (тёмный интерьер) или тенью вокруг предмета (светлый). Веса считаются
  // здесь и приезжают числом: `calc()` из tokens.css объявлен в `:root` и
  // переопределить его сменой --room-lightness ниже по дереву нельзя
  // (разбор — zone-marker.ts → markerWeights).
  const styleVars = useMemo(() => {
    const weights = markerWeights(preset.roomLightness);
    return {
      ...BASE_VARS,
      "--accent": preset.accent,
      "--room-lightness": `${preset.roomLightness}`,
      "--zone-bloom-weight": `${weights.bloom}`,
      "--zone-vignette-bg": vignetteShape(weights),
    } as React.CSSProperties;
  }, [preset.accent, preset.roomLightness]);

  const captionSub = (() => {
    if (!activeZone) return "";
    const verb = zoneVerb(activeZone);
    if (activeZone.openFrame) return verb ?? "";
    // Честная подпись зоны без кадра «открыто» (handoff/README.md).
    return verb ? `${verb} · ${t("noOpenFrame")}` : t("noOpenFrame");
  })();

  return (
    <section className={className ? `${s.stage} ${className}` : s.stage} style={styleVars}>
      <div className={zoomedIn ? `${s.viewport} ${s.zoomed}` : s.viewport}>
        {/* Наезд — стопка слоёв, по слою на фазу партитуры (motion.json →
            openZone). Снаружи внутрь: вес назад · перелёт · оседание · сдвиг ·
            масштаб · дыхание · кадр. У каждого свой transition — только так
            сдвиг может длиться дольше масштаба; три слоя жеста стоят СНАРУЖИ
            сдвига, поэтому перелёт не уводит зону из центра (camera.ts). */}
        <div className={s.camera} aria-hidden>
          <div className={s.over}>
            <div className={s.settle}>
              <div className={s.pan} style={{ transform: camera?.pan }}>
                <div className={s.zoom} style={{ transform: camera?.zoom }}>
                  <div className={s.drift}>
                    <div
                      className={s.frame}
                      style={{ backgroundImage: `url(${roomImageUrl(preset.base)})` }}
                    />
                  </div>
                </div>
              </div>
            </div>
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
        {/* Метка зоны, слой на уровне сцены: при наведении на зону остальной
            кадр темнеет на 15% — так предмет читается подсвеченным изнутри.
            Включается из CSS по наведению/фокусу любого хотспота. */}
        <div className={s.dim} aria-hidden />

        <div
          className={zoomedIn ? `${s.hotspots} ${s.hotspotsHidden}` : s.hotspots}
          inert={zoomedIn}
          {...zoneEvents}
        >
          {zones.map((zone, index) => (
            // Обёртка без собственной коробки (display: contents): она несёт
            // ключ зоны для всплывающих событий и метку подсветки от указателя,
            // не меняя ни геометрии хотспота, ни его позиционирования.
            <span
              key={zone.key}
              className={s.hotspotSlot}
              data-zone={zone.key}
              data-lit={lit === zone.key ? "" : undefined}
            >
              <ZoneHotspot
                zone={zone}
                index={index}
                label={zoneLabel(zone)}
                ariaLabel={t("zoneAria", { label: zoneLabel(zone) })}
                onOpen={openZone}
                buttonRef={(el) => {
                  if (el) hotspotRefs.current.set(zone.key, el);
                  else hotspotRefs.current.delete(zone.key);
                }}
              />
            </span>
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

      {/* Акцент и ink комнаты панель передаёт дальше карточке копилки
          (зона «Просто деньги», тикет 44) — она рисуется не из вещей. */}
      <ZonePanel
        zone={zoomedIn ? activeZone : null}
        closing={phase === "closing"}
        accent={preset.accent}
        ink={preset.ink}
      >
        {activeZone ? zoneContent?.[activeZone.key] : null}
      </ZonePanel>
    </section>
  );
}
