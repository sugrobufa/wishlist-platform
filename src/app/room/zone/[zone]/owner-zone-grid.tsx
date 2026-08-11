"use client";

// Зона глазами ХОЗЯЙКИ — СТРОКАМИ (турн 29b, тикет 88): миниатюра, название,
// чип состояния, цена, кружок выбора слева. Прежде здесь была сетка плиток
// (тикет 03); строка отдаёт название, состояние и цену одним взглядом, а
// плитка прячет цену под картинку — ради взгляда экран и затевался (тот же
// довод, что у экрана «вся комната списком», турн 29a).
//
// Плитки никуда не делись: ими живут панель зоны в сцене и гостевой вид.
// Строки — вид ЭТОГО экрана, а не замена `ZoneGrid`.
//
// ДЕЙСТВИЯ ВЕЩИ — ОДИН ЗНАК, А НЕ СТЕНА ТЕКСТА (тикет 123, турн 36b; тикет
// 152 свёл два знака к одному). Раньше под каждой вещью стояло в строку
// «Изменить · Уже моё · Спрятать · Удалить»: пять вещей — двадцать слов
// действий на экране, и владелец на приёмке 09.08 попросил это прекратить.
// Дальше на виду остались карандаш и «⋯» — и в строке 52 карандаша не стало
// тоже: контракт списка зоны говорит «знак в конце ОДИН», а точка входа в
// вещь — САМА СТРОКА, теперь по-настоящему (она ссылка).
//
// Слот заполняется только у своих вещей: у демо-призраков меню нет — они не
// в БД. «Бирки» здесь нет и не будет — она ровно одна, «подарить» у гостя
// (турн 22). Обратного пути LOVE → WANT в меню нет и не появится (инвариант №2).
import { useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  IconActionDelete,
  IconActionReturn,
  IconActionTreasury,
  IconCheck,
  IconEye,
  IconEyeOff,
} from "@/components/icons";
import { ItemActions, SIGN_SIZE, type ItemActionRow } from "@/components/item/item-actions";
import { tileAppearance } from "@/components/zone/tile-appearance";
// Строка ЭТОГО экрана — 52 px по своему контракту (handoff/zone-row.json,
// тикет 152). Прежде экран брал строку у «комнаты списком» и добавлял к ней
// знаки: имени оставалось 71 px на 375. Общая строка при этом не трогается
// вовсе — у «комнаты списком» своя форма в том же вердикте пакета.
import { ZoneRow } from "@/components/zone-row/zone-row";
import zr from "@/components/zone-row/zone-row.module.css";
import type { ZoneGridItem } from "@/components/zone/types";
import {
  deleteItemAction,
  setItemHiddenAction,
  setItemsHiddenAction,
  toggleHallAction,
} from "./actions";

/** Owner-DTO несёт inHall у любой вещи; общий контракт сетки его не требует. */
type OwnerGridItem = ZoneGridItem & { inHall?: boolean };

type OwnerZoneGridProps = {
  items: OwnerGridItem[];
  accent: string;
  /**
   * ink комнаты экрану больше не нужен: с переходом на строки (тикет 88)
   * активной вкладки, где текст ложился на акцент, здесь не осталось. Проп
   * оставлен в контракте, чтобы страница не переписывалась ради одной строки.
   */
  ink?: string;
  /** Ключ зоны — из него собирается адрес карточки вещи (тикет 39). */
  zoneKey: string;
  /**
   * Подпись зоны — её называет подсказка «Вернуть в комнату»: «встанет в свою
   * зону — в „{zone}"» (тикет 184). Приходит пропом, а не считается здесь:
   * ярлык зоны живёт в `zones.json` и его уже посчитала страница.
   */
  zoneLabel: string;
  /** Пул зоны — значок вместо буквы у вещи без фото (тикет 82). */
  pool?: string | null;
};

/** Двухшаговые подтверждения: удаление и переезд в сокровищницу. */
type Confirming = { id: string; kind: "delete" | "toHall" };

/** Цена строкой: «14 900 ₽». Деньги в DTO — строка Decimal (CLAUDE.md). */
function formatPrice(item: ZoneGridItem, locale: string): string | null {
  if (item.inHall === true || item.price == null) return null;
  const value = Number(item.price);
  if (!Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: item.currency ?? "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${item.price} ${item.currency ?? ""}`.trim();
  }
}

/** Чипы порядка из турна 29b. `hidden` — не порядок, а фильтр, чип общий. */
type Sort = "date" | "price" | "hidden";

// «В сокровищницу» — ОДНО действие и один сервис (тикет 124): дороги через
// «уже моё» больше нет, состояний не осталось. Действие доступно у любой вещи
// и отвечает одинаково независимо от того, занята она или нет.

export function OwnerZoneGrid({ items, accent, zoneKey, zoneLabel, pool }: OwnerZoneGridProps) {
  const t = useTranslations("Settings");
  // Слова СОКРОВИЩНИЦЫ — из её раздела (тикет 184): «Вернуть в комнату» и её
  // подсказка принадлежат витрине, и говорить о ней в трёх местах разными
  // словами нельзя.
  const tHall = useTranslations("Hall");
  const tl = useTranslations("ZoneList");
  const tg = useTranslations("ZoneGrid");
  const locale = useLocale();
  const router = useRouter();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  // Турн 29b: порядок чипами и массовое скрытие галочками (тикет 74).
  // Чип «по дате» несёт НАПРАВЛЕНИЕ: второй нажим переворачивает.
  const [sort, setSort] = useState<Sort>("date");
  const [dateAsc, setDateAsc] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  /**
   * Порядок ПЕРЕОПРЕДЕЛЯЕТ дефолт, а не меняет его (условие тикета): пришедший
   * с сервера порядок — `compareZoneItems` контракта тикета 03, и он остаётся
   * тем, что человек видит, пока не тронул чипы.
   *
   * «По цене» молчит там, где цены нет: у «люблю» и у «хочу» со скрытой ценой
   * `price` в DTO уже `null` (правило слоя DTO, своего не заводим) — такие
   * вещи уходят в конец, сохраняя между собой прежний порядок.
   */
  const shown = useMemo(() => {
    const list = [...items];
    if (sort === "hidden") return list.filter((item) => (item as OwnerGridItem).hidden === true);
    if (sort === "price") {
      return list.sort((first, second) => {
        const a = first.price == null ? null : Number(first.price);
        const b = second.price == null ? null : Number(second.price);
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return a - b;
      });
    }
    return list.sort((first, second) => {
      const a = Date.parse(String(first.createdAt ?? "")) || 0;
      const b = Date.parse(String(second.createdAt ?? "")) || 0;
      return dateAsc ? a - b : b - a;
    });
  }, [items, sort, dateAsc]);

  const pickable = shown.filter((item) => !item.isDemo);
  const pickedHere = pickable.filter((item) => picked.has(item.id)).length;

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hidePicked = () => {
    const ids = pickable.filter((item) => picked.has(item.id)).map((item) => item.id);
    if (ids.length === 0) return;
    setFailed(false);
    startTransition(async () => {
      const result = await setItemsHiddenAction(ids, true);
      if (result?.error) {
        setFailed(true);
        return;
      }
      setPicked(new Set());
      setPicking(false);
      router.refresh();
    });
  };

  function run(itemId: string, action: () => Promise<{ error: string } | undefined>) {
    setBusyId(itemId);
    setFailed(false);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      setConfirming(null);
      if (result?.error) {
        setFailed(true);
        return;
      }
      // Страница force-dynamic: refresh дотягивает свежие данные с сервера.
      router.refresh();
    });
  }

  /**
   * Лист «⋯» комнаты — ровно три строки (36b): В сокровищницу · Спрятать ·
   * Удалить. Первая строка — переключатель: вещь уже на витрине, значит её
   * оттуда возвращают. Опасное действие стоит последним и тихой строкой,
   * подтверждение спрашивается здесь же, под строкой вещи.
   */
  const sheetRows = (item: ZoneGridItem): ItemActionRow[] => {
    // Каст честный: сюда приходят те же объекты, что в items (OwnerGridItem).
    const inHall = (item as OwnerGridItem).inHall === true;

    const treasury: ItemActionRow = inHall
      ? {
          // ОДНО ДЕЙСТВИЕ — ОДНО СЛОВО (тикет 184). Здесь стояло «Убрать из
          // сокровищницы» — формулировка ОТ РЕШЕНИЯ ДО 09.08.2026, когда у
          // вещи были состояния. Тогда владелец их отменил, и место стало
          // обратимым: «Вернуть в комнату» — язык нового решения, он записан в
          // CLAUDE.md и в инварианте №2. Прежнее слово описывало то же
          // движение с другой стороны и читалось как удаление из коллекции, а
          // не как возвращение домой.
          //
          // Строки — те же, что на витрине (`hall-showcase`) и в карточке вещи
          // (`item-card`): `Hall.remove` и её подсказка. Одно действие не может
          // зваться на трёх экранах по-разному — тот же довод, которым тикет
          // 179 свёл «Удалить насовсем».
          key: "treasury",
          icon: <IconActionReturn size={SIGN_SIZE} />,
          title: tHall("remove"),
          hint: tHall("removeHint", { zone: zoneLabel }),
          onSelect: () => run(item.id, () => toggleHallAction(item.id, false)),
        }
      : {
          key: "treasury",
          icon: <IconActionTreasury size={SIGN_SIZE} />,
          title: t("itemHallAdd"),
          hint: t("itemHallAddHint"),
          // Вопрос перед переездом общий и ПРО ВЕЩЬ, а не про бронь: он
          // одинаков у всех вещей, и по нему нельзя догадаться, занята эта
          // или нет (инвариант №1).
          onSelect: () => setConfirming({ id: item.id, kind: "toHall" }),
        };

    return [
      treasury,
      {
        key: "hide",
        icon: item.hidden ? <IconEye size={SIGN_SIZE} /> : <IconEyeOff size={SIGN_SIZE} />,
        title: item.hidden ? t("itemShow") : t("itemHide"),
        hint: item.hidden ? t("itemShowHint") : t("itemHideHint"),
        onSelect: () => run(item.id, () => setItemHiddenAction(item.id, !item.hidden)),
      },
      {
        key: "delete",
        icon: <IconActionDelete size={SIGN_SIZE} />,
        title: t("itemDelete"),
        hint: t("itemDeleteHint"),
        danger: true,
        onSelect: () => setConfirming({ id: item.id, kind: "delete" }),
      },
    ];
  };

  /**
   * Знак в конце ОДИН — «⋯», за ним лист (контракт zone-row.json). Главного
   * знака нет: дорога в карточку вещи — сама строка. У демо-призраков нет и
   * этого: их не спрятать и не удалить, они не в БД.
   *
   * Кегля своего строка больше не просит: контракт исправил описку 20 → 19, а
   * 19 и есть общий `SIGN_SIZE` набора. Коробка знака (32) по-прежнему её —
   * она приходит переменной `--sign-box` из `zone-row.module.css`.
   */
  const renderItemAction = (item: ZoneGridItem): ReactNode => {
    if (item.isDemo) return null;
    return (
      <ItemActions rows={sheetRows(item)} moreLabel={t("itemMore")} disabled={busyId === item.id} />
    );
  };

  /** Двухшаговое согласие: удаление и переезд вещи на витрину. */
  const renderConfirm = (item: ZoneGridItem, kind: Confirming["kind"]): ReactNode => {
    const busy = busyId === item.id;
    const isDelete = kind === "delete";
    return (
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
        {/* Вопрос про ПЕРЕЕЗД, а не про состояние (тикет 124): «Перевести в
            „люблю“? Обратно пути нет» врало дважды — состояний не осталось, а
            дорога назад есть и называется «Вернуть в комнату». Вопрос при этом
            остался: переезд молча снимает бронь, и спросить один раз честно.
            Он одинаков у ЛЮБОЙ вещи — по нему нельзя догадаться, занята она
            или нет (инвариант №1). */}
        <span className="text-text-muted">
          {isDelete ? t("itemDeleteConfirm") : t("itemHallAddConfirm")}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(item.id, () =>
              isDelete ? deleteItemAction(item.id) : toggleHallAction(item.id, true),
            )
          }
          className="pressable font-semibold text-text-strong disabled:opacity-60"
        >
          {isDelete ? t("itemDeleteYes") : t("itemHallAddYes")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(null)}
          className="pressable font-semibold text-text-muted disabled:opacity-60"
        >
          {t("itemDeleteNo")}
        </button>
      </div>
    );
  };

  const chip = (key: Sort, label: string, onClick: () => void) => (
    <button
      type="button"
      aria-pressed={sort === key}
      onClick={onClick}
      className="pressable btn-quiet"
      style={sort === key ? ({ "--pill-accent": accent } as CSSProperties) : undefined}
    >
      {label}
    </button>
  );

  return (
    <>
      {failed && <p className="mb-3 text-sm text-text-muted">{t("errGeneric")}</p>}

      {/* Порядок и выбор (турн 29b). Чип «по дате» несёт указатель направления
          и переворачивается на второй нажим — как на макете. */}
      <div
        className="mb-4 flex flex-wrap items-center gap-3"
        role="group"
        aria-label={tl("sortAria")}
      >
        {chip("date", `${tl("sortDate")} ${dateAsc ? "↑" : "↓"}`, () =>
          sort === "date" ? setDateAsc((value) => !value) : setSort("date"),
        )}
        {chip("price", tl("sortPrice"), () => setSort("price"))}
        {chip("hidden", tl("sortHidden"), () => setSort("hidden"))}
        <span className="text-xs text-text-muted">
          {tl("counts", { total: pickable.length })}
          {picking && pickedHere > 0 ? ` · ${tl("selected", { count: pickedHere })}` : ""}
        </span>
        <button
          type="button"
          onClick={() => {
            setPicking((value) => !value);
            setPicked(new Set());
          }}
          className="pressable btn-quiet ml-auto"
        >
          {picking ? tl("selectDone") : tl("select")}
        </button>
      </div>

      {/* СТРОКИ 52 — своя форма экрана зоны (контракт handoff/zone-row.json,
          тикет 152). Прежде вид брался у «комнаты списком» и обрастал знаками;
          у той в том же вердикте пакета своя форма, и она осталась прежней. */}
      <ul className={zr.rows}>
        {shown.map((item) => {
          const look = tileAppearance(item, pool);
          const price = formatPrice(item, locale);
          const on = picked.has(item.id);
          return (
            <ZoneRow
              key={item.id}
              // Дорога в вещь — сама строка. У демо-призрака её нет: карточки
              // у него не существует, он не в БД. В режиме выбора строка тоже
              // не ведёт никуда — палец там занят галочками.
              href={
                item.isDemo || picking ? undefined : `/room/zone/${zoneKey}/i/${item.id}`
              }
              title={item.title}
              photoUrl={item.photoUrl}
              poolIcon={look.poolIcon}
              monogram={look.monogram}
              price={price}
              desire={item.desire}
              accent={accent}
              hidden={item.hidden}
              // Кружок выбора СЛЕВА — как на макете. У демо-призрака его нет:
              // его не спрятать, он не в БД.
              leading={
                picking && !item.isDemo ? (
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={tl("selectAria", { title: item.title })}
                    onClick={() => togglePicked(item.id)}
                    className="pressable btn-quiet flex-none"
                    style={on ? ({ "--pill-accent": accent } as CSSProperties) : undefined}
                  >
                    {on ? (
                      <IconCheck size={14} strokeWidth={2.4} />
                    ) : (
                      <span className="block h-3.5 w-3.5" />
                    )}
                  </button>
                ) : undefined
              }
              trailing={picking ? undefined : renderItemAction(item)}
            >
              {/* Вопрос — ПОД строкой: он длиннее её и в фиксированные 52 не
                  помещается. */}
              {!picking && confirming?.id === item.id && renderConfirm(item, confirming.kind)}
            </ZoneRow>
          );
        })}
      </ul>
      {/* Пусто по двум разным причинам, и путать их нельзя: в зоне нет вещей
          вовсе — «Добавь первое желание»; включён чип «скрытые», а скрытых нет
          — так и говорим. Прежде вторую половину подписывал `emptyLove`
          («Расскажи, что ты любишь»), и это перестало значить что-либо вместе
          с состояниями (тикет 124). */}
      {shown.length === 0 && (
        <p className="text-sm text-text-muted">
          {sort === "hidden" ? tl("emptyHidden") : tg("emptyWant")}
        </p>
      )}

      {/* Нижняя панель действия: счёт стоит прямо в подписи кнопки (29b). */}
      {picking && pickedHere > 0 && (
        <div className="sticky bottom-4 z-10 mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPicking(false);
              setPicked(new Set());
            }}
            className="pressable btn-quiet"
          >
            {tl("cancel")}
          </button>
          <button
            type="button"
            onClick={hidePicked}
            className="pressable btn-quiet"
            style={{ "--pill-accent": accent } as CSSProperties}
          >
            {tl("hideMany", { count: pickedHere })}
          </button>
        </div>
      )}
    </>
  );
}
