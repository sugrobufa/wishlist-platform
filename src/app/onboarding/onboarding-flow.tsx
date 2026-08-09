"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { IconCheck, IconEye } from "@/components/icons";
import { createRoomAction } from "./actions";
import { initialOccasionValue } from "./occasion-date";

export type PresetCard = {
  id: string;
  name: string;
  sex: "F" | "M";
  accent: string;
  ink: string;
  imageUrl: string;
  /** Подписи зон этой комнаты — для строки «Зоны этой комнаты» (доска В3). */
  zoneLabels: string[];
  /** Ключи тех же зон, в том же порядке — чипам «что хочется» (тикет 113). */
  zoneKeys: string[];
};

/** Сколько зон называем словами; остальные — «+5» (форма доски). */
const ZONES_SHOWN = 5;

type ZoneSet = "F" | "M" | "ALL";

const ZONE_SETS: ZoneSet[] = ["F", "M", "ALL"];

/** Доска (турн 11d) просит три вопроса; счётчик шага говорит то же число. */
const TOTAL_STEPS = 4;

type Step = 1 | 2 | 3 | 4;

/**
 * «Что чаще всего хочется» (тикет 113, доска 34b): чипы — подписи зон
 * выбранного набора МИНУС две. «Что угодно» ловит всё, что не влезло в
 * категории, «Просто деньги» — копилка, а не вещи: обе как ответ на «что
 * хочется» не значат ничего.
 */
const WANTS_EXCLUDED = new Set(["anything", "money"]);

/** Выбрать можно 3–4; четвёртый гасит остальные чипы. Меньше — тоже ответ. */
const WANTS_MAX = 4;

/** "#RRGGBB" + альфа → 8-значный hex (ореол «полосы света», tokens.json). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

function filterBySet(presets: PresetCard[], set: ZoneSet): PresetCard[] {
  return set === "ALL" ? presets : presets.filter((preset) => preset.sex === set);
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
  const [occasionDate, setOccasionDate] = useState(() => initialOccasionValue(initialOccasionDate));
  const [displayName, setDisplayName] = useState(() => (initialName ?? "").trim());
  /** Ответ шага «что хочется» — ключи зон; пусто = пропустили. */
  const [wants, setWants] = useState<string[]>([]);

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
    ALL: { accent: "#FFF9F2", ink: "#0B0806" },
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
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10 md:max-w-4xl">
        <p className="overline text-text-muted">
          {t("stepOverline", { current: 1, total: TOTAL_STEPS })} · {t("zoneSetStep")}
        </p>
        <h1 className="display mt-4 text-3xl md:text-5xl">{t("zoneSetTitle")}</h1>
        <p className="mt-4 max-w-md text-text-body">{t("zoneSetSubtitle")}</p>

        <div className="mt-8 flex flex-col gap-3 md:flex-row">
          {ZONE_SETS.map((set) => (
            <button
              key={set}
              type="button"
              onClick={() => pickZoneSet(set)}
              className="pressable flex-1 border border-surface-hairline bg-surface-fill p-5 text-left hover:bg-surface-fill-hover"
            >
              <span className="block text-lg font-semibold text-text-primary">
                {t(`setLabel${set}`)}
              </span>
              <span className="mt-1 block text-sm text-text-muted">
                {t(`setDescription${set}`)}
              </span>
              <span className="overline mt-4 block text-text-faint">
                {t("roomCount", { count: filterBySet(presets, set).length })}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 flex items-start gap-3 border border-surface-hairline bg-surface-fill p-4">
          {/* Открытый глаз — наш знак (канона в 25a нет), из общего набора. */}
          <IconEye size={17} className="mt-0.5 flex-none text-text-faint" />
          <p className="text-xs leading-relaxed text-text-muted">{t("zoneSetHint")}</p>
        </div>
      </main>
    );
  }

  const feed = filterBySet(presets, zoneSet);
  const selected = feed.find((preset) => preset.id === presetId) ?? feed[0];

  if (step === 2 || !selected) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 py-10 md:max-w-4xl">
        <button
          type="button"
          onClick={() => setStep(1)}
          className="pressable self-start text-sm text-text-muted hover:text-text-strong"
        >
          ← {t("back")}
        </button>

        <p className="overline mt-6 text-text-muted">
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

        {/* «Зоны этой комнаты · Украшения · Парфюм … +5» (доска В3, турн 14a).
            Появляется у ВЫБРАННОЙ комнаты: список под каждой из десяти плиток
            превратил бы сетку в простыню, а вопрос «что там внутри» возникает
            ровно про ту, на которую человек уже нажал. */}
        {selected && selected.zoneLabels.length > 0 && (
          <div className="mt-4">
            <p className="overline text-text-faint">{t("zonesTitle")}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-body">
              {selected.zoneLabels.slice(0, ZONES_SHOWN).join(" · ")}
              {selected.zoneLabels.length > ZONES_SHOWN && (
                <span className="text-text-faint">
                  {" "}
                  +{selected.zoneLabels.length - ZONES_SHOWN}
                </span>
              )}
            </p>
          </div>
        )}

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

  // ---- Шаг 3: «что чаще всего хочется» (тикет 113, доска 34b) ----
  //
  // Единственный шаг, который НИЧЕГО не решает про комнату: полки уже
  // выбраны шагом 2 и от этого ответа не переставляются и не выключаются.
  // Он красит подборку «начни с готового» и порядок зон в добавлении — то
  // есть первые минуты после онбординга, а не саму комнату.
  if (step === 3) {
    const chips = selected.zoneKeys
      .map((key, index) => ({ key, label: selected.zoneLabels[index] ?? key }))
      .filter((zone) => !WANTS_EXCLUDED.has(zone.key));
    const full = wants.length >= WANTS_MAX;

    const toggle = (key: string) =>
      setWants((current) =>
        current.includes(key)
          ? current.filter((candidate) => candidate !== key)
          : current.length >= WANTS_MAX
            ? current
            : [...current, key],
      );

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10 md:max-w-4xl">
        <button
          type="button"
          onClick={() => setStep(2)}
          className="pressable self-start text-sm text-text-muted hover:text-text-strong"
        >
          ← {t("back")}
        </button>

        <p className="overline mt-6 text-text-muted">
          {t("stepOverline", { current: 3, total: TOTAL_STEPS })} · {t("wantsStep")}
        </p>
        <h1 className="display mt-4 text-3xl md:text-5xl">{t("wantsTitle")}</h1>
        <p className="mt-4 max-w-md text-text-body">{t("wantsSubtitle")}</p>

        <div className="mt-7 flex flex-wrap gap-2">
          {chips.map((zone) => {
            const picked = wants.includes(zone.key);
            return (
              <button
                key={zone.key}
                type="button"
                aria-pressed={picked}
                // Четвёртый выбор гасит остальные чипы (wantsMax): предел
                // виден, а не встречается отказом на нажатие.
                disabled={!picked && full}
                onClick={() => toggle(zone.key)}
                className={`pressable min-h-11 px-3.5 text-[13px] font-semibold disabled:opacity-40 ${
                  picked ? "" : "border border-surface-hairline bg-surface-fill text-text-muted"
                }`}
                style={picked ? { background: selected.accent, color: selected.ink } : undefined}
              >
                {zone.label}
              </button>
            );
          })}
        </div>

        {full && <p className="mt-3 text-xs text-text-faint">{t("wantsMax")}</p>}

        <div className="sticky bottom-0 -mx-6 mt-8 bg-surface-app-ground px-6 pb-8 pt-4">
          <button
            type="button"
            onClick={() => setStep(4)}
            className={LIGHT_BUTTON_CLASS}
            style={lightButtonStyle(selected.accent)}
          >
            {t("next")} →
          </button>
          {/* «Я сам, с нуля» отдельной веткой не заводится (доска 34b): это
              та же кнопка пропуска на этом же шаге. Пропустил — подборка
              остаётся общей по интерьеру, и вопрос больше не возвращается. */}
          <button
            type="button"
            onClick={() => {
              setWants([]);
              setStep(4);
            }}
            className="pressable mt-3 block w-full py-2 text-center text-[13px] text-text-muted hover:text-text-strong"
          >
            {t("wantsSkip")}
          </button>
        </div>
      </main>
    );
  }

  const dateMissing = occasionDate === "";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10 md:max-w-4xl">
      <button
        type="button"
        onClick={() => setStep(3)}
        className="pressable self-start text-sm text-text-muted hover:text-text-strong"
      >
        ← {t("back")}
      </button>

      <p className="overline mt-6 text-text-muted">
        {t("stepOverline", { current: 4, total: TOTAL_STEPS })} · {t("occasionStep")}
      </p>
      <h1 className="display mt-4 text-3xl md:text-5xl">{t("occasionTitle")}</h1>
      <p className="mt-4 max-w-md text-text-body">{t("occasionSubtitle")}</p>

      <form action={createRoomAction} className="mt-8 flex w-full max-w-md flex-col gap-4">
        <input type="hidden" name="zoneSet" value={zoneSet} />
        <input type="hidden" name="preset" value={selected.id} />
        {/* Ответ «что хочется» (тикет 113) едет вместе с комнатой: он её не
            меняет, но красит подборку и порядок зон в добавлении. */}
        <input type="hidden" name="wants" value={wants.join(",")} />

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

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-text-muted">{t("occasionLabel")}</span>
          <input
            type="date"
            name="occasionDate"
            value={occasionDate}
            onChange={(event) => setOccasionDate(event.target.value)}
            className="border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint"
          />
        </label>

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
    </main>
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
