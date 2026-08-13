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
  /**
   * Куда ведёт «Комната» в переключателе: сцена хозяйки или гостя. Не нужен
   * встроенному виду (`embedded`) — там из списка не уходят, там переключаются.
   */
  roomHref?: string;
  /**
   * Список стоит В ПОЛОСЕ ПОД КАДРОМ, а не отдельной страницей (тикет 129).
   * Тогда переключателя «Комната / Список» внутри него быть не должно: он
   * уводил бы со страницы, а весь смысл правки в том, что уходить не надо —
   * переключает знак «Списком» в той же полосе, и кадр остаётся на экране.
   */
  embedded?: boolean;
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

// Ряда «Хочу · Люблю · Все» больше нет (тикет 124): делить список нечем —
// состояний у вещи не осталось, а в комнате лежит только то, чего хочется.
// «Только свободные» остался: он про БРОНИ, а не про состояния.

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
  embedded = false,
  zoneHrefBase,
  takenIds,
}: RoomListViewProps) {
  const t = useTranslations("RoomList");
  const tZone = useTranslations("ZoneList");
  const locale = useLocale();
  const [freeOnly, setFreeOnly] = useState(false);

  const shown = useMemo(() => {
    // ПУСТАЯ ПОЛКА ОСТАЁТСЯ В СПИСКЕ (тикет 239). Прежде здесь стояло
    // `.filter((group) => group.items.length > 0)`: список был «про вещи», и
    // полка без единой вещи из него выпадала. С решением владельца 14.08.2026
    // это стало дырой: у семи полок нет места на кадре (`zonesWithoutRect`,
    // тикет 235), метки у них тоже нет — и пустая такая полка не была видна
    // НИГДЕ, ни в кадре, ни в списке. Теперь видна: полка есть, просто тише.
    //
    // ЭТО ОТМЕНЯЕТ ПРАВИЛО РАУНДА 29 (`round29/task31.json` → headers.roomList:
    // «пустые зоны секциями не рисуются — список про вещи, ПОЛКИ ЖИВУТ В
    // КОМНАТЕ»). Отменяет не по недосмотру, а вместе с его доводом: семь полок
    // в комнате больше не живут. Правило верно ровно для тех, у кого есть место
    // на кадре, а различать полки по этому признаку экран не имеет права
    // (пакет 51: «иначе это второй сорт полок, а не закрытая дырка»), — значит
    // остаются в списке все.
    //
    // «Только свободные» — другое дело: это ФИЛЬТР по отсутствию брони, и
    // отфильтрованная полка молчит, а не говорит «пусто». Иначе включённый
    // фильтр превратил бы список в таблицу из тринадцати «пусто».
    if (!freeOnly || !takenIds) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !takenIds.has(item.id)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, freeOnly, takenIds]);

  const total = useMemo(() => shown.reduce((sum, group) => sum + group.items.length, 0), [shown]);

  return (
    <div style={{ "--rl-accent": accent } as React.CSSProperties}>
      {/* Переключатель «Комната / Список» (29a) — только у ОТДЕЛЬНОЙ страницы
          списка: там он единственная дорога назад к сцене. В полосе под кадром
          (тикет 129) его нет и быть не должно — там переключает знак, а кадр
          и так на экране. */}
      {!embedded && roomHref && (
        <div className={s.segmented} role="group" aria-label={t("viewAria")}>
          <Link href={roomHref} className={`pressable ${s.segment}`}>
            {t("toRoom")}
          </Link>
          <span className={`${s.segment} ${s.segmentOn}`} aria-current="page">
            {t("toList")}
          </span>
        </div>
      )}

      <div className={s.filters} role="group" aria-label={t("filterAria")}>
        {/* «Только свободные» (турн 29b-guest) — единственный фильтр, который
            пережил тикет 124: он про БРОНИ, а не про состояния. Гостю знать о
            бронях можно: инвариант №1 закрывает их от ХОЗЯЙКИ, и набор занятых
            сюда приходит только на её половине отсутствующим. */}
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
          // Якорь `zone-{ключ}` — по нему в полку приходят из списка полок
          // (экран 57a): у гостя своего экрана полки нет, и это его дорога к
          // вещам. Знаком он не является и ничего не помечает — в разметке его
          // видно только адресу.
          <section key={group.key} id={`zone-${group.key}`} className={s.group}>
            <h2 className={s.groupHead}>
              {zoneHrefBase ? (
                <Link href={`${zoneHrefBase}${group.key}`} className="pressable">
                  {group.label}
                </Link>
              ) : (
                group.label
              )}
              {/* Пустая полка говорит «пусто» вместо числа — то же слово и то
                  же место, что на экране полок (контракт → states.empty). */}
              <span className={s.groupCount}>
                {group.items.length === 0 ? tZone("empty") : `·${group.items.length}`}
              </span>
            </h2>
            <ul className={s.rows}>
              {group.items.map((item) => {
                const look = tileAppearance(item, group.pool);
                const price = item.inHall === true ? null : formatPrice(item, locale);
                return (
                  <li key={item.id} className={s.row}>
                    {/* Миниатюра одна на всех: пунктира не бывает ни у какой
                        вещи (тикет 124, инвариант №3 отменён целиком). */}
                    <div
                      className={s.thumb}
                      style={
                        item.photoUrl ? { backgroundImage: `url(${item.photoUrl})` } : undefined
                      }
                      aria-hidden
                    >
                      {/* Значок ЗОНЫ вместо чёрной дыры — тот же приём, что
                          на плитке (тикеты 68 и 82); где значка нет, остаётся
                          буква. Оба знака ходят с отсутствием фото. */}
                      {look.poolIcon && (
                        <span className={s.monogram}>
                          <PoolIcon pool={look.poolIcon} />
                        </span>
                      )}
                      {look.monogram && <span className={s.monogram}>{look.monogram}</span>}
                    </div>
                    <div className={s.body}>
                      <p className={s.title}>{item.title}</p>
                      {/* Чип состояния («Хочу» / «Люблю») тикет 124 отменил:
                          в комнате все вещи одинаковы. Строку убирает заход
                          про экраны — здесь она просто перестала рисоваться. */}
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
