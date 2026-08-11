"use client";

import { useLocale, useTranslations } from "next-intl";
import { daysInMonth } from "@/server/birthday";

/**
 * Выбор дня рождения — ДЕНЬ и МЕСЯЦ двумя списками (тикет 187).
 *
 * ПОЧЕМУ НЕ `<input type="date">`. Он требует год, а год продукту не нужен ни
 * для чего: спрашивать его — брать лишнее. Он же подставлял в поле сегодняшнее
 * число, и человек видел готовое значение, смысла которого никто не назвал, —
 * с этого и началась приёмка 11.08.2026. Два списка называют себя сами и
 * пустыми не притворяются заполненными.
 *
 * Названия месяцев берутся у `Intl` по локали страницы, а не из словаря: это
 * календарь, а не наши слова, и переводить его вручную значило бы держать
 * двенадцать строк на каждый язык ради того, что в платформе уже есть.
 *
 * Один компонент на онбординг и настройки: правило «день + месяц, год не
 * спрашиваем» должно быть одно, иначе экраны разъедутся.
 */
export function BirthdayPicker({
  day,
  month,
  onChange,
}: {
  day: number | null;
  month: number | null;
  /** Оба значения разом: список дней зависит от месяца. */
  onChange: (next: { day: number | null; month: number | null }) => void;
}) {
  const t = useTranslations("Birthday");
  const locale = useLocale();

  const monthNames = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2001, index, 1)),
    ),
  );
  // Год неизвестен — февраль вмещает 29: 29 февраля законный день рождения.
  const dayCount = month === null ? 31 : daysInMonth(month);

  return (
    <div className="flex gap-2">
      <select
        aria-label={t("day")}
        name="birthdayDay"
        value={day ?? ""}
        onChange={(event) => {
          const next = event.target.value === "" ? null : Number(event.target.value);
          onChange({ day: next, month });
        }}
        className={FIELD_CLASS}
      >
        <option value="">—</option>
        {Array.from({ length: dayCount }, (_, index) => index + 1).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      <select
        aria-label={t("month")}
        name="birthdayMonth"
        value={month ?? ""}
        onChange={(event) => {
          const next = event.target.value === "" ? null : Number(event.target.value);
          // 31-е в апреле не бывает: месяц сменился — день подтягивается к
          // последнему своему, а не молча превращается в чужой.
          const maxDay = next === null ? 31 : daysInMonth(next);
          onChange({ day: day === null ? null : Math.min(day, maxDay), month: next });
        }}
        className={`${FIELD_CLASS} flex-1`}
      >
        <option value="">—</option>
        {monthNames.map((name, index) => (
          <option key={name} value={index + 1}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Вид поля — общий с остальными полями онбординга и настроек. */
const FIELD_CLASS =
  "border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint";
