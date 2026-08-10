"use client";

// Действия с вещью: два знака на виду, остальное под «⋯» (тикет 123, турн 36b).
//
// ЗАЧЕМ. Владелец на приёмке 09.08: «Кнопки действия с предметом как в комнате,
// так и в сокровищнице надо сделать понятными, а не нагромождение текста». Под
// каждой вещью стояло в строку четыре текстовых действия, а на витрине — ещё и
// поясняющий абзац под ними. Пять вещей — двадцать слов действий на экране.
//
// ПРАВИЛО ДИЗАЙНА (36b), воплощается здесь целиком:
// - на виду РОВНО два знака: главный и «⋯»; точка входа в вещь — сама строка,
//   знаки вторичны;
// - лист под «⋯» — знак + титул + подстрока; опасное действие тихой строкой,
//   подтверждение спрашивает уже вызывающая сторона;
// - знаки 19 px на целях 44;
// - поясняющий абзац под действиями умирает — подстроки листа его заменяют.
//
// Компонент общий на комнату и сокровищницу нарочно: правило «два знака» тем и
// держится, что его негде обойти. Слова и сами действия приходят снаружи —
// у комнаты и витрины разные словари (ns Settings и ns Hall) и разные сервисы.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { IconActionMore } from "@/components/icons";
import s from "./item-actions.module.css";

/** Строка листа «⋯»: знак, титул, подстрока. */
export type ItemActionRow = {
  /**
   * Смысловой ключ строки — «treasury» / «hide» / «return» / «delete».
   * Не для показа: по нему состав листа сверяется тестом, а вызывающая
   * сторона не может незаметно подменить одно действие другим.
   */
  key: string;
  icon: ReactNode;
  title: string;
  /** Подстрока — та самая, что заменила поясняющий абзац. */
  hint: string;
  /** Опасное действие: тише титулом, стоит последним. */
  danger?: boolean;
  onSelect: () => void;
};

type ItemActionsProps = {
  /**
   * Главный знак: карандаш в комнате, перо-заметка в сокровищнице. Ведёт
   * ссылкой (карточка вещи) или делает что-то на месте — но он один.
   *
   * НЕОБЯЗАТЕЛЕН — и это не послабление правила, а второй его случай. Правило
   * говорит «на виду МАКСИМУМ два знака: главный и ⋯»; в списке зоны главный
   * знак не рисуется вовсе, потому что его роль играет сама строка (контракт
   * `handoff/zone-row.json`: «знак в конце ОДИН»). Там же и причина: три цели
   * по 44 — это 132 px из 335, половина строки на то, что нужно раз в месяц.
   */
  primary?: {
    icon: ReactNode;
    /** Слова на экране нет — оно в aria-label и в подсказке наведения. */
    label: string;
    href?: string;
    onSelect?: () => void;
  };
  rows: ItemActionRow[];
  /** Подпись знака «⋯» для читалки. */
  moreLabel: string;
  disabled?: boolean;
  /**
   * Кегль «⋯». По умолчанию 19 — общий размер знака в строке (36b). Список
   * зоны просит 20 своим контрактом (zone-row.json → form.trailing.glyph):
   * знак там один, и он сам себе ряд.
   */
  glyph?: number;
};

/** Знак в строке: 19 px на цели 44 (числа доски, не подбирать заново). */
export const SIGN_SIZE = 19;

export function ItemActions({
  primary,
  rows,
  moreLabel,
  disabled,
  glyph = SIGN_SIZE,
}: ItemActionsProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Лист закрывается по Escape и по нажатию мимо: он не диалог, фокус не
  // запирает и путь наружу обязан быть коротким.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className={s.actions} ref={box}>
      {primary &&
        (primary.href ? (
          <Link
            href={primary.href}
            aria-label={primary.label}
            title={primary.label}
            className={`pressable ${s.sign}`}
          >
            {primary.icon}
          </Link>
        ) : (
          <button
            type="button"
            disabled={disabled}
            aria-label={primary.label}
            title={primary.label}
            onClick={primary.onSelect}
            className={`pressable ${s.sign}`}
          >
            {primary.icon}
          </button>
        ))}

      <button
        type="button"
        disabled={disabled}
        aria-label={moreLabel}
        title={moreLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`pressable ${s.sign}`}
      >
        <IconActionMore size={glyph} />
      </button>

      {open && (
        <>
          {/* Нажатие мимо листа: слой поверх страницы, но под самим листом. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className={s.scrim}
            onClick={() => setOpen(false)}
          />
          <div className={s.sheet} role="menu" aria-label={moreLabel}>
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  row.onSelect();
                }}
                className={`pressable ${s.row}`}
              >
                <span className={s.rowSign} aria-hidden>
                  {row.icon}
                </span>
                <span className={s.rowBody}>
                  <span className={row.danger ? `${s.rowTitle} ${s.rowDanger}` : s.rowTitle}>
                    {row.title}
                  </span>
                  <span className={s.rowHint}>{row.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
