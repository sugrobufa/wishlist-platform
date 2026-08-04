"use client";

// Флоу добавления вещи (тикет 04, турн 8). Шаг 1 — вопрос «Что это для
// тебя?» ВМЕСТО кнопки «добавить в вишлист» (items.json → whereAsked):
// два тайла цитируют язык комнаты. Шаг 2 — форма по состоянию: у WANT цена
// с валютой и видимостью, размер/цвет/степень желания; у LOVE подпись
// «уже моё» или даритель+год — цены в форме нет вовсе.
// Фото грузится напрямую в MinIO/S3 по pre-signed PUT, в createItem уходит
// только photoKey. Сохранение — «полоса света», после — redirect в зону.
import { useState, type CSSProperties, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { sceneMotion } from "@/config/design";
import { createItemAction, presignItemPhotoAction } from "./actions";
import s from "./add-item.module.css";

export type ZoneOption = { key: string; label: string };

type ItemState = "WANT" | "LOVE";
type PriceVisibility = "ALL" | "FRIENDS" | "ME" | "NONE";
type LoveKind = "mine" | "gift";

// Лимит фото — как в сервисе (ITEM_PHOTO_MAX_BYTES); сервис остаётся
// источником правды, здесь только ранняя проверка до похода на сервер.
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const VISIBILITIES: PriceVisibility[] = ["ALL", "FRIENDS", "ME", "NONE"];
const DESIRE_STEPS = [1, 2, 3, 4] as const;
// Малый набор формы; сервис принимает любой код ISO 4217 (₽ — по умолчанию).
const CURRENCIES = [
  { code: "RUB", label: "₽ RUB" },
  { code: "USD", label: "$ USD" },
  { code: "EUR", label: "€ EUR" },
] as const;

/** "#RRGGBB" + альфа → 8-значный hex (ореолы «полосы света», tokens.json). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** Акцент темнее на долю shade — active-состояние кнопки ({accent shade -20%}). */
function shadeHex(hex: string, shade: number): string {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n) || hex.length !== 7) return hex;
  const channel = (offset: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> offset) & 0xff) * (1 - shade))))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

type AddItemFlowProps = {
  /** Видимые зоны комнаты с подписями zoneInfo (считает страница). */
  zones: ZoneOption[];
  /** Предвыбор из ?zone=… (уже провалидирован страницей). */
  initialZone: string;
  /** Акцент/ink комнаты из rooms.json. */
  accent: string;
  ink: string;
};

export function AddItemFlow({ zones, initialZone, accent, ink }: AddItemFlowProps) {
  const t = useTranslations("AddItem");

  const [state, setState] = useState<ItemState | null>(null);

  // Общие поля обеих форм.
  const [title, setTitle] = useState("");
  const [zone, setZone] = useState(initialZone);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // WANT.
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<string>("RUB");
  const [priceVisibility, setPriceVisibility] = useState<PriceVisibility>("ALL");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [desire, setDesire] = useState<number | null>(null);

  // LOVE.
  const [loveKind, setLoveKind] = useState<LoveKind>("mine");
  const [giverName, setGiverName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Акцент комнаты и его производные — CSS-переменными в модульные стили.
  const style = {
    "--ai-accent": accent,
    "--ai-ink": ink,
    "--ai-accent-active": shadeHex(accent, 0.2),
    "--ai-glow-25": withAlpha(accent, 0.25),
    "--ai-glow-42": withAlpha(accent, 0.42),
    "--ai-glow-55": withAlpha(accent, 0.55),
    "--ai-glow-80": withAlpha(accent, 0.8),
    "--ai-glow-85": withAlpha(accent, 0.85),
    "--ai-ease": sceneMotion.easingOut,
  } as CSSProperties;

  function pickState(next: ItemState) {
    setState(next);
    setErrorKey(null);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    // Сброс value: повторный выбор того же файла снова вызовет onChange.
    event.target.value = "";
    if (!picked) return;
    if (!picked.type.startsWith("image/")) {
      setErrorKey("errBadType");
      return;
    }
    if (picked.size > PHOTO_MAX_BYTES) {
      setErrorKey("errTooLarge");
      return;
    }
    setErrorKey(null);
    setFile(picked);
    setPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(picked);
    });
  }

  function removePhoto() {
    setFile(null);
    setPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }

  function buildInput(photoKey: string | undefined) {
    const common = {
      zone,
      title: title.trim(),
      note: note.trim() || undefined,
      url: url.trim() || undefined,
      photoKey,
    };
    if (state === "WANT") {
      return {
        state: "WANT" as const,
        ...common,
        price: price.trim(),
        currency,
        priceVisibility,
        size: size.trim() || undefined,
        color: color.trim() || undefined,
        desire: desire ?? undefined,
      };
    }
    return {
      state: "LOVE" as const,
      ...common,
      ...(loveKind === "gift"
        ? {
            giverName: giverName.trim() || undefined,
            receivedYear: year.trim() === "" ? undefined : Number(year),
          }
        : {}),
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrorKey(null);
    try {
      let photoKey: string | undefined;
      if (file) {
        const presigned = await presignItemPhotoAction({
          contentType: file.type,
          size: file.size,
        });
        if ("error" in presigned) {
          setErrorKey(errorToKey(presigned.error));
          return;
        }
        const put = await fetch(presigned.url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!put.ok) {
          setErrorKey("errUpload");
          return;
        }
        photoKey = presigned.key;
      }

      // Успех не возвращается — экшен уводит redirect'ом в /room/zone/{zone}.
      const result = await createItemAction(buildInput(photoKey));
      if (result && "error" in result) setErrorKey(errorToKey(result.error));
    } catch {
      setErrorKey("errGeneric");
    } finally {
      setSaving(false);
    }
  }

  // ---------- Шаг 1: «Что это для тебя?» ----------

  if (state === null) {
    return (
      <main className={`${s.root} mx-auto min-h-screen w-full max-w-xl px-6 py-10`} style={style}>
        <p className="overline text-text-muted">{t("overline")}</p>
        <h1 className="display mt-3 text-3xl md:text-4xl">{t("question")}</h1>

        <div className={s.tileGrid}>
          <button type="button" className={`pressable ${s.tile}`} onClick={() => pickState("LOVE")}>
            <span className={s.tileArt} aria-hidden>
              <span className={s.loveObject} />
              <span className={s.loveShelf} />
            </span>
            <span className={s.tileLabel}>{t("loveLabel")}</span>
            <span className={s.tileHint}>{t("loveHint")}</span>
          </button>

          <button type="button" className={`pressable ${s.tile}`} onClick={() => pickState("WANT")}>
            <span className={s.tileArt} aria-hidden>
              <span className={s.wantObject} />
              <span className={s.wantShelf} />
            </span>
            <span className={s.tileLabel}>{t("wantLabel")}</span>
            <span className={s.tileHint}>{t("wantHint")}</span>
          </button>
        </div>
      </main>
    );
  }

  // ---------- Шаг 2: форма состояния ----------

  return (
    <main className={`${s.root} mx-auto min-h-screen w-full max-w-xl px-6 py-10`} style={style}>
      <button
        type="button"
        onClick={() => setState(null)}
        className="pressable text-sm text-text-muted hover:text-text-strong"
      >
        ← {t("question")}
      </button>

      <p className="overline mt-6 text-text-muted">{t("overline")}</p>
      <h1 className="display mt-3 text-3xl md:text-4xl">
        {state === "WANT" ? t("wantLabel") : t("loveLabel")}
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        {state === "WANT" ? t("wantHint") : t("loveHint")}
      </p>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-8 flex flex-col gap-5">
        <label>
          <span className={s.fieldLabel}>{t("titleLabel")}</span>
          <input
            className={s.input}
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("titlePlaceholder")}
          />
        </label>

        <label>
          <span className={s.fieldLabel}>{t("zoneLabel")}</span>
          <select
            className={s.input}
            required
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          >
            {zones.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {state === "WANT" && (
          <>
            <div className="grid grid-cols-[1fr_128px] gap-2">
              <label>
                <span className={s.fieldLabel}>{t("priceLabel")}</span>
                <input
                  className={s.input}
                  type="text"
                  required
                  inputMode="decimal"
                  pattern="\d{1,10}([.,]\d{1,2})?"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="14 900"
                />
              </label>
              <label>
                <span className={s.fieldLabel}>{t("currencyLabel")}</span>
                <select
                  className={s.input}
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {CURRENCIES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <span className={s.fieldLabel}>{t("priceVisibilityLabel")}</span>
              <div className={s.segRow} role="radiogroup" aria-label={t("priceVisibilityLabel")}>
                {VISIBILITIES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={priceVisibility === option}
                    className={`pressable ${s.segBtn}${priceVisibility === option ? ` ${s.segActive}` : ""}`}
                    onClick={() => setPriceVisibility(option)}
                  >
                    {t(`vis${option}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className={s.fieldLabel}>{t("sizeLabel")}</span>
                <input
                  className={s.input}
                  type="text"
                  maxLength={80}
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                  placeholder={t("sizePlaceholder")}
                />
              </label>
              <label>
                <span className={s.fieldLabel}>{t("colorLabel")}</span>
                <input
                  className={s.input}
                  type="text"
                  maxLength={80}
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  placeholder={t("colorPlaceholder")}
                />
              </label>
            </div>

            <div>
              <span className={s.fieldLabel}>{t("desireLabel")}</span>
              <div className={s.desireSteps} role="radiogroup" aria-label={t("desireLabel")}>
                {DESIRE_STEPS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    role="radio"
                    aria-checked={desire === step}
                    aria-label={t(`desire${step}`)}
                    className={`${s.desireStep}${desire != null && step <= desire ? ` ${s.desireOn}` : ""}`}
                    onClick={() => setDesire((current) => (current === step ? null : step))}
                  />
                ))}
              </div>
              <p className={s.desireCaption}>
                {desire == null ? t("desireUnset") : t(`desire${desire}`)}
              </p>
            </div>
          </>
        )}

        {state === "LOVE" && (
          <>
            <div>
              <span className={s.fieldLabel}>{t("loveKindLabel")}</span>
              <div className={s.segRow} role="radiogroup" aria-label={t("loveKindLabel")}>
                {(["mine", "gift"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={loveKind === kind}
                    className={`pressable ${s.segBtn}${loveKind === kind ? ` ${s.segActive}` : ""}`}
                    onClick={() => setLoveKind(kind)}
                  >
                    {kind === "mine" ? t("kindMine") : t("kindGift")}
                  </button>
                ))}
              </div>
            </div>

            {loveKind === "gift" && (
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <label>
                  <span className={s.fieldLabel}>{t("giverLabel")}</span>
                  <input
                    className={s.input}
                    type="text"
                    maxLength={120}
                    value={giverName}
                    onChange={(event) => setGiverName(event.target.value)}
                    placeholder={t("giverPlaceholder")}
                  />
                </label>
                <label>
                  <span className={s.fieldLabel}>{t("yearLabel")}</span>
                  <input
                    className={s.input}
                    type="number"
                    min={1900}
                    max={new Date().getFullYear()}
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                  />
                </label>
              </div>
            )}
          </>
        )}

        <label>
          <span className={s.fieldLabel}>{t("noteLabel")}</span>
          <textarea
            className={s.input}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
          />
        </label>

        <div>
          <span className={s.fieldLabel}>{t("photoLabel")}</span>
          {file === null ? (
            <label className={`pressable ${s.photoDrop}`}>
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
              >
                <rect x="3" y="5" width="18" height="14" />
                <circle cx="9" cy="10" r="1.8" />
                <path d="M3 17l5.5-5 4 3.5L16 12l5 5" />
              </svg>
              <span>{t("photoAdd")}</span>
              <span className={s.photoDropHint}>{t("photoHint")}</span>
              <input type="file" accept="image/*" onChange={onFileChange} className="sr-only" />
            </label>
          ) : (
            <div className={s.photoPreviewRow}>
              {/* Локальный blob-превью до загрузки — next/image тут ни к чему. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview && <img src={preview} alt="" className={s.photoThumb} />}
              <span className={s.photoName}>{file.name}</span>
              <button type="button" className={`pressable ${s.photoRemove}`} onClick={removePhoto}>
                {t("photoRemove")}
              </button>
            </div>
          )}
        </div>

        <label>
          <span className={s.fieldLabel}>{t("urlLabel")}</span>
          <input
            className={s.input}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t("urlPlaceholder")}
          />
        </label>

        {errorKey && <p className={s.error}>{t(errorKey)}</p>}

        <div className="sticky bottom-0 -mx-6 bg-surface-app-ground px-6 pb-8 pt-4">
          <button type="submit" disabled={saving} className={`pressable ${s.lightBar}`}>
            {saving ? t("saving") : `${t("save")} →`}
          </button>
        </div>
      </form>
    </main>
  );
}

function errorToKey(code: string): string {
  switch (code) {
    case "AUTH":
      return "errAuth";
    case "NO_ROOM":
      return "errNoRoom";
    case "TOO_LARGE":
      return "errTooLarge";
    case "BAD_TYPE":
      return "errBadType";
    case "ZONE_NOT_VISIBLE":
      return "errZone";
    case "VALIDATION":
    case "FOREIGN_PHOTO_KEY":
      return "errValidation";
    default:
      return "errGeneric";
  }
}
