"use client";

// Вся комната списком (тикет 67, приведено к турну 29a тикетом 73).
//
// ЗАЧЕМ. К вещи вела единственная дорога: сцена → зона → лист. Кто пришёл по
// ссылке выбрать подарок за минуту, был вынужден играть в комнату. Владелец:
// «новое представление, где просто список всех вещей — для тех, кто не готов
// и не хочет гулять по комнате».
//
// ПОЧЕМУ СТРОКА, А НЕ ПЛИТКА. Тикет 67 собрал экран без макета — его тогда не
// было — и взял сетку плиток из зоны. Турн 29a рисует строки, и это верно по
// сути задачи: строка отдаёт название, состояние и цену одним взглядом, а
// плитка прячет цену под картинку. Ради взгляда экран и затевался.
//
// ЧЕГО ЗДЕСЬ НЕТ. Демо-призраков: они объясняют язык ЗОНЫ в сцене, а в плоском
// перечне читались бы как чужие вещи (фильтр — на сервере, в странице). Своих
// правил видимости: что показать, решили DTO-слой и сервис гостя.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PoolIcon } from "@/components/pool-icons";
import { tileAppearance } from "@/components/zone/tile-appearance";
import type { ZoneGridItem } from "@/components/zone/types";
import s from "./room-list.module.css";

export type RoomListGroup = {
  /** Ключ зоны — он же адрес её отдельного экрана. */
  key: string;
  label: string;
  items: ZoneGridItem[];
  /** Пул зоны — значок вместо буквы у вещи без фото (тикет 82). */
  pool?: string | null;
};

export type RoomListViewProps = {
  groups: RoomListGroup[];
  accent: string;
  /** Куда ведёт «Комната» в переключателе: сцена хозяйки или гостя. */
  roomHref: string;
  /**
   * Куда ведёт заголовок группы: НАЧАЛО адреса, к которому дописывается ключ
   * зоны. У хозяйки — её экран зоны, у гостя своего экрана зоны нет, и
   * заголовок остаётся просто заголовком.
   *
   * ПОЧЕМУ СТРОКА, А НЕ ФУНКЦИЯ (тикет 101). Здесь была функция
   * `(key) => \`/room/zone/${key}\``, и страница хозяйки — серверная —
   * передавала её в этот клиентский компонент. Через границу RSC функции не
   * ходят: «Functions cannot be passed directly to Client Components». Экран
   * падал с 500 с самого тикета 67 и молчал ровно до тех пор, пока владелец
   * не нажал на кнопку «Списком» — прежде она была тихой стрелочной ссылкой,
   * и на неё не попадали. Ни `next build`, ни typecheck такого не ловят: это
   * ошибка времени выполнения.
   */
  zoneHrefBase?: string;
  /**
   * Вещи комнаты с чужой бронью — приходит ТОЛЬКО у гостя (тикет 74, 29b):
   * с ним появляется переключатель «только свободные». Хозяйке этот набор не
   * передаётся и передан быть не может — инвариант №1 (тихая бронь) запрещает
   * ей знать, что именно забрано; у неё есть один счётчик по комнате.
   */
  takenIds?: ReadonlySet<string>;
};

type Filter = "all" | "want" | "love";

/** Цена строкой: "14 900 ₽". Деньги в DTO — строка Decimal (CLAUDE.md). */
function formatPrice(item: ZoneGridItem, locale: string): string | null {
  if (item.price == null) return null;
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
    // Неизвестный код валюты — показываем как есть, не падаем.
    return `${item.price} ${item.currency ?? ""}`.trim();
  }
}

export function RoomListView({
  groups,
  accent,
  roomHref,
  zoneHrefBase,
  takenIds,
}: RoomListViewProps) {
  const t = useTranslations("RoomList");
  const tGrid = useTranslations("ZoneGrid");
  const tZone = useTranslations("ZoneList");
  const locale = useLocale();
  const [freeOnly, setFreeOnly] = useState(false);
  // «Хочу» по умолчанию и первым (тикет 78) — то же правило, что во вкладках
  // зоны: список затевался, чтобы выбрать подарок, а не листать витрину.
  const [filter, setFilter] = useState<Filter>("want");

  const shown = useMemo(() => {
    // «Только свободные» — фильтр по ОТСУТСТВИЮ брони, поверх вкладки.
    // Свободным может быть только «хочу»: «люблю» уже своё, дарить нечего.
    const free = (items: ZoneGridItem[]) =>
      freeOnly && takenIds
        ? items.filter((item) => item.state === "WANT" && !takenIds.has(item.id))
        : items;
    if (filter === "all") {
      return groups
        .map((group) => ({ ...group, items: free(group.items) }))
        .filter((group) => group.items.length > 0);
    }
    const want = filter === "want";
    return groups
      .map((group) => ({
        ...group,
        items: free(group.items.filter((item) => (item.state === "WANT") === want)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, filter, freeOnly, takenIds]);

  const total = useMemo(() => shown.reduce((sum, group) => sum + group.items.length, 0), [shown]);

  const filters: Array<[Filter, string]> = [
    ["want", t("filterWant")],
    ["love", t("filterLove")],
    ["all", t("filterAll")],
  ];

  return (
    <div style={{ "--rl-accent": accent } as React.CSSProperties}>
      {/* Переключатель «Комната / Список» (29a): список не заменяет сцену, он
          стоит рядом с ней, и вернуться должно быть так же дёшево, как уйти. */}
      <div className={s.segmented} role="group" aria-label={t("viewAria")}>
        <Link href={roomHref} className={`pressable ${s.segment}`}>
          {t("toRoom")}
        </Link>
        <span className={`${s.segment} ${s.segmentOn}`} aria-current="page">
          {t("toList")}
        </span>
      </div>

      <div className={s.filters} role="group" aria-label={t("filterAria")}>
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            className={
              filter === key ? `pressable ${s.filter} ${s.filterOn}` : `pressable ${s.filter}`
            }
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        {/* «Только свободные» (турн 29b-guest): отдельный переключатель, а не
            четвёртая вкладка — он ортогонален «Хочу/Люблю» и складывается с
            ними. Гостю знать о бронях можно: инвариант №1 закрывает их от
            ХОЗЯЙКИ, и набор занятых сюда приходит только на её половине
            отсутствующим. */}
        {takenIds && (
          <button
            type="button"
            aria-pressed={freeOnly}
            className={freeOnly ? `pressable ${s.filter} ${s.filterOn}` : `pressable ${s.filter}`}
            onClick={() => setFreeOnly((value) => !value)}
          >
            {tZone("freeOnly")}
          </button>
        )}
      </div>

      {total === 0 ? (
        <p className={s.empty}>{freeOnly ? tZone("emptyFree") : t("empty")}</p>
      ) : (
        shown.map((group) => (
          <section key={group.key} className={s.group}>
            <h2 className={s.groupHead}>
              {zoneHrefBase ? (
                <Link href={`${zoneHrefBase}${group.key}`} className="pressable">
                  {group.label}
                </Link>
              ) : (
                group.label
              )}
              <span className={s.groupCount}>·{group.items.length}</span>
            </h2>
            <ul className={s.rows}>
              {group.items.map((item) => {
                const look = tileAppearance(item, group.pool);
                const price = item.state === "WANT" ? formatPrice(item, locale) : null;
                return (
                  <li key={item.id} className={s.row}>
                    <div
                      className={look.dashed ? `${s.thumb} ${s.thumbWant}` : s.thumb}
                      style={
                        item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined
                      }
                      aria-hidden
                    >
                      {/* Значок ЗОНЫ вместо чёрной дыры — тот же приём, что
                          на плитке (тикеты 68 и 82); где значка нет, остаётся
                          буква. Инвариант №3 не затронут: оба знака ходят с
                          отсутствием фото, пунктир — с «хочу». */}
                      {look.poolIcon && (
                        <span className={s.monogram}>
                          <PoolIcon pool={look.poolIcon} />
                        </span>
                      )}
                      {look.monogram && <span className={s.monogram}>{look.monogram}</span>}
                    </div>
                    <div className={s.body}>
                      <p className={s.title}>{item.title}</p>
                      <span className={item.state === "WANT" ? `${s.chip} ${s.chipWant}` : s.chip}>
                        {item.state === "WANT" ? tGrid("tabWant") : tGrid("loveCaption")}
                      </span>
                    </div>
                    {price && <span className={s.price}>{price}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
