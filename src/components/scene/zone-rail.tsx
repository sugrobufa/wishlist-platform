"use client";

// Нижняя полоса интерфейса целиком: строка действий и под ней ЛИБО оглавление
// зон, ЛИБО плоский список всех вещей комнаты (тикет 34 + тикет 129).
//
// ЗНАК «СПИСКОМ» ПЕРЕЕХАЛ СЮДА ИЗ УГЛА СЦЕНЫ (тикет 129, приёмка владельца
// 09.08: «я же показываю область, куда надо поставить списком»). Он стоит у
// ПРАВОГО края этой строки, зеркально «поделиться» слева, и переключает
// содержимое ЭТОЙ ЖЕ полосы: строки зон ↔ все вещи комнаты. Второе нажатие
// возвращает зоны. Кадр при этом остаётся на экране — в этом весь смысл
// правки: раньше «Списком» было выходом из комнаты, а должно быть другим
// взглядом на неё же. Управление стоит там, где то, чем оно управляет.
//
// УКАЗАТЕЛЬ ЗОН НЕ УБИРАЕМ, и это не вкусовщина: на телефоне 33 зоны в покое
// стоят за правым краем окна кадра (ADR-0006), и перечень под кадром —
// единственная дорога к ним. Он второе положение переключателя, а не остаток.
//
// ПОЧЕМУ КЛИЕНТСКИЙ. Положение переключателя — взгляд, а не настройка: живёт в
// состоянии на сессию, в БД и cookie не пишется (условие тикета 129). Обе
// половины содержимого приезжают с сервера УЗЛАМИ, второго запроса нет — это
// важно гостю, чья страница кэшируется целиком полностраничным ISR.
//
// ОГЛАВЛЕНИЕ ДВУХ ВИДОВ (тикет 66). На десктопе — горизонтальный указатель со
// сводкой по наведению (`ZoneIndex`, турн 17a). На телефоне — вертикальный
// список под комнатой (`ZoneList`). Рисуются ОБА, лишний гасится медиа-запросом
// своего модуля: `display: none` убирает узел и из дерева доступности, а
// разводить их условием в JS нельзя — ширину страница не знает.
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { RoomZone } from "@/config/design";
import type { ZoneSummaryDto } from "@/server/dto/zone-summary";
import { IconList } from "@/components/icons";
import { CORNER_ICON_SIZE } from "./scene-corner";
import { ZoneIndex } from "./zone-index";
import { ZoneList } from "./zone-list";
import s from "./zone-index.module.css";

type ZoneRailProps = {
  zones: readonly RoomZone[];
  zonesOff?: string[];
  summaries?: Record<string, ZoneSummaryDto>;
  viewer: "owner" | "guest";
  accent: string;
  /** Действия полосы — «Добавить вещь», «поделиться», призыв гостю. */
  children: ReactNode;
  /**
   * Что стоит ПОД оглавлением зон, а не над ним (тикет 77). Нужно гостю:
   * его призыв «Понравилось? Собрать свою →» — длинная строка, и в узкой
   * полосе над списком она сталкивалась с подсказкой «коснись зоны», которая
   * висит там же по центру. Под списком она читается естественнее.
   *
   * У ХОЗЯЙКИ ЗДЕСЬ ЖИВУТ БЛОКИ ПУСТОЙ КОМНАТЫ — «Или начни с готового» и
   * плашка «ссылку лучше отдавать от пяти вещей». Раньше оба были
   * `position: fixed` с высотами, посчитанными на глаз от таб-бара, и ложились
   * прямо на строки зон: в пустой комнате на экране оказывались три слоя,
   * ничего не знающих друг о друге. Теперь они в ОДНОМ потоке со списком —
   * список отдаёт им место, а не они ему.
   */
  below?: ReactNode;
  /**
   * Гостевая половина счётчика зоны по её ключу — «3 из 4 свободны» (тикет 124).
   * Узел, а не число: второе число считает КЛИЕНТ из некэшируемого канала
   * «занято», и сложиться в кэшируемой сводке оно не имеет права (инвариант
   * №1). Ключа нет — строку говорит сводка, то есть «N вещей» у хозяйки.
   */
  counters?: Record<string, ReactNode>;
  /**
   * Все вещи комнаты плоским списком — второе положение переключателя
   * (тикет 129). Узла нет — нет и знака: полоса остаётся такой, какой была.
   */
  roomList?: ReactNode;
};

export function ZoneRail({
  zones,
  zonesOff,
  summaries,
  viewer,
  accent,
  children,
  below,
  counters,
  roomList,
}: ZoneRailProps) {
  const t = useTranslations("RoomList");
  /**
   * Взгляд, а не настройка: сбрасывается вместе со страницей и никуда не
   * пишется. Знак несёт видимое включённое состояние — иначе человек не
   * поймёт, в каком из двух видов он находится (условие тикета 129).
   */
  const [asList, setAsList] = useState(false);
  const showList = asList && roomList != null;

  return (
    <div className={s.stack}>
      <div className="imm-row">
        {/* Действия жмутся влево одной группой, знак — вправо. Без обёртки
            `space-between` растащил бы по полосе и «Добавить вещь», и
            «поделиться», и знак: на десктопе у хозяйки их трое. */}
        <div className={s.rowLead}>{children}</div>
        {roomList != null && (
          <button
            type="button"
            aria-pressed={showList}
            aria-label={t("toList")}
            title={t("toList")}
            onClick={() => setAsList((value) => !value)}
            className={showList ? `pressable ${s.listMark} ${s.listMarkOn}` : `pressable ${s.listMark}`}
            style={{ "--rail-accent": accent } as React.CSSProperties}
          >
            <IconList size={CORNER_ICON_SIZE} />
          </button>
        )}
      </div>

      {showList ? (
        <div className={s.listPane}>{roomList}</div>
      ) : (
        <>
          <ZoneIndex
            zones={zones}
            zonesOff={zonesOff}
            summaries={summaries}
            viewer={viewer}
            accent={accent}
            counters={counters}
          />
          <ZoneList
            zones={zones}
            zonesOff={zonesOff}
            summaries={summaries}
            viewer={viewer}
            accent={accent}
            counters={counters}
          />
        </>
      )}

      {below && <div className={s.below}>{below}</div>}
    </div>
  );
}
