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
import {
  computeZoneCamera,
  frameRect,
  rectToPercent,
  walkScore,
  zoneFramePercent,
  type SceneView,
} from "./camera";
import { visibleZones, zoneLabel } from "./zones";
import { useMediaQuery } from "./use-media-query";
import {
  bloomShape,
  focusOutline,
  markerMask,
  markerWeights,
  nearestZoneLight,
  TOUCH_REST_STRENGTH,
  wakeScore,
  zoneWakesWithLight,
} from "./zone-marker";
import { ZoneHotspot } from "./zone-hotspot";
import { ZonePanel } from "./zone-panel";
import { useSceneZoneIndex } from "./zone-index-context";
import { useScenePan } from "./use-scene-pan";
import s from "./scene.module.css";

/** Десктопная сцена начинается с 1024px (spec Phase 1); это брейкпоинт, не координата. */
const DESKTOP_MQ = "(min-width: 1024px)";
const REDUCED_MQ = "(prefers-reduced-motion: reduce)";
/** Те же ворота, что у hover-правил метки: точный указатель есть — свет ведёт он. */
const FINE_POINTER_MQ = "(hover: hover) and (pointer: fine)";

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

// Отклик предмета светом (тикет 64): две фазы партитуры, разбор выбора —
// zone-marker.ts → wakeScore.
const WAKE = wakeScore();

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
  // Отклик светом (тикет 64) занимает СЛОТ фазы «Мебель раскрывается» — тот
  // такт, на котором у зоны с кадром створки идут навстречу камере. Числа те
  // же, но переменные свои: если дизайн однажды разведёт кроссфейд кадра и
  // отклик света, менять придётся одно место, а не искать общий `--frame-*`.
  "--wake-at": `${WAKE.atMs.phone}ms`,
  "--wake-at-d": `${WAKE.atMs.desktop}ms`,
  "--wake-ms": `${WAKE.riseMs}ms`,
  "--wake-out-ms": `${WAKE.fallMs}ms`,
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
  // Тикет 50: слои метки не обрезаются прямоугольником — маска пятна и вынос
  // виньетки за коробку зоны. Числа живут в zone-marker.ts, не здесь.
  "--zone-marker-mask": markerMask(),
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
  // Номер входа в зону (тикет 64). Слой света узнаёт по нему СВОЙ приход:
  // ключ меняется на каждом открытии, узел пересоздаётся, анимация стартует с
  // нуля. Без номера повторный вход в ТУ ЖЕ зону, пока сцена ещё закрывается
  // (220 мс «сетка гаснет», зайти можно из указателя зон), доставался бы
  // прежнему узлу с уже доигранной анимацией — и предмет промолчал бы.
  const [openSeq, setOpenSeq] = useState(0);

  const isDesktop = useMediaQuery(DESKTOP_MQ);
  const reducedMotion = useMediaQuery(REDUCED_MQ);
  const finePointer = useMediaQuery(FINE_POINTER_MQ);
  const view: SceneView = isDesktop ? "desktop" : "phone";

  const timerRef = useRef<number | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const hotspotRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreKeyRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const hotspotsLayerRef = useRef<HTMLDivElement | null>(null);
  const nearKeyRef = useRef<string | null>(null);
  const panWindowRef = useRef<HTMLDivElement | null>(null);
  // Тач-подсветка «свет у центра окна»: пан меняет центр, движок пересчитывает.
  const recenterTouchRef = useRef<(() => void) | null>(null);

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
      setOpenSeq((seq) => seq + 1);
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

  // Пан окна по кадру (тикет 55): драг в покое двигает окно 430 по кадру 630,
  // тап остаётся тапом. Формула позиции — immersive-layout.ts, поведение
  // жеста — use-scene-pan.ts; сцена лишь отдаёт ему свои слои и флаги.
  // На десктопе (cover, кадр целиком) хук выключен и DOM не трогает.
  useScenePan({
    viewportRef,
    panWindowRef,
    zones,
    enabled: !isDesktop,
    zoomed: zoomedIn,
    reducedMotion,
    presetId: preset.id,
    onSettle: () => recenterTouchRef.current?.(),
  });

  // Разгорание по приближению (тикет 50, часть Б). В покое комната чистая —
  // виден только пульс искры; свет зажигается у БЛИЖАЙШЕЙ зоны заранее, сила
  // растёт по мере подхода указателя (правило числом — zone-marker.ts →
  // PROXIMITY_RADIUS). Мышь: движение по сцене → раз в кадр (rAF) ближайшая
  // зона; тач: свет стоит у зоны, чей прямоугольник ближе к центру видимого
  // окна, касание-удержание отвечает press-состоянием из CSS. Сила пишется
  // инлайн-переменной прямо в DOM: React-состояние на каждое движение мыши
  // перерисовывало бы всю сцену. CSS-переходы сглаживают шаги сами — и они же
  // укорачиваются при prefers-reduced-motion (scene.module.css).
  useEffect(() => {
    const viewport = viewportRef.current;
    const layer = hotspotsLayerRef.current;
    if (!viewport || !layer) return;

    const setNear = (key: string | null, strength: number, dimScene = true) => {
      const prev = nearKeyRef.current;
      if (prev && prev !== key) hotspotRefs.current.get(prev)?.style.removeProperty("--zone-near");
      nearKeyRef.current = key;
      if (key) hotspotRefs.current.get(key)?.style.setProperty("--zone-near", `${strength}`);
      // Общая сила близости — вьюпорту: ею дышит затемнение кадра (.dim).
      // Локальной тени вокруг предмета больше нет (чёрные круги, жалоба
      // владельца); на тач затемнение не включаем — dimScene=false.
      if (key && dimScene && strength > 0) {
        viewport.style.setProperty("--zone-near-max", `${strength}`);
      } else {
        viewport.style.removeProperty("--zone-near-max");
      }
    };

    // Зона открыта: слой хотспотов спрятан, свет никому не нужен.
    if (zoomedIn) {
      setNear(null, 0);
      return;
    }

    // Клиентская точка → координаты КАДРА 630×351 (та же система, что у
    // прямоугольников зон): слой хотспотов повторяет геометрию кадра, поэтому
    // перевод — доля его коробки, одинаково верная на всех раскладках.
    const framePoint = (clientX: number, clientY: number) => {
      const box = layer.getBoundingClientRect();
      return {
        x: ((clientX - box.left) / box.width) * scene.phone.image.w,
        y: ((clientY - box.top) / box.height) * scene.phone.image.h,
      };
    };

    if (!finePointer) {
      const applyCenterHint = () => {
        const box = viewport.getBoundingClientRect();
        const light = nearestZoneLight(
          framePoint(box.left + box.width / 2, box.top + box.height / 2),
          zones,
        );
        setNear(light?.key ?? null, light ? TOUCH_REST_STRENGTH : 0, false);
      };
      applyCenterHint();
      window.addEventListener("resize", applyCenterHint);
      // Пан окна (тикет 55) меняет, какая зона ближе к центру: движок пана
      // зовёт пересчёт, когда окно встало (framePoint меряет от коробки слоя
      // хотспотов — она уже сдвинута, формула та же).
      recenterTouchRef.current = applyCenterHint;
      return () => {
        recenterTouchRef.current = null;
        window.removeEventListener("resize", applyCenterHint);
        setNear(null, 0);
      };
    }

    let raf = 0;
    let clientX = 0;
    let clientY = 0;
    const onPointerMove = (event: PointerEvent) => {
      clientX = event.clientX;
      clientY = event.clientY;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const light = nearestZoneLight(framePoint(clientX, clientY), zones);
        setNear(light?.key ?? null, light?.strength ?? 0);
      });
    };
    const onPointerLeave = () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      setNear(null, 0);
    };
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerleave", onPointerLeave);
    return () => {
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerleave", onPointerLeave);
      if (raf) window.cancelAnimationFrame(raf);
      setNear(null, 0);
    };
  }, [zones, zoomedIn, finePointer]);

  // Наезд считается формулой для актуального вида и раскладывается по двум
  // слоям: внешний везёт сдвиг, внутренний — масштаб. В покое инлайновых
  // значений нет вовсе — слои возвращаются к своим `transform` из CSS, и это
  // же запускает обратный переход. Смена вида при открытой зоне пересчитает
  // наезд (масштаб у телефона и десктопа разный — формула, не число).
  const camera = zoomedIn ? computeZoneCamera(activeZone.rect, view) : null;

  // Отклик предмета светом (тикет 64). У зоны с кадром «открыто» всё уже есть —
  // кроссфейд кадра, и её поведение не меняется НИЧЕМ: слой ниже просто не
  // монтируется, разница между «до» и «после» у таких зон равна нулю узлов.
  // У остальных фотографии нет и не будет, и вместо неё на тот же такт
  // партитуры встаёт свет по прямоугольнику зоны — форма из контракта
  // (`bloomAR`/`bloomRot`), как у метки. Значения живут инлайн-переменными,
  // движение целиком в CSS: ре-рендеров на кадр нет, как у движка близости
  // (тикет 50) и панорамы (тикет 55).
  const wakeZone = zoomedIn && zoneWakesWithLight(activeZone) ? activeZone : null;
  const wakeBox = wakeZone ? zoneFramePercent(wakeZone.rect) : null;

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
    } as React.CSSProperties;
  }, [preset.accent, preset.roomLightness]);

  // Подписи под названием зоны здесь больше нет (тикет 59). Стояли две, и обе
  // говорили не человеку, а нам: `openVerb` («чемодан раскрывается») описывает,
  // что показывает КАДР раскрытия — это слово съёмки, оно живёт в контракте и
  // проверяется `tests/design-contract.test.ts`, но на экране не значит ничего;
  // `Scene.noOpenFrame` («мебель здесь пока не открывается») сообщал человеку о
  // том, чего у нас нет, — сам дизайн убрал эту строку из пакета в раунде 4
  // (ADR-0005, handoff/README.md §7), а продукт продолжал её показывать.
  // `zoneVerb()` и поле `openVerb` НЕ трогали: это данные съёмки.

  return (
    <section className={className ? `${s.stage} ${className}` : s.stage} style={styleVars}>
      <div ref={viewportRef} className={zoomedIn ? `${s.viewport} ${s.zoomed}` : s.viewport}>
        {/* Наезд — стопка слоёв, по слою на фазу партитуры (motion.json →
            openZone). Снаружи внутрь: сани пана окна (тикет 55) · вес назад ·
            перелёт · оседание · сдвиг · масштаб · дыхание · кадр. У каждого
            свой transition — только так сдвиг может длиться дольше масштаба;
            три слоя жеста стоят СНАРУЖИ сдвига, поэтому перелёт не уводит зону
            из центра (camera.ts). Сани — ещё снаружи: их сдвиг уезжает в ноль
            к наезду, и центровка камеры о пане не знает. */}
        <div ref={panWindowRef} className={s.panWindow} aria-hidden>
          <div className={s.camera}>
            <div className={s.over}>
              <div className={s.settle}>
                <div className={s.pan} style={{ transform: camera?.pan }}>
                  <div className={s.zoom} style={{ transform: camera?.zoom }}>
                    <div className={s.drift}>
                      <div
                        className={s.frame}
                        style={{ backgroundImage: `url(${roomImageUrl(preset.base)})` }}
                      />
                      {/* Отклик светом лежит ВНУТРИ дыхания, рядом с кадром:
                          он едет с камерой и дышит с фотографией, то есть
                          приклеен к предмету, а не к экрану. Ключ — номер
                          входа: каждый приход камеры получает свой узел, и
                          свет разгорается заново, а не доигрывает прошлый. */}
                      {wakeZone && wakeBox && (
                        <div className={s.wakeLayer} aria-hidden>
                          <span
                            key={openSeq}
                            className={s.wake}
                            style={
                              {
                                "--hs-l": `${wakeBox.left}%`,
                                "--hs-t": `${wakeBox.top}%`,
                                "--hs-w": `${wakeBox.width}%`,
                                "--hs-h": `${wakeBox.height}%`,
                                "--zone-bloom-bg": bloomShape(wakeZone.bloomAR),
                                "--zone-bloom-rot": `${wakeZone.bloomRot}deg`,
                              } as React.CSSProperties
                            }
                          >
                            <span className={s.wakeGlow} />
                          </span>
                        </div>
                      )}
                    </div>
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
        {/* Кромки «за краем есть ещё» (тикет 55): тихое свечение акцентом у
            края окна, за которым стоят зоны. Горят по данным (--edge-l/r от
            движка пана), принадлежат окну — с кадром не едут. Декорация:
            дороги к зонам — пан, указатель, камера. На десктопе их нет. */}
        <div className={`${s.edge} ${s.edgeL}`} aria-hidden />
        <div className={`${s.edge} ${s.edgeR}`} aria-hidden />

        <div
          ref={hotspotsLayerRef}
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
      </div>

      {/* Подсказка «коснись зоны» — ВНЕ вьюпорта (приёмка тикета 52): внутри
          него она стояла у нижней кромки КАДРА, а на телефоне это середина
          экрана — пилюля перекрывала предметы нижнего ряда (чемоданы, пол у
          столика). Теперь она в жёлобе над нижней полосой: сцена на телефоне
          заканчивается выше, пилюля лежит на вуали, а не на комнате. Позиция —
          scene.module.css → .hint, одна формула на оба вида; планка таб-бара
          живёт ниже, у самого края (bottom 14), и они не толкаются. */}
      <div className={zoomedIn ? `${s.hint} ${s.hintHidden}` : s.hint} aria-hidden>
        <span className={s.hintPill}>{t("hint")}</span>
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
