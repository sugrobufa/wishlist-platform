"use client";

// Секции настроек (тикет 13). Каждая секция — маленькая карточка со своим
// состоянием: зовёт server action, показывает отказ строкой ns Settings и
// после успеха дотягивает свежие данные router.refresh() (страница
// force-dynamic — сервер отдаёт правду, клиент ничего не выдумывает).
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconCheck } from "@/components/icons";
import {
  gradingFilter,
  LIGHT_COLORS,
  TIMES_OF_DAY,
  type LightColor,
  type TimeOfDay,
} from "@/components/scene/grading";
import {
  changePresetAction,
  presignAvatarAction,
  saveAvatarAction,
  setHallSettingsAction,
  setLightSettingsAction,
  setNickAction,
  setOccasionDateAction,
  setZoneSetAction,
  toggleZoneAction,
  updateDisplayNameAction,
  type SettingsError,
  type SettingsResult,
} from "./actions";
import { deleteAccountAction, type DeleteAccountError } from "./account-actions";

// Форма карточки пресета — как в онбординге (тикет 01); сам компонент
// онбординга не переиспользуем: там полноэкранный флоу со своим сабмитом.
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

const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // зеркало серверного лимита

/** "#RRGGBB" + альфа → 8-значный hex (ореол «полосы света», tokens.json). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** Ключ строки отказа по коду экшена. */
function errorKey(code: SettingsError): string {
  switch (code) {
    case "AUTH":
      return "errAuth";
    case "NICK_TAKEN":
      return "nickTaken";
    case "NICK_RESERVED":
      return "nickReserved";
    case "VALIDATION":
      return "errValidation";
    case "TOO_LARGE":
      return "errAvatarSize";
    case "BAD_TYPE":
      return "errAvatarType";
    default:
      return "errGeneric";
  }
}

/** Карточка секции — общий каркас. */
function Section({ overline, children }: { overline: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border border-surface-hairline bg-surface-fill p-5">
      <p className="overline text-text-muted">{overline}</p>
      {children}
    </section>
  );
}

/** Кнопка «полоса света» (турн 22) в компактном размере настроек. */
function LightButton({
  accent,
  busy,
  onClick,
  children,
}: {
  accent: string;
  busy?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="pressable self-start border-b-2 px-5 py-2.5 text-sm font-semibold text-text-primary disabled:opacity-60"
      style={{ borderColor: accent, boxShadow: `0 4px 18px -3px ${withAlpha(accent, 0.42)}` }}
    >
      {children}
    </button>
  );
}

/** Общий хук секции: занятость, отказ, «Сохранено» и refresh после успеха. */
function useSettingsAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SettingsError | null>(null);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  function run(action: () => Promise<SettingsResult>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await action();
      setBusy(false);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      onDone?.();
      router.refresh();
    });
  }

  return { busy, error, saved, run, setError };
}

// ---------- Профиль: имя и аватар ----------

export function ProfileSection({
  displayName,
  avatarUrl,
  accent,
}: {
  displayName: string | null;
  avatarUrl: string | null;
  accent: string;
}) {
  const t = useTranslations("Settings");
  const { busy, error, saved, run, setError } = useSettingsAction();
  const [name, setName] = useState(displayName ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadAvatar(file: File): Promise<SettingsResult> {
    // Клиентское зеркало серверной валидации: растровые ≤5 МБ, SVG нельзя.
    if (file.size > AVATAR_MAX_BYTES) return { error: "TOO_LARGE" };
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      return { error: "BAD_TYPE" };
    }
    const presigned = await presignAvatarAction({ contentType: file.type, size: file.size });
    if ("error" in presigned) return presigned;
    const put = await fetch(presigned.url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!put.ok) return { error: "GENERIC" };
    return saveAvatarAction(presigned.key);
  }

  function onFileChosen(file: File | null) {
    if (!file) return;
    setUploading(true);
    run(async () => {
      try {
        return await uploadAvatar(file);
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  return (
    <Section overline={t("profileOverline")}>
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className="h-16 w-16 flex-none rounded-full border border-surface-hairline bg-surface-fill-hover"
          style={
            avatarUrl
              ? {
                  backgroundImage: `url(${avatarUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || uploading}
              onClick={() => fileRef.current?.click()}
              className="pressable text-sm font-semibold disabled:opacity-60"
              style={{ color: accent }}
            >
              {uploading ? t("saving") : avatarUrl ? t("avatarChange") : t("avatarAdd")}
            </button>
            {avatarUrl && (
              <button
                type="button"
                disabled={busy || uploading}
                onClick={() => run(() => saveAvatarAction(null))}
                className="pressable text-sm font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
              >
                {t("avatarRemove")}
              </button>
            )}
          </div>
          <p className="text-xs text-text-faint">{t("avatarHint")}</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif"
          className="hidden"
          onChange={(event) => onFileChosen(event.target.files?.[0] ?? null)}
        />
      </div>

      <label className="mt-2 flex flex-col gap-1.5">
        <span className="text-sm text-text-muted">{t("displayNameLabel")}</span>
        <input
          type="text"
          value={name}
          maxLength={80}
          placeholder={t("displayNamePlaceholder")}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          className="border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint"
        />
      </label>
      <LightButton accent={accent} busy={busy || uploading} onClick={() => run(() => updateDisplayNameAction(name))}>
        {busy ? t("saving") : saved ? t("saved") : t("save")}
      </LightButton>
      {error && <p className="text-sm text-text-muted">{t(errorKey(error))}</p>}
    </Section>
  );
}

// ---------- Ник: красивый адрес комнаты ----------

export function NickSection({
  nick,
  shareSlug,
  accent,
}: {
  nick: string | null;
  shareSlug: string;
  accent: string;
}) {
  const t = useTranslations("Settings");
  const { busy, error, saved, run, setError } = useSettingsAction();
  const [value, setValue] = useState(nick ?? "");

  function save() {
    const candidate = value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(candidate)) {
      setError("VALIDATION");
      return;
    }
    run(() => setNickAction(candidate));
  }

  return (
    <Section overline={t("nickOverline")}>
      <p className="font-mono text-lg text-text-primary">/r/{nick ?? shareSlug}</p>
      {nick && <p className="text-xs text-text-faint">{t("nickCodeHint", { code: shareSlug })}</p>}

      <label className="mt-1 flex flex-col gap-1.5">
        <span className="text-sm text-text-muted">{t("nickLabel")}</span>
        <div className="flex items-center gap-0 border border-surface-hairline-strong bg-surface-app-ground focus-within:border-text-faint">
          <span className="pl-3 font-mono text-sm text-text-faint">/r/</span>
          <input
            type="text"
            value={value}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setValue(event.target.value.toLowerCase());
              setError(null);
            }}
            className="w-full bg-transparent px-1.5 py-2.5 font-mono text-sm text-text-primary outline-none"
          />
        </div>
        <span className="text-xs text-text-faint">{t("nickHint")}</span>
      </label>

      <div className="flex items-center gap-4">
        <LightButton accent={accent} busy={busy} onClick={save}>
          {busy ? t("saving") : saved ? t("saved") : t("nickSave")}
        </LightButton>
        {nick && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setValue("");
              run(() => setNickAction(null));
            }}
            className="pressable text-sm font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
          >
            {t("nickRelease")}
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm text-text-muted">
          {t(error === "VALIDATION" ? "nickFormat" : errorKey(error))}
        </p>
      )}
    </Section>
  );
}

// ---------- Интерьер: набор зон + лента пресетов ----------

export function PresetSection({
  presets,
  currentPreset,
  zoneSet,
  accent,
}: {
  presets: PresetCard[];
  currentPreset: string;
  zoneSet: ZoneSet;
  accent: string;
}) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const { busy, error, run } = useSettingsAction();
  const [selected, setSelected] = useState(currentPreset);
  const [moved, setMoved] = useState<number | null>(null);
  const [zoneSetBusy, setZoneSetBusy] = useState(false);
  const [, startTransition] = useTransition();

  const feed = zoneSet === "ALL" ? presets : presets.filter((preset) => preset.sex === zoneSet);
  const selectedCard = feed.find((preset) => preset.id === selected);
  const dirty = selected !== currentPreset && selectedCard != null;

  function pickZoneSet(set: ZoneSet) {
    if (set === zoneSet || zoneSetBusy) return;
    setZoneSetBusy(true);
    startTransition(async () => {
      await setZoneSetAction(set);
      setZoneSetBusy(false);
      router.refresh(); // лента перефильтруется по свежему prop'у
    });
  }

  function apply() {
    if (!selectedCard) return;
    setMoved(null);
    run(async () => {
      const result = await changePresetAction(selectedCard.id);
      if ("error" in result) return result;
      setMoved(result.moved);
      return { ok: true };
    });
  }

  return (
    <Section overline={t("presetOverline")}>
      {/* Переключатель набора зон — как над лентой онбординга (турн 14a). */}
      <div className="flex gap-2">
        {ZONE_SETS.map((set) => {
          const active = set === zoneSet;
          return (
            <button
              key={set}
              type="button"
              aria-pressed={active}
              disabled={zoneSetBusy}
              onClick={() => pickZoneSet(set)}
              className={
                active
                  ? "pressable flex-1 px-3 py-2.5 text-xs font-semibold"
                  : "pressable flex-1 border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-xs font-semibold text-text-muted hover:bg-surface-fill-hover disabled:opacity-60"
              }
              style={active ? { background: accent, color: "#0B0806" } : undefined}
            >
              {t(`setLabel${set}`)}
            </button>
          );
        })}
      </div>

      {/* Лента пресетов — плитки как в онбординге (кадр, градиент, галка). */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        {feed.map((preset) => {
          const active = preset.id === selected;
          const isCurrent = preset.id === currentPreset;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(preset.id)}
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
                {isCurrent && (
                  <span className="ml-1.5 align-middle text-[10px] font-normal text-text-muted">
                    · {t("presetCurrent")}
                  </span>
                )}
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

      <p className="text-xs text-text-faint">{t("presetHint")}</p>

      {dirty && selectedCard && (
        <LightButton accent={selectedCard.accent} busy={busy} onClick={apply}>
          {busy ? t("presetApplying") : `${t("presetApply")}: ${selectedCard.name} →`}
        </LightButton>
      )}
      {moved !== null && (
        <p className="text-sm text-text-muted">
          {moved > 0 ? t("presetMoved", { count: moved }) : t("presetMovedNone")}
        </p>
      )}
      {error && <p className="text-sm text-text-muted">{t(errorKey(error))}</p>}
    </Section>
  );
}

// ---------- Зоны текущего пресета: вкл/выкл ----------

export function ZonesSection({
  zones,
  zonesOff,
  accent,
}: {
  zones: Array<{ key: string; label: string }>;
  zonesOff: string[];
  accent: string;
}) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const off = new Set(zonesOff);

  function toggle(key: string, nextOff: boolean) {
    if (pendingKey) return;
    setPendingKey(key);
    setFailed(false);
    startTransition(async () => {
      const result = await toggleZoneAction(key, nextOff);
      setPendingKey(null);
      if ("error" in result) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Section overline={t("zonesOverline")}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {zones.map((zone) => {
          const isOn = !off.has(zone.key);
          const pending = pendingKey === zone.key;
          return (
            <button
              key={zone.key}
              type="button"
              role="checkbox"
              aria-checked={isOn}
              disabled={pending}
              onClick={() => toggle(zone.key, isOn)}
              className={
                isOn
                  ? "pressable flex items-center gap-2.5 border border-surface-hairline-strong bg-surface-app-ground px-3 py-3 text-left text-sm text-text-primary disabled:opacity-60"
                  : "pressable flex items-center gap-2.5 border border-surface-hairline bg-surface-fill px-3 py-3 text-left text-sm text-text-faint disabled:opacity-60"
              }
            >
              <span
                aria-hidden
                className="flex h-[18px] w-[18px] flex-none items-center justify-center border"
                style={
                  isOn
                    ? { background: accent, borderColor: accent }
                    : { borderColor: "rgba(255,255,255,.2)" }
                }
              >
                {isOn && (
                  // Галочка «Дошло» из набора; на 12 px контур утолщён до 3.2 —
                  // оптическая компенсация (см. components/icons.tsx).
                  <IconCheck size={12} strokeWidth={3.2} style={{ color: "#0B0806" }} />
                )}
              </span>
              {pending ? "…" : zone.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-text-faint">{t("zonesHint")}</p>
      {failed && <p className="text-sm text-text-muted">{t("errGeneric")}</p>}
    </Section>
  );
}

// ---------- Дата праздника ----------

export function OccasionSection({
  occasionDate,
  accent,
}: {
  /** YYYY-MM-DD или null. */
  occasionDate: string | null;
  accent: string;
}) {
  const t = useTranslations("Settings");
  const { busy, error, saved, run } = useSettingsAction();
  const [value, setValue] = useState(occasionDate ?? "");

  return (
    <Section overline={t("occasionOverline")}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-text-muted">{t("occasionLabel")}</span>
        <input
          type="date"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint"
        />
      </label>
      <p className="text-xs text-text-faint">{t("occasionHint")}</p>
      <div className="flex items-center gap-4">
        <LightButton
          accent={accent}
          busy={busy}
          onClick={() => {
            if (!value) return;
            run(() => setOccasionDateAction(value));
          }}
        >
          {busy ? t("saving") : saved ? t("saved") : t("save")}
        </LightButton>
        {occasionDate && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setValue("");
              run(() => setOccasionDateAction(null));
            }}
            className="pressable text-sm font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
          >
            {t("occasionClear")}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-text-muted">{t(errorKey(error))}</p>}
    </Section>
  );
}

// ---------- Зал славы: стоимость подарков (тикет 35, турн 12d) ----------

/** Четыре положения видимости цены в зале — порядок доски, сверху вниз. */
const HALL_VISIBILITIES = ["ALL", "FRIENDS", "ME", "NONE"] as const;
export type HallVisibility = (typeof HALL_VISIBILITIES)[number];

export type HallSettingsView = {
  priceVisibility: HallVisibility;
  totalShown: boolean;
  giverShown: boolean;
  roundPrices: boolean;
};

/** Тумблер доски: подпись, пояснение и переключатель справа. */
function Toggle({
  label,
  hint,
  on,
  accent,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  accent: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="pressable flex w-full items-center gap-3 border-t border-surface-hairline py-4 text-left first:border-t-0"
    >
      <span className="flex-1">
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        <span className="mt-1.5 block text-xs text-text-faint">{hint}</span>
      </span>
      <span
        aria-hidden
        className="relative h-[22px] w-[38px] flex-none rounded-full"
        style={{ background: on ? accent : "rgba(255,255,255,.12)" }}
      >
        <span
          className="absolute top-[2px] h-[18px] w-[18px] rounded-full"
          style={
            on
              ? { right: 2, background: "#241A0E" }
              : { left: 2, background: "rgba(255,249,242,.4)" }
          }
        />
      </span>
    </button>
  );
}

/**
 * Раздел «Зал славы»: кто видит стоимость подарков (четыре положения, а не
 * тумблер — «стоимость это чувствительно»), сумма всего зала отдельным
 * тумблером, имя дарителя и округление. Сохраняется целиком, как на доске.
 *
 * Тумблер «Кто подарил» управляет ПОКАЗОМ имени в зале, а не повторным
 * раскрытием: имена раскрываются ровно один раз (инвариант №2).
 */
export function HallSection({
  settings,
  accent,
}: {
  settings: HallSettingsView;
  accent: string;
}) {
  const t = useTranslations("Settings");
  const { busy, error, saved, run } = useSettingsAction();
  const [draft, setDraft] = useState<HallSettingsView>(settings);

  return (
    <Section overline={t("hallOverline")}>
      <p className="text-sm text-text-muted">{t("hallPriceLabel")}</p>
      <div role="radiogroup" aria-label={t("hallPriceLabel")} className="flex flex-col">
        {HALL_VISIBILITIES.map((option) => {
          const active = draft.priceVisibility === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setDraft((current) => ({ ...current, priceVisibility: option }))}
              className="pressable flex items-center gap-3 border-t border-surface-hairline py-3.5 text-left first:border-t-0"
            >
              <span
                aria-hidden
                className="h-[17px] w-[17px] flex-none rounded-full border"
                style={
                  active
                    ? { borderColor: accent, borderWidth: 5 }
                    : { borderColor: "rgba(255,249,242,.28)", borderWidth: 1.5 }
                }
              />
              <span
                className={
                  active
                    ? "text-sm font-medium text-text-primary"
                    : "text-sm font-medium text-text-muted"
                }
              >
                {t(`hallVis${option}`)}
              </span>
            </button>
          );
        })}
      </div>
      {draft.priceVisibility === "FRIENDS" && (
        <p className="text-xs text-text-faint">{t("hallFriendsHint")}</p>
      )}

      <div className="mt-1 flex flex-col border-t border-surface-hairline pt-1">
        <Toggle
          label={t("hallTotalLabel")}
          hint={t("hallTotalHint")}
          on={draft.totalShown}
          accent={accent}
          onToggle={() => setDraft((current) => ({ ...current, totalShown: !current.totalShown }))}
        />
        <Toggle
          label={t("hallGiverLabel")}
          hint={t("hallGiverHint")}
          on={draft.giverShown}
          accent={accent}
          onToggle={() => setDraft((current) => ({ ...current, giverShown: !current.giverShown }))}
        />
        <Toggle
          label={t("hallRoundLabel")}
          hint={t("hallRoundHint")}
          on={draft.roundPrices}
          accent={accent}
          onToggle={() =>
            setDraft((current) => ({ ...current, roundPrices: !current.roundPrices }))
          }
        />
      </div>

      <p className="text-xs leading-relaxed text-text-faint">{t("hallItemHint")}</p>

      <LightButton accent={accent} busy={busy} onClick={() => run(() => setHallSettingsAction(draft))}>
        {busy ? t("saving") : saved ? t("saved") : t("save")}
      </LightButton>
      {error && <p className="text-sm text-text-muted">{t(errorKey(error))}</p>}
    </Section>
  );
}

// ---------- Свет и время суток (тикет 96, доска Б6 · турн 11e) ----------

/**
 * Две последние ручки персонализации: «если у всех одинаковая комната,
 * метафора умирает». Плитка каждого положения показывает СВОЮ комнату с
 * применённым рецептом — выбирают не по названию, а по картинке.
 *
 * Кнопки «Сохранить» здесь нет: ручка меняет комнату на глазах, и
 * подтверждать нечего. Сохраняется по нажатию, гость увидит выбор хозяйки.
 */
export function LightSection({
  roomImage,
  timeOfDay,
  lightColor,
  accent,
}: {
  roomImage: string;
  timeOfDay: TimeOfDay;
  lightColor: LightColor;
  accent: string;
}) {
  const t = useTranslations("Settings");
  const { busy, error, run } = useSettingsAction();
  // Оптимистично: картинка обязана меняться в момент нажатия, иначе выбор
  // «по картинке» превращается в выбор вслепую с задержкой сервера.
  const [tod, setTod] = useState(timeOfDay);
  const [color, setColor] = useState(lightColor);

  const tile = (previewTod: TimeOfDay, previewColor: LightColor) => ({
    backgroundImage: `url(${roomImage})`,
    filter: gradingFilter(previewTod, previewColor),
  });

  return (
    <Section overline={t("lightOverline")}>
      <p className="text-xs leading-relaxed text-text-faint">{t("lightHint")}</p>

      <p className="overline text-text-muted">{t("todLabel")}</p>
      <div className="grid grid-cols-4 gap-2">
        {TIMES_OF_DAY.map((option) => (
          <button
            key={option}
            type="button"
            disabled={busy}
            aria-pressed={tod === option}
            onClick={() => {
              setTod(option);
              run(() => setLightSettingsAction({ timeOfDay: option }));
            }}
            className="pressable flex flex-col gap-1.5 disabled:opacity-60"
          >
            <span
              className="block h-14 w-full bg-cover bg-center"
              style={tile(option, color)}
              aria-hidden
            />
            <span
              className="text-[10px] font-semibold"
              style={{ color: tod === option ? accent : undefined }}
            >
              {t(`tod_${option}`)}
            </span>
          </button>
        ))}
      </div>

      <p className="overline mt-1 text-text-muted">{t("lightColorLabel")}</p>
      <div className="grid grid-cols-3 gap-2">
        {LIGHT_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            disabled={busy}
            aria-pressed={color === option}
            onClick={() => {
              setColor(option);
              run(() => setLightSettingsAction({ lightColor: option }));
            }}
            className="pressable flex flex-col gap-1.5 disabled:opacity-60"
          >
            <span
              className="block h-14 w-full bg-cover bg-center"
              style={tile(tod, option)}
              aria-hidden
            />
            <span
              className="text-[10px] font-semibold"
              style={{ color: color === option ? accent : undefined }}
            >
              {t(`light_${option}`)}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-text-muted">{t(errorKey(error))}</p>}
    </Section>
  );
}

// ---------- Вход и доступ (тикет 94, доска Б8 · турн 13b) ----------

/**
 * «Способы войти» — честный ответ на вопрос, которого человеку до этого никто
 * не задавал: чем вообще держится его комната. Она держится ОДНОЙ почтой, и
 * доска права — сказать это надо, потому что «уйдёт — теряет комнату,
 * историю подарков и сокровищницу».
 *
 * Раздел только показывает. Привязка живёт там, где она уместна по доске, —
 * в просьбе перед первым шером; отдельной кнопки «привязать» здесь нет, пока
 * второй способ вообще не подключён в сборке.
 */
export function AccessSection({
  email,
  emailConfirmed,
  secondAuth,
}: {
  email: string;
  emailConfirmed: boolean;
  secondAuth: { provider: string } | null;
}) {
  const t = useTranslations("Settings");
  return (
    <Section overline={t("accessOverline")}>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-mono text-text-primary">{email}</span>
          <span className="text-xs text-text-muted">
            {emailConfirmed ? t("accessPrimaryConfirmed") : t("accessPrimaryUnconfirmed")}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-text-muted">{t("accessSecond")}</span>
          <span className="text-xs text-text-muted">
            {secondAuth === null
              ? t("accessSecondNone")
              : t("accessSecondLinked", {
                  provider: secondAuth.provider.charAt(0).toUpperCase() + secondAuth.provider.slice(1),
                })}
          </span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-text-faint">{t("accessHint")}</p>
    </Section>
  );
}

// ---------- Данные: экспорт и удаление аккаунта (тикет 14, GDPR) ----------

// Красный опасной зоны — приглушённый, в тон тёплой палитре: тихий тон
// продукта, без сирен. Токена danger в tokens.json нет — локальная константа.
const DANGER = "#C4584C";

export function DataSection({ deletePhrase, accent }: { deletePhrase: string; accent: string }) {
  const t = useTranslations("DataSection");
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DeleteAccountError | null>(null);
  const [, startTransition] = useTransition();

  // Клиентское зеркало серверной перепроверки: та же нормализация.
  const phraseMatches = phrase.trim().toLowerCase() === deletePhrase;

  function confirmDelete() {
    if (!phraseMatches || busy) return;
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await deleteAccountAction({ confirm: phrase });
      // При успехе экшен делает redirect("/") — сюда не возвращаемся.
      setBusy(false);
      if (result?.error) setError(result.error);
    });
  }

  function closeDangerZone() {
    setOpen(false);
    setPhrase("");
    setError(null);
  }

  return (
    <Section overline={t("overline")}>
      {/* Экспорт: обычная ссылка — файл отдаёт GET /api/v1/me/export. */}
      <p className="text-sm text-text-muted">{t("exportHint")}</p>
      <a
        href="/api/v1/me/export"
        download
        className="pressable self-start text-sm font-semibold"
        style={{ color: accent }}
      >
        {t("exportButton")}
      </a>

      {/* Опасная зона — раскрывашка; тихо, но честно про необратимость. */}
      <div className="mt-2 border-t border-surface-hairline pt-4">
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="pressable text-sm font-semibold text-text-muted hover:text-text-strong"
          >
            {t("deleteOpen")}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-text-muted">{t("deleteWarn")}</p>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-text-muted">
                {t("phraseLabel")}{" "}
                <span className="font-mono text-text-strong">«{deletePhrase}»</span>
              </span>
              <input
                type="text"
                value={phrase}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={deletePhrase}
                onChange={(event) => {
                  setPhrase(event.target.value);
                  setError(null);
                }}
                className="border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint"
              />
            </label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={!phraseMatches || busy}
                onClick={confirmDelete}
                className="pressable self-start border-b-2 px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
                style={{
                  color: DANGER,
                  borderColor: DANGER,
                  boxShadow: phraseMatches ? `0 4px 18px -3px ${withAlpha(DANGER, 0.42)}` : undefined,
                }}
              >
                {busy ? t("deleting") : t("deleteConfirm")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={closeDangerZone}
                className="pressable text-sm font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
              >
                {t("deleteCancel")}
              </button>
            </div>
            {error && (
              <p className="text-sm text-text-muted">
                {t(error === "PHRASE" ? "errPhrase" : error === "AUTH" ? "errAuth" : "errGeneric")}
              </p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------- Демо-призраки ----------
