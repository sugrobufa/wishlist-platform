"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { BirthdayPicker } from "@/components/birthday-picker";
import { IconCheck } from "@/components/icons";
import { createRoomAction } from "./actions";
import { initialBirthdayValue } from "./occasion-date";

export type PresetCard = {
  id: string;
  name: string;
  sex: "F" | "M";
  accent: string;
  ink: string;
  imageUrl: string;
};

/**
 * ПОЛ, А НЕ «НАБОР ЗОН», И ЗНАЧЕНИЙ У НЕГО ДВА (тикет 241, решение владельца
 * 14.08.2026). «Все десять» отменено: смешения комнат не должно быть, потому
 * что переезд из женской комнаты в мужскую уносит шесть полок в «Что угодно» —
 * общих у наборов семь ключей из двадцати. Зеркало серверной схемы
 * `zoneSetSchema`; разбор — там же.
 */
type ZoneSet = "F" | "M";

const ZONE_SETS: ZoneSet[] = ["F", "M"];

/**
 * ТРИ ШАГА: набор → интерьер → дата (письмо 33, турн 40b).
 *
 * Четвёртым был вопрос «что чаще всего хочется» (тикет 113, доска 34b). Он
 * уехал из онбординга в первое открытие «начни с готового»
 * (`src/app/room/starter-pack.tsx`) — там ответ сразу виден в подборке,
 * которую он красит. Причину назвал сам дизайн: после отмены состояний
 * (тикет 124) стартовый набор ужался вдвое, и целый экран между человеком и
 * его комнатой стал дороже пользы. Слова вопроса не менялись — переехало
 * место (`Onboarding.wants*`, помета `_wantsMoved` в словаре пакета).
 */
const TOTAL_STEPS = 3;

type Step = 1 | 2 | 3;

/**
 * Локап Grace над шагами (письмо 33 · турн 40a, `task33.json → lockupOnSteps`).
 * Числа дизайна: высота 22, по центру, top = safe-area + 30, до оверлайна шага
 * 28, opacity .92 — одинаково на всех трёх шагах. Не кнопка, не анимируется, с
 * заголовком (23/700) не спорит: человек ещё не знает, где он оказался, и
 * подпись отвечает ему тихо.
 *
 * Первое место в продукте, где локап вообще применяется: шапка комнаты собрана
 * разметкой с загруженным Onest, и файл лежал без дела с раунда 13.
 */
const LOCKUP_URL = "/logo/grace-lockup-outlined.svg";
const LOCKUP_HEIGHT = 22;
/** Ширина при высоте 22 — из вьюбокса файла 176×48, а не на глаз. */
const LOCKUP_WIDTH = Math.round((LOCKUP_HEIGHT * 176) / 48);

/** "#RRGGBB" + альфа → 8-значный hex (ореол «полосы света», tokens.json). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

function filterBySet(presets: PresetCard[], set: ZoneSet): PresetCard[] {
  return presets.filter((preset) => preset.sex === set);
}

/**
 * Онбординг в три шага: «что внутри» (три плитки) → лента комнат → дата
 * праздника (тикет 43; шаги 1–2 — тикет 01). На втором шаге переключатель
 * остаётся над лентой — ответ можно передумать одним касанием (турн 14a).
 *
 * Комната создаётся В КОНЦЕ, на третьем шаге: обе кнопки шага — сабмиты
 * одной формы, и человек уходит в /room либо с датой, либо осознанно без
 * неё («Пока не знаю»). Молча проскочить дату нельзя: главная кнопка
 * заперта, пока поле пустое.
 *
 * `initialOccasionDate`, `initialName`, `signInEmail` — предзаполнение снаружи
 * (тикет 38). Холодный гость уже назвал имя и, возможно, день рождения, когда
 * тихо занимал подарок; шаг открывается заполненным, и человек может любое
 * поле поправить — предзаполнение ничего не запирает.
 */
export function OnboardingFlow({
  presets,
  initialOccasionDate = null,
  initialName = null,
  signInEmail = null,
}: {
  presets: PresetCard[];
  /** Предзаполнение даты снаружи (тикет 38); не день — поле будет пустым. */
  initialOccasionDate?: string | null;
  /** Имя из брони (тикет 38); null — поле пустое и без подписи «взяли из брони». */
  initialName?: string | null;
  /** Почта, которой человек вошёл, — показываем, а не спрашиваем. */
  signInEmail?: string | null;
}) {
  const t = useTranslations("Onboarding");
  const [step, setStep] = useState<Step>(1);
  const [zoneSet, setZoneSet] = useState<ZoneSet | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  // Предзаполнение снаружи (тикет 38): холодный гость мог назвать день
  // рождения, когда тихо занимал подарок. Берём из него ТОЛЬКО день и месяц:
  // год там — год ближайшего праздника, а не год рождения, и класть его в
  // комнату значило бы записать неправду (тикет 187).
  const [birthday, setBirthday] = useState(() => initialBirthdayValue(initialOccasionDate));
  const [displayName, setDisplayName] = useState(() => (initialName ?? "").trim());

  // Акценты наборов — из данных rooms.json (первая комната набора), не из кода.
  const setAccent: Record<ZoneSet, { accent: string; ink: string }> = {
    F: {
      accent: presets.find((p) => p.sex === "F")?.accent ?? "#E7C9A9",
      ink: presets.find((p) => p.sex === "F")?.ink ?? "#241A0E",
    },
    M: {
      accent: presets.find((p) => p.sex === "M")?.accent ?? "#7FB2FF",
      ink: presets.find((p) => p.sex === "M")?.ink ?? "#06121F",
    },
  };

  function pickZoneSet(set: ZoneSet) {
    setZoneSet(set);
    setStep(2);
    setPresetId((current) => {
      const visible = filterBySet(presets, set);
      return current && visible.some((preset) => preset.id === current)
        ? current
        : (visible[0]?.id ?? null);
    });
  }

  if (zoneSet === null || step === 1) {
    return (
      <main className={STEP_MAIN_CLASS}>
        <StepLockup />
        <div className="flex flex-1 flex-col md:justify-center">
          <p className="overline text-text-muted">
            {t("stepOverline", { current: 1, total: TOTAL_STEPS })} · {t("zoneSetStep")}
          </p>
          {/* СМЫСЛ ДО УСТРОЙСТВА (письмо 33, турн 40a). Заголовок называет
              МЕСТО, подзаголовок отдаёт обе половины смысла одной фразой (сюда
              складываешь себе — сюда приходят друзья), и только потом, подписью
              у карточек, звучит вопрос про устройство комнаты. Прежний экран
              начинал с устройства («Что будет в комнате?» + «это заготовка,
              какие полки поставить»), и человек не понимал, о чём речь. */}
          <h1 className="display mt-4 text-3xl md:text-5xl">{t("zoneSetTitle")}</h1>
          <p className="mt-4 max-w-md text-text-body">{t("zoneSetSubtitle")}</p>

          <div className="mt-8 flex flex-col gap-3 md:flex-row">
            {ZONE_SETS.map((set) => (
              // Карточки одной высоты, счётчик прижат к низу (приёмка 09.08:
              // у «Мужской» описание в одну строку против двух у соседей, и
              // «4 КОМНАТЫ» стояли на 12 px выше соседних). Длина описания на
              // раскладку не влияет вовсе — тянется оно, а не карточка,
              // поэтому следующая правка слов ряд заново не сломает.
              <button
                key={set}
                type="button"
                onClick={() => pickZoneSet(set)}
                className="pressable flex flex-1 flex-col border border-surface-hairline bg-surface-fill p-5 text-left hover:bg-surface-fill-hover"
              >
                <span className="block text-lg font-semibold text-text-primary">
                  {t(`setLabel${set}`)}
                </span>
                <span className="mt-1 block grow text-sm text-text-muted">
                  {t(`setDescription${set}`)}
                </span>
                <span className="overline mt-4 block text-text-faint">
                  {t("roomCount", { count: filterBySet(presets, set).length })}
                </span>
              </button>
            ))}
          </div>

          {/* Вопрос шага — тихой подписью под карточками, там, где выбор и
              происходит (турн 40a). Рамки и знака у неё больше нет: это не
              предупреждение, а продолжение разговора. */}
          <p className="mt-4 text-xs leading-relaxed text-text-faint">{t("zoneSetHint")}</p>
        </div>
      </main>
    );
  }

  const feed = filterBySet(presets, zoneSet);
  const selected = feed.find((preset) => preset.id === presetId) ?? feed[0];

  if (step === 2 || !selected) {
    return (
      <main className={STEP_MAIN_CLASS}>
        <StepLockup onBack={() => setStep(1)} />

        <p className="overline text-text-muted">
          {t("stepOverline", { current: 2, total: TOTAL_STEPS })} · {t("roomStep")}
        </p>
        <h1 className="display mt-4 text-3xl md:text-5xl">{t("presetTitle")}</h1>
        <p className="mt-4 max-w-md text-text-body">{t("presetSubtitle")}</p>

        {/* Переключатель набора над лентой — ответ можно передумать (турн 14a) */}
        <div className="mt-6 flex gap-2">
          {ZONE_SETS.map((set) => {
            const active = set === zoneSet;
            return (
              <button
                key={set}
                type="button"
                aria-pressed={active}
                onClick={() => pickZoneSet(set)}
                className={
                  active
                    ? "pressable flex-1 px-3 py-3 text-xs font-semibold"
                    : "pressable flex-1 border border-surface-hairline-strong bg-surface-fill px-3 py-3 text-xs font-semibold text-text-muted hover:bg-surface-fill-hover"
                }
                style={
                  active
                    ? { background: setAccent[set].accent, color: setAccent[set].ink }
                    : undefined
                }
              >
                {t(`setLabel${set}`)}
              </button>
            );
          })}
        </div>
        <p className="overline mt-3 text-text-faint">{t("roomCount", { count: feed.length })}</p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-3">
          {feed.map((preset) => {
            const active = preset.id === selected?.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPresetId(preset.id)}
                className="pressable relative aspect-[186/112] overflow-hidden text-left"
                style={active ? { boxShadow: `0 0 0 2px ${preset.accent}` } : undefined}
              >
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${preset.imageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "42% 42%",
                  }}
                />
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(0deg, rgba(11,8,6,.82), rgba(11,8,6,0) 58%)",
                  }}
                />
                <span className="absolute bottom-2.5 left-3 text-[13px] font-semibold text-text-primary">
                  {preset.name}
                </span>
                {active && (
                  <span
                    className="absolute right-2 top-2 flex h-[22px] w-[22px] items-center justify-center rounded-full"
                    style={{ background: preset.accent }}
                  >
                    {/* Галочка «Дошло» из набора; на 13 px контур утолщён до 3 —
                        оптическая компенсация (см. components/icons.tsx). */}
                    <IconCheck size={13} strokeWidth={3} style={{ color: preset.ink }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ПЕРЕЧНЯ ПОЛОК ЗДЕСЬ БОЛЬШЕ НЕТ (письмо 33, турн 40b; замечание
            владельца 09.08 «не надо перечислять, какие полки есть в комнате»).
            Была строка «Зоны этой комнаты: Одежда · Красота и уход · … +8» у
            выбранной заготовки (доска В3, турн 14a). Комнату выбирают ГЛАЗАМИ,
            а тринадцать слов под картинкой превращали выбор интерьера в чтение
            таблицы; внутри одного набора строка к тому же почти не менялась.
            Различие наборов теперь названо на шаге 1 — там, где выбирают набор. */}

        {selected && (
          <div className="sticky bottom-0 -mx-6 mt-8 bg-surface-app-ground px-6 pb-8 pt-4">
            <button
              type="button"
              onClick={() => setStep(3)}
              className={LIGHT_BUTTON_CLASS}
              style={lightButtonStyle(selected.accent)}
            >
              {t("next")} →
            </button>
          </div>
        )}
      </main>
    );
  }

  // ---- Шаг 3: день рождения (тикеты 43 и 187) ----
  //
  // ШАГ СПРАШИВАЛ «ДАТУ» — слово, которое ничего не называет: человек не знал
  // ни чья это дата, ни повторяется ли она, ни что случится, когда она пройдёт
  // (приёмка владельца 11.08.2026). Спрашиваем день рождения — единственную
  // дату, которую человек знает не думая; она повторяется сама, и следующая
  // считается без второго вопроса. Год не спрашиваем: возраст продукту не
  // нужен ни для чего. Остальные праздники (Новый год, 8 марта) у всех в один
  // день — их незачем спрашивать, комната предложит сама (отдельный тикет).
  //
  // ЗДЕСЬ СТОЯЛ ЧЕТВЁРТЫЙ ШАГ — «что чаще всего хочется» (тикет 113, доска
  // 34b). Он уехал целиком в первое открытие «начни с готового»: единственное,
  // что делал ответ, — красил подборку и порядок зон в добавлении, а стоял
  // отдельным экраном между человеком и его комнатой. Ни состав вопроса, ни
  // правило «3–4», ни то, что на комнату он не влияет, не менялись — сменилось
  // место (`src/app/room/starter-pack.tsx`, письмо 33 · турн 40b).

  // Кнопку запирает НЕПОЛНАЯ дата: один список без другого — это не ответ.
  const dateMissing = birthday.day === null || birthday.month === null;

  return (
    <main className={STEP_MAIN_CLASS}>
      <StepLockup onBack={() => setStep(2)} />

      <div className="flex flex-1 flex-col md:justify-center">
        <p className="overline text-text-muted">
          {t("stepOverline", { current: 3, total: TOTAL_STEPS })} · {t("occasionStep")}
        </p>
        <h1 className="display mt-4 text-3xl md:text-5xl">{t("occasionTitle")}</h1>
        <p className="mt-4 max-w-md text-text-body">{t("occasionSubtitle")}</p>

        <form action={createRoomAction} className="mt-8 flex w-full max-w-md flex-col gap-4">
          <input type="hidden" name="zoneSet" value={zoneSet} />
          <input type="hidden" name="preset" value={selected.id} />

          {/* Имя в комнате. Стоит рядом с датой сознательно: это последний
            экран, и оба поля — про самого человека, а не про интерьер.
            Необязательное — кнопку запирает только дата. */}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-text-muted">{t("nameLabel")}</span>
            <input
              type="text"
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              autoComplete="name"
              className="border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint"
            />
            {initialName !== null && initialName.trim() !== "" && (
              <span className="text-xs text-text-faint">{t("nameFromBooking")}</span>
            )}
          </label>

          {/* День рождения, а не безымянная «Дата» (тикет 187). Год не
            спрашиваем: продукту он не нужен, а дата повторяется сама —
            ближайшая считается от сегодня. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-text-muted">{t("occasionLabel")}</span>
            <BirthdayPicker day={birthday.day} month={birthday.month} onChange={setBirthday} />
          </div>

          {/* Кнопка заперта, пока поля нет: пропуск бывает только осознанным. */}
          <CreateRoomButton accent={selected.accent} disabled={dateMissing} />
          {dateMissing && <p className="text-xs text-text-faint">{t("occasionButtonHint")}</p>}

          <div className="mt-2 flex flex-col items-start gap-1.5 border-t border-surface-hairline pt-4">
            <SkipDateButton />
            <p className="text-xs text-text-faint">{t("occasionSkipHint")}</p>
            {/* Почта, которой человек вошёл: пароля в продукте нет, и об этом
              лучше сказать прямо один раз (доска, турн 12c). */}
            {signInEmail && (
              <p className="text-xs text-text-faint">{t("emailNote", { email: signInEmail })}</p>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}

/**
 * Общая рама шага: экран во всю высоту, отступы полей и место под локап.
 * `pb-10` вместо прежнего `py-10` — верхний отступ теперь у самого локапа
 * (safe-area + 30), и второй сверху сдвинул бы его с числа дизайна.
 */
const STEP_MAIN_CLASS =
  "mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 pb-10 md:max-w-4xl";

/**
 * Локап Grace над шагом и, если есть куда, стрелка «Назад» слева от него.
 *
 * Стрелка стоит В ЭТОЙ ЖЕ строке сознательно: числа дизайна отмерены от локапа
 * до ОВЕРЛАЙНА шага («до оверлайна 28»), и своя строка у «Назад» встала бы
 * ровно между ними. Локап при этом остаётся по центру ЭКРАНА — стрелка выведена
 * из потока (`absolute`), и ширина слова на его положение не влияет.
 */
function StepLockup({ onBack }: { onBack?: () => void }) {
  const t = useTranslations("Onboarding");

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 30px)", marginBottom: 28 }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="pressable absolute bottom-0 left-0 text-sm text-text-muted hover:text-text-strong"
        >
          ← {t("back")}
        </button>
      )}
      {/* Файл дизайна как есть, через раздачу пакета (src/app/logo/[file]).
          Не кнопка и не заголовок: `alt` называет место, ссылки под ним нет.
          eslint-disable — next/image здесь не к месту: оптимизатор SVG не
          трогает, а размеры знака заданы контрактом, а не раскладкой. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOCKUP_URL}
        alt="Grace"
        width={LOCKUP_WIDTH}
        height={LOCKUP_HEIGHT}
        style={{ height: LOCKUP_HEIGHT, width: LOCKUP_WIDTH, opacity: 0.92 }}
      />
    </div>
  );
}

/** «Полоса света» (tokens.json → button.primary, турн 22) — вид общий. */
const LIGHT_BUTTON_CLASS =
  "pressable w-full border-b-2 px-6 py-4 font-semibold text-text-primary disabled:opacity-60";

function lightButtonStyle(accent: string) {
  return { borderColor: accent, boxShadow: `0 4px 18px -3px ${withAlpha(accent, 0.42)}` };
}

/** Главная кнопка финала: создаёт комнату вместе с датой из поля рядом. */
function CreateRoomButton({ accent, disabled }: { accent: string; disabled: boolean }) {
  const t = useTranslations("Onboarding");
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={LIGHT_BUTTON_CLASS}
      style={lightButtonStyle(accent)}
    >
      {pending ? t("creating") : `${t("create")} →`}
    </button>
  );
}

/**
 * «Пока не знаю» — тот же сабмит, но с пометкой `skipDate`: экшен даже не
 * смотрит на поле даты. Тихая кнопка, не «полоса света»: пропуск — не
 * главное действие экрана.
 */
function SkipDateButton() {
  const t = useTranslations("Onboarding");
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="skipDate"
      value="1"
      disabled={pending}
      className="pressable text-sm font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
    >
      {t("occasionSkip")}
    </button>
  );
}
