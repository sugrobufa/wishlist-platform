"use client";

// Карточка вещи глазами хозяйки (тикет 39, турны 11e и 8c). Экран собран из
// того, что уже есть: поля — те же, что в карточке добавления (турн 8, доска
// прямо обещает переиспользование), действия — те же, что в меню плитки
// (тикеты 10 и 13). Нового здесь ровно два: правка полей с переносом на
// другую полку и история вещи «люблю».
//
// Чего здесь нет и не будет:
// - состояния вещи: «хочу → люблю» переводит отдельная кнопка «Уже моё» в
//   сетке зоны, и переход необратим (инвариант №2). В форме правки поля
//   `state` нет вовсе — ни в разметке, ни в отправляемом объекте;
// - ничего про бронь: хозяйке не показывают, что вещь занята (инвариант №1),
//   поэтому карточка не спрашивает сервер «а можно ли править» и не рисует
//   ни предупреждения, ни блокировки. Правка проходит молча.
import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { OwnerItemDto } from "@/server/dto/items";
import type { HallPriceAudience } from "@/server/dto/hall";
import { formatHallMoney } from "@/app/room/hall/money";
import { PriceSeenBadge } from "@/app/room/hall/price-seen-badge";
import {
  deleteItemAction,
  setItemHiddenAction,
  updateItemAction,
  type ItemActionResult,
} from "../../actions";

export type ZoneOption = { key: string; label: string };

type PriceVisibility = "ALL" | "FRIENDS" | "ME" | "NONE";

const VISIBILITIES: PriceVisibility[] = ["ALL", "FRIENDS", "ME", "NONE"];
const DESIRE_STEPS = [1, 2, 3, 4] as const;
// Малый набор формы; сервис принимает любой код ISO 4217 (как в карточке
// добавления). Валюта вещи, пришедшая из парсера, дорисовывается ниже.
const CURRENCIES = [
  { code: "RUB", label: "₽ RUB" },
  { code: "USD", label: "$ USD" },
  { code: "EUR", label: "€ EUR" },
] as const;

const INPUT_CLASS =
  "w-full border border-surface-hairline-strong bg-surface-app-ground px-3 py-2.5 text-sm text-text-primary outline-none focus:border-text-faint";
const LABEL_CLASS = "text-sm text-text-muted";

/** "#RRGGBB" + альфа → 8-значный hex (ореол «полосы света», tokens.json). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** Год строкой: ICU расставил бы разряды («2 024»), а это не число, а год. */
function yearOf(iso: string): string {
  return String(new Date(iso).getUTCFullYear());
}

/** Отказ сервиса → ключ строки словаря (ns AddItem — те же тексты, что в форме). */
function errorToKey(code: NonNullable<ItemActionResult>["error"]): string {
  switch (code) {
    case "AUTH":
      return "errAuth";
    case "ZONE_NOT_VISIBLE":
      return "errZone";
    case "VALIDATION":
      return "errValidation";
    default:
      return "errGeneric";
  }
}

/**
 * Цена вещи «люблю» для истории — считана `hallItemForOwner` на сервере
 * (тикет 35, ADR-0004). Отдельно от `item`, потому что форма LOVE в owner-DTO
 * цены не несёт и не должна: цена «люблю» появляется ровно по настройке.
 * `null` — вещь не «люблю».
 */
export type LovePriceDto = {
  /** Строка Decimal, уже округлённая, если включён тумблер. `null` — цены нет. */
  price: string | null;
  currency: string | null;
  /** Показана округлённой — подпись «около …». */
  rounded: boolean;
  /** Кому адресована цена — ключ подписи `Hall.seen*`. */
  priceAudience: HallPriceAudience;
};

type ItemCardProps = {
  item: OwnerItemDto;
  /** Цена «люблю» и кому она видна; `null` у вещи «хочу». */
  lovePrice: LovePriceDto | null;
  /** Видимые зоны комнаты — куда вещь можно перенести. */
  zones: ZoneOption[];
  /** Подпись зоны, в которой вещь лежит сейчас (путь назад). */
  zoneLabel: string;
  accent: string;
  ink: string;
};

export function ItemCard({ item, lovePrice, zones, zoneLabel, accent, ink }: ItemCardProps) {
  // Действия вещи и строки истории — ns Settings (там же живут «Спрятать»,
  // «Удалить», «Уже моё»); подписи полей — ns AddItem: карточка правки
  // говорит теми же словами, что карточка добавления. Строки про цену «люблю»
  // и «кто её видит» — ns Hall: они принадлежат залу славы, и говорить о цене
  // в двух местах разными словами нельзя.
  const t = useTranslations("Settings");
  const tField = useTranslations("AddItem");
  const tHall = useTranslations("Hall");
  const locale = useLocale();
  const router = useRouter();

  const want = item.state === "WANT" ? item : null;
  const love = item.state === "LOVE" ? item : null;

  const [title, setTitle] = useState(item.title);
  const [zone, setZone] = useState(item.zone);
  const [note, setNote] = useState(item.note ?? "");
  const [price, setPrice] = useState(want?.price ?? "");
  const [currency, setCurrency] = useState(want?.currency ?? "RUB");
  const [priceVisibility, setPriceVisibility] = useState<PriceVisibility>(
    want?.priceVisibility ?? "ALL",
  );
  const [size, setSize] = useState(want?.size ?? "");
  const [color, setColor] = useState(want?.color ?? "");
  const [desire, setDesire] = useState<number | null>(want?.desire ?? null);
  const [giverName, setGiverName] = useState(love?.giverName ?? "");
  const [year, setYear] = useState(love?.receivedAt ? yearOf(love.receivedAt) : "");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [, startTransition] = useTransition();

  const canSave = title.trim() !== "" && (item.state === "LOVE" || price.trim() !== "");
  const currencyOptions: ReadonlyArray<{ code: string; label: string }> = CURRENCIES.some(
    (option) => option.code === currency,
  )
    ? CURRENCIES
    : [...CURRENCIES, { code: currency, label: currency }];

  const zoneHref = `/room/zone/${item.zone}`;
  const style = { "--card-accent": accent } as CSSProperties;

  function run(action: () => Promise<ItemActionResult>, onDone?: () => void) {
    setBusy(true);
    setErrorKey(null);
    setSaved(false);
    startTransition(async () => {
      const result = await action();
      setBusy(false);
      if (result?.error) {
        setErrorKey(errorToKey(result.error));
        return;
      }
      onDone?.();
    });
  }

  function onSave() {
    if (busy || !canSave) return;
    const common = { zone, title: title.trim(), note: note.trim() || undefined };
    // `state` не отправляется вовсе: правка не меняет состояние вещи.
    const input =
      item.state === "WANT"
        ? {
            ...common,
            price: price.trim(),
            currency,
            priceVisibility,
            size: size.trim() || undefined,
            color: color.trim() || undefined,
            desire: desire ?? undefined,
          }
        : {
            ...common,
            giverName: giverName.trim() || undefined,
            receivedYear: year.trim() === "" ? undefined : Number(year),
          };

    run(
      () => updateItemAction(item.id, input),
      () => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
        // Переехала на другую полку — адрес карточки меняется вместе с ней.
        if (zone !== item.zone) router.replace(`/room/zone/${zone}/i/${item.id}`);
        router.refresh();
      },
    );
  }

  // «В комнате с»: у подарка — год, когда он дошёл, иначе — когда вещь
  // появилась в комнате (турн 8c).
  const sinceYear = yearOf(love?.receivedAt ?? item.createdAt);

  return (
    <main className="min-h-screen pb-16" style={style}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pb-10 lg:px-0">
        <header className="pt-6 lg:pt-10">
          <Link href={zoneHref} className="pressable text-xs font-semibold text-text-strong">
            ← {zoneLabel}
          </Link>
          <p className="overline mt-5 text-text-muted">
            {item.state === "LOVE" ? tField("loveLabel") : tField("wantLabel")}
            {item.hidden && <span className="ml-2 text-text-faint">· {t("itemHiddenBadge")}</span>}
          </p>
          <h1 className="display mt-2 text-3xl lg:text-4xl">{item.title}</h1>
        </header>

        {item.photoUrl && (
          <div
            className="aspect-[4/3] w-full border border-surface-hairline bg-surface-fill bg-cover bg-center"
            style={{ backgroundImage: `url(${item.photoUrl})` }}
            aria-hidden
          />
        )}

        {/* История вещи «люблю» (турн 8c): вместо магазинов — заметка и три
            строки о том, откуда вещь взялась. Заметка до сих пор не
            показывалась нигде (разбор Б21). */}
        {item.state === "LOVE" && (
          <section className="flex flex-col gap-3 border border-surface-hairline bg-surface-fill p-5">
            {item.note && <p className="text-sm leading-relaxed text-text-primary">{item.note}</p>}
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-text-muted">{t("itemSince")}</dt>
                <dd className="text-text-primary">{sinceYear}</dd>
              </div>
              {love?.giverName && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-text-muted">{t("itemGiverRow")}</dt>
                  <dd className="text-text-primary">{love.giverName}</dd>
                </div>
              )}
              {/* Цена вещи «люблю». Раньше здесь безусловно стояло «Скрыта» —
                  это перестало быть правдой с тикетом 35: цену открывает
                  настройка зала славы (ADR-0004). Хозяйке её собственная цена
                  видна всегда, а значок рядом честно говорит, кто видит её
                  КРОМЕ неё. Цены у вещи нет вовсе — строки нет: сказать
                  нечего, а «Скрыта» соврало бы второй раз. */}
              {lovePrice?.price != null && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-text-muted">{tField("priceLabel")}</dt>
                  <dd className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 text-text-primary">
                    <span>
                      {lovePrice.rounded
                        ? tHall("priceAbout", {
                            price: formatHallMoney(lovePrice.price, lovePrice.currency, locale),
                          })
                        : formatHallMoney(lovePrice.price, lovePrice.currency, locale)}
                    </span>
                    <PriceSeenBadge audience={lovePrice.priceAudience} />
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* Правка полей и перенос на другую полку. */}
        <section className="flex flex-col gap-4 border border-surface-hairline bg-surface-fill p-5">
          <p className="overline text-text-muted">{t("itemEdit")}</p>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>{tField("titleLabel")}</span>
            <input
              className={INPUT_CLASS}
              type="text"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={tField("titlePlaceholder")}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>{tField("zoneLabel")}</span>
            <select
              className={INPUT_CLASS}
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

          {item.state === "WANT" && (
            <>
              <div className="grid grid-cols-[1fr_128px] gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL_CLASS}>{tField("priceLabel")}</span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="14 900"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL_CLASS}>{tField("currencyLabel")}</span>
                  <select
                    className={INPUT_CLASS}
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                  >
                    {currencyOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={LABEL_CLASS}>{tField("priceVisibilityLabel")}</span>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label={tField("priceVisibilityLabel")}
                >
                  {VISIBILITIES.map((option) => {
                    const active = priceVisibility === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setPriceVisibility(option)}
                        className="pressable border border-surface-hairline-strong px-3 py-1.5 text-xs font-semibold"
                        style={
                          active
                            ? { background: accent, borderColor: accent, color: ink }
                            : undefined
                        }
                      >
                        {tField(`vis${option}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL_CLASS}>{tField("sizeLabel")}</span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    maxLength={80}
                    value={size}
                    onChange={(event) => setSize(event.target.value)}
                    placeholder={tField("sizePlaceholder")}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={LABEL_CLASS}>{tField("colorLabel")}</span>
                  <input
                    className={INPUT_CLASS}
                    type="text"
                    maxLength={80}
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    placeholder={tField("colorPlaceholder")}
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className={LABEL_CLASS}>{tField("desireLabel")}</span>
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="radiogroup"
                  aria-label={tField("desireLabel")}
                >
                  {DESIRE_STEPS.map((step) => {
                    const active = desire != null && step <= desire;
                    return (
                      <button
                        key={step}
                        type="button"
                        role="radio"
                        aria-checked={desire === step}
                        aria-label={tField(`desire${step}`)}
                        onClick={() => setDesire((current) => (current === step ? null : step))}
                        className="pressable h-2.5 w-9 border border-surface-hairline-strong"
                        style={active ? { background: accent, borderColor: accent } : undefined}
                      />
                    );
                  })}
                  <span className="ml-2 text-xs text-text-faint">
                    {desire == null ? tField("desireUnset") : tField(`desire${desire}`)}
                  </span>
                </div>
              </div>
            </>
          )}

          {item.state === "LOVE" && (
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL_CLASS}>{tField("giverLabel")}</span>
                <input
                  className={INPUT_CLASS}
                  type="text"
                  maxLength={120}
                  value={giverName}
                  onChange={(event) => setGiverName(event.target.value)}
                  placeholder={tField("giverPlaceholder")}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL_CLASS}>{tField("yearLabel")}</span>
                <input
                  className={INPUT_CLASS}
                  type="number"
                  min={1900}
                  max={new Date().getUTCFullYear()}
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                />
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>{tField("noteLabel")}</span>
            <textarea
              className={INPUT_CLASS}
              maxLength={2000}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tField("notePlaceholder")}
            />
          </label>

          {errorKey && <p className="text-sm text-text-muted">{tField(errorKey)}</p>}

          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={busy}
              aria-disabled={!canSave}
              onClick={onSave}
              className="pressable self-start border-b-2 px-5 py-2.5 text-sm font-semibold text-text-primary disabled:opacity-60"
              style={{
                borderColor: canSave ? accent : "transparent",
                boxShadow: canSave ? `0 4px 18px -3px ${withAlpha(accent, 0.42)}` : undefined,
              }}
            >
              {busy ? t("saving") : t("save")}
            </button>
            {saved && <span className="text-sm text-text-muted">{t("saved")}</span>}
          </div>
        </section>

        {/* Спрятать и удалить — те же операции, что в меню плитки (тикет 13).
            «Уже моё» и зал славы живут в сетке зоны: карточка по доске (19b)
            держит ровно четыре действия. */}
        <section className="flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => setItemHiddenAction(item.id, !item.hidden),
                () => router.refresh(),
              )
            }
            className="pressable font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
          >
            {item.hidden ? t("itemShow") : t("itemHide")}
          </button>

          {confirmingDelete ? (
            <>
              <span className="text-text-muted">{t("itemDeleteConfirm")}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () => deleteItemAction(item.id),
                    () => router.push(zoneHref),
                  )
                }
                className="pressable font-semibold text-text-strong disabled:opacity-60"
              >
                {t("itemDeleteYes")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
                className="pressable font-semibold text-text-muted disabled:opacity-60"
              >
                {t("itemDeleteNo")}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
              className="pressable font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
            >
              {t("itemDelete")}
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
