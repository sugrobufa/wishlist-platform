"use client";

// Карточка вещи глазами хозяйки — ЭКРАН ЧТЕНИЯ (тикет 196, доска 51a; числа —
// `design/package/handoff/round45/item-card.json` → owner). Прежние редакции:
// тикет 39 (турны 11e и 8c) и тикет 159 (доска 47a, round41).
//
// ЗАЧЕМ ПЕРЕДЕЛАНО. «Форма упорядочена по полям модели, экран чтения — по
// вопросу читателя» (принцип пакета 45). Форма ставит всё одним весом, потому
// что заполнить надо всё; на экране чтения крупным обязано быть то, что
// отвечает на вопрос. Вопрос хозяйки — «та ли это вещь и там ли она стоит»,
// отсюда крупная фотография (352 против 260) и название 24 против 22, полка
// миниатюрой КАДРА вместо строки со знаком, заметка своим блоком с
// надстрочной, «Где купить» числом магазинов и «от {price}» вместо домена.
//
// Вопрос гостя другой — «дарить ли это», — и отвечает на него отдельный экран
// (`/r/[slug]/i/[id]`): там крупно ЦЕНА и МАГАЗИНЫ, а полки нет вовсе.
//
// КОНТРАКТ ПЕРЕЕХАЛ С round39 НА round41, и переехал он НАМ НАВСТРЕЧУ: все
// пять расхождений, которые мы держали списком «чего не взяли», дизайн закрыл
// сам — «Кадры вещи» сняты, огоньки 6/5 и ввод подтверждены, лист сведён к 52
// и 500/13.5, «открыто» объяснено (это значение цены у денежной вещи, а не
// замена пустой), у цены в витрине появился адресат. Плюс приехал знак
// «назад». Список расхождений пуст — впервые с round39.
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
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { DesirePicker } from "@/components/item/desire-picker";
import { ItemActions, SIGN_SIZE, type ItemActionRow } from "@/components/item/item-actions";
import { shelfFrameBackground } from "@/components/item/shelf-frame";
import type { ZoneRect } from "@/config/design";
import { ShopLink } from "@/components/zone/shop-link";
import { PoolIcon } from "@/components/pool-icons";
import {
  IconActionDelete,
  IconActionReturn,
  IconActionTreasury,
  IconBack,
  IconEye,
  IconEyeOff,
  IconGallery,
  IconMove,
} from "@/components/icons";
import type { OwnerItemDto } from "@/server/dto/items";
import { guestSeesPrice } from "@/server/dto/guest-items";
import { isExperienceZone } from "@/server/dto/experience";
import type { HallPriceAudience } from "@/server/dto/hall";
import { formatHallMoney } from "@/app/room/hall/money";
import { PriceSeenBadge } from "@/app/room/hall/price-seen-badge";
import { setHallHiddenAction } from "@/app/room/hall/actions";
import s from "@/components/item/owner-card.module.css";
import { presignItemPhotoAction } from "@/app/room/add/actions";
import {
  deleteItemAction,
  setItemHiddenAction,
  setItemPhotoAction,
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

/** Знак пула на месте отсутствующего фото — 38 при .3 (contract → cases.noPhoto). */
const EMPTY_PHOTO_SIGN = 38;
/** Стрелка «назад» над фотографией — 20 в цели 44 (contract → head.back). */
const BACK_SIGN = 20;

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
  /** Ключ пула зоны — знак на месте отсутствующей фотографии. */
  zonePool: string | null;
  /** Прямоугольник зоны в кадре 630×351 — из него режется миниатюра 76×48. */
  zoneRect: ZoneRect | null;
  /** Адрес базового кадра комнаты; `null` — миниатюры не будет. */
  frameUrl: string | null;
  accent: string;
  ink: string;
};

export function ItemCard({
  item,
  hall,
  zones,
  zoneLabel,
  zonePool,
  zoneRect,
  frameUrl,
  accent,
  ink,
}: ItemCardProps) {
  // Действия вещи и строки истории — ns Settings (там же живут «Спрятать»,
  // «Удалить», «В сокровищницу»); подписи полей — ns AddItem: карточка правки
  // говорит теми же словами, что карточка добавления. Строки про цену витрины,
  // «кто её видит» и её собственные действия — ns Hall: они принадлежат
  // сокровищнице, и говорить о ней в двух местах разными словами нельзя.
  //
  // СВОЙ РАЗДЕЛ У КАРТОЧКИ РОВНО ОДИН — ns ItemCard (пакет 48), и в нём одна
  // строка: слово пустой шкалы желания. Общим словарём формы её не покрыть —
  // в форме шкала ВОПРОС, здесь ОТВЕТ (см. ниже, у `DesirePicker`).
  const t = useTranslations("Settings");
  const tField = useTranslations("AddItem");
  const tHall = useTranslations("Hall");
  const tExp = useTranslations("Experience");
  const tCard = useTranslations("ItemCard");
  const locale = useLocale();
  const format = useFormatter();
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
  // Магазины у хозяйки СВЁРНУТЫ в строку (contract → owner.storesCollapsed):
  // три магазина это 200 px ответа на вопрос, которого у неё нет — ссылки
  // положила она сама. Раскрывается нажатием, внутри блок 8b без изменений.
  const [storesOpen, setStoresOpen] = useState(false);
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
  /**
   * ЗНАК ВОЗВРАТА ВЕДЁТ ТУДА, ГДЕ ВЕЩЬ ЖИВЁТ (тикет 243, приёмка 14.08.2026).
   *
   * Раньше он всегда вёл в полку комнаты, и вещь витрины уводила человека на
   * экран, который он не открывал: вход в карточку из сокровищницы один —
   * перо-заметка (`hall-showcase.tsx`), — а выход шёл в полку, оттуда в
   * комнату, и дорога в сокровищницу терялась совсем. Слова владельца:
   * «попадаю не в сокровищницу, а в список всей категории, а потом вообще в
   * комнату. Нелогично».
   *
   * Чинится АДРЕСОМ, а не историей: знак — `<Link href>`, и это верно. История
   * браузера знала бы, откуда пришли, но врала бы при входе по прямой ссылке и
   * после перезагрузки, а место вещи известно всегда.
   *
   * Строка «стоит в „{полка}"» внизу карточки при этом остаётся дорогой в
   * полку — она не «назад», а указание места: вернувшись в комнату, вещь
   * встанет именно туда.
   */
  const backHref = item.inHall ? "/room/hall" : zoneHref;
  const backLabel = item.inHall ? tHall("toHall") : zoneLabel;
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
   * СЛУЧАЙ «БЕЗ ЦЕНЫ И БЕЗ МАГАЗИНА» (contract → cases.noPriceNoStore).
   * Заметка становится ТЕЛОМ карточки: 14.5 вместо 12.5 и .78 вместо .62 —
   * «она заняла место цены и магазинов, потому что здесь именно она отвечает
   * на вопрос». Строк «цена не указана» и «магазины не добавлены» НЕТ:
   * отсутствие цены — не пробел, а способ сказать «любая».
   */
  const noteHoldsCard = !item.inHall && roomPrice === null && !want?.shop;

  /**
   * Число магазинов у вещи РОВНО ОДНО, пока у неё одна ссылка (`canonicalUrl`).
   * Множественное число в строке — от дизайна, который рисовал блок каталога;
   * подставляем настоящее число, а не нарисованное (мультимагазинность живёт
   * за флагом `CATALOG_ENABLED` и сюда не приезжает).
   */
  const storeCount = want?.shop ? 1 : 0;

  /**
   * ГЛАВНОЕ ДЕЙСТВИЕ. По умолчанию «Изменить», в сокровищнице «Записать
   * заметку» (там правят не цену, а память). У вещи КОМНАТЫ БЕЗ ФОТОГРАФИИ —
   * «Добавить фотографию»: contract → cases.noPhoto.ownerAction, «единственный
   * случай, когда „Изменить" уступает главное действие». Витрины это не
   * касается — её полосу занимает «Записать заметку» по решению round41.
   */
  const needsPhoto = !item.inHall && !item.photoUrl;
  const mainActionLabel = needsPhoto
    ? tField("cardAddPhoto")
    : item.inHall
      ? tHall("noteAdd")
      : t("itemEdit");

  /**
   * Загрузка фотографии той же дорогой, что и в карточке добавления: presign →
   * PUT в S3 браузером → экшен получает только ключ. Второго пути к нашему
   * бакету в продукте нет и заводить его не за чем.
   */
  async function onPickPhoto(file: File) {
    setBusy(true);
    setErrorKey(null);
    try {
      const presigned = await presignItemPhotoAction({ contentType: file.type, size: file.size });
      if ("error" in presigned) {
        // Отказы presign говорят своими словами карточки добавления: «больше
        // 10 МБ» и «нужна фотография» — это про файл, а не про вещь.
        setErrorKey(
          presigned.error === "TOO_LARGE"
            ? "errTooLarge"
            : presigned.error === "BAD_TYPE"
              ? "errBadType"
              : presigned.error === "AUTH"
                ? "errAuth"
                : "errGeneric",
        );
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
      const result = await setItemPhotoAction(item.id, presigned.key);
      if (result?.error) {
        setErrorKey(errorToKey(result.error));
        return;
      }
      router.refresh();
    } catch {
      setErrorKey("errGeneric");
    } finally {
      setBusy(false);
    }
  }

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
          // СЛОВО ЗДЕСЬ ИЗ СЛОВАРЯ СОКРОВИЩНИЦЫ — `Hall.delete` = «Удалить
          // насовсем», а не «Удалить» из ns Settings (тикет 179, контракт
          // round42 → `treasuryVariantSheet`). Разница не косметическая: в
          // витрине вещь уже своя, и «насовсем» здесь факт, а не запугивание —
          // тем же словом эта строка подписана на экране витрины, а два экрана
          // одного действия обязаны звать его одинаково.
          key: "delete",
          icon: <IconActionDelete size={SIGN_SIZE} />,
          title: tHall("delete"),
          hint: tHall("deleteHint"),
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
        {/* Фотография 430×352, `cover`; знаки — НАД ней (contract → owner.photo,
            head). БЕЗ ФОТОГРАФИИ высота 236, а не 352 (cases.noPhoto): пустое
            не занимает столько же, сколько полное, — внутри знак пула 38 и
            подпись полки. */}
        <div
          className={[
            s.photo,
            item.photoUrl ? null : s.photoEmpty,
            item.photoUrl && noteHoldsCard ? s.photoShort : null,
          ]
            .filter(Boolean)
            .join(" ")}
          style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}
        >
          {!item.photoUrl && (
            <>
              {zonePool && <PoolIcon pool={zonePool} size={EMPTY_PHOTO_SIGN} />}
              <span className={s.photoEmptyLabel}>{zoneLabel}</span>
            </>
          )}

          {/* ПОДЛОЖКА ПОД ЗНАКАМИ — ТОЛЬКО КОГДА ПОД НИМИ ФОТОГРАФИЯ (тикет
              218). Знаки читаются тенью на тёмных комнатах и пропадают на
              светлой фотографии вещи; на пустом месте фотографии нет вовсе —
              там они стоят на своей заливке .05, и тёмный круг был бы пятном
              на ровном фоне. Числа подложки — в owner-card.module.css.

              КЛАСС РЕШАЕТ И СУДЬБУ ТЕНИ (тикет 221, round48/photo-signs.json):
              где есть подложка — тени нет, где подложки нет — тень остаётся
              единственной защитой. «Одна защита, не две». */}
          <div className={item.photoUrl ? `${s.head} ${s.headOnPhoto}` : s.head}>
            {/* СТРЕЛКА СТАЛА ЗНАКОМ НАБОРА (тикет 169, `ui-back.svg` раунда 41).
                Сутки здесь стояла «←» ТЕКСТОМ: контракт звал знак с round39, а
                файла в наборе не было — своего мы не рисовали (правило тикета
                150), сказали письмом 43 и ждали. Дизайн прислал файл и назвал
                нашу же причину: глифов в интерфейсе быть не должно. Числа те же,
                что и были: знак 20 в цели 44. */}
            <Link href={backHref} aria-label={backLabel} className={`pressable ${s.headSign}`}>
              <IconBack size={BACK_SIGN} />
            </Link>

            {/* «⋯» — 19, общий кегль набора (contract round41 → head.more). Был
                20 своим числом карточки; дизайн привёл его к остальному набору
                молча, седьмой правкой сверх шести объявленных (см. отчёт по
                тикету 170). Своего кегля у карточки не осталось — знак берёт
                `SIGN_SIZE` листа действий. */}
            <span className={s.headActions}>
              <ItemActions rows={sheetRows} moreLabel={t("itemMore")} />
            </span>
          </div>
        </div>

        {/* Одна поверхность: от нижней кромки фото до низа экрана. */}
        <div className={s.surface}>
          <h1 className={noteHoldsCard ? `${s.name} ${s.nameBig}` : s.name}>{item.title}</h1>

          {/* Подпись витрины — «Подарок 2026 года · от Кати», АКЦЕНТОМ. Имя
              видит только хозяйка и только здесь: оно раскрыто один раз на
              «что подарили» (инвариант №2), вещь уже переехала, брони за ним
              нет. Четыре блока витринной вещи сняты (contract →
              cases.treasury.gone) — цена, степень желания, «где купить» и
              бирка: желание исполнено, покупать и бронировать нечего. */}
          {item.inHall && (
            <p className={`${s.caption} ${s.captionAccent}`}>
              {love?.giverName
                ? tHall("captionYearGiver", { year: sinceYear, giver: love.giverName })
                : tHall("captionYear", { year: sinceYear })}
            </p>
          )}

          {item.hidden && <p className={s.caption}>{t("itemHiddenBadge")}</p>}

          {/* ЦЕНА СТОИТ ОДНА, И БЕЗ ЦЕНЫ СТРОКИ НЕТ ВОВСЕ (round41 →
              body.price: «нет цены — нет строки», наше правило принято
              дословно). Огоньки отсюда УШЛИ: мета-строку «цена · огоньки ·
              слово» турна 54c дизайн снял вместе с числами, на которых она
              держалась, — «цель 44 в мета-строку не встаёт» (тикет 225, пакет
              49 → desire-scale-v2.json → layout). Условие видимости здесь
              по-прежнему не спрашивается: хозяйке её цена видна всегда
              (инвариант №8). */}
          {!item.inHall && roomPrice !== null && (
            <div className={s.priceRow}>
              <span className={s.price}>{roomPrice}</span>
            </div>
          )}

          {/* «Цену видят все» — 11 при .5 (contract → owner.order). Строка
              про ГОСТЯ: у `NONE` слова нет вовсе, потому что и адресата нет. */}
          {!item.inHall && roomPrice !== null && want?.priceVisibility !== "NONE" && (
            <p className={s.priceSeen}>{tField(`cardPriceVis${want?.priceVisibility ?? "ALL"}`)}</p>
          )}

          {/* ШКАЛА ЖЕЛАНИЯ — СВОЕЙ СТРОКОЙ ПОД ЦЕНОЙ (тикет 225, пакет 49 →
              round49/desire-scale-v2.json → layout.ownRow), «как в форме».
              Стоит она ПОСЛЕ строки «цену видят все» нарочно: та подпись
              приклеена к цене отрицательным отступом и принадлежит ей, а не
              шкале. У вещи витрины шкалы нет вовсе: желание исполнено.

              ПУСТАЯ ШКАЛА НАЗЫВАЕТ СЕБЯ САМА (тикет 215). Подписи над шкалой
              здесь нет — в отличие от формы добавления, — и у вещи БЕЗ степени
              на экране оставались четыре серых кружка и «не скажу»: слово
              ступени, которое обычно их называет, как раз молчит.

              И ГОВОРИТ ОНА СВОИМИ СЛОВАМИ, А НЕ СЛОВАМИ ФОРМЫ (тикет 221,
              пакет 48 → round48/desire-scale.json). Сутки здесь стояла наша
              `AddItem.desireLabel` («Насколько хочется»), и дизайн снял её
              одним доводом: в форме шкала — ВОПРОС, в карточке — ОТВЕТ, а «не
              скажу» законное значение, а не пустота; вопрос на его месте
              читается приглашением заполнить там, где человек уже ответил.
              Отсюда `ItemCard.desireEmpty` — «не сказано, насколько хочется».
              Ключ не наш: он приехал дельтой пакета вместе с самим разделом.
              Форма по-прежнему не передаёт ничего — у неё свой вопрос сверху. */}
          {!item.inHall && (
            <DesirePicker
              desire={desire}
              accent={accent}
              onPick={onPickDesire}
              disabled={busy}
              emptyLabel={tCard("desireEmpty")}
            />
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

          <hr className={s.divider} />

          {/* Полка — МИНИАТЮРА КАДРА 76×48 и подпись (contract → owner.order).
              Кадр отвечает на вторую половину вопроса хозяйки — «там ли она
              стоит» — тем же куском её интерьера, который она увидит, нажав. */}
          <Link href={zoneHref} className={`pressable ${s.shelfRow}`}>
            <span
              className={s.shelfFrame}
              aria-hidden
              style={
                zoneRect && frameUrl ? shelfFrameBackground(zoneRect, frameUrl) : undefined
              }
            />
            <span className={s.zoneLabel}>{tField("cardShelfLine", { where: zoneLabel })}</span>
          </Link>

          {/* Заметка — СВОИМ БЛОКОМ С НАДСТРОЧНОЙ (contract → changedFrom47a). */}
          {item.note && !editing && (
            <div className={s.noteBlock}>
              <span className={s.noteOverline}>{tField("cardNoteOverline")}</span>
              <p className={noteHoldsCard ? `${s.note} ${s.noteBody}` : s.note}>{item.note}</p>
            </div>
          )}

          {/* «Где купить» СТРОКОЙ — число магазинов и «от {price}» вместо
              одного домена (contract → owner.storesCollapsed). Раскрывается
              нажатием, внутри тот же якорь продукта, что у гостя (тикет 37).
              Место `card` не считается: переходы хозяйки по своей же ссылке —
              не интерес гостей. */}
          {!item.inHall && want?.shop && (
            <>
              <button
                type="button"
                aria-expanded={storesOpen}
                onClick={() => setStoresOpen((open) => !open)}
                className={`pressable ${s.storesRow}`}
              >
                <span>{tField("cardStores", { count: storeCount })}</span>
                {roomPrice !== null && guestSeesPrice(want?.priceVisibility ?? "ALL") && (
                  <span className={s.storesFrom}>
                    {tField("cardStoresFrom", { price: roomPrice })}
                  </span>
                )}
              </button>
              {storesOpen && (
                <ShopLink
                  itemId={item.id}
                  url={want.shop.url}
                  domain={want.shop.domain}
                  place="card"
                />
              )}
            </>
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

              {/* ФОТОГРАФИЯ (тикет 196). Полоса света у вещи без фотографии
                  зовётся «Добавить фотографию» — значит место, где она правда
                  добавляется, обязано быть здесь, а не в карточке добавления.
                  Дорога та же: presign → PUT браузером → экшен с ключом. */}
              <label className={`pressable ${s.photoPick}`}>
                <IconGallery size={17} />
                <span>{item.photoUrl ? tField("photoLabel") : tField("cardAddPhoto")}</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void onPickPhoto(file);
                  }}
                />
              </label>

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
                    {/* ЧТО СКРЫТИЕ ДЕЛАЕТ, А НЕ ЧЕГО НЕ ДЕЛАЕТ (тикет 196,
                        contract round46 → ownerString). Стоит только там, где
                        обещание можно понять неверно: хозяйка прячет цену и
                        вправе думать, что спрятала и дорогу к вещи. Дорога
                        остаётся — цену на ней покажет сам магазин (тикет 195,
                        инвариант №8). */}
                    {!guestSeesPrice(priceVisibility) && (
                      <p className={s.hint}>{tField("priceHiddenPathHint")}</p>
                    )}
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
                <span>{mainActionLabel}</span>
                <span className={s.mainActionGo} aria-hidden>
                  →
                </span>
              </button>
            )
          )}

          {/* «Стоит в комнате с 3 августа» — 11 при .48, последней строкой
              (contract → owner.order). У подарка это год, когда он дошёл. */}
          {!editing && (
            <p className={s.since}>
              {tField("cardAddedOn", {
                date: format.dateTime(new Date(love?.receivedAt ?? item.createdAt), {
                  day: "numeric",
                  month: "long",
                }),
              })}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
