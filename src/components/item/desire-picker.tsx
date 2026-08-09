"use client";

// Шкала желания ВВОДОМ — четыре огонька на целях 44 (тикет 124, раунд 29,
// `design/package/handoff/round29/task31.json` → addFormScale).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ. Ввод степени живёт в двух местах: вторым вопросом
// формы добавления и правкой НА МЕСТЕ в карточке вещи у хозяйки. Правила у них
// одни («дефолта нет», «не скажу» законно, слово появляется при выборе), и
// разъехаться им нельзя: расхождение здесь не видно ни линту, ни типам — оно
// видно только человеку, который заполняет форму и не узнаёт её в карточке.
//
// ПРАВИЛА ДИЗАЙНА (task31.json → addFormScale), воплощаются здесь целиком:
// - `mandatory: НЕТ` — поле необязательное, «не скажу» остаётся законным
//   пустым: «принуждение убьёт шкалу»;
// - `form` — четыре огонька на целях 44, точка 14 px, слово ступени появляется
//   ПРИ ВЫБОРЕ, «не скажу» тихой кнопкой справа, **дефолта НЕТ**;
// - `devaluation` — «мечтаю у всего подряд» без дефолта не случается: каждый
//   огонёк это выбор, а слова ступеней держат лестницу. Поэтому ни одна
//   ступень не проставляется системой — ни здесь, ни в сервисе.
//
// ПОЧЕМУ ЭТО RADIOGROUP НА ПЯТЬ ПОЛОЖЕНИЙ, А НЕ ЧЕТЫРЕ. «Не скажу» — такое же
// состояние поля, как и четыре ступени, и читалка обязана уметь в него
// вернуться. Начальное положение группы — именно оно, и это не «дефолт
// степени»: ни один огонёк не горит, пока по нему не нажали.
import { useTranslations } from "next-intl";
import { DESIRE_DREAM, DESIRE_STEPS } from "./desire-scale";
import s from "./desire-picker.module.css";

/** "#RRGGBB" + альфа → 8-значный hex (ореол «мечтаю» — акцент с .9). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

type DesirePickerProps = {
  /** 1–4 или `null` («не скажу»). Значения вне 1–4 читаются как пустое. */
  desire: number | null;
  /** Акцент комнаты «#RRGGBB» — им горят выбранные огоньки. */
  accent: string;
  /** Новое значение: ступень или `null`. Повторный тап по ступени её снимает. */
  onPick: (next: number | null) => void;
  disabled?: boolean;
};

export function DesirePicker({ desire, accent, onPick, disabled }: DesirePickerProps) {
  const t = useTranslations("AddItem");
  const value = desire != null && DESIRE_STEPS.includes(desire as 1 | 2 | 3 | 4) ? desire : null;

  return (
    <div className={s.picker}>
      <div className={s.steps} role="radiogroup" aria-label={t("desireLabel")}>
        {DESIRE_STEPS.map((step) => {
          const on = value != null && step <= value;
          return (
            <button
              key={step}
              type="button"
              role="radio"
              disabled={disabled}
              aria-checked={value === step}
              aria-label={t(`desire${step}`)}
              // Повторный тап по выбранной ступени возвращает пустое: дорога
              // назад из ошибочного тапа обязана быть, а «не скажу» рядом —
              // не всегда очевидный способ ею воспользоваться.
              onClick={() => onPick(value === step ? null : step)}
              className={`pressable ${s.step}`}
            >
              <span
                aria-hidden
                className={on ? `${s.flame} ${s.flameOn}` : s.flame}
                style={
                  on
                    ? {
                        background: accent,
                        // Ореол — только у «мечтаю» и только на её огоньке:
                        // «мечта в этом продукте всегда подсвечена» (36d).
                        boxShadow:
                          value === DESIRE_DREAM && step === DESIRE_DREAM
                            ? `0 0 10px ${withAlpha(accent, 0.9)}`
                            : undefined,
                      }
                    : undefined
                }
              />
            </button>
          );
        })}

        {/* «Не скажу» — тихая кнопка справа (task31.json → addFormScale.form).
            Стоит на экране ВСЕГДА, а не появляется после выбора: она и есть
            обещание «поле необязательное», ради которого шкалу подняли вторым
            вопросом. Акцентом не горит никогда — иначе пустое положение
            читалось бы выбранным по умолчанию, а дефолта у шкалы нет. */}
        <button
          type="button"
          role="radio"
          disabled={disabled}
          aria-checked={value === null}
          onClick={() => onPick(null)}
          className={value === null ? `pressable ${s.unset} ${s.unsetOn}` : `pressable ${s.unset}`}
        >
          {t("desireUnset")}
        </button>
      </div>

      {/* Слово ступени появляется ПРИ ВЫБОРЕ и молчит на пустом: «не скажу»
          уже написано кнопкой, и повторять его подписью значит сказать дважды
          одно и то же. */}
      {value !== null && <p className={s.word}>{t(`desire${value}`)}</p>}
    </div>
  );
}
