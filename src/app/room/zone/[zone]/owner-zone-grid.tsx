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
// Меню вещи (тикеты 13 и 10) переехало в строку целиком. У «хочу»: «Уже моё» (ручной переход
// в «люблю» — необратим, двухшаговое подтверждение), «Спрятать», «Удалить».
// У «люблю»: «В зал славы / Убрать из зала», «Спрятать», «Удалить».
// Слот заполняется только у своих вещей: у демо-призраков меню нет — они не
// в БД. «Бирки» здесь нет и не будет — она ровно одна, «подарить» у гостя
// (турн 22). Обратного пути LOVE → WANT в меню нет и не появится (инвариант №2).
import { useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { IconCheck } from "@/components/icons";
import { PoolIcon } from "@/components/pool-icons";
import { tileAppearance } from "@/components/zone/tile-appearance";
import rl from "@/components/room-list/room-list.module.css";
import type { ZoneGridItem } from "@/components/zone/types";
import {
  deleteItemAction,
  selfFulfillAction,
  setItemHiddenAction,
  setItemsHiddenAction,
  toggleHallAction,
} from "./actions";

/** Owner-DTO несёт inHall у «люблю»; общий контракт сетки его не знает. */
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
  /** Пул зоны — значок вместо буквы у вещи без фото (тикет 82). */
  pool?: string | null;
};

/** Двухшаговые подтверждения: удаление и необратимое «уже моё». */
type Confirming = { id: string; kind: "delete" | "own" };

/** Цена строкой: «14 900 ₽». Деньги в DTO — строка Decimal (CLAUDE.md). */
function formatPrice(item: ZoneGridItem, locale: string): string | null {
  if (item.state !== "WANT" || item.price == null) return null;
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

export function OwnerZoneGrid({ items, accent, zoneKey, pool }: OwnerZoneGridProps) {
  const t = useTranslations("Settings");
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

  const renderItemAction = (item: ZoneGridItem): ReactNode => {
    if (item.isDemo) return null;
    const busy = busyId === item.id;
    // Каст честный: сюда приходят те же объекты, что в items (OwnerGridItem).
    const inHall = (item as OwnerGridItem).inHall === true;

    if (confirming?.id === item.id) {
      const isDelete = confirming.kind === "delete";
      return (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-muted">
            {isDelete ? t("itemDeleteConfirm") : t("itemAlreadyMineConfirm")}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(item.id, () =>
                isDelete ? deleteItemAction(item.id) : selfFulfillAction(item.id),
              )
            }
            className="pressable font-semibold text-text-strong disabled:opacity-60"
          >
            {isDelete ? t("itemDeleteYes") : t("itemAlreadyMineYes")}
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
    }

    return (
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
        {item.hidden && (
          <span className="overline text-text-faint">{t("itemHiddenBadge")}</span>
        )}
        {/* Карточка вещи (тикет 39): правка полей, перенос на другую полку,
            история «люблю». Отсюда же и только у своих вещей. */}
        <Link
          href={`/room/zone/${zoneKey}/i/${item.id}`}
          className="pressable font-semibold text-text-muted hover:text-text-strong"
        >
          {t("itemEdit")}
        </Link>
        {/* «Хочу»: ручной переход «уже моё» (тикет 10) — с подтверждением,
            потому что обратно в «хочу» пути не существует. */}
        {item.state === "WANT" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming({ id: item.id, kind: "own" })}
            className="pressable font-semibold disabled:opacity-60"
            style={{ color: accent }}
          >
            {t("itemAlreadyMine")}
          </button>
        )}
        {/* «Люблю»: витрина зала славы туда и обратно (тикет 10). */}
        {item.state === "LOVE" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(item.id, () => toggleHallAction(item.id, !inHall))}
            className="pressable font-semibold disabled:opacity-60"
            style={{ color: accent }}
          >
            {inHall ? t("itemHallRemove") : t("itemHallAdd")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => run(item.id, () => setItemHiddenAction(item.id, !item.hidden))}
          className="pressable font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
        >
          {item.hidden ? t("itemShow") : t("itemHide")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming({ id: item.id, kind: "delete" })}
          className="pressable font-semibold text-text-muted hover:text-text-strong disabled:opacity-60"
        >
          {t("itemDelete")}
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

      {/* СТРОКИ 29b. Вид взят у экрана «вся комната списком» (29a) — там он
          уже отрисован и проверен, второй раз рисовать незачем. */}
      <ul className={rl.rows} style={{ "--rl-accent": accent } as CSSProperties}>
        {shown.map((item) => {
          const look = tileAppearance(item, pool);
          const price = formatPrice(item, locale);
          const on = picked.has(item.id);
          return (
            <li key={item.id} className={rl.row}>
              {/* Кружок выбора СЛЕВА — как на макете. У демо-призрака его нет:
                  его не спрятать, он не в БД. */}
              {picking && !item.isDemo && (
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
              )}
              <div
                className={look.dashed ? `${rl.thumb} ${rl.thumbWant}` : rl.thumb}
                style={item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined}
                aria-hidden
              >
                {look.poolIcon && (
                  <span className={rl.monogram}>
                    <PoolIcon pool={look.poolIcon} />
                  </span>
                )}
                {look.monogram && <span className={rl.monogram}>{look.monogram}</span>}
              </div>
              <div className={rl.body}>
                <p className={rl.title}>{item.title}</p>
                <span className={item.state === "WANT" ? `${rl.chip} ${rl.chipWant}` : rl.chip}>
                  {item.state === "WANT" ? tg("tabWant") : tg("loveCaption")}
                </span>
                {/* Меню вещи — под строкой, чтобы не спорить с ценой справа. */}
                {!picking && renderItemAction(item)}
              </div>
              {price && <span className={rl.price}>{price}</span>}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="text-sm text-text-muted">{tg(sort === "hidden" ? "emptyLove" : "emptyWant")}</p>
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
