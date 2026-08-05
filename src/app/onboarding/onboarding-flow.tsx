"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { createRoomAction } from "./actions";
import { initialOccasionValue } from "./occasion-date";

export type PresetCard = {
  id: string;
  name: string;
  sex: "F" | "M";
  accent: string;
  ink: string;
  imageUrl: string;
};

type ZoneSet = "F" | "M" | "ALL";

const ZONE_SETS: ZoneSet[] = ["F", "M", "ALL"];

/** Доска (турн 11d) просит три вопроса; счётчик шага говорит то же число. */
const TOTAL_STEPS = 3;

type Step = 1 | 2 | 3;

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
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="mt-0.5 flex-none text-text-faint"
          >
            <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
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
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke={preset.ink}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M4.5 12.5l5 5 10-11" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>

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

  const dateMissing = occasionDate === "";

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
