"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { createRoomAction } from "./actions";

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
 * Онбординг в два шага (тикет 01): «набор зон» (три плитки) → лента пресетов.
 * На втором шаге переключатель набора остаётся над лентой — ответ можно
 * передумать одним касанием (турн 14a).
 */
export function OnboardingFlow({ presets }: { presets: PresetCard[] }) {
  const t = useTranslations("Onboarding");
  const [zoneSet, setZoneSet] = useState<ZoneSet | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);

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
    setPresetId((current) => {
      const visible = filterBySet(presets, set);
      return current && visible.some((preset) => preset.id === current)
        ? current
        : (visible[0]?.id ?? null);
    });
  }

  if (zoneSet === null) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10 md:max-w-4xl">
        <p className="overline text-text-muted">
          {t("stepOverline", { current: 1, total: 2 })} · {t("zoneSetStep")}
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-6 py-10 md:max-w-4xl">
      <button
        type="button"
        onClick={() => setZoneSet(null)}
        className="pressable self-start text-sm text-text-muted hover:text-text-strong"
      >
        ← {t("back")}
      </button>

      <p className="overline mt-6 text-text-muted">
        {t("stepOverline", { current: 2, total: 2 })} · {t("roomStep")}
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
        <form
          action={createRoomAction}
          className="sticky bottom-0 -mx-6 mt-8 bg-surface-app-ground px-6 pb-8 pt-4"
        >
          <input type="hidden" name="zoneSet" value={zoneSet} />
          <input type="hidden" name="preset" value={selected.id} />
          <CreateRoomButton accent={selected.accent} />
        </form>
      )}
    </main>
  );
}

/** Кнопка продолжения — «полоса света» (tokens.json → button.primary, турн 22). */
function CreateRoomButton({ accent }: { accent: string }) {
  const t = useTranslations("Onboarding");
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="pressable w-full border-b-2 px-6 py-4 font-semibold text-text-primary disabled:opacity-60"
      style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${withAlpha(accent, 0.42)}` }}
    >
      {pending ? t("creating") : `${t("create")} →`}
    </button>
  );
}
