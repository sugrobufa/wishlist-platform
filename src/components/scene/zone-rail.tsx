import type { ReactNode } from "react";
import type { RoomZone } from "@/config/design";
import type { ZoneSummaryDto } from "@/server/dto/zone-summary";
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
   * висит там же по центру. Под списком она читается естественнее: сначала
   * человек прошёл зоны, потом ему предлагают собрать такую же.
   *
   * На десктопе полоса — лента в 116 px, оглавление в ней горизонтальное,
   * и «под списком» означает «в той же ленте ниже»: там места хватает обоим.
   */
  below?: ReactNode;
};

/**
 * Нижняя полоса интерфейса целиком: строка действий и под ней оглавление зон
 * (тикет 34). Отдельный компонент, потому что обе страницы комнаты — хозяйки
 * и гостя — собирают полосу одинаково.
 *
 * ОГЛАВЛЕНИЕ ДВУХ ВИДОВ (тикет 66). На десктопе — горизонтальный указатель со
 * сводкой по наведению (`ZoneIndex`, турн 17a). На телефоне — вертикальный
 * список под комнатой (`ZoneList`): он занимает пустоту, которая оставалась
 * ниже кадра, и показывает все зоны сразу, включая 33, что в покое стоят за
 * правым краем окна.
 *
 * Рисуются ОБА, лишний гасится медиа-запросом своего модуля. `display: none`
 * убирает узел и из дерева доступности — двойного обхода у читалки не будет,
 * а разводить их условием в JS нельзя: страница серверная и ширины не знает.
 *
 * Серверный: клиентские границы объявляют оглавления сами.
 */
export function ZoneRail({
  zones,
  zonesOff,
  summaries,
  viewer,
  accent,
  children,
  below,
}: ZoneRailProps) {
  return (
    <div className={s.stack}>
      <div className="imm-row">{children}</div>
      <ZoneIndex
        zones={zones}
        zonesOff={zonesOff}
        summaries={summaries}
        viewer={viewer}
        accent={accent}
      />
      <ZoneList
        zones={zones}
        zonesOff={zonesOff}
        summaries={summaries}
        viewer={viewer}
        accent={accent}
      />
      {below && <div className={s.below}>{below}</div>}
    </div>
  );
}
