"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { TabSlots } from "./tab-slots";
import s from "./tab-bar.module.css";

/** Тяга — ровно высота шторки: 96 px (25a). Число живёт и в CSS (--tb-sheet-h). */
const PULL_PX = 96;

/** «Отпустил меньше половины — вернулось» (25a). */
const HALF_PX = PULL_PX / 2;

/** Короче этого пальцем — не тяга, а касание: планка открывает, ручка убирает. */
const TAP_SLOP_PX = 6;

type Drag = {
  pointerId: number;
  startY: number;
  /** Стрип тянут вверх (открывая), ручку шторки — вниз (убирая). */
  mode: "open" | "close";
  moved: boolean;
};

/**
 * Таб-бар над комнатой (тикет 52, турн 25a): свёрнут в планку 112×4 в жёлобе
 * нижней полосы, по тяге вверх выезжает шторкой 96 px поверх комнаты —
 * комната видна сверху и не гаснет, касание сцены убирает.
 *
 * Жест: pointer events на планке и на ручке, палец ведёт шторку сам
 * (transform инлайн, переходы выключены классом sheetDragging). Отпустил
 * меньше половины — вернулось (200 ms), больше — доехало (240 ms). Касание
 * без движения работает как переключатель — это же и дорога десктопной мыши
 * (клик по планке/ручке/сцене), и клавиатуры (Enter на планке, Esc — убрать).
 *
 * Раскладку сцены шторка не трогает: оба слоя — оверлеи (fixed), полоса и
 * указатель зон остаются на своих местах (tests/immersive-layout.test.ts
 * зелёный без правок).
 */
export function RoomTabDrawer({ accent, ink }: { accent: string; ink: string }) {
  const t = useTranslations("TabBar");
  const [open, setOpen] = useState(false);
  /** Сколько вытянуто, 0…96; null — палец не на ручке. */
  const [pull, setPull] = useState<number | null>(null);
  /** Та же тяга для endDrag: читать состояние в момент отпускания нельзя. */
  const pullRef = useRef(0);
  const drag = useRef<Drag | null>(null);
  const stripRef = useRef<HTMLButtonElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);

  // Esc убирает шторку — клавиатурная пара к «касание сцены убирает».
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Планка после открытия спрятана (стала ручкой шторки) — фокус переезжает
  // на ручку, чтобы клавиатура не осталась на невидимой кнопке; на закрытии
  // возвращается на планку.
  useEffect(() => {
    if (open && document.activeElement === stripRef.current) {
      handleRef.current?.focus();
    } else if (!open && sheetRef.current?.contains(document.activeElement)) {
      stripRef.current?.focus();
    }
  }, [open]);

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, mode: Drag["mode"]) => {
    drag.current = { pointerId: event.pointerId, startY: event.clientY, mode, moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Палец уже отпущен (или указатель синтетический) — тяга просто не
      // начнётся, касание отработает в endDrag. Ронять рендер не из-за чего.
    }
  }, []);

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    const dy = event.clientY - d.startY;
    if (Math.abs(dy) > TAP_SLOP_PX) d.moved = true;
    if (!d.moved) return;
    // Вверх от старта — тянем шторку наружу, вниз — прячем; ноль — её покой.
    const base = d.mode === "open" ? 0 : PULL_PX;
    const next = Math.min(PULL_PX, Math.max(0, base - dy));
    pullRef.current = next;
    setPull(next);
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    drag.current = null;
    // Касание без движения: планка открывает, ручка убирает. Тяга — куда
    // дотянули: меньше половины — вернулось (25a).
    setOpen(d.moved ? pullRef.current >= HALF_PX : d.mode === "open");
    setPull(null);
  }, []);

  const cancelDrag = useCallback(() => {
    drag.current = null;
    setPull(null);
  }, []);

  // Клавиатурный клик (Enter/Space) приходит без pointer-событий и с
  // detail === 0 — только его и обрабатываем: клик после pointerup уже
  // обслужен в endDrag, второй раз переключать нельзя.
  const keyboardToggle = useCallback((event: { detail: number }, next: boolean) => {
    if (event.detail === 0) setOpen(next);
  }, []);

  const dragging = pull !== null;
  const sheetClass = dragging
    ? `${s.numbers} ${s.sheet} ${s.sheetDragging}`
    : open
      ? `${s.numbers} ${s.sheet} ${s.sheetOpen}`
      : `${s.numbers} ${s.sheet}`;

  return (
    <>
      <button
        ref={stripRef}
        type="button"
        aria-expanded={open}
        aria-controls="room-tab-drawer"
        aria-label={t("tabsAria")}
        className={open ? `${s.numbers} ${s.strip} ${s.stripHidden}` : `${s.numbers} ${s.strip}`}
        style={{ "--tb-accent": accent } as CSSProperties}
        onPointerDown={(event) => beginDrag(event, "open")}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onClick={(event) => keyboardToggle(event, true)}
      />

      {/* Касание сцены убирает шторку (25a). Ловец — только пока она вытянута;
          прозрачный: комната видна и не гаснет. Клавиатуре он не нужен (Esc),
          читалке не виден. */}
      {open && !dragging && (
        <div className={s.backdrop} aria-hidden onPointerDown={() => setOpen(false)} />
      )}

      {/* Убранная шторка спрятана и от читалки, и от табуляции самим CSS
          (visibility: hidden) — отдельный aria-hidden не нужен. */}
      <nav
        ref={sheetRef}
        id="room-tab-drawer"
        aria-label={t("tabsAria")}
        className={sheetClass}
        style={
          {
            "--tb-accent": accent,
            "--tb-ink": ink,
            ...(dragging ? { transform: `translateY(${PULL_PX - (pull ?? 0)}px)` } : {}),
          } as CSSProperties
        }
      >
        <button
          ref={handleRef}
          type="button"
          aria-expanded={open}
          aria-controls="room-tab-drawer"
          aria-label={t("tabsAria")}
          className={s.handle}
          onPointerDown={(event) => beginDrag(event, "close")}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          onClick={(event) => keyboardToggle(event, false)}
        />
        <div className={s.sheetRow}>
          <TabSlots
            active="room"
            iconSize={21}
            addIconSize={18}
            onNavigate={() => setOpen(false)}
            labels={{
              room: t("room"),
              connections: t("connections"),
              add: t("add"),
              hall: t("hall"),
              // «Профиль» из 25a не прошёл памятку тона — временно словом
              // страницы /settings, подробности и TODO — в tabs.ts.
              settings: t("settings"),
            }}
          />
        </div>
      </nav>
    </>
  );
}
