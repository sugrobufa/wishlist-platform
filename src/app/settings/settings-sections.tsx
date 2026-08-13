"use client";

// Секции настроек (тикет 13). Каждая секция — маленькая карточка со своим
// состоянием: зовёт server action, показывает отказ строкой ns Settings и
// после успеха дотягивает свежие данные router.refresh() (страница
// force-dynamic — сервер отдаёт правду, клиент ничего не выдумывает).
import { useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BirthdayPicker } from "@/components/birthday-picker";
import { IconCheck } from "@/components/icons";
import { gradingFilter, LIGHT_COLORS, TIMES_OF_DAY } from "@/components/scene/grading";
import { OWN_TITLE_MAX } from "@/server/holidays";
import { addOwnOccasionAction, removeOccasionAction } from "@/app/room/occasion-actions";
import { useRoomStudio } from "./room-studio";
import studio from "./room-studio.module.css";
import {
  changePresetAction,
  presignAvatarAction,
  saveAvatarAction,
  setHallSettingsAction,
  setLightSettingsAction,
  setBirthdayAction,
  setNickAction,
  setZoneSetAction,
  toggleZoneAction,
  updateDisplayNameAction,
  type SettingsError,
  type SettingsResult,
} from "./actions";
import { deleteAccountAction, type DeleteAccountError } from "./account-actions";

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

/**
 * Карточка секции — общий каркас.
 *
 * `id` заводит ЯКОРЬ: `/settings#about` приводит прямо к карточке «О себе»
 * (тикет 226) — фотография в шапке комнаты ведёт к самой фотографии, а не на
 * длинную страницу настроек. `scroll-mt` не даёт карточке прилипнуть к самой
 * кромке окна; без якоря класс ничего не делает.
 */
function Section({
  id,
  overline,
  children,
}: {
  id?: string;
  overline: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex scroll-mt-6 flex-col gap-3 border border-surface-hairline bg-surface-fill p-5"
    >
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
    // ЯКОРЬ «О СЕБЕ» (тикет 226): сюда приводит нажатие на фотографию в шапке
    // комнаты — `/settings#about`. Имя якоря живёт в двух файлах и сверяется
    // тестом (tests/owner-face.test.ts): ссылка в никуда молча прокручивает
    // страницу к началу, и заметить это можно только глазами.
    <Section id="about" overline={t("profileOverline")}>
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

/**
 * ЛЕНТА ВЫБИРАЕТ КАДР, А КОМНАТУ МЕНЯЕТ ТОЛЬКО «ПЕРЕЕХАТЬ» (тикет 181).
 *
 * Тап по плитке зовёт `select` — это состояние кадра и ничего больше. Смена
 * интерьера двигает вещи между полками («где полки совпадут — останутся,
 * остальные переедут в „Что угодно"»), и делать это по тапу нельзя: комнату
 * пишет ровно один вызов `changePresetAction` в `apply()` ниже.
 */
export function PresetSection({
  zoneSet,
  accent,
}: {
  zoneSet: ZoneSet;
  accent: string;
}) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const { busy, error, run } = useSettingsAction();
  const { cards, currentPreset, shown, pending, select, timeOfDay, lightColor } = useRoomStudio();
  const [moved, setMoved] = useState<number | null>(null);
  const [zoneSetBusy, setZoneSetBusy] = useState(false);
  const [, startTransition] = useTransition();

  const feed = zoneSet === "ALL" ? cards : cards.filter((preset) => preset.sex === zoneSet);
  // «ПЕРЕЕХАТЬ» ПРЕДЛАГАЕТСЯ ПО КАДРУ, А НЕ ПО ЛЕНТЕ. Раньше кнопка искала
  // выбранное в ОТФИЛЬТРОВАННОЙ ленте и пропадала, стоило переключить
  // заготовку полок: выбранный интерьер уходил из ленты, кадр продолжал его
  // показывать, а применить его становилось нечем. Оба числа берутся теперь из
  // одного места — из кадра.
  const selectedCard = shown;
  const dirty = pending;

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

      {/* Лента пресетов — плитки как в онбординге (кадр, градиент, галка).
          Стоит ПОД крупным кадром: тап меняет его, а не комнату. */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        {feed.map((preset) => {
          const active = preset.id === shown?.id;
          const isCurrent = preset.id === currentPreset;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => select(preset.id)}
              className="pressable relative aspect-[186/112] overflow-hidden text-left"
              style={active ? { boxShadow: `0 0 0 2px ${preset.accent}` } : undefined}
            >
              {/* ПЛИТКА ПОКАЗАНА В ТВОЁМ СВЕТЕ (пакет 43, `litByYourLight`).
                  В комнате свет один, и лента не должна врать, что он разный:
                  до этого плитки стояли «как сняты», а кадр над ними — в
                  выбранном свете, и одна и та же комната выглядела в двух
                  местах по-разному. Только фильтр, без слоёв: плитка мелкая, а
                  девять узлов на каждую из десяти дороже пользы. */}
              <span
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${preset.imageUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "42% 42%",
                  filter: gradingFilter(timeOfDay, lightColor, preset.tod),
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

      {/* ПРИМЕРКА — СОСТОЯНИЕ, НАЗВАННОЕ СЛОВОМ КОМНАТЫ (тикет 185, пакет 43).
          Оно у нас было и раньше, но звалось подписью под кадром и выхода не
          имело: прекратить примерку можно было только найдя в ленте прежний
          интерьер и нажав его.
          СОВРАТЬ ЗДЕСЬ ЛЕГКО И ДОРОГО — смена интерьера двигает вещи между
          полками, и человек, решивший, что она уже случилась, не поймёт потом,
          куда они делись. Поэтому цена переезда стоит ВНУТРИ примерки, до
          нажатия, а не подписью после неё. */}
      {dirty && selectedCard ? (
        <div className={studio.tryOn} style={{ "--preview-accent": selectedCard.accent } as CSSProperties}>
          <p className={studio.tryOnTitle}>
            <span aria-hidden className={studio.tryOnDot} />
            {t("tryOn")}
          </p>
          <p className={studio.tryOnLine}>
            {t("tryOnLine", { name: selectedCard.name })} {t("presetHint")}
          </p>
          <div className={studio.tryOnActions}>
            <LightButton accent={selectedCard.accent} busy={busy} onClick={apply}>
              {busy ? t("presetApplying") : `${t("presetApply")} →`}
            </LightButton>
            {/* Выход без переезда: примерка кончается равенством, и вернуть
                это равенство можно чисто на клиенте — ни одного серверного
                действия «отменить» тут нет и не нужно. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => select(currentPreset)}
              className={`pressable ${studio.tryOnCancel}`}
            >
              {t("tryOnCancel")}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-faint">{t("presetHint")}</p>
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

/**
 * ЗАПАСНАЯ ЛЕСТНИЦА В «КОМНАТУ СПИСКОМ» (долг тикета 129, закрыт 10.08).
 *
 * Тикет 129 перенёс знак «Списком» из угла сцены в полосу под кадром: он
 * переключает содержимое ТОЙ ЖЕ полосы, и кадр с экрана не уходит. Отдельная
 * страница `/room/list` при этом осталась жива, а вести на неё стало нечему —
 * ссылок на неё не осталось нигде.
 *
 * ПОЧЕМУ СТРАНИЦУ НЕ СНЯЛИ, А ВЕРНУЛИ ЕЙ ДОРОГУ. Полоса и страница показывают
 * одно содержимое, но полоса — это окно в него, а не весь он:
 * - ЗАМЕР НА ДЕСКТОПЕ 1440: полоса ровно 116 px, окно списка в ней — 64 px
 *   (`.listPane { max-height: calc(var(--imm-rail-bottom) - 52px) }`), а
 *   самого списка 3809 px. Больше полосе взять неоткуда: её высота входит в
 *   расчёт раскладки сцены (immersive-layout.ts), и расти вверх, наезжая на
 *   кадр, список не имеет права. Тридцать вещей в окне 64 px не читаются;
 * - ПОЛОЖЕНИЕ ПЕРЕКЛЮЧАТЕЛЯ — ВЗГЛЯД, А НЕ АДРЕС (условие того же тикета 129):
 *   оно живёт в состоянии на сессию и никуда не пишется. Значит переслать
 *   «вот мой список» полосой нельзя, а страницей — можно;
 * - ПОЛОСА КЛИЕНТСКАЯ: до гидратации и без JS списка в разметке нет вовсе
 *   (`showList` стартует с `false`). Страница серверная и отдаёт список сразу.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ НА ЭКРАНЕ КОМНАТЫ. Знак в углу сцены владелец снял
 * дважды и оба раза снимком — возвращать его нельзя. Дорога с ДРУГОГО экрана
 * решению не противоречит: ровно этой формулой дизайн согласился убрать
 * «Сокровищницу» из таб-бара (турн 36c) — «не вторая дверь на том же экране,
 * а запасная лестница с другого». Образец — `HallSection` ниже.
 *
 * ПОЧЕМУ В СЕКЦИИ ПОЛОК, А НЕ ПЕРВОЙ СТРОКОЙ, КАК У ВИТРИНЫ. У витрины секция
 * и есть её настройки, и ссылка открывает то, что человек только что менял.
 * Здесь секция про полки, а ссылка — про вещи НА них: она встаёт после
 * перечня со счётчиками, как ответ на «а посмотреть их все разом?».
 *
 * Своих слов ссылка не заводит: оба берутся из словаря самого экрана списка.
 */
export function ZonesSection({
  zones,
  zonesOff,
  accent,
}: {
  /** Зоны текущего пресета со счётчиком своих вещей (доска В2). */
  zones: Array<{ key: string; label: string; count: number }>;
  zonesOff: string[];
  accent: string;
}) {
  const t = useTranslations("Settings");
  // Слова берутся из словаря самого экрана списка — своих строк ссылка не
  // заводит (тот же приём, что у ссылки в сокровищницу).
  const tList = useTranslations("RoomList");
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
              {pending ? (
                "…"
              ) : (
                <span className="min-w-0">
                  <span className="block truncate">{zone.label}</span>
                  {/* «· 31» под подписью, а не строкой рядом: плитка узкая
                      (две колонки на телефоне), и число, приписанное сбоку,
                      обрезало бы длинные ярлыки вроде «Красота и уход». */}
                  {zone.count > 0 && (
                    <span className="mt-0.5 block text-[10.5px] font-medium text-text-faint">
                      {t("zoneItemCount", { count: zone.count })}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-text-faint">{t("zonesHint")}</p>
      {/* Запасная лестница в «комнату списком» — разбор в шапке компонента. */}
      <Link
        href="/room/list"
        className="pressable self-start text-sm font-semibold"
        style={{ color: accent }}
      >
        {tList("toList")} →
      </Link>
      <p className="text-xs text-text-faint">{tList("subtitle")}</p>
      {failed && <p className="text-sm text-text-muted">{t("errGeneric")}</p>}
    </Section>
  );
}

// ---------- День рождения ----------

/**
 * День рождения хозяйки (тикет 187). Раздел звался «Праздник» и спрашивал
 * безымянную «Дату» одним полем с годом; теперь это день и месяц двумя
 * списками — та же дата, что на третьем шаге онбординга, и тем же компонентом.
 *
 * ГОД НЕ ПОКАЗЫВАЕТСЯ И НЕ СПРАШИВАЕТСЯ. У комнат, чья дата приехала
 * миграцией, он лежит в строке, но живёт ровно с той датой, с которой пришёл:
 * человек назвал новый день — записываются ровно названные день и месяц, а
 * год уходит вместе со старой датой. Стеречь невидимое поле, чтобы потом
 * приписать чужой год новому дню, хуже, чем не хранить его вовсе: продукт им
 * не пользуется нигде.
 */
export function BirthdaySection({
  birthday,
  occasions,
  accent,
}: {
  /** День и месяц из комнаты; null — «Пока не знаю» (законный ответ). */
  birthday: { day: number; month: number } | null;
  /**
   * Остальные праздники комнаты (тикет 198): принятые общие даты и свои поводы.
   * В комнате виден только ближайший — список живёт здесь и больше нигде.
   */
  occasions: OccasionRow[];
  accent: string;
}) {
  const t = useTranslations("Settings");
  const tOccasion = useTranslations("Occasion");
  const { busy, error, saved, run } = useSettingsAction();
  const [value, setValue] = useState<{ day: number | null; month: number | null }>(
    birthday ?? { day: null, month: null },
  );

  return (
    <Section overline={t("occasionOverline")}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-text-muted">{t("occasionLabel")}</span>
        <BirthdayPicker day={value.day} month={value.month} onChange={setValue} />
      </div>
      {/* «ПОВТОРЯЕТСЯ КАЖДЫЙ ГОД» — ФАКТ, А НЕ ГАЛОЧКА (тикет 198,
          `occasions.json → onboarding`): галочка предлагала бы выбор, которого
          нет — день рождения повторяется независимо от продукта. */}
      <p className="text-xs text-text-faint">{tOccasion("birthdayRepeat")}</p>
      <p className="text-xs text-text-faint">{t("occasionHint")}</p>
      <div className="flex items-center gap-4">
        <LightButton
          accent={accent}
          busy={busy}
          onClick={() => {
            // Половина даты — не дата: сохранять нечего, пока не назван и
            // день, и месяц.
            if (value.day === null || value.month === null) return;
            run(() => setBirthdayAction({ day: value.day, month: value.month }));
          }}
        >
          {busy ? t("saving") : saved ? t("saved") : t("save")}
        </LightButton>
        {birthday && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setValue({ day: null, month: null });
              run(() => setBirthdayAction(null));
            }}
            className="pressable text-sm font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
          >
            {t("occasionClear")}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-text-muted">{t(errorKey(error))}</p>}

      <OccasionList occasions={occasions} accent={accent} />
    </Section>
  );
}

// ---------- Праздники: принятые общие даты и свои поводы (тикет 198) ----------

/** Строка праздника в списке настроек. */
export type OccasionRow = {
  id: string;
  /** Готовое имя: общей дате его дал словарь, своему поводу — сама хозяйка. */
  label: string;
  /** «14 сентября» — календарь платформы, а не наши слова. */
  date: string;
};

/**
 * СПИСОК ПРАЗДНИКОВ И «ДОБАВИТЬ СВОЙ ПОВОД» (тикет 198, пакет 44).
 *
 * ЗДЕСЬ ЖИВУТ ВСЕ, В КОМНАТЕ ВИДЕН ОДИН. «Список из пяти праздников в комнате —
 * та же анкета, только показанная вместо спрошенной» (`occasions.json →
 * inRoom.why`), поэтому комната показывает ближайший, а перечень — этот экран.
 *
 * СВОЙ ПОВОД ЗАВОДИТСЯ СТРОКОЙ, А НЕ ПРЕДЛАГАЕТСЯ. Продукт не предлагает своих
 * поводов НИКОГДА — ни плашкой, ни списком примеров в самом поле: про годовщину
 * знает только хозяйка. Подсказка с примерами стоит РЯДОМ со строкой, объясняя,
 * что это за дверь, и в поле не залезает (граница тикета).
 */
function OccasionList({ occasions, accent }: { occasions: OccasionRow[]; accent: string }) {
  const t = useTranslations("Occasion");
  const tSettings = useTranslations("Settings");
  const { busy, error, run } = useSettingsAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<{ day: number | null; month: number | null }>({
    day: null,
    month: null,
  });

  return (
    <div className="flex flex-col gap-3 border-t border-surface-hairline pt-4">
      <p className="overline text-text-muted">{t("listOverline")}</p>

      {occasions.map((occasion) => (
        <div key={occasion.id} className="flex items-center justify-between gap-4">
          <span className="text-sm text-text-primary">
            {t("nearestLine", { holiday: occasion.label, date: occasion.date })}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => removeOccasionAction(occasion.id))}
            className="pressable text-sm font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
          >
            {t("removeOwn")}
          </button>
        </div>
      ))}

      {open ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-text-muted">{t("ownTitleLabel")}</span>
            <input
              value={title}
              maxLength={OWN_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              className="border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint"
            />
          </label>
          <BirthdayPicker day={date.day} month={date.month} onChange={setDate} />
          <LightButton
            accent={accent}
            busy={busy}
            onClick={() => {
              const { day, month } = date;
              const name = title.trim();
              // Половина повода — не повод: ни имени без даты, ни даты без
              // имени. То же правило, что у дня рождения соседней кнопкой.
              if (name === "" || day === null || month === null) return;
              run(
                () => addOwnOccasionAction({ title: name, day, month }),
                () => {
                  setTitle("");
                  setDate({ day: null, month: null });
                  setOpen(false);
                },
              );
            }}
          >
            {busy ? tSettings("saving") : tSettings("save")}
          </LightButton>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pressable self-start text-sm font-semibold"
          style={{ color: accent }}
        >
          {t("addOwn")} →
        </button>
      )}
      <p className="text-xs text-text-faint">{t("ownHint")}</p>
      {error && <p className="text-sm text-text-muted">{tSettings(errorKey(error))}</p>}
    </div>
  );
}

// ---------- Сокровищница: кто видит (тикет 116) и стоимость (тикет 35) ----------

/**
 * ТРИ положения «кто видит сокровищницу» (тикет 116, ADR-0011) — порядок
 * ADR, сверху вниз, от открытого к закрытому. Не четыре, как у цены под
 * ними: у ЭКРАНА «только мне» и «никому» — одна и та же дверь, и человек не
 * отличил бы результат.
 */
const HALL_WHO = ["ALL", "MUTUAL", "NONE"] as const;
export type HallWho = (typeof HALL_WHO)[number];

/**
 * Четыре положения видимости ЦЕНЫ в сокровищнице (тикет 35, ADR-0004).
 *
 * НАСТРОЙКИ НА ЭКРАНЕ БОЛЬШЕ НЕТ (тикет 124). Она отвечала на вопрос «кто,
 * кроме меня, видит цену на витрине», а у этого вопроса теперь один ответ и
 * он не зависит ни от чего: цену вещи сокровищницы не видит НИ ОДИН гость
 * (инвариант №8 в новой редакции, dto/hall.guestSeesHallPrice). Ручка,
 * которая ничем не управляет, — хуже отсутствующей: она обещает выбор.
 *
 * Тип и колонка остаются: колонку сносить решением экрана нельзя (это
 * миграция и отдельный заход), а значение продолжает ездить в сохранение
 * как есть — чтобы правка соседних тумблеров его не обнуляла.
 */
export type HallPriceVisibility = "ALL" | "FRIENDS" | "ME" | "NONE";

export type HallSettingsView = {
  /** Кто входит в саму витрину (тикет 116). */
  visibility: HallWho;
  /**
   * Кто видит там цену. На экране не показывается и не меняется (см. выше) —
   * поле живёт ради того, чтобы сохранение не затирало колонку.
   */
  priceVisibility: HallPriceVisibility;
  /** «18 вещей на 340 000 ₽» в шапке — вид ТОЛЬКО для хозяйки. */
  totalShown: boolean;
  giverShown: boolean;
  /** «около 60 000» вместо 62 000 — тоже только её собственный вид. */
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

/** Один ряд переключателя: кружок и подпись. Вид у обеих настроек зала общий. */
function RadioRow({
  label,
  active,
  accent,
  onPick,
}: {
  label: string;
  active: boolean;
  accent: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
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
          active ? "text-sm font-medium text-text-primary" : "text-sm font-medium text-text-muted"
        }
      >
        {label}
      </span>
    </button>
  );
}

/**
 * Раздел «Сокровищница». ОДНА настройка про доступ и три тумблера про то, как
 * витрина выглядит ЕЙ САМОЙ:
 * - «Кто видит сокровищницу» — три положения, дефолт открытый (тикет 116,
 *   ADR-0011). Единственная настройка раздела, которая касается гостя;
 * - сумма, имя дарителя и округление — её собственный вид, и только он.
 *
 * «ПОКАЗЫВАТЬ СТОИМОСТЬ ВЕЩЕЙ» С ЭКРАНА УБРАНА (тикет 124). Четыре положения
 * отвечали на вопрос «кто, кроме меня, видит цену на витрине», а ответ теперь
 * один и от настройки не зависит: цену вещи сокровищницы не видит ни один
 * гость (инвариант №8). Оставить ручку значило бы обещать выбор, которого
 * нет, — и объяснять потом, почему он ни на что не влияет. Колонку в БД это
 * не трогает: значение по-прежнему уезжает в сохранение как есть.
 *
 * ДВА ОСТАВШИХСЯ ТУМБЛЕРА ЦЕНЫ ЖИВЫ И ПЕРЕФОРМУЛИРОВАНЫ. Сумма витрины и
 * округление больше не про то, «что увидят другие», — их видит только
 * хозяйка. Это по-прежнему её выбор: «на 340 000 ₽» в шапке своей комнаты
 * хочет видеть не каждый, а «около 60 000» рядом с ценой подарка щадит
 * ровно так же, как щадило раньше. Подписи об этом и говорят.
 *
 * Тумблер «Кто подарил» управляет ПОКАЗОМ имени в зале, а не повторным
 * раскрытием: имена раскрываются ровно один раз (инвариант №2).
 *
 * ПЕРВОЙ СТРОКОЙ — САМА ВИТРИНА (тикет 119). Это условие, с которым дизайн
 * согласился убрать «Сокровищницу» из таб-бара: «не вторая дверь на том же
 * экране, а запасная лестница с другого» (турн 36c). Основной вход — знак в
 * углу комнаты; отсюда человек попадает туда, где только что менял её
 * настройки, не возвращаясь в комнату за знаком.
 */
export function HallSection({
  settings,
  accent,
}: {
  settings: HallSettingsView;
  accent: string;
}) {
  const t = useTranslations("Settings");
  // Слово берётся из словаря самой витрины — своей строки ссылка не заводит.
  const tHall = useTranslations("Hall");
  const { busy, error, saved, run } = useSettingsAction();
  const [draft, setDraft] = useState<HallSettingsView>(settings);

  return (
    <Section overline={t("hallOverline")}>
      {/* Запасная лестница в витрину (тикет 119, условие дизайна). */}
      <Link
        href="/room/hall"
        className="pressable self-start text-sm font-semibold"
        style={{ color: accent }}
      >
        {tHall("toHall")} →
      </Link>

      {/* Кто вообще входит в витрину (тикет 116) — над настройками цены. */}
      <p className="text-sm text-text-muted">{t("hallWhoLabel")}</p>
      <div role="radiogroup" aria-label={t("hallWhoLabel")} className="flex flex-col">
        {HALL_WHO.map((option) => (
          <RadioRow
            key={option}
            label={t(`hallWho${option}`)}
            active={draft.visibility === option}
            accent={accent}
            onPick={() => setDraft((current) => ({ ...current, visibility: option }))}
          />
        ))}
      </div>
      {/* Подпись под выбранным положением: три двери похожи на вид и
          расходятся по последствиям — что именно выбрано, лучше сказать
          словами. Тот же приём, что у «только друзьям» ниже. */}
      <p className="text-xs text-text-faint">{t(`hallWhoHint${draft.visibility}`)}</p>

      {/* Переключателя «Показывать стоимость вещей» здесь больше нет —
          разбор в шапке компонента. `draft.priceVisibility` при этом жив и
          уезжает в сохранение нетронутым: сносить колонку экраном нельзя. */}

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

      {/* «У любой вещи можно скрыть цену отдельно» — обещание умерло вместе с
          настройкой, которая его давала (тикет 124): цен на витрине гость не
          видит ни у одной вещи, и прятать их не от кого. */}

      <LightButton accent={accent} busy={busy} onClick={() => run(() => setHallSettingsAction(draft))}>
        {busy ? t("saving") : saved ? t("saved") : t("save")}
      </LightButton>
      {error && <p className="text-sm text-text-muted">{t(errorKey(error))}</p>}
    </Section>
  );
}

// ---------- Свет и время суток (тикет 96, доска Б6 · турн 11e) ----------

/**
 * Именованное положение ручки света (тикет 181).
 *
 * ВЫБРАННОЕ ВИДНО БЕЗ СРАВНЕНИЯ С СОСЕДЯМИ — половина жалобы «непонятно».
 * До тикета единственным отличием был ЦВЕТ СЛОВА: чтобы понять, что выбрано,
 * приходилось прочесть все три подписи и сравнить их между собой. Признака
 * теперь два, и каждого хватает поодиночке: заливка акцентом комнаты и
 * галочка внутри. Цель нажатия — `--hit-target-min` из контракта.
 */
function LightKnob({
  on,
  accent,
  ink,
  busy,
  onClick,
  children,
}: {
  on: boolean;
  accent: string;
  ink: string;
  busy: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={on}
      onClick={onClick}
      className={on ? `pressable ${studio.knob} ${studio.knobOn}` : `pressable ${studio.knob}`}
      style={on ? ({ "--knob-accent": accent, "--knob-ink": ink } as CSSProperties) : undefined}
    >
      {/* Галочка «Дошло» из набора; на малом кегле контур утолщён до 3 —
          оптическая компенсация (см. components/icons.tsx). */}
      {on && <IconCheck size={13} strokeWidth={3} />}
      {children}
    </button>
  );
}

/**
 * Две последние ручки персонализации: «если у всех одинаковая комната,
 * метафора умирает».
 *
 * ПРЕВЬЮ ЗДЕСЬ БОЛЬШЕ НЕ ЖИВЁТ (тикет 181, приёмка владельца 11.08.2026:
 * «выбор света роняет непонятно, просто мигает экран»). Раньше каждое
 * положение было плиткой 110×56 со своей копией комнаты под своим рецептом:
 * плитка была честной — она и есть превью, только размером с ноготь, — и
 * разница между днём и вечером на такой площади читалась не как ВЫБОР, а как
 * мигание. Теперь превью одно и крупное, стоит выше по блоку (`RoomStudio`),
 * и слушается обеих ручек сразу; здесь остались имена положений.
 *
 * Кнопки «Сохранить» здесь нет: ручка меняет комнату на глазах, и
 * подтверждать нечего. Сохраняется по нажатию, гость увидит выбор хозяйки.
 */
export function LightSection({ accent, ink }: { accent: string; ink: string }) {
  const t = useTranslations("Settings");
  const { busy, error, run } = useSettingsAction();
  // Оптимистичность цела: обе ручки живут в состоянии кадра и меняют его в
  // момент нажатия, а не после ответа сервера.
  const { timeOfDay, setTimeOfDay, lightColor, setLightColor } = useRoomStudio();

  return (
    <Section overline={t("lightOverline")}>
      <p className="text-xs leading-relaxed text-text-faint">{t("lightHint")}</p>

      <p className="overline text-text-muted">{t("todLabel")}</p>
      {/* ТРИ ПОЛОЖЕНИЯ, А НЕ ЧЕТЫРЕ (тикет 133): «ночь» упразднена — она давала
          тот же кадр, что вечер, а два одинаковых положения с разными именами
          это ложь интерфейсу. Ряд берёт их из TIMES_OF_DAY, а не из головы. */}
      <div className={studio.knobRow}>
        {TIMES_OF_DAY.map((option) => (
          <LightKnob
            key={option}
            on={timeOfDay === option}
            accent={accent}
            ink={ink}
            busy={busy}
            onClick={() => {
              // Времянки «ночь = свеча» здесь больше нет (тикет 112): тёплый
              // свет ламп теперь ВНУТРИ ночного рецепта, и цвет света снова
              // независимая ручка — выбор хозяйки уважается во всех временах.
              setTimeOfDay(option);
              run(() => setLightSettingsAction({ timeOfDay: option }));
            }}
          >
            {t(`tod_${option}`)}
          </LightKnob>
        ))}
      </div>

      <p className="overline mt-1 text-text-muted">{t("lightColorLabel")}</p>
      <div className={studio.knobRow}>
        {LIGHT_COLORS.map((option) => (
          <LightKnob
            key={option}
            on={lightColor === option}
            accent={accent}
            ink={ink}
            busy={busy}
            onClick={() => {
              setLightColor(option);
              run(() => setLightSettingsAction({ lightColor: option }));
            }}
          >
            {t(`light_${option}`)}
          </LightKnob>
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
