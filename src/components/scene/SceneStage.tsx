"use client";

// Живая сцена комнаты (тикет 02): кадр интерьера + стопка кадров «открыто» +
// хотспоты. Тап по зоне — вычисленный наезд камеры (motion.json → openZone),
// выход — три фазы closeZone: «сетка гаснет» (0 · 200), «камера отходит»
// (120 · 760/820, settle) и «вуаль поднимается» (120 · 600, out). Координаты
// только из rooms.json через src/config/design; телефон и десктоп — одна карта.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { preload } from "react-dom";
import { useTranslations } from "next-intl";
import { hitTargetMin, scene, sceneMotion, type Room, type RoomZone } from "@/config/design";
import { roomImageUrl } from "@/app/rooms/room-image";
import {
  closeScore,
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
import {
  bloomTint,
  effectiveLightness,
  EMPTY_ZONE_VEIL,
  NATIVE_LIGHT_COLOR,
  NATIVE_TIME_OF_DAY,
  sceneFilter,
  sceneLayers,
  type LightColor,
  type TimeOfDay,
} from "./grading";
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
  /**
   * Комната сама едет от края до края, пока её не тронули (тикет 72, турн 28b).
   *
   * С тикета 103 включается У ОБОИХ — решение владельца 08.08.2026: «хочу,
   * чтобы в покое комната медленно двигалась от левого края вправо и обратно;
   * особенно это важно на мобильном, чтобы пользователь понимал, что комната
   * шире, чем он видит». Прежний довод «своя комната хозяйке знакома» отменён
   * им же: знание про ШИРИНУ кадра не приходит от знакомства с содержимым.
   * Касание, драг и наезд на зону ставят проезд на ПАУЗУ (прицелиться в зону
   * это не мешает), а через несколько секунд покоя он возвращается сам —
   * тикет 117, приёмка владельца: «спустя некоторое время комната должна
   * гулять как и при первом входе».
   */
  drift?: boolean;
  /**
   * Свет и время суток комнаты (тикет 96). Кадр НЕ перегенерируется —
   * это грейдинг-слой поверх фотографии; родные положения дают identity.
   * Гость получает то же, что выбрала хозяйка: числа приезжают из комнаты.
   */
  timeOfDay?: TimeOfDay;
  lightColor?: LightColor;
  /**
   * В комнате нет ни одной вещи (тикет 104): сцена гаснет и подписывается
   * «свет включится, когда появятся вещи». Прежде пустоту закрывали чужие
   * вещи-примеры — владелец решил 09.08.2026, что это темнота, а не призраки.
   */
  empty?: boolean;
  /**
   * Ключи зон, за которыми нет ни одной вещи (35b, раунд 23 · турн 25c).
   *
   * Наезд на такую зону гасит СЦЕНУ ПОД ПАНЕЛЬЮ — не панель и не экран «зона
   * списком» (там сцены нет вовсе, гасить нечего; дизайн снял это
   * недоразумение сам). Список приходит с сервера: пустота — свойство данных,
   * а не разметки, и сцена его не вычисляет.
   */
  emptyZones?: readonly string[];
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

// Выход: три фазы closeZone (camera.ts → closeScore). Своя длительность, своя
// кривая и свой старт — вход этих чисел не видит и наоборот.
const CLOSE_PHONE = closeScore("phone");
const CLOSE_DESKTOP = closeScore("desktop");

// Отклик предмета светом (тикет 64): две фазы партитуры, разбор выбора —
// zone-marker.ts → wakeScore.
const WAKE = wakeScore();

const BASE_VARS = {
  "--ease-out": sceneMotion.easingOut,
  "--ease-walk": sceneMotion.easingWalk,
  "--ease-settle": sceneMotion.easingSettle,
  "--cam-origin": sceneMotion.camera.origin,
  // Выход из зоны, closeZone «Камера отходит»: 760/820 мс кривой settle со
  // стартом +120. Числа выхода отдельны от входа — так написано в контракте
  // («наружу спокойнее, чем внутрь»), и до этого тикета выход ехал на числах
  // входа (720/810, кривая out) — долг ADR-0003 §4.
  "--close-at": `${CLOSE_PHONE.camera.atMs}ms`,
  "--close-ms": `${CLOSE_PHONE.camera.durationMs}ms`,
  "--close-ms-d": `${CLOSE_DESKTOP.camera.durationMs}ms`,
  "--close-ease": CLOSE_PHONE.camera.easing,
  // closeZone «Вуаль поднимается» — свой темп и та же задержка, что у камеры.
  "--veil-out-at": `${CLOSE_PHONE.veil.atMs}ms`,
  "--veil-out-ms": `${CLOSE_PHONE.veil.durationMs}ms`,
  "--veil-out-ease": CLOSE_PHONE.veil.easing,
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
  // closeZone «Сетка гаснет» — первая фаза выхода, с нуля.
  "--grid-ms": `${CLOSE_PHONE.grid.durationMs}ms`,
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

export function SceneStage({
  preset,
  zonesOff,
  zoneContent,
  drift = false,
  timeOfDay = NATIVE_TIME_OF_DAY,
  lightColor = NATIVE_LIGHT_COLOR,
  empty = false,
  emptyZones,
  className,
}: SceneStageProps) {
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
  /** Корень сцены — на нём живут инлайн-переменные пана (см. разметку ниже). */
  const rootRef = useRef<HTMLElement | null>(null);
  /** Дорожка нити-позиции — с неё хук берёт ширину (тикет 102). */
  const threadRef = useRef<HTMLDivElement | null>(null);
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
    // Партитура closeZone целиком (три фазы, camera.ts → closeScore):
    //   0 мс   «Сетка гаснет»       200 мс — этот таймер;
    //   120 мс «Камера отходит»     760/820 мс, settle;
    //   120 мс «Вуаль поднимается»  600 мс, out.
    // Вторую и третью фазы JS не ведёт вовсе: они стартуют сами, как только со
    // сцены снимается класс `zoomed` (`setPhase("closing")` ниже), а их
    // задержки лежат в CSS полем `transition-delay`. Таймер отмеряет ровно
    // первую фазу: к его концу лист и подпись догорели, и их можно снимать с
    // дерева — камера с вуалью к этому моменту уже едут.
    const gridMs = reducedMotion
      ? sceneMotion.reducedTransitionMs
      : CLOSE_PHONE.grid.durationMs;
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
  /**
   * ДВА СОСТОЯНИЯ ВМЕСТО ОДНОГО (долг В10, ADR-0003 §4).
   *
   * `zoomedIn` — камера В зоне. Гаснет в момент нажатия «Отойти»: с этого
   * такта наезд снимается, и обе фазы выхода (камера и вуаль) стартуют своими
   * переходами со своей задержкой +120 мс. Прежде фаза «closing» держала
   * камеру на месте, а выход начинался только через 200 мс — не по контракту:
   * там камера трогается, ПОКА сетка гаснет.
   *
   * `zoneOpen` — зона открыта как экран: лист вещей, подпись, спрятанные
   * хотспоты. Живёт до конца первой фазы, чтобы листу было чем догореть.
   */
  const zoomedIn = phase === "open" && activeZone !== null;
  const zoneOpen = phase !== "idle" && activeZone !== null;

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
  const { lit, zoneEvents } = useSceneZoneIndex(openZoneByKey, zoneOpen ? activeKey : null);

  // Пан окна по кадру (тикет 55): драг в покое двигает окно 430 по кадру 630,
  // тап остаётся тапом. Формула позиции — immersive-layout.ts, поведение
  // жеста — use-scene-pan.ts; сцена лишь отдаёт ему свои слои и флаги.
  // На десктопе (cover, кадр целиком) хук выключен и DOM не трогает.
  useScenePan({
    viewportRef,
    varsRef: rootRef,
    panWindowRef,
    threadRef,
    zones,
    enabled: !isDesktop,
    drift,
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
    if (zoneOpen) {
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
  }, [zones, zoneOpen, finePointer]);

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
  const wakeZone = zoneOpen && zoneWakesWithLight(activeZone) ? activeZone : null;
  const wakeBox = wakeZone ? zoneFramePercent(wakeZone.rect) : null;

  // Наезд на ПУСТУЮ зону (35b): сцена под раскрытой панелью гаснет — на .56
  // яркости и мягкой вуалью сверху. Слой ниже стоит всегда и гасится
  // прозрачностью, поэтому затемнение ПРИХОДИТ ВМЕСТЕ С КАМЕРОЙ, а не
  // появляется готовым. Держится, пока камера в зоне: с первым тактом выхода
  // сцена начинает светлеть обратно.
  //
  // В ПУСТОЙ КОМНАТЕ СЛОЯ НЕТ ВОВСЕ. Там пусты все зоны до единой, и темнота
  // уже сказана самой комнатой — и фильтром, и вуалью (тикет 104). Второй слой
  // поверх множится ровно так же, как множились бы яркости: две вуали
  // `multiply` у нижней кромки оставляют 6.6% кадра. Тот же довод, что у ночи,
  // только про соседний слой.
  const zoneDimOn = zoomedIn && !empty && (emptyZones?.includes(activeZone.key) ?? false);

  // Метка зоны: одно число комнаты решает, чем она обозначена — светом
  // (тёмный интерьер) или тенью вокруг предмета (светлый). Веса считаются
  // здесь и приезжают числом: `calc()` из tokens.css объявлен в `:root` и
  // переопределить его сменой --room-lightness ниже по дереву нельзя
  // (разбор — zone-marker.ts → markerWeights).
  //
  // Время суток входит в это число (тикет 96): в ночной комнате метка обязана
  // светить сильнее, иначе она гаснет вместе с интерьером. Цвет света на веса
  // НЕ влияет — только на тон свечения.
  const styleVars = useMemo(() => {
    const lightness = effectiveLightness(preset.roomLightness, timeOfDay);
    const weights = markerWeights(lightness);
    return {
      ...BASE_VARS,
      "--accent": bloomTint(lightColor, preset.accent),
      "--room-lightness": `${lightness}`,
      "--zone-bloom-weight": `${weights.bloom}`,
      // Яркость пустой зоны живёт ЗДЕСЬ, а не на слое: фильтр слоем не
      // выражается, а фотографию мы не трогаем. Правило «не множится» —
      // в grading.ts: ни на ночь, ни на темноту пустой комнаты.
      "--grade-filter": sceneFilter(timeOfDay, lightColor, empty, preset.tod, zoneDimOn),
    } as React.CSSProperties;
  }, [preset.accent, preset.roomLightness, preset.tod, timeOfDay, lightColor, empty, zoneDimOn]);

  /** Слои грейдинга: по одному на ручку, каждый со своим блендом. */
  const grades = useMemo(
    () => sceneLayers(timeOfDay, lightColor, empty, preset.tod),
    [timeOfDay, lightColor, empty, preset.tod],
  );

  // Подписи под названием зоны здесь больше нет (тикет 59). Стояли две, и обе
  // говорили не человеку, а нам: `openVerb` («чемодан раскрывается») описывает,
  // что показывает КАДР раскрытия — это слово съёмки, оно живёт в контракте и
  // проверяется `tests/design-contract.test.ts`, но на экране не значит ничего;
  // `Scene.noOpenFrame` («мебель здесь пока не открывается») сообщал человеку о
  // том, чего у нас нет, — сам дизайн убрал эту строку из пакета в раунде 4
  // (ADR-0005, handoff/README.md §7), а продукт продолжал её показывать.
  // `zoneVerb()` и поле `openVerb` НЕ трогали: это данные съёмки.

  return (
    <section
      // Переменные пана пишутся СЮДА, а не во вьюпорт (тикет 102): нить-
      // позиция лежит вне вьюпорта, как и подсказка, и переменную соседа она
      // не унаследует. Вьюпорт — потомок секции, ему всё видно по-прежнему.
      ref={rootRef}
      className={className ? `${s.stage} ${className}` : s.stage}
      style={styleVars}
    >
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
                      {/* Кадры «открыто» — СОСЕДИ базового кадра, а не слой над
                          камерой (тикет 80). Прежде стопка стояла снаружи всей
                          камеры: при наезде комната ехала, а раскрытие нет, да
                          и кадрировано оно было иначе (`cover` в окне против
                          растяжки кадра 630 на 146.5% ширины). Кроссфейд двух
                          РАЗНЫХ кропов и давал полосу по кромке с кусками
                          соседних предметов. Теперь обе фотографии живут в
                          одном узле дыхания, одной геометрией. */}
                      {zones
                        .filter((zone) => zone.openFrame && openedEver.has(zone.key))
                        .map((zone) => (
                          <div
                            key={zone.key}
                            aria-hidden
                            className={
                              // Кроссфейд кадра «открыто» закрывается вместе с
                              // листом (первая фаза выхода), а не с камерой:
                              // створки успевают сойтись, пока она отходит.
                              zoneOpen && zone.key === activeKey
                                ? `${s.openFrame} ${s.openFrameOn}`
                                : s.openFrame
                            }
                            style={{
                              backgroundImage: `url(${roomImageUrl(zone.openFrame as string)})`,
                            }}
                          />
                        ))}
                      {/* Грейдинг времени суток и цвета света (тикет 96):
                          слой ПОВЕРХ фотографий и ПОД откликом света —
                          тонируется интерьер, а не свечение метки, у которого
                          свой тон (bloomTint). Кадры при этом не тронуты. */}
                      {grades.map((grade) => (
                        <div
                          key={grade.overlay}
                          aria-hidden
                          className={s.grade}
                          style={{ background: grade.overlay, mixBlendMode: grade.blend }}
                        />
                      ))}
                      {/* Наезд на пустую зону (35b): вуаль поверх грейдинга и
                          под откликом света — гаснет интерьер, а не свечение.
                          Узел стоит всегда, видимость решает класс: новый узел
                          въехал бы мгновенно, и «сцена гаснет по мере подхода»
                          превратилось бы в щелчок. */}
                      <div
                        aria-hidden
                        className={zoneDimOn ? `${s.zoneDim} ${s.zoneDimOn}` : s.zoneDim}
                        style={{
                          background: EMPTY_ZONE_VEIL.overlay,
                          mixBlendMode: EMPTY_ZONE_VEIL.blend,
                        }}
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
          className={zoneOpen ? `${s.hotspots} ${s.hotspotsHidden}` : s.hotspots}
          inert={zoneOpen}
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

        {zoneOpen && (
          <div className={phase === "closing" ? `${s.caption} ${s.captionOut}` : s.caption}>
            <h2 className={s.captionTitle}>{zoneLabel(activeZone)}</h2>
            {/* «Отойти» — тихая пилюля из пакета (tokens.json →
                button.secondary), с подложкой: кнопка стоит НА фотографии, и
                на светлых комнатах белая обводка без заливки не видна
                (тикет 79). Стрелки больше нет — она признак главной кнопки
                (турн 22), а «Отойти» второстепенно. */}
            <button
              ref={backRef}
              type="button"
              className={`pressable btn-quiet btn-quiet-on-photo ${s.backButton}`}
              onClick={closeZone}
            >
              {t("back")}
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
      <div className={zoneOpen ? `${s.hint} ${s.hintHidden}` : s.hint} aria-hidden>
        {/* В пустой комнате подсказка «коснись зоны» врёт: касаться нечего.
            Вместо неё — обещание, что свет включится сам (тикет 104). */}
        <span className={s.hintPill}>{empty ? t("emptyRoom") : t("hint")}</span>
      </div>

      {/* Нить-позиция (тикет 102, доска 28a): дорожка во всю ширину и сегмент
          на ней — «столько кадра ты видишь, и вот где ты в нём». Движение
          говорит «комната шире окна» (пан тикета 55 и дрейф 103), нить
          отвечает на второй вопрос — «а где я сейчас».

          Только телефон: на десктопе кадр виден целиком, показывать нечего
          (scene.module.css прячет). При наезде гаснет вместе с вуалями: в
          зоне кадр не панорамируется, и нить показывала бы неправду. */}
      <div
        ref={threadRef}
        className={zoneOpen ? `${s.thread} ${s.threadHidden}` : s.thread}
        aria-hidden
      >
        <span className={s.threadSegment} />
      </div>

      {/* Акцент и ink комнаты панель передаёт дальше карточке копилки
          (зона «Просто деньги», тикет 44) — она рисуется не из вещей. */}
      <ZonePanel
        zone={zoneOpen ? activeZone : null}
        closing={phase === "closing"}
        accent={preset.accent}
        ink={preset.ink}
      >
        {activeZone ? zoneContent?.[activeZone.key] : null}
      </ZonePanel>
    </section>
  );
}
