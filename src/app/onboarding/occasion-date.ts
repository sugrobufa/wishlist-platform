// День рождения в онбординге (тикеты 43 и 187). Модуль намеренно без React и
// без БД: правила чтения проверяются тестом (occasion-date.test.ts), а не
// прокликиванием формы.
//
// ЗДЕСЬ БЫЛА «ДАТА» — один календарный день `YYYY-MM-DD` из `<input
// type="date">`. Тикет 187 переспросил её ДНЁМ РОЖДЕНИЯ: шаг присылает день и
// месяц двумя списками, год не спрашивается вовсе, а сама арифметика
// повторяющейся даты живёт в домене (`src/server/birthday.ts`). Здесь остались
// два входа этого экрана:
// - `readBirthdayForm` — поля шага 3 на сервере (форма может прислать что
//   угодно, включая «Пока не знаю» с пустыми списками);
// - `initialBirthdayValue` — значение, пришедшее СНАРУЖИ (тикет 38: день
//   рождения, названный гостем при тихой броне). Мусор снаружи не должен
//   уронить шаг.
//
// ГОД ИЗ ПРЕДЗАПОЛНЕНИЯ НЕ БЕРЁТСЯ. Гость называл там БЛИЖАЙШИЙ праздник, и
// год в той строке — год праздника, а не год рождения; записать его в комнату
// значило бы записать неправду. День и месяц — ровно то, что человек имел в
// виду, и они переезжают.
import { parseBirthday, type Birthday } from "@/server/birthday";

/** Пустой ответ шага: ни дня, ни месяца. */
export type BirthdayDraft = { day: number | null; month: number | null };

export const EMPTY_BIRTHDAY: BirthdayDraft = { day: null, month: null };

/**
 * День рождения из полей формы или `null`, если его не назвали. Отклоняются
 * пустые списки, один список без другого и несуществующие числа (31 февраля
 * по форме проходит, а днём рождения не бывает).
 */
export function readBirthdayForm(day: unknown, month: unknown): Birthday | null {
  return parseBirthday({ day, month, year: null });
}

/**
 * Стартовое значение списков шага 3. Это шов для предзаполнения снаружи
 * (тикет 38): что не похоже на день — молча становится пустыми списками, шаг
 * ведёт себя как обычно.
 */
export function initialBirthdayValue(prefilled: string | null | undefined): BirthdayDraft {
  const birthday = parseBirthday(prefilled);
  return birthday === null ? EMPTY_BIRTHDAY : { day: birthday.day, month: birthday.month };
}

/**
 * Календарный день `YYYY-MM-DD` из строки предзаполнения — или `null`.
 * Остался для cookie предзаполнения (`guest-intro.ts`) и её разбора: там
 * человек печатает именно день, и хранить его строкой проще, чем разбирать
 * на числа в браузере.
 */
export function readOccasionDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return parseBirthday(value) === null ? null : value;
}
