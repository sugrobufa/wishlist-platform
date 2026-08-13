"use client";

// Экран «Полки» — список полок комнаты (турн 57a, контракт
// `design/package/handoff/round51/zone-list.json`, тикет 239).
//
// ЗАЧЕМ. До решения владельца 14.08.2026 список полок был удобством. Теперь
// семь полок из 134 живут БЕЗ МЕСТА НА КАДРЕ (`zonesWithoutRect`, тикет 235):
// метки у них нет, камера к ним не едет — и список стал их ЕДИНСТВЕННОЙ
// дорогой. Экран из удобного стал обязательным.
//
// ГЛАВНОЕ РЕШЕНИЕ ЭКРАНА — ОН НИЧЕГО НЕ ПОМЕЧАЕТ. Подпись «на кадре её нет»
// дизайн отклонил своим же доводом, которым снимал «писать некуда»: это
// сообщение об отсутствии. Человек не знает, что у полки бывает место на кадре,
// и узнавать ему незачем — полка открывается, вещи внутри, всё работает.
// Следствие, которое стоит держать: новое состояние не потребовало НИ ОДНОГО
// нового знака. Потребовало бы — значит завели второй сорт полок, а не закрыли
// дырку.
//
// ПОЭТОМУ ЗДЕСЬ НЕТ И НЕ ДОЛЖНО ПОЯВИТЬСЯ: чтения `withoutRect`, ветки «а если
// без прямоугольника», своего порядка для этих семи, второго класса строки.
// Компонент про полку знает ровно три вещи — подпись, число вещей и адрес, —
// и различить по ним семь особенных нельзя в принципе. Сторожит это
// tests/zone-list-screen.
//
// ЕДИНСТВЕННОЕ ПРИГЛУШЕНИЕ В СПИСКЕ — ПУСТАЯ ПОЛКА, и оно про ВЕЩИ, а не про
// место на кадре: пустая полка без места и пустая полка с местом выглядят
// одинаково, полная без места и полная с местом — тоже.
import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { IconBack } from "@/components/icons";
import { zoneCounterLine } from "@/components/scene/zone-counter";
import s from "./zone-list.module.css";

/** Шеврон строки — 15 при .4 (контракт → row.chevron). */
const CHEVRON_SIZE = 15;

export type ZoneListRow = {
  /** Ключ полки — он же адрес её экрана. */
  key: string;
  label: string;
  /** Куда ведёт строка целиком (контракт → row.target: «вся строка»). */
  href: string;
  /** Сколько вещей КОМНАТЫ на полке — считает сервер. */
  total: number;
  /**
   * Идентификаторы этих вещей: из них экран вычитает занятые. Приходят ТОЛЬКО
   * у гостя — вместе с `takenIds`; хозяйке второе число не показывается вовсе
   * (инвариант №1), и считать ей нечего.
   */
  itemIds?: readonly string[];
};

export type ZoneListViewProps = {
  rows: readonly ZoneListRow[];
  /**
   * Ключ зоны-копилки: у неё вместо числа слово «открыта», и стоит она
   * последней — вещей в ней не бывает (контракт → states.money). Приходит
   * пропом, а не импортом из `@/config/design`: тот тянет за собой rooms.json
   * (130 зон) в клиентскую сборку, а нужен из него один ключ.
   */
  moneyKey?: string;
  /**
   * Занятые вещи комнаты — приходит ТОЛЬКО у гостя (тикет 08, некэшируемый
   * канал «занято»). Хозяйке этот набор не передаётся и передан быть не может:
   * инвариант №1 запрещает ей знать, что именно забрано, — у неё в том же месте
   * стоит «N вещей».
   */
  takenIds?: ReadonlySet<string>;
};

export function ZoneListView({ rows, moneyKey, takenIds }: ZoneListViewProps) {
  const t = useTranslations("ZoneList");
  const tGrid = useTranslations("ZoneGrid");
  const tScene = useTranslations("Scene");

  // Копилка — последней. Сортировка устойчивая (ES2019), поэтому порядок
  // остальных полок остаётся тем же, что в комнате: номер строки совпадает с
  // номером полки, которую человек видел на сцене. Другого порядка у экрана
  // нет — ни по числу вещей, ни по наличию места на кадре.
  const ordered = useMemo(
    () => [...rows].sort((a, b) => Number(a.key === moneyKey) - Number(b.key === moneyKey)),
    [rows, moneyKey],
  );

  /**
   * Что стоит справа. Ключи — те же, что в зоне: новых строк экран не завёл
   * (контракт → states.guest.newKeys: «не нужны»).
   *   копилка → ZoneList.moneyOpen «открыта»;
   *   пусто   → ZoneList.empty «пусто»;
   *   хозяйке → ZoneGrid.zoneCounts «N вещей» (`want: 0` гасит вторую половину);
   *   гостю   → Scene.summaryFree* «3 из 4 свободны» / «все 4 уже дарят».
   */
  const countOf = (row: ZoneListRow) => {
    if (moneyKey != null && row.key === moneyKey) return t("moneyOpen");
    if (row.total === 0) return t("empty");
    if (!takenIds) return tGrid("zoneCounts", { total: row.total, want: 0 });
    // Пока канал не ответил, `taken` пуст и свободны все — то же, что уже
    // сказала страница. Приём слово в слово из `GuestZoneFree` (booking).
    let free = 0;
    for (const id of row.itemIds ?? []) if (!takenIds.has(id)) free += 1;
    const line = zoneCounterLine(row.total, free);
    return tScene(line.key, line.values);
  };

  return (
    <ul className={s.rows}>
      {ordered.map((row) => {
        // Единственная развилка вида во всём компоненте — и она про вещи.
        // Копилка в неё не попадает: «открыта» — не «пусто», и приглушать
        // полку за то, что вещей в ней не бывает, нечестно.
        const empty = row.total === 0 && !(moneyKey != null && row.key === moneyKey);
        return (
          <li key={row.key} className={s.item}>
            <Link href={row.href} className={`pressable ${s.row}`}>
              <span className={empty ? `${s.label} ${s.labelEmpty}` : s.label}>{row.label}</span>
              <span className={empty ? `${s.count} ${s.countEmpty}` : s.count}>{countOf(row)}</span>
              <span className={s.chevron}>
                <IconBack size={CHEVRON_SIZE} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
