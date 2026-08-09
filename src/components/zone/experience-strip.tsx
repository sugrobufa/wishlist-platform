"use client";

// Полоса ячеек услуги-впечатления (тикет 97, доска Б20 · турн 8e):
// «Когда · Где · Годен до». Общая для карточки хозяйки и карточки гостя —
// это один и тот же рассказ о впечатлении, и расходиться им незачем.
//
// ПУСТОЕ ПОЛЕ НЕ РИСУЕТСЯ: полоса из трёх клеток, где две пустые, читается
// как незаполненная анкета, а не как рассказ. Ячеек 3 → 2 → 1, прочерков нет
// (правило спецификации, проверяется в dto/experience).
import { useFormatter, useTranslations } from "next-intl";
import { experienceCells, type ExperienceFields } from "@/server/dto/experience";
import s from "./experience-strip.module.css";

export function ExperienceStrip({ item }: { item: ExperienceFields }) {
  const t = useTranslations("Experience");
  const format = useFormatter();
  const cells = experienceCells(item);
  if (cells.length === 0) return null;

  return (
    <div className={s.strip}>
      {cells.map((cell) => (
        <div key={cell.key} className={s.cell}>
          <span className={s.label}>{t(cell.key)}</span>
          <span className={s.value}>
            {cell.key === "validUntil"
              ? // Дату форматирует разметка, а не словарь: в словаре живут
                // слова. День календарный, поэтому читаем его полднем UTC —
                // иначе на машине западнее Гринвича он съедет на сутки назад.
                format.dateTime(new Date(`${cell.value}T12:00:00.000Z`), {
                  day: "numeric",
                  month: "long",
                })
              : cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}
