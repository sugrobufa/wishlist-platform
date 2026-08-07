"use client";

// Пан окна по кадру (тикет 55): горизонтальный драг в покое двигает окно 430
// по кадру 630 — «окно ездит по кадру» (ADR-0006) стало жестом, а не только
// свойством наезда камеры.
//
// ГДЕ ЧТО ЖИВЁТ. Геометрия позиции окна — диапазон, перевод в px экрана,
// правило намёка на край, «пан до зоны» — в immersive-layout.ts (одно место,
// под тестом). Здесь — только ПОВЕДЕНИЕ жеста: пороги, резина у краёв, лёгкая
// инерция, первовходный автопроезд и передача окна камере при наезде. Камера
// (camera.ts) не тронута: сани пана стоят снаружи её слоёв, и к наезду их
// сдвиг уезжает в ноль — центровка сходится без единой правки формулы.
//
// КАК ЕДЕТ. Значения пишутся инлайн-переменными прямо в DOM (--win-pan px,
// --win-pan-ms, --win-pan-ease) — как у движка близости тикета 50: React-
// состояние на каждое движение пальца перерисовывало бы всю сцену. Палец
// ведёт кадр сам (0 мс), отпускание и программные ходы едут CSS-переходом.
import { useEffect, useRef } from "react";
import { scene, sceneMotion, type RoomZone } from "@/config/design";
import { walkScore } from "./camera";
import { clampPan, phoneEdgeHints, phonePanRange, phonePanShiftPx } from "./immersive-layout";

/** Порог распознавания драга: до него касание остаётся тапом по зоне. */
const DRAG_SLOP_PX = 8;

/** Резина за краем кадра: ход делится на 3 и не длиннее 28 px кадра. */
const RUBBER_DIV = 3;
const RUBBER_MAX = 28;

/**
 * Лёгкая инерция: продолжить ход на скорость × 120 мс, но не дальше 120 px
 * кадра. Именно лёгкая («инерция лёгкая или без неё», тикет 55): окно доезжает,
 * а не улетает. prefers-reduced-motion выключает её целиком.
 */
const INERTIA_PROJECT_MS = 120;
const INERTIA_MAX_PX = 120;

/** Отпустил в пределах кадра — короткий доезд; за краем — возврат к границе. */
const GLIDE_MS = 320;
const SNAP_MS = 240;

/**
 * Первовходный автопроезд (тикет 55): окно само отъезжает вправо на ~40 единиц
 * кадра и возвращается — комната показывает, что она шире экрана. 340 + 120 +
 * 340 = 800 мс, верх вилки «600–800» из тикета. Один раз за сессию
 * (sessionStorage), при prefers-reduced-motion не показывается вовсе.
 */
const INTRO_PAN = 40;
const INTRO_LEG_MS = 340;
const INTRO_HOLD_MS = 120;
const INTRO_DELAY_MS = 900;
const INTRO_SESSION_KEY = "wl-scene-pan-intro";

/**
 * Дрейф комнаты (тикет 72, турн 28b): окно медленно едет от края до края, пока
 * человек читает, и само показывает 33 зоны, которые в покое стоят за правым
 * краем. Только гостю: свою комнату хозяйка знает наизусть, ей остаётся
 * «вздох» (ambient.drift — дыхание кадра, отдельный слой).
 *
 * АВТОПРОЕЗД ТИКЕТА 55 НЕ ЗАДВОЕН, а заменён: у гостя дрейф делает то же самое
 * («комната шире экрана»), только не рывком в 40 единиц и обратно, а всё
 * время. Держать оба значило бы показать одно и то же движение дважды подряд.
 * У хозяйки дрейфа нет — там автопроезд остался как был.
 *
 * ЧИСЛА. Скорость 23 единицы кадра в секунду — с доски, турн 28b; своей фазы
 * под проезд окна в motion.json нет. Форма движения взята из ближайшей по
 * смыслу фазы `ambient.drift`: `loop: "yoyo"` (от края до края и обратно) и
 * `easing: "ease-in-out"` («маятник разворачивается на концах» — её же
 * примечание). Длительность плеча считается, а не задаётся: путь ÷ скорость,
 * то есть 200 единиц ÷ 23 ≈ 8.7 с на проход.
 */
const DRIFT_UNITS_PER_S = 23;
const DRIFT_DELAY_MS = 1400;

type UseScenePanOptions = {
  /** Вьюпорт сцены — на нём слушатели и инлайн-переменные. */
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Сани камеры (.panWindow) — читаются при перехвате автопроезда пальцем. */
  panWindowRef: React.RefObject<HTMLDivElement | null>;
  /** Видимые зоны — для намёка на край (правило по данным, не по пикселям). */
  zones: readonly RoomZone[];
  /** Телефонная раскладка. На десктопе хук не делает ничего и не следит. */
  enabled: boolean;
  /**
   * Комната сама едет от края до края, пока её не тронули (тикет 72). Только
   * гостю: он видит комнату впервые. Первое касание останавливает дрейф до
   * конца сессии — иначе в зону не прицелиться.
   */
  drift?: boolean;
  /** Зона открыта: жест спит, окно передано камере (пан уезжает в ноль). */
  zoomed: boolean;
  reducedMotion: boolean;
  /** Смена комнаты сбрасывает окно в покой — как весь остальной state сцены. */
  presetId: string;
  /** Окно доехало и встало: сцене пора пересчитать «свет у центра» (тач). */
  onSettle?: () => void;
};

type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  /** Пан на момент постановки пальца (автопроезд мог быть перехвачен). */
  basePan: number;
  /** Порог пройден — это драг, тап по зоне уже не случится. */
  moved: boolean;
  /** Последние точки для скорости: [x px, t мс]. */
  lastX: number;
  lastT: number;
  velocity: number; // px экрана в мс, знак экрана (влево — минус)
};

/** Кривая «walk» из motion.json — тем же темпом едет пан при наезде камеры. */
const WALK = walkScore("phone");

export function useScenePan({
  viewportRef,
  panWindowRef,
  zones,
  enabled,
  drift = false,
  zoomed,
  reducedMotion,
  presetId,
  onSettle,
}: UseScenePanOptions): void {
  /** Позиция окна в px кадра — единственный источник правды между эффектами. */
  const panRef = useRef(0);
  /** Пан, каким он был до наезда камеры, — к нему окно вернётся после «Отойти». */
  const savedPanRef = useRef(0);
  const dragRef = useRef<Drag | null>(null);
  /** Только что был драг — гасим синтетический click, чтобы тап не «дожался». */
  const suppressClickRef = useRef(false);
  const introTimersRef = useRef<number[]>([]);
  const introRidingRef = useRef(false);
  /** Дрейф остановлен навсегда: тронули сцену или открыли зону (тикет 72). */
  const driftStoppedRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);

  const zoomedRef = useRef(zoomed);
  const reducedRef = useRef(reducedMotion);
  const zonesRef = useRef(zones);
  const onSettleRef = useRef(onSettle);
  // Зеркала пропсов для обработчиков: пишутся ПОСЛЕ рендера (правило
  // react-hooks/refs), читаются только из событий и таймеров. Эффект объявлен
  // первым — остальные эффекты ниже видят уже свежие значения.
  useEffect(() => {
    zoomedRef.current = zoomed;
    reducedRef.current = reducedMotion;
    zonesRef.current = zones;
    onSettleRef.current = onSettle;
  });

  /** Записать позицию окна в DOM: сдвиг слоёв, темп, намёк на края. */
  const applyRef = useRef((pan: number, ms: number, ease?: string) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const width = viewport.getBoundingClientRect().width || scene.phone.w;
    viewport.style.setProperty("--win-pan", `${phonePanShiftPx(pan, width)}px`);
    viewport.style.setProperty("--win-pan-ms", `${ms}ms`);
    if (ease) viewport.style.setProperty("--win-pan-ease", ease);
    else viewport.style.removeProperty("--win-pan-ease");
    // Намёк держит клампнутая позиция: резина за краем не выключает кромку.
    const hints = phoneEdgeHints(zonesRef.current, clampPan(pan));
    viewport.style.setProperty("--edge-l", hints.left ? "1" : "0");
    viewport.style.setProperty("--edge-r", hints.right ? "1" : "0");
  });

  const clearIntroRef = useRef(() => {
    for (const timer of introTimersRef.current) window.clearTimeout(timer);
    introTimersRef.current = [];
    introRidingRef.current = false;
  });

  const scheduleSettleRef = useRef((ms: number) => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      onSettleRef.current?.();
    }, ms);
  });

  // --- Жизненный цикл: включение, смена комнаты, уход с телефона -----------
  useEffect(() => {
    if (!enabled) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    panRef.current = 0;
    savedPanRef.current = 0;
    applyRef.current(0, 0);

    // px пересчитываются от ширины вьюпорта — на resize сдвиг ставится заново.
    const onResize = () => applyRef.current(panRef.current, 0);
    window.addEventListener("resize", onResize);

    const clearIntro = clearIntroRef.current;
    return () => {
      window.removeEventListener("resize", onResize);
      clearIntro();
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      dragRef.current = null;
      // Уход с телефонной раскладки оставляет DOM нетронутым: десктоп не
      // должен видеть даже нулевых переменных пана.
      for (const name of ["--win-pan", "--win-pan-ms", "--win-pan-ease", "--edge-l", "--edge-r"]) {
        viewport.style.removeProperty(name);
      }
    };
  }, [enabled, presetId, viewportRef]);

  // --- Жест: драг двигает окно, тап остаётся тапом --------------------------
  useEffect(() => {
    if (!enabled || zoomed) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const frameScale = () => scene.phone.w / (viewport.getBoundingClientRect().width || scene.phone.w);

    /** Перехват автопроезда пальцем: где сани сейчас, там окно и замирает. */
    const freezeIntro = () => {
      // Тронули сцену — дрейф не возвращается в этой сессии (тикет 72).
      driftStoppedRef.current = true;
      if (!introRidingRef.current) return;
      clearIntroRef.current();
      const sled = panWindowRef.current;
      if (sled) {
        try {
          const matrix = new DOMMatrixReadOnly(window.getComputedStyle(sled).transform);
          panRef.current = clampPan(-matrix.m41 * frameScale());
        } catch {
          // Не разобрали transform — окно просто вернётся в покой, без рывка.
          panRef.current = 0;
        }
      }
      applyRef.current(panRef.current, 0);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      // Узкое десктопное окно живёт на телефонной раскладке: мышь панорамирует
      // только левой кнопкой, правая остаётся контекстному меню.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      freezeIntro();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        basePan: panRef.current,
        moved: false,
        lastX: event.clientX,
        lastT: event.timeStamp,
        velocity: 0,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved) {
        // Вертикального скролла на экране комнаты нет, но вертикальное
        // намерение всё равно не наше — пусть остаётся браузеру (щипок, шторки).
        if (Math.abs(dy) >= DRAG_SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
          dragRef.current = null;
          return;
        }
        if (Math.abs(dx) < DRAG_SLOP_PX) return;
        drag.moved = true;
        // С этого момента события идут вьюпорту, а click зоны не случится:
        // цель click — общий предок точек нажатия и отпускания, то есть сцена.
        try {
          viewport.setPointerCapture(event.pointerId);
        } catch {
          // Указатель уже отпущен — драг закончится на ближайшем pointerup.
        }
      }
      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) {
        drag.velocity = (event.clientX - drag.lastX) / dt;
        drag.lastX = event.clientX;
        drag.lastT = event.timeStamp;
      }
      // Палец влево — окно вправо по кадру: содержимое следует за пальцем.
      const raw = drag.basePan - dx * frameScale();
      const { min, max } = phonePanRange();
      let pan = raw;
      if (raw < min) pan = min - Math.min(RUBBER_MAX, (min - raw) / RUBBER_DIV);
      else if (raw > max) pan = max + Math.min(RUBBER_MAX, (raw - max) / RUBBER_DIV);
      panRef.current = pan;
      applyRef.current(pan, 0);
    };

    const endDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      if (!drag.moved) return; // тап — пусть зона его и получает
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      const { min, max } = phonePanRange();
      const reduced = reducedRef.current;
      const settled = clampPan(panRef.current);
      if (panRef.current < min || panRef.current > max) {
        // Резина возвращает окно к границе кадра.
        const ms = reduced ? sceneMotion.reducedTransitionMs : SNAP_MS;
        panRef.current = settled;
        applyRef.current(settled, ms);
        scheduleSettleRef.current(ms);
        return;
      }
      // Лёгкая инерция; под reduced-motion её нет — окно стоит, где отпустили.
      const velocityFrame = -drag.velocity * frameScale();
      const extra = Math.max(
        -INERTIA_MAX_PX,
        Math.min(INERTIA_MAX_PX, velocityFrame * INERTIA_PROJECT_MS),
      );
      const target = reduced ? settled : clampPan(settled + extra);
      if (target === panRef.current) {
        scheduleSettleRef.current(0);
        return;
      }
      panRef.current = target;
      applyRef.current(target, reduced ? sceneMotion.reducedTransitionMs : GLIDE_MS);
      scheduleSettleRef.current(reduced ? sceneMotion.reducedTransitionMs : GLIDE_MS);
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    viewport.addEventListener("click", onClickCapture, true);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", endDrag);
      viewport.removeEventListener("pointercancel", endDrag);
      viewport.removeEventListener("click", onClickCapture, true);
      dragRef.current = null;
    };
  }, [enabled, zoomed, viewportRef, panWindowRef]);

  // --- Наезд камеры: окно уезжает в покой и возвращается после «Отойти» -----
  //
  // РЕШЕНИЕ ТИКЕТА («реши и запиши»): после возврата из зоны окно встаёт в
  // ПОСЛЕДНЮЮ ПАНОРАМНУЮ позицию, не в покой. Человек приехал к зоне из своего
  // вида — «Отойти» возвращает его туда же, и правая зона, к которой он
  // панорамировал, не выпрыгивает обратно за край. Сам наезд считает камера
  // для окна покоя (camera.ts не тронут): сани пана параллельно уезжают в ноль
  // тем же темпом walk, что «шаг к зоне» (720 мс), и к концу похода центровка
  // сходится точно — слагаемое пана в ней исчезает.
  useEffect(() => {
    if (!enabled) return;
    if (zoomed) {
      // Открыли зону — человек уже выбрал, показывать ему комнату больше не
      // нужно: дрейф гаснет насовсем (тикет 72).
      driftStoppedRef.current = true;
      clearIntroRef.current();
      savedPanRef.current = clampPan(panRef.current);
      if (panRef.current !== 0) {
        panRef.current = 0;
        applyRef.current(
          0,
          reducedRef.current ? sceneMotion.reducedTransitionMs : WALK.pan.durationMs,
          reducedRef.current ? undefined : WALK.pan.easing,
        );
      }
      return;
    }
    if (savedPanRef.current !== 0) {
      const target = savedPanRef.current;
      panRef.current = target;
      // Темп отъезда камеры (closeZone): окно и кадр едут одной длительностью.
      const ms = reducedRef.current
        ? sceneMotion.reducedTransitionMs
        : sceneMotion.camera.durationMs.phone;
      applyRef.current(target, ms);
      scheduleSettleRef.current(ms);
    }
  }, [enabled, zoomed]);

  // --- Дрейф комнаты: едет, пока не тронули (тикет 72) ----------------------
  //
  // Движение композитное: меняется одна переменная `--win-pan`, слои едут
  // своим transition — ре-рендеров на кадр нет, как и у панорамы пальцем.
  // Указатель зон синхронен по построению: он висит на той же переменной, а
  // не на втором сдвиге (условие тикета).
  useEffect(() => {
    if (!enabled || !drift || reducedMotion) return;
    if (driftStoppedRef.current) return;
    // Показывать есть что: справа за краем стоят зоны — правило по данным.
    if (!phoneEdgeHints(zonesRef.current, 0).right) return;

    const { min, max } = phonePanRange();
    const leg = (from: number, to: number) => {
      if (driftStoppedRef.current || zoomedRef.current || dragRef.current) return;
      introRidingRef.current = true;
      panRef.current = to;
      const ms = Math.round((Math.abs(to - from) / DRIFT_UNITS_PER_S) * 1000);
      applyRef.current(to, ms, "ease-in-out");
      const next = window.setTimeout(() => leg(to, to === max ? min : max), ms);
      introTimersRef.current.push(next);
    };

    const start = window.setTimeout(() => leg(panRef.current, max), DRIFT_DELAY_MS);
    introTimersRef.current.push(start);

    const clearIntro = clearIntroRef.current;
    return () => clearIntro();
  }, [enabled, drift, reducedMotion, presetId, zoomed]);

  // --- Первовходный автопроезд: один раз за сессию --------------------------
  //
  // У гостя его заменяет дрейф (тикет 72): одно и то же сообщение «комната
  // шире экрана» двумя движениями подряд — шум.
  useEffect(() => {
    if (!enabled || reducedMotion || drift) return;
    try {
      if (window.sessionStorage.getItem(INTRO_SESSION_KEY)) return;
    } catch {
      // Хранилище недоступно (приватный режим) — комната просто не помнит,
      // что уже показывала проезд; хуже от повтора не станет.
    }
    // Показывать есть что: справа за краем стоят зоны (в контракте это все
    // десять комнат, но правило — по данным видимых зон, не по вере).
    if (!phoneEdgeHints(zonesRef.current, 0).right) return;

    const start = window.setTimeout(() => {
      if (zoomedRef.current || dragRef.current) return;
      try {
        window.sessionStorage.setItem(INTRO_SESSION_KEY, "1");
      } catch {
        // Некуда записать — показываем всё равно.
      }
      introRidingRef.current = true;
      panRef.current = INTRO_PAN;
      applyRef.current(INTRO_PAN, INTRO_LEG_MS, sceneMotion.easingOut);
      const back = window.setTimeout(() => {
        if (!introRidingRef.current) return;
        panRef.current = 0;
        applyRef.current(0, INTRO_LEG_MS, sceneMotion.easingOut);
      }, INTRO_LEG_MS + INTRO_HOLD_MS);
      const done = window.setTimeout(
        () => {
          introRidingRef.current = false;
          onSettleRef.current?.();
        },
        INTRO_LEG_MS + INTRO_HOLD_MS + INTRO_LEG_MS,
      );
      introTimersRef.current.push(back, done);
    }, INTRO_DELAY_MS);
    introTimersRef.current.push(start);

    const clearIntro = clearIntroRef.current;
    return () => clearIntro();
  }, [enabled, reducedMotion, drift, presetId]);
}
