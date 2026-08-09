"use client";

// Флоу добавления вещи (тикет 04, турн 8). Шаг 1 — вопрос «Что это для
// тебя?» ВМЕСТО кнопки «добавить в вишлист» (items.json → whereAsked):
// две панели показывают ОДНО место комнаты человека в двух состояниях —
// кроп базового кадра вокруг зоны, куда вещь встанет (тикет 27, турн 23a).
// Шаг 2 — форма по состоянию: у WANT цена
// с валютой и видимостью, размер/цвет/степень желания; у LOVE подпись
// «уже моё» или даритель+год — цены в форме нет вовсе.
// Фото грузится напрямую в MinIO/S3 по pre-signed PUT, в createItem уходит
// только photoKey. Сохранение — «полоса света», после — redirect в зону.
//
// Добавление по ссылке (тикет 06): вставил URL (или нажал «Заполнить по
// ссылке») → POST /api/v1/parse → ответ раскладывается в ПУСТЫЕ поля формы
// (занятые руками не трогаются), зона-подсказка встаёт с бейджем, фото
// магазина показывается превью и скачивается воркером в своё S3 после
// сохранения. Дубликат по canonicalUrl — жёлтое предупреждение, не запрет.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import { preload } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { sceneMotion, type ZoneRect } from "@/config/design";
import { IconGallery } from "@/components/icons";
import { isExperienceZone } from "@/server/dto/experience";
import { useMediaQuery } from "@/components/scene/use-media-query";
import type { ParsedProduct } from "@/server/parser";
import type { DuplicateItem } from "@/server/services/items";
import { checkDuplicateAction, createItemAction, presignItemPhotoAction } from "./actions";
import { stateChoiceMs, stateChoicePanels, type ItemState } from "./state-choice";
import s from "./add-item.module.css";

export type ZoneOption = { key: string; label: string; rect: ZoneRect };

const REDUCED_MQ = "(prefers-reduced-motion: reduce)";

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
  /** true — зону выбрал пользователь ссылкой ?zone=…; подсказка парсера её не двигает. */
  zonePreselected?: boolean;
  /**
   * Пришли с витрины сокровищницы (?hall=1, тикет 89): вещь сразу «люблю» и
   * сразу на витрине. Шага «что это для тебя» нет — выбор состояния владелец
   * велел не показывать вовсе: то, что кладут в сокровищницу, уже своё.
   */
  toHall?: boolean;
  /** Куда уводит выход из карточки: зона, из которой пришли, или комната. */
  exitHref: string;
  /** Базовый кадр комнаты — из него режется кроп выбора состояния (тикет 27). */
  roomImage: string;
  /** Акцент/ink комнаты из rooms.json. */
  accent: string;
  ink: string;
};

export function AddItemFlow({
  zones,
  initialZone,
  zonePreselected = false,
  toHall = false,
  exitHref,
  roomImage,
  accent,
  ink,
}: AddItemFlowProps) {
  const t = useTranslations("AddItem");
  const tExp = useTranslations("Experience");
  const router = useRouter();

  // С витрины экран начинается сразу с формы «люблю»: состояние выбрано за
  // человека, потому что другого у сокровищницы не бывает (тикет 89).
  const [state, setState] = useState<ItemState | null>(toHall ? "LOVE" : null);
  /**
   * Что выбрано на шаге 1. Живёт отдельно от `state`: «← Назад» возвращает к
   * вопросу, и панель обязана помнить ответ — иначе состояний «выбрано» и
   * «не выбрано» на экране не существует вовсе.
   */
  const [picked, setPicked] = useState<ItemState | null>(null);

  // Общие поля обеих форм.
  const [title, setTitle] = useState("");
  const [zone, setZone] = useState(initialZone);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Добавление по ссылке (тикет 06).
  const [parsing, setParsing] = useState(false);
  /** URL, из которого карточка заполнилась (успешный parse) → source=URL. */
  const [parsedUrl, setParsedUrl] = useState<string | null>(null);
  const [parseErrorKey, setParseErrorKey] = useState<string | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  /** Фото магазина: превью хотлинком только в браузере хозяйки; в S3 его скачает воркер. */
  const [storeImageUrl, setStoreImageUrl] = useState<string | null>(null);
  const [zoneSuggested, setZoneSuggested] = useState(false);
  /** Пользователь выбрал зону сам (руками или ?zone=…) — подсказка её не перетирает. */
  const [zoneTouched, setZoneTouched] = useState(zonePreselected);
  const [duplicate, setDuplicate] = useState<DuplicateItem | null>(null);

  // WANT.
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<string>("RUB");
  const [priceVisibility, setPriceVisibility] = useState<PriceVisibility>("ALL");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  // Услуга-впечатление (тикет 97): у зоны «Впечатления» вместо размера и
  // цвета спрашивается «Когда · Где · Годен до» — у мастер-класса нет
  // размера, а у сертификата есть срок.
  const [eventWhen, setEventWhen] = useState("");
  const [eventWhere, setEventWhere] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [desire, setDesire] = useState<number | null>(null);

  // LOVE.
  const [loveKind, setLoveKind] = useState<LoveKind>("mine");
  const [giverName, setGiverName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Зона впечатлений спрашивает другое — правило по зоне, не по галочке. */
  const experience = isExperienceZone(zone);

  const reducedMotion = useMediaQuery(REDUCED_MQ);
  /** Название — единственное обязательное поле; без него сохранять нечего. */
  const canSave = title.trim() !== "";
  const saveHintId = useId();

  // Кадр комнаты живёт CSS-фоном: сканер браузера его не видит, и без preload
  // загрузка стартовала бы только после гидрации (то же решение, что в сцене).
  preload(roomImage, { as: "image", fetchPriority: "high" });

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
    // prefers-reduced-motion: переход не убивается в ноль — 120 мс, смена
    // состояния остаётся читаемой (motion.json → reducedMotion.transitions).
    "--ai-reduced-ms": `${sceneMotion.reducedTransitionMs}ms`,
  } as CSSProperties;

  // Парсер может вернуть валюту вне малого набора формы (KGS, KZT…) —
  // дорисовываем её в options, чтобы select честно показывал выбранное.
  const currencyOptions: ReadonlyArray<{ code: string; label: string }> = CURRENCIES.some(
    (option) => option.code === currency,
  )
    ? CURRENCIES
    : [...CURRENCIES, { code: currency, label: currency }];

  // Esc на шаге выбора уводит туда же, куда «В комнату» (приёмка п.1).
  // На шаге формы Esc намеренно не слушаем: терять заполненное одной
  // случайной клавишей нельзя — оттуда выходят осознанно, ссылкой.
  useEffect(() => {
    if (state !== null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.push(exitHref);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state, router, exitHref]);

  // Выбор виден ровно столько, сколько длится переход контракта (240 мс, при
  // выключенном движении 120): панель успевает зажечь полосу света и погасить
  // соседнюю до того, как экран сменится формой. Дольше — уже задержка.
  const holdRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (holdRef.current !== null) window.clearTimeout(holdRef.current);
    },
    [],
  );

  function pickState(next: ItemState) {
    if (holdRef.current !== null) return; // повторный тап по дороге игнорируем
    setPicked(next);
    setErrorKey(null);
    holdRef.current = window.setTimeout(
      () => {
        holdRef.current = null;
        setState(next);
      },
      reducedMotion ? sceneMotion.reducedTransitionMs : stateChoiceMs,
    );
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

  // ---------- Заполнение по ссылке (тикет 06) ----------

  /**
   * Мерж ответа парсера в форму: ПУСТЫЕ поля заполняются, занятые руками не
   * трогаются (начальные значения, а не перезапись). Валюта ходит парой к
   * цене: подставляется только вместе с ней.
   */
  function applyParsed(product: ParsedProduct) {
    if (title.trim() === "" && product.title) setTitle(product.title);
    if (price.trim() === "" && product.price) {
      setPrice(product.price);
      if (product.currency) setCurrency(product.currency);
    }
    if (note.trim() === "" && product.description) setNote(product.description);
    if (
      product.zoneHint &&
      !zoneTouched &&
      zones.some((option) => option.key === product.zoneHint)
    ) {
      setZone(product.zoneHint);
      setZoneSuggested(true);
    }
    if (product.imageUrl && !file) setStoreImageUrl(product.imageUrl);
    setLowConfidence(product.confidence < 0.4);
  }

  /** Дедуп-подсказка по canonicalUrl своей комнаты; ошибки молча гасятся. */
  async function runDupCheck(candidate: string) {
    try {
      const { duplicate: found } = await checkDuplicateAction({ url: candidate });
      setDuplicate(found);
    } catch {
      setDuplicate(null);
    }
  }

  /** POST /api/v1/parse: лоадер «Читаем страницу…», ответ — в пустые поля. */
  async function runParse(candidate: string) {
    const target = candidate.trim();
    if (target === "" || parsing) return;
    setParsing(true);
    setParseErrorKey(null);
    try {
      const response = await fetch("/api/v1/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      if (response.status === 422) {
        setParseErrorKey("errParseUrl");
        return;
      }
      if (response.status === 429) {
        setParseErrorKey("errParseRate");
        return;
      }
      if (!response.ok) {
        setParseErrorKey("errGeneric");
        return;
      }
      const payload = (await response.json()) as { data: ParsedProduct };
      applyParsed(payload.data);
      setParsedUrl(target);
      void runDupCheck(payload.data.canonicalUrl || target);
    } catch {
      setParseErrorKey("errGeneric");
    } finally {
      setParsing(false);
    }
  }

  /** Авто-подхват: вставили полноценный http(s)-URL — читаем страницу сами. */
  function onUrlPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text").trim();
    if (/^https?:\/\/\S+$/i.test(text) && text !== parsedUrl) void runParse(text);
  }

  function buildInput(photoKey: string | undefined) {
    // source=URL — карточка родилась из ссылки (успешный parse) и ссылка
    // всё ещё в поле; canonicalUrl/domain посчитает сервер (createItem).
    const fromUrl = parsedUrl !== null && url.trim() !== "";
    const common = {
      zone,
      title: title.trim(),
      note: note.trim() || undefined,
      url: url.trim() || undefined,
      photoKey,
      source: fromUrl ? ("URL" as const) : ("MANUAL" as const),
      // Фото магазина скачает воркер (image.ingest); своё фото приоритетнее.
      imageUrl: fromUrl && !photoKey && storeImageUrl ? storeImageUrl : undefined,
    };
    if (state === "WANT") {
      return {
        state: "WANT" as const,
        ...common,
        price: price.trim(),
        currency,
        priceVisibility,
        // Поля зависят от зоны, а не от галочки: впечатление отличается от
        // предмета местом в комнате, и лишние ключи Zod отбросит сам.
        ...(experience
          ? {
              eventWhen: eventWhen.trim() || undefined,
              eventWhere: eventWhere.trim() || undefined,
              validUntil: validUntil || undefined,
            }
          : { size: size.trim() || undefined, color: color.trim() || undefined }),
        desire: desire ?? undefined,
      };
    }
    return {
      state: "LOVE" as const,
      ...common,
      // Заводили с витрины — вещь встаёт на неё сразу (тикет 89). Ключ есть
      // только у LOVE: у «хочу» его в схеме нет вовсе.
      ...(toHall ? { inHall: true } : {}),
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
    // Сохранять нечего, пока у вещи нет названия. Кнопка при этом остаётся в
    // обходе с клавиатуры (aria-disabled, а не disabled) — иначе причину
    // «почему не жмётся» скринридеру никто не расскажет.
    if (saving || !canSave) return;
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
    // Кроп берётся из зоны, куда вещь попадёт: выбранной руками на форме, а
    // пока не выбрана — из `?zone=…` или первой видимой зоны комнаты. Зона
    // меняется на шаге 2 — вернувшись «Назад», человек видит уже новое место.
    const cropZone = zones.find((option) => option.key === zone)?.rect ?? null;

    return (
      <main className={`${s.root} mx-auto min-h-screen w-full max-w-xl px-6 py-10`} style={style}>
        {/* Тихий выход в шапке: путь назад виден, но не спорит с двумя панелями. */}
        <nav className={s.nav}>
          <Link href={exitHref} className={`pressable ${s.navLink}`}>
            ← {t("backToRoom")}
          </Link>
        </nav>

        <p className="overline mt-6 text-text-muted">{t("overline")}</p>
        <h1 className="display mt-3 text-3xl md:text-4xl">{t("question")}</h1>

        <div className={s.tileGrid}>
          {stateChoicePanels(cropZone).map((panel) => {
            const chosen = picked === panel.state;
            // Пока не выбрано ничего — обе панели в покое: приглушать соседнюю
            // не за что. Числа приглушения и подсветки — tokens.css.
            const tone = picked === null ? "" : chosen ? ` ${s.tileOn}` : ` ${s.tileDim}`;
            const art = panel.ghost ? `${s.tileArt} ${s.tileArtWant}` : s.tileArt;
            return (
              <button
                key={panel.state}
                type="button"
                aria-pressed={chosen}
                className={`pressable ${s.tile}${tone}`}
                onClick={() => pickState(panel.state)}
                style={
                  panel.crop
                    ? ({
                        "--sc-image": `url(${roomImage})`,
                        "--sc-size": panel.crop.size,
                        "--sc-pos": panel.crop.position,
                        "--sc-l": `${panel.crop.spot.left}%`,
                        "--sc-t": `${panel.crop.spot.top}%`,
                        "--sc-w": `${panel.crop.spot.width}%`,
                        "--sc-h": `${panel.crop.spot.height}%`,
                        "--sc-cx": `${panel.crop.spot.left + panel.crop.spot.width / 2}%`,
                        "--sc-cy": `${panel.crop.spot.top + panel.crop.spot.height / 2}%`,
                      } as CSSProperties)
                    : undefined
                }
              >
                {/* Один и тот же кусок интерьера в обеих панелях; у «хочу»
                    предмет заменён призрачным контуром — это состояние вещи,
                    а НЕ отсутствие фотографии (инвариант №3). */}
                <span className={art} aria-hidden>
                  {panel.crop && <span className={s.tileCrop} />}
                  <span className={s.tileLight} />
                  {panel.ghost && (
                    <>
                      <span className={s.ghostBox} />
                      <span className={s.ghostBar} />
                    </>
                  )}
                </span>
                <span className={s.tileBar} aria-hidden />
                <span className={s.tileLabel}>
                  {panel.state === "LOVE" ? t("loveLabel") : t("wantLabel")}
                </span>
                <span className={s.tileHint}>
                  {panel.state === "LOVE" ? t("loveHint") : t("wantHint")}
                </span>
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  // ---------- Шаг 2: форма состояния ----------

  return (
    <main className={`${s.root} mx-auto min-h-screen w-full max-w-xl px-6 py-10`} style={style}>
      {/* Два пути назад: к вопросу «что это для тебя» (введённое остаётся —
          компонент не размонтируется) и совсем из карточки. */}
      <nav className={s.nav}>
        {/* С витрины возвращаться некуда: шага «что это для тебя» не было. */}
        {!toHall && (
          <button type="button" onClick={() => setState(null)} className={`pressable ${s.navLink}`}>
            ← {t("back")}
          </button>
        )}
        <Link href={exitHref} className={`pressable ${s.navLink} ${s.navExit}`}>
          {toHall ? t("backToHall") : t("backToRoom")}
        </Link>
      </nav>

      <p className="overline mt-6 text-text-muted">{t("overline")}</p>
      <h1 className="display mt-3 text-3xl md:text-4xl">
        {toHall ? t("hallLabel") : state === "WANT" ? t("wantLabel") : t("loveLabel")}
      </h1>
      <p className="mt-2 text-sm text-text-muted">
        {toHall ? t("hallHint") : state === "WANT" ? t("wantHint") : t("loveHint")}
      </p>

      <form onSubmit={(event) => void onSubmit(event)} className="mt-8 flex flex-col gap-5">
        {/* Ссылка — точка входа «добавить по URL» (тикет 06): вставка
            валидного URL парсит сама, кнопка — для набранного руками. */}
        <div>
          <span className={s.fieldLabel}>{t("urlLabel")}</span>
          <div className={s.urlRow}>
            <input
              className={s.input}
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setParseErrorKey(null);
              }}
              onPaste={onUrlPaste}
              onBlur={() => {
                if (url.trim() !== "") void runDupCheck(url);
              }}
              placeholder={t("urlPlaceholder")}
            />
            <button
              type="button"
              className={`pressable ${s.fillBtn}`}
              onClick={() => void runParse(url)}
              disabled={parsing || url.trim() === ""}
              aria-busy={parsing}
            >
              {parsing ? t("parsing") : t("fillFromUrl")}
            </button>
          </div>
          {/* Доска В13 (турн 8a): список магазинов снимает недоверие к полю —
              человек не знает, что вставлять, пока не увидит знакомое имя.
              Магазины названы НЕ с потолка: ровно на этих шести страницах
              парсер проверен фикстурами (src/server/parser/__fixtures__).
              Доска перечисляла четыре — у нас их шесть, и «любой другой
              сайт» тоже правда: разбор общий, а не по магазинам. */}
          {!parseErrorKey && <p className={s.softNote}>{t("urlShops")}</p>}
          {parseErrorKey && <p className={s.parseError}>{t(parseErrorKey)}</p>}
          {!parseErrorKey && lowConfidence && <p className={s.softNote}>{t("parsedLow")}</p>}
          {duplicate && (
            <p className={s.dupWarn} role="status">
              {t("dupWarn", { title: duplicate.title })}{" "}
              <a className={s.dupLink} href={`/room/zone/${duplicate.zone}`}>
                {t("dupOpen")}
              </a>
            </p>
          )}
        </div>

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
          <span className={s.fieldLabel}>
            {t("zoneLabel")}
            {zoneSuggested && <span className={s.hintBadge}>{t("zoneSuggested")}</span>}
          </span>
          <select
            className={s.input}
            required
            value={zone}
            onChange={(event) => {
              setZone(event.target.value);
              setZoneTouched(true);
              setZoneSuggested(false);
            }}
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
                  {currencyOptions.map((option) => (
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

            {experience ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className={s.fieldLabel}>{tExp("when")}</span>
                    <input
                      className={s.input}
                      type="text"
                      maxLength={80}
                      value={eventWhen}
                      onChange={(event) => setEventWhen(event.target.value)}
                      placeholder={t("whenPlaceholder")}
                    />
                  </label>
                  <label>
                    <span className={s.fieldLabel}>{tExp("where")}</span>
                    <input
                      className={s.input}
                      type="text"
                      maxLength={80}
                      value={eventWhere}
                      onChange={(event) => setEventWhere(event.target.value)}
                      placeholder={t("wherePlaceholder")}
                    />
                  </label>
                </div>
                <label>
                  <span className={s.fieldLabel}>{tExp("validUntil")}</span>
                  <input
                    className={s.input}
                    type="date"
                    value={validUntil}
                    onChange={(event) => setValidUntil(event.target.value)}
                  />
                </label>
              </>
            ) : (
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
            )}

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
          {file === null && storeImageUrl && (
            <div className={`${s.photoPreviewRow} ${s.storePhotoRow}`}>
              {/* Превью хотлинком живёт только в браузере хозяйки до сохранения;
                  в комнату попадёт копия из нашего S3 (image.ingest). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={storeImageUrl}
                alt=""
                referrerPolicy="no-referrer"
                className={s.photoThumb}
              />
              <span className={s.photoName}>{t("storePhoto")}</span>
              <button
                type="button"
                className={`pressable ${s.photoRemove}`}
                onClick={() => setStoreImageUrl(null)}
              >
                {t("storePhotoRemove")}
              </button>
            </div>
          )}
          {file === null ? (
            <label className={`pressable ${s.photoDrop}`}>
              {/* «Из галереи» с доски (турн 24, 23a) — наша рамка с кружком
                  заменена по списку тикета 51 (тикет 52). */}
              <IconGallery size={17} />
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

        {errorKey && <p className={s.error}>{t(errorKey)}</p>}

        {/* Главная кнопка выключена, пока нечего сохранять (турн 23a): серая
            полоса вместо светящейся, и подпись рядом называет причину. Это
            другое состояние кнопки, а не та же кнопка потише. */}
        <div className="sticky bottom-0 -mx-6 bg-surface-app-ground px-6 pb-8 pt-4">
          <button
            type="submit"
            disabled={saving}
            aria-disabled={!canSave}
            aria-describedby={canSave ? undefined : saveHintId}
            className={canSave ? `pressable ${s.lightBar}` : s.lightBar}
          >
            {saving ? t("saving") : `${t("save")} →`}
          </button>
          {!canSave && (
            <p id={saveHintId} className={s.saveHint}>
              {t("saveHint")}
            </p>
          )}
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
