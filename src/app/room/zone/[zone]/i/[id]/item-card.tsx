"use client";

// Карточка вещи глазами хозяйки, РЕДАКЦИЯ v2 (тикет 159, доска 47a; числа —
// `design/package/handoff/round39/item-card-owner.json`). Прежняя редакция —
// тикет 39, турны 11e и 8c.
//
// ЧТО ИЗМЕНИЛОСЬ. Экран был ФОРМОЙ: открывался сразу в правке, все поля
// наружу, «Сохранить» внизу. Вещь на нём нельзя было просто посмотреть.
// Теперь их два состояния: ПОКАЗ (фото 260, название, цена и огоньки, полка,
// заметка, «где купить») и ПРАВКА — та же форма, что была, за главным
// действием «Изменить». Действия ушли под «⋯» листом round36.
//
// Чего здесь нет и не будет:
// - состояния вещи: его не существует (тикет 124). Место решает МЕСТО, и
//   меняет его отдельное действие в листе «⋯» — «В сокровищницу» / «Вернуть в
//   комнату». В форме правки ключа `inHall` нет вовсе — ни в разметке, ни в
//   отправляемом объекте;
// - ничего про бронь (ИНВАРИАНТ №1): хозяйке не показывают, что вещь занята,
//   поэтому карточка не спрашивает сервер «а можно ли править» и не рисует ни
//   предупреждения, ни блокировки. Правка проходит молча. Ни имени, ни факта,
//   ни счётчика, ни даты — ни текстом, ни в `aria-label`, ни в `title`, ни в
//   `data-*`. Держит `tests/item-card-owner.test.ts`.
//
// «В СОКРОВИЩНИЦУ» ВИДНА ВСЕГДА И ВЫГЛЯДИТ ОДИНАКОВО — и это не удобство, а
// тот же инвариант №1 (письмо дизайна 29, контракт → sheet.rows[0].note).
// Спрятанная или притушенная при живой брони строка сообщила бы хозяйке, что
// вещь забрали, — точнее любого счётчика. Поэтому карточка про бронь не
// спрашивает вовсе: спросить было бы уже пол-нарушения.
//
// СТЕПЕНЬ ЖЕЛАНИЯ ПРАВИТСЯ НА МЕСТЕ — тапом по огонькам, без «Изменить» и без
// «Сохранить» (раунд 29, task31.json → addFormScale.editInPlace). Довод дизайна
// прямой: проставить степень задним числом тридцати вещам должно быть дёшево, а
// через форму это тридцать раз «открыть — выбрать — сохранить». Отдельного поля
// степени в форме ниже поэтому нет: два места ввода одного значения на одном
// экране — это два места, где оно разъедется. Огоньки стоят У ЦЕНЫ, как просит
// round39: оба числа про одно — насколько это нужно.
import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { DesirePicker } from "@/components/item/desire-picker";
import { ItemActions, SIGN_SIZE, type ItemActionRow } from "@/components/item/item-actions";
import { ShopLink } from "@/components/zone/shop-link";
import { PoolIcon } from "@/components/pool-icons";
import {
  IconActionDelete,
  IconActionReturn,
  IconActionTreasury,
  IconEye,
  IconEyeOff,
  IconMove,
} from "@/components/icons";
import type { OwnerItemDto } from "@/server/dto/items";
import { isExperienceZone } from "@/server/dto/experience";
import type { HallPriceAudience } from "@/server/dto/hall";
import { formatHallMoney } from "@/app/room/hall/money";
import { PriceSeenBadge } from "@/app/room/hall/price-seen-badge";
import { setHallHiddenAction } from "@/app/room/hall/actions";
import s from "@/components/item/owner-card.module.css";
import {
  deleteItemAction,
  setItemHiddenAction,
  toggleHallAction,
  updateItemAction,
  type ItemActionResult,
} from "../../actions";

export type ZoneOption = { key: string; label: string };

type PriceVisibility = "ALL" | "FRIENDS" | "ME" | "NONE";

const VISIBILITIES: PriceVisibility[] = ["ALL", "FRIENDS", "ME", "NONE"];
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

/** Знак пула на месте отсутствующего фото — 34 при .35 (contract → photo.empty). */
const EMPTY_PHOTO_SIGN = 34;
/** Знак полки в строке-ссылке — 16 при .55 (contract → body.zone). */
const ZONE_SIGN = 16;
/** «⋯» над фотографией — 20 в цели 44 (contract → head.more). */
const MORE_GLYPH = 20;

/** "#RRGGBB" + альфа → 8-значный hex (ореол «полосы света», tokens.json). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** "#RRGGBB" темнее на долю — граница «полосы света» под нажатием. */
function shadeHex(hex: string, amount: number): string {
  const channel = (from: number) => {
    const value = Number.parseInt(hex.slice(from, from + 2), 16);
    if (!Number.isFinite(value)) return "00";
    return Math.max(0, Math.round(value * (1 - amount)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
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
 * Вещь СОКРОВИЩНИЦЫ глазами хозяйки — то, чего нет в owner-DTO: цена и
 * «скрыта ли от гостей». Считано `hallItemForOwner` на сервере (тикет 35,
 * ADR-0004). Отдельно от `item`, потому что форма витрины в owner-DTO цены не
 * несёт и не должна: цена сокровищницы появляется ровно по настройке.
 * `null` — вещь лежит в комнате.
 *
 * ЦЕНА ЗДЕСЬ ОСТАЁТСЯ, хотя контракт round39 пишет у варианта витрины «цены
 * нет». Его правило — про ГОСТЯ, и для гостя оно у нас выполнено жёстче
 * некуда: ключей price/currency нет в гостевом DTO вовсе. А инвариант №8
 * говорит второй половиной: «хозяйке её собственные цены видны ВСЕГДА,
 * включая её собственную витрину». Убрать цену отсюда значило бы исполнить
 * половину правила, нарушив вторую.
 */
export type HallViewDto = {
  /** Строка Decimal, уже округлённая, если включён тумблер. `null` — цены нет. */
  price: string | null;
  currency: string | null;
  /** Показана округлённой — подпись «около …». */
  rounded: boolean;
  /** Кому адресована цена — ключ подписи `Hall.seen*`. */
  priceAudience: HallPriceAudience;
  /** Скрыта от гостей витрины (`hiddenFromHall`) — строка листа «Показать». */
  hiddenFromObservers: boolean;
};

type ItemCardProps = {
  item: OwnerItemDto;
  /** Цена и «скрыта ли» витринной вещи; `null` у вещи комнаты. */
  hall: HallViewDto | null;
  /** Видимые зоны комнаты — куда вещь можно перенести. */
  zones: ZoneOption[];
  /** Подпись зоны, в которой вещь лежит сейчас (путь назад). */
  zoneLabel: string;
  /** Ключ пула зоны — знак полки в строке-ссылке и на пустом фото. */
  zonePool: string | null;
  accent: string;
  ink: string;
};

export function ItemCard({
  item,
  hall,
  zones,
  zoneLabel,
  zonePool,
  accent,
  ink,
}: ItemCardProps) {
  // Действия вещи и строки истории — ns Settings (там же живут «Спрятать»,
  // «Удалить», «В сокровищницу»); подписи полей — ns AddItem: карточка правки
  // говорит теми же словами, что карточка добавления. Строки про цену витрины,
  // «кто её видит» и её собственные действия — ns Hall: они принадлежат
  // сокровищнице, и говорить о ней в двух местах разными словами нельзя.
  const t = useTranslations("Settings");
  const tField = useTranslations("AddItem");
  const tHall = useTranslations("Hall");
  const tExp = useTranslations("Experience");
  const locale = useLocale();
  const router = useRouter();

  // Форму карточки решает МЕСТО вещи (тикет 124): комната — цена и желание,
  // сокровищница — даритель и год. Состояний у вещи больше нет.
  const want = item.inHall ? null : item;
  const love = item.inHall ? item : null;

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
  // Впечатление (тикет 97): «Когда · Где · Годен до». Поля держим ВСЕГДА, а
  // не только в зоне впечатлений, — см. buildInput: сервер пишет их
  // безусловно, и не отправить их значит стереть.
  const [eventWhen, setEventWhen] = useState(item.eventWhen ?? "");
  const [eventWhere, setEventWhere] = useState(item.eventWhere ?? "");
  const [validUntil, setValidUntil] = useState(item.validUntil ?? "");
  const [giverName, setGiverName] = useState(love?.giverName ?? "");
  const [year, setYear] = useState(love?.receivedAt ? yearOf(love.receivedAt) : "");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Показ или правка. Экран открывается ПОКАЗОМ: вещь сначала смотрят.
  const [editing, setEditing] = useState(false);
  // Вопрос перед необратимым. Он про ВЕЩЬ, о брони в нём ни слова: «переезд
  // снимет чью-то бронь» — это ровно то, чего хозяйке знать нельзя.
  const [confirming, setConfirming] = useState<"delete" | "treasury" | null>(null);
  const [, startTransition] = useTransition();

  const canSave = title.trim() !== "" && (item.inHall || price.trim() !== "");
  const currencyOptions: ReadonlyArray<{ code: string; label: string }> = CURRENCIES.some(
    (option) => option.code === currency,
  )
    ? CURRENCIES
    : [...CURRENCIES, { code: currency, label: currency }];

  const zoneHref = `/room/zone/${item.zone}`;
  const style = {
    "--card-accent": accent,
    "--card-accent-active": shadeHex(accent, 0.2),
    "--card-glow-42": withAlpha(accent, 0.42),
    "--card-glow-85": withAlpha(accent, 0.85),
    "--card-glow-25": withAlpha(accent, 0.25),
    "--card-ease": "cubic-bezier(0.23, 1, 0.32, 1)",
  } as CSSProperties;

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

  /**
   * Тело правки. `inHall` не отправляется вовсе: правка не переселяет вещь.
   * Степень приходит доводом, потому что её меняет ещё и тап по огонькам —
   * там своего набора полей не собирается, иначе он однажды разойдётся с этим.
   */
  function buildInput(desireValue: number | null) {
    // ПОЛЯ ВПЕЧАТЛЕНИЯ ИДУТ ВСЕГДА, в обеих ветках. `updateItem` пишет их
    // безусловно (`eventWhen: data.eventWhen ?? null`), поэтому «не отправить»
    // здесь означает «стереть». Баг жил с тикета 97 и стрелял тише, чем
    // кажется: тот же `buildInput` зовёт тап по огоньку степени — одно
    // касание шкалы обнуляло человеку срок годности сертификата.
    const common = {
      zone,
      title: title.trim(),
      note: note.trim() || undefined,
      eventWhen: eventWhen.trim() || undefined,
      eventWhere: eventWhere.trim() || undefined,
      validUntil: validUntil || undefined,
    };
    return !item.inHall
      ? {
          ...common,
          price: price.trim(),
          currency,
          priceVisibility,
          size: size.trim() || undefined,
          color: color.trim() || undefined,
          desire: desireValue ?? undefined,
        }
      : {
          ...common,
          giverName: giverName.trim() || undefined,
          receivedYear: year.trim() === "" ? undefined : Number(year),
        };
  }

  /**
   * Правка степени НА МЕСТЕ: тап по огоньку и есть сохранение (раунд 29).
   * Огонёк загорается сразу, не дожидаясь сервера, — иначе тап по тридцати
   * вещам подряд превращается в тридцать ожиданий.
   *
   * Пока форме нечего сохранять (нет названия или цены), на сервер не идём:
   * значение остаётся в черновике и уедет туда вместе с «Сохранить». Показать
   * тут ошибку валидации значило бы отругать человека за поле, которого он не
   * трогал.
   */
  function onPickDesire(next: number | null) {
    if (busy || item.inHall) return;
    setDesire(next);
    if (!canSave) return;
    run(
      () => updateItemAction(item.id, buildInput(next)),
      () => router.refresh(),
    );
  }

  function onSave() {
    if (busy || !canSave) return;
    const input = buildInput(desire);

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

  // Цена вещи КОМНАТЫ. Хозяйке видна ВСЕГДА (инвариант №8): `priceVisibility`
  // говорит про гостя, и правится она в форме, а не здесь.
  const roomPrice =
    want?.price == null ? null : formatHallMoney(want.price, want.currency, locale);

  /**
   * Лист «⋯» — состав по контракту round39, знаки round36 (тикет 150).
   *
   * «Кадры вещи» в списке НЕТ: у вещи одно фото (`Item.photoKey`), галереи в
   * продукте не существует, и строка вела бы в пустоту. Знак `action-gallery`
   * у нас есть и ждёт саму галерею — см. файл тикета 159.
   */
  const sheetRows: ItemActionRow[] = item.inHall
    ? [
        {
          key: "return",
          icon: <IconActionReturn size={SIGN_SIZE} />,
          title: tHall("remove"),
          hint: tHall("removeHint", { zone: zoneLabel }),
          onSelect: () =>
            run(
              () => toggleHallAction(item.id, false),
              () => router.refresh(),
            ),
        },
        {
          key: "hide",
          icon: hall?.hiddenFromObservers ? (
            <IconEye size={SIGN_SIZE} />
          ) : (
            <IconEyeOff size={SIGN_SIZE} />
          ),
          title: hall?.hiddenFromObservers ? tHall("show") : tHall("hide"),
          hint: hall?.hiddenFromObservers ? tHall("showHint") : tHall("hideHint"),
          onSelect: () =>
            run(
              () => setHallHiddenAction(item.id, !hall?.hiddenFromObservers),
              () => router.refresh(),
            ),
        },
        {
          key: "delete",
          icon: <IconActionDelete size={SIGN_SIZE} />,
          title: t("itemDelete"),
          hint: t("itemDeleteHint"),
          danger: true,
          onSelect: () => setConfirming("delete"),
        },
      ]
    : [
        {
          // ВИДНА ВСЕГДА И ОДИНАКОВА — инвариант №1 (см. шапку файла).
          key: "treasury",
          icon: <IconActionTreasury size={SIGN_SIZE} />,
          title: t("itemHallAdd"),
          hint: t("itemHallAddHint"),
          onSelect: () => setConfirming("treasury"),
        },
        {
          // «Перенести в зону» — это выбор полки, а он живёт в форме правки:
          // второго списка зон на экране не заводим.
          key: "move",
          icon: <IconMove size={SIGN_SIZE} />,
          title: t("itemMove"),
          hint: t("itemMoveHint"),
          onSelect: () => setEditing(true),
        },
        {
          key: "hide",
          icon: item.hidden ? <IconEye size={SIGN_SIZE} /> : <IconEyeOff size={SIGN_SIZE} />,
          title: item.hidden ? t("itemShow") : t("itemHide"),
          hint: item.hidden ? t("itemShowHint") : t("itemHideHint"),
          onSelect: () =>
            run(
              () => setItemHiddenAction(item.id, !item.hidden),
              () => router.refresh(),
            ),
        },
        {
          key: "delete",
          icon: <IconActionDelete size={SIGN_SIZE} />,
          title: t("itemDelete"),
          hint: t("itemDeleteHint"),
          danger: true,
          onSelect: () => setConfirming("delete"),
        },
      ];

  return (
    <main className={s.screen} style={style}>
      <div className={s.column}>
        {/* Фото 260, `cover`; знаки — НАД ним (contract → screen.photo, head). */}
        <div
          className={item.photoUrl ? s.photo : `${s.photo} ${s.photoEmpty}`}
          style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}
        >
          {!item.photoUrl && zonePool && <PoolIcon pool={zonePool} size={EMPTY_PHOTO_SIGN} />}

          <div className={s.head}>
            {/* Стрелки 20 отдельным знаком в наборе дизайна НЕТ (`handoff/icons`
                — двадцать файлов, ui-back среди них не приехал). Свою не рисуем
                (правило тикета 150): назад ведёт та же «←» текстом, что стояла
                здесь всегда, — но теперь на цели 44, как просит контракт. */}
            <Link href={zoneHref} aria-label={zoneLabel} className={`pressable ${s.headSign}`}>
              ←
            </Link>

            <span className={s.headActions}>
              <ItemActions rows={sheetRows} moreLabel={t("itemMore")} glyph={MORE_GLYPH} />
            </span>
          </div>
        </div>

        {/* Одна поверхность: от нижней кромки фото до низа экрана. */}
        <div className={s.surface}>
          <h1 className={s.name}>{item.title}</h1>

          {/* Подпись витрины — «Подарок 2026 года · от Кати». Имя видит только
              хозяйка и только здесь: оно раскрыто один раз на «что подарили»
              (инвариант №2), вещь уже переехала, брони за ним нет. */}
          {item.inHall && (
            <p className={s.caption}>
              {love?.giverName
                ? tHall("captionYearGiver", { year: sinceYear, giver: love.giverName })
                : tHall("captionYear", { year: sinceYear })}
            </p>
          )}

          {item.hidden && <p className={s.caption}>{t("itemHiddenBadge")}</p>}

          {/* Цена и огоньки — вместе, как просит round39: оба числа про одно.
              У вещи витрины шкалы нет вовсе: желание исполнено. */}
          {!item.inHall && (
            <div className={s.priceRow}>
              {roomPrice !== null && <span className={s.price}>{roomPrice}</span>}
              <DesirePicker desire={desire} accent={accent} onPick={onPickDesire} disabled={busy} />
            </div>
          )}

          {/* Цена вещи СОКРОВИЩНИЦЫ. Хозяйке своя цена видна всегда (инвариант
              №8), а значок рядом честно говорит, кто видит её КРОМЕ неё. Цены
              у вещи нет вовсе — строки нет: сказать нечего (тикет 35). */}
          {item.inHall && hall?.price != null && (
            <div className={s.priceRow}>
              <span className={s.price}>
                {hall.rounded
                  ? tHall("priceAbout", {
                      price: formatHallMoney(hall.price, hall.currency, locale),
                    })
                  : formatHallMoney(hall.price, hall.currency, locale)}
              </span>
              <PriceSeenBadge audience={hall.priceAudience} />
            </div>
          )}

          {/* Полка — строка-ссылка: знак зоны 16 при .55 + подпись 13 при .72. */}
          <Link href={zoneHref} className={`pressable ${s.zoneRow}`}>
            {zonePool && (
              <span className={s.zoneSign} aria-hidden>
                <PoolIcon pool={zonePool} size={ZONE_SIGN} />
              </span>
            )}
            <span className={s.zoneLabel}>{zoneLabel}</span>
          </Link>

          {item.note && !editing && <p className={s.note}>{item.note}</p>}

          {/* «Где купить» — тот же единственный якорь продукта, что у гостя
              (тикет 37). Место `card` не считается: переходы хозяйки по своей
              же ссылке — не интерес гостей. */}
          {!item.inHall && want?.shop && (
            <ShopLink
              itemId={item.id}
              url={want.shop.url}
              domain={want.shop.domain}
              place="card"
            />
          )}

          {/* Впечатление в показе — «Когда · Где» строкой; правится в форме. */}
          {!editing && (item.eventWhen || item.eventWhere) && (
            <p className={s.note}>
              {[item.eventWhen, item.eventWhere].filter(Boolean).join(" · ")}
            </p>
          )}

          {errorKey && <p className={s.error}>{tField(errorKey)}</p>}

          {/* Правка полей и перенос на другую полку — за «Изменить». */}
          {editing && (
            <section className="flex flex-col gap-4">
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

              {!item.inHall && (
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

                  {/* Поля степени желания здесь БОЛЬШЕ НЕТ (раунд 29): она
                      правится тапом по огонькам у цены и сохраняется тем же
                      тапом. Второе место ввода того же значения на том же
                      экране — это место, где оно разъедется. */}
                </>
              )}

              {item.inHall && (
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

              {/* Впечатление (тикет 97) — та же развилка, что в карточке
                  добавления: поля показываются в зонах впечатлений. Значения
                  уходят на сервер ВСЕГДА (см. buildInput), показ — только
                  здесь: спрашивать «Когда» у пары кроссовок незачем. */}
              {isExperienceZone(zone) && (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL_CLASS}>{tExp("when")}</span>
                    <input
                      className={INPUT_CLASS}
                      maxLength={80}
                      value={eventWhen}
                      onChange={(event) => setEventWhen(event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL_CLASS}>{tExp("where")}</span>
                    <input
                      className={INPUT_CLASS}
                      maxLength={80}
                      value={eventWhere}
                      onChange={(event) => setEventWhere(event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL_CLASS}>{tExp("validUntil")}</span>
                    <input
                      className={INPUT_CLASS}
                      type="date"
                      value={validUntil}
                      onChange={(event) => setValidUntil(event.target.value)}
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
          )}

          {/* ГЛАВНОЕ ДЕЙСТВИЕ — «полоса света» (турн 22). В комнате «Изменить»,
              в сокровищнице «Записать заметку»: там правят не цену, а память.
              Вопрос перед необратимым встаёт на его место — и он про ВЕЩЬ. */}
          {confirming !== null ? (
            <div className={s.confirm}>
              <span className={s.confirmTitle}>
                {confirming === "delete" ? t("itemDeleteConfirm") : t("itemHallAddConfirm")}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const action =
                    confirming === "delete"
                      ? () => deleteItemAction(item.id)
                      : () => toggleHallAction(item.id, true);
                  const done =
                    confirming === "delete"
                      ? () => router.push(zoneHref)
                      : () => router.refresh();
                  setConfirming(null);
                  run(action, done);
                }}
                className={`pressable ${s.confirmYes}`}
              >
                {confirming === "delete" ? t("itemDeleteYes") : t("itemHallAddYes")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(null)}
                className={`pressable ${s.confirmNo}`}
              >
                {confirming === "delete" ? t("itemDeleteNo") : t("itemHallAddNo")}
              </button>
            </div>
          ) : (
            !editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                className={`pressable ${s.mainAction}`}
              >
                <span>{item.inHall ? tHall("noteAdd") : t("itemEdit")}</span>
                <span className={s.mainActionGo} aria-hidden>
                  →
                </span>
              </button>
            )
          )}
        </div>
      </div>
    </main>
  );
}
