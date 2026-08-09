// Степень желания — четыре огонька (тикет 125, турн 36d).
//
// ЗАЧЕМ. Поле `desire` (1–4) заполняется при добавлении и в правке, лежит в
// базе и доезжает до гостя ОБОИМИ DTO — и не рисовалось ни одним компонентом.
// Владелец: «У нас есть при добавлении вещи его степень желания — нигде в
// карточке у гостя и хозяйки я этого не видел. Почему?» Потому что показ никто
// не собрал: проводка была целой до последнего шага. Этот файл — тот шаг.
//
// ВИД (36d), числами доски:
// - четыре огонька: 6 px в карточке вещи, у цены и со словом; 5 px в строке
//   зоны, без слова;
// - заполненные — акцент комнаты, пустые — .2;
// - на «мечтаю» (4 из 4) последний огонёк светится: единственная ступень с
//   ореолом. «Мечта в этом продукте всегда подсвечена»;
// - `desire = null` («не скажу») — шкалы нет ВОВСЕ: пустое не рисуется нулём;
// - в сокровищнице шкала не показывается: желание исполнено (проверка — в
//   вызывающей стороне, здесь такого знания нет);
// - гостю — тот же вид: он по шкале выбирает подарок.
//
// Слова — `AddItem.desire1–4` («пусть будет · хочется · очень хочется ·
// мечтаю»): шкала заполняется в добавлении и правке, там её словарь и живёт.
import { useTranslations } from "next-intl";
import s from "./desire-scale.module.css";

/** Ступеней ровно четыре — и в форме, и в показе (items.json → extraFields). */
export const DESIRE_STEPS = [1, 2, 3, 4] as const;

/** Верхняя ступень: «мечтаю». Только у неё огонёк с ореолом. */
export const DESIRE_DREAM = 4;

type DesireScaleProps = {
  /** 1–4; `null`/`undefined` («не скажу») — не рисуется ничего. */
  desire: number | null | undefined;
  /** Акцент комнаты «#RRGGBB» — им горят заполненные огоньки. */
  accent: string;
  /**
   * Где стоит шкала. `card` — у цены в карточке вещи, огоньки 6 px и слово
   * рядом; `row` — в строке зоны, огоньки 5 px и без слова.
   */
  place: "card" | "row";
};

/** "#RRGGBB" + альфа → 8-значный hex (ореол «мечтаю» — акцент с .9). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

export function DesireScale({ desire, accent, place }: DesireScaleProps) {
  const t = useTranslations("AddItem");

  // «Не скажу» — не ноль: шкалы нет вовсе. Сюда же попадает мусор из БД:
  // рисовать «полшкалы» по неожиданному числу мы не станем.
  if (desire == null || !DESIRE_STEPS.includes(desire as (typeof DESIRE_STEPS)[number])) {
    return null;
  }

  const word = t(`desire${desire}`);
  const withWord = place === "card";

  return (
    <span className={place === "card" ? `${s.scale} ${s.card}` : `${s.scale} ${s.row}`}>
      <span
        className={s.flames}
        // Со словом рядом читалке хватает слова; без слова говорит шкала.
        {...(withWord ? { "aria-hidden": true } : { role: "img", "aria-label": word })}
      >
        {DESIRE_STEPS.map((step) => (
          <span
            key={step}
            className={step <= desire ? `${s.flame} ${s.flameOn}` : s.flame}
            style={
              step <= desire
                ? {
                    background: accent,
                    boxShadow:
                      desire === DESIRE_DREAM && step === DESIRE_DREAM
                        ? `0 0 8px ${withAlpha(accent, 0.9)}`
                        : undefined,
                  }
                : undefined
            }
          />
        ))}
      </span>
      {withWord && <span className={s.word}>{word}</span>}
    </span>
  );
}
