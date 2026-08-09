"use client";

// «Показаться после праздника» — строка, подтверждение, действие (тикет 128,
// словарь дизайна раунда 27, секция `Consent.rethink*`).
//
// ЧТО ИЗМЕНИЛОСЬ ПРОТИВ ТИКЕТА 98b. Тогда дизайн слов не дал, и мы собрали
// строку на своих: подпись и две голые кнопки «да / нет». Нажатие сразу
// уезжало на сервер. Дизайн прислал десять канонических строк и другую
// механику: у каждой стороны есть СВОЁ подтверждение с объяснением, что
// именно случится, — «{name} увидит твоё имя, когда разберёт подарки» против
// «Имя останется при тебе». Ответ меняется только после согласия; «Оставить
// как есть» не трогает ничего.
//
// ЗАМОК НАШ И ДИЗАЙН ЕГО ПРИНЯЛ ДОСЛОВНО (`Consent._rethinkLock`): передумать
// можно, пока не ЗАКРЫТ ИТОГ праздника, а не до календарной даты. Считает это
// сервер (`MyBookingConnectionDto.editable`), здесь только подача.
//
// ПОЧЕМУ СЛОВА ПРИХОДЯТ ПРОПАМИ, а не через `useTranslations`: строка живёт в
// одном экране, но её механика — самое тонкое место согласия, и проверять её
// хочется без интернационализации в тесте. Та же причина, что у ItemActions.
import { useState } from "react";

/** Девять строк дизайна на эту строку. Десятая, `_rethinkLock`, — его пометка. */
export type RethinkWords = {
  /** Подпись строки: «Показаться после праздника». */
  row: string;
  onTitle: string;
  onBody: string;
  onYes: string;
  offTitle: string;
  offBody: string;
  offYes: string;
  /** Общий отказ на обе стороны: «Оставить как есть». */
  keep: string;
  /** Итог закрыт — ответ отыгран. */
  locked: string;
};

/** Вопрос той стороны, к которой человек потянулся. */
export type RethinkQuestion = { title: string; body: string; yes: string };

/**
 * Показаться (`target = true`) и спрятаться — два РАЗНЫХ вопроса: у каждого
 * своё объяснение последствия. Подмена одного другим — самая дешёвая ошибка
 * в этом месте, поэтому выбор отделён от разметки и проверяется тестом.
 */
export function rethinkQuestion(target: boolean, words: RethinkWords): RethinkQuestion {
  return target
    ? { title: words.onTitle, body: words.onBody, yes: words.onYes }
    : { title: words.offTitle, body: words.offBody, yes: words.offYes };
}

/**
 * Переключатель строки. Ответа он НЕ меняет и меняться не может: `onAnswer`
 * сюда не приходит вовсе — единственное, что умеет нажатие, это назвать
 * сторону, о которой спросят. Так «нажал — и уехало на сервер» не вернётся
 * правкой разметки.
 */
export function RethinkSwitch({
  label,
  on,
  disabled,
  onPress,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onPress: (target: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onPress(!on)}
      className="pressable flex-none"
    >
      <span
        aria-hidden
        className={`relative block h-[22px] w-[38px] rounded-full ${
          on ? "bg-text-strong" : "bg-surface-hairline-strong"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-surface-app-ground ${
            on ? "right-[2px]" : "left-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

/**
 * Подтверждение: заголовок, объяснение и два ответа. Согласие — единственная
 * дорога к `onYes`; «Оставить как есть» умеет только закрыть вопрос.
 */
export function RethinkConfirm({
  question,
  keep,
  busy,
  onYes,
  onKeep,
}: {
  question: RethinkQuestion;
  keep: string;
  busy?: boolean;
  onYes: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="mt-2 border border-surface-hairline p-3">
      <p className="text-xs font-semibold text-text-strong">{question.title}</p>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">{question.body}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={onYes}
          className="pressable border border-surface-hairline-strong px-3 py-2 text-xs font-semibold text-text-strong"
        >
          {question.yes}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onKeep}
          className="pressable text-xs text-text-muted"
        >
          {keep}
        </button>
      </div>
    </div>
  );
}

type RethinkRowProps = {
  /** Текущий ответ гостя: показаться после праздника или подарить тихо. */
  offers: boolean;
  /** Можно ли ещё передумать. false — итог праздника закрыт. */
  editable: boolean;
  busy?: boolean;
  words: RethinkWords;
  onAnswer: (offers: boolean) => void;
};

export function RethinkRow({ offers, editable, busy, words, onAnswer }: RethinkRowProps) {
  // null — вопрос не задан; true/false — к какой стороне человек потянулся.
  const [asking, setAsking] = useState<boolean | null>(null);

  return (
    <div className="mt-3 border-t border-surface-hairline pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex-1 text-xs text-text-muted">{words.row}</span>
        {/* Переключатель остаётся и после замка, но выключенным: свой ответ
            человек вправе видеть, а менять его уже нечем — почему, говорит
            строка под ним. Отдельного слова на «да/нет» дизайн не дал. */}
        <RethinkSwitch
          label={words.row}
          on={offers}
          disabled={!editable || busy || asking !== null}
          onPress={setAsking}
        />
      </div>

      {!editable && (
        <p className="mt-1.5 text-[11px] leading-snug text-text-muted">{words.locked}</p>
      )}

      {asking !== null && (
        <RethinkConfirm
          question={rethinkQuestion(asking, words)}
          keep={words.keep}
          busy={busy}
          onYes={() => {
            setAsking(null);
            onAnswer(asking);
          }}
          onKeep={() => setAsking(null)}
        />
      )}
    </div>
  );
}
