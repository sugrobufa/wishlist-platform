import type { ReactNode } from "react";
import type { RoomZone } from "@/config/design";
import type { ZoneSummaryDto } from "@/server/dto/zone-summary";
import { ZoneIndex } from "./zone-index";
import s from "./zone-index.module.css";

type ZoneRailProps = {
  zones: readonly RoomZone[];
  zonesOff?: string[];
  summaries?: Record<string, ZoneSummaryDto>;
  viewer: "owner" | "guest";
  accent: string;
  /** Действия полосы — «Добавить вещь», «поделиться», призыв гостю. */
  children: ReactNode;
};

/**
 * Нижняя полоса интерфейса целиком: строка действий и под ней указатель зон
 * (тикет 34). Отдельный компонент, потому что обе страницы комнаты — хозяйки
 * и гостя — собирают полосу одинаково, а раскладка внутри полосы (две строки
 * в 116 px) держится на классах модуля указателя.
 *
 * Серверный: указатель — единственная клиентская часть, и он свою границу
 * объявляет сам.
 */
export function ZoneRail({ zones, zonesOff, summaries, viewer, accent, children }: ZoneRailProps) {
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
    </div>
  );
}
